import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync,
  cpSync, symlinkSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { emptyRegistry, readRegistry, taskState, pins, hash, TIERS, compareRegistry,
  mergeGuard, withWriter, validateRegistry, git } from "../lib/unified-gate/store.mjs";
import { provision, amend, guard, restorePlan, cancel, classifyFailure, prepareDraft,
  baselineWarnings } from "../lib/unified-gate/plans.mjs";
import { run, classificationLog } from "../lib/unified-gate/execution.mjs";

const project = resolve(import.meta.dirname, "../..");
function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
}
function fixture(t, { timeoutMs = 3000, command = [process.execPath, "-e",
  "require('fs').writeFileSync('.local/executed','yes')"], extra = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "unified-gate-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // A directory-only pattern would not ignore this fixture's dependency symlink.
  write(root, ".gitignore", ".local/\nnode_modules\n");
  const source = "# Setup fixture contract\n";
  const pin = hash(source);
  write(root, ".agents/skills/failure-gate-unified/SKILL.md", source);
  write(root, `docs/validation/unified-revisions/${pin}.txt`, source);
  write(root, "docs/validation/unified-pin.json", { schemaVersion: 1,
    source: ".agents/skills/failure-gate-unified/SKILL.md", current: pin,
    revisions: { [pin]: `docs/validation/unified-revisions/${pin}.txt` } });
  write(root, "docs/validation/unified-registry.json", emptyRegistry());
  write(root, "docs/validation/failure-baseline.json", { schemaVersion: 1, records: [] });
  write(root, "docs/validation/manifest.json", { tiers: Object.fromEntries(TIERS.map((tier) =>
    [tier, { timeoutMs, steps: [{ name: "fixture-probe", kind: "test", command }, ...extra] }])) });
  cpSync(join(project, "scripts/lib/unified-gate"), join(root, "scripts/lib/unified-gate"), { recursive: true });
  for (const name of ["baseline.mjs", "owned-process-group.mjs", "tiers.mjs"]) copyFileSync(join(project, "scripts/lib", name), join(root, "scripts/lib", name));
  copyFileSync(join(project, "scripts/unified-gate.mjs"), join(root, "scripts/unified-gate.mjs"));
  copyFileSync(join(project, "scripts/unified-step.mjs"), join(root, "scripts/unified-step.mjs"));
  copyFileSync(join(project, "scripts/run-tier.mjs"), join(root, "scripts/run-tier.mjs"));
  symlinkSync(join(project, "node_modules"), join(root, "node_modules"), "dir");
  const execute = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 3000 });
    assert.equal(result.status, 0, result.stderr);
  };
  execute(["init", "-q"]);
  execute(["config", "user.email", "fixture@example.invalid"]);
  execute(["config", "user.name", "Gate fixture"]);
  execute(["add", "."]); execute(["commit", "-qm", "fixture seed"]);
  return root;
}
function spec(tier = "test-fast") {
  return { title: "Fixture task only", scope: "Exercise only a bounded temporary setup probe.",
    tier, why: "The fixture test verifies the gate contract.",
    coverage: "fixture-probe in the fixture manifest", ignoredBaselines: [], ownedBaselines: [],
    approval: { reference: "fixture-only owner instruction", direction: "Run this temporary setup probe",
      applicability: "This approval covers this fixture specification and its selected tier." },
    assertions: [{ requirement: "Reject unauthorized validation", check: "Bound fixture probe and guard assertions" }] };
}
function modular(root, observed = true) {
  const pinPath = "docs/validation/unified-pin.json";
  const pin = JSON.parse(readFileSync(join(root, pinPath)));
  const packagePath = ".agents/skills/failure-gate-unified";
  cpSync(join(project, packagePath), join(root, packagePath), { recursive: true });
  const current = JSON.parse(readFileSync(join(project, pinPath))).current;
  const directory = `docs/validation/unified-revisions/${current}`;
  cpSync(join(project, packagePath), join(root, directory), { recursive: true });
  write(root, pinPath, { ...pin, schemaVersion: 2, current,
    acceptance: { state: observed ? "OBSERVED" : "NOT_OBSERVED",
      evidence: "Disposable fixture only, not actual host acceptance" },
    revisions: { ...pin.revisions, [current]: { kind: "normative-package", directory } } });
}
function modularSpec() {
  return { ...spec(), claim: "stable-fixture-local-claim",
    regressionGuard: "Normal: changed reference must block admission; contract tamper fixture asserts rejection before workload." };
}
function installRegression(root) {
  for (const directory of [".agents/skills/regression-guard", "docs/validation/regression-guard-revisions"]) {
    cpSync(join(project, directory), join(root, directory), { recursive: true });
  }
  copyFileSync(join(project, "docs/validation/regression-guard-pin.json"),
    join(root, "docs/validation/regression-guard-pin.json"));
  const pin = JSON.parse(readFileSync(join(root, "docs/validation/unified-pin.json")));
  pin.regressionGuard = JSON.parse(readFileSync(join(root, "docs/validation/regression-guard-pin.json"))).current;
  write(root, "docs/validation/unified-pin.json", pin);
}
const normalGuard = () => ({ form: "normal", material: true,
  rationale: "Admission validation changes an existing enforcement boundary.",
  covers: "A material repair with an empty guard must not reach execution.",
  testLocation: "scripts/__tests__/unified-gate.test.mjs — rejects incomplete guards",
  assertion: "Reject the candidate and leave the prior sealed plan bytes unchanged." });
