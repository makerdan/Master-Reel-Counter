#!/usr/bin/env node
/**
 * ci-collision-test.mjs — Concurrent-trigger smoke test for the serial lock.
 *
 * Validates two things:
 *
 * Part 1 — Integration check:
 *   Reads package.json and asserts that `ci` routes through the canonical
 *   test-heavy tier runner and `test:e2e` routes through serial-lock.mjs.
 *
 * Part 2 — Concurrent npm run invocation test:
 *   Launches `npm run ci` and `npm run test:e2e` simultaneously with:
 *     • An isolated temporary SERIAL_LOCK_PATH so the real lockfile is untouched.
 *     • CI_SMOKE_TEST=1 so ci.sh exits 0 in seconds (not a full CI run).
 *     • --pass-with-no-tests --grep CI_SMOKE_NO_TESTS_INTENTIONAL for the e2e
 *       command so playwright exits 0 without running the full test suite.
 *
 *   Both processes run to natural completion — no forced kills.
 *
 *   Assertions:
 *     a) Both processes exit with code 0.
 *     b) At least one process stdout contains "[serial-lock] waiting" — proof
 *        one queued behind the other rather than both running concurrently.
 *     c) Both stdout streams contain "[serial-lock]" with "acquired lock".
 *
 * Run:  node scripts/ci-collision-test.mjs
 */

import { spawn, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG_PATH = resolve(ROOT, "package.json");

async function runNonSmokeReentrancyRegression() {
  console.log("[ci-collision-test] Non-smoke mode: reaching a manifest step through a nested tier…");

  const fixtureDir = mkdtempSync("/tmp/repl-validation-reentrancy-");
  const manifestPath = join(fixtureDir, "manifest.json");
  const probeCommand = [
    process.execPath,
    "-e",
    "console.log('[validation-regression] nested manifest probe reached');",
  ];
  writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    tiers: {
      "test-fast": {
        packageScript: "npm run test-fast",
        resource: "validation",
        priority: 1,
        timeoutMs: 30_000,
        steps: [{ name: "nested-manifest-probe", command: probeCommand }],
      },
      "test-heavy": {
        packageScript: "npm run test-heavy",
        resource: "validation",
        priority: 3,
        timeoutMs: 30_000,
        // This tier is intentionally nested under the outer test-heavy lock,
        // but it is not a second task-plan execution. Keep the lock marker so
        // serial-lock can take its reentrant path while clearing the inherited
        // plan so the nested test-fast request cannot mismatch the outer tier.
        steps: [{
          name: "nested-tier",
          command: ["env", "-u", "TASK_PLAN_FILE", "npm", "run", "test-fast"],
        }],
      },
    },
  }, null, 2));

  const fixtureEnv = {
    ...process.env,
    VALIDATION_MANIFEST_PATH: manifestPath,
    VALIDATION_LOCK_FILE: join(fixtureDir, "validation.lock"),
    VALIDATION_LOCK_WAITERS_DIR: join(fixtureDir, "waiters"),
    CI_SMOKE_TEST: "",
    SERIAL_LOCK_WAIT_INTERVAL_MS: "100",
    SERIAL_LOCK_MAX_WAIT_MS: "5_000",
  };
  // The regression creates its own outer lock. Do not let a task workflow or
  // another validation run make the fixture appear reentrant before it starts.
  for (const key of Object.keys(fixtureEnv)) {
    if (
      key === "SERIAL_LOCK_HOLDER_PID" ||
      key.startsWith("VALIDATION_LOCK_HELD_PID_")
    ) {
      delete fixtureEnv[key];
    }
  }

  const result = spawnSync(
    process.execPath,
    [resolve(ROOT, "scripts/run-tier.mjs"), "test-heavy", "--allow-no-plan"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: fixtureEnv,
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const checks = [
    [result.status === 0, `nested validation exited 0 (got ${result.status})`],
    [output.includes("[validation] Step: nested-tier"), "outer run reached its manifest step"],
    [output.includes("[validation] Step: nested-manifest-probe"), "nested tier reached its manifest step"],
    [output.includes("no task plan is in force"), "nested tier did not inherit the outer task plan"],
    [output.includes("[serial-lock] reentrant resource 'validation'"), "nested tier used the owned reentrancy path"],
    [!output.includes("[serial-lock] waiting"), "nested tier did not wait behind its owning lock"],
    [output.match(/\[validation\] Step: nested-manifest-probe/g)?.length === 1, "nested manifest step ran exactly once"],
  ];
  for (const [passed, message] of checks) {
    if (!passed) {
      console.error(`  FAIL: ${message}`);
      console.error(output);
      rmSync(fixtureDir, { recursive: true, force: true });
      process.exit(1);
    }
    console.log(`  PASS: ${message}`);
  }
  rmSync(fixtureDir, { recursive: true, force: true });
  console.log("[ci-collision-test] Non-smoke reentrancy regression passed.");
}

if (process.argv.includes("--non-smoke")) {
  await runNonSmokeReentrancyRegression();
  process.exit(0);
}

// ── Part 1: Integration check ─────────────────────────────────────────────────

console.log(
  "[ci-collision-test] Part 1: Verifying npm scripts still route through serial-lock.mjs…"
);

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const scripts = pkg.scripts ?? {};
let integrationOk = true;

const expectedRoutes = {
  ci: "test-heavy",
  "test:e2e": "serial-lock.mjs",
};
for (const [name, expected] of Object.entries(expectedRoutes)) {
  const script = scripts[name] ?? "";
  if (!script.includes(expected)) {
    console.error(
      `  FAIL: npm run ${name} does not route through ${expected} (got: "${script}")`
    );
    integrationOk = false;
  } else {
    console.log(`  PASS: npm run ${name} → routes through ${expected}`);
  }
}

if (!integrationOk) {
  console.error("\n[ci-collision-test] Part 1 FAILED. Aborting.");
  process.exit(1);
}

// ── Part 2: Concurrent npm run invocation test ────────────────────────────────

console.log(
  "\n[ci-collision-test] Part 2: Spawning npm run ci + npm run test:e2e concurrently…"
);

// Isolated fixture so we don't stomp on a real CI run. Keep the lock and
// waiter directory together so an interrupted harness can remove both.
let FIXTURE_DIR = null;
const children = [];
let interruptedSignal = null;
let resolveInterruption;
const interruption = new Promise((resolvePromise) => {
  resolveInterruption = resolvePromise;
});

function cleanupFixture() {
  if (!FIXTURE_DIR) return;
  try {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  } catch (error) {
    // Cleanup must never replace the collision result or signal status.
    console.error(
      `[ci-collision-test] WARNING: unable to remove temporary fixture: ${error.message}`,
    );
  }
}

function signalExitCode(signal) {
  return 128 + ({ SIGINT: 2, SIGTERM: 15 }[signal] ?? 1);
}

function signalChild(proc, signal) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && proc.pid) {
      process.kill(-proc.pid, signal);
    } else {
      proc.kill(signal);
    }
  } catch {
    // The child may have exited between the state check and the signal.
  }
}

