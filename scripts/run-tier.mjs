#!/usr/bin/env node
/**
 * Execute a registered validation tier.
 *
 * The incoming validation manifest is the runtime source of truth for the
 * resource-aware tiers. The Failure Gate registry remains the source for the
 * project-local light tier and for plan-lock compatibility. Task-driven runs
 * validate the plan before acquiring the outer serial lock; ad-hoc package
 * scripts pass --allow-no-plan explicitly.
 */

import { fstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { resolve } from "path";
import { loadTiers } from "./lib/tiers.mjs";
import { assertRequestedTier } from "./lib/tier-lock-check.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestPath = process.env.VALIDATION_MANIFEST_PATH ??
  resolve(root, "docs/validation/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const localTiers = loadTiers();
const executeOnly = process.argv.includes("--execute");
const executeIndex = process.argv.indexOf("--execute");
const requested = executeOnly ? process.argv[executeIndex + 1] : process.argv[2];
const allowNoPlan = process.argv.includes("--allow-no-plan");
const manifestEntry = manifest.tiers[requested];
const localEntry = localTiers[requested];
const entry = manifestEntry ?? (localEntry ? {
  packageScript: `npm run ${requested}`,
  resource: "validation",
  priority: localEntry.serial ? 2 : 1,
  timeoutMs: localEntry.serial ? 300000 : 180000,
  steps: localEntry.steps.map((step) => ({
    name: step.name,
    kind: step.kind,
    command: ["bash", "-lc", step.command],
  })),
} : undefined);

if (!entry) {
  console.error(`[validation] ERROR: unknown tier '${requested ?? ""}'.`);
  process.exit(2);
}

function runPlanGuards() {
  if (process.env.TASK_PLAN_FILE) {
    assertRequestedTier(process.env.TASK_PLAN_FILE, requested);
    for (const script of ["scripts/check-failure-gate.mjs", "scripts/check-regression-guard.mjs"]) {
      const fix = spawnSync(process.execPath, [script, "--fix-stub"], { cwd: root, stdio: "inherit", env: process.env });
      if (fix.status !== 0) process.exit(fix.status ?? 1);
      const strict = spawnSync(process.execPath, [script], { cwd: root, stdio: "inherit", env: process.env });
      if (strict.status !== 0) process.exit(strict.status ?? 1);
    }
  } else if (!allowNoPlan) {
    console.error("TIER-LOCK VIOLATION: TASK_PLAN_FILE is required; use --allow-no-plan only for ad-hoc runs");
    process.exit(2);
  } else {
    console.log("[validation] ad-hoc run explicitly allowed; no task plan is in force");
  }
}

if (!executeOnly) {
  try {
    runPlanGuards();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  const lockArgs = [
    resolve(root, "scripts/serial-lock.mjs"),
    "--resource", entry.resource ?? "validation",
    "--priority", String(entry.priority ?? 2),
    "--timeout-ms", String(entry.timeoutMs ?? 300000),
    "--",
    process.execPath,
    resolve(root, "scripts/run-tier.mjs"),
    "--execute",
    requested,
  ];
  const child = spawnSync(process.execPath, lockArgs, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, FAILURE_GATE_PLAN_GUARDS_DONE: "1" },
  });
  process.exit(child.status ?? 1);
}

function parentPid(pid) {
  try {
    return Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/^PPid:\s+(\d+)/m)?.[1] ?? 0);
  } catch {
    return 0;
  }
}

function hasAncestor(pid) {
  let current = parentPid(process.pid);
  while (current > 1) {
    if (current === pid) return true;
    current = parentPid(current);
  }
  return false;
}

