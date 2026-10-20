import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync,
  cpSync, symlinkSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { emptyRegistry, readRegistry, taskState, pins, hash, TIERS, compareRegistry,
  mergeGuard, withWriter, validateRegistry, git } from "../lib/unified-gate/store.mjs";
import { provision, amend, guard, restorePlan, cancel, classifyFailure,
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
const ctx = (s) => ({ id: s.id, tier: s.tier, planFile: s.planPath });
function current(root, id) { return taskState(readRegistry(root).tasks[id]); }
function cli(root, args, state) {
  return spawnSync(process.execPath, ["scripts/unified-gate.mjs", ...args], {
    cwd: root, encoding: "utf8", timeout: 6000,
    env: { PATH: process.env.PATH, ...(state ? { TASK_ID: state.id, TASK_PLAN_FILE: state.planPath } : {}) },
  });
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
