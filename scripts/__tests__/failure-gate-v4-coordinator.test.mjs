import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Coordinator, digest } from "../lib/failure-gate/coordinator.mjs";

const modulePath = new URL("../lib/failure-gate/coordinator.mjs", import.meta.url).href;
const taskPlan = (taskId, tier) => `# Fixture task

## Task identity
**Task ID:** \`${taskId}\`

## Pre-existing failures to ignore
None authorized.

## Validation
**Command:** ${tier}
**Why:** The registered tier covers this fixture change.
**Do not escalate:** Do not substitute another tier.

## Regression Guard
**Covers:** Tier authorization changes remain exact.
**Test location:** scripts/__tests__/failure-gate-v4-coordinator.test.mjs
**What it checks:** Every registry tier has a single derived status.
`;
function fixture(t) {
  const base = mkdtempSync(resolve(tmpdir(), "gate-coordinator-"));
  const root = resolve(base, "project");
  const directory = resolve(base, "state");
  mkdirSync(root);
  writeFileSync(resolve(root, "plan.md"), "# Draft fixture task\n");
  mkdirSync(resolve(root, "docs/validation"), { recursive: true });
  writeFileSync(resolve(root, "docs/validation/manifest.json"),
    JSON.stringify({ tiers: { "fixture-check": {}, "fixture-expanded": {}, "newly-registered": {} } }));
  const approvals = new Map();
  const options = { directory, namespace: "fixture-workspace", root };
  const control = {
    review(request) { return approvals.get(request.reference); },
    validatePlan(config) { return config.authorizedTier === "fixture-check" || config.authorizedTier === "fixture-expanded"; },
  };
  const c = new Coordinator({ ...options, control, testPlanValidator: control.validatePlan });
  t.after(() => { if (c.db.open) c.close(); rmSync(base, { recursive: true, force: true }); });
  let config = { planReference: "plan.md", planContent: "",
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
  function configFor(taskId, overrides = {}) {
    const current = { ...config, ...overrides };
    const planContent = taskPlan(taskId, current.authorizedTier);
    writeFileSync(resolve(root, "plan.md"), planContent);
    config = { ...current, planContent };
    return config;
  }
  function active() {
    const draft = c.reserve({ key: key() });
    const activeConfig = configFor(draft.taskId);
    const task = c.activate({ taskId: draft.taskId, config: activeConfig, key: key(),
      approvalReference: approve("activate", { taskId: draft.taskId, expectedVersion: 0,
        config: { ...c.plan(activeConfig.planReference, activeConfig.planContent),
          planVersion: activeConfig.planVersion, authorizedTier: activeConfig.authorizedTier,
          policyVersion: activeConfig.policyVersion, policyDigest: activeConfig.policyDigest,
          tierDefinitionDigest: activeConfig.tierDefinitionDigest, parametersDigest: activeConfig.parametersDigest } }) });
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
  return { c, get config() { return config; }, configFor, control, key, approve, active, runInput,
    options, root, directory, base };
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
  const restarted = new Coordinator({ ...f.options, control: f.control,
    testPlanValidator: f.control.validatePlan });
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
  const config = f.configFor(draft.taskId);
  assert.throws(() => f.c.activate({ taskId: draft.taskId, config: f.config,
    approvalReference: "approved-true", approved: true, actor: "owner", key: f.key() }), /approval/);
  assert.equal(f.c.task(draft.taskId).status, "draft");
  const wrongIdContent = config.planContent.replace(draft.taskId, "another-local-task");
  writeFileSync(resolve(f.root, "plan.md"), wrongIdContent);
  assert.throws(() => f.c.activate({ taskId: draft.taskId,
    config: { ...config, planContent: wrongIdContent }, key: f.key() }), /allocated local task ID/);
  const missingGuardContent = config.planContent.replace(/## Regression Guard[\s\S]*$/, "");
  writeFileSync(resolve(f.root, "plan.md"), missingGuardContent);
  assert.throws(() => f.c.activate({ taskId: draft.taskId,
    config: { ...config, planContent: missingGuardContent }, key: f.key() }), /Regression Guard/);
  writeFileSync(resolve(f.root, "plan.md"), config.planContent);
  const wrong = f.approve("activate", { taskId: "another-task" });
  assert.throws(() => f.c.activate({ taskId: draft.taskId, config, approvalReference: wrong, key: f.key() }), /exact change/);
  const unknown = f.configFor(draft.taskId, { authorizedTier: "unknown" });
  assert.throws(() => f.c.activate({ taskId: draft.taskId, config: unknown, key: f.key() }), /guards/);
  assert.throws(() => f.c.activate({ taskId: draft.taskId, config: { ...config, planContent: "wrong" }, key: f.key() }), /projection/);
  assert.equal(f.c.task(draft.taskId).authorizationVersion, 0);
  assert.ok(f.c.audit().some((a) => a.event === "denied-activate"));
});

test("an otherwise accepted tier absent from the canonical registry cannot activate", (t) => {
  const f = fixture(t);
  const draft = f.c.reserve({ key: f.key() });
  const config = f.configFor(draft.taskId, { authorizedTier: "fixture-expanded" });
  writeFileSync(resolve(f.root, "docs/validation/manifest.json"), JSON.stringify({ tiers: { "fixture-check": {} } }));
  const approvedConfig = { ...f.c.plan(config.planReference, config.planContent),
    planVersion: config.planVersion, authorizedTier: config.authorizedTier, policyVersion: config.policyVersion,
    policyDigest: config.policyDigest, tierDefinitionDigest: config.tierDefinitionDigest,
    parametersDigest: config.parametersDigest };
  assert.throws(() => f.c.activate({ taskId: draft.taskId, config, key: f.key(),
    approvalReference: f.approve("activate", { taskId: draft.taskId, expectedVersion: 0, config: approvedConfig }) }),
  /not currently registered/);
  assert.equal(f.c.task(draft.taskId).status, "draft");
});

test("plan guards allow valid non-material N/A but reject material N/A and placeholders", (t) => {
  const f = fixture(t);
  const draft = f.c.reserve({ key: f.key() });
  const plan = f.configFor(draft.taskId);
  const nA = plan.planContent
    .replace(`**Task ID:** \`${draft.taskId}\``, `**Task ID:** \`${draft.taskId}\`\n**Materiality:** non-material`)
    .replace("# Fixture task", "# Cosmetic fixture task")
    .replace("The registered tier covers this fixture change.", "The registered tier covers this cosmetic copy change.")
    .replace(/## Regression Guard[\s\S]*$/, "## Regression Guard\n**N/A**\n**Why N/A:** Copy text changes, with no behavior or interface impact.\n");
  writeFileSync(resolve(f.root, "plan.md"), nA);
  const approved = { ...f.c.plan("plan.md", nA), authorizedTier: "fixture-check" };
  assert.doesNotThrow(() => f.c.validatePlanGuards(draft.taskId, approved));

  const materialNA = nA.replace("**Materiality:** non-material\n", "");
  writeFileSync(resolve(f.root, "plan.md"), materialNA);
  assert.throws(() => f.c.validatePlanGuards(draft.taskId,
    { ...f.c.plan("plan.md", materialNA), authorizedTier: "fixture-check" }), /non-material classification/);

  const duplicateMateriality = nA.replace("**Materiality:** non-material",
    "**Materiality:** non-material\n**Materiality:** material");
  writeFileSync(resolve(f.root, "plan.md"), duplicateMateriality);
  assert.throws(() => f.c.validatePlanGuards(draft.taskId,
    { ...f.c.plan("plan.md", duplicateMateriality), authorizedTier: "fixture-check" }), /Materiality/);

  const titleDelete = plan.planContent.replace("# Fixture task", "# DELETE - retired fixture capability")
    .replace(/## Regression Guard[\s\S]*$/, "## Regression Guard\n**N/A**\n**Why N/A:** This work removes the obsolete fixture capability.\n");
  writeFileSync(resolve(f.root, "plan.md"), titleDelete);
  assert.doesNotThrow(() => f.c.validatePlanGuards(draft.taskId,
    { ...f.c.plan("plan.md", titleDelete), authorizedTier: "fixture-check" }));

  const quotedDeleteHeading = plan.planContent
    .replace("# Fixture task", "# Fixture task\n\n# DELETE - quoted heading in the description")
    .replace(/## Regression Guard[\s\S]*$/, "## Regression Guard\n**N/A**\n**Why N/A:** No change has been authorized.\n");
  writeFileSync(resolve(f.root, "plan.md"), quotedDeleteHeading);
  assert.throws(() => f.c.validatePlanGuards(draft.taskId,
    { ...f.c.plan("plan.md", quotedDeleteHeading), authorizedTier: "fixture-check" }), /non-material classification/);

  const selfSatisfying = plan.planContent.replace(/## Regression Guard[\s\S]*$/,
    "## Regression Guard\n**Self-satisfying** — this task changes the validation guard.\n");
  writeFileSync(resolve(f.root, "plan.md"), selfSatisfying);
  assert.throws(() => f.c.validatePlanGuards(draft.taskId,
    { ...f.c.plan("plan.md", selfSatisfying), authorizedTier: "fixture-check" }), /complete Regression Guard/);

  const placeholderPlan = plan.planContent.replace("The registered tier covers this fixture change.", "TBD")
    .replace("Every registry tier has a single derived status.", "FILL IN");
  writeFileSync(resolve(f.root, "plan.md"), placeholderPlan);
  assert.throws(() => f.c.validatePlanGuards(draft.taskId,
    { ...f.c.plan("plan.md", placeholderPlan), authorizedTier: "fixture-check" }), /placeholder/);
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
  const config = f.configFor(task.taskId,
    { planVersion: 2, authorizedTier: "fixture-expanded", tierDefinitionDigest: digest("expanded") });
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

test("one authoritative tier mapping exposes and audits current per-tier status", (t) => {
  const f = fixture(t);
  const task = f.active();
  const status = f.c.tierStatuses(task.taskId);
  assert.deepEqual(status.map(({ tier, status: value }) => [tier, value]), [
    ["fixture-check", "ALLOWED"], ["fixture-expanded", "NOT ALLOWED"],
    ["newly-registered", "NOT ALLOWED"],
  ]);
  assert.equal(status[0].authorizationStatus, "ALLOWED");
  assert.equal(status[0].executionStatus, "UNVERIFIED");
  assert.match(status[0].executionReason, /current policy\/tier\/parameter digests/);
  const firstHistory = f.c.tierStatusHistory(task.taskId);
  assert.equal(firstHistory.length, 1);
  assert.deepEqual(firstHistory[0].statuses, status);

  const proposal = f.c.requestChange({ taskId: task.taskId, expectedVersion: 1,
    config: f.configFor(task.taskId, { planVersion: 2, authorizedTier: "fixture-expanded" }), key: f.key() });
  assert.deepEqual(f.c.tierStatuses(task.taskId), status);
  const changed = f.c.resolveChange({ taskId: task.taskId, expectedVersion: proposal.authorizationVersion,
    accept: true, key: f.key(), approvalReference: f.approve("amend", {
      taskId: task.taskId, expectedVersion: proposal.authorizationVersion, pendingChange: proposal.pendingChange,
    }) });
  assert.deepEqual(f.c.tierStatuses(task.taskId).map(({ tier, status: value }) => [tier, value]), [
    ["fixture-check", "NOT ALLOWED"], ["fixture-expanded", "ALLOWED"],
    ["newly-registered", "NOT ALLOWED"],
  ]);
  const history = f.c.tierStatusHistory(task.taskId);
  assert.equal(history.length, 2);
  assert.equal(history[1].authorization_version, changed.authorizationVersion);
  assert.ok(f.c.audit().some(({ event, subject }) =>
    event === "tier-status-snapshot" && subject.includes(changed.taskId) && subject.includes("ALLOWED")));

  // Even after the current tier definition is edited, the authorization label
  // does not claim execution readiness; only checked preflight can verify it.
  writeFileSync(resolve(f.root, "docs/validation/manifest.json"), JSON.stringify({
    tiers: { "fixture-check": {}, "fixture-expanded": { changed: true }, "newly-registered": {}, extra: {} },
  }));
  const changedRegistry = f.c.tierStatuses(task.taskId);
  assert.equal(changedRegistry.find(({ tier }) => tier === "fixture-expanded").authorizationStatus, "ALLOWED");
  assert.equal(changedRegistry.find(({ tier }) => tier === "fixture-expanded").executionStatus, "UNVERIFIED");
  assert.equal(changedRegistry.find(({ tier }) => tier === "extra").authorizationStatus, "NOT ALLOWED");

  const suspended = f.c.suspend({ taskId: task.taskId, expectedVersion: changed.authorizationVersion,
    reason: "review", key: f.key() });
  assert.ok(f.c.tierStatuses(suspended.taskId).every(({ status: value }) => value === "NOT ALLOWED"));
  assert.throws(() => f.c.db.prepare("DELETE FROM tier_status_history WHERE task_id=?").run(task.taskId),
    /append-only|permanent/);
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