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
  const expectedManifest = json(`${archive}/docs/validation/manifest.json.before-retirement.json`);
  for (const entry of Object.values(expectedManifest.tiers)) {
    entry.steps = entry.steps.filter((step) => !retiredSteps.has(step.name));
  }
  const insertAfter = (tier, anchorName, addition) => {
    const steps = expectedManifest.tiers[tier].steps;
    const position = steps.findIndex((step) => step.name === anchorName);
    assert.notEqual(position, -1, `archived ${tier} must contain ${anchorName}`);
    steps.splice(position + 1, 0, addition);
  };
  insertAfter("test-standard-plus", "unit-tests", {
    name: "clerk-release-contract",
    kind: "test",
    command: ["npm", "run", "test:managed-clerk-release-contract"],
  });
  insertAfter("test-heavy", "unit-tests", {
    name: "vite-hmr-tests",
    kind: "test",
    command: ["npm", "run", "test:vite-hmr"],
  });
  assert.deepEqual(json("docs/validation/manifest.json"), expectedManifest);

  const expectedExample = json(`${archive}/.agents/skills/validation-tiers/tiers.json.before-retirement.json`);
  for (const entry of Object.values(expectedExample.tiers)) {
    entry.steps = entry.steps.filter((step) => !retiredSteps.has(step.name));
  }
  assert.deepEqual(json(".agents/skills/validation-tiers/tiers.json"), expectedExample);

  const manifest = json("docs/validation/manifest.json");
  const steps = (tier) => manifest.tiers[tier].steps;
  const commandByName = (tier) => new Map(steps(tier).map((step) => [step.name, JSON.stringify(step.command)]));
  const standard = commandByName("test-standard");
  const standardPlus = commandByName("test-standard-plus");
  const heavy = commandByName("test-heavy");
  for (const [name, command] of standard) {
    assert.equal(standardPlus.get(name), command, `Standard-Plus must retain ${name}`);
  }
  const heavyCommands = new Set(heavy.values());
  for (const [name, command] of standardPlus) {
    assert.ok(heavyCommands.has(command), `Heavy must retain the ${name} workload`);
  }
  assert.equal(
    standardPlus.get("clerk-release-contract"),
    JSON.stringify(["npm", "run", "test:managed-clerk-release-contract"]),
  );
  assert.equal(
    heavy.get("vite-hmr-tests"),
    JSON.stringify(["npm", "run", "test:vite-hmr"]),
  );
  const expectedPackage = json(`${archive}/package.json.before-retirement.json`);
  for (const name of retiredScripts) delete expectedPackage.scripts[name];
  for (const operation of ["new", "guard", "amend", "restore-plan", "cancel", "run",
    "classify", "merge-guard", "status", "baseline-warnings"]) {
    expectedPackage.scripts[`gate:${operation}`] = `node scripts/unified-gate.mjs ${operation}`;
  }
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

test("legacy admission stays absent while only pinned canonical Unified is installed", () => {
  for (const path of [
    ".agents/skills/failure-gate-v4/SKILL.md",
    "scripts/run-locked-tier.mjs", "scripts/new-plan.mjs",
    "scripts/check-failure-gate.mjs", "scripts/check-regression-guard.mjs",
    "scripts/publish-failure-gate.mjs", "scripts/check-failure-gate-parity.mjs",
    "scripts/lib/failure-gate/coordinator.mjs", "scripts/lib/tier-lock-check.mjs",
    ".failure-gate-state/coordinator.sqlite",
    "artifacts/bathyscan/public/failure-gate-skill.zip",
  ]) assert.equal(existsSync(resolve(root, path)), false, path);
  for (const path of ["replit.md", "AGENTS.md"]) {
    assert.ok(read(path).includes(".agents/skills/failure-gate-unified/SKILL.md"));
  }
  const pin = json("docs/validation/unified-pin.json");
  if (pin.schemaVersion === 1) {
    assert.equal(createHash("sha256").update(read(pin.source)).digest("hex"), pin.current);
  } else {
    const files = ["SKILL.md", "references/gate-maintenance.md", "references/planning-and-publication.md"].sort();
    const digest = files.map((name) => `${name}\0${createHash("sha256").update(read(`.agents/skills/failure-gate-unified/${name}`)).digest("hex")}\n`).join("");
    assert.equal(createHash("sha256").update(digest).digest("hex"), pin.current);
  }
  assert.doesNotMatch(read("scripts/run-tier.mjs"),
    /assertRequestedTier|runPlanGuards|\/proc\/|fstatSync|realpathSync|FAILURE_GATE_PLAN_GUARDS_DONE/);
  const releaseBefore = read(`${archive}/scripts/build-and-verify-release.sh.before-retirement.txt`);
  assert.equal(read("scripts/build-and-verify-release.sh"),
    releaseBefore.replace("node scripts/check-failure-gate-parity.mjs\n", ""));
});
