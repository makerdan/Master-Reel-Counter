import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { spawnSync } from "child_process";
import { loadTiers } from "../lib/tiers.mjs";
import { findExactRecord, isReferenceable, loadCatalog, maintenanceFindings } from "../lib/baseline.mjs";

const ROOT = process.cwd();
const PACKAGE_FILES = [
  ["SKILL.md", ".agents/skills/failure-gate/SKILL.md"],
  ["validation-tiers.md", ".agents/skills/validation-tiers/SKILL.md"],
  ["tiers.json", ".agents/skills/validation-tiers/tiers.json"],
];
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

test("portable contract separates invariants from host-specific adaptation", () => {
  const skill = readFileSync(join(ROOT, ".agents/skills/failure-gate/SKILL.md"), "utf8");
  const tiers = readFileSync(join(ROOT, ".agents/skills/validation-tiers/SKILL.md"), "utf8");
  for (const phrase of [
    "## Portability boundary",
    "### Portable requirements",
    "### Required host adaptation",
    "## Host-project adapter: this repository",
    "task validation",
    "completion validation",
    "TIER-LOCK VIOLATION",
    "passing retry establishes intermittency",
    "incomplete",
    "not reached",
    "Audit steps preserve their registered command, threshold, and result",
  ]) {
    assert.match(skill, new RegExp(phrase, "i"), `missing portable contract phrase: ${phrase}`);
  }
  assert.match(tiers, /example host registry, not as a portable default/i);
  assert.match(tiers, /Only `test` failures are eligible for exact baseline\s+classification/);
  assert.match(tiers, /Audit commands and thresholds are integrity-sensitive/);
});

test("runner reports incomplete and not-reached steps without executing later work", () => {
  const dir = mkdtempSync(join(tmpdir(), "failure-gate-manifest-"));
  const manifestPath = join(dir, "manifest.json");
  const markerPath = join(dir, "should-not-run");
  writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    tiers: {
      "test-fixture": {
        resource: "fixture",
        priority: 1,
        timeoutMs: 100,
        steps: [
          { name: "terminated", kind: "harness", command: [process.execPath, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 10_000)"] },
          { name: "later-audit", kind: "audit", command: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`] },
        ],
      },
    },
  }));
  const result = run("scripts/run-tier.mjs", ["test-fixture", "--allow-no-plan"], {
    TASK_PLAN_FILE: "",
    VALIDATION_MANIFEST_PATH: manifestPath,
  });
  assert.equal(result.status, 124);
  assert.match(result.stderr, /INCOMPLETE: terminated/);
  assert.match(result.stderr, /NOT REACHED: later-audit/);
  assert.equal(existsSync(markerPath), false);
});

test("audit failures retain their exit result and stop later steps", () => {
  const dir = mkdtempSync(join(tmpdir(), "failure-gate-audit-"));
  const manifestPath = join(dir, "manifest.json");
  const markerPath = join(dir, "should-not-run");
  writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    tiers: {
      "test-audit-fixture": {
        resource: "fixture",
        priority: 1,
        timeoutMs: 5000,
        steps: [
          { name: "dependency-audit", kind: "audit", command: [process.execPath, "-e", "process.exit(7)"] },
          { name: "later-test", kind: "test", command: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'ran')`] },
        ],
      },
    },
  }));
  const result = run("scripts/run-tier.mjs", ["test-audit-fixture", "--allow-no-plan"], {
    TASK_PLAN_FILE: "",
    VALIDATION_MANIFEST_PATH: manifestPath,
  });
  assert.equal(result.status, 7);
  assert.match(result.stderr, /FAIL: dependency-audit ended with exit 7/);
  assert.match(result.stderr, /NOT REACHED: later-test/);
  assert.equal(existsSync(markerPath), false);
});

test("Failure Gate package regeneration is byte-for-byte stable", () => {
  const first = run("scripts/publish-failure-gate.mjs", []);
  assert.equal(first.status, 0, first.stderr);
  const packagePath = join(ROOT, "artifacts/bathyscan/public/failure-gate-skill.zip");
  const firstBytes = readFileSync(packagePath);

  const second = run("scripts/publish-failure-gate.mjs", []);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(readFileSync(packagePath), firstBytes);

  const entries = spawnSync("unzip", ["-Z1", packagePath], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(entries.status, 0, entries.stderr);
  assert.deepEqual(entries.stdout.trim().split("\n"), [
    "SKILL.md",
    "validation-tiers.md",
    "tiers.json",
  ]);
});

test("registered standard validation runs the contract and archive parity checks", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "docs/validation/manifest.json"), "utf8"));
  assert.ok(manifest.tiers["test-standard"].steps.some(
    (step) => step.name === "failure-gate-contract"
      && step.command.join(" ") === "node --test scripts/__tests__/failure-gate.test.mjs",
  ));
  assert.ok(manifest.tiers["test-standard"].steps.some(
    (step) => step.name === "failure-gate-parity"
      && step.command.join(" ") === "node scripts/check-failure-gate-parity.mjs",
  ));
});

