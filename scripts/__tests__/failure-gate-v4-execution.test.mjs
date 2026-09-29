import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Coordinator, digest } from "../lib/failure-gate/coordinator.mjs";
import { CheckedExecution, policyDigest, checkedEnvironment, projectFile,
  candidateStatus } from "../lib/failure-gate/execution.mjs";
import { createLocalHost, policyDeclaration } from "../lib/failure-gate/host.mjs";
import { inputManifest } from "../lib/failure-gate/evidence.mjs";
import { adaptRuntimeTiers, parseRuntimeReport } from "../lib/failure-gate/runtime-tiers.mjs";
import { readFileSync } from "node:fs";

const fixturePlan = (taskId, tier = "fixture") => `# Fixture task

## Task identity
**Task ID:** \`${taskId}\`

## Pre-existing failures to ignore
None authorized.

## Validation
**Command:** ${tier}
**Why:** The registered tier covers this fixture change.
**Do not escalate:** Do not substitute another tier.

## Regression Guard
**Covers:** Checked execution remains bound to its approved local task.
**Test location:** scripts/__tests__/failure-gate-v4-execution.test.mjs
**What it checks:** Invalid task, plan, and report evidence is rejected.
`;

function fixture(t, steps) {
  const directory = mkdtempSync(join(tmpdir(), "fg-v4-execution-"));
  const root = join(directory, "source");
  mkdirSync(root);
  mkdirSync(join(root, "docs/validation"), { recursive: true });
  writeFileSync(join(root, "docs/validation/manifest.json"), JSON.stringify({ tiers: { fixture: {} } }));
  writeFileSync(join(root, "plan.md"), "draft fixture plan");
  writeFileSync(join(root, "governor.txt"), "accepted fixture policy");
  writeFileSync(join(root, "check.mjs"), `
    import {writeFileSync} from 'node:fs';
    writeFileSync('report.json', JSON.stringify({tests:1, skipped:0, failures:[]}));
  `);
  const coordinator = new Coordinator({ directory: join(directory, "state"), namespace: "fixture", root,
    testPlanValidator: () => true,
    control: {
      validatePlan: () => true,
      review: (request) => ({ ...request, reviewer: "fixture-owner" }),
    } });
  t.after(() => { coordinator.close(); rmSync(directory, { recursive: true, force: true }); });
  const tier = { resource: "fixture", steps: steps ?? [
    { name: "fixture-test", kind: "test", command: [process.execPath, "check.mjs"],
      report: "report.json", minimumTests: 1, timeoutMs: 3000 },
  ] };
  const host = { mode: "workflow", accepted: true, tiers: { fixture: tier },
    policyInputs: ["governor.txt", "check.mjs"], parameters: { allowedEnvironment: [] },
    processIdentity: () => ({ pid: process.pid, startIdentity: "fixture-process" }),
    snapshot: ({ runId }) => {
      const destination = join(directory, runId);
      cpSync(root, destination, { recursive: true });
      return { root: destination, isolated: true, digest: "fixture-snapshot" };
    },
    verifySnapshot: () => true,
    withResourceLock: async (_tier, action) => action({ held: true }),
    storeEvidence: (evidence) => {
      host.records.set(evidence.runId, structuredClone(evidence));
      return evidence.runId;
    },
    records: new Map(),
    readEvidence: (reference) => structuredClone(host.records.get(reference)),
  };
  const draft = coordinator.reserve({ key: "reserve" });
  const planContent = fixturePlan(draft.taskId);
  writeFileSync(join(root, "plan.md"), planContent);
  const active = coordinator.activate({ taskId: draft.taskId, approvalReference: "fixture-approval", key: "activate",
    config: { planReference: "plan.md", planContent, planVersion: 1,
      authorizedTier: "fixture", policyVersion: "fixture-v4", policyDigest: policyDigest(root, host.policyInputs),
      tierDefinitionDigest: digest(tier), parametersDigest: digest(host.parameters) } });
  coordinator.assign({ taskId: active.taskId, approvalReference: "fixture-assignment", key: "assign" });
  return { coordinator, host, root, directory, task: active,
    runner: new CheckedExecution({ coordinator, root, host }),
    request: { taskId: active.taskId, planReference: "plan.md", env: {} } };
}

