import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Coordinator, digest } from "../lib/failure-gate/coordinator.mjs";

const modulePath = new URL("../lib/failure-gate/coordinator.mjs", import.meta.url).href;
function fixture(t) {
  const base = mkdtempSync(resolve(tmpdir(), "gate-coordinator-"));
  const root = resolve(base, "project");
  const directory = resolve(base, "state");
  mkdirSync(root);
  writeFileSync(resolve(root, "plan.md"), "# Approved fixture task\n");
  const approvals = new Map();
  const options = { directory, namespace: "fixture-workspace", root };
  const control = {
    review(request) { return approvals.get(request.reference); },
    validatePlan(config) { return config.authorizedTier === "fixture-check" || config.authorizedTier === "fixture-expanded"; },
  };
  const c = new Coordinator({ ...options, control });
  t.after(() => { if (c.db.open) c.close(); rmSync(base, { recursive: true, force: true }); });
  const config = { planReference: "plan.md", planContent: "# Approved fixture task\n",
    planVersion: 1, authorizedTier: "fixture-check", policyVersion: "fixture-v1",
    policyDigest: digest("policy"), tierDefinitionDigest: digest("tier"), parametersDigest: digest("parameters") };
  let sequence = 0;
  const key = () => `operation-${++sequence}`;
  function approve(action, subject) {
    const reference = `fixture-review-${++sequence}`;
    approvals.set(reference, { reference, reviewer: "fixture-owner", namespace: options.namespace,
      action, subjectDigest: digest(subject) });
    return reference;
  }
  function active() {
    const draft = c.reserve({ key: key() });
    const approvedConfig = { ...c.plan(config.planReference, config.planContent),
      planVersion: config.planVersion, authorizedTier: config.authorizedTier, policyVersion: config.policyVersion,
      policyDigest: config.policyDigest, tierDefinitionDigest: config.tierDefinitionDigest, parametersDigest: config.parametersDigest };
    const task = c.activate({ taskId: draft.taskId, config, key: key(),
      approvalReference: approve("activate", { taskId: draft.taskId, expectedVersion: 0, config: approvedConfig }) });
    c.assign({ taskId: task.taskId, key: key(),
      approvalReference: approve("assign", { taskId: task.taskId, authorizationVersion: 1 }) });
    return task;
  }
  function runInput(task) {
    return { taskId: task.taskId, expectedVersion: task.authorizationVersion,
      planReference: task.planReference, policyDigest: task.policyDigest, tierDefinitionDigest: task.tierDefinitionDigest,
      parametersDigest: task.parametersDigest, processIdentity: { pid: process.pid, startIdentity: "fixture-process-start" },
      key: key() };
  }
  return { c, config, control, key, approve, active, runInput, options, root, directory, base };
}

test("coordinator retains namespace-scoped UUIDs across restart and permanent terminal tombstones", (t) => {
  const f = fixture(t);
  const draft = f.c.reserve({ externalTaskReference: "#907", key: "stable-reserve" });
  assert.deepEqual(f.c.reserve({ externalTaskReference: "#907", key: "stable-reserve" }), draft);
  assert.throws(() => f.c.reserve({ key: "stable-reserve" }), /idempotency key conflict/);
  const ended = f.c.terminate({ taskId: draft.taskId, expectedVersion: 0, status: "cancelled", key: f.key(),
    approvalReference: f.approve("terminate", { taskId: draft.taskId, expectedVersion: 0, status: "cancelled" }) });
  assert.equal(ended.authorizedTier, null);
  assert.throws(() => f.c.db.prepare("DELETE FROM tasks WHERE id=?").run(draft.taskId), /tombstones/);
  f.c.close();
  const restarted = new Coordinator({ ...f.options, control: f.control });
  try {
    assert.equal(restarted.task(draft.taskId).status, "cancelled");
    assert.notEqual(restarted.reserve({ key: "new-reservation" }).taskId, draft.taskId);
    assert.throws(() => restarted.activate({ taskId: draft.taskId, expectedVersion: 1, config: f.config, key: "reopen" }), /terminal/);
    assert.throws(() => new Coordinator({ ...f.options, namespace: "another-workspace" }), /namespace mismatch/);
  } finally { restarted.close(); }
});

test("activation requires independently resolved exact approval, guards, projection and policy", (t) => {
  const f = fixture(t);
  const draft = f.c.reserve({ key: f.key() });
  assert.throws(() => f.c.activate({ taskId: draft.taskId, config: f.config,
    approvalReference: "approved-true", approved: true, actor: "owner", key: f.key() }), /approval/);
  assert.equal(f.c.task(draft.taskId).status, "draft");
  const wrong = f.approve("activate", { taskId: "another-task" });
  assert.throws(() => f.c.activate({ taskId: draft.taskId, config: f.config, approvalReference: wrong, key: f.key() }), /exact change/);
  assert.throws(() => f.c.activate({ taskId: draft.taskId, config: { ...f.config, authorizedTier: "unknown" }, key: f.key() }), /guards/);
  assert.throws(() => f.c.activate({ taskId: draft.taskId, config: { ...f.config, planContent: "wrong" }, key: f.key() }), /projection/);
  assert.equal(f.c.task(draft.taskId).authorizationVersion, 0);
  assert.ok(f.c.audit().some((a) => a.event === "denied-activate"));
});

