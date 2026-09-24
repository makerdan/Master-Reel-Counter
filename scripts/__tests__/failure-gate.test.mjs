import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, dirname, join } from "path";
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
const runIn = (cwd, script, args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  cwd,
  env: { ...process.env, ...env },
  encoding: "utf8",
});
const fixturePlan = (body) => {
  const dir = mkdtempSync(join(tmpdir(), "failure-gate-"));
  const path = join(dir, "plan.md");
  writeFileSync(path, body);
  return path;
};
const manifestValidatorFixture = (mutate) => {
  const dir = mkdtempSync(join(tmpdir(), "validation-manifest-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  mkdirSync(join(dir, "docs", "validation"), { recursive: true });
  mkdirSync(join(dir, ".agents", "skills", "validation-tiers"), { recursive: true });
  copyFileSync(join(ROOT, "scripts/validate-validation-manifest.mjs"), join(dir, "scripts/validate-validation-manifest.mjs"));
  copyFileSync(join(ROOT, "scripts/lib/tiers.mjs"), join(dir, "scripts/lib/tiers.mjs"));
  copyFileSync(
    join(ROOT, ".agents/skills/validation-tiers/tiers.json"),
    join(dir, ".agents/skills/validation-tiers/tiers.json"),
  );
  copyFileSync(join(ROOT, "package.json"), join(dir, "package.json"));
  const manifestPath = join(dir, "docs", "validation", "manifest.json");
  const manifest = JSON.parse(readFileSync(join(ROOT, "docs/validation/manifest.json"), "utf8"));
  mutate(manifest);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return runIn(dir, "scripts/validate-validation-manifest.mjs", []);
};
const validPlan = `# Fixture

## Pre-existing failures to ignore
None known at plan time.

## Validation
**Command:** \`test-fast\`
**Why:** Static checks cover this documentation-only fixture.
**Do not escalate:** Run exactly this command.

## Regression Guard
**Self-satisfying** — this fixture tests the guard.
`;

test("registry exposes every canonical validation tier with executable commands", () => {
  const tiers = loadTiers();
  assert.deepEqual(Object.keys(tiers), ["test-fast", "test-standard", "test-standard-plus", "test-heavy"]);
  for (const tier of Object.values(tiers)) {
    for (const step of tier.steps) {
      assert.ok(Array.isArray(step.command));
      assert.ok(step.command.every((part) => typeof part === "string" && part.length > 0));
    }
  }
  assert.ok(tiers["test-heavy"].steps.some((step) => step.command.join(" ") === "npm audit --audit-level=high"));
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

test("registered validation tiers run the Failure Gate contract and archive parity checks", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "docs/validation/manifest.json"), "utf8"));
  assert.ok(manifest.tiers["test-standard"].steps.some(
    (step) => step.name === "failure-gate-contract"
      && step.command.join(" ") === "node --test scripts/__tests__/failure-gate.test.mjs",
  ));
  assert.ok(manifest.tiers["test-standard"].steps.some(
    (step) => step.name === "failure-gate-parity"
      && step.command.join(" ") === "node scripts/check-failure-gate-parity.mjs",
  ));
  for (const tier of ["test-standard-plus", "test-heavy"]) {
    assert.ok(manifest.tiers[tier].steps.some(
      (step) => step.name === "failure-gate-parity"
        && step.command.join(" ") === "node scripts/check-failure-gate-parity.mjs",
    ), `${tier} must check Failure Gate archive parity`);
  }
});

