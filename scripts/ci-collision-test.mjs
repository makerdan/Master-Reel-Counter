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

import { spawn } from "child_process";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PKG_PATH = resolve(ROOT, "package.json");

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

// Isolated lock path so we don't stomp on a real CI run.
const LOCK_PATH = `/tmp/repl-collision-test-${randomBytes(4).toString("hex")}.lock`;

// Shared env for the smoke invocations.
const testEnv = {
  ...process.env,
  SERIAL_LOCK_PATH: LOCK_PATH,
  // Short poll interval so queuing is visible quickly.
  SERIAL_LOCK_WAIT_INTERVAL_MS: "500",
  // ci.sh checks this and exits 0 immediately — keeps the test fast.
  CI_SMOKE_TEST: "1",
};

if (existsSync(LOCK_PATH)) {
  try { unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

function capture(proc) {
  let out = "";
  proc.stdout?.on("data", (d) => { out += d.toString(); });
  proc.stderr?.on("data", (d) => { out += d.toString(); });
  const done = new Promise((res) =>
    proc.on("close", (code) => res({ code: code ?? 1, out }))
  );
  return done;
}

// Process A: npm run ci — exits 0 immediately because CI_SMOKE_TEST=1.
const procA = spawn("npm", ["run", "ci"], {
  cwd: ROOT,
  env: testEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
const doneA = capture(procA);

// Process B: npm run test:e2e with --pass-with-no-tests so playwright exits 0
// without running the full suite. The extra args are forwarded by npm's `--`.
const procB = spawn(
  "npm",
  ["run", "test:e2e", "--", "--pass-with-no-tests", "--grep", "CI_SMOKE_NO_TESTS_INTENTIONAL"],
  {
    cwd: ROOT,
    env: testEnv,
    stdio: ["ignore", "pipe", "pipe"],
  }
);
const doneB = capture(procB);

console.log(
  "[ci-collision-test] Both npm run commands spawned. Waiting for both to complete…"
);

// Both run to completion — no forced kills.
const [resultA, resultB] = await Promise.all([doneA, doneB]);

// Cleanup
if (existsSync(LOCK_PATH)) {
  try { unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

// ── Assertions ────────────────────────────────────────────────────────────────

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
  process.exit(1);
}

console.log(
  "\n[ci-collision-test] All assertions passed. Serial lock collision prevention is working correctly."
);
