import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, lstatSync, existsSync, unlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, sep, dirname } from "node:path";
import { digest } from "./coordinator.mjs";
import { assessRun } from "./assessment.mjs";
import { readVerifiedReport, inputManifest } from "./evidence.mjs";
import { parseRuntimeReport } from "./runtime-tiers.mjs";

const requireValue = (condition, message) => {
  if (!condition) throw new Error(`FAILURE-GATE BLOCKED: ${message}`);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const forbiddenEnvironment = /^(CI_SMOKE_TEST|VALIDATION_MANIFEST_PATH|FAILURE_GATE_TIERS_PATH|NODE_OPTIONS|NODE_TEST_CONTEXT|TEST_ONLY|TEST_FILTER|GREP|PLAYWRIGHT_TEST_GREP|TASK_PLAN_FILE|FAILURE_GATE_BROWSER_REPORT)$/;

// No shell interpolation, external paths, symlinks, or caller-selected reports.
export function projectFile(root, reference) {
  requireValue(typeof reference === "string" && reference.length > 0 &&
    !reference.split(/[\\/]/).includes(".."), "invalid project reference");
  const base = realpathSync(root);
  const path = resolve(base, reference);
  const rel = relative(base, path);
  requireValue(rel && rel !== ".." && !rel.startsWith(`..${sep}`) &&
    realpathSync(path) === path && lstatSync(path).isFile(), "unsafe project reference");
  return path;
}

export function policyDigest(root, inputs) {
  requireValue(Array.isArray(inputs) && inputs.length > 0 &&
    new Set(inputs).size === inputs.length, "governing input inventory required");
  return digest([...inputs].sort().map((path) => [path, hash(readFileSync(projectFile(root, path)))]));
}

export function checkedEnvironment(source, policy) {
  requireValue(policy && Array.isArray(policy.allowedEnvironment), "environment policy unavailable");
  const allowed = new Set(policy.allowedEnvironment);
  for (const key of Object.keys(source)) {
    if (forbiddenEnvironment.test(key) && source[key] !== undefined && source[key] !== "") {
      throw new Error(`FAILURE-GATE BLOCKED: coverage override ${key}`);
    }
  }
  // The accepted policy explicitly lists needed runtime variables; do not
  // accidentally pass an unknown coverage selector into a nested command.
  return Object.fromEntries(Object.entries(source).filter(([key, value]) =>
    allowed.has(key) && typeof value === "string"));
}

export function validateTier(tier) {
  requireValue(tier && Array.isArray(tier.steps) && tier.steps.length > 0, "tier unavailable");
  const names = new Set();
  for (const step of tier.steps) {
    requireValue(!step.unsupportedReport, `unsupported report: ${step.name}: ${step.unsupportedReport}`);
    requireValue(step && typeof step.name === "string" && !names.has(step.name) &&
      ["test", "lint", "typecheck", "audit", "smoke", "harness"].includes(step.kind) &&
      Array.isArray(step.command) && step.command.length > 0 &&
      typeof step.command[0] === "string" && step.command[0].length > 0 &&
      step.command.every((arg) => typeof arg === "string" && !arg.includes("\0")) &&
      Number.isSafeInteger(step.timeoutMs) && step.timeoutMs > 0, "malformed tier step");
    names.add(step.name);
    requireValue(step.kind !== "test" || (step.report && Number.isSafeInteger(step.minimumTests) &&
      step.minimumTests > 0), "test discovery/report policy unavailable");
  }
  return tier;
}

function executeArgv(command, { cwd, env, timeoutMs }) {
  return new Promise((resolveResult) => {
    let timedOut = false;
    let finished = false;
    let output = "";
    let truncated = false;
    const child = spawn(command[0], command.slice(1), {
      cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"],
      // A timed-out child may have surviving descendants. Its lease remains
      // unresolved; only the host's process-identity recovery may replace it.
    });
    const collect = (bytes) => {
      if (Buffer.byteLength(output) + bytes.length > 8 * 1024 * 1024) truncated = true;
      else if (!truncated) output += bytes.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let forceTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => {
        child.kill("SIGKILL");
        settle({ exitCode: null, signal: "timeout" });
      }, 500);
    }, timeoutMs);
    const settle = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      resolveResult({ ...result, timedOut, output, truncated });
    };
    child.once("error", () => settle({ exitCode: null, signal: null }));
    child.once("close", (exitCode, signal) => settle({ exitCode, signal }));
  });
}

