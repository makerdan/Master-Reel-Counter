#!/usr/bin/env node
import { spawnSync } from "child_process";
import { assertRequestedTier } from "./lib/tier-lock-check.mjs";

// Candidate v4 never falls through to the legacy bootstrap path. Operational
// cutover requires independent acceptance and an installed host-control
// adapter, not a task-authored flag or environment-selected active identity.
if (process.argv.includes("--v4") || process.argv.includes("--task-id") ||
    process.argv.includes("--managed-completion")) {
  console.error("FAILURE-GATE BLOCKED: v4 host control and platform dispatch are not activated; no legacy fallback permitted");
  process.exit(2);
}

const planPath = process.argv[2] ?? process.env.TASK_PLAN_FILE;
if (!planPath) {
  console.error("TIER-LOCK VIOLATION: a task plan path is required");
  process.exit(2);
}
try {
  const { command } = assertRequestedTier(planPath);
  // Keep this as the single task-validation entrypoint. run-tier owns plan
  // guards and serial-lock owns reentrancy; neither responsibility should be
  // duplicated here or bypassed by a nested package-script invocation.
  const result = spawnSync(process.execPath, ["scripts/run-tier.mjs", command], {
    stdio: "inherit",
    env: { ...process.env, TASK_PLAN_FILE: planPath },
  });
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}