test("checked candidate runs accepted argv with lease and complete raw report", async (t) => {
  const f = fixture(t);
  const result = await f.runner.run(f.request);
  assert.equal(result.status, "RECORDED");
  assert.equal(result.rawExitCode, 0);
  assert.equal(result.evidence.steps[0].report.tests, 1);
  assert.equal(f.coordinator.run(result.runId).status, "finished");
  assert.equal(f.coordinator.run(result.runId).evidence.digest, digest(result.evidence));
});

test("task, tier, plan, override and policy substitutions launch nothing", async (t) => {
  const f = fixture(t);
  for (const change of [
    { taskId: "other" }, { requestedTier: "heavier" }, { planReference: "../plan.md" },
    { args: ["--grep", "only-one"] }, { env: { CI_SMOKE_TEST: "1" } },
    { env: { NODE_OPTIONS: "--require bypass.cjs" } },
  ]) await assert.rejects(f.runner.run({ ...f.request, ...change }), /BLOCKED/);
  assert.equal(f.coordinator.db.prepare("SELECT count(*) AS n FROM runs").get().n, 0);
  writeFileSync(join(f.root, "governor.txt"), "task modified policy");
  await assert.rejects(f.runner.run(f.request), /policy changed/);
  assert.equal(f.coordinator.db.prepare("SELECT count(*) AS n FROM runs").get().n, 0);
});

test("stale approved plan and unsupported report deny before a command starts", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, "plan.md"), "changed draft");
  await assert.rejects(f.runner.run(f.request), /stale plan/);
  assert.equal(f.coordinator.db.prepare("SELECT count(*) AS n FROM runs").get().n, 0);
  writeFileSync(join(f.root, "plan.md"), f.task.planContent);
  f.host.tiers.fixture.steps[0].unsupportedReport = "review unavailable";
  await assert.rejects(f.runner.run(f.request), /unsupported report/);
  assert.equal(f.coordinator.db.prepare("SELECT count(*) AS n FROM runs").get().n, 0);
});

test("a symlink plan cannot pass path confinement", (t) => {
  const f = fixture(t);
  symlinkSync(join(f.root, "plan.md"), join(f.root, "linked.md"));
  assert.throws(() => projectFile(f.root, "linked.md"), /unsafe/);
  assert.throws(() => projectFile(f.root, "../source/plan.md"), /invalid/);
});

test("copied reports and zero tests cannot substantiate a test pass", async (t) => {
  const f = fixture(t, [{ name: "no-tests", kind: "test", command: [process.execPath, "-e", ""],
    report: "report.json", minimumTests: 1, timeoutMs: 3000 }]);
  writeFileSync(join(f.root, "report.json"), JSON.stringify({ tests: 30, skipped: 0, failures: [] }));
  const result = await f.runner.run(f.request);
  assert.equal(result.evidence.steps[0].status, "incomplete");
  assert.equal(result.rawExitCode, 1);
});

test("independent steps continue after a raw failure; unsafe dependents are named", async (t) => {
  const f = fixture(t, [
    { name: "fails", kind: "lint", command: [process.execPath, "-e", "process.exit(3)"], timeoutMs: 3000 },
    { name: "independent", kind: "audit", command: [process.execPath, "-e", ""], timeoutMs: 3000 },
    { name: "dependent", kind: "lint", command: [process.execPath, "-e", ""], timeoutMs: 3000, dependsOn: ["fails"] },
  ]);
  const result = await f.runner.run(f.request);
  assert.deepEqual(result.evidence.steps.map((step) => step.status), ["failed", "passed", "not_reached"]);
  assert.equal(result.evidence.steps[0].exitCode, 3);
  assert.equal(result.rawExitCode, 1);
});

test("unknown snapshot integrity leaves lease unresolved, preventing replacement", async (t) => {
  const f = fixture(t);
  f.host.verifySnapshot = () => false;
  const result = await f.runner.run(f.request);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(f.coordinator.run(result.runId).status, "running");
  await assert.rejects(f.runner.run(f.request), /active or quarantined/);
});

test("environment policy preserves approved runtime values, excludes unknown selectors", () => {
  assert.deepEqual(checkedEnvironment({ PATH: "/bin", LANG: "C", CUSTOM_FILTER: "skip" },
    { allowedEnvironment: ["PATH", "LANG"] }), { PATH: "/bin", LANG: "C" });
  assert.throws(() => checkedEnvironment({ FAILURE_GATE_BROWSER_REPORT: "1" },
    { allowedEnvironment: ["FAILURE_GATE_BROWSER_REPORT"] }), /coverage override/);
});