test("audit failure rolls back task state, idempotency and assignment", (t) => {
  const f = fixture(t);
  f.c.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'fixture audit unavailable'); END;");
  assert.throws(() => f.c.reserve({ key: "audit-crash" }), /audit unavailable/);
  assert.equal(f.c.db.prepare("SELECT count(*) AS count FROM tasks").get().count, 0);
  assert.equal(f.c.db.prepare("SELECT count(*) AS count FROM requests").get().count, 0);
  f.c.db.exec("DROP TRIGGER fail_audit");
  const task = f.active();
  f.c.db.exec("CREATE TRIGGER fail_assignment_audit BEFORE INSERT ON audit WHEN NEW.event='assign' BEGIN SELECT RAISE(ABORT, 'fixture audit unavailable'); END;");
  assert.throws(() => f.c.assign({ taskId: task.taskId, key: f.key(),
    approvalReference: f.approve("assign", { taskId: task.taskId, authorizationVersion: 1 }) }), /audit unavailable/);
  assert.equal(f.c.assignedTask().taskId, task.taskId);
});

test("launch denies substitution, stale policy, selectors and escaping projections before leases", (t) => {
  const f = fixture(t);
  const first = f.active();
  const second = f.active();
  assert.throws(() => f.c.startRun(f.runInput(first)), /substitution/);
  assert.throws(() => f.c.startRun({ ...f.runInput(second), policyDigest: digest("edited-wrapper") }), /mismatch/);
  assert.throws(() => f.c.startRun({ ...f.runInput(second), purpose: "ad-hoc" }), /purpose/);
  assert.throws(() => f.c.startRun({ ...f.runInput(second), diagnostic: {} }), /selector/);
  assert.throws(() => f.c.plan("../plan.md", ""), /reference/);
  writeFileSync(resolve(f.base, "external.md"), "outside");
  symlinkSync(resolve(f.base, "external.md"), resolve(f.root, "escape.md"));
  assert.throws(() => f.c.plan("escape.md", "outside"), /symlink/);
  assert.equal(f.c.db.prepare("SELECT count(*) AS count FROM runs").get().count, 0);
  writeFileSync(resolve(f.root, "plan.md"), "changed after approval");
  assert.throws(() => f.c.startRun(f.runInput(second)), /projection/);
});

test("launch leases serialize transitions; heartbeat CAS and recovery never interpret timeout as death", (t) => {
  const f = fixture(t);
  const task = f.active();
  const run = f.c.startRun(f.runInput(task));
  assert.throws(() => f.c.startRun(f.runInput(task)), /active or quarantined/);
  assert.throws(() => f.c.suspend({ taskId: task.taskId, expectedVersion: 1, reason: "review", key: f.key() }), /active or quarantined/);
  const beat = f.c.heartbeat({ runId: run.runId, expectedVersion: 1, key: f.key() });
  assert.equal(beat.leaseVersion, 2);
  assert.throws(() => f.c.heartbeat({ runId: run.runId, expectedVersion: 1, key: f.key() }), /lease/);
  const recovered = f.c.recover({ runId: run.runId, expectedVersion: 2, key: f.key(),
    approvalReference: f.approve("recover", { runId: run.runId, expectedVersion: 2, processIdentity: run.processIdentity }) });
  assert.equal(recovered.status, "quarantined");
  assert.throws(() => f.c.startRun(f.runInput(task)), /quarantined/);
  f.control.processStopped = () => true;
  assert.equal(f.c.recover({ runId: run.runId, expectedVersion: 3, key: f.key(),
    approvalReference: f.approve("recover", { runId: run.runId, expectedVersion: 3, processIdentity: run.processIdentity }) }).status, "stopped");
  assert.equal(f.c.startRun(f.runInput(task)).status, "running");
});

