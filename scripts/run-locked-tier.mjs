#!/usr/bin/env node
import { spawnSync } from "child_process";
import { assertRequestedTier } from "./lib/tier-lock-check.mjs";

const planPath = process.argv[2] ?? process.env.TASK_PLAN_FILE;
if (!planPath) {
  console.error("TIER-LOCK VIOLATION: a task plan path is required");
  process.exit(2);
}
try {
  const { command } = assertRequestedTier(planPath);
  const result = spawnSync(process.execPath, ["scripts/run-tier.mjs", command], {
    stdio: "inherit",
    env: { ...process.env, TASK_PLAN_FILE: planPath },
  });
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}