// A host report is structured evidence, never a PASS label or console text.
export function readStepReport(root, step) {
  const path = projectFile(root, step.report);
  requireValue(lstatSync(path).size <= 1024 * 1024, "report exceeds bound");
  const bytes = readFileSync(path);
  const report = JSON.parse(bytes.toString("utf8"));
  requireValue(report && Number.isSafeInteger(report.tests) && report.tests >= step.minimumTests &&
    Number.isSafeInteger(report.skipped) && report.skipped === 0 &&
    Array.isArray(report.failures), "missing discovery or skipped required tests");
  return { ...report, artifact: { reference: step.report, digest: hash(bytes) } };
}

/**
 * Candidate workflow adapter. `host` is supplied by the accepted coordinator
 * installation, never selected by a CLI flag or task environment variable.
 * It supplies snapshot isolation, real resource locking, process identity,
 * policy inventory and final writer coordination. Missing capabilities block.
 * Repository scripts deliberately do not fabricate a production host adapter.
 */
export class CheckedExecution {
  constructor({ coordinator, root, host }) {
    this.coordinator = coordinator;
    this.root = realpathSync(root);
    this.host = host;
  }

  preflight({ taskId, planReference, requestedTier, args = [], env = process.env }) {
    const host = this.host;
    requireValue(host && host.mode === "workflow" && host.accepted === true,
      "independently accepted host adapter unavailable");
    requireValue(!host.verifyPolicy || host.verifyPolicy() === true,
      "accepted adapter or environment policy changed");
    requireValue(typeof host.withResourceLock === "function" &&
      typeof host.snapshot === "function" && typeof host.verifySnapshot === "function" &&
      typeof host.processIdentity === "function", "execution/isolation capability unavailable");
    const task = this.coordinator.assignedTask();
    requireValue(task.taskId === taskId, "task substitution denied");
    requireValue(task.planReference === planReference, "wrong approved plan reference");
    const actualPlan = readFileSync(projectFile(this.root, planReference), "utf8");
    requireValue(digest(actualPlan) === task.planDigest, "stale plan");
    requireValue(args.length === 0, "caller execution arguments denied");
    requireValue(!requestedTier || requestedTier === task.authorizedTier, "tier mismatch");
    const tier = validateTier(host.tiers[task.authorizedTier]);
    const policy = policyDigest(this.root, host.policyInputs);
    requireValue(policy === task.policyDigest && digest(tier) === task.tierDefinitionDigest &&
      digest(host.parameters) === task.parametersDigest, "governing policy changed without acceptance");
    return { task, tier, policy, env: checkedEnvironment(env, host.parameters) };
  }