test("published archive drift fails with regeneration guidance", () => {
  const sourcePath = join(ROOT, ".agents/skills/validation-tiers/tiers.json");
  const original = readFileSync(sourcePath);
  writeFileSync(sourcePath, Buffer.concat([original, Buffer.from("\n// deliberate mismatch\n")]));
  try {
    const result = run("scripts/check-failure-gate-parity.mjs", []);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /published tiers\.json differs from its canonical source/);
    assert.match(result.stderr, /npm run publish:failure-gate/);
  } finally {
    writeFileSync(sourcePath, original);
  }
});

test("Failure Gate package reproduces byte-for-byte from a clean checkout", () => {
  const checkout = mkdtempSync(join(tmpdir(), "failure-gate-clean-checkout-"));
  const publisher = join(checkout, "scripts/publish-failure-gate.mjs");
  const expectedPackage = join(ROOT, "artifacts/bathyscan/public/failure-gate-skill.zip");

  try {
    mkdirSync(dirname(publisher), { recursive: true });
    copyFileSync(join(ROOT, "scripts/publish-failure-gate.mjs"), publisher);
    for (const [, source] of PACKAGE_FILES) {
      const target = join(checkout, source);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(ROOT, source), target);
    }

    const published = spawnSync(process.execPath, ["scripts/publish-failure-gate.mjs"], {
      cwd: checkout,
      env: { ...process.env },
      encoding: "utf8",
    });
    assert.equal(published.status, 0, published.stderr);

    const cleanPackage = join(checkout, "artifacts/bathyscan/public/failure-gate-skill.zip");
    assert.deepEqual(readFileSync(cleanPackage), readFileSync(expectedPackage));

    const entries = spawnSync("unzip", ["-Z1", cleanPackage], {
      cwd: checkout,
      encoding: "utf8",
    });
    assert.equal(entries.status, 0, entries.stderr);
    assert.deepEqual(entries.stdout.trim().split("\n"), PACKAGE_FILES.map(([name]) => name));
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
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
  const dir = mkdtempSync(join(tmpdir(), "failure-gate-adhoc-"));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    tiers: {
      "test-adhoc-fixture": {
        resource: `adhoc-${process.pid}`,
        priority: 1,
        timeoutMs: 5000,
        steps: [
          { name: "pass", kind: "test", command: [process.execPath, "-e", "process.exit(0)"] },
        ],
      },
    },
  }));
  const result = run("scripts/run-tier.mjs", ["test-adhoc-fixture", "--allow-no-plan"], {
    TASK_PLAN_FILE: "",
    VALIDATION_MANIFEST_PATH: manifestPath,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ad-hoc run explicitly allowed/);
});

test("package lifecycle metadata cannot bypass the task tier lock", () => {
  const result = run("scripts/run-tier.mjs", ["test-light"], {
    TASK_PLAN_FILE: "",
    npm_lifecycle_event: "test-light",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /TASK_PLAN_FILE is required/);
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const tier of ["test-fast", "test-standard", "test-standard-plus", "test-heavy"]) {
    assert.match(packageJson.scripts[tier], /--allow-no-plan$/);
  }
});

test("direct execute mode rejects spoofed guard metadata without a verified ancestor lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "failure-gate-forged-lock-"));
  const lockPath = join(dir, "lock");
  const attestationPath = join(dir, "attestation");
  writeFileSync(lockPath, `${String(process.ppid).padStart(12, "0")}\n${String(Date.now()).padStart(16, "0")}\n${String(Date.now()).padStart(16, "0")}\nspoofed\n`);
  const attestationFd = openSync(attestationPath, "w+", 0o600);
  writeFileSync(attestationFd, JSON.stringify({
    holderPid: process.pid,
    holderFd: attestationFd,
    token: "spoofed",
    resource: "validation",
    lockPath,
  }));
  const result = spawnSync(process.execPath, ["scripts/run-tier.mjs", "--execute", "test-light"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TASK_PLAN_FILE: "",
      FAILURE_GATE_PLAN_GUARDS_DONE: "1",
      VALIDATION_LOCK_HELD_PID_VALIDATION: String(process.pid),
      VALIDATION_LOCK_ATTESTATION_FD: "3",
      VALIDATION_LOCK_FILE: lockPath,
    },
    stdio: ["ignore", "pipe", "pipe", attestationFd],
    encoding: "utf8",
  });
  closeSync(attestationFd);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /execute mode requires the verified resource lock holder as an ancestor/);
  const runner = readFileSync(join(ROOT, "scripts/run-tier.mjs"), "utf8");
  assert.match(runner, /realpathSync\(`\/proc\/\$\{attestation\.holderPid\}\/exe`\)/);
  assert.match(runner, /resolve\(holderCommand\[1\] \?\? ""\) === resolve\(root, "scripts\/serial-lock\.mjs"\)/);
});

test("npm-mediated nested tiers preserve the verified reentrant lock capability", () => {
  const result = run("scripts/ci-collision-test.mjs", ["--non-smoke"], { TASK_PLAN_FILE: "" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /nested tier used the owned reentrancy path/);
  assert.match(result.stdout, /nested manifest step ran exactly once/);
  assert.doesNotMatch(result.stdout, /waiting for resource 'validation'/);
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