test("amendments are CAS and one pending only; rejection cannot erase suspension", (t) => {
  const f = fixture(t);
  const task = f.active();
  const requested = f.c.requestChange({ taskId: task.taskId, expectedVersion: 1,
    config: { ...f.config, planVersion: 2, authorizedTier: "fixture-expanded" }, coverageInadequate: true, key: f.key() });
  assert.equal(requested.authorizedTier, "fixture-check");
  assert.throws(() => f.c.requestChange({ taskId: task.taskId, expectedVersion: 2, config: f.config, key: f.key() }), /one pending/);
  assert.throws(() => f.c.resolveChange({ taskId: task.taskId, expectedVersion: 1, accept: false, key: f.key() }), /stale/);
  const rejected = f.c.resolveChange({ taskId: task.taskId, expectedVersion: 2, accept: false, key: f.key(),
    approvalReference: f.approve("reject", { taskId: task.taskId, expectedVersion: 2, pendingChange: requested.pendingChange }) });
  assert.equal(rejected.suspension, "coverage-inadequate");
  assert.equal(rejected.pendingChange, null);
  assert.throws(() => f.c.startRun(f.runInput(rejected)), /not runnable/);
});

test("approved amendment advances all digests atomically and invalidates earlier versions", (t) => {
  const f = fixture(t);
  const task = f.active();
  const config = { ...f.config, planVersion: 2, authorizedTier: "fixture-expanded", tierDefinitionDigest: digest("expanded") };
  const requested = f.c.requestChange({ taskId: task.taskId, expectedVersion: 1, config, key: f.key() });
  const input = { taskId: task.taskId, expectedVersion: 2, accept: true, key: f.key(),
    approvalReference: f.approve("amend", { taskId: task.taskId, expectedVersion: 2, pendingChange: requested.pendingChange }) };
  const amended = f.c.resolveChange(input);
  assert.deepEqual(f.c.resolveChange(input), amended);
  assert.equal(amended.authorizationVersion, 3);
  assert.equal(amended.authorizedTier, "fixture-expanded");
  assert.equal(amended.tierDefinitionDigest, config.tierDefinitionDigest);
  assert.throws(() => f.c.startRun(f.runInput(task)), /stale/);
});

test("diagnostics consume exactly three atomic retry slots, cannot reset by selector or satisfy completion", (t) => {
  const f = fixture(t);
  const task = f.active();
  const initial = f.c.startRun(f.runInput(task));
  f.c.finishRun({ runId: initial.runId, expectedVersion: 1, evidence: { reference: "reports/initial.json", digest: digest("failed") }, key: f.key() });
  const diagnostic = { initialRunId: initial.runId, failureDigest: digest("failure"), selectorDigest: digest("selector") };
  assert.throws(() => f.c.startRun({ ...f.runInput(task), purpose: "diagnostic_retry", diagnostic }), /capability/);
  f.control.diagnostic = ({ diagnostic: d }) => ({ ...d, safe: true, capabilityDigest: digest("safe-fixture-isolation") });
  let retry;
  for (let attempt = 1; attempt <= 3; attempt++) {
    retry = f.c.startRun({ ...f.runInput(task), purpose: "diagnostic_retry", diagnostic });
    assert.equal(retry.diagnosticAttempt, attempt);
    f.c.finishRun({ runId: retry.runId, expectedVersion: 1,
      evidence: { reference: `reports/retry-${attempt}.json`, digest: digest("raw-outcome") }, key: f.key() });
  }
  assert.throws(() => f.c.startRun({ ...f.runInput(task), purpose: "diagnostic_retry",
    diagnostic: { ...diagnostic, selectorDigest: digest("different-selector") } }), /three/);
  assert.throws(() => f.c.terminate({ taskId: task.taskId, expectedVersion: 1, status: "completed", runId: retry.runId, key: f.key() }), /not applicable/);
});

test("completion adapter executes inside transaction, rejects labels and preserves failure cleanup", (t) => {
  const f = fixture(t);
  const task = f.active();
  const run = f.c.startRun(f.runInput(task));
  f.c.finishRun({ runId: run.runId, expectedVersion: 1, evidence: { reference: "reports/run.json", digest: digest("raw") }, key: f.key() });
  const complete = () => f.c.terminate({ taskId: task.taskId, expectedVersion: 1, status: "completed", runId: run.runId, key: f.key() });
  assert.throws(complete, /checker unavailable/);
  f.control.complete = () => ({ assessment: "PASS" });
  assert.throws(complete, /rejected/);
  f.control.complete = () => {
    assert.equal(f.c.db.inTransaction, true);
    return { assessment: "PASS", writerCoordinationHeld: true };
  };
  assert.equal(complete().status, "completed");
  assert.throws(() => f.c.assignedTask(), /unavailable/);
  assert.throws(() => f.c.startRun(f.runInput(task)), /assignment/);
});

