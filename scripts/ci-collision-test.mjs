#!/usr/bin/env node
/**
 * ci-collision-test.mjs — Concurrent-trigger smoke test for the serial lock.
 *
 * Validates the CI route and lock contract:
 *
 * Part 1 — Route contract:
 *   Requires exact package-script chains for CI, every tier, and e2e, plus an
 *   exact compatibility route for scripts/ci.sh.
 *
 * Part 2 — Held-lock route test:
 *   Holds a fixture-owned lock while every supported entry route starts, then
 *   releases it only after each route reports that it is waiting.
 *
 *   The lock, waiters, plan metadata, and inherited lock controls are isolated
 *   from unrelated validation jobs.
 *
 *   Each route must report waiting, then acquire the lock and exit 0.
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

function isolatedValidationEnvironment(base = process.env) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (
      key === "TASK_PLAN_FILE" ||
      key === "FAILURE_GATE_PLAN_GUARDS_DONE" ||
      key === "VALIDATION_MANIFEST_PATH" ||
      key === "CI_SMOKE_TEST" ||
      key === "CI_COLLISION_TEST_HOLD_MS" ||
      key.startsWith("SERIAL_LOCK_") ||
      key.startsWith("VALIDATION_LOCK_")
    ) {
      delete env[key];
    }
  }
  return env;
}

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
    ...isolatedValidationEnvironment(),
    VALIDATION_MANIFEST_PATH: manifestPath,
    VALIDATION_LOCK_FILE: join(fixtureDir, "validation.lock"),
    VALIDATION_LOCK_WAITERS_DIR: join(fixtureDir, "waiters"),
    CI_SMOKE_TEST: "",
    SERIAL_LOCK_WAIT_INTERVAL_MS: "100",
    SERIAL_LOCK_MAX_WAIT_MS: "5000",
  };

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
  "[ci-collision-test] Part 1: Verifying validation entrypoints match their exact lock contract…"
);

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const scripts = pkg.scripts ?? {};
const tierRegistryPath = resolve(ROOT, ".agents/skills/validation-tiers/tiers.json");
const tierRegistry = JSON.parse(readFileSync(tierRegistryPath, "utf8"));
const tierNames = Object.keys(tierRegistry.tiers ?? {});
let integrationOk = true;

const expectedRoutes = {
  ci: "npm run test-heavy",
  ...Object.fromEntries(
    tierNames.map((tier) => [
      tier,
      `node scripts/run-tier.mjs ${tier} --allow-no-plan`,
    ]),
  ),
  "test:e2e": "node scripts/serial-lock.mjs --resource e2e-port --priority 3 --timeout-ms 900000 -- node scripts/run-typechecked-playwright.mjs",
};
for (const [name, expected] of Object.entries(expectedRoutes)) {
  const script = scripts[name] ?? "";
  if (script !== expected) {
    console.error(
      `  FAIL: npm run ${name} must be exactly "${expected}" (got: "${script}")`
    );
    integrationOk = false;
  } else {
    console.log(`  PASS: npm run ${name} → ${expected}`);
  }
}

const ciShell = readFileSync(resolve(ROOT, "scripts/ci.sh"), "utf8");
const ciShellCommands = ciShell
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
if (
  ciShellCommands.length !== 2 ||
  ciShellCommands[0] !== "set -euo pipefail" ||
  ciShellCommands[1] !== "exec npm run test-heavy"
) {
  console.error(
    `  FAIL: scripts/ci.sh must only enable strict shell mode and exec the canonical test-heavy route (got: ${JSON.stringify(ciShellCommands)})`,
  );
  integrationOk = false;
} else {
  console.log("  PASS: scripts/ci.sh → execs the canonical test-heavy route");
}

if (!integrationOk) {
  console.error("\n[ci-collision-test] Part 1 FAILED. Aborting.");
  process.exit(1);
}

// ── Part 2: Exercise each route behind an isolated held lock ─────────────────

console.log(
  "\n[ci-collision-test] Part 2: Holding the fixture lock while every supported route queues…"
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

// Remove inherited task, lock, manifest, and smoke controls before assigning
// fixture-owned values. An unrelated validation job must not affect this probe.
const testEnv = {
  ...isolatedValidationEnvironment(),
  SERIAL_LOCK_PATH: LOCK_PATH,
  VALIDATION_LOCK_FILE: LOCK_PATH,
  VALIDATION_LOCK_WAITERS_DIR: WAITERS_DIR,
  SERIAL_LOCK_WAIT_INTERVAL_MS: "50",
  SERIAL_LOCK_MAX_WAIT_MS: "30000",
  CI_SMOKE_TEST: "1",
};

function capture(proc) {
  let out = "";
  proc.stdout?.on("data", (d) => { out += d.toString(); });
  proc.stderr?.on("data", (d) => { out += d.toString(); });
  const done = new Promise((res) =>
    proc.on("close", (code, signal) =>
      res({ code: code ?? signalExitCode(signal), signal })
    )
  );
  return {
    done,
    get output() {
      return out;
    },
  };
}

const holdMs = Number.parseInt(process.env.CI_COLLISION_TEST_HOLD_MS ?? "0", 10);
const releaseHolderPath = join(FIXTURE_DIR, "release-holder");
const holderWaitScript =
  `const fs=require("node:fs");const started=Date.now();` +
  `const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(releaseHolderPath)})||Date.now()-started>12000)clearInterval(timer)},25);`;
const holder = spawn(
  process.execPath,
  [
    resolve(ROOT, "scripts/serial-lock.mjs"),
    "--resource", "validation",
    "--priority", "1",
    "--timeout-ms", "15000",
    "--",
    process.execPath,
    "-e",
    holderWaitScript,
  ],
  {
    cwd: ROOT,
    env: testEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  },
);
children.push(holder);
const holderCapture = capture(holder);

const routes = [
  ...tierNames.map((tier) => ({
    name: `npm run ${tier}`,
    command: "npm",
    args: ["run", tier],
  })),
  { name: "npm run ci", command: "npm", args: ["run", "ci"] },
  { name: "scripts/ci.sh", command: "bash", args: ["scripts/ci.sh"] },
  {
    name: "npm run test:e2e",
    command: "npm",
    args: [
      "run",
      "test:e2e",
      "--",
      "--help",
    ],
  },
];
const routeCaptures = [];
let holderAcquired = false;
let allRoutesWaited = false;
let exitCode = 0;
try {
  holderAcquired = await Promise.race([
    new Promise((resolvePromise) => {
      const deadline = Date.now() + 5000;
      const poll = setInterval(() => {
        if (holderCapture.output.includes("acquired lock")) {
          clearInterval(poll);
          resolvePromise(true);
        } else if (Date.now() >= deadline || holder.exitCode !== null) {
          clearInterval(poll);
          resolvePromise(false);
        }
      }, 20);
    }),
    interruption.then(() => false),
  ]);

  for (const route of routes) {
    const proc = spawn(route.command, route.args, {
      cwd: ROOT,
      env: testEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    children.push(proc);
    routeCaptures.push({ ...route, capture: capture(proc) });
    if (interruptedSignal) signalChild(proc, interruptedSignal);
  }

  console.log("[ci-collision-test] All validation entry routes spawned.");
  console.log("[ci-collision-test] Waiting for every route to report lock contention…");
  allRoutesWaited = await Promise.race([
    new Promise((resolvePromise) => {
      const deadline = Date.now() + 5000;
      const poll = setInterval(() => {
        if (routeCaptures.every(({ capture: captured }) => captured.output.includes("[serial-lock] waiting"))) {
          clearInterval(poll);
          resolvePromise(true);
        } else if (Date.now() >= deadline || routeCaptures.some(({ capture: captured }) => captured.output.includes("ERROR:"))) {
          clearInterval(poll);
          resolvePromise(false);
        }
      }, 20);
    }),
    interruption.then(() => false),
  ]);

  if (holdMs > 0 && !interruptedSignal) {
    await Promise.race([
      new Promise((resolvePromise) => setTimeout(resolvePromise, holdMs)),
      interruption,
    ]);
  }

  if (!interruptedSignal) writeFileSync(releaseHolderPath, "release\n");
  const routeResults = await Promise.all(routeCaptures.map(({ capture: captured }) => captured.done));
  const holderResult = await holderCapture.done;

  if (!interruptedSignal) {
    let allPassed = true;

    function check(condition, message) {
      if (!condition) {
        allPassed = false;
        console.error(`  FAIL: ${message}`);
      } else {
        console.log(`  PASS: ${message}`);
      }
    }

    check(holderAcquired, "the fixture-owned holder acquired the isolated lock first");
    check(holderResult.code === 0, `fixture lock holder exited 0 (got ${holderResult.code})`);
    check(allRoutesWaited, "every supported entry route waited behind the held fixture lock");
    for (const [index, route] of routeCaptures.entries()) {
      const { code } = routeResults[index];
      const output = route.capture.output;
      check(
        output.includes("[serial-lock] waiting"),
        `${route.name} reported waiting while the fixture lock was held`,
      );
      check(code === 0, `${route.name} exited 0 after the fixture lock was released (got ${code})`);
      check(
        output.includes("acquired lock"),
        `${route.name} confirmed it acquired the canonical fixture lock`,
      );
    }

    if (!allPassed) {
      console.error("\n[ci-collision-test] FAILED. Captured output:");
      console.error("\n--- fixture lock holder output ---");
      console.error(holderCapture.output || "(empty)");
      for (const route of routeCaptures) {
        console.error(`\n--- ${route.name} output ---`);
        console.error(route.capture.output || "(empty)");
      }
      exitCode = 1;
    }
  }
} finally {
  if (FIXTURE_DIR && !interruptedSignal) {
    try {
      writeFileSync(releaseHolderPath, "release\n");
    } catch {
      // Fixture cleanup or an early startup failure may already have removed it.
    }
  }
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
