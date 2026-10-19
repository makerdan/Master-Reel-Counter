import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Coordinator, digest, reviewScope } from "../lib/failure-gate/coordinator.mjs";

const namespace = "fixture-project";
const reference = "docs/validation/reviews/review-one.json";
const plan = (id) => `# Reviewed fixture

## Task identity
**Task ID:** \`${id}\`

## Pre-existing failures to ignore
None known. New failures remain potential regressions.

## Validation
**Command:** fixture-check
**Why:** The registered fixture check covers the review binding.
**Do not escalate:** Do not substitute another tier.

## Regression Guard
**Covers:** Approval does not cross task or scope boundaries.
**Test location:** scripts/__tests__/failure-gate-v4-review-records.test.mjs
**What it checks:** Mismatched review records cannot activate a task.
`;

function fixture(t) {
  const base = mkdtempSync(resolve(tmpdir(), "gate-reviews-"));
  const root = resolve(base, "project");
  mkdirSync(resolve(root, "docs/validation/reviews"), { recursive: true });
  writeFileSync(resolve(root, "docs/validation/manifest.json"),
    JSON.stringify({ tiers: { "fixture-check": {} } }));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture Reviewer"]);
  execFileSync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  const c = new Coordinator({ root, directory: resolve(base, "state"), namespace,
    testPlanValidator: () => true });
  t.after(() => { c.close(); rmSync(base, { recursive: true, force: true }); });
  const draft = c.reserve({ key: "draft" });
  const content = plan(draft.taskId);
  writeFileSync(resolve(root, "plan.md"), content);
  execFileSync("git", ["-C", root, "add", "--", "plan.md", "docs/validation/manifest.json"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "fixture base"]);
  const config = { planReference: "plan.md", planContent: content, planVersion: 1,
    authorizedTier: "fixture-check", tierDefinitionDigest: digest("fixture-tier"),
    parametersDigest: digest("fixture-parameters"), policyVersion: "fixture-policy-1",
    policyDigest: digest("fixture-policy") };
  const approved = c.configuration(config);
  const subject = { taskId: draft.taskId, expectedVersion: 0, config: approved };
  const scope = reviewScope(draft.taskId, approved, 0, 1);
  const record = { version: 1, reference, namespace, reviewer: "fixture-human",
    decision: "approved", action: "activate", reviewedAt: "2026-09-28T12:00:00.000Z",
    subject, subjectDigest: digest(subject), scope };
  const write = (path, object) => writeFileSync(resolve(root, path), `${JSON.stringify(object, null, 2)}\n`);
  const track = (...paths) => execFileSync("git", ["-C", root, "add", "--", ...paths]);
  const commit = (...paths) => {
    track(...paths);
    execFileSync("git", ["-C", root, "commit", "-qm", "fixture review decision"]);
  };
  const activate = (key) => c.activate({ taskId: draft.taskId, config,
    approvalReference: reference, key });
  return { c, draft, approved, subject, scope, record, write, track, commit, activate, root };
}

