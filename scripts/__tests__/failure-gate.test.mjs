import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { loadTiers } from "../lib/tiers.mjs";
import { findExactRecord, isReferenceable, loadCatalog, maintenanceFindings } from "../lib/baseline.mjs";

const ROOT = process.cwd();
const run = (script, args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  cwd: ROOT,
  env: { ...process.env, ...env },
  encoding: "utf8",
});
const fixturePlan = (body) => {
  const dir = mkdtempSync(join(tmpdir(), "failure-gate-"));
  const path = join(dir, "plan.md");
  writeFileSync(path, body);
  return path;
};
const validPlan = `# Fixture

## Pre-existing failures to ignore
None known at plan time.

## Validation
**Command:** \`test-light\`
**Why:** Static checks cover this documentation-only fixture.
**Do not escalate:** Run exactly this command.

## Regression Guard
**Self-satisfying** — this fixture tests the guard.
`;

test("registry exposes extensible light, standard, and heavy tiers", () => {
  const tiers = loadTiers();
  assert.deepEqual(Object.keys(tiers), ["test-light", "test-standard", "test-heavy"]);
  assert.ok(tiers["test-heavy"].steps.some((step) => step.command.includes("npm run ci")));
  assert.equal(tiers["test-heavy"].serial, true);
});

test("plan scaffold rejects unknown tiers and creates exact baseline markers", () => {
  const invalid = run("scripts/new-plan.mjs", ["--name", "fixture-invalid", "--why", "test", "--tier", "not-registered"]);
  assert.equal(invalid.status, 1);
  const catalogPath = join(ROOT, "docs/validation/failure-baseline.json");
  const original = readFileSync(catalogPath, "utf8");
  writeFileSync(catalogPath, JSON.stringify({ schemaVersion: 1, records: [{
    id: "BASE-FIXTURE", suite: "unit", test: "case", signature: "boom", status: "active",
    owner: "test-owner", observedOn: "2026-09-04", verifiedOn: "2026-09-04", reviewBy: "2099-01-01",
  }] }, null, 2));
  try {
    const result = run("scripts/new-plan.mjs", [
      "--name", "fixture-plan", "--why", "exercise plan creation", "--tier", "test-light",
      "--baseline-id", "BASE-FIXTURE",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const planPath = join(ROOT, ".local/tasks/fixture-plan.md");
    const plan = readFileSync(planPath, "utf8");
    assert.match(plan, /Ignored baseline:.*unit › case; match only this signature: boom/);
    rmSync(planPath, { force: true });
  } finally {
    writeFileSync(catalogPath, original);
  }
});

test("valid plan passes both scoped guards", () => {
  const path = fixturePlan(validPlan);
  const failure = run("scripts/check-failure-gate.mjs", [], { TASK_PLAN_FILE: path });
  const regression = run("scripts/check-regression-guard.mjs", [], { TASK_PLAN_FILE: path });
  assert.equal(failure.status, 0, failure.stderr);
  assert.equal(regression.status, 0, regression.stderr);
});

test("missing required sections can be stubbed but placeholders still fail closed", () => {
  const path = fixturePlan("# Missing\n");
  const fixed = run("scripts/check-failure-gate.mjs", ["--fix-stub"], { TASK_PLAN_FILE: path });
  const strict = run("scripts/check-failure-gate.mjs", [], { TASK_PLAN_FILE: path });
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /Why is empty or a placeholder/);
  assert.match(readFileSync(path, "utf8"), /## Validation/);
});

test("scoped guards reject missing and non-markdown plan paths", () => {
  const missing = run("scripts/check-failure-gate.mjs", [], { TASK_PLAN_FILE: "/tmp/no-such-plan.txt" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /existing \.md file/);
  const regression = run("scripts/check-regression-guard.mjs", [], { TASK_PLAN_FILE: "/tmp/no-such-plan.md" });
  assert.equal(regression.status, 1);
  assert.match(regression.stderr, /existing \.md file/);
});

test("unauthorized baseline IDs fail closed and archive inspection is explicit", () => {
  const unauthorized = fixturePlan(validPlan.replace(
    "None known at plan time.",
    "- **Ignored baseline:** \`BASE-NOT-AUTHORIZED\` — unit › case; match only this signature: boom.",
  ));
  const result = run("scripts/check-failure-gate.mjs", [], { TASK_PLAN_FILE: unauthorized });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown baseline id BASE-NOT-AUTHORIZED/);

  const archiveDir = mkdtempSync(join(tmpdir(), "failure-gate-archive-"));
  const archivePlan = join(archiveDir, "archived.md");
  writeFileSync(archivePlan, validPlan);
  const archive = run("scripts/check-failure-gate.mjs", ["--archive"], { FAILURE_GATE_ARCHIVE_DIR: archiveDir });
  assert.equal(archive.status, 0, archive.stderr);
  const defaultScan = run("scripts/check-failure-gate.mjs", [], { FAILURE_GATE_ARCHIVE_DIR: archiveDir });
  assert.equal(defaultScan.status, 0, defaultScan.stderr);
});

test("tier lock fails before validation when plan is missing or mismatched", () => {
  const noPlan = run("scripts/run-tier.mjs", ["test-light"], { TASK_PLAN_FILE: "" });
  assert.equal(noPlan.status, 2);
  assert.match(noPlan.stderr, /TASK_PLAN_FILE is required/);
  const path = fixturePlan(validPlan);
  const mismatch = run("scripts/run-tier.mjs", ["test-standard"], { TASK_PLAN_FILE: path });
  assert.equal(mismatch.status, 2);
  assert.match(mismatch.stderr, /requested test-standard but plan locks test-light/);
});

test("ad-hoc validation requires an explicit no-plan escape hatch", () => {
  const result = run("scripts/run-tier.mjs", ["test-light", "--allow-no-plan"], { TASK_PLAN_FILE: "" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ad-hoc run explicitly allowed/);
});

test("baseline resolution is exact and only active unexpired records are referenceable", () => {
  const active = {
    id: "BASE-1", suite: "unit", test: "case", signature: "boom",
    status: "active", reviewBy: "2099-01-01",
  };
  const catalog = { records: [active] };
  assert.equal(findExactRecord(catalog, active).ok, true);
  assert.equal(findExactRecord(catalog, { ...active, signature: "different" }).ok, false);
  assert.equal(isReferenceable({ ...active, status: "expired" }), false);
  assert.equal(isReferenceable({ ...active, reviewBy: "2000-01-01" }), false);
  for (const status of ["resolved", "intermittent", "environment-limited", "unknown", "needs-review"]) {
    assert.equal(isReferenceable({ ...active, status }), false);
  }
});

test("malformed baseline catalogs fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "failure-gate-catalog-"));
  const path = join(dir, "baseline.json");
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, records: [{ id: "BAD" }] }));
  assert.throws(() => loadCatalog(path), /suite is required/);
});