test("unavailable production control and platform dispatch never fall back to legacy", () => {
  assert.equal(candidateStatus().operational, false);
  assert.match(candidateStatus().activation, /designated project-local human-review decision source/);
  assert.equal("managedCompletion" in candidateStatus(), false);
  for (const args of [["scripts/failure-gate.mjs", "activate", "--approved"],
    ["scripts/failure-gate.mjs", "managed-completion"],
    ["scripts/run-locked-tier.mjs", "--v4", "missing.md"],
    ["scripts/run-locked-tier.mjs", "--v4=1"],
    ["scripts/run-locked-tier.mjs", "missing.md", "--task-id=other"],
    ["scripts/run-locked-tier.mjs", "docs/validation/plans/failure-gate-v4-bootstrap.md"]]) {
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /BLOCKED/);
    assert.doesNotMatch(result.stdout, /Step:/);
  }
});

test("read-only tier-status CLI reports the current registry without granting activation", (t) => {
  const f = fixture(t);
  const state = join(f.directory, "cli-state");
  const draftResult = spawnSync(process.execPath, ["scripts/failure-gate.mjs", "draft",
    "--root", f.root, "--state", state, "--namespace", "cli-fixture"], { encoding: "utf8" });
  assert.equal(draftResult.status, 0, draftResult.stderr);
  const draft = JSON.parse(draftResult.stdout);
  const statusResult = spawnSync(process.execPath, ["scripts/failure-gate.mjs", "tier-status",
    "--root", f.root, "--state", state, "--namespace", "cli-fixture", "--task-id", draft.taskId],
  { encoding: "utf8" });
  assert.equal(statusResult.status, 0, statusResult.stderr);
  const status = JSON.parse(statusResult.stdout);
  assert.equal(status.statuses.length, 1);
  assert.equal(status.statuses[0].taskId, draft.taskId);
  assert.equal(status.statuses[0].tier, "fixture");
  assert.equal(status.statuses[0].status, "NOT ALLOWED");
  assert.equal(status.statuses[0].executionStatus, "BLOCKED");
});

function concreteHost(f, control = {}) {
  return createLocalHost({
    root: f.root, directory: join(f.directory, "concrete"), tiers: f.host.tiers,
    policyInputs: f.host.policyInputs, parameters: f.host.parameters,
    exclusions: ["report.json"],
    environment: { identity: "fixture-v1", externalState: "none", resetPolicy: "none" },
    approvalReference: "fixture-owner-policy",
    control: {
      acceptPolicy: ({ reference, declaration }) => ({ reference,
        declarationDigest: digest(declaration), reviewer: "fixture-owner" }),
      withFinalWriterLock: (action) => action(),
      ...control,
    },
  });
}

test("concrete local adapter isolates, resource-locks, verifies artifacts and recomputes completion", async (t) => {
  const f = fixture(t);
  const host = concreteHost(f);
  const runner = new CheckedExecution({ coordinator: f.coordinator, root: f.root, host });
  const outcome = await runner.run(f.request);
  assert.equal(outcome.status, "RECORDED");
  assert.equal(outcome.rawExitCode, 0);
  const decision = await runner.completion({ taskId: f.task.taskId, runId: outcome.runId });
  assert.equal(decision.status, "PASS");
  // A label added by an agent is not consulted; changing bytes breaks retained digest.
  const retained = host.readEvidence(f.coordinator.run(outcome.runId).evidence.reference);
  writeFileSync(join(retained.snapshotRoot, "report.json"),
    JSON.stringify({ tests: 99, skipped: 0, failures: [], status: "PASS" }));
  await assert.rejects(runner.completion({ taskId: f.task.taskId, runId: outcome.runId }), /digest mismatch/);
});

test("terminal completion recomputes inside the transaction and writer boundary", async (t) => {
  const f = fixture(t);
  let held = false;
  const host = concreteHost(f, { withFinalWriterLock: (action) => {
    assert.equal(held, false);
    held = true;
    try { return action(); } finally { held = false; }
  } });
  const runner = new CheckedExecution({ coordinator: f.coordinator, root: f.root, host });
  const result = await runner.run(f.request);
  const assess = runner.assessCompletion.bind(runner);
  runner.assessCompletion = (request) => {
    assert.equal(held, true);
    assert.equal(f.coordinator.db.inTransaction, true);
    return assess(request);
  };
  const terminal = await runner.terminate({ taskId: f.task.taskId, runId: result.runId });
  assert.equal(terminal.status, "completed");
  assert.equal(terminal.authorizedTier, null);
  assert.throws(() => f.coordinator.assignedTask(), /assignment unavailable/);
});

