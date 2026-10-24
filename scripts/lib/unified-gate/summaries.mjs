import { constants, openSync, closeSync, readFileSync, writeFileSync, fsyncSync,
  mkdirSync, lstatSync, opendirSync, renameSync, unlinkSync, chmodSync, readSync, fstatSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { release } from "node:os";
import Database from "better-sqlite3";
import { safePath, digest, hash, git, UUID, TIERS } from "./store.mjs";

// Derived, disposable reports only. Never read output, commands, reasons or env.
export const SUMMARY_DIRECTORY = ".local/failure-gate-unified/summaries";
export const SUMMARY_LIMIT = 100;
export const SUMMARY_BYTES = 65536;
const AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_STEPS = 100;
const HEX = /^[a-f0-9]{64}$/;
const STATES = ["PASS", "FAIL", "BLOCKED", "INCOMPLETE"];
const KINDS = ["test", "typecheck", "lint", "audit", "smoke", "harness"];
const WARNING = "Local validation summary unavailable or incomplete; authoritative validation result is unchanged.";
const bool = (v) => typeof v === "boolean";
const duration = (v) => v === null || (Number.isSafeInteger(v) && v >= 0);
const date = (v) => typeof v === "string" && new Date(v).toISOString() === v;
const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).sort().join() === [...keys].sort().join();
function requireThat(ok) { if (!ok) throw new Error("invalid derived summary"); }
function stepsOf(steps) {
  return steps.slice(0, MAX_STEPS).map((s, index) => ({
    key: digest({ index, name: s.name, kind: s.kind }),
    // Labels are identifiers, not arbitrary console text. Unsafe names get a hash.
    label: /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(s.name) ? s.name : `step-${index + 1}`,
    kind: s.kind,
  }));
}
export function reportingContext(root, definition) {
  const lock = safePath(root, "package-lock.json");
  let dependencyLock = null;
  try { dependencyLock = hash(readFileSync(lock)); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    runtime: {
      node: process.versions.node, platform: process.platform, arch: process.arch,
      osReleaseHash: hash(release()), dependencyLock,
      // A changed runner is not assumed to have equivalent comparison semantics.
      implementation: digest(["execution.mjs", "summaries.mjs", "retry.mjs"].map((name) =>
        hash(readFileSync(safePath(root, `scripts/lib/unified-gate/${name}`))))),
    },
    dirty: git(root, ["status", "--porcelain", "--untracked-files=normal"]).stdout
      .split("\n").some((line) => line && line.slice(3) !== "docs/validation/unified-registry.json"),
    steps: stepsOf(definition.steps), omittedSteps: Math.max(0, definition.steps.length - MAX_STEPS),
  };
}
export function deriveSummary(entry, { recovered = false } = {}) {
  const context = entry.reportingContext;
  requireThat(context && STATES.includes(entry.state) && UUID.test(entry.taskId));
  const observations = entry.observations ?? [];
  const steps = context.steps.map((step) => {
    const observation = observations.find((o) => digest({
      index: context.steps.indexOf(step), name: o.name, kind: o.kind,
    }) === step.key);
    return { ...step, outcome: observation?.result ?? "NOT_REACHED",
      durationMs: Number.isSafeInteger(observation?.durationMs) ? observation.durationMs : null,
      timedOut: observation?.timedOut === true, interrupted: observation?.interrupted === true,
      trustworthy: !!observation && observation.cleanupComplete === true &&
        !observation.truncated && !observation.error && observation.dispatched !== false };
  });
  const summary = {
    schemaVersion: 1, comparisonVersion: 1, runId: entry.id, taskId: entry.taskId,
    revision: entry.revision, planHash: entry.planHash, contract: entry.pin,
    tier: entry.tier, workload: entry.workloadHash, purpose: entry.purpose,
    state: entry.state, startedAt: entry.startedAt, finishedAt: entry.finishedAt,
    source: { revision: entry.target?.head ?? null, fingerprint: entry.target?.filesHash ?? null,
      dirty: context.dirty,
      changed: !entry.targetAfter || entry.target?.head !== entry.targetAfter.head ||
        entry.target?.filesHash !== entry.targetAfter.filesHash },
    runtime: context.runtime, steps, omittedSteps: context.omittedSteps,
    recovered, timedOut: steps.some((s) => s.timedOut),
    interrupted: recovered || entry.interrupted === true || steps.some((s) => s.interrupted),
    durationMs: Math.max(0, Date.parse(entry.finishedAt) - Date.parse(entry.startedAt)),
    evidencePath: `.local/failure-gate-unified/runs/${entry.id}.jsonl`,
  };
  validateSummary(summary);
  return summary;
}