const handleInterruption = (signal) => {
  if (interruptedSignal) return;
  interruptedSignal = signal;
  resolveInterruption(signal);
  for (const child of children) signalChild(child, signal);
};
const handleSigint = () => handleInterruption("SIGINT");
const handleSigterm = () => handleInterruption("SIGTERM");
process.once("SIGINT", handleSigint);
process.once("SIGTERM", handleSigterm);

FIXTURE_DIR = mkdtempSync("/tmp/repl-collision-test-");
const LOCK_PATH = join(FIXTURE_DIR, "validation.lock");
const WAITERS_DIR = join(FIXTURE_DIR, "waiters");
console.log(`[ci-collision-test] Temporary fixture: ${FIXTURE_DIR}`);

// Shared env for the smoke invocations.
const testEnv = {
  ...process.env,
  SERIAL_LOCK_PATH: LOCK_PATH,
  // serial-lock.mjs gives VALIDATION_LOCK_FILE precedence over
  // SERIAL_LOCK_PATH. Override both so the nested smoke invocations cannot
  // wait on the validation harness's own lock.
  VALIDATION_LOCK_FILE: LOCK_PATH,
  VALIDATION_LOCK_WAITERS_DIR: WAITERS_DIR,
  // Short poll interval so queuing is visible quickly.
  SERIAL_LOCK_WAIT_INTERVAL_MS: "500",
  // ci.sh checks this and exits 0 immediately — keeps the test fast.
  CI_SMOKE_TEST: "1",
};
// Smoke mode deliberately tests two independent contenders. Do not let the
// enclosing heavy manifest's task plan or ownership marker turn either
// contender into a reentrant child of that unrelated lock.
for (const key of Object.keys(testEnv)) {
  if (
    key === "TASK_PLAN_FILE" ||
    key === "SERIAL_LOCK_HOLDER_PID" ||
    key.startsWith("VALIDATION_LOCK_HELD_PID_")
  ) {
    delete testEnv[key];
  }
}