  async run(request, diagnosticRequest = null, comparisonRequest = null) {
    const { task, tier, policy, env } = this.preflight(request);
    const coordinator = this.coordinator;
    let steps = tier.steps;
    let diagnostic = null;
    let comparison = null;
    requireValue(!(diagnosticRequest && comparisonRequest), "run purposes cannot be combined");
    if (diagnosticRequest) {
      const { initialRunId, failure, selector } = diagnosticRequest;
      const initial = coordinator.run(initialRunId);
      requireValue(initial.taskId === task.taskId && initial.evidence &&
        initial.purpose === "required_tier_validation", "diagnostic initial run mismatch");
      const original = await this.host.readEvidence(initial.evidence.reference);
      requireValue(digest(original) === initial.evidence.digest &&
        original.steps.some((step) => step.report?.failures?.some((observed) =>
          digest(observed) === digest(failure))), "diagnostic failure was not observed");
      const spec = tier.diagnostics?.[selector];
      requireValue(spec?.safe === true && spec.purpose === "diagnostic_retry" &&
        spec.failureDigest === digest(failure), "safe registered diagnostic unavailable");
      validateTier({ steps: [spec.step] });
      steps = [spec.step];
      diagnostic = { initialRunId, failureDigest: digest(failure), selectorDigest: digest(spec) };
    }
    if (comparisonRequest) {
      const { initialRunId, failure, selector } = comparisonRequest;
      const initial = coordinator.run(initialRunId);
      requireValue(initial.taskId === task.taskId && initial.evidence &&
        initial.purpose === "required_tier_validation", "comparison initial run mismatch");
      const original = await this.host.readEvidence(initial.evidence.reference);
      requireValue(digest(original) === initial.evidence.digest &&
        original.steps.some((step) => step.report?.failures?.some((item) => digest(item) === digest(failure))),
      "comparison failure was not observed");
      const spec = tier.comparisons?.[selector];
      requireValue(spec?.safe === true && spec.purpose === "provenance_comparison" &&
        spec.failureDigest === digest(failure) && typeof this.host.comparisonSnapshot === "function",
      "registered comparison unavailable");
      validateTier({ steps: [spec.step] });
      steps = [spec.step];
      comparison = { initialRunId, failureDigest: digest(failure), selectorDigest: digest(spec),
        earlierSnapshotDigest: spec.earlierSnapshotDigest, environmentDigest: spec.environmentDigest };
    }
    let lease = coordinator.startRun({
      taskId: task.taskId, expectedVersion: task.authorizationVersion,
      planReference: task.planReference, policyDigest: policy,
      tierDefinitionDigest: digest(tier), parametersDigest: digest(this.host.parameters),
      purpose: comparison ? "provenance_comparison" : diagnostic ? "diagnostic_retry" : "required_tier_validation",
      diagnostic, comparison,
      processIdentity: this.host.processIdentity(), key: randomUUID(),
    });
    const results = [];
    let snapshot;
    let unresolved = false;
    const pulse = setInterval(() => {
      try {
        lease = coordinator.heartbeat({ runId: lease.runId, expectedVersion: lease.leaseVersion, key: randomUUID() });
      } catch { unresolved = true; }
    }, 1000);
    try {
      snapshot = comparison
        ? await this.host.comparisonSnapshot({ comparison, runId: lease.runId })
        : await this.host.snapshot({ root: this.root, runId: lease.runId });
      requireValue((snapshot?.isolated === true || snapshot?.isolation === "independent-copy") && typeof snapshot.digest === "string" &&
        snapshot.root !== this.root, "isolated snapshot unavailable");
      requireValue(comparison ? snapshot.digest === comparison.earlierSnapshotDigest :
        policyDigest(snapshot.root, this.host.policyInputs) === policy,
        "snapshot policy differs from accepted inputs");
      await this.host.withResourceLock(tier, async (lock) => {
        requireValue(lock?.held === true, "resource lock unavailable");
        for (const step of steps) {
          requireValue(!lock.stillHeld || lock.stillHeld(), "resource guardian stopped");
          if (unresolved || (step.dependsOn ?? []).some((name) =>
            !results.some((result) => result.name === name && result.status === "passed"))) {
            results.push({ name: step.name, kind: step.kind, status: "not_reached" });
            continue;
          }
          // A report copied with the input snapshot must never prove this run.
          if (step.report && existsSync(resolve(snapshot.root, step.report))) {
            unlinkSync(projectFile(snapshot.root, step.report));
          }
          const playwrightSource = step.reportAdapter?.kind === "playwright-json-v1"
            ? step.reportAdapter.source : null;
          if (playwrightSource && existsSync(resolve(snapshot.root, playwrightSource))) {
            unlinkSync(projectFile(snapshot.root, playwrightSource));
          }
          const { output, ...raw } = await executeArgv(step.command, { cwd: snapshot.root,
            env: playwrightSource ? { ...env, FAILURE_GATE_BROWSER_REPORT: "1" } : env,
            timeoutMs: step.timeoutMs });
          let report = null;
          let status = raw.exitCode === 0 ? "passed" : "failed";
          if (raw.exitCode === null || raw.signal || raw.timedOut) {
            status = "incomplete";
            unresolved = true;
          }
          if (step.kind === "test") {
            try {
              if (step.reportAdapter) {
                const parsed = parseRuntimeReport({ output, step, root: snapshot.root, truncated: raw.truncated,
                  environment: snapshot.manifest?.environment?.identity ?? "unknown" });
                const path = resolve(snapshot.root, step.report);
                requireValue(relative(snapshot.root, path).startsWith(`test-results${sep}`),
                  "runner report must stay in approved output directory");
                let directory = snapshot.root;
                for (const component of relative(snapshot.root, dirname(path)).split(sep)) {
                  directory = resolve(directory, component);
                  if (!existsSync(directory)) mkdirSync(directory);
                  requireValue(realpathSync(directory) === directory && lstatSync(directory).isDirectory(),
                    "report directory symlink or non-directory");
                }
                writeFileSync(path, JSON.stringify(parsed), { flag: "wx", mode: 0o600 });
              }
              report = readStepReport(snapshot.root, step);
              if (report.complete === false) status = "incomplete";
            }
            catch { status = "incomplete"; }
            if (report?.failures.length && raw.exitCode === 0) status = "incomplete";
            if (raw.exitCode !== 0 && report?.failures.length === 0) status = "incomplete";
          }
          results.push({ name: step.name, kind: step.kind, status,
            command: step.command, ...raw, report });
        }
      });
      requireValue(await this.host.verifySnapshot(snapshot) === true, "snapshot integrity unknown");
    } catch {
      unresolved = true;
      for (const step of steps) {
        if (!results.some((result) => result.name === step.name)) {
          results.push({ name: step.name, kind: step.kind, status: "not_reached" });
        }
      }
    } finally {
      clearInterval(pulse);
    }
    const evidence = { schemaVersion: 1, runId: lease.runId, taskId: task.taskId,
      namespace: task.namespace, purpose: lease.purpose, authorizationVersion: task.authorizationVersion,
      planDigest: task.planDigest, policyDigest: policy, tierDefinitionDigest: digest(tier),
      parametersDigest: task.parametersDigest, snapshotDigest: snapshot?.digest ?? null,
      isolation: snapshot?.isolation ?? (snapshot?.isolated ? "independent-copy" : null),
      environmentVerified: Boolean(snapshot?.manifest?.environment),
      snapshotRoot: snapshot?.root ?? null,
      steps: results, rawExitCode: !unresolved && results.every((result) => result.status === "passed") ? 0 : 1,
      integrity: unresolved ? "unknown" : "verified", mode: "workflow" };
    // Evidence is stored by the accepted host, not imported from caller JSON.
    requireValue(typeof this.host.storeEvidence === "function", "evidence storage unavailable");
    const reference = await this.host.storeEvidence(evidence);
    if (!unresolved) {
      lease = coordinator.finishRun({ runId: lease.runId, expectedVersion: lease.leaseVersion,
        evidence: { reference, digest: digest(evidence) }, key: randomUUID() });
    }
    return { runId: lease.runId, rawExitCode: evidence.rawExitCode,
      status: unresolved ? "INCOMPLETE" : "RECORDED", evidence };
  }

