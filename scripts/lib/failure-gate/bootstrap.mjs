import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { assertRequestedTier } from "../tier-lock-check.mjs";

export const BOOTSTRAP_PLAN = "docs/validation/plans/failure-gate-v4-reinstallation-bootstrap.md";
export const BOOTSTRAP_PLAN_DIGEST = "bd93f85b1a542cf12a1a1b8800f0d9ae94a26a7684946acbe51e99040702c76e";
const blocked = (reason) => { throw new Error(`FAILURE-GATE BLOCKED: ${reason}`); };
const overrides = [
  "CI_SMOKE_TEST", "FAILURE_GATE_BROWSER_REPORT", "FAILURE_GATE_TIERS_PATH",
  "GREP", "NODE_OPTIONS", "NODE_TEST_CONTEXT", "PLAYWRIGHT_TEST_GREP",
  "TEST_FILTER", "TEST_ONLY", "VALIDATION_MANIFEST_PATH",
];

export function assertBootstrapDispatch({ root, planArgument, extraArgs = [], environment = process.env }) {
  const project = realpathSync(root);
  const planPath = resolve(project, planArgument ?? "");
  const expectedPath = resolve(project, BOOTSTRAP_PLAN);
  blockedUnless(extraArgs.length === 0, "bootstrap accepts no tier selector or extra arguments");
  blockedUnless(planPath === expectedPath && existsSync(planPath) &&
    lstatSync(planPath).isFile() && realpathSync(planPath) === planPath,
  "only the designated bootstrap plan is eligible");
  const bytes = readFileSync(planPath);
  blockedUnless(createHash("sha256").update(bytes).digest("hex") === BOOTSTRAP_PLAN_DIGEST,
    "bootstrap plan digest changed");
  blockedUnless(!environment.TASK_PLAN_FILE || resolve(project, environment.TASK_PLAN_FILE) === expectedPath,
    "bootstrap task-plan environment conflicts with the designated plan");
  for (const key of overrides) {
    blockedUnless(!environment[key], `coverage override ${key} is forbidden for bootstrap`);
  }
  const { command } = assertRequestedTier(planPath, "test-standard");
  blockedUnless(command === "test-standard", "bootstrap is limited to test-standard");
  return { planPath, command };
}

function blockedUnless(condition, message) {
  if (!condition) blocked(message);
}