import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const blocked = (message) => { throw new Error(`FAILURE-GATE BLOCKED: ${message}`); };

// Run the repository's authoritative strict checks against the exact durable
// plan. Never invoke their stub-repair mode during activation.
export function validateProjectPlan({ root, planReference, planContent }) {
  const project = realpathSync(root);
  const planPath = resolve(project, planReference);
  const rel = relative(project, planPath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.split(sep).includes(".local") ||
      !existsSync(planPath) || !lstatSync(planPath).isFile() || realpathSync(planPath) !== planPath ||
      readFileSync(planPath, "utf8") !== planContent) {
    blocked("strict plan guard requires the exact durable plan projection");
  }

  const cleanEnvironment = { ...process.env, TASK_PLAN_FILE: planPath };
  for (const key of ["NODE_OPTIONS", "NODE_TEST_CONTEXT", "CI_SMOKE_TEST"]) delete cleanEnvironment[key];
  for (const script of ["scripts/check-failure-gate.mjs", "scripts/check-regression-guard.mjs"]) {
    const result = spawnSync(process.execPath, [resolve(repository, script)], {
      cwd: project, env: cleanEnvironment, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024,
    });
    if (result.error || result.status !== 0) blocked(`project strict plan guard rejected plan (${script})`);
  }
  return true;
}