test("changed final input denies terminal acceptance despite earlier PASS", async (t) => {
  const f = fixture(t);
  const host = concreteHost(f);
  const runner = new CheckedExecution({ coordinator: f.coordinator, root: f.root, host });
  const result = await runner.run(f.request);
  assert.equal((await runner.completion({ taskId: f.task.taskId, runId: result.runId })).status, "PASS");
  writeFileSync(join(f.root, "new-input.txt"), "changed after read-only assessment");
  await assert.rejects(runner.terminate({ taskId: f.task.taskId, runId: result.runId }), /evidence rejected/);
  assert.equal(f.coordinator.task(f.task.taskId).status, "active");
});

for (const status of ["failed", "cancelled"]) {
  test(`${status} terminal cleanup requires approval but not passing validation`, async (t) => {
    const f = fixture(t);
    const host = concreteHost(f);
    const runner = new CheckedExecution({ coordinator: f.coordinator, root: f.root, host });
    const terminal = await runner.terminate({ taskId: f.task.taskId, status,
      approvalReference: `fixture-owner-${status}` });
    assert.equal(terminal.status, status);
    assert.equal(terminal.authorizedTier, null);
    assert.equal(f.coordinator.db.prepare("SELECT count(*) AS n FROM runs").get().n, 0);
  });
}

test("concrete adapter readiness declaration grants no activation or approval", (t) => {
  const f = fixture(t);
  const args = { root: f.root, directory: join(f.directory, "unapproved"),
    tiers: f.host.tiers, policyInputs: f.host.policyInputs, parameters: f.host.parameters,
    environment: { identity: "fixture-v1", externalState: "none", resetPolicy: "none" } };
  assert.match(policyDeclaration(args).activation, /requires independent/);
  assert.throws(() => createLocalHost(args), /policy acceptance unavailable/);
});

test("three registered isolation attempts are durable and a fourth is denied", async (t) => {
  const failure = { suite: "fixture", test: "failing-test", signature: "expected true",
    variant: "unit", environment: "fixture" };
  const step = { name: "failure", kind: "test", timeoutMs: 3000, minimumTests: 1,
    report: "report.json", command: [process.execPath, "-e",
      `require('fs').writeFileSync('report.json',JSON.stringify(${JSON.stringify({
        tests: 1, skipped: 0, failures: [failure],
      })}));process.exit(1)`] };
  const f = fixture(t, [step]);
  const spec = { safe: true, purpose: "diagnostic_retry", failureDigest: digest(failure), step };
  f.host.tiers.fixture.diagnostics = { isolated: spec };
  const changed = f.coordinator.requestChange({ taskId: f.task.taskId, expectedVersion: 1,
    config: { ...f.task, planVersion: 2, tierDefinitionDigest: digest(f.host.tiers.fixture) }, key: "diagnostic-proposal" });
  f.coordinator.resolveChange({ taskId: f.task.taskId, expectedVersion: changed.authorizationVersion,
    accept: true, approvalReference: "fixture-diagnostic-policy-review", key: "diagnostic-accept" });
  f.coordinator.control.diagnostic = ({ diagnostic }) => ({ safe: true,
    capabilityDigest: digest(spec), failureDigest: diagnostic.failureDigest,
    selectorDigest: diagnostic.selectorDigest });
  const initial = await f.runner.run(f.request);
  const diagnostic = { initialRunId: initial.runId, failure, selector: "isolated" };
  const attempts = await f.runner.retryThree(f.request, diagnostic);
  assert.equal(attempts.attempts.length, 3);
  assert.ok(attempts.attempts.every((attempt) => attempt.evidence.purpose === "diagnostic_retry"));
  await assert.rejects(f.runner.run(f.request, diagnostic), /three diagnostic retries/);
  await assert.rejects(f.runner.completion({ taskId: f.task.taskId,
    runId: attempts.attempts[0].runId }), /required run unavailable/);
});

