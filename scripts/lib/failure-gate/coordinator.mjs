import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, readFileSync, lstatSync, existsSync, chmodSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { validateProjectPlan } from "./plan-guards.mjs";

// Workflow-local coordination, NOT an attestation service. The separately
// supplied control adapter resolves actual review references. There is no
// default approver, active task, or production activation.
export const digest = (value) => createHash("sha256").update(
  typeof value === "string" ? value : JSON.stringify(value),
).digest("hex");
const requireValue = (condition, message) => {
  if (!condition) throw new Error(`FAILURE-GATE BLOCKED: ${message}`);
};
const text = (value) => typeof value === "string" && value.length > 0 &&
  value.length <= 2048 && !/[\x00-\x1f]/.test(value);
const hash = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
const terminal = new Set(["completed", "failed", "cancelled"]);
const placeholder = (value) => !text(value) || /<[^>]+>|\b(FILL IN|TBD|TODO)\b/i.test(value);
const section = (content, heading) => {
  const headings = [...content.matchAll(/^## (.+?)\s*$/gm)];
  const index = headings.findIndex((match) => new RegExp(`^(?:${heading})$`).test(match[1]));
  if (index < 0) return null;
  const start = headings[index].index + headings[index][0].length;
  return content.slice(start, headings[index + 1]?.index ?? content.length);
};
const field = (content, name) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content?.match(new RegExp(`^\\*\\*${escaped}:\\*\\*\\s*(.*?)\\s*$`, "m"));
  return match?.[1]?.replace(/^`(.*)`$/, "$1") ?? null;
};

export class Coordinator {
  constructor({ directory, namespace, root, control = null, testPlanValidator = null }) {
    requireValue(text(namespace), "namespace required");
    requireValue(testPlanValidator === null ||
      (typeof testPlanValidator === "function" && Boolean(process.env.NODE_TEST_CONTEXT)),
    "fixture plan validator is available only inside the Node test harness");
    this.root = realpathSync(root);
    requireValue(typeof directory === "string", "durable directory required");
    const storage = resolve(directory);
    requireValue(!storage.split(sep).includes(".local"), "storage must be outside .local");
    mkdirSync(storage, { recursive: true, mode: 0o700 });
    requireValue(realpathSync(storage) === storage, "storage symlink is forbidden");
    this.namespace = namespace;
    this.control = control;
    this.testPlanValidator = testPlanValidator;
    this.identity = randomUUID();
    const databasePath = resolve(storage, "coordinator.sqlite");
    for (const name of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      requireValue(!existsSync(name) || (lstatSync(name).isFile() && !lstatSync(name).isSymbolicLink()),
        "database symlink or special file forbidden");
    }
    this.db = new Database(databasePath);
    chmodSync(databasePath, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = FULL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('draft','active','completed','failed','cancelled')),
        version INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assignment (singleton INTEGER PRIMARY KEY CHECK(singleton=1), task_id TEXT REFERENCES tasks(id));
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
        status TEXT NOT NULL CHECK(status IN ('running','finished','quarantined','stopped')),
        version INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_live_run ON runs(task_id) WHERE status IN ('running','quarantined');
      CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, subject TEXT NOT NULL, occurred TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (
        reference TEXT NOT NULL, action TEXT NOT NULL, subject_digest TEXT NOT NULL,
        reviewer TEXT NOT NULL, PRIMARY KEY(reference, action, subject_digest)
      );
      CREATE TABLE IF NOT EXISTS tier_status_history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id),
        authorization_version INTEGER NOT NULL, mapping_digest TEXT NOT NULL, statuses TEXT NOT NULL,
        occurred TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS diagnostics (
        initial_run TEXT NOT NULL REFERENCES runs(id), failure_digest TEXT NOT NULL,
        attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 3),
        PRIMARY KEY(initial_run, failure_digest)
      );
      CREATE TABLE IF NOT EXISTS comparisons (
        initial_run TEXT NOT NULL REFERENCES runs(id), failure_digest TEXT NOT NULL,
        capability_digest TEXT NOT NULL, attempt_limit INTEGER NOT NULL CHECK(attempt_limit BETWEEN 1 AND 10),
        attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 10),
        PRIMARY KEY(initial_run, failure_digest)
      );
      CREATE TRIGGER IF NOT EXISTS retain_ids BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'task tombstones are permanent'); END;
      CREATE TRIGGER IF NOT EXISTS retain_audit BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit history is permanent'); END;
      CREATE TRIGGER IF NOT EXISTS retain_tier_status_history BEFORE DELETE ON tier_status_history BEGIN SELECT RAISE(ABORT, 'tier status history is permanent'); END;
      CREATE TRIGGER IF NOT EXISTS retain_tier_status_updates BEFORE UPDATE ON tier_status_history BEGIN SELECT RAISE(ABORT, 'tier status history is append-only'); END;
    `);
    this.db.transaction(() => {
      for (const [key, value] of [["namespace", namespace], ["root", this.root], ["schema", "1"]]) {
        const existing = this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
        requireValue(!existing || existing.value === value, `${key} mismatch`);
        this.db.prepare("INSERT OR IGNORE INTO metadata VALUES (?,?)").run(key, value);
      }
    }).immediate();
  }

  close() { this.db.close(); }
  task(id) {
    const row = this.db.prepare("SELECT data FROM tasks WHERE id=?").get(id);
    requireValue(row, "unknown task");
    return JSON.parse(row.data);
  }
  run(id) {
    const row = this.db.prepare("SELECT data FROM runs WHERE id=?").get(id);
    requireValue(row, "unknown run");
    return JSON.parse(row.data);
  }
  audit() { return this.db.prepare("SELECT * FROM audit ORDER BY sequence").all(); }
  registeredTiers() {
    const manifestPath = resolve(this.root, "docs/validation/manifest.json");
    requireValue(existsSync(manifestPath) && lstatSync(manifestPath).isFile() &&
      realpathSync(manifestPath) === manifestPath && lstatSync(manifestPath).size <= 1024 * 1024,
    "registered tier manifest unavailable or unsafe");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const tiers = Object.keys(manifest?.tiers ?? {});
    requireValue(tiers.length > 0 && tiers.every(text) && new Set(tiers).size === tiers.length,
      "registered tier manifest is malformed");
    return tiers.sort();
  }
  tierStatuses(taskId) {
    const task = this.task(taskId);
    const allowed = task.status === "active" && !task.suspension && task.authorizedTier;
    return this.registeredTiers().map((tier) => {
      const status = allowed && tier === task.authorizedTier ? "ALLOWED" : "NOT ALLOWED";
      return {
        taskId: task.taskId, tier, status, authorizationStatus: status,
        executionStatus: status === "ALLOWED" ? "UNVERIFIED" : "BLOCKED",
        executionReason: status === "ALLOWED"
          ? "Read-only tier status does not verify current policy/tier/parameter digests, accepted host control, or assignment; checked execution preflight is required."
          : "This tier is not authorized by the current task mapping and state.",
      };
    });
  }
  tierStatusHistory(taskId) {
    this.task(taskId);
    return this.db.prepare("SELECT * FROM tier_status_history WHERE task_id=? ORDER BY sequence").all(taskId)
      .map((row) => ({ ...row, statuses: JSON.parse(row.statuses) }));
  }
  recordTierStatus(task) {
    const statuses = this.tierStatuses(task.taskId);
    const mappingDigest = digest({ taskId: task.taskId, authorizedTier: task.authorizedTier,
      status: task.status, suspension: task.suspension, authorizationVersion: task.authorizationVersion, statuses });
    this.db.prepare(`INSERT INTO tier_status_history
      (task_id,authorization_version,mapping_digest,statuses,occurred) VALUES (?,?,?,?,?)`)
      .run(task.taskId, task.authorizationVersion, mappingDigest, JSON.stringify(statuses), new Date().toISOString());
    this.event("tier-status-snapshot", JSON.stringify({ taskId: task.taskId,
      authorizationVersion: task.authorizationVersion, mappingDigest, statuses }));
    return statuses;
  }
  event(event, subject) {
    this.db.prepare("INSERT INTO audit(event,subject,occurred) VALUES (?,?,?)")
      .run(event, subject, new Date().toISOString());
  }
  mutate(key, operation, input, action) {
    requireValue(text(key), "idempotency key required");
    requireValue(JSON.stringify(input).length <= 2 * 1024 * 1024, "mutation exceeds input budget");
    const fingerprint = digest({ operation, input });
    try { return this.db.transaction(() => {
      const prior = this.db.prepare("SELECT * FROM requests WHERE key=?").get(key);
      if (prior) {
        requireValue(prior.digest === fingerprint, "idempotency key conflict");
        return JSON.parse(prior.result);
      }
      const result = action();
      this.event(operation, result.taskId ?? result.runId ?? result.id ?? this.namespace);
      this.db.prepare("INSERT INTO requests VALUES (?,?,?)").run(key, fingerprint, JSON.stringify(result));
      return result;
    }).immediate(); } catch (error) {
      // Never log input, plan contents, approval bodies, or exception strings.
      // Failed changes roll back first; denial is a separate durable event.
      this.db.transaction(() => this.event(`denied-${operation}`, this.namespace)).immediate();
      throw error;
    }
  }
  review(reference, action, subject) {
    requireValue(text(reference) && typeof this.control?.review === "function", "independent approval route unavailable");
    const subjectDigest = digest(subject);
    const evidence = this.control.review({ reference, action, subjectDigest, namespace: this.namespace });
    requireValue(evidence && evidence.reference === reference && evidence.action === action &&
      evidence.subjectDigest === subjectDigest && text(evidence.reviewer) &&
      evidence.namespace === this.namespace, "approval does not bind exact change");
    requireValue(this.db.inTransaction, "review must bind a transaction");
    this.db.prepare("INSERT OR IGNORE INTO approvals VALUES (?,?,?,?)")
      .run(reference, action, subjectDigest, evidence.reviewer);
    // Store references, not arbitrary conversation bodies or credentials.
    return { reference, action, subjectDigest, reviewer: evidence.reviewer, mode: "workflow" };
  }
  saveTask(task, expected) {
    const row = this.db.prepare("UPDATE tasks SET status=?,version=?,data=? WHERE id=? AND version=?")
      .run(task.status, task.authorizationVersion, JSON.stringify(task), task.taskId, expected);
    requireValue(row.changes === 1, "stale authorization version");
    return task;
  }
  idle(taskId) {
    requireValue(!this.db.prepare("SELECT id FROM runs WHERE task_id=? AND status IN ('running','quarantined')").get(taskId),
      "active or quarantined run prevents transition");
  }
  version(task, expected) {
    requireValue(task.authorizationVersion === expected, "stale authorization version");
    requireValue(!terminal.has(task.status), "terminal task cannot reopen");
  }
  plan(reference, content) {
    requireValue(text(reference) && !reference.split(/[\\/]/).includes(".."), "invalid plan reference");
    const path = resolve(this.root, reference);
    const rel = relative(this.root, path);
    requireValue(rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !rel.split(sep).includes(".local"),
      "plan must be durable and inside project");
    requireValue(realpathSync(path) === path && lstatSync(path).isFile(), "plan symlink or non-file");
    const actual = readFileSync(path, "utf8");
    requireValue(actual.length <= 1024 * 1024 && actual === content, "plan projection mismatch");
    return { planReference: rel, planContent: content, planDigest: digest(content) };
  }
  reserve({ externalTaskReference = null, key }) {
    requireValue(externalTaskReference === null || text(externalTaskReference), "invalid external task association");
    return this.mutate(key, "reserve", { externalTaskReference }, () => {
      const task = { taskId: `${this.namespace}:${randomUUID()}`, namespace: this.namespace,
        externalTaskReference, status: "draft", authorizationVersion: 0, authorizedTier: null,
        suspension: null, pendingChange: null };
      this.db.prepare("INSERT INTO tasks VALUES (?,?,?,?)").run(task.taskId, task.status, 0, JSON.stringify(task));
      return task;
    });
  }
  configuration(config) {
    requireValue(config && text(config.authorizedTier) && text(config.policyVersion) &&
      hash(config.policyDigest) && hash(config.tierDefinitionDigest) && hash(config.parametersDigest) &&
      Number.isSafeInteger(config.planVersion) && config.planVersion > 0, "malformed authorization configuration");
    const projection = this.plan(config.planReference, config.planContent);
    const projectGuards = this.testPlanValidator
      ? this.testPlanValidator(config) === true
      : validateProjectPlan({ root: this.root, planReference: projection.planReference,
        planContent: projection.planContent });
    const policyAccepted = typeof this.control?.validatePlan !== "function" ||
      this.control.validatePlan(config) === true;
    requireValue(projectGuards && policyAccepted, "plan guards or tier policy unavailable/rejected");
    return { ...projection,
      planVersion: config.planVersion, authorizedTier: config.authorizedTier,
      policyVersion: config.policyVersion, policyDigest: config.policyDigest,
      tierDefinitionDigest: config.tierDefinitionDigest, parametersDigest: config.parametersDigest };
  }
  validatePlanGuards(taskId, approved) {
    const identity = section(approved.planContent, "Task identity");
    const priorFailures = section(approved.planContent, "Pre-existing failures(?: to ignore)?");
    const validation = section(approved.planContent, "Validation");
    const regression = section(approved.planContent, "Regression Guard");
    requireValue(field(identity, "Task ID") === taskId, "plan must name its allocated local task ID");
    const materialityFields = [...(identity ?? "").matchAll(/^\*\*Materiality:\*\*\s*(.*?)\s*$/gm)]
      .map((match) => match[1].trim());
    const materiality = materialityFields[0] ?? null;
    requireValue(materialityFields.length <= 1 && (materiality === null ||
      ["material", "non-material"].includes(materiality.toLowerCase())),
      "Task identity Materiality must be exactly material or non-material");
    requireValue(priorFailures?.trim() && !placeholder(priorFailures.trim()),
      "pre-existing-failures section is missing or a placeholder");
    requireValue(field(validation, "Command") === approved.authorizedTier &&
      !placeholder(field(validation, "Why")) && !placeholder(field(validation, "Do not escalate")),
    "validation tier or plan guard fields are missing or contain placeholders");
    const titleLine = approved.planContent.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
    const titleIsDeletion = /^# DELETE -(?:\s|$)/.test(titleLine);
    const nonMaterial = materiality
      ? materiality.toLowerCase() === "non-material"
      : titleIsDeletion;
    const qualifies = !nonMaterial;
    const notApplicable = /^\s*\*\*N\/A\*\*/m.test(regression ?? "");
    if (notApplicable) {
      const reasons = [...(regression ?? "").matchAll(/^\*\*Why N\/A:\*\*\s*(.*?)\s*$/gm)]
        .map((match) => match[1].trim());
      requireValue(!qualifies && reasons.length === 1 && !placeholder(reasons[0]),
        "Regression Guard N/A requires a reviewed non-material classification and one specific reason");
    } else if (qualifies) {
      requireValue(regression && !placeholder(field(regression, "Covers")) &&
        !placeholder(field(regression, "Test location")) &&
        !placeholder(field(regression, "What it checks")),
      "material plan requires a complete Regression Guard");
    } else if (regression) {
      requireValue(!placeholder(field(regression, "Covers")) &&
        !placeholder(field(regression, "Test location")) &&
        !placeholder(field(regression, "What it checks")),
      "Regression Guard is incomplete or contains a placeholder");
    }
  }
  activate({ taskId, expectedVersion = 0, config, approvalReference, key }) {
    return this.mutate(key, "activate", { taskId, expectedVersion, config, approvalReference }, () => {
      const task = this.task(taskId);
      this.version(task, expectedVersion);
      requireValue(task.status === "draft", "only draft may activate");
      const approved = this.configuration(config);
      this.validatePlanGuards(taskId, approved);
      requireValue(this.registeredTiers().includes(approved.authorizedTier),
        "authorized tier is not currently registered");
      const approval = this.review(approvalReference, "activate", { taskId, expectedVersion, config: approved });
      const activated = this.saveTask({ ...task, ...approved, approval, status: "active",
        authorizationVersion: expectedVersion + 1 }, expectedVersion);
      this.recordTierStatus(activated);
      return activated;
    });
  }
  assign({ taskId, approvalReference, key }) {
    return this.mutate(key, "assign", { taskId, approvalReference }, () => {
      const task = this.task(taskId);
      requireValue(task.status === "active", "assignment requires active task");
      const old = this.db.prepare("SELECT task_id FROM assignment WHERE singleton=1").get();
      if (old?.task_id) this.idle(old.task_id);
      this.idle(taskId);
      this.review(approvalReference, "assign", { taskId, authorizationVersion: task.authorizationVersion });
      this.db.prepare("INSERT INTO assignment VALUES (1,?) ON CONFLICT(singleton) DO UPDATE SET task_id=excluded.task_id").run(taskId);
      return { taskId };
    });
  }
  assignedTask() {
    const row = this.db.prepare("SELECT task_id FROM assignment WHERE singleton=1").get();
    requireValue(row?.task_id, "coordinator assignment unavailable");
    return this.task(row.task_id);
  }
  requestChange({ taskId, expectedVersion, config, coverageInadequate = false, key }) {
    return this.mutate(key, "request-change", { taskId, expectedVersion, config, coverageInadequate }, () => {
      const task = this.task(taskId);
      this.version(task, expectedVersion); this.idle(taskId);
      requireValue(task.status === "active" && !task.pendingChange, "one pending change allowed on active task");
      // Proposed content need not have replaced the approved projection yet.
      requireValue(config && typeof config.planContent === "string", "proposed plan required");
      const updated = this.saveTask({ ...task, pendingChange: { id: randomUUID(), config, coverageInadequate },
        suspension: task.suspension ?? (coverageInadequate ? "coverage-inadequate" : null),
        authorizationVersion: expectedVersion + 1 }, expectedVersion);
      if (coverageInadequate) this.recordTierStatus(updated);
      return updated;
    });
  }
  resolveChange({ taskId, expectedVersion, accept, approvalReference, key }) {
    return this.mutate(key, "resolve-change", { taskId, expectedVersion, accept, approvalReference }, () => {
      const task = this.task(taskId);
      this.version(task, expectedVersion); this.idle(taskId);
      requireValue(task.pendingChange && typeof accept === "boolean", "pending change required");
      const update = accept ? this.configuration(task.pendingChange.config) : {};
      if (accept) this.validatePlanGuards(taskId, update);
      requireValue(!accept || update.planVersion > task.planVersion, "amendment must advance plan version");
      if (accept) requireValue(this.registeredTiers().includes(update.authorizedTier),
        "amended tier is not currently registered");
      const approval = this.review(approvalReference, accept ? "amend" : "reject",
        { taskId, expectedVersion, pendingChange: task.pendingChange });
      const updated = this.saveTask({ ...task, ...update, approval, pendingChange: null,
        // Rejecting or accepting a proposal never clears independent suspension.
        suspension: accept && task.suspension === "coverage-inadequate" ? null : task.suspension,
        authorizationVersion: expectedVersion + 1 }, expectedVersion);
      this.recordTierStatus(updated);
      return updated;
    });
  }
  suspend({ taskId, expectedVersion, reason, key }) {
    requireValue(text(reason), "suspension reason required");
    return this.mutate(key, "suspend", { taskId, expectedVersion, reason }, () => {
      const task = this.task(taskId);
      this.version(task, expectedVersion); this.idle(taskId);
      const updated = this.saveTask({ ...task, suspension: reason, authorizationVersion: expectedVersion + 1 }, expectedVersion);
      this.recordTierStatus(updated);
      return updated;
    });
  }
  resume({ taskId, expectedVersion, approvalReference, key }) {
    return this.mutate(key, "resume", { taskId, expectedVersion, approvalReference }, () => {
      const task = this.task(taskId);
      this.version(task, expectedVersion); this.idle(taskId);
      requireValue(task.suspension && !task.pendingChange, "unresolved change or no suspension");
      this.plan(task.planReference, task.planContent);
      this.review(approvalReference, "resume", { taskId, expectedVersion, suspension: task.suspension });
      const updated = this.saveTask({ ...task, suspension: null, authorizationVersion: expectedVersion + 1 }, expectedVersion);
      this.recordTierStatus(updated);
      return updated;
    });
  }
  startRun({ taskId, expectedVersion, planReference, policyDigest, tierDefinitionDigest,
    parametersDigest, purpose = "required_tier_validation", diagnostic = null, comparison = null, processIdentity, key }) {
    const input = { taskId, expectedVersion, planReference, policyDigest, tierDefinitionDigest, parametersDigest, purpose, diagnostic, comparison, processIdentity };
    try {
      return this.mutate(key, "start-run", input, () => {
        const task = this.assignedTask();
        requireValue(task.taskId === taskId, "task substitution denied");
        this.version(task, expectedVersion); this.idle(taskId);
        requireValue(task.status === "active" && !task.suspension, "task is not runnable");
        requireValue(this.tierStatuses(task.taskId).some(({ tier, status }) =>
           tier === task.authorizedTier && status === "ALLOWED"), "task has no currently allowed tier");
        requireValue(planReference === task.planReference && policyDigest === task.policyDigest &&
          tierDefinitionDigest === task.tierDefinitionDigest && parametersDigest === task.parametersDigest,
        "plan, policy, tier, or parameter mismatch");
        this.plan(task.planReference, task.planContent);
        requireValue(["required_tier_validation", "diagnostic_retry", "provenance_comparison"].includes(purpose), "unsupported run purpose");
        let attempt = null;
        let comparisonAttempt = null;
        if (purpose === "diagnostic_retry") {
          requireValue(comparison === null, "diagnostic cannot substitute comparison");
          requireValue(diagnostic && text(diagnostic.initialRunId) && hash(diagnostic.failureDigest) &&
            hash(diagnostic.selectorDigest), "bounded diagnostic identity required");
          const initial = this.run(diagnostic.initialRunId);
          requireValue(initial.taskId === taskId && initial.status === "finished" &&
            initial.purpose === "required_tier_validation" && initial.authorizationVersion === expectedVersion,
          "diagnostic requires applicable initial full-tier run");
          // Adapter reads retained machine evidence and registered safe isolation
          // policy. A caller failure flag or selector string never authorizes it.
          const capability = this.control?.diagnostic?.({ task, initial, diagnostic });
          requireValue(capability?.safe === true && hash(capability.capabilityDigest) &&
            capability.failureDigest === diagnostic.failureDigest &&
            capability.selectorDigest === diagnostic.selectorDigest,
          "registered diagnostic capability or observed failure unavailable");
          const counter = this.db.prepare("SELECT attempts FROM diagnostics WHERE initial_run=? AND failure_digest=?")
            .get(initial.runId, diagnostic.failureDigest);
          attempt = (counter?.attempts ?? 0) + 1;
          requireValue(attempt <= 3, "exactly three diagnostic retries permitted");
          this.db.prepare(`INSERT INTO diagnostics VALUES (?,?,?)
            ON CONFLICT(initial_run,failure_digest) DO UPDATE SET attempts=excluded.attempts`)
            .run(initial.runId, diagnostic.failureDigest, attempt);
        } else if (purpose === "provenance_comparison") {
          requireValue(diagnostic === null && comparison && text(comparison.initialRunId) &&
            ["failureDigest", "selectorDigest", "earlierSnapshotDigest", "environmentDigest"].every((field) => hash(comparison[field])),
          "bounded comparison identities required");
          const initial = this.run(comparison.initialRunId);
          requireValue(initial.taskId === taskId && initial.status === "finished" &&
            initial.purpose === "required_tier_validation" && initial.authorizationVersion === expectedVersion,
          "comparison requires applicable initial full-tier run");
          // Independent adapter verifies the earlier isolated snapshot, actual
          // environment, observed failure, and registered comparison commands.
          // Passing booleans in the request cannot replace that verification.
          const capability = this.control?.comparison?.({ task, initial, comparison });
          requireValue(capability?.safe === true && capability.verifiedEarlierUnaffected === true &&
            capability.environmentApplicable === true && hash(capability.capabilityDigest) &&
            Number.isSafeInteger(capability.maxAttempts) && capability.maxAttempts >= 1 && capability.maxAttempts <= 10 &&
            ["failureDigest", "selectorDigest", "earlierSnapshotDigest", "environmentDigest"]
              .every((field) => capability[field] === comparison[field]),
          "verified bounded comparison capability unavailable");
          const counter = this.db.prepare("SELECT * FROM comparisons WHERE initial_run=? AND failure_digest=?")
            .get(initial.runId, comparison.failureDigest);
          requireValue(!counter || (counter.capability_digest === capability.capabilityDigest &&
            counter.attempt_limit === capability.maxAttempts), "comparison capability changed");
          comparisonAttempt = (counter?.attempts ?? 0) + 1;
          requireValue(comparisonAttempt <= capability.maxAttempts, "comparison attempt limit exhausted");
          this.db.prepare(`INSERT INTO comparisons VALUES (?,?,?,?,?)
            ON CONFLICT(initial_run,failure_digest) DO UPDATE SET attempts=excluded.attempts`)
            .run(initial.runId, comparison.failureDigest, capability.capabilityDigest, capability.maxAttempts, comparisonAttempt);
        } else {
          requireValue(diagnostic === null, "required tier cannot use diagnostic selector");
          requireValue(comparison === null, "required tier cannot use comparison selector");
        }
        requireValue(processIdentity && Number.isSafeInteger(processIdentity.pid) && processIdentity.pid > 0 &&
          text(processIdentity.startIdentity), "process identity required");
        const run = { ...input, runId: randomUUID(), namespace: this.namespace, coordinatorIdentity: this.identity,
          status: "running", leaseVersion: 1, startedAt: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(), authorizationVersion: task.authorizationVersion,
          planDigest: task.planDigest, authorizedTier: task.authorizedTier, diagnosticAttempt: attempt, comparisonAttempt };
        this.db.prepare("INSERT INTO runs VALUES (?,?,?,?,?)").run(run.runId, taskId, run.status, 1, JSON.stringify(run));
        return run;
      });
    } catch (error) {
      this.db.transaction(() => this.event("denied-launch", this.namespace)).immediate();
      throw error;
    }
  }
  saveRun(run, version) {
    const result = this.db.prepare("UPDATE runs SET status=?,version=?,data=? WHERE id=? AND version=?")
      .run(run.status, run.leaseVersion, JSON.stringify(run), run.runId, version);
    requireValue(result.changes === 1, "stale lease version");
    return run;
  }
  heartbeat({ runId, expectedVersion, key }) {
    return this.mutate(key, "heartbeat", { runId, expectedVersion }, () => {
      const run = this.run(runId);
      requireValue(run.status === "running" && run.coordinatorIdentity === this.identity &&
        run.leaseVersion === expectedVersion, "lease owner/version mismatch");
      return this.saveRun({ ...run, leaseVersion: expectedVersion + 1, heartbeatAt: new Date().toISOString() }, expectedVersion);
    });
  }
  finishRun({ runId, expectedVersion, evidence, key }) {
    return this.mutate(key, "finish-run", { runId, expectedVersion, evidence }, () => {
      const run = this.run(runId);
      requireValue(run.status === "running" && run.coordinatorIdentity === this.identity &&
        run.leaseVersion === expectedVersion, "lease owner/version mismatch");
      requireValue(evidence && hash(evidence.digest) && text(evidence.reference), "bounded evidence reference required");
      return this.saveRun({ ...run, status: "finished", evidence, finishedAt: new Date().toISOString(),
        leaseVersion: expectedVersion + 1 }, expectedVersion);
    });
  }
  recover({ runId, expectedVersion, approvalReference, key }) {
    return this.mutate(key, "recover", { runId, expectedVersion, approvalReference }, () => {
      const run = this.run(runId);
      requireValue(["running", "quarantined"].includes(run.status) && run.leaseVersion === expectedVersion, "not a recoverable lease");
      this.review(approvalReference, "recover", { runId, expectedVersion, processIdentity: run.processIdentity });
      // Only a host adapter which verifies process start identity can confirm stop.
      // An elapsed timer, PID alone, or a caller flag is never enough.
      const stopped = this.control?.processStopped?.(run.processIdentity) === true;
      return this.saveRun({ ...run, status: stopped ? "stopped" : "quarantined",
        leaseVersion: expectedVersion + 1 }, expectedVersion);
    });
  }
  terminate({ taskId, expectedVersion, status, approvalReference, runId = null, key }) {
    requireValue(terminal.has(status), "invalid terminal state");
    return this.mutate(key, "terminate", { taskId, expectedVersion, status, approvalReference, runId }, () => {
      const task = this.task(taskId);
      this.version(task, expectedVersion); this.idle(taskId);
      if (status === "completed") {
        requireValue(this.assignedTask().taskId === taskId && task.status === "active" && !task.suspension &&
          !task.pendingChange, "completion requires assigned active authorization");
        const run = this.run(runId);
        requireValue(run.taskId === taskId && run.status === "finished" &&
          run.purpose === "required_tier_validation" && run.authorizationVersion === expectedVersion,
        "completion run is not applicable");
        this.plan(task.planReference, task.planContent);
        requireValue(typeof this.control?.complete === "function", "completion checker unavailable");
        // The adapter must hold snapshot/writer coordination through this entire
        // transaction; checking hashes in an uncontrolled worktree is insufficient.
        const decision = this.control.complete({ task, run });
        requireValue(decision?.writerCoordinationHeld === true &&
          ["PASS", "ACCEPTABLE_WITH_IGNORED_FAILURES"].includes(decision.assessment),
        "completion evidence rejected");
      } else {
        this.review(approvalReference, "terminate", { taskId, expectedVersion, status });
      }
      this.db.prepare("DELETE FROM assignment WHERE task_id=?").run(taskId);
      const updated = this.saveTask({ ...task, status, authorizedTier: null, pendingChange: null,
        authorizationVersion: expectedVersion + 1 }, expectedVersion);
      this.recordTierStatus(updated);
      return updated;
    });
  }
}