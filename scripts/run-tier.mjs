#!/usr/bin/env node
/**
 * Execute one of the tracked validation tiers.
 *
 * The public invocation acquires exactly one resource-aware lock. The
 * --execute form is private to that lock wrapper and runs the manifest steps
 * without wrapping any inner step again.
 */

import { readFileSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "docs/validation/manifest.json"), "utf8"));
const executeOnly = process.argv.includes("--execute");
const executeIndex = process.argv.indexOf("--execute");
const tier = executeOnly
  ? process.argv[executeIndex + 1]
  : process.argv[2];
const entry = manifest.tiers[tier];

if (!entry) {
  console.error(`[validation] ERROR: unknown tier '${tier ?? ""}'.`);
  process.exit(2);
}

if (!executeOnly) {
  const lockArgs = [
    resolve(root, "scripts/serial-lock.mjs"),
    "--resource", entry.resource,
    "--priority", String(entry.priority),
    "--timeout-ms", String(entry.timeoutMs),
    "--",
    process.execPath,
    resolve(root, "scripts/run-tier.mjs"),
    "--execute",
    tier,
  ];
  const child = spawnSync(process.execPath, lockArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(child.status ?? 1);
}

console.log(`[validation] Running ${tier} (budget ${entry.timeoutMs}ms starts after lock acquisition).`);
if (process.env.CI_SMOKE_TEST === "1") {
  console.log("[validation] CI_SMOKE_TEST=1 — lock acquisition smoke mode; steps intentionally skipped.");
  process.exit(0);
}

// The tier owns one outer lock. Do not leak its reentrancy markers into
// independent regression harnesses, which intentionally create isolated
// temporary locks to test acquisition and collision behavior.
const stepEnv = { ...process.env };
for (const key of Object.keys(stepEnv)) {
  if (key === "SERIAL_LOCK_HOLDER_PID" || key.startsWith("VALIDATION_LOCK_HELD_PID_")) {
    delete stepEnv[key];
  }
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

console.log(`\n[validation] PASS: ${tier} completed.`);