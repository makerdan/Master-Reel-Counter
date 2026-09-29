#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assertBootstrapDispatch } from "./lib/failure-gate/bootstrap.mjs";

const root = resolve(import.meta.dirname, "..");
const [planArgument, ...extraArgs] = process.argv.slice(2);
try {
  const { planPath, command } = assertBootstrapDispatch({
    root, planArgument, extraArgs, environment: process.env,
  });
  // The single digest-pinned bootstrap is executed through run-tier so its
  // existing strict plan guards, lock, and registered tier semantics apply.
  const environment = { ...process.env, TASK_PLAN_FILE: planPath };
  for (const key of ["NODE_OPTIONS", "NODE_TEST_CONTEXT", "CI_SMOKE_TEST",
    "VALIDATION_MANIFEST_PATH", "FAILURE_GATE_TIERS_PATH"]) delete environment[key];
  const result = spawnSync(process.execPath, [resolve(root, "scripts/run-tier.mjs"), command], {
    cwd: root, stdio: "inherit", env: environment,
  });
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}