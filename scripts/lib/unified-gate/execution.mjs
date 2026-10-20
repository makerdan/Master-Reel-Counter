import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runOwnedProcessGroup } from "../owned-process-group.mjs";
import { guard, baselineWarnings, classifyFailure } from "./plans.mjs";
import { invariant, digest, hash, git, tierDefinition, safePath, taskState,
  append, saveRegistry, withWriter } from "./store.mjs";

// Hash source bytes/changes, not host identity. Exclude only gate-owned evidence
// and environment-local outputs. Ignored build/test outputs do not change it.
export function target(root) {
  const head = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  const paths = [...new Set(git(root,
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).stdout.split("\0")
    .filter(Boolean).filter((p) => p !== "docs/validation/unified-registry.json"))].sort();
  const files = paths.map((path) => {
    const file = safePath(root, path);
    return { path, hash: existsSync(file) ? hash(readFileSync(file)) : "deleted" };
  });
  return { head, filesHash: digest(files) };
}
async function boundedStep(root, step, timeoutMs, outerSignal, logPath, context) {
  const started = Date.now();
  const controller = new AbortController();
  let timeout = false;
  const timer = setTimeout(() => { timeout = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  outerSignal.addEventListener("abort", abort, { once: true });
  const output = [];
  let bytes = 0, truncated = false;
  const capture = (buffer) => {
    bytes += buffer.length;
    if (bytes <= 1_000_000) output.push(buffer);
    else truncated = true;
  };
  let result;
  try {
    if (outerSignal.aborted) controller.abort();
    // The detached step supervisor keeps its own deadline/cleanup monitor even
    // if the top-level runner is killed. It cannot admit tasks or publish PASS.
    const owned = await runOwnedProcessGroup(process.execPath,
      [resolve(root, "scripts/unified-step.mjs"), String(timeoutMs), JSON.stringify(step.command)], {
      cwd: root, env: { ...process.env, TASK_PLAN_FILE: "", TASK_ID: "",
        UNIFIED_TASK_ID: context.id, UNIFIED_TASK_PLAN_FILE: context.planPath,
        UNIFIED_PLAN_REVISION: String(context.revision) },
      signal: controller.signal, terminationGraceMs: 250, terminationWaitMs: 1500,
      onOutput: capture,
    });
    if (owned.status === 124) timeout = true;
    result = { code: owned.status, signal: owned.childSignal, cleanupComplete: owned.groupGone };
  } catch (error) {
    result = { code: null, error: error.message, cleanupComplete: false };
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener("abort", abort);
  }
  // Keep bounded, pattern-redacted diagnostics, never read secret env values.
  const captured = Buffer.concat(output);
  const excerpt = captured.toString("utf8")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|pk)_(?:live_|test_|proj-)?[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, "$1[REDACTED]@")
    .slice(-8000);
  const observation = { name: step.name, kind: step.kind, command: step.command,
    ...result, durationMs: Date.now() - started, timedOut: timeout,
    interrupted: outerSignal.aborted, truncated, outputBytes: bytes, outputHash: hash(captured), outputExcerpt: excerpt,
    result: result.error || !result.cleanupComplete || timeout || outerSignal.aborted || truncated ? "INCOMPLETE"
      : result.code === 125 ? "BLOCKED"
      : result.code === 0 ? "PASS" : "FAIL" };
  appendFileSync(logPath, JSON.stringify(observation) + "\n");
  return observation;
}
export async function run(root, context, { stepName, recoverOnly = false } = {}) {
  return withWriter(root, async (registry) => {
    let state = guard(root, context, registry, { allowUnresolvedRun: true }); // Before any workload.
    if (state.runs.at(-1)?.state === "RUNNING") {
      invariant(recoverOnly, "previous run unresolved; use --recover after its bounded deadline");
      invariant(Date.now() > Date.parse(state.runs.at(-1).cleanupDeadline),
        "previous supervised workload may still be stopping; bounded deadline has not elapsed");
      // Exclusive writer lock + elapsed independent step-supervisor deadline.
      // No workspace receipt or copied PID is used as task authority.
      const runs = structuredClone(state.runs);
      runs.at(-1).state = "INCOMPLETE";
      runs.at(-1).reason = "previous runner stopped without a trustworthy terminal result";
      append(registry, { ...state, runs }, "run"); saveRegistry(root, registry);
      return runs.at(-1);
    }
    invariant(!recoverOnly, "no unresolved run to recover");
    const definition = tierDefinition(root, state.tier);
    const steps = stepName ? definition.steps.filter((s) => s.name === stepName && s.kind === "test") : definition.steps;
    invariant(steps.length > 0, "diagnostic step is not a registered test in the bound tier");
    const runId = randomUUID(); // Run identity, not a task ID.
    const evidencePath = `.local/failure-gate-unified/runs/${runId}.jsonl`;
    const path = safePath(root, evidencePath); mkdirSync(dirname(path), { recursive: true });
    const before = target(root);
    const entry = { id: runId, purpose: stepName ? "diagnostic" : "bound-tier",
      state: "RUNNING", revision: state.revision, pin: state.pin, tier: state.tier,
      planHash: state.planHash, workloadHash: state.workloadHash, target: before,
      startedAt: new Date().toISOString(),
      cleanupDeadline: new Date(Date.now() + definition.timeoutMs + 3000).toISOString(),
      evidencePath, observations: [] };
    append(registry, { ...state, runs: [...state.runs, entry] }, "run"); saveRegistry(root, registry);
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.once("SIGTERM", onSignal); process.once("SIGINT", onSignal);
    const start = Date.now();
    let final;
    try {
      for (const warning of baselineWarnings(root)) console.warn("[baseline warning]", JSON.stringify(warning));
      for (const step of steps) {
        const left = definition.timeoutMs - (Date.now() - start);
        if (left <= 0 || controller.signal.aborted) break;
        const result = await boundedStep(root, step, left, controller.signal, path, state);
        entry.observations.push(result);
        if (result.result !== "PASS") break;
      }
      const names = new Set(entry.observations.map((r) => r.name));
      entry.notReached = steps.filter((s) => !names.has(s.name)).map((s) => s.name);
      const after = target(root);
      guard(root, context, registry, { allowUnresolvedRun: true });
      const changed = before.filesHash !== after.filesHash;
      const incomplete = changed || controller.signal.aborted || entry.notReached.length > 0 ||
        entry.observations.some((r) => r.result === "INCOMPLETE");
      // A raw failure is not silently baseline-waived. Aggregate test output
      // does not establish exact suite/test/signature identity.
      const failed = entry.observations.some((r) => r.result === "FAIL");
      const blocked = entry.observations.some((r) => r.result === "BLOCKED");
      final = changed || entry.observations.some((r) => r.result === "INCOMPLETE") || controller.signal.aborted
        ? "INCOMPLETE" : blocked ? "BLOCKED" : failed ? "FAIL" : incomplete || stepName ? "INCOMPLETE" : "PASS";
      entry.targetAfter = after;
      entry.reason = stepName ? "filtered diagnostic cannot satisfy full-tier completion"
        : changed ? "tested source changed during execution" : undefined;
      if (entry.reason === undefined) delete entry.reason;
    } catch (error) {
      final = "BLOCKED"; entry.reason = error.message;
    } finally {
      process.removeListener("SIGTERM", onSignal); process.removeListener("SIGINT", onSignal);
    }
    entry.state = final; entry.finishedAt = new Date().toISOString();
    append(registry, { ...state, runs: [...state.runs, entry] }, "run"); saveRegistry(root, registry);
    return entry;
  });
}
export async function classificationLog(root, context, observation, evidence) {
  return withWriter(root, (registry) => {
    const state = guard(root, context, registry);
    const result = classifyFailure(root, state, observation, evidence);
    const entry = { id: randomUUID(), purpose: "classification", state: "RUNNING",
      revision: state.revision, pin: state.pin, tier: state.tier, planHash: state.planHash,
      workloadHash: state.workloadHash, observation };
    append(registry, { ...state, runs: [...state.runs, entry] }, "run"); saveRegistry(root, registry);
    const finished = { ...entry, state: "INCOMPLETE", classification: result,
      reason: "classification is not required-tier validation or proof of PASS" };
    append(registry, { ...state, runs: [...state.runs, finished] }, "run"); saveRegistry(root, registry);
    if (result.log) console.log(result.log);
    return finished;
  });
}