// Strict shape validation prevents future/unknown applicability fields or injected
// report text from being treated as comparable evidence or rendered to operators.
export function validateSummary(s) {
  requireThat(exact(s, ["schemaVersion", "comparisonVersion", "runId", "taskId", "revision",
    "planHash", "contract", "tier", "workload", "purpose", "state", "startedAt", "finishedAt",
    "source", "runtime", "steps", "omittedSteps", "recovered", "timedOut", "interrupted",
    "durationMs", "evidencePath"]));
  requireThat(s.schemaVersion === 1 && s.comparisonVersion === 1 && UUID.test(s.runId) &&
    UUID.test(s.taskId) && Number.isSafeInteger(s.revision) && s.revision > 0 &&
    [s.planHash, s.contract, s.workload].every((v) => HEX.test(v)) &&
    TIERS.includes(s.tier) && ["bound-tier", "diagnostic"].includes(s.purpose) &&
    STATES.includes(s.state) && date(s.startedAt) && date(s.finishedAt) &&
    Date.parse(s.finishedAt) >= Date.parse(s.startedAt) &&
    s.evidencePath === `.local/failure-gate-unified/runs/${s.runId}.jsonl`);
  requireThat(exact(s.source, ["revision", "fingerprint", "dirty", "changed"]) &&
    /^[a-f0-9]{40,64}$/.test(s.source.revision) && HEX.test(s.source.fingerprint) &&
    bool(s.source.dirty) && bool(s.source.changed));
  requireThat(exact(s.runtime, ["node", "platform", "arch", "osReleaseHash", "dependencyLock", "implementation"]) &&
    /^\d+\.\d+\.\d+$/.test(s.runtime.node) &&
    /^(linux|darwin|win32|aix|freebsd|openbsd|sunos|android)$/.test(s.runtime.platform) &&
    /^(x64|arm64|arm|ia32|ppc64|s390x|riscv64|loong64)$/.test(s.runtime.arch) &&
    [s.runtime.osReleaseHash, s.runtime.implementation].every((v) => HEX.test(v)) &&
    (s.runtime.dependencyLock === null || HEX.test(s.runtime.dependencyLock)));
  requireThat(Array.isArray(s.steps) && s.steps.length <= MAX_STEPS &&
    Number.isSafeInteger(s.omittedSteps) && s.omittedSteps >= 0 &&
    [s.recovered, s.timedOut, s.interrupted].every(bool) && duration(s.durationMs));
  const keys = new Set();
  for (const step of s.steps) {
    requireThat(exact(step, ["key", "label", "kind", "outcome", "durationMs",
      "timedOut", "interrupted", "trustworthy"]) &&
      HEX.test(step.key) && !keys.has(step.key) &&
      /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(step.label) && KINDS.includes(step.kind) &&
      [...STATES, "NOT_REACHED"].includes(step.outcome) && duration(step.durationMs) &&
      [step.timedOut, step.interrupted, step.trustworthy].every(bool));
    keys.add(step.key);
  }
  return s;
}
export function eligibility(s) {
  try { validateSummary(s); } catch { return "missing or unsupported applicability data"; }
  if (s.purpose !== "bound-tier") return "diagnostic/filtered workload";
  if (!["PASS", "FAIL"].includes(s.state)) return "not a terminal PASS/FAIL workload";
  if (s.recovered || s.interrupted || s.timedOut) return "interrupted, recovered or timed-out workload";
  if (s.source.changed) return "source changed or completion target unavailable";
  if (s.omittedSteps || !s.steps.length) return "step detail omitted";
  const executed = s.steps.filter((step) => step.outcome !== "NOT_REACHED");
  if (executed.some((step) => !step.trustworthy || step.timedOut || step.interrupted ||
    step.durationMs === null || !["PASS", "FAIL"].includes(step.outcome))) return "untrustworthy step observations";
  const failure = s.steps.findIndex((step) => step.outcome === "FAIL");
  if (s.state === "PASS" && s.steps.some((step) => step.outcome !== "PASS"))
    return "incomplete PASS observations";
  if (s.state === "FAIL" && (failure < 0 || s.steps.some((step, i) =>
    step.outcome !== (i < failure ? "PASS" : i === failure ? "FAIL" : "NOT_REACHED"))))
    return "incomplete FAIL observations";
  return null;
}
export function compareSummaries(current, history) {
  const result = { informational: true, currentRun: current.runId, priorRun: null,
    message: "No comparable prior run", reasons: [], transitions: [], timing: [] };
  const invalid = eligibility(current);
  if (invalid) { result.reasons.push(`current run: ${invalid}`); return result; }
  const usable = history.filter((prior) => {
    try { validateSummary(prior); return true; }
    catch {
      if (!result.reasons.includes("missing or unsupported applicability data"))
        result.reasons.push("missing or unsupported applicability data");
      return false;
    }
  });
  for (const prior of usable.sort(order)) {
    if (prior.runId === current.runId || Date.parse(prior.finishedAt) > Date.parse(current.startedAt)) continue;
    const invalidPrior = eligibility(prior);
    const mismatch = invalidPrior ?? (
      prior.tier !== current.tier ? "tier differs" :
      prior.workload !== current.workload ? "workload fingerprint differs" :
      prior.contract !== current.contract ? "gate contract differs" :
      digest(prior.runtime) !== digest(current.runtime) ? "runtime/environment profile differs" :
      digest(prior.steps.map(({ key, kind }) => ({ key, kind }))) !==
        digest(current.steps.map(({ key, kind }) => ({ key, kind }))) ? "step identity differs" : null);
    if (mismatch) { if (!result.reasons.includes(mismatch)) result.reasons.push(mismatch); continue; }
    result.priorRun = prior.runId;
    result.message = "Observed step comparison";
    result.reasons = [];
    for (const step of current.steps) {
      const before = prior.steps.find((p) => p.key === step.key);
      if (step.outcome === "NOT_REACHED" || before.outcome === "NOT_REACHED") {
        result.transitions.push({ step: step.label, prior: before.outcome, current: step.outcome,
          change: "unknown/not reached" });
        continue;
      }
      result.transitions.push({ step: step.label, prior: before.outcome, current: step.outcome,
        change: step.outcome === "FAIL" ? before.outcome === "FAIL"
          ? "repeated step failure" : "newly observed failed step"
          : before.outcome === "FAIL" ? "previously failing step now passing" : "unchanged passing step" });
      result.timing.push({ step: step.label, priorMs: before.durationMs, currentMs: step.durationMs,
        deltaMs: step.durationMs - before.durationMs });
    }
    return result;
  }
  if (!result.reasons.length) result.reasons.push("no retained earlier eligible history");
  return result;
}
const order = (a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.runId.localeCompare(a.runId);
function readRecord(root, name) {
  requireThat(UUID.test(name.slice(0, -5)) && name.endsWith(".json"));
  const path = safePath(root, `${SUMMARY_DIRECTORY}/${name}`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    requireThat(stat.isFile() && stat.size <= SUMMARY_BYTES && (stat.mode & 0o077) === 0);
    // Read at most limit+1 even if a file grows after stat.
    const buffer = Buffer.alloc(SUMMARY_BYTES + 1);
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    requireThat(bytes <= SUMMARY_BYTES);
    const record = validateSummary(JSON.parse(buffer.subarray(0, bytes).toString("utf8")));
    requireThat(name === `${record.runId}.json`);
    return record;
  } finally { closeSync(fd); }
}
function scan(root, now) {
  const records = [], warnings = [];
  let directory;
  try { directory = opendirSync(safePath(root, SUMMARY_DIRECTORY)); }
  catch (error) {
    if (error.code !== "ENOENT") warnings.push(WARNING);
    return { records, warnings };
  }
  try {
    for (let i = 0; ; i++) {
      const file = directory.readSync();
      if (!file) break;
      requireThat(i < 512); // Also bounds hostile directory enumeration.
      if (!/^[a-f0-9-]{36}\.json$/.test(file.name)) continue;
      try {
        const record = readRecord(root, file.name);
        if (Date.parse(record.finishedAt) > now) warnings.push(WARNING);
        else records.push(record);
      } catch { warnings.push(WARNING); }
    }
  } catch { warnings.push(WARNING); }
  finally { directory.closeSync(); }
  return { records: records.sort(order), warnings: [...new Set(warnings)] };
}
export function summaryHistory(root, { runId, limit = 10, now = Date.now() } = {}) {
  requireThat(Number.isInteger(limit) && limit > 0 && limit <= SUMMARY_LIMIT);
  requireThat(runId === undefined || UUID.test(runId));
  const { records, warnings } = scan(root, now);
  const retained = records.filter((s) => now - Date.parse(s.finishedAt) <= AGE_MS).slice(0, SUMMARY_LIMIT);
  const selected = runId ? retained.find((s) => s.runId === runId) : retained[0];
  return { schemaVersion: 1, informational: true, warnings,
    message: selected ? "Local derived history; not acceptance or failure-ignore evidence"
      : "No local summary available; isolated environments start without history",
    records: retained.slice(0, limit),
    comparison: selected ? compareSummaries(selected, retained) : null };
}
// A separate local mutex coordinates ONLY derived retention and atomic writes.
// It never reserves identities or changes the authoritative registry.
export function saveSummary(root, summary, now = Date.now()) {
  validateSummary(summary);
  requireThat(Date.parse(summary.finishedAt) <= now);
  const directory = safePath(root, SUMMARY_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const lock = safePath(root, `${SUMMARY_DIRECTORY}/retention.sqlite`);
  const fd = openSync(lock, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  closeSync(fd);
  chmodSync(lock, 0o600);
  const db = new Database(lock, { timeout: 500 });
  let temp;
  try {
    db.exec("BEGIN IMMEDIATE");
    const scanned = scan(root, now);
    requireThat(!scanned.warnings.length);
    const records = scanned.records.filter((s) => s.runId !== summary.runId);
    const comparison = compareSummaries(summary, records.filter((s) =>
      now - Date.parse(s.finishedAt) <= AGE_MS).slice(0, SUMMARY_LIMIT));
    const bytes = JSON.stringify(summary) + "\n";
    requireThat(Buffer.byteLength(bytes) <= SUMMARY_BYTES);
    // Reserve a slot before writing, so even a failed unlink/write cannot grow
    // the owned record set beyond the count bound.
    const all = [summary, ...records].sort(order);
    const keep = new Set(all.filter((s) => now - Date.parse(s.finishedAt) <= AGE_MS)
      .slice(0, SUMMARY_LIMIT).map((s) => s.runId));
    for (const record of records) if (!keep.has(record.runId))
      unlinkSync(safePath(root, `${SUMMARY_DIRECTORY}/${record.runId}.json`));
    if (!keep.has(summary.runId)) return comparison;
    temp = `${directory}/${summary.runId}.${randomUUID()}.tmp`;
    const handle = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(handle, bytes); fsyncSync(handle); } finally { closeSync(handle); }
    const destination = safePath(root, `${SUMMARY_DIRECTORY}/${summary.runId}.json`);
    try { requireThat(!lstatSync(destination).isSymbolicLink()); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    renameSync(temp, destination); temp = undefined;
    const parent = openSync(directory, constants.O_RDONLY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
    return comparison;
  } finally {
    if (temp) { try { unlinkSync(temp); } catch { /* reporting only */ } }
    if (db.inTransaction) db.exec("ROLLBACK");
    db.close();
  }
}
export function renderComparison(summary, comparison) {
  const lines = [
    `[validation summary] ${summary.runId} ${summary.state}; ${summary.durationMs}ms; evidence: ${summary.evidencePath}`,
    `${comparison.message}${comparison.priorRun ? `: ${comparison.priorRun} -> ${comparison.currentRun}` : ` (${comparison.reasons.join("; ")})`}`,
  ];
  if (comparison.priorRun) {
    for (const change of comparison.transitions) {
      if (change.change !== "unchanged passing step")
        lines.push(`${change.step}: ${change.change} (${change.prior} -> ${change.current})`);
    }
    const deltas = comparison.timing.map((s) => `${s.step} ${s.deltaMs >= 0 ? "+" : ""}${s.deltaMs}ms`);
    if (deltas.length) lines.push(`Observed timing deltas: ${deltas.join(", ")}`);
    lines.push(`Prior evidence: .local/failure-gate-unified/runs/${comparison.priorRun}.jsonl`);
  }
  lines.push("Informational step observations only; not identical-test, causal, pre-existing-failure or failure-ignore evidence.");
  if (summary.omittedSteps) lines.push(`Detail omitted: ${summary.omittedSteps} steps; not eligible as a reference.`);
  return lines.join("\n");
}
export function reportRun(root, entry, options) {
  try {
    const summary = deriveSummary(entry, options);
    const comparison = saveSummary(root, summary);
    console.warn(renderComparison(summary, comparison));
  } catch { console.warn(`[validation reporting warning] ${WARNING}`); }
}