test("Regression Guard forms round-trip; invalid amendments preserve seals and historical plans", async (t) => {
  const root = fixture(t);
  const old = await provision(root, spec());
  installRegression(root);
  assert.equal(guard(root, ctx(old)).plan, old.plan);
  const input = { ...spec(), regression: normalGuard() };
  const draft = prepareDraft(root, input);
  assert.match(draft.plan, /\*\*Covers:\*\*/);
  assert.ok(draft.plan.includes(normalGuard().rationale));
  write(root, "guard-spec.json", input);
  const draftRegistry = JSON.stringify(readRegistry(root));
  assert.equal(cli(root, ["draft", "--spec", "guard-spec.json"]).status, 0);
  assert.equal(JSON.stringify(readRegistry(root)), draftRegistry);
  write(root, "duplicate-spec.json", JSON.stringify(input).replace(
    '"form":"normal"', '"form":"normal","form":"normal"'));
  const duplicate = cli(root, ["draft", "--spec", "duplicate-spec.json"]);
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /duplicate JSON field/);
  assert.throws(() => prepareDraft(root, { ...input,
    scope: input.scope + "\n## Regression Guard\nAn injected duplicate section." }), /duplicate/);
  const state = await provision(root, input);
  const original = JSON.stringify(readRegistry(root));
  for (const regression of [undefined, {}, { ...normalGuard(), covers: "TODO" },
    { ...normalGuard(), form: "self" }, { ...normalGuard(), extra: "mixed" },
    { form: "deferred", material: true, rationale: "Wait for proposed future tests." },
    { ...normalGuard(), testLocation: "../unsafe.test.js" }]) {
    await assert.rejects(amend(root, state.id, { ...input, regression }, "fixture invalid amendment"), /Regression Guard/);
    assert.equal(JSON.stringify(readRegistry(root)), original);
    assert.equal(readFileSync(join(root, state.planPath), "utf8"), state.plan);
  }
  for (const regression of [
    { form: "self", material: false, rationale: "Only adds the test for otherwise unchanged behavior.",
      testLocation: normalGuard().testLocation, assertion: normalGuard().assertion },
    { form: "excluded", material: false, rationale: "Only changes comments; no executable behavior is modified.", category: "internal" },
    { form: "na", material: true, rationale: "Entire feature is removed without any surviving recurrence path.",
      category: "removed", scenario: "The obsolete read-only information panel is entirely removed.",
      evidence: "No handlers or data side effects remain in the inspected scope.",
      alternatives: "Surviving navigation is separately covered by its existing case.",
      residualRisk: "Manual confirmation of the removed panel remains documented." },
  ]) {
    const next = await amend(root, state.id, { ...input, regression }, "fixture supported form");
    assert.equal(guard(root, ctx(next)).spec.regression.form, regression.form);
  }
});
test("Regression Guard full pin and actual CLI/exported routes reject drift without plan mutation", async (t) => {
  const root = fixture(t); modular(root); installRegression(root);
  const state = await provision(root, { ...modularSpec(), regression: normalGuard() });
  assert.equal(cli(root, ["guard", "--id", state.id, "--tier", state.tier], state).status, 0);
  assert.equal(exportedRunWithoutHostIntegration(root, state).status, 0);
  for (const name of ["SKILL.md", "reference/enforcement-contract.md", "reference/delivery-handoff.md"]) {
    const path = join(root, ".agents/skills/regression-guard", name);
    const bytes = readFileSync(path);
    writeFileSync(path, Buffer.concat([bytes, Buffer.from("drift")]));
    assert.throws(() => prepareDraft(root, { ...spec(), regression: normalGuard() }), /contract drift/);
    assert.equal(cli(root, ["guard", "--id", state.id, "--tier", state.tier], state).status, 2);
    assert.equal(exportedRunWithoutHostIntegration(root, state).status, 2);
    assert.equal(readFileSync(join(root, state.planPath), "utf8"), state.plan);
    writeFileSync(path, bytes);
  }
  const pin = JSON.parse(readFileSync(join(root, "docs/validation/regression-guard-pin.json")));
  const snapshot = join(root, pin.revisions[pin.current], "reference/delivery-handoff.md");
  writeFileSync(snapshot, "changed snapshot");
  assert.throws(() => guard(root, ctx(state)), /contract drift/);
  rmSync(join(root, "docs/validation/regression-guard-pin.json"));
  assert.throws(() => prepareDraft(root, { ...spec(), regression: normalGuard() }), /mapping unavailable/);
});
test("modular draft is read-only without approval or admission capability; denied admission consumes no ID", async (t) => {
  const root = fixture(t);
  modular(root, false);
  const before = readFileSync(join(root, "docs/validation/unified-registry.json"), "utf8");
  const input = modularSpec(); delete input.approval;
  const draft = prepareDraft(root, input);
  assert.equal(draft.status, "UNADMITTED_NATIVE_DRAFT");
  assert.match(draft.plan, /Regression Guard/);
  assert.doesNotMatch(draft.plan, /strictly bound|TASK_ID=UNADMITTED/);
  assert.equal(existsSync(join(root, ".local")), false);
  await assert.rejects(provision(root, modularSpec()), /NOT_OBSERVED/);
  assert.equal(readFileSync(join(root, "docs/validation/unified-registry.json"), "utf8"), before);
  assert.equal(existsSync(join(root, ".local")), false);
});
test("full modular pin detects core, each reference, and snapshot tampering; historical seals are unchanged", async (t) => {
  const root = fixture(t);
  const old = await provision(root, spec());
  const original = JSON.stringify(readRegistry(root));
  modular(root);
  assert.equal(guard(root, ctx(old)).planHash, old.planHash);
  assert.equal(JSON.stringify(readRegistry(root)), original);
  const pin = pins(root);
  for (const name of ["SKILL.md", "references/gate-maintenance.md", "references/planning-and-publication.md"]) {
    for (const directory of [".agents/skills/failure-gate-unified", pin.revisions[pin.current].directory]) {
      const path = join(root, directory, name);
      const bytes = readFileSync(path);
      writeFileSync(path, Buffer.concat([bytes, Buffer.from("\nchanged")]));
      assert.throws(() => pins(root), /normative contract mismatch/);
      writeFileSync(path, bytes);
    }
  }
});
test("modular local claims reconcile retries without duplicate IDs and run via CLI and exported API without native evidence", async (t) => {
  const root = fixture(t); modular(root);
  const input = modularSpec();
  const state = await provision(root, input);
  assert.equal((await provision(root, input)).id, state.id);
  await assert.rejects(provision(root, { ...input, scope: "Different local work" }), /different work/);
  assert.equal(readRegistry(root).tombstones.length, 1);
  assert.equal(cli(root, ["run", "--id", state.id, "--tier", state.tier], state).status, 0);
  assert.equal(exportedRunWithoutHostIntegration(root, state).status, 0);
  const denied = exportedRunWithoutHostIntegration(root, state, "test-heavy");
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /wrong tier/);
});
test("modular interrupted and concurrent claim retries preserve exactly one identity", async (t) => {
  const root = fixture(t); modular(root);
  const input = modularSpec();
  // Controlled generation failure after durable reservation.
  mkdirSync(join(root, ".local"), { recursive: true });
  writeFileSync(join(root, ".local/tasks"), "blocks generation");
  await assert.rejects(provision(root, input));
  const reserved = readRegistry(root).tombstones[0];
  rmSync(join(root, ".local/tasks"));
  const resumed = await provision(root, input);
  assert.equal(resumed.id, reserved);
  write(root, "spec.json", input);
  const launch = () => {
    const child = spawn(process.execPath, ["scripts/unified-gate.mjs", "new", "--spec", "spec.json"],
      { cwd: root, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    return once(child, "exit");
  };
  const results = await Promise.all([launch(), launch()]);
  assert.ok(results.every(([code]) => code === 0));
  assert.equal(readRegistry(root).tombstones.length, 1);
});
const ctx = (s) => ({ id: s.id, tier: s.tier, planFile: s.planPath });
function current(root, id) { return taskState(readRegistry(root).tasks[id]); }
function cli(root, args, state) {
  return spawnSync(process.execPath, ["scripts/unified-gate.mjs", ...args], {
    cwd: root, encoding: "utf8", timeout: 6000,
    env: { PATH: process.env.PATH, ...(state ? { TASK_ID: state.id, TASK_PLAN_FILE: state.planPath } : {}) },
  });
}
function exportedRunWithoutHostIntegration(root, state, tier = state.tier) {
  const executionUrl = pathToFileURL(join(root, "scripts/lib/unified-gate/execution.mjs")).href;
  const source = `
    import { run } from ${JSON.stringify(executionUrl)};
    const root = ${JSON.stringify(root)};
    const context = ${JSON.stringify({ id: state.id, tier, planFile: state.planPath })};
    try { console.log(JSON.stringify(await run(root, context))); }
    catch (error) {
      console.error(JSON.stringify({ state: "BLOCKED", reason: error.message }));
      process.exitCode = 2;
    }
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: root, encoding: "utf8", timeout: 6000, env: { PATH: process.env.PATH },
  });
}
function configureDistinctFixtureTiers(root) {
  const manifestPath = join(root, "docs/validation/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.tiers["test-fast"].steps = [{
    name: "fixture-probe", kind: "test",
    command: [process.execPath, "-e", "require('fs').writeFileSync('.local/assigned-tier','ran')"],
  }];
  for (const tier of TIERS.filter((name) => name !== "test-fast")) {
    manifest.tiers[tier].steps = [{
      name: `unassigned-${tier}`, kind: "test",
      command: [process.execPath, "-e", "require('fs').writeFileSync('.local/unassigned-tier','ran')"],
    }];
  }
  write(root, "docs/validation/manifest.json", manifest);
}

test("provisioning creates a UUID, permanent reservation, one binding, exact sections and stubs", async (t) => {
  const root = fixture(t);
  const state = await provision(root, spec());
  assert.match(state.id, /^[a-f0-9-]{36}$/);
  assert.equal(state.revision, 1);
  assert.equal(state.pin, pins(root).current);
  for (const phrase of ["## Pre-existing failures to ignore", "**Flaky-test rule:**",
    "## Validation", "**Command:** `test-fast`", "**Coverage evidence:**", "**Do not switch tiers:**"]) {
    assert.ok(state.plan.includes(phrase), phrase);
  }
  assert.ok(readRegistry(root).tombstones.includes(state.id));
  assert.equal(guard(root, ctx(state)).id, state.id);
  assert.equal(JSON.parse(readFileSync(join(root, `.local/tasks/${state.id}.stubs.json`))).id, state.id);
});

test("wrong tier, unknown ID, context mismatch, changed plan and changed stubs block before workload", async (t) => {
  const root = fixture(t), state = await provision(root, spec());
  await assert.rejects(run(root, { ...ctx(state), tier: "test-heavy" }), /wrong tier/);
  await assert.rejects(run(root, { ...ctx(state), id: "922" }), /unprovisioned/);
  await assert.rejects(run(root, { ...ctx(state), planFile: ".local/tasks/other.md" }), /context/);
  write(root, state.planPath, state.plan + "\nchanged");
  await assert.rejects(run(root, ctx(state)), /sealed plan/);
  await restorePlan(root, state.id);
  write(root, `.local/tasks/${state.id}.stubs.json`, "{}");
  await assert.rejects(run(root, ctx(state)), /stubs/);
  assert.equal(existsSync(join(root, ".local/executed")), false);
});

test("CLI and exported runner work without native integration and preserve local plan/tier denials", async (t) => {
  const root = fixture(t);
  configureDistinctFixtureTiers(root);
  const state = await provision(root, spec());
  const status = cli(root, ["status"]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(JSON.parse(status.stdout).enforcement, /local sealed-plan and assigned-tier checks only/);

  const cliResult = cli(root, ["run", "--tier", state.tier], state);
  assert.equal(cliResult.status, 0, cliResult.stderr);
  const cliRun = JSON.parse(cliResult.stdout);
  assert.equal(cliRun.state, "PASS");
  assert.deepEqual(cliRun.observations.map((observation) => observation.name), ["fixture-probe"]);
  assert.match(readFileSync(join(root, ".local/assigned-tier"), "utf8"), /ran/);
  assert.equal(existsSync(join(root, ".local/unassigned-tier")), false);
  assert.doesNotMatch(cliResult.stdout, /native.{0,40}(verified|approved|admitted)/i);

  const exportedResult = exportedRunWithoutHostIntegration(root, state);
  assert.equal(exportedResult.status, 0, exportedResult.stderr);
  const exportedRun = JSON.parse(exportedResult.stdout);
  assert.equal(exportedRun.state, "PASS");
  assert.deepEqual(exportedRun.observations.map((observation) => observation.name), ["fixture-probe"]);
  assert.equal(existsSync(join(root, ".local/unassigned-tier")), false);
  assert.doesNotMatch(exportedResult.stdout, /native.{0,40}(verified|approved|admitted)/i);

  const wrongTierCli = cli(root, ["run", "--tier", "test-heavy"], state);
  assert.equal(wrongTierCli.status, 2);
  assert.match(wrongTierCli.stderr, /wrong tier/);
  const wrongTierExport = exportedRunWithoutHostIntegration(root, state, "test-heavy");
  assert.equal(wrongTierExport.status, 2);
  assert.match(wrongTierExport.stderr, /wrong tier/);
  assert.equal(existsSync(join(root, ".local/unassigned-tier")), false);

  write(root, state.planPath, state.plan + "\nchanged");
  const stalePlanCli = cli(root, ["run", "--tier", state.tier], state);
  assert.equal(stalePlanCli.status, 2);
  assert.match(stalePlanCli.stderr, /sealed plan changed or stale/);
  const stalePlanExport = exportedRunWithoutHostIntegration(root, state);
  assert.equal(stalePlanExport.status, 2);
  assert.match(stalePlanExport.stderr, /sealed plan changed or stale/);
  assert.equal(existsSync(join(root, ".local/unassigned-tier")), false);
});

test("invalid or unavailable baseline is never an empty catalog; malformed declarations cannot publish", async (t) => {
  const root = fixture(t);
  write(root, "docs/validation/failure-baseline.json", "{broken");
  await assert.rejects(provision(root, spec()), /baseline/);
  assert.equal(Object.keys(readRegistry(root).tasks).length, 0);
  write(root, "docs/validation/failure-baseline.json", { schemaVersion: 1, records: [] });
  const invalid = spec(); invalid.coverage = "invented workload";
  await assert.rejects(provision(root, invalid), /real selected-tier step/);
});

test("failed generation keeps the reservation and same-work retry completes it", async (t) => {
  const root = fixture(t);
  // Block the plan parent only after specification validation.
  write(root, ".local/tasks", "not a directory");
  await assert.rejects(provision(root, spec()), /ENOTDIR|EEXIST/);
  const registry = readRegistry(root), id = Object.keys(registry.tasks)[0];
  assert.equal(registry.tombstones.length, 1);
  assert.equal(current(root, id).status, "reserved");
  const changed = spec(); changed.scope = "Different fixture scope";
  await assert.rejects(provision(root, changed, id), /different work/);
  rmSync(join(root, ".local/tasks"));
  assert.equal((await provision(root, spec(), id)).id, id);
});

test("supported amendments re-seal changed bindings/workloads, record rationale and reject stale contexts", async (t) => {
  const root = fixture(t), state = await provision(root, spec());
  const updated = await amend(root, state.id, spec("test-heavy"), "Fixture needs broader workload coverage");
  assert.equal(updated.id, state.id); assert.equal(updated.revision, 2);
  assert.throws(() => guard(root, ctx(state)), /wrong tier/);
  assert.equal(guard(root, ctx(updated)).tier, "test-heavy");
  const manifest = JSON.parse(readFileSync(join(root, "docs/validation/manifest.json")));
  manifest.tiers["test-heavy"].timeoutMs++;
  write(root, "docs/validation/manifest.json", manifest);
  assert.throws(() => guard(root, ctx(updated)), /workload changed/);
});

test("current-pin mismatch stops all operations; old sealed revisions survive legitimate pin updates", async (t) => {
  const root = fixture(t), state = await provision(root, spec());
  write(root, ".agents/skills/failure-gate-unified/SKILL.md", "new fixture contract\n");
  assert.throws(() => guard(root, ctx(state)), /current pin/);
  assert.equal(cli(root, ["status"]).status, 2);
  const pin = JSON.parse(readFileSync(join(root, "docs/validation/unified-pin.json")));
  const content = readFileSync(join(root, pin.source), "utf8"), newPin = hash(content);
  pin.current = newPin; pin.revisions[newPin] = `docs/validation/unified-revisions/${newPin}.txt`;
  write(root, pin.revisions[newPin], content); write(root, "docs/validation/unified-pin.json", pin);
  assert.equal(guard(root, ctx(state)).pin, state.pin);
  assert.equal((await provision(root, spec())).pin, newPin);
  write(root, pin.revisions[state.pin], "damaged historical bytes");
  assert.throws(() => guard(root, ctx(state)), /historical/);
});

test("fresh process and independent task-environment copy restore the same sealed plan without machine receipts", async (t) => {
  const root = fixture(t), state = await provision(root, spec());
  assert.equal(cli(root, ["guard", "--tier", state.tier], state).status, 0);
  const other = fixture(t);
  // Fixture sources/manifests/pins are deliberately identical; copy only the portable ledger.
  write(other, "docs/validation/unified-registry.json", readRegistry(root));
  assert.equal(cli(other, ["restore-plan", "--id", state.id]).status, 0);
  assert.equal(cli(other, ["guard", "--tier", state.tier], state).status, 0);
  assert.equal(cli(other, ["run", "--tier", state.tier], state).status, 0);
  assert.equal(current(other, state.id).runs.at(-1).state, "PASS");
});

test("full bound workload PASS has plan/pin/workload/target evidence; diagnostics never establish PASS", async (t) => {
  const root = fixture(t), state = await provision(root, spec());
  const result = await run(root, ctx(state));
  assert.equal(result.state, "PASS"); assert.equal(result.planHash, state.planHash);
  assert.equal(result.workloadHash, state.workloadHash); assert.ok(result.target.head);
  const diagnostic = await run(root, ctx(state), { stepName: "fixture-probe" });
  assert.equal(diagnostic.state, "INCOMPLETE"); assert.equal(diagnostic.purpose, "diagnostic");
});

test("failure and skipped later steps are not PASS", async (t) => {
  const root = fixture(t, { command: [process.execPath, "-e", "process.exit(3)"],
    extra: [{ name: "must-not-run", kind: "test", command: [process.execPath, "-e", "process.exit(0)"] }] });
  const state = await provision(root, spec()), result = await run(root, ctx(state));
  assert.equal(result.state, "FAIL"); assert.deepEqual(result.notReached, ["must-not-run"]);
});

test("timeout cleans stubborn children, reports INCOMPLETE and releases single-flight lock", async (t) => {
  const code = `const fs=require('fs'); process.on('SIGTERM',()=>{});
    fs.writeFileSync('.local/child.pid',String(process.pid)); setInterval(()=>{},100);`;
  const root = fixture(t, { timeoutMs: 250, command: [process.execPath, "-e", code] });
  const state = await provision(root, spec()), result = await run(root, ctx(state));
  assert.equal(result.state, "INCOMPLETE"); assert.equal(result.observations[0].timedOut, true);
  const pid = Number(readFileSync(join(root, ".local/child.pid"), "utf8"));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.equal(guard(root, ctx(state)).id, state.id);
  await withWriter(root, () => {});
});

test("single flight rejects another run and amendment while the first is supervised", async (t) => {
  const root = fixture(t, { command: [process.execPath, "-e",
    "require('fs').writeFileSync('.local/started','yes'); setTimeout(()=>{},1800)"] });
  const state = await provision(root, spec());
  const first = run(root, ctx(state));
  for (let i = 0; i < 50 && !existsSync(join(root, ".local/started")); i++) await delay(10);
  await assert.rejects(run(root, ctx(state)), /single flight/);
  await assert.rejects(amend(root, state.id, spec("test-heavy"), "Concurrent amendment is not safe"), /single flight/);
  assert.equal((await first).state, "PASS");
});

test("owner-direction closure preserves identity/history and cannot become PASS or execute", async (t) => {
  const root = fixture(t), state = await provision(root, spec());
  const closed = await cancel(root, state.id, { completionMode: "owner_direction",
    reason: "Retire this fixture", direction: "Owner instructs administrative closure", reference: "fixture conversation" });
  assert.equal(closed.closure.state, "INCOMPLETE"); assert.equal(closed.status, "closed");
  assert.equal(closed.closure.completionMode, "owner_direction");
  await assert.rejects(run(root, ctx(state)), /eligible/);
  assert.ok(readRegistry(root).tombstones.includes(state.id));
  await assert.rejects(amend(root, state.id, spec(), "Cannot reopen fixture"), /quiescent/);
});

test("merge guard preserves IDs/tombstones and permits only append-only supported transitions", async (t) => {
  const root = fixture(t), state = await provision(root, spec());
  git(root, ["add", "docs/validation/unified-registry.json"]);
  git(root, ["commit", "-qm", "fixture task record"]);
  const base = readRegistry(root);
  const noTask = structuredClone(base); delete noTask.tasks[state.id];
  assert.throws(() => compareRegistry(base, noTask), /disappeared/);
  const noStone = structuredClone(base); noStone.tombstones = [];
  assert.throws(() => compareRegistry(base, noStone), /tombstone/);
  const corrupt = structuredClone(base); corrupt.tasks[state.id].history[0].state.tier = "test-heavy";
  assert.throws(() => validateRegistry(corrupt), /event chain/);
  await amend(root, state.id, spec("test-standard"), "Fixture coverage update");
  mergeGuard(root, readRegistry(root));
  git(root, ["rm", "--cached", "docs/validation/unified-registry.json"]);
  assert.throws(() => mergeGuard(root, readRegistry(root), true), /Git index/);
});

test("exact baseline identity, warning-only maintenance and explicit classification logs", async (t) => {
  const root = fixture(t);
  const record = { id: "fixture-baseline", suite: "fixture-suite", test: "fixture test",
    signature: "exact assertion", status: "active", owner: "fixture",
    observedOn: "2020-01-01", verifiedOn: "2020-01-01", reviewBy: "2099-12-31" };
  write(root, "docs/validation/failure-baseline.json", { schemaVersion: 1, records: [record] });
  const input = spec(); input.ignoredBaselines = [record.id];
  const state = await provision(root, input);
  assert.equal(classifyFailure(root, state, record).classification, "IGNORED_BASELINE");
  assert.equal(classifyFailure(root, state, { ...record, signature: "different" }).classification, "POTENTIAL_REGRESSION");
  assert.throws(() => classifyFailure(root, state, { ...record, signature: "new" },
    { kind: "passing-retry", note: "the retry passed in isolation" }), /provenance/);
  const logged = await classificationLog(root, ctx(state), { ...record, signature: "new" },
    { kind: "documented-pattern", note: "Fixture report from before this change records the same assertion." });
  assert.equal(logged.state, "INCOMPLETE");
  assert.match(logged.classification.log, /^\[SELF-CLASSIFIED PRE-EXISTING\]/);
  record.reviewBy = "2020-02-01";
  write(root, "docs/validation/failure-baseline.json", { schemaVersion: 1, records: [record] });
  assert.ok(baselineWarnings(root).length > 0);
  assert.equal(guard(root, ctx(state)).id, state.id);
  assert.equal(classifyFailure(root, state, record).classification, "POTENTIAL_REGRESSION");
});

test("concurrent processes reserve distinct UUIDs without losing tasks or tombstones", async (t) => {
  const root = fixture(t);
  write(root, ".local/spec.json", spec());
  const allocate = async () => {
    const child = spawn(process.execPath, ["scripts/unified-gate.mjs", "new", "--spec", ".local/spec.json"],
      { cwd: root, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", errors = "";
    child.stdout.on("data", (v) => output += v); child.stderr.on("data", (v) => errors += v);
    const [code] = await once(child, "close"); assert.equal(code, 0, errors);
    return JSON.parse(output).id;
  };
  const ids = await Promise.all([allocate(), allocate()]);
  assert.equal(new Set(ids).size, 2);
  assert.equal(Object.keys(readRegistry(root).tasks).length, 2);
  assert.deepEqual(new Set(readRegistry(root).tombstones), new Set(ids));
});

test("abrupt runner loss leaves bounded supervision; recovery waits, records INCOMPLETE and preserves the seal", async (t) => {
  const root = fixture(t, { timeoutMs: 600, command: [process.execPath, "-e",
    "require('fs').writeFileSync('.local/orphan.pid',String(process.pid)); process.on('SIGTERM',()=>{});setInterval(()=>{},50)"] });
  const state = await provision(root, spec());
  const child = spawn(process.execPath, ["scripts/unified-gate.mjs", "run", "--tier", state.tier], {
    cwd: root, env: { PATH: process.env.PATH, TASK_ID: state.id, TASK_PLAN_FILE: state.planPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume(); child.stderr.resume();
  t.after(() => { if (child.exitCode === null && !child.killed) child.kill("SIGKILL"); });
  for (let i = 0; i < 100 && !existsSync(join(root, ".local/orphan.pid")); i++) await delay(10);
  assert.ok(existsSync(join(root, ".local/orphan.pid")));
  child.kill("SIGKILL"); await once(child, "exit");
  await assert.rejects(run(root, ctx(state), { recoverOnly: true }), /deadline/);
  assert.throws(() => guard(root, ctx(state)), /unresolved/);
  await delay(3700);
  const pid = Number(readFileSync(join(root, ".local/orphan.pid"), "utf8"));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  const recovered = await run(root, ctx(state), { recoverOnly: true });
  assert.equal(recovered.state, "INCOMPLETE");
  assert.equal(guard(root, ctx(state)).planHash, state.planHash);
});

test("SIGTERM is propagated, cleans the child and never reports PASS", async (t) => {
  const root = fixture(t, { command: [process.execPath, "-e",
    "require('fs').writeFileSync('.local/signal.pid',String(process.pid));setInterval(()=>{},100)"] });
  const state = await provision(root, spec());
  const child = spawn(process.execPath, ["scripts/unified-gate.mjs", "run", "--tier", state.tier], {
    cwd: root, env: { PATH: process.env.PATH, TASK_ID: state.id, TASK_PLAN_FILE: state.planPath },
    stdio: "ignore",
  });
  for (let i = 0; i < 100 && !existsSync(join(root, ".local/signal.pid")); i++) await delay(10);
  assert.ok(existsSync(join(root, ".local/signal.pid")));
  child.kill("SIGTERM");
  const [code] = await once(child, "close");
  assert.equal(code, 1);
  assert.equal(current(root, state.id).runs.at(-1).state, "INCOMPLETE");
  assert.throws(() => process.kill(Number(readFileSync(join(root, ".local/signal.pid"))), 0), /ESRCH/);
});

test("merge guard compares both merge parents and accepts unioned independent identities", async (t) => {
  const root = fixture(t);
  const branch = git(root, ["branch", "--show-current"]).stdout.trim();
  const seed = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  await provision(root, spec());
  git(root, ["add", "docs/validation/unified-registry.json"]); git(root, ["commit", "-qm", "first fixture"]);
  const first = readRegistry(root);
  git(root, ["checkout", "-qb", "other", seed]);
  await provision(root, spec());
  git(root, ["add", "docs/validation/unified-registry.json"]); git(root, ["commit", "-qm", "second fixture"]);
  const second = readRegistry(root);
  git(root, ["checkout", "-q", branch]);
  assert.equal(git(root, ["merge", "--no-commit", "other"], true).status, 1);
  write(root, "docs/validation/unified-registry.json", first);
  assert.throws(() => mergeGuard(root, first), /tombstone disappeared/);
  const union = { schemaVersion: 1, tasks: { ...first.tasks, ...second.tasks },
    tombstones: [...first.tombstones, ...second.tombstones] };
  write(root, "docs/validation/unified-registry.json", union);
  git(root, ["add", "docs/validation/unified-registry.json"]);
  mergeGuard(root, union, true);
});

test("existing npm-tier entry cannot bypass task guards using execute/no-plan flags or manifest overrides", async (t) => {
  const root = fixture(t), state = await provision(root, spec());
  for (const args of [["test-heavy", "--allow-no-plan"], ["--execute", "test-heavy"]]) {
    const result = spawnSync(process.execPath, ["scripts/run-tier.mjs", ...args], {
      cwd: root, encoding: "utf8", timeout: 4000,
      env: { PATH: process.env.PATH, TASK_ID: state.id, TASK_PLAN_FILE: state.planPath,
        VALIDATION_MANIFEST_PATH: "missing-manifest.json", CI_SMOKE_TEST: "1" },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /wrong tier/);
  }
  assert.equal(existsSync(join(root, ".local/executed")), false);
});

test("missing tools block; truncated output and source changes cannot produce PASS", async (t) => {
  const missing = fixture(t, { command: ["nonexistent-unified-setup-command"] });
  const state = await provision(missing, spec());
  assert.equal((await run(missing, ctx(state))).state, "BLOCKED");
  const noisy = fixture(t, { command: [process.execPath, "-e", "process.stdout.write('x'.repeat(1100000))"] });
  const noisyState = await provision(noisy, spec());
  assert.equal((await run(noisy, ctx(noisyState))).state, "INCOMPLETE");
  const changing = fixture(t, { command: [process.execPath, "-e",
    "require('fs').writeFileSync('new-source.txt','changed during the run')"] });
  const changingState = await provision(changing, spec());
  assert.equal((await run(changing, ctx(changingState))).state, "INCOMPLETE");
  const planChange = fixture(t, { command: [process.execPath, "-e",
    "require('fs').appendFileSync(process.env.UNIFIED_TASK_PLAN_FILE,'tampered')"] });
  const planState = await provision(planChange, spec());
  assert.equal((await run(planChange, ctx(planState))).state, "BLOCKED");
});

test("installed Git hook checks the actual staged registry and blocks dropping it", async (t) => {
  const root = fixture(t);
  await provision(root, spec());
  cpSync(join(project, ".githooks"), join(root, ".githooks"), { recursive: true });
  for (const hook of ["pre-commit", "pre-merge-commit"]) chmodSync(join(root, ".githooks", hook), 0o755);
  git(root, ["config", "core.hooksPath", ".githooks"]);
  git(root, ["add", "docs/validation/unified-registry.json"]);
  const committed = git(root, ["commit", "-qm", "fixture guarded commit"]);
  // Git relays hook stdout through its stderr stream.
  assert.match(committed.stdout + committed.stderr, /preservation/);
  git(root, ["rm", "--cached", "docs/validation/unified-registry.json"]);
  const refused = git(root, ["commit", "-qm", "must not lose fixture identity"], true);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /registry absent from proposed Git index/);
});
