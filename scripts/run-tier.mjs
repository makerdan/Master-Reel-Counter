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

import { readFileSync } from "fs";
import { spawnSync } from "child_process";
import { resolve } from "path";
import { loadTiers } from "./lib/tiers.mjs";
import { assertRequestedTier } from "./lib/tier-lock-check.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "docs/validation/manifest.json"), "utf8"));
const localTiers = loadTiers();
const executeOnly = process.argv.includes("--execute");
const executeIndex = process.argv.indexOf("--execute");
const requested = executeOnly ? process.argv[executeIndex + 1] : process.argv[2];
const allowNoPlan = process.argv.includes("--allow-no-plan");
const packageAdHoc = !process.env.TASK_PLAN_FILE && process.env.npm_lifecycle_event === requested;
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
  } else if (!allowNoPlan && !packageAdHoc) {
    console.error("TIER-LOCK VIOLATION: TASK_PLAN_FILE is required; use --allow-no-plan only for ad-hoc runs");
    process.exit(2);
  } else {
    console.log(`[validation] ad-hoc run explicitly allowed${packageAdHoc ? " by package tier wrapper" : ""}; no task plan is in force`);
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

if (process.env.FAILURE_GATE_PLAN_GUARDS_DONE !== "1") {
  try {
    runPlanGuards();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
console.log(`[validation] Running ${requested} (budget ${entry.timeoutMs ?? "unbounded"}ms starts after lock acquisition).`);
if (process.env.CI_SMOKE_TEST === "1") {
  console.log("[validation] CI_SMOKE_TEST=1 — lock acquisition smoke mode; steps intentionally skipped.");
  process.exit(0);
}

const stepEnv = { ...process.env };
for (const key of Object.keys(stepEnv)) {
  if (key === "SERIAL_LOCK_HOLDER_PID" || key.startsWith("VALIDATION_LOCK_HELD_PID_")) delete stepEnv[key];
}

for (const step of entry.steps) {
  const started = Date.now();
  console.log(`\n[validation] Step: ${step.name}\n[validation] Command: ${step.command.join(" ")}`);
  const child = spawnSync(step.command[0], step.command.slice(1), {
    cwd: root,
    stdio: "inherit",
    env: stepEnv,
    shell: false,
  });
  const durationMs = Date.now() - started;
  if (child.status !== 0) {
    console.error(`[validation] FAIL: ${step.name} exited ${child.status ?? "by signal"} after ${durationMs}ms.`);
    process.exit(child.status ?? 1);
  }
  console.log(`[validation] PASS: ${step.name} (${durationMs}ms).`);
}
console.log(`\n[validation] PASS: ${requested} completed.`);