test("ordinary activation fails closed without a committed roster, designated human, and committed decision", (t) => {
  const f = fixture(t);
  assert.throws(() => f.activate("no-roster"), /review source/);
  f.write("docs/validation/reviewers.json", { version: 1, reviewers: [] });
  assert.throws(() => f.activate("untracked-roster"), /not a readable committed/);
  f.track("docs/validation/reviewers.json");
  assert.throws(() => f.activate("staged-roster"), /not a readable committed/);
  f.commit("docs/validation/reviewers.json");
  assert.throws(() => f.activate("no-reviewer"), /designated human reviewer roster/);
  f.write("docs/validation/reviewers.json", { version: 1, reviewers: ["fixture-human"] });
  assert.throws(() => f.activate("uncommitted-roster"), /differs from its committed/);
  f.commit("docs/validation/reviewers.json");
  assert.throws(() => f.activate("no-record"), /review source/);
  f.write(reference, f.record);
  assert.throws(() => f.activate("untracked-record"), /not a readable committed/);
  f.track(reference);
  assert.throws(() => f.activate("staged-record"), /not a readable committed/);
  assert.equal(f.c.task(f.draft.taskId).status, "draft");
  f.commit(reference);
  const active = f.activate("reviewed");
  assert.equal(active.authorizedTier, "fixture-check");
  assert.equal(active.approval.reference, reference);
  assert.equal(active.approval.recordDigest, digest(`${JSON.stringify(f.record, null, 2)}\n`));
  assert.equal(active.approval.sourceCommit,
    execFileSync("git", ["-C", f.root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS total FROM approval_record_evidence").get().total, 1);
});

test("review record must match exact local task, plan, tier, parameters, policy, versions and reviewer", (t) => {
  const f = fixture(t);
  f.write("docs/validation/reviewers.json", { version: 1, reviewers: ["fixture-human"] });
  f.commit("docs/validation/reviewers.json");
  const changes = [
    (r) => { r.scope.taskId = "another:task"; },
    (r) => { r.scope.planReference = "another-plan.md"; },
    (r) => { r.scope.planVersion++; },
    (r) => { r.scope.planDigest = digest("other-plan"); },
    (r) => { r.scope.authorizedTier = "fixture-expanded"; },
    (r) => { r.scope.tierDefinitionDigest = digest("other-tier"); },
    (r) => { r.scope.parametersDigest = digest("other-parameters"); },
    (r) => { r.scope.policyVersion = "other-policy"; },
    (r) => { r.scope.policyDigest = digest("other-policy"); },
    (r) => { r.scope.authorizationVersionBefore++; },
    (r) => { r.scope.authorizationVersionAfter++; },
    (r) => { r.subject.config.planContent = "other plan"; },
    (r) => { r.subjectDigest = digest("other-subject"); },
    (r) => { r.reviewer = "task-agent"; },
    (r) => { r.decision = "pending"; },
    (r) => { r.reference = "docs/validation/reviews/another.json"; },
    (r) => { r.action = "assign"; },
  ];
  changes.forEach((change, index) => {
    const altered = structuredClone(f.record);
    change(altered);
    f.write(reference, altered);
    f.commit(reference);
    assert.throws(() => f.activate(`wrong-${index}`), /review record/);
    assert.equal(f.c.task(f.draft.taskId).status, "draft");
  });
  f.write(reference, f.record);
  f.commit(reference);
  assert.equal(f.activate("correct").status, "active");
});

test("malformed, unsafe, and changed review records cannot be replayed", (t) => {
  const f = fixture(t);
  f.write("docs/validation/reviewers.json", { version: 1, reviewers: ["fixture-human"] });
  f.commit("docs/validation/reviewers.json");
  f.write(reference, f.record);
  f.commit(reference);
  assert.throws(() => f.c.activate({ taskId: f.draft.taskId, config: f.record.subject.config,
    approvalReference: "../review-one", key: "traversal" }), /review reference/);
  writeFileSync(resolve(f.root, reference), '{"version":1,"version":1}\n');
  f.commit(reference);
  assert.throws(() => f.activate("duplicate"), /canonical JSON/);
  f.write(reference, f.record);
  f.commit(reference);
  f.activate("valid");
  const changed = { ...f.record, reviewedAt: "2026-09-28T12:01:00.000Z" };
  f.write(reference, changed);
  assert.throws(() => f.c.db.transaction(() =>
    f.c.review(reference, "activate", f.subject, f.scope)).immediate(),
  /differs from its committed/);
  f.commit(reference);
  assert.throws(() => f.c.db.transaction(() =>
    f.c.review(reference, "activate", f.subject, f.scope)).immediate(),
  /changed after use/);
  assert.equal(f.c.db.prepare("SELECT COUNT(*) AS total FROM approval_record_evidence").get().total, 1);
});