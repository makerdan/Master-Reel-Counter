import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertBootstrapDispatch, BOOTSTRAP_PLAN, BOOTSTRAP_PLAN_DIGEST } from "../lib/failure-gate/bootstrap.mjs";
import { validateProjectPlan } from "../lib/failure-gate/plan-guards.mjs";

test("bootstrap dispatch is limited to the pinned plan and test-standard", () => {
  const plan = readFileSync(BOOTSTRAP_PLAN, "utf8");
  const digest = "bd93f85b1a542cf12a1a1b8800f0d9ae94a26a7684946acbe51e99040702c76e";
  assert.equal(BOOTSTRAP_PLAN_DIGEST, digest);
  assert.equal(assertBootstrapDispatch({ root: process.cwd(), planArgument: BOOTSTRAP_PLAN,
    environment: {} }).command, "test-standard");
  assert.equal(validateProjectPlan({ root: process.cwd(), planReference: BOOTSTRAP_PLAN, planContent: plan }), true);
  assert.throws(() => assertBootstrapDispatch({ root: process.cwd(), planArgument: BOOTSTRAP_PLAN,
    extraArgs: ["test-fast"] }), /no tier selector/);
  assert.throws(() => assertBootstrapDispatch({ root: process.cwd(), planArgument: "docs/validation/plans/other.md" }),
    /only the designated bootstrap plan/);
  assert.throws(() => assertBootstrapDispatch({ root: process.cwd(), planArgument: BOOTSTRAP_PLAN,
    environment: { CI_SMOKE_TEST: "1" } }), /coverage override/);

  const root = mkdtempSync(join(tmpdir(), "failure-gate-bootstrap-"));
  try {
    const destination = join(root, BOOTSTRAP_PLAN);
    mkdirSync(join(root, "docs/validation/plans"), { recursive: true });
    writeFileSync(destination, `${plan}\n`);
    assert.throws(() => assertBootstrapDispatch({ root, planArgument: BOOTSTRAP_PLAN }),
      /digest changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});