let verifiedAttestationFd = null;
function inspectAttestationCapability(fd) {
  const buffer = Buffer.alloc(4096);
  const bytes = readSync(fd, buffer, 0, buffer.length, 0);
  const attestation = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
  const localStat = fstatSync(fd);
  const holderStat = statSync(`/proc/${attestation.holderPid}/fd/${attestation.holderFd}`);
  const holderCommand = readFileSync(`/proc/${attestation.holderPid}/cmdline`, "utf8").split("\0");
  return {
    attestation,
    matches:
      localStat.dev === holderStat.dev &&
      localStat.ino === holderStat.ino &&
      realpathSync(`/proc/${attestation.holderPid}/exe`) === realpathSync(process.execPath) &&
      resolve(holderCommand[1] ?? "") === resolve(root, "scripts/serial-lock.mjs"),
  };
}
function assertHeldResourceLock() {
  const resourceName = String(entry.resource ?? "validation");
  const resourceKey = resourceName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const holder = Number(process.env[`VALIDATION_LOCK_HELD_PID_${resourceKey}`]);
  let attestation = null;
  let capabilityMatchesHolder = false;
  try {
    let fd = Number(process.env.VALIDATION_LOCK_ATTESTATION_FD);
    let inspected;
    if (Number.isInteger(fd) && fd >= 3) {
      try {
        inspected = inspectAttestationCapability(fd);
      } catch {
        inspected = null;
      }
    }
    if (!inspected) {
      const holderFd = Number(process.env[`VALIDATION_LOCK_ATTESTATION_HOLDER_FD_${resourceKey}`]);
      fd = openSync(`/proc/${holder}/fd/${holderFd}`, "r");
      inspected = inspectAttestationCapability(fd);
    }
    verifiedAttestationFd = fd;
    attestation = inspected.attestation;
    capabilityMatchesHolder = inspected.matches;
  } catch {
    // Missing or malformed inherited capability fails closed below.
  }
  const lockPath = attestation?.lockPath;
  let lock = null;
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      lock = { pid: parsed.pid, token: parsed.token };
    } else {
      const [pid, , , lockToken] = raw.split("\n");
      lock = { pid: Number(pid), token: lockToken };
    }
  } catch {
    // Missing, unreadable, or malformed lock evidence fails closed below.
  }
  if (
    !holder ||
    !attestation ||
    !capabilityMatchesHolder ||
    !hasAncestor(holder) ||
    attestation.holderPid !== holder ||
    attestation.resource !== resourceName.toLowerCase() ||
    lock?.pid !== holder ||
    lock?.token !== attestation.token
  ) {
    throw new Error("TIER-LOCK VIOLATION: execute mode requires the verified resource lock holder as an ancestor");
  }
}

try {
  assertHeldResourceLock();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
console.log(`[validation] Running ${requested} (budget ${entry.timeoutMs ?? "unbounded"}ms starts after lock acquisition).`);
if (process.env.CI_SMOKE_TEST === "1") {
  console.log("[validation] CI_SMOKE_TEST=1 — lock acquisition smoke mode; steps intentionally skipped.");
  process.exit(0);
}

// A manifest step may intentionally invoke another registered tier (for
// example, the CI alias). The outer serial-lock process owns the resource and
// places a resource-specific holder PID in the environment. Keep only that
// marker for child steps: serial-lock.mjs verifies that the PID is an actual
// ancestor before taking the reentrant path. Markers for other resources must
// not cross the manifest boundary.
const stepEnv = { ...process.env };
const resource = String(entry.resource ?? "validation").toUpperCase().replace(/[^A-Z0-9]/g, "_");
const ownedMarker = `VALIDATION_LOCK_HELD_PID_${resource}`;
for (const key of Object.keys(stepEnv)) {
  if (
    key === "SERIAL_LOCK_HOLDER_PID" && resource !== "GLOBAL" ||
    key.startsWith("VALIDATION_LOCK_HELD_PID_") && key !== ownedMarker
  ) {
    delete stepEnv[key];
  }
}

let activeStepIndex = -1;
let interruptionReported = false;
function reportInterruption(signal) {
  if (interruptionReported) return;
  interruptionReported = true;
  if (activeStepIndex >= 0) {
    console.error(`[validation] INCOMPLETE: ${entry.steps[activeStepIndex].name} ended with signal ${signal}.`);
    for (const pending of entry.steps.slice(activeStepIndex + 1)) {
      console.error(`[validation] NOT REACHED: ${pending.name}.`);
    }
  } else {
    for (const pending of entry.steps) {
      console.error(`[validation] NOT REACHED: ${pending.name}.`);
    }
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    reportInterruption(signal);
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  });
}

for (const [stepIndex, step] of entry.steps.entries()) {
  activeStepIndex = stepIndex;
  const started = Date.now();
  console.log(`\n[validation] Step: ${step.name}\n[validation] Command: ${step.command.join(" ")}`);
  const child = await new Promise((resolveChild) => {
    const stdio = Number.isInteger(verifiedAttestationFd) && verifiedAttestationFd >= 3
      ? ["inherit", "inherit", "inherit", verifiedAttestationFd]
      : "inherit";
    const processChild = spawn(step.command[0], step.command.slice(1), {
      cwd: root,
      stdio,
      env: stepEnv,
      shell: false,
    });
    processChild.once("error", (error) => resolveChild({ status: null, signal: null, error }));
    processChild.once("close", (status, signal) => resolveChild({ status, signal, error: null }));
  });
  const durationMs = Date.now() - started;
  if (child.status !== 0) {
    const incomplete = child.status === null || Boolean(child.error);
    const outcome = incomplete ? "INCOMPLETE" : "FAIL";
    const reason = child.error?.message ?? (child.signal ? `signal ${child.signal}` : `exit ${child.status}`);
    console.error(`[validation] ${outcome}: ${step.name} ended with ${reason} after ${durationMs}ms.`);
    for (const pending of entry.steps.slice(stepIndex + 1)) {
      console.error(`[validation] NOT REACHED: ${pending.name}.`);
    }
    process.exit(child.status ?? 1);
  }
  console.log(`[validation] PASS: ${step.name} (${durationMs}ms).`);
}
activeStepIndex = -1;
console.log(`\n[validation] PASS: ${requested} completed.`);