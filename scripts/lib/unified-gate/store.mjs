import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, openSync, writeFileSync,
  fsyncSync, closeSync, renameSync, lstatSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { verifyContract } from "./contract.mjs";
import { contract as regressionContract } from "./regression.mjs";

export const REGISTRY = "docs/validation/unified-registry.json";
export const PIN = "docs/validation/unified-pin.json";
export const SOURCE = ".agents/skills/failure-gate-unified/SKILL.md";
export const MANIFEST = "docs/validation/manifest.json";
export const TIERS = ["test-fast", "test-standard", "test-standard-plus", "test-heavy"];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const emptyRegistry = () => ({ schemaVersion: 1, tasks: {}, tombstones: [] });
export const stable = (v) => JSON.stringify(v && typeof v === "object"
  ? Array.isArray(v) ? v.map((x) => JSON.parse(stable(x)))
    : Object.fromEntries(Object.keys(v).sort().map((k) => [k, JSON.parse(stable(v[k]))]))
  : v);
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const digest = (value) => hash(stable(value));
export const readJson = (root, path) => JSON.parse(readFileSync(safePath(root, path), "utf8"));
export function invariant(ok, message) { if (!ok) throw new Error(message); }

// Path confinement is input safety, not a workspace/machine identity receipt.
export function safePath(root, path) {
  const abs = resolve(root, path);
  invariant(abs !== resolve(root) && !relative(resolve(root), abs).startsWith(".."),
    "path must stay inside the project");
  let current = abs;
  while (current !== resolve(root)) {
    if (existsSync(current)) invariant(!lstatSync(current).isSymbolicLink(), "symlink path rejected");
    current = dirname(current);
  }
  return abs;
}
export function atomicWrite(root, path, bytes) {
  const target = safePath(root, path);
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, target);
  const directory = openSync(dirname(target), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export function pins(root, sealedPin) {
  const pin = readJson(root, PIN);
  invariant([1, 2].includes(pin.schemaVersion) && pin.source === SOURCE &&
    /^[a-f0-9]{64}$/.test(pin.current), "invalid skill pin");
  if (pin.schemaVersion === 2) {
    verifyContract(root, dirname(SOURCE), pin.current, safePath);
  } else {
    invariant(hash(readFileSync(safePath(root, SOURCE))) === pin.current,
      "canonical skill does not match current pin; stop for owner-directed gate repair");
  }
  for (const required of new Set([pin.current, sealedPin].filter(Boolean))) {
    const revision = pin.revisions?.[required];
    if (revision?.kind === "normative-package") {
      verifyContract(root, revision.directory, required, safePath);
    } else {
      invariant(typeof revision === "string", "sealed skill revision unavailable");
      invariant(hash(readFileSync(safePath(root, revision))) === required,
        "historical sealed skill revision hash mismatch");
    }
  }
  return pin;
}
export function admissionReady(root) {
  // Host installation acceptance is a reporting boundary, not task admission.
  // Keep contract integrity mandatory; callers still enforce provisioning,
  // seals, tier binding, authorization declarations and bounded execution.
  const pin = pins(root);
  environmentAvailability(root);
  return pin;
}

// Read-only operational probe of THIS checkout/process, not a host identity,
// readiness waiver, native authorization service or workspace-restart receipt.
export function environmentAvailability(root) {
  const policy = pins(root);
  if (policy.regressionGuard) {
    invariant(regressionContract(root, safePath) === policy.regressionGuard,
      "adopted Regression Guard policy mismatch or unavailable");
  }
  const files = [
    "scripts/unified-gate.mjs", "scripts/unified-step.mjs", "scripts/run-tier.mjs",
    "scripts/lib/baseline.mjs", "scripts/lib/tiers.mjs", "scripts/lib/owned-process-group.mjs",
    ...["store", "contract", "plans", "execution", "regression", "retry",
      "retry-dispatch", "retry-node-reporter", "retry-browser-reporter", "summaries"]
      .map((name) => `scripts/lib/unified-gate/${name}.mjs`),
  ].map((path) => {
    const file = safePath(root, path);
    invariant(existsSync(file) && lstatSync(file).isFile(),
      `required gate runtime file unavailable: ${path}`);
    return { path, sha256: hash(readFileSync(file)) };
  });
  // Exercise the native dependency output, not just require.resolve(). No local
  // lock/ledger is opened; in-memory connection is always closed.
  const db = new Database(":memory:");
  try {
    invariant(db.prepare("SELECT 1 AS available").get().available === 1,
      "gate SQLite dependency probe failed");
  } finally { db.close(); }
  const gitProbe = git(root, ["--version"]);
  return {
    status: "CHECKS_AVAILABLE",
    scope: "this checkout and current process only; not task admission or lifecycle acceptance",
    selectedContract: policy.current,
    adoptedRegressionGuard: policy.regressionGuard ?? null,
    runnerFiles: files,
    dependencies: { node: process.version, sqlite: "in-memory query succeeded",
      git: gitProbe.stdout.trim() },
    workspaceRestart: "NOT_OBSERVED", taskWorker: "NOT_OBSERVED", restore: "NOT_OBSERVED",
  };
}
export function tierDefinition(root, tier) {
  invariant(TIERS.includes(tier), "unregistered tier");
  const definition = readJson(root, MANIFEST).tiers?.[tier];
  invariant(definition && Number.isInteger(definition.timeoutMs) && definition.timeoutMs > 0 &&
    definition.steps?.length > 0, "tier has no bounded meaningful workload");
  const names = new Set();
  for (const step of definition.steps) {
    invariant(typeof step.name === "string" && !names.has(step.name) &&
      ["test", "typecheck", "lint", "audit", "smoke", "harness"].includes(step.kind) &&
      Array.isArray(step.command) && step.command.length &&
      step.command.every((s) => typeof s === "string" && s.length > 0), "invalid tier step");
    names.add(step.name);
  }
  return definition;
}
export function taskState(record) { return record.history.at(-1).state; }
const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

export function validateRegistry(registry) {
  invariant(registry?.schemaVersion === 1 && registry.tasks &&
    typeof registry.tasks === "object" && !Array.isArray(registry.tasks) &&
    Array.isArray(registry.tombstones), "invalid task registry");
  const stones = new Set(registry.tombstones);
  invariant(stones.size === registry.tombstones.length &&
    [...stones].every((id) => UUID.test(id)), "invalid/duplicate permanent tombstone");
  for (const [id, record] of Object.entries(registry.tasks)) {
    invariant(UUID.test(id) && stones.has(id) && record.history?.length, "missing task identity/tombstone");
    let prev;
    for (const event of record.history) {
      const state = event.state;
      invariant(event.digest === digest(without(event, ["digest"])) &&
        event.previous === (prev?.digest ?? null), "changed event chain");
      invariant(state.id === id && TIERS.includes(state.tier) &&
        /^[a-f0-9]{64}$/.test(state.pin), "invalid task binding");
      if (!prev) {
        invariant(event.op === "provision" && state.status === "reserved" &&
          state.revision === 0 && state.runs.length === 0, "task must start with a reservation");
      } else {
        const prior = prev.state;
        invariant(event.op !== "provision" && ["amend", "cancel", "run"].includes(event.op),
          "record may change only through amend, cancel or run");
        invariant(!["cancelled", "closed"].includes(prior.status), "terminal task cannot be reopened");
        invariant(state.id === prior.id && state.createdAt === prior.createdAt, "immutable task identity changed");
        if (event.op === "amend") {
          invariant(state.status === "sealed" && state.revision === prior.revision + 1 &&
            stable(state.runs) === stable(prior.runs), "invalid amendment");
          invariant(prior.runs.at(-1)?.state !== "RUNNING", "cannot amend a running task");
        } else if (event.op === "cancel") {
          invariant(["cancelled", "closed"].includes(state.status) &&
            stable(without(state, ["status", "closure"])) === stable(without(prior, ["status", "closure"])),
            "cancellation cannot rewrite bindings or evidence");
          invariant(prior.runs.at(-1)?.state !== "RUNNING", "recover a stopped run before closure");
          invariant(state.closure?.reason?.trim(), "closure reason required");
          if (state.status === "closed") invariant(state.closure.completionMode === "owner_direction" &&
            state.closure.direction?.trim() && state.closure.reference?.trim() &&
            state.closure.state === "INCOMPLETE", "administrative closure is not PASS");
        } else {
          invariant(prior.status === "sealed" && state.status === "sealed" &&
            stable(without(state, ["runs"])) === stable(without(prior, ["runs"])),
            "run cannot rewrite plan or binding");
          const a = prior.runs, b = state.runs;
          invariant(b.length === a.length || b.length === a.length + 1, "run evidence dropped");
          invariant(stable(b.slice(0, Math.max(0, a.length - 1))) ===
            stable(a.slice(0, Math.max(0, a.length - 1))), "earlier runs rewritten");
          if (b.length > a.length) {
            invariant(stable(b.slice(0, a.length)) === stable(a) &&
              a.at(-1)?.state !== "RUNNING" && b.at(-1).state === "RUNNING", "invalid run start");
          } else {
            invariant(a.at(-1)?.state === "RUNNING" &&
              ["PASS", "FAIL", "BLOCKED", "INCOMPLETE"].includes(b.at(-1)?.state) &&
              a.at(-1).id === b.at(-1).id, "invalid run finish");
          }
        }
      }
      prev = event;
    }
    const state = taskState(record);
    invariant(["reserved", "sealed", "cancelled", "closed"].includes(state.status), "invalid lifecycle");
  }
  return registry;
}
export function readRegistry(root) { return validateRegistry(readJson(root, REGISTRY)); }
export function append(registry, state, op) {
  const history = registry.tasks[state.id]?.history ?? [];
  const event = { op, at: new Date().toISOString(), previous: history.at(-1)?.digest ?? null,
    state: structuredClone(state) };
  event.digest = digest(event);
  registry.tasks[state.id] = { history: [...history, event] };
  if (!registry.tombstones.includes(state.id)) registry.tombstones.push(state.id);
  validateRegistry(registry);
}
export function compareRegistry(base, candidate) {
  validateRegistry(base); validateRegistry(candidate);
  for (const id of base.tombstones) invariant(candidate.tombstones.includes(id), `tombstone disappeared: ${id}`);
  for (const [id, record] of Object.entries(base.tasks)) {
    invariant(candidate.tasks[id], `task ID disappeared: ${id}`);
    invariant(stable(candidate.tasks[id].history.slice(0, record.history.length)) === stable(record.history),
      `committed task history rewritten: ${id}`);
  }
}
export function git(root, args, allowedFailure = false, maxBuffer = 32_000_000) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 3000, maxBuffer });
  if (!allowedFailure) invariant(result.status === 0, `git prerequisite failed: ${args[0]}`);
  return result;
}
function gitRegistry(root, ref) {
  // Resolve once so sizing and reading use the same immutable Git object, even
  // if HEAD or the index changes. Retained history can outgrow the generic
  // command-output buffer; its actual blob size supplies the bounded read.
  const object = git(root, ["rev-parse", "--verify", `${ref}:${REGISTRY}`]).stdout.trim();
  const size = Number(git(root, ["cat-file", "-s", object]).stdout.trim());
  invariant(Number.isSafeInteger(size) && size > 0 && size <= Number.MAX_SAFE_INTEGER - 65536,
    "invalid registry Git object size");
  return JSON.parse(git(root, ["show", object], false, Math.max(4_000_000, size + 65536)).stdout);
}
function committedRegistry(root, ref) {
  const listing = git(root, ["ls-tree", ref, "--", REGISTRY]).stdout.trim();
  return listing ? gitRegistry(root, ref) : emptyRegistry();
}
export function mergeGuard(root, candidate, staged = false) {
  git(root, ["rev-parse", "--verify", "HEAD"]);
  if (staged) {
    const indexed = git(root, ["ls-files", "--stage", "--", REGISTRY]).stdout.trim();
    invariant(indexed, "registry absent from proposed Git index");
    candidate = gitRegistry(root, "");
  }
  compareRegistry(committedRegistry(root, "HEAD"), candidate);
  const merging = git(root, ["rev-parse", "--verify", "MERGE_HEAD"], true);
  if (merging.status === 0) compareRegistry(committedRegistry(root, "MERGE_HEAD"), candidate);
  for (const record of Object.values(candidate.tasks)) {
    for (const event of record.history) {
      pins(root, event.state.pin);
      if (event.state.spec?.guardContract) regressionContract(root, safePath, event.state.spec.guardContract);
    }
  }
  return candidate;
}
export function saveRegistry(root, registry) {
  mergeGuard(root, registry);
  atomicWrite(root, REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
}

// SQLite is ONLY a local mutual-exclusion primitive. The portable JSON registry
// is authoritative. OS transaction locks release on process death/restart.
// No PID/host/workspace receipt is part of task admission.
export async function withWriter(root, work) {
  const directory = safePath(root, ".local/failure-gate-unified");
  mkdirSync(directory, { recursive: true });
  const lockPath = safePath(root, ".local/failure-gate-unified/writer.sqlite");
  const db = new Database(lockPath, { timeout: 500 });
  try {
    db.exec("BEGIN IMMEDIATE");
    pins(root);
    const registry = readRegistry(root);
    mergeGuard(root, registry);
    return await work(registry);
  } catch (error) {
    if (error.code === "SQLITE_BUSY") throw new Error("BLOCKED: gate writer/run already active (single flight)");
    throw error;
  } finally {
    if (db.inTransaction) db.exec("ROLLBACK");
    db.close();
  }
}