test("registered earlier comparison is isolated, bounded and not completion evidence", async (t) => {
  const failure = { suite: "fixture", test: "failing", signature: "same failure",
    variant: "unit", environment: "fixture-v1" };
  const step = { name: "failure", kind: "test", timeoutMs: 3000, minimumTests: 1, report: "report.json",
    command: [process.execPath, "-e", `require('fs').writeFileSync('report.json',JSON.stringify(${JSON.stringify({
      tests: 1, skipped: 0, failures: [failure],
    })}));process.exit(1)`] };
  const f = fixture(t, [step]);
  const earlierRoot = join(f.directory, "earlier");
  cpSync(f.root, earlierRoot, { recursive: true });
  const environment = { identity: "fixture-v1", externalState: "none", resetPolicy: "none" };
  const earlier = inputManifest({ root: earlierRoot, exclusions: ["report.json"], environment });
  const spec = { safe: true, purpose: "provenance_comparison", failureDigest: digest(failure),
    earlierSnapshotDigest: earlier.digest, environmentDigest: digest(environment), step };
  f.host.tiers.fixture.comparisons = { prior: spec };
  const proposal = f.coordinator.requestChange({ taskId: f.task.taskId, expectedVersion: 1,
    config: { ...f.task, planVersion: 2, tierDefinitionDigest: digest(f.host.tiers.fixture) }, key: "comparison-proposal" });
  f.coordinator.resolveChange({ taskId: f.task.taskId, expectedVersion: proposal.authorizationVersion,
    accept: true, approvalReference: "fixture-comparison-review", key: "comparison-accept" });
  f.coordinator.control.comparison = ({ comparison }) => ({ ...comparison, safe: true,
    verifiedEarlierUnaffected: true, environmentApplicable: true,
    capabilityDigest: digest(spec), maxAttempts: 1 });
  const host = concreteHost(f, {
    earlierSnapshot: () => ({ root: earlierRoot, environment, exclusions: ["report.json"] }),
  });
  const runner = new CheckedExecution({ coordinator: f.coordinator, root: f.root, host });
  const initial = await runner.run(f.request);
  const comparison = { initialRunId: initial.runId, failure, selector: "prior" };
  const result = await runner.compareEarlier(f.request, comparison);
  assert.equal(result.evidence.purpose, "provenance_comparison");
  assert.equal(result.evidence.snapshotDigest, earlier.digest);
  assert.notEqual(result.evidence.snapshotRoot, earlierRoot);
  assert.equal(result.rawExitCode, 1);
  await assert.rejects(runner.compareEarlier(f.request, comparison), /attempt limit/);
  await assert.rejects(runner.completion({ taskId: f.task.taskId, runId: result.runId }), /required run unavailable/);
});

test("actual runtime mapping preserves all argv, tiers, resource budgets and audit thresholds", () => {
  const manifest = JSON.parse(readFileSync("docs/validation/manifest.json", "utf8"));
  const { tiers, unsupported } = adaptRuntimeTiers({ root: process.cwd() });
  for (const [name, tier] of Object.entries(manifest.tiers)) {
    assert.equal(tiers[name].resource, tier.resource);
    assert.equal(tiers[name].priority, tier.priority);
    assert.equal(tiers[name].timeoutMs, tier.timeoutMs);
    assert.deepEqual(tiers[name].steps.map(({ name, kind, command }) => ({ name, kind, command })),
      tier.steps.map(({ name, kind, command }) => ({ name, kind, command })));
  }
  assert.ok(!unsupported.some(({ tier }) => ["test-fast", "test-standard", "test-standard-plus"].includes(tier)));
  assert.deepEqual(unsupported, []);
  assert.equal(tiers["test-heavy"].steps.length, manifest.tiers["test-heavy"].steps.length);
  assert.equal(tiers["test-heavy"].steps.find(({ name }) => name === "browser-tests")
    .reportAdapter.kind, "playwright-json-v1");
  assert.equal(tiers["test-heavy"].steps.find(({ name }) => name === "nested-tier-regression")
    .reportAdapter.kind, "reentrancy-assertions-v1");
  assert.equal(tiers["test-standard"].steps.find(({ name }) => name === "clerk-release-contract")
    .reportAdapter.expectedRuns, 2);
});

