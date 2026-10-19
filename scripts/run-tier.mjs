#!/usr/bin/env node
/**
 * Execute a registered validation tier.
 *
 * This is an ungated workload runner, retained for application CI.
 * It does not admit tasks, bind tiers, seal plans, or decide task completion.
 * --allow-no-plan remains accepted for existing workload callers.
 */

import { readFileSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { resolve } from "path";
import { loadTiers } from "./lib/tiers.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestPath = process.env.VALIDATION_MANIFEST_PATH ??
  resolve(root, "docs/validation/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const localTiers = loadTiers();
const executeOnly = process.argv.includes("--execute");
const executeIndex = process.argv.indexOf("--execute");
const requested = executeOnly ? process.argv[executeIndex + 1] : process.argv[2];
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
    command: step.command,
  })),
} : undefined);

if (!entry) {
  console.error(`[validation] ERROR: unknown tier '${requested ?? ""}'.`);
  process.exit(2);
}

function requireIndependentWorkload() {
  if (process.env.TASK_PLAN_FILE) {
    console.error("[validation] Task admission is retired; this runner only executes independent workloads.");
    process.exit(2);
  } else {
    console.log("[validation] independent workload; no task plan is in force");
  }
}

if (!executeOnly) {
  try {
    requireIndependentWorkload();
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
    env: process.env,
  });
  process.exit(child.status ?? 1);
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
    const processChild = spawn(step.command[0], step.command.slice(1), {
      cwd: root,
      stdio: "inherit",
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