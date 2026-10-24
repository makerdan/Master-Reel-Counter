import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync,
  symlinkSync, readdirSync, statSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { hash, git, emptyRegistry, TIERS, readRegistry, taskState } from "../lib/unified-gate/store.mjs";
import { provision, amend } from "../lib/unified-gate/plans.mjs";
import { run } from "../lib/unified-gate/execution.mjs";
import { deriveSummary, compareSummaries, eligibility, validateSummary, reportingContext,
  saveSummary, summaryHistory, SUMMARY_DIRECTORY, SUMMARY_BYTES, renderComparison } from "../lib/unified-gate/summaries.mjs";

const project = resolve(import.meta.dirname, "../..");
function write(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
}
function directory(t) {
  const root = mkdtempSync(join(tmpdir(), "gate-summary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const spec = () => ({ title: "Summary fixture", scope: "Disposable gate reporting maintenance fixture",
  tier: "test-fast", why: "Small fake workload only", coverage: "first fixture step",
  ignoredBaselines: [], ownedBaselines: [], approval: { reference: "Fixture owner instruction",
    direction: "Run fixture", applicability: "Only disposable fixture state" },
  assertions: [{ requirement: "Report steps honestly", check: "Compare observed steps only" }] });
function fixture(t, { code, timeoutMs = 3000, extra = [] } = {}) {
  const root = directory(t), source = "Fixture contract\n", pin = hash(source);
  write(root, ".gitignore", ".local/\nnode_modules\n");
  write(root, ".agents/skills/failure-gate-unified/SKILL.md", source);
  write(root, `docs/validation/unified-revisions/${pin}.txt`, source);
  write(root, "docs/validation/unified-pin.json", { schemaVersion: 1, current: pin,
    source: ".agents/skills/failure-gate-unified/SKILL.md",
    revisions: { [pin]: `docs/validation/unified-revisions/${pin}.txt` } });
  write(root, "docs/validation/unified-registry.json", emptyRegistry());
  write(root, "docs/validation/failure-baseline.json", { schemaVersion: 1, records: [] });
  const steps = [{ name: "first", kind: "test", command: [process.execPath, "-e", code ??
    "const fs=require('fs'); console.log('output-secret-canary'); process.exit(fs.existsSync('.local/fail')?3:0)"] }, ...extra];
  write(root, "docs/validation/manifest.json", { tiers: Object.fromEntries(TIERS.map((tier) =>
    [tier, { timeoutMs, steps }])) });
  cpSync(join(project, "scripts"), join(root, "scripts"), {
    recursive: true, filter: (src) => !src.includes("/__tests__"),
  });
  symlinkSync(join(project, "node_modules"), join(root, "node_modules"), "dir");
  git(root, ["init", "-q"]); git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]); git(root, ["add", "."]); git(root, ["commit", "-qm", "seed"]);
  return root;
}
const context = (s) => ({ id: s.id, tier: s.tier, planFile: s.planPath });
function cli(root, args, state) {
  return spawnSync(process.execPath, ["scripts/unified-gate.mjs", ...args], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { PATH: process.env.PATH, GATE_SUMMARY_CANARY: "env-secret-canary",
      ...(state ? { TASK_ID: state.id, TASK_PLAN_FILE: state.planPath } : {}) },
  });
}
function sample(overrides = {}) {
  const steps = ["first", "later"].map((label, i) => ({ key: hash(String(i)), label, kind: "test",
    outcome: "PASS", durationMs: 10, timedOut: false, interrupted: false, trustworthy: true }));
  return { schemaVersion: 1, comparisonVersion: 1, runId: randomUUID(), taskId: randomUUID(),
    revision: 1, planHash: hash("plan"), contract: hash("contract"), tier: "test-fast",
    workload: hash("workload"), purpose: "bound-tier", state: "PASS",
    startedAt: "2026-01-02T00:00:00.000Z", finishedAt: "2026-01-02T00:00:01.000Z",
    source: { revision: "a".repeat(40), fingerprint: hash("source"), dirty: false, changed: false },
    runtime: { node: "22.0.0", platform: "linux", arch: "x64", osReleaseHash: hash("os"),
      dependencyLock: null, implementation: hash("impl") }, steps, omittedSteps: 0,
    recovered: false, timedOut: false, interrupted: false, durationMs: 1000,
    ...overrides, evidencePath: `.local/failure-gate-unified/runs/${overrides.runId ?? "PLACEHOLDER"}.jsonl` };
}
function record(overrides) {
  const s = sample(overrides); s.evidencePath = `.local/failure-gate-unified/runs/${s.runId}.jsonl`; return s;
}
const later = (prior, overrides = {}) => record({ ...structuredClone(prior), runId: randomUUID(),
  taskId: randomUUID(), revision: 2, planHash: hash("different-plan"),
  source: { ...prior.source, revision: "b".repeat(40), dirty: true, fingerprint: hash("different-source") },
  startedAt: "2026-01-03T00:00:00.000Z", finishedAt: "2026-01-03T00:00:01.000Z", ...overrides });