test("Node machine-summary capture rejects partial npm chains, truncation and zero discovery", () => {
  const step = { name: "compound", reportAdapter: { kind: "node-console-v1", expectedRuns: 2 } };
  const summary = "TAP version 13\nok 1 - owned repair\nnot ok 2 - unrelated failure\n" +
    "# tests 2\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n";
  const partial = parseRuntimeReport({ output: summary, step, environment: "fixture" });
  assert.equal(partial.complete, false);
  assert.equal(partial.failures.length, 1);
  assert.equal(partial.passedTests[0].test, "owned repair");
  const result = parseRuntimeReport({ output: summary + summary, step, environment: "fixture" });
  assert.equal(result.tests, 4);
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.every(({ signature }) => /^sha256:[a-f0-9]{64}$/.test(signature)));
  assert.notEqual(result.passedTests[0].variant, result.passedTests[1].variant);
  assert.throws(() => parseRuntimeReport({ output: summary + summary, step, truncated: true }), /truncated/);
  const zero = summary.replace("# tests 2", "# tests 0").replace("# pass 1", "# pass 0").replace("# fail 1", "# fail 0");
  assert.throws(() => parseRuntimeReport({ output: zero + zero, step }), /identity count mismatch|discovery/);
  assert.throws(() => parseRuntimeReport({ output: summary.replace("ok 1 - owned repair\n", ""), step }),
    /identity count mismatch/);
  const spec = "✔ a named test (1.24ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\n";
  assert.equal(parseRuntimeReport({ output: spec, step: {
    ...step, reportAdapter: { kind: "node-console-v1", expectedRuns: 1 },
  } }).passedTests[0].test, "a named test");
  const nested = "TAP version 13\n# Subtest: invariant suite\n" +
    "    # Subtest: owned repair\n    ok 1 - owned repair\n" +
    "    # Subtest: other case\n    not ok 2 - other case\n" +
    "not ok 1 - invariant suite\n# tests 2\n# pass 1\n# fail 1\n" +
    "# cancelled 0\n# skipped 0\n# todo 0\n";
  // A failing suite row is the aggregate result, not a new failure identity.
  const nestedReport = parseRuntimeReport({ output: nested, step: {
    ...step, reportAdapter: { kind: "node-console-v1", expectedRuns: 1 },
  }, environment: "fixture" });
  assert.deepEqual(nestedReport.passedTests.map(({ test }) => test), ["invariant suite > owned repair"]);
  assert.deepEqual(nestedReport.failures.map(({ test }) => test), ["invariant suite > other case"]);
});

test("serial-lock summary requires matching named passing and failing cases", () => {
  const step = { name: "serial-lock-tests", reportAdapter: {
    kind: "serial-lock-summary-v1", expectedRuns: 1,
  } };
  const output = "  PASS  first lock check\n  FAIL  second lock check\nResults: 1 passed, 1 failed\n";
  const report = parseRuntimeReport({ output, step, environment: "fixture" });
  assert.equal(report.passedTests[0].test, "first lock check");
  assert.equal(report.failures[0].test, "second lock check");
  assert.throws(() => parseRuntimeReport({ output: output.replace("  PASS  first lock check\n", ""),
    step }), /identity count mismatch/);
});

test("actual Node report capture runs unchanged argv and excludes raw secrets from evidence", async (t) => {
  const step = { name: "node-report", kind: "test", command: [process.execPath, "--test", "actual.test.mjs"],
    timeoutMs: 3000, report: "test-results/failure-gate/node-report.json", minimumTests: 1,
    reportAdapter: { kind: "node-console-v1", expectedRuns: 1 } };
  const f = fixture(t, [step]);
  writeFileSync(join(f.root, "actual.test.mjs"),
    "import test from 'node:test'; test('passes', () => console.log('fixture-secret-never-retain'));");
  const result = await f.runner.run(f.request);
  assert.equal(result.rawExitCode, 0);
  assert.equal(result.evidence.steps[0].report.tests, 1);
  assert.equal(result.evidence.steps[0].report.passedTests[0].test, "passes");
  assert.equal(JSON.stringify(result.evidence).includes("fixture-secret-never-retain"), false);
  assert.deepEqual(result.evidence.steps[0].command, step.command);
});