test("maintenance reports review deadlines and stale verification", () => {
  const findings = maintenanceFindings({
    records: [{
      id: "BASE-DUE", suite: "unit", test: "case", signature: "boom",
      status: "active", reviewBy: "2026-09-20", verifiedOn: "2026-01-01",
    }],
  }, { today: new Date("2026-09-04T00:00:00Z"), warningDays: 30, staleDays: 90 });
  assert.deepEqual(findings.map((item) => item.category), ["review-due", "stale-verification"]);
});

test("regression guard rejects filled-looking placeholders and accepts N/A", () => {
  const placeholder = fixturePlan(validPlan.replace(
    "**Self-satisfying** — this fixture tests the guard.",
    "**Covers:** FILL IN\n**Test location:** tests/example.test.ts\n**What it checks:** assertion",
  ));
  const result = run("scripts/check-regression-guard.mjs", [], { TASK_PLAN_FILE: placeholder });
  assert.equal(result.status, 1);
  const na = fixturePlan(validPlan.replace(
    "**Self-satisfying** — this fixture tests the guard.",
    "**N/A**\n**Why N/A:** The behavior depends on an unmockable external API.",
  ));
  assert.equal(run("scripts/check-regression-guard.mjs", [], { TASK_PLAN_FILE: na }).status, 0);
});