const failFirst = (s) => {
  s.state = "FAIL"; s.steps[0].outcome = "FAIL";
  s.steps[1] = { ...s.steps[1], outcome: "NOT_REACHED", durationMs: null, trustworthy: false };
  return s;
};
test("R1/R2 across-task/revision comparison, fail-fast unknowns and safe negative controls", () => {
  const prior = record(), current = failFirst(later(prior));
  assert.equal(eligibility(current), null);
  const changed = compareSummaries(current, [prior]);
  assert.equal(changed.priorRun, prior.runId); // equality on task/plan/source would fail this.
  assert.equal(changed.transitions[0].change, "newly observed failed step");
  assert.equal(changed.transitions[1].change, "unknown/not reached");
  assert.equal(changed.timing.length, 1);
  const repeated = compareSummaries(current, [failFirst(structuredClone(prior))]);
  assert.equal(repeated.transitions[0].change, "repeated step failure");
  const fixed = compareSummaries(later(prior), [failFirst(structuredClone(prior))]);
  assert.equal(fixed.transitions[0].change, "previously failing step now passing");
  assert.equal(fixed.transitions[1].change, "unknown/not reached"); // must never say fixed.
  assert.doesNotMatch(JSON.stringify(repeated), /pre-existing|identical test|caused/);
  const next = later(prior); next.steps[0].durationMs = 17;
  assert.equal(compareSummaries(next, [prior]).timing[0].deltaMs, 7);
  const recent = record({ ...prior, runId: randomUUID(), finishedAt: "2026-01-02T01:00:00.000Z" });
  assert.equal(compareSummaries(next, [prior, recent]).priorRun, recent.runId);
});
test("R1 every incompatible/missing/unknown applicability and non-clean state is rejected", () => {
  const prior = record(), current = later(prior);
  const modifications = [
    (s) => { s.tier = "test-heavy"; }, (s) => { s.workload = hash("other"); },
    (s) => { s.contract = hash("other"); }, (s) => { s.runtime.node = "24.0.0"; },
    (s) => { s.runtime.dependencyLock = hash("other"); },
    (s) => { delete s.runtime; }, (s) => { s.runtime.extra = true; },
    (s) => { s.comparisonVersion = 2; }, (s) => { s.schemaVersion = 2; },
    (s) => { s.purpose = "diagnostic"; }, (s) => { s.purpose = "classification"; },
    (s) => { s.state = "RUNNING"; }, (s) => { s.state = "INCOMPLETE"; },
    (s) => { s.state = "BLOCKED"; }, (s) => { s.source.changed = true; },
    (s) => { s.recovered = true; }, (s) => { s.interrupted = true; },
    (s) => { s.timedOut = true; }, (s) => { s.steps[0].trustworthy = false; },
    (s) => { s.steps[0].durationMs = null; }, (s) => { s.steps[0].key = hash("other"); },
    (s) => { s.steps[0].outcome = "NOT_REACHED"; }, (s) => { s.omittedSteps = 1; },
  ];
  for (const modify of modifications) {
    const bad = structuredClone(prior); modify(bad);
    const result = compareSummaries(current, [bad]);
    assert.equal(result.priorRun, null, JSON.stringify(bad));
    assert.equal(result.message, "No comparable prior run");
    assert.ok(result.reasons.length);
  }
  assert.equal(compareSummaries(current, []).message, "No comparable prior run");
  assert.equal(compareSummaries({ ...current, recovered: true }, [prior]).priorRun, null);
});
test("R3 strict allowlist excludes commands, errors, arguments, output and environment values; detail bound", (t) => {
  const root = fixture(t);
  const definition = { steps: Array.from({ length: 102 }, (_, i) =>
    ({ name: `step-${i}`, kind: "test", command: ["secret-command-canary"] })) };
  const report = reportingContext(root, definition);
  const id = randomUUID();
  const entry = { id, taskId: randomUUID(), state: "BLOCKED", purpose: "bound-tier",
    revision: 1, planHash: hash("plan"), pin: hash("contract"), tier: "test-fast",
    workloadHash: hash("workload"), reportingContext: report,
    target: { head: "a".repeat(40), filesHash: hash("source") },
    startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z",
    reason: "error-secret-canary", env: { SECRET: "env-secret-canary" },
    observations: [{ name: "step-0", kind: "test", command: ["argument-secret-canary"],
      result: "BLOCKED", error: "error-secret-canary", outputExcerpt: "output-secret-canary" }] };
  const summary = deriveSummary(entry);
  assert.equal(summary.steps.length, 100); assert.equal(summary.omittedSteps, 2);
  const rendered = renderComparison(summary, compareSummaries(summary, []));
  assert.match(rendered, /Detail omitted: 2/);
  assert.doesNotMatch(JSON.stringify(summary) + rendered, /secret-canary/);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) <= SUMMARY_BYTES);
  assert.throws(() => validateSummary({ ...summary, reason: "unsafe" }));
});
test("R3 bounded private retention prunes only owned reports by count/age, not evidence or catalog", (t) => {
  const root = directory(t), now = Date.parse("2026-02-01T00:00:00.000Z");
  write(root, "docs/validation/failure-baseline.json", "catalog sentinel");
  write(root, ".local/failure-gate-unified/runs/sentinel.jsonl", "evidence sentinel");
  write(root, `${SUMMARY_DIRECTORY}/not-owned.txt`, "not ours");
  const old = record({ startedAt: "2025-01-01T00:00:00.000Z", finishedAt: "2025-01-01T00:00:01.000Z" });
  // Model a record that aged out between writes.
  write(root, `${SUMMARY_DIRECTORY}/${old.runId}.json`, old);
  chmodSync(join(root, SUMMARY_DIRECTORY, `${old.runId}.json`), 0o600);
  for (let i = 0; i < 105; i++) {
    const at = now - (200 - i) * 1000;
    saveSummary(root, record({ startedAt: new Date(at - 10).toISOString(), finishedAt: new Date(at).toISOString() }), now);
  }
  const names = readdirSync(join(root, SUMMARY_DIRECTORY)).filter((n) => n.endsWith(".json"));
  assert.equal(names.length, 100);
  assert.equal(existsSync(join(root, SUMMARY_DIRECTORY, `${old.runId}.json`)), false);
  assert.equal(summaryHistory(root, { limit: 100, now }).records.length, 100);
  assert.equal(statSync(join(root, SUMMARY_DIRECTORY)).mode & 0o777, 0o700);
  for (const name of names) assert.equal(statSync(join(root, SUMMARY_DIRECTORY, name)).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(root, `${SUMMARY_DIRECTORY}/not-owned.txt`), "utf8"), "not ours");
  assert.equal(readFileSync(join(root, "docs/validation/failure-baseline.json"), "utf8"), "catalog sentinel");
  assert.equal(readFileSync(join(root, ".local/failure-gate-unified/runs/sentinel.jsonl"), "utf8"), "evidence sentinel");
});
test("R3 corrupt, oversize, symlink and traversal inputs are refused with bounded generic warnings", (t) => {
  const root = directory(t);
  for (const content of ["{invalid-secret-canary", "x".repeat(SUMMARY_BYTES + 1)]) {
    const id = randomUUID(); write(root, `${SUMMARY_DIRECTORY}/${id}.json`, content);
    chmodSync(join(root, SUMMARY_DIRECTORY, `${id}.json`), 0o600);
    const history = summaryHistory(root);
    assert.equal(history.records.length, 0); assert.ok(history.warnings.length);
    assert.doesNotMatch(JSON.stringify(history), /secret-canary/);
    assert.throws(() => saveSummary(root, record()));
    rmSync(join(root, SUMMARY_DIRECTORY, `${id}.json`));
  }
  write(root, "outside", "protected");
  const id = randomUUID();
  symlinkSync(join(root, "outside"), join(root, SUMMARY_DIRECTORY, `${id}.json`));
  assert.ok(summaryHistory(root).warnings.length);
  assert.throws(() => saveSummary(root, record({ runId: id })));
  assert.throws(() => summaryHistory(root, { runId: "../outside" }));
  assert.throws(() => summaryHistory(root, { limit: 101 }));
  assert.equal(readFileSync(join(root, "outside"), "utf8"), "protected");
  rmSync(join(root, SUMMARY_DIRECTORY), { recursive: true });
  symlinkSync(root, join(root, SUMMARY_DIRECTORY), "dir");
  assert.throws(() => saveSummary(root, record()));
  assert.ok(summaryHistory(root).warnings.length);
});
test("R3 concurrent processes publish complete atomic summaries under coordinated retention", { timeout: 20000 }, async (t) => {
  const root = directory(t);
  const url = pathToFileURL(join(project, "scripts/lib/unified-gate/summaries.mjs")).href;
  const children = Array.from({ length: 4 }, () => {
    const child = spawn(process.execPath, ["--input-type=module", "-e",
      `import {saveSummary} from ${JSON.stringify(url)}; saveSummary(${JSON.stringify(root)},${JSON.stringify(record())}, Date.parse("2026-01-05T00:00:00.000Z"));`],
    { stdio: ["ignore", "pipe", "pipe"] });
    return new Promise((res, reject) => {
      let errors = ""; child.stderr.on("data", (v) => errors += v);
      child.once("error", reject); child.once("close", (code) => code === 0 ? res() : reject(new Error(errors)));
    });
  });
  await Promise.all(children);
  const history = summaryHistory(root, { now: Date.parse("2026-01-05T00:00:00.000Z") });
  assert.equal(history.records.length, 4); assert.deepEqual(history.warnings, []);
  assert.equal(readdirSync(join(root, SUMMARY_DIRECTORY)).filter((n) => n.endsWith(".tmp")).length, 0);
});
test("R1-R4 real exported/CLI runs preserve JSON, states, cross-task selection, not-reached and read-only history", { timeout: 20000 }, async (t) => {
  const root = fixture(t, { extra: [{ name: "later", kind: "test", command: [process.execPath, "-e", "process.exit(0)"] }] });
  const first = await provision(root, spec());
  const pass = await run(root, context(first)); assert.equal(pass.state, "PASS");
  const second = await provision(root, { ...spec(), title: "Other fixture" });
  const revised = await amend(root, second.id, { ...spec(), title: "Other fixture revised" }, "Fixture plan revision");
  write(root, ".local/fail", "");
  const failed = cli(root, ["run", "--tier", revised.tier], revised);
  assert.equal(failed.status, 1, failed.stderr);
  const result = JSON.parse(failed.stdout);
  assert.equal(result.state, "FAIL"); assert.deepEqual(result.notReached, ["later"]);
  assert.match(failed.stderr, /newly observed failed step/);
  assert.match(failed.stderr, /unknown\/not reached/);
  assert.match(failed.stderr, new RegExp(pass.id));
  const before = readFileSync(join(root, "docs/validation/unified-registry.json"), "utf8");
  const baseline = readFileSync(join(root, "docs/validation/failure-baseline.json"), "utf8");
  const names = readdirSync(join(root, SUMMARY_DIRECTORY)).sort();
  const history = cli(root, ["history", "--run", result.id, "--limit", "100"]);
  assert.equal(history.status, 0, history.stderr);
  const parsed = JSON.parse(history.stdout);
  assert.equal(parsed.comparison.priorRun, pass.id);
  assert.equal(parsed.records.length, 2);
  assert.doesNotMatch(history.stdout, /output-secret-canary|command|outputExcerpt/);
  assert.equal(readFileSync(join(root, "docs/validation/unified-registry.json"), "utf8"), before);
  assert.equal(readFileSync(join(root, "docs/validation/failure-baseline.json"), "utf8"), baseline);
  assert.deepEqual(readdirSync(join(root, SUMMARY_DIRECTORY)).sort(), names);
  const denied = cli(root, ["run", "--tier", "test-heavy"], revised);
  assert.equal(denied.status, 2); assert.equal(summaryHistory(root).records.length, 2);
  rmSync(join(root, ".local/fail"));
  const diag = await run(root, context(revised), { stepName: "first" });
  assert.equal(diag.state, "INCOMPLETE");
  assert.equal(summaryHistory(root, { runId: diag.id }).comparison.priorRun, null);
});
test("R3/R4 storage failure cannot erase PASS/FAIL/BLOCKED or leak error text", { timeout: 20000 }, async (t) => {
  for (const [code, expected, status] of [["process.exit(0)", "PASS", 0],
    ["process.exit(3)", "FAIL", 1], ["process.exit(125)", "BLOCKED", 1]]) {
    const root = fixture(t, { code });
    const state = await provision(root, spec());
    write(root, SUMMARY_DIRECTORY, "storage-secret-canary");
    const result = cli(root, ["run", "--tier", state.tier], state);
    assert.equal(result.status, status, result.stderr);
    assert.equal(JSON.parse(result.stdout).state, expected);
    assert.match(result.stderr, /validation reporting warning/);
    assert.doesNotMatch(result.stderr, /storage-secret-canary|EEXIST/);
    assert.equal(taskState(readRegistry(root).tasks[state.id]).runs.at(-1).state, expected);
  }
});
test("R3 real output/argument/error/environment canaries never enter derived files or reports", { timeout: 10000 }, async (t) => {
  const root = fixture(t, { code: "console.log('output-secret-canary'); throw new Error('error-secret-canary'); // argument-secret-canary" });
  const state = await provision(root, spec());
  const result = cli(root, ["run", "--tier", state.tier], state);
  assert.equal(result.status, 1);
  const entry = JSON.parse(result.stdout);
  assert.match(entry.observations[0].outputExcerpt, /error-secret-canary/);
  const history = cli(root, ["history"]);
  assert.equal(history.status, 0);
  assert.doesNotMatch(result.stderr + history.stdout, /secret-canary/);
  const saved = readFileSync(join(root, SUMMARY_DIRECTORY, `${entry.id}.json`), "utf8");
  assert.doesNotMatch(saved, /secret-canary/);
});
test("R2/R4 source changes and real timeout never become full-workload references", { timeout: 15000 }, async (t) => {
  const changedRoot = fixture(t, { code: "require('fs').writeFileSync('changed-source','changed')" });
  const s = await provision(changedRoot, spec());
  assert.equal((await run(changedRoot, context(s))).state, "INCOMPLETE");
  assert.equal(summaryHistory(changedRoot).records[0].source.changed, true);
  const timeoutRoot = fixture(t, { timeoutMs: 200, code: "setInterval(()=>{},100)" });
  const timed = await provision(timeoutRoot, spec());
  assert.equal((await run(timeoutRoot, context(timed))).state, "INCOMPLETE");
  const summary = summaryHistory(timeoutRoot).records[0];
  assert.equal(summary.timedOut, true); assert.equal(summary.steps[0].timedOut, true);
  assert.notEqual(eligibility(summary), null);
});