test("reentrancy report binds every named assertion, refuses partial and duplicate output", () => {
  const step = { name: "nested-tier-regression", reportAdapter: { kind: "reentrancy-assertions-v1" } };
  const checks = [
    "nested validation exited 0", "outer run reached its manifest step",
    "nested tier reached its manifest step", "nested tier did not inherit the outer task plan",
    "nested tier used the owned reentrancy path", "nested tier did not wait behind its owning lock",
    "nested manifest step ran exactly once",
  ];
  const output = checks.map((name) => `  PASS: ${name}\n`).join("") +
    "[ci-collision-test] Non-smoke reentrancy regression passed.\n";
  const result = parseRuntimeReport({ output, step, environment: "fixture" });
  assert.equal(result.tests, 7);
  assert.equal(result.complete, true);
  assert.deepEqual(result.passedTests.map(({ test }) => test), checks);
  assert.equal(parseRuntimeReport({ output: output.replace(`  PASS: ${checks[2]}\n`, ""),
    step }).complete, false);
  assert.throws(() => parseRuntimeReport({ output: output + `  PASS: ${checks[0]}\n`, step }), /duplicate/);
  const failed = parseRuntimeReport({ output: output.replace(`PASS: ${checks[0]}`, `FAIL: ${checks[0]} (got 1)`)
    .replace("Non-smoke reentrancy regression passed.", ""), step, environment: "fixture" });
  assert.equal(failed.failures[0].test, checks[0]);
  assert.equal(failed.complete, true);
  assert.throws(() => parseRuntimeReport({ output, step, truncated: true }), /truncated/);
});

test("Playwright report discovers per-project tests and blocks incomplete, skipped or stale reports", (t) => {
  const root = mkdtempSync(join(tmpdir(), "playwright-report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "test-results/failure-gate/playwright.json");
  mkdirSync(dirname(path), { recursive: true });
  const step = { name: "browser-tests", reportAdapter: { kind: "playwright-json-v1" } };
  const report = {
    suites: [{ title: "sample.spec.ts", specs: [{ title: "works", tests: [
      { projectName: "chromium", status: "expected", results: [{ status: "passed" }] },
      { projectName: "mobile-webkit", status: "unexpected",
        results: [{ status: "failed", errors: [{ message: "secret-not-retained" }] }] },
    ] }] }],
    stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
  };
  const parse = () => parseRuntimeReport({ output: "browser runner", step, root, environment: "fixture" });
  assert.throws(parse, /ENOENT/);
  writeFileSync(path, JSON.stringify(report));
  const result = parse();
  assert.equal(result.tests, 2);
  assert.equal(result.complete, true);
  assert.deepEqual(result.passedTests.map(({ test }) => test), ["chromium: sample.spec.ts > works"]);
  assert.equal(result.failures[0].test, "mobile-webkit: sample.spec.ts > works");
  assert.equal(JSON.stringify(result).includes("secret-not-retained"), false);
  report.stats.skipped = 1;
  writeFileSync(path, JSON.stringify(report));
  assert.throws(parse, /discovery mismatch/);
  report.stats.skipped = 0;
  report.suites[0].specs[0].tests.push(report.suites[0].specs[0].tests[0]);
  writeFileSync(path, JSON.stringify(report));
  assert.throws(parse, /duplicate/);
  assert.throws(() => parseRuntimeReport({ output: "", step, root, truncated: true }), /truncated/);
});

test("real Playwright reporter preserves earlier candidate reports when clearing its artifacts", (t) => {
  assert.match(readFileSync("playwright.config.ts", "utf8"),
    /outputDir:\s*"test-results\/playwright-artifacts"/);
  const root = mkdtempSync(join(tmpdir(), "playwright-survival-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "cases"));
  mkdirSync(join(root, "test-results/failure-gate"), { recursive: true });
  symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
  const sentinel = join(root, "test-results/failure-gate/earlier.json");
  writeFileSync(sentinel, '{"tests":1,"skipped":0,"failures":[]}\n');
  writeFileSync(join(root, "cases/example.spec.mjs"),
    "import { test } from '@playwright/test'; test('named case', () => {});\n");
  writeFileSync(join(root, "playwright.config.mjs"), `export default {
    testDir: "./cases",
    outputDir: "./test-results/playwright-artifacts",
    projects: [{ name: "chromium" }],
    reporter: [["json", { outputFile: "./test-results/failure-gate/playwright.json" }]],
  };\n`);
  const result = spawnSync(process.execPath, [
    join(process.cwd(), "node_modules/@playwright/test/cli.js"), "test",
    "--config", join(root, "playwright.config.mjs"),
  ], { cwd: root, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(sentinel, "utf8"), '{"tests":1,"skipped":0,"failures":[]}\n');
  const report = parseRuntimeReport({ output: result.stdout, root, environment: "fixture",
    step: { name: "browser-tests", reportAdapter: { kind: "playwright-json-v1" } } });
  assert.equal(report.tests, 1);
  assert.equal(report.passedTests[0].test, "chromium: example.spec.mjs > named case");
});