  async retryThree(request, diagnostic) {
    const results = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.run(request, diagnostic);
      results.push(result);
      // An unresolved process cannot be safely replaced by the next retry.
      if (result.status === "INCOMPLETE") return { status: "INCOMPLETE", attempts: results };
    }
    return { status: "RECORDED", attempts: results, provenance: "not established by retry outcomes" };
  }

  async compareEarlier(request, comparison) {
    return this.run(request, null, comparison);
  }

  assessCompletion({ taskId, runId }) {
    const task = this.coordinator.assignedTask();
    requireValue(task.taskId === taskId, "completion task substitution denied");
    const run = this.coordinator.run(runId);
    requireValue(run.taskId === taskId && run.status === "finished" &&
      run.purpose === "required_tier_validation", "required run unavailable");
    requireValue(typeof this.host?.withFinalWriterLock === "function" &&
      typeof this.host?.readEvidence === "function", "completion capability unavailable");
      this.preflight({ taskId, planReference: task.planReference, env: {} });
      const evidence = this.host.readEvidence(run.evidence.reference);
      requireValue(!evidence?.then, "synchronous evidence reader required inside terminal transaction");
      requireValue(digest(evidence) === run.evidence.digest && evidence.runId === runId &&
        evidence.taskId === taskId && evidence.authorizationVersion === task.authorizationVersion,
      "swapped or stale run evidence");
      requireValue(evidence.integrity === "verified", "snapshot integrity unknown");
      const current = inputManifest({ root: this.root,
        exclusions: this.host.exclusions, environment: this.host.environment });
      const steps = evidence.steps.map((step) => {
        let report = null;
        if (step.kind === "test") {
          requireValue(step.report?.artifact, "test artifact missing");
          report = readVerifiedReport({ root: evidence.snapshotRoot,
            path: step.report.artifact.reference, digest: step.report.artifact.digest });
        }
        return { ...step, reportVerified: step.kind !== "test" || Boolean(report),
          tests: report?.tests, skipped: report?.skipped, failures: report?.failures ?? [],
          passedTests: report?.passedTests ?? [] };
      });
      return assessRun({ run: { ...evidence, steps }, tier: this.host.tiers[task.authorizedTier],
        authorization: task, currentSnapshotDigest: current.digest,
        catalog: this.host.currentCatalog?.() ?? [],
        now: new Date().toISOString().slice(0, 10),
        ownedRepairs: task.ownedRepairs ?? [], ignoredBaselineIds: task.ignoredBaselineIds ?? [],
        provenance: this.host.reviewedProvenance?.(runId) ?? [] });
  }

  async completion(request) {
    const run = this.coordinator.run(request.runId);
    requireValue(run.taskId === request.taskId && run.status === "finished" &&
      run.purpose === "required_tier_validation", "required run unavailable");
    requireValue(typeof this.host?.withFinalWriterLock === "function",
      "final writer coordination unavailable");
    return this.host.withFinalWriterLock(() => this.assessCompletion(request));
  }

  async terminate({ taskId, runId = null, status = "completed", approvalReference, key = randomUUID() }) {
    requireValue(typeof this.host?.withFinalWriterLock === "function" && this.coordinator.control,
      "terminal writer coordination unavailable");
    return this.host.withFinalWriterLock(() => {
      const task = this.coordinator.assignedTask();
      requireValue(task.taskId === taskId, "terminal task substitution denied");
      const previous = this.coordinator.control.complete;
      // The checker runs synchronously INSIDE terminate's SQLite transaction
      // while this same writer lock remains held, not against a cached PASS.
      this.coordinator.control.complete = ({ task: current, run }) => {
        requireValue(current.taskId === taskId && run.runId === runId,
          "terminal checker identity mismatch");
        const decision = this.assessCompletion({ taskId, runId });
        return { assessment: decision.status, writerCoordinationHeld: true };
      };
      try {
        return this.coordinator.terminate({ taskId, runId, status, approvalReference, key,
          expectedVersion: task.authorizationVersion });
      } finally {
        this.coordinator.control.complete = previous;
      }
    });
  }
}

export function candidateStatus() {
  return { version: 4, mode: "workflow", operational: false,
    activation: "BLOCKED: no usable designated project-local human-review decision source or accepted host control adapter is installed" };
}