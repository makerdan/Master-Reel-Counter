import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { hash, TIERS, emptyRegistry, git, readRegistry, taskState } from "../lib/unified-gate/store.mjs";
import { provision, classifyFailure } from "../lib/unified-gate/plans.mjs";
import { run } from "../lib/unified-gate/execution.mjs";
import { retryAdapter, readRetryEvidence } from "../lib/unified-gate/retry.mjs";

const project = resolve(import.meta.dirname, "../..");
function write(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
}
async function fixture(t, { command = ["node", "--test", "a.test.mjs", "b.test.mjs"],
  timeoutMs = 6000, browser = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "guarded-retry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = "Disposable fixture contract\n", pin = hash(source);
  write(root, ".gitignore", ".local/\nnode_modules\n");
  write(root, ".agents/skills/failure-gate-unified/SKILL.md", source);
  write(root, `docs/validation/unified-revisions/${pin}.txt`, source);
  write(root, "docs/validation/unified-pin.json", { schemaVersion: 1, current: pin,
    source: ".agents/skills/failure-gate-unified/SKILL.md",
    revisions: { [pin]: `docs/validation/unified-revisions/${pin}.txt` } });
  write(root, "docs/validation/unified-registry.json", emptyRegistry());
  write(root, "docs/validation/failure-baseline.json", { schemaVersion: 1, records: [] });
  write(root, "docs/validation/manifest.json", { tiers: Object.fromEntries(TIERS.map((tier) =>
    [tier, { timeoutMs, steps: [{ name: "tests", kind: "test", command }] }])) });
  write(root, "package.json", { type: "module", scripts: { typecheck: "node compiler.mjs" } });
  write(root, "compiler.mjs", "import fs from 'node:fs'; fs.appendFileSync('.local/lifecycle','compile\\n');");
  write(root, "a.test.mjs", `import test from 'node:test'; import fs from 'node:fs';
    test('chosen [literal]',()=>fs.appendFileSync('.local/markers','chosen\\n'));
    test('sibling',()=>fs.appendFileSync('.local/markers','sibling\\n'));
    test.skip('skip only',()=>{throw Error('must not run')});
    test('failure',()=>{throw Error('fixture assertion')});`);
  write(root, "b.test.mjs", `import test from 'node:test'; import fs from 'node:fs';
    test('other file',()=>fs.appendFileSync('.local/markers','other\\n'));`);
  cpSync(join(project, "scripts/lib"), join(root, "scripts/lib"), { recursive: true });
  for (const file of ["unified-gate.mjs", "unified-step.mjs", "run-typechecked-playwright.mjs"]) {
    cpSync(join(project, "scripts", file), join(root, "scripts", file));
  }
  symlinkSync(join(project, "node_modules"), join(root, "node_modules"), "dir");
  if (browser) {
    write(root, "tests/retry.spec.ts", `import {test,expect} from '@playwright/test'; import fs from 'node:fs';
      test('chosen',()=>{fs.appendFileSync('.local/markers','browser chosen\\n');expect(1).toBe(1)});
      test('sibling',()=>fs.appendFileSync('.local/markers','browser sibling\\n'));
      test.skip('skip only',()=>{throw Error('must not run')});`);
    write(root, "playwright.config.ts", `export default {testDir:'./tests',workers:1,
      projects:[{name:'chromium'}],outputDir:'.local/playwright'};`);
    // Fake only the external DB/browser boundary; use the real dispatcher,
    // compiler sequencing and reporter. Real wrapper lifecycle is covered below.
    write(root, "scripts/run-browser-tests.mjs", `
      import fs from 'node:fs'; import {spawnSync} from 'node:child_process';
      fs.appendFileSync('.local/lifecycle','prepare\\n');
      try {
        fs.writeFileSync('.local/browser-args',JSON.stringify(process.argv.slice(2)));
        const r=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test',...process.argv.slice(2)],
          {env:process.env,stdio:'inherit'});
        process.exitCode=r.status ?? 1;
      } finally {fs.appendFileSync('.local/lifecycle','cleanup\\n');}`);
  }
  git(root, ["init", "-q"]); git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]); git(root, ["add", "."]); git(root, ["commit", "-qm", "fixture"]);
  const state = await provision(root, { title: "Retry fixture", scope: "Disposable maintenance selectors",
    tier: browser ? "test-heavy" : "test-standard", why: "Bounded selector test", coverage: "tests fixture",
    ignoredBaselines: [], ownedBaselines: [], approval: { reference: "Fixture instruction",
      direction: "Exercise fixture", applicability: "Only disposable fixture state" },
    assertions: [{ requirement: "Select tests", check: "Sibling markers absent" }] });
  return { root, state, context: { id: state.id, tier: state.tier, planFile: state.planPath } };
}
const select = (file = "a.test.mjs", rest = {}) => ({ stepName: "tests", selector: { file, ...rest } });
function cli(f, args) {
  return spawnSync(process.execPath, ["scripts/unified-gate.mjs", "run", "--tier", f.state.tier, ...args], {
    cwd: f.root, encoding: "utf8", timeout: 12000,
    env: { PATH: process.env.PATH, TASK_ID: f.state.id, TASK_PLAN_FILE: f.state.planPath },
  });
}
test("R1/R3 real Node exact case executes alone; old whole-step behavior fails the marker assertion", async (t) => {
  const f = await fixture(t);
  const result = await run(f.root, f.context, select("a.test.mjs", { case: "chosen [literal]" }));
  assert.equal(result.state, "INCOMPLETE");
  assert.equal(result.purpose, "diagnostic");
  assert.equal(result.diagnostic.outcome, "SUCCEEDED", JSON.stringify(result));
  assert.equal(readFileSync(join(f.root, ".local/markers"), "utf8"), "chosen\n");
  assert.equal(result.diagnostic.counts.executed, 1);
  assert.equal(result.diagnostic.counts.filtered, 3);
  const body = result.diagnostic.tests.find((r) => r.executed);
  assert.equal(body.case, "chosen [literal]");
  assert.equal(body.file, join(f.root, "a.test.mjs"));
  assert.ok(result.observations[0].command.includes(resolve(f.root, "scripts/lib/unified-gate/retry-dispatch.mjs")));
  assert.equal(result.revision, f.state.revision);
  assert.equal(result.tier, f.state.tier);
  assert.ok(result.target.filesHash);
  const nestedContext = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  let broad;
  try { broad = await run(f.root, f.context, { stepName: "tests" }); }
  finally { if (nestedContext !== undefined) process.env.NODE_TEST_CONTEXT = nestedContext; }
  assert.notEqual(readFileSync(join(f.root, ".local/markers"), "utf8"), "chosen\n",
    "negative control: old ignored-selector dispatch executes the sibling");
  assert.equal(broad.state, "FAIL");
  const retry = await run(f.root, f.context, select("a.test.mjs", { case: "chosen [literal]" }));
  assert.equal(retry.diagnostic.outcome, "SUCCEEDED");
  assert.equal(taskState(readRegistry(f.root).tasks[f.state.id]).runs.at(-2).state, "FAIL");
  assert.throws(() => classifyFailure(f.root, f.state, {}, { kind: "passing-retry", note: "Retry passed only" }), /provenance/);
});
test("R1 CLI uses the same selector and rejects unknown, duplicate, missing or conflicting flags without dispatch", async (t) => {
  const f = await fixture(t);
  for (const args of [
    ["--file", "a.test.mjs"], ["--step", "tests", "--test-name", "sibling"],
    ["--step", "tests", "--file"], ["--step", "tests", "--file", "a.test.mjs", "--file", "b.test.mjs"],
    ["--step", "tests", "--file", "a.test.mjs", "--case", "x", "--pattern", "x"],
    ["--step", "tests", "--file=a.test.mjs"], ["--step", "tests", "--recover", "--file", "a.test.mjs"],
  ]) assert.equal(cli(f, args).status, 2, args.join(" "));
  assert.equal(existsSync(join(f.root, ".local/markers")), false);
  const result = cli(f, ["--step", "tests", "--file", "a.test.mjs", "--case", "chosen [literal]"]);
  assert.equal(result.status, 1, result.stderr); // Diagnostic, never tier PASS.
  assert.match(result.stdout, /"outcome": "SUCCEEDED"/);
  assert.equal(readFileSync(join(f.root, ".local/markers"), "utf8"), "chosen\n");
});
test("R2 exported runner rejects unsafe/out-of-workload/unknown input and invalid task context before dispatch", async (t) => {
  const f = await fixture(t);
  for (const options of [
    { ...select(), unexpected: true }, { ...select(), selector: { file: "a.test.mjs", flag: true } },
    select("../a.test.mjs"), select("/a.test.mjs"), select("./a.test.mjs"), select("*.mjs"),
    select("a.test.mjs", { pattern: "[" }), select("a.test.mjs", { case: "" }),
    { ...select(), recoverOnly: true }, { selector: { file: "a.test.mjs" } },
    { stepName: "not-registered", selector: { file: "a.test.mjs" } },
    select("compiler.mjs"), select("node_modules/@playwright/test/cli.js"),
  ]) await assert.rejects(run(f.root, f.context, options));
  await assert.rejects(run(f.root, { ...f.context, tier: "test-heavy" }, select()), /wrong tier/);
  await assert.rejects(run(f.root, { ...f.context, id: "not-a-task" }, select()), /unprovisioned/);
  write(f.root, f.state.planPath, f.state.plan + "stale");
  await assert.rejects(run(f.root, f.context, select()), /stale/);
  assert.equal(existsSync(join(f.root, ".local/markers")), false);
});
test("R3 zero matches, skipped-only and assertion failures are not successful retries", async (t) => {
  const f = await fixture(t);
  for (const [pattern, expected] of [["^absent$", "NO_MATCH"], ["^skip only$", "NO_EXECUTION"], ["^failure$", "FAILED"]]) {
    const result = await run(f.root, f.context, select("a.test.mjs", { pattern }));
    assert.equal(result.diagnostic.outcome, expected, JSON.stringify(result));
    assert.notEqual(result.state, "PASS");
  }
  write(f.root, "a.test.mjs", "// No test declarations; Node emits a synthetic file-process PASS.\n");
  const empty = await run(f.root, f.context, select());
  assert.equal(empty.observations[0].code, 0);
  assert.equal(empty.diagnostic.outcome, "NO_MATCH");
  assert.equal(empty.diagnostic.counts.executed, 0);
  assert.notEqual(empty.state, "PASS");
});
test("R3 missing, malformed, incomplete, foreign-file and inconsistent execution evidence is never success", async (t) => {
  const f = await fixture(t), adapter = retryAdapter(f.root, { command: ["node", "--test", "a.test.mjs"] }, { file: "a.test.mjs" });
  const path = ".local/report.json";
  assert.equal(readRetryEvidence(f.root, path, adapter).outcome, "EVIDENCE_UNAVAILABLE");
  for (const report of ["not json", {}, { complete: false }, { schemaVersion: 1, runner: "node", complete: true,
    tests: [{ file: "b.test.mjs", case: "foreign", outcome: "passed", executed: true }] },
    { schemaVersion: 1, runner: "node", complete: true,
      tests: [{ file: "a.test.mjs", case: "not run", outcome: "passed", executed: false }] }]) {
    write(f.root, path, report);
    assert.equal(readRetryEvidence(f.root, path, adapter).outcome, "EVIDENCE_UNAVAILABLE");
  }
  // A child exiting zero without the reporter cannot establish isolation.
  write(f.root, "scripts/lib/unified-gate/retry-dispatch.mjs", "process.exit(0)");
  const result = await run(f.root, f.context, select());
  assert.equal(result.diagnostic.outcome, "EVIDENCE_UNAVAILABLE");
  assert.equal(result.observations[0].code, 0);
  assert.notEqual(result.state, "PASS");
});
test("R4 compound Node scripts choose the unique constituent and retain loaders and workload environment", async (t) => {
  const f = await fixture(t, { command: ["npm", "run", "compound"] });
  write(f.root, "loader.mjs", "process.env.RETRY_LOADER='yes';");
  write(f.root, "a.test.mjs", `import test from 'node:test'; import assert from 'node:assert/strict';
    test('environment',()=>{assert.equal(process.env.VITE_HMR_RECOVERY,'1');assert.equal(process.env.RETRY_LOADER,'yes')});`);
  write(f.root, "package.json", { type: "module", scripts: {
    compound: "node --test b.test.mjs && VITE_HMR_RECOVERY=1 npm run loaded",
    loaded: "node --import ./loader.mjs --test a.test.mjs",
    ambiguous: "node --test a.test.mjs && node --test a.test.mjs",
  } });
  const result = await run(f.root, f.context, select());
  assert.equal(result.diagnostic.outcome, "SUCCEEDED", JSON.stringify(result));
  assert.equal(existsSync(join(f.root, ".local/markers")), false);
  assert.throws(() => retryAdapter(f.root, { command: ["npm", "run", "ambiguous"] }, { file: "a.test.mjs" }), /ambiguous/);
});
test("R5 opaque harness records requested selector and unsupported capability without any dispatch", async (t) => {
  const f = await fixture(t, { command: ["node", "compiler.mjs"] });
  const result = await run(f.root, f.context, select());
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.diagnostic.outcome, "UNSUPPORTED");
  assert.deepEqual(result.selector, { file: "a.test.mjs" });
  assert.match(result.diagnostic.reason, /opaque harness isolation/);
  assert.equal(result.observations[0].dispatched, false);
  assert.equal(existsSync(join(f.root, ".local/lifecycle")), false);
});
test("R4 browser adapter retains compiler-first lifecycle and native selection without overriding project policy", async (t) => {
  // The real Playwright package cold-starts here, unlike the small Node-only
  // fixtures. Retain a finite bound with scheduling headroom on shared hosts.
  const f = await fixture(t, { command: ["node", "scripts/run-browser-tests.mjs"],
    browser: true, timeoutMs: 20000 });
  const result = await run(f.root, f.context, select("tests/retry.spec.ts", { pattern: "chosen$" }));
  assert.equal(result.diagnostic.outcome, "SUCCEEDED", JSON.stringify(result));
  assert.equal(result.state, "INCOMPLETE");
  assert.equal(readFileSync(join(f.root, ".local/lifecycle"), "utf8"), "compile\nprepare\ncleanup\n");
  const args = JSON.parse(readFileSync(join(f.root, ".local/browser-args")));
  assert.deepEqual(args.slice(1, 3), ["--grep", "chosen$"]);
  assert.ok(new RegExp(args[0]).test(join(f.root, "tests/retry.spec.ts")));
  assert.equal(args.includes("--project"), false);
  assert.equal(result.diagnostic.tests[0].project, "chromium");
  assert.equal(result.diagnostic.tests[0].attempt, 0);
  assert.equal(readFileSync(join(f.root, ".local/markers"), "utf8"), "browser chosen\n");
  const exact = await run(f.root, f.context, select("tests/retry.spec.ts", {
    case: "chromium retry.spec.ts chosen",
  }));
  assert.equal(exact.diagnostic.outcome, "SUCCEEDED", JSON.stringify(exact));
  for (const [pattern, expected] of [["^absent$", "NO_MATCH"], ["skip only$", "NO_EXECUTION"]]) {
    const retry = await run(f.root, f.context, select("tests/retry.spec.ts", { pattern }));
    assert.equal(retry.diagnostic.outcome, expected, JSON.stringify(retry));
    assert.notEqual(retry.state, "PASS");
  }
  assert.throws(() => retryAdapter(f.root, { command: ["node", "scripts/run-browser-tests.mjs"] },
    { file: "a.test.mjs" }), /outside/);
  write(f.root, "compiler.mjs", "process.exit(4)");
  rmSync(join(f.root, ".local/lifecycle"));
  const failed = await run(f.root, f.context, select("tests/retry.spec.ts"));
  assert.equal(failed.diagnostic.outcome, "EVIDENCE_UNAVAILABLE");
  assert.equal(failed.state, "FAIL");
  assert.equal(existsSync(join(f.root, ".local/lifecycle")), false);
});
test("R4 selected Node timeout stops its child and records interruption/cleanup", async (t) => {
  const f = await fixture(t, { timeoutMs: 1000 });
  write(f.root, "a.test.mjs", `import test from 'node:test';import fs from 'node:fs';
    test('hang',async()=>{fs.writeFileSync('.local/pid',String(process.pid));setInterval(()=>{},100);await new Promise(()=>{})});`);
  const result = await run(f.root, f.context, select());
  assert.equal(result.diagnostic.outcome, "INTERRUPTED");
  assert.equal(result.observations[0].timedOut, true);
  assert.notEqual(result.state, "PASS");
  assert.equal(result.observations[0].cleanupComplete, true);
});

test("R4 selected CLI retry cancellation retains guards, cleanup and explicit interrupted evidence", async (t) => {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const f = await fixture(t);
    write(f.root, "a.test.mjs", `import test from 'node:test';import fs from 'node:fs';
      test('hold',async()=>{fs.writeFileSync('.local/ready','yes');setInterval(()=>{},100);await new Promise(()=>{})});`);
    const child = spawn(process.execPath, ["scripts/unified-gate.mjs", "run", "--tier", f.state.tier,
      "--step", "tests", "--file", "a.test.mjs", "--case", "hold"], {
      cwd: f.root, stdio: "ignore",
      env: { PATH: process.env.PATH, TASK_ID: f.state.id, TASK_PLAN_FILE: f.state.planPath },
    });
    t.after(() => { if (child.exitCode === null && !child.killed) child.kill("SIGKILL"); });
    for (let i = 0; i < 150 && !existsSync(join(f.root, ".local/ready")); i++) await delay(20);
    assert.equal(existsSync(join(f.root, ".local/ready")), true);
    child.kill(signal);
    const [code] = await once(child, "close");
    assert.equal(code, 1);
    const result = taskState(readRegistry(f.root).tasks[f.state.id]).runs.at(-1);
    assert.equal(result.state, "INCOMPLETE");
    assert.equal(result.diagnostic.outcome, "INTERRUPTED");
    assert.equal(result.observations[0].cleanupComplete, true);
    assert.equal(result.observations[0].interrupted, true);
  }
});

test("R1/R3 native Node leaf-name selection reports nested identities without counting suites as executed", async (t) => {
  const f = await fixture(t);
  write(f.root, "a.test.mjs", `import {describe,it} from 'node:test';import fs from 'node:fs';
    describe('outer',()=>{it('chosen',()=>fs.appendFileSync('.local/markers','nested\\n'));
      it('sibling',()=>fs.appendFileSync('.local/markers','sibling\\n'));});`);
  const result = await run(f.root, f.context, select("a.test.mjs", { case: "chosen" }));
  assert.equal(result.diagnostic.outcome, "SUCCEEDED", JSON.stringify(result));
  assert.equal(result.diagnostic.counts.executed, 1);
  assert.equal(result.diagnostic.tests.find((t) => t.executed).case, "outer chosen");
  assert.equal(readFileSync(join(f.root, ".local/markers"), "utf8"), "nested\n");
});