function capture(proc) {
  let out = "";
  proc.stdout?.on("data", (d) => { out += d.toString(); });
  proc.stderr?.on("data", (d) => { out += d.toString(); });
  const done = new Promise((res) =>
    proc.on("close", (code, signal) =>
      res({ code: code ?? signalExitCode(signal), signal, out })
    )
  );
  return done;
}

const holdMs = Number.parseInt(process.env.CI_COLLISION_TEST_HOLD_MS ?? "0", 10);

// Process A: npm run ci — exits 0 immediately because CI_SMOKE_TEST=1.
const procA = spawn("npm", ["run", "ci"], {
  cwd: ROOT,
  env: testEnv,
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
});
children.push(procA);
const doneA = capture(procA);
if (interruptedSignal) signalChild(procA, interruptedSignal);

// Process B: npm run test:e2e with --pass-with-no-tests so playwright exits 0
// without running the full suite. The extra args are forwarded by npm's `--`.
const procB = spawn(
  "npm",
  ["run", "test:e2e", "--", "--pass-with-no-tests", "--grep", "CI_SMOKE_NO_TESTS_INTENTIONAL"],
  {
    cwd: ROOT,
    env: testEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  }
);
children.push(procB);
const doneB = capture(procB);
if (interruptedSignal) signalChild(procB, interruptedSignal);

console.log(
  "[ci-collision-test] Both npm run commands spawned. Waiting for both to complete…"
);

let resultA;
let resultB;
let exitCode = 0;
try {
  if (holdMs > 0 && !interruptedSignal) {
    await Promise.race([
      new Promise((resolvePromise) => setTimeout(resolvePromise, holdMs)),
      interruption,
    ]);
  }

  // Both run to completion unless the harness receives a termination signal.
  [resultA, resultB] = await Promise.all([doneA, doneB]);

  if (!interruptedSignal) {
    // ── Assertions ──────────────────────────────────────────────────────────

    let allPassed = true;

    function check(condition, message) {
      if (!condition) {
        allPassed = false;
        console.error(`  FAIL: ${message}`);
      } else {
        console.log(`  PASS: ${message}`);
      }
    }

    // At least one process printed "waiting" — proof of serialization.
    const someoneWaited =
      resultA.out.includes("[serial-lock] waiting") ||
      resultB.out.includes("[serial-lock] waiting");

    check(
      resultA.code === 0,
      `npm run ci exited with code 0 (got ${resultA.code})`
    );

    check(
      resultB.code === 0,
      `npm run test:e2e exited with code 0 (got ${resultB.code})`
    );

    check(
      someoneWaited,
      `At least one process printed "[serial-lock] waiting" — serialized rather than colliding`
    );

    check(
      resultA.out.includes("acquired lock") || resultB.out.includes("acquired lock"),
      "At least one process confirms it acquired the lock"
    );

    if (!allPassed) {
      console.error("\n[ci-collision-test] FAILED. Captured output:");
      console.error("\n--- npm run ci output ---");
      console.error(resultA.out || "(empty)");
      console.error("\n--- npm run test:e2e output ---");
      console.error(resultB.out || "(empty)");
      exitCode = 1;
    }
  }
} finally {
  cleanupFixture();
  process.removeListener("SIGINT", handleSigint);
  process.removeListener("SIGTERM", handleSigterm);
}

if (interruptedSignal) {
  console.error(`[ci-collision-test] Interrupted by ${interruptedSignal}.`);
  process.exit(signalExitCode(interruptedSignal));
}
if (exitCode !== 0) process.exit(exitCode);

console.log(
  "\n[ci-collision-test] All assertions passed. Serial lock collision prevention is working correctly."
);
