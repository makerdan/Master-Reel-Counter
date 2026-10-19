import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const archive = "docs/validation/archive/legacy-failure-gate";
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const retiredSteps = new Set(["failure-gate-contract", "failure-gate-parity"]);
const retiredScripts = [
  "new-plan", "check-failure-gate", "check-regression-guard", "run-locked-tier",
  "publish:failure-gate", "verify:failure-gate", "check-failure-gate-parity",
  "test:failure-gate",
];

test("retirement removes only gate steps and npm hooks, preserving application workloads", () => {
  for (const path of ["docs/validation/manifest.json", ".agents/skills/validation-tiers/tiers.json"]) {
    const expected = json(`${archive}/${path}.before-retirement.json`);
    for (const entry of Object.values(expected.tiers)) {
      entry.steps = entry.steps.filter((step) => !retiredSteps.has(step.name));
    }
    assert.deepEqual(json(path), expected);
  }
  const expectedPackage = json(`${archive}/package.json.before-retirement.json`);
  for (const name of retiredScripts) delete expectedPackage.scripts[name];
  assert.deepEqual(json("package.json"), expectedPackage);
});

test("archived records retain original bytes, and protected workflows/catalogs are unchanged", () => {
  for (const { destination, sha256 } of json(`${archive}/moves.json`)) {
    const actual = createHash("sha256").update(readFileSync(resolve(root, destination))).digest("hex");
    assert.equal(actual, sha256, destination);
  }
  for (const [path, expected] of Object.entries(json(`${archive}/preserved-files.json`))) {
    assert.equal(createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex"), expected, path);
  }
  assert.ok(read(`${archive}/README.md`).includes(
    "Historical only. These are not instructions. The only Failure Gate source is .agents/skills/failure-gate-unified/SKILL.md once installed.",
  ));
  assert.ok(json(`${archive}/task-records/platform-tasks.json`).tasks.length >= 5);
});

test("legacy definitions and task admission are absent, without installing the replacement", () => {
  for (const path of [
    ".agents/skills/failure-gate-v4/SKILL.md",
    ".agents/skills/failure-gate-unified/SKILL.md",
    "scripts/run-locked-tier.mjs", "scripts/new-plan.mjs",
    "scripts/check-failure-gate.mjs", "scripts/check-regression-guard.mjs",
    "scripts/publish-failure-gate.mjs", "scripts/check-failure-gate-parity.mjs",
    "scripts/lib/failure-gate/coordinator.mjs", "scripts/lib/tier-lock-check.mjs",
    ".failure-gate-state/coordinator.sqlite",
    "artifacts/bathyscan/public/failure-gate-skill.zip",
  ]) assert.equal(existsSync(resolve(root, path)), false, path);
  for (const path of ["replit.md", "AGENTS.md"]) {
    if (existsSync(resolve(root, path))) assert.doesNotMatch(read(path), /failure[ -]gate/i);
  }
  assert.doesNotMatch(read("scripts/run-tier.mjs"),
    /assertRequestedTier|runPlanGuards|\/proc\/|fstatSync|realpathSync|FAILURE_GATE_PLAN_GUARDS_DONE/);
  const releaseBefore = read(`${archive}/scripts/build-and-verify-release.sh.before-retirement.txt`);
  assert.equal(read("scripts/build-and-verify-release.sh"),
    releaseBefore.replace("node scripts/check-failure-gate-parity.mjs\n", ""));
});