test("provenance comparison binds verified earlier snapshot and environment with bounded atomic attempts", (t) => {
  const f = fixture(t);
  const task = f.active();
  const initial = f.c.startRun(f.runInput(task));
  f.c.finishRun({ runId: initial.runId, expectedVersion: 1,
    evidence: { reference: "reports/initial.json", digest: digest("failure") }, key: f.key() });
  const comparison = { initialRunId: initial.runId, failureDigest: digest("failure"),
    selectorDigest: digest("comparison-command"), earlierSnapshotDigest: digest("earlier-unaffected"),
    environmentDigest: digest("applicable-fixture") };
  const launch = () => f.c.startRun({ ...f.runInput(task), purpose: "provenance_comparison", comparison });
  assert.throws(launch, /capability unavailable/);
  f.control.comparison = () => ({ ...comparison, safe: true, verifiedEarlierUnaffected: false,
    environmentApplicable: true, capabilityDigest: digest("comparison-policy"), maxAttempts: 1 });
  assert.throws(launch, /capability unavailable/);
  f.control.comparison = () => ({ ...comparison, safe: true, verifiedEarlierUnaffected: true,
    environmentApplicable: false, capabilityDigest: digest("comparison-policy"), maxAttempts: 1 });
  assert.throws(launch, /capability unavailable/);
  f.control.comparison = () => ({ ...comparison, safe: true, verifiedEarlierUnaffected: true,
    environmentApplicable: true, capabilityDigest: digest("comparison-policy"), maxAttempts: 1 });
  const run = launch();
  assert.equal(run.comparisonAttempt, 1);
  assert.equal(run.diagnosticAttempt, null);
  f.c.finishRun({ runId: run.runId, expectedVersion: 1,
    evidence: { reference: "reports/comparison.json", digest: digest("same-failure") }, key: f.key() });
  assert.throws(launch, /attempt limit/);
  f.control.comparison = () => ({ ...comparison, safe: true, verifiedEarlierUnaffected: true,
    environmentApplicable: true, capabilityDigest: digest("comparison-policy"), maxAttempts: 2 });
  assert.throws(launch, /capability changed/);
  assert.throws(() => f.c.terminate({ taskId: task.taskId, expectedVersion: 1, status: "completed",
    runId: run.runId, key: f.key() }), /not applicable/);
  assert.equal(f.c.db.prepare("SELECT count(*) AS count FROM diagnostics").get().count, 0);
});

function child(options, body) {
  const source = `import {Coordinator} from ${JSON.stringify(modulePath)};
    const c=new Coordinator(${JSON.stringify(options)}); ${body}; c.close();`;
  const process = spawn(globalThis.process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "", error = "";
  process.stdout.on("data", (chunk) => { output += chunk; });
  process.stderr.on("data", (chunk) => { error += chunk; });
  return once(process, "exit").then(([code]) => ({ code, output, error }));
}

test("real independent processes commit unique reservations without lost updates", async (t) => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => child(f.options,
    `for(let i=0;i<12;i++) console.log(c.reserve({key:'worker-${index}-'+i}).taskId)`)));
  for (const result of results) assert.equal(result.code, 0, result.error);
  const ids = results.flatMap((r) => r.output.trim().split("\n"));
  assert.equal(new Set(ids).size, 48);
  assert.equal(f.c.db.prepare("SELECT count(*) AS count FROM tasks").get().count, 48);
  assert.equal(f.c.audit().filter((a) => a.event === "reserve").length, 48);
});

test("real process crash rolls back transaction and exposes no partial reservation", async (t) => {
  const f = fixture(t);
  const result = await child(f.options, `c.db.exec('BEGIN IMMEDIATE');
    c.db.prepare("INSERT INTO tasks VALUES (?,?,?,?)").run('uncommitted','draft',0,'{}');
    process.exit(19)`);
  assert.equal(result.code, 19);
  assert.equal(f.c.db.prepare("SELECT count(*) AS count FROM tasks").get().count, 0);
  assert.equal(f.c.reserve({ key: "after-crash" }).status, "draft");
});

test("real launch versus suspension race has only one consistent winner", async (t) => {
  const f = fixture(t);
  const task = f.active();
  const launch = JSON.stringify(f.runInput(task));
  const suspend = JSON.stringify({ taskId: task.taskId, expectedVersion: 1, reason: "review", key: "racing-suspension" });
  const result = await Promise.all([
    child(f.options, `try { c.startRun(${launch}); console.log('launch'); } catch { console.log('denied'); }`),
    child(f.options, `try { c.suspend(${suspend}); console.log('suspend'); } catch { console.log('denied'); }`),
  ]);
  for (const outcome of result) assert.equal(outcome.code, 0, outcome.error);
  const output = result.map((r) => r.output.trim()).sort();
  assert.ok(JSON.stringify(output) === JSON.stringify(["denied", "launch"]) ||
    JSON.stringify(output) === JSON.stringify(["denied", "suspend"]));
  const current = f.c.task(task.taskId);
  const runs = f.c.db.prepare("SELECT * FROM runs").all();
  if (current.suspension) {
    assert.equal(current.authorizationVersion, 2);
    assert.equal(runs.length, 0);
  } else {
    assert.equal(current.authorizationVersion, 1);
    assert.equal(runs.length, 1);
  }
});