test("manifest parity requires exactly one high-severity security audit", () => {
  const missing = manifestValidatorFixture((manifest) => {
    manifest.tiers["test-heavy"].steps = manifest.tiers["test-heavy"].steps
      .filter((step) => step.name !== "security-audit");
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /exactly one security-audit step/);

  const weakened = manifestValidatorFixture((manifest) => {
    const audit = manifest.tiers["test-heavy"].steps.find((step) => step.name === "security-audit");
    audit.command = ["npm", "audit", "--audit-level=moderate"];
  });
  assert.equal(weakened.status, 1);
  assert.match(weakened.stderr, /high-severity threshold/);

  const duplicated = manifestValidatorFixture((manifest) => {
    const audit = manifest.tiers["test-heavy"].steps.find((step) => step.name === "security-audit");
    manifest.tiers["test-heavy"].steps.push({ ...audit });
  });
  assert.equal(duplicated.status, 1);
  assert.match(duplicated.stderr, /exactly one security-audit step/);
});

test("release validation entry point runs the registered high-severity audit without live advisories", () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["test-heavy"], "node scripts/run-tier.mjs test-heavy --allow-no-plan");

  const manifest = JSON.parse(readFileSync(join(ROOT, "docs/validation/manifest.json"), "utf8"));
  const heavyTier = manifest.tiers["test-heavy"];
  const auditSteps = heavyTier.steps.filter((step) => step.name === "security-audit");
  assert.equal(auditSteps.length, 1, "release validation must register exactly one security audit");
  assert.equal(auditSteps[0].kind, "audit");
  assert.deepEqual(auditSteps[0].command, ["npm", "audit", "--audit-level=high"]);

  const dir = mkdtempSync(join(tmpdir(), "failure-gate-release-audit-"));
  try {
    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    const manifestPath = join(dir, "manifest.json");
    const auditLogPath = join(dir, "audit-invocations.log");
    const fixtureManifest = structuredClone(manifest);
    fixtureManifest.tiers["test-heavy"] = {
      ...heavyTier,
      resource: `failure-gate-audit-${process.pid}`,
      priority: 1,
      timeoutMs: 15_000,
      steps: heavyTier.steps.map((step) => step.name === "security-audit"
        ? step
        : { ...step, command: [process.execPath, "-e", "process.exit(0)"] }),
    };
    writeFileSync(manifestPath, JSON.stringify(fixtureManifest));

    const npmShimPath = join(binDir, "npm");
    writeFileSync(npmShimPath, [
      "#!/bin/sh",
      'printf "%s\\n" "$*" >> "$AUDIT_FIXTURE_LOG"',
      'if [ "$#" -eq 2 ] && [ "$1" = "audit" ] && [ "$2" = "--audit-level=high" ]; then exit 0; fi',
      'echo "Unexpected npm invocation: $*" >&2',
      "exit 91",
      "",
    ].join("\n"));
    chmodSync(npmShimPath, 0o755);

    const npmPath = process.env.PATH.split(delimiter)
      .map((directory) => join(directory, "npm"))
      .find((candidate) => existsSync(candidate));
    assert.ok(npmPath, "the release validation fixture requires npm");
    const result = spawnSync(npmPath, ["run", "test-heavy"], {
      cwd: ROOT,
      env: {
        ...process.env,
        TASK_PLAN_FILE: "",
        VALIDATION_MANIFEST_PATH: manifestPath,
        AUDIT_FIXTURE_LOG: auditLogPath,
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
      },
      encoding: "utf8",
      timeout: 30_000,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /\[validation\] Step: security-audit/);
    assert.match(result.stdout, /\[validation\] Command: npm audit --audit-level=high/);
    assert.match(result.stdout, /\[validation\] PASS: security-audit/);
    assert.equal(readFileSync(auditLogPath, "utf8"), "audit --audit-level=high\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manifest parity rejects missing, extra, and malformed tiers", () => {
  const valid = manifestValidatorFixture(() => {});
  assert.equal(valid.status, 0, valid.stderr);

  const missing = manifestValidatorFixture((manifest) => {
    delete manifest.tiers["test-standard-plus"];
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /tier parity mismatch: missing test-standard-plus/);

  const extra = manifestValidatorFixture((manifest) => {
    manifest.tiers["test-hidden"] = {};
  });
  assert.equal(extra.status, 1);
  assert.match(extra.stderr, /tier parity mismatch: unexpected test-hidden/);

  const malformed = manifestValidatorFixture((manifest) => {
    manifest.tiers["test-fast"].steps[0].command = ["npm", 42];
  });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /test-fast contains an invalid step/);
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

test("current Failure Gate archive passes the release packaging preflight", () => {
  const result = spawnSync("bash", [join(ROOT, "scripts/build-and-verify-release.sh")], {
    cwd: ROOT,
    env: {
      ...process.env,
      RELEASE_CLEANUP_HARNESS: "1",
      RELEASE_CLEANUP_EXIT_STATUS: "0",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("stale Failure Gate archive blocks release packaging with regeneration guidance", () => {
  const sourcePath = join(ROOT, ".agents/skills/validation-tiers/tiers.json");
  const original = readFileSync(sourcePath);
  writeFileSync(sourcePath, Buffer.concat([original, Buffer.from("\n// deliberate release mismatch\n")]));
  try {
    const result = spawnSync("bash", [join(ROOT, "scripts/build-and-verify-release.sh")], {
      cwd: ROOT,
      env: {
        ...process.env,
        RELEASE_CLEANUP_HARNESS: "1",
        RELEASE_CLEANUP_EXIT_STATUS: "0",
      },
      encoding: "utf8",
    });
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
      "--name", "fixture-plan", "--why", "exercise plan creation", "--tier", "test-fast",
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

test("plan scaffold accepts every canonical validation tier", () => {
  const created = [];
  try {
    for (const tier of Object.keys(loadTiers())) {
      const name = `fixture-tier-${tier}`;
      const result = run("scripts/new-plan.mjs", [
        "--name", name,
        "--why", "exercise canonical tier registration",
        "--tier", tier,
      ]);
      assert.equal(result.status, 0, `${tier}: ${result.stderr}`);
      created.push(join(ROOT, ".local/tasks", `${name}.md`));
    }
  } finally {
    for (const path of created) rmSync(path, { force: true });
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
  const noPlan = run("scripts/run-tier.mjs", ["test-fast"], { TASK_PLAN_FILE: "" });
  assert.equal(noPlan.status, 2);
  assert.match(noPlan.stderr, /TASK_PLAN_FILE is required/);
  const path = fixturePlan(validPlan);
  const mismatch = run("scripts/run-tier.mjs", ["test-standard"], { TASK_PLAN_FILE: path });
  assert.equal(mismatch.status, 2);
  assert.match(mismatch.stderr, /requested test-standard but plan locks test-fast/);
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
  const result = run("scripts/run-tier.mjs", ["test-fast"], {
    TASK_PLAN_FILE: "",
    npm_lifecycle_event: "test-fast",
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
  const result = spawnSync(process.execPath, ["scripts/run-tier.mjs", "--execute", "test-fast"], {
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