#!/usr/bin/env node
import { spawnSync } from "child_process";

if (!process.env.TASK_PLAN_FILE) {
  console.log("[validation-steps] no TASK_PLAN_FILE; plan guards are not applicable to this ad-hoc CI run.");
  process.exit(0);
}
for (const script of ["scripts/check-failure-gate.mjs", "scripts/check-regression-guard.mjs"]) {
  const fix = spawnSync(process.execPath, [script, "--fix-stub"], { stdio: "inherit", env: process.env });
  if (fix.status !== 0) process.exit(fix.status ?? 1);
  const strict = spawnSync(process.execPath, [script], { stdio: "inherit", env: process.env });
  if (strict.status !== 0) process.exit(strict.status ?? 1);
}