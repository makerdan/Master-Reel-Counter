import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inputManifest, createSnapshot, verifySnapshot, readVerifiedReport,
} from "../lib/failure-gate/evidence.mjs";
import {
  assessRun, assessProvenance, matchingBaseline,
} from "../lib/failure-gate/assessment.mjs";

const environment = { identity: "fixture-host-v1", externalState: "none", resetPolicy: "not-applicable" };
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "fg-evidence-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "source");
  mkdirSync(root);
  writeFileSync(join(root, "program.txt"), "original");
  return { directory, root };
}

test("portable fixture host snapshots include generated/untracked/dependency bytes without git or optional catalogs", (t) => {
  const { directory, root } = fixture(t);
  mkdirSync(join(root, "dependencies"));
  writeFileSync(join(root, "dependencies", "module.txt"), "installed dependency");
  writeFileSync(join(root, "generated.txt"), "generated");
  const snapshot = createSnapshot({ root, destination: join(directory, "run"), environment });
  assert.equal(snapshot.isolation, "independent-copy");
  assert.deepEqual(snapshot.manifest.files.map((f) => f.path),
    ["dependencies/module.txt", "generated.txt", "program.txt"]);
  assert.equal(verifySnapshot({ root, manifest: snapshot.manifest }).digest, snapshot.digest);
  writeFileSync(join(root, "program.txt"), "edit after snapshot");
  assert.equal(readFileSync(join(snapshot.root, "program.txt"), "utf8"), "original");
  assert.throws(() => verifySnapshot({ root, manifest: snapshot.manifest }), /inputs changed/);
});

test("output exclusions do not invalidate evidence but config and dependency edits do", (t) => {
  const { root } = fixture(t);
  const before = inputManifest({ root, environment });
  mkdirSync(join(root, "test-results"));
  writeFileSync(join(root, "test-results", "report.json"), "{}");
  writeFileSync(join(root, ".env"), "DO_NOT_HASH=this-is-not-recorded");
  writeFileSync(join(root, "private.key"), "secret");
  assert.equal(inputManifest({ root, environment }).digest, before.digest);
  writeFileSync(join(root, "config.json"), "{}");
  assert.notEqual(inputManifest({ root, environment }).digest, before.digest);
  assert.throws(() => inputManifest({ root, environment, exclusions: ["../outside"] }), /exclusions/);
});

test("safe internal dependency symlinks become independent files; escaping links are blocked", (t) => {
  const { root, directory } = fixture(t);
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", "cli.mjs"), "console.log('fixture')");
  chmodSync(join(root, "node_modules", "cli.mjs"), 0o700);
  symlinkSync("../cli.mjs", join(root, "node_modules", ".bin", "cli"));
  const snapshot = createSnapshot({ root, destination: join(directory, "run"), environment });
  writeFileSync(join(root, "node_modules", "cli.mjs"), "changed source dependency");
  assert.equal(readFileSync(join(snapshot.root, "node_modules", ".bin", "cli"), "utf8"),
    "console.log('fixture')");
  symlinkSync(directory, join(root, "outside"));
  assert.throws(() => inputManifest({ root, environment }), /symlink/);
});

test("snapshot destinations cannot overwrite worktree or use existing directories", (t) => {
  const { root, directory } = fixture(t);
  assert.throws(() => createSnapshot({ root, destination: join(root, "run"), environment }), /outside/);
  assert.throws(() => createSnapshot({ root, destination: directory, environment }), /outside/);
  mkdirSync(join(directory, "existing"));
  assert.throws(() => createSnapshot({ root, destination: join(directory, "existing"), environment }), /EEXIST/);
});

test("unknown fixture state and secret-looking environment identifiers fail closed", (t) => {
  const { root } = fixture(t);
  assert.throws(() => inputManifest({ root }), /environment/);
  assert.throws(() => inputManifest({ root, environment: { ...environment, externalState: "unknown" } }), /environment/);
  assert.throws(() => inputManifest({ root, environment: { ...environment, identity: "postgres://secret@host/db" } }), /environment/);
});

test("reports reject path escape, symlinks, swaps, malformed JSON, and over-budget contents", (t) => {
  const { root } = fixture(t);
  const bytes = '{"tests":1}';
  const digest = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(root, "report.json"), bytes);
  assert.deepEqual(readVerifiedReport({ root, path: "report.json", digest }), { tests: 1 });
  assert.throws(() => readVerifiedReport({ root, path: "../report.json", digest }), /invalid report/);
  assert.throws(() => readVerifiedReport({ root, path: "report.json", digest, maxBytes: 2 }), /oversized/);
  symlinkSync("report.json", join(root, "linked.json"));
  assert.throws(() => readVerifiedReport({ root, path: "linked.json", digest }), /symlink/);
  writeFileSync(join(root, "report.json"), '{"tests":2}');
  assert.throws(() => readVerifiedReport({ root, path: "report.json", digest }), /digest mismatch/);
  writeFileSync(join(root, "report.json"), "bad");
  assert.throws(() => readVerifiedReport({ root, path: "report.json",
    digest: createHash("sha256").update("bad").digest("hex") }), /invalid JSON/);
});

const failure = { suite: "fixture-suite", test: "one invariant", signature: "expected x",
  variant: "default", environment: "fixture-host-v1" };
const authorization = { taskId: "fixture-task", namespace: "fixture", authorizationVersion: 1,
  planDigest: "plan", tierDefinitionDigest: "tier", policyDigest: "policy" };
const tier = { steps: [{ name: "fixture-check", kind: "test", command: ["fixture-tool"] }] };
function complete() {
  return { run: { ...authorization, runId: "run-1", purpose: "required_tier_validation",
    snapshotDigest: "snapshot", environmentVerified: true, isolation: "independent-copy",
    steps: [{ name: "fixture-check", status: "passed", exitCode: 0, signal: null,
      reportVerified: true, tests: 1, skipped: 0, failures: [], passedTests: [failure] }] },
  authorization, tier, currentSnapshotDigest: "snapshot", now: "2026-09-27" };
}
function failed() {
  const context = complete();
  Object.assign(context.run.steps[0], { status: "failed", exitCode: 1, failures: [failure], passedTests: [] });
  return context;
}
const record = { ...failure, id: "baseline-one", status: "active", owner: "maintenance",
  reviewer: "reviewer", reviewBy: "2026-09-28", matchingRule: "exact-v1" };

test("assessment ignores caller PASS and binds purpose, identity, snapshot, and version", () => {
  assert.equal(assessRun(complete()).status, "PASS");
  for (const [field, value] of [["purpose", "diagnostic_retry"], ["taskId", "another-task"],
    ["authorizationVersion", 2], ["snapshotDigest", "stale"], ["environmentVerified", false]]) {
    const context = complete(); context.run[field] = value; context.run.assessment = "PASS";
    assert.equal(assessRun(context).status, "BLOCKED", field);
  }
});

test("missing/skipped/zero/duplicate/truncated reports cannot pass or be ignored", () => {
  for (const patch of [{ tests: 0 }, { skipped: 1 }, { reportVerified: false },
    { status: "incomplete" }, { signal: "SIGTERM" }, { exitCode: null }]) {
    const context = complete(); Object.assign(context.run.steps[0], patch);
    assert.equal(assessRun(context).status, "INCOMPLETE");
  }
  const context = complete(); context.run.steps.push(context.run.steps[0]);
  assert.equal(assessRun(context).status, "INCOMPLETE");
});

test("exact authorized ignores preserve raw failures and expire at completion", () => {
  const context = { ...failed(), catalog: [record], ignoredBaselineIds: [record.id] };
  const result = assessRun(context);
  assert.equal(result.status, "ACCEPTABLE_WITH_IGNORED_FAILURES");
  assert.equal(result.rawResults[0].exitCode, 1);
  assert.equal(assessRun({ ...context, now: "2026-09-29" }).status, "BLOCKED");
  for (const patch of [{ status: "resolved" }, { revoked: true }, { reviewBy: "9999-99-99" },
    { environment: "different" }, { variant: "different" }, { reviewer: "" }, { matchingRule: "fuzzy" }]) {
    assert.equal(matchingBaseline({ failure, catalog: [{ ...record, ...patch }],
      ignoredBaselineIds: [record.id], now: context.now }), null);
  }
  assert.equal(matchingBaseline({ failure, catalog: [record, { ...record, id: "collision" }],
    ignoredBaselineIds: [record.id], now: context.now }), null);
});

test("owned repairs survive catalog expiry, deletion, skip, and unapproved identity changes", () => {
  const context = { ...complete(), ownedRepairs: [failure], catalog: [{ ...record, status: "expired" }] };
  assert.equal(assessRun(context).status, "PASS");
  context.run.steps[0].passedTests = [];
  assert.equal(assessRun(context).status, "FAIL");
  context.run.steps[0].passedTests = [{ ...failure, test: "renamed invariant" }];
  assert.equal(assessRun(context).status, "FAIL");
  const failing = { ...failed(), ownedRepairs: [failure], catalog: [record], ignoredBaselineIds: [record.id] };
  assert.equal(assessRun(failing).status, "FAIL");
});

test("audit, typecheck, lint, smoke and harness failures never use test baselines", () => {
  for (const kind of ["audit", "typecheck", "lint", "smoke", "harness"]) {
    const context = { ...failed(), tier: { steps: [{ ...tier.steps[0], kind }] },
      catalog: [record], ignoredBaselineIds: [record.id] };
    assert.equal(assessRun(context).status, "FAIL");
  }
});

function provenance() {
  return { failure, reviewer: "fixture-reviewer", reviewReference: "review-1", diagnosticsAuthorized: true,
    retries: [1, 2, 3].map((n) => ({ runId: `retry-${n}`, purpose: "diagnostic_retry",
      environment: failure.environment, reportVerified: true, tests: 1, skipped: 0,
      signal: null, exitCode: n === 2 ? 0 : 1, failure })),
    direct: { verified: true, unaffected: true, earlier: true, snapshotDigest: "earlier-snapshot",
      observationId: "earlier-observation", failure },
    corroboration: [{ verified: true, kind: "historical-record",
      observationId: "independent-observation", failure }] };
}

test("provenance needs exactly three real retries and independent earlier evidence", () => {
  const p = provenance();
  const check = (value) => assessProvenance({ failure, provenance: value, initialRunId: "run-1" });
  assert.equal(check(p), true);
  assert.equal(assessRun({ ...failed(), provenance: [p] }).status, "ACCEPTABLE_WITH_IGNORED_FAILURES");
  assert.equal(check({ ...p, retries: p.retries.slice(1) }), false);
  assert.equal(check({ ...p, retries: [...p.retries, p.retries[0]] }), false);
  assert.equal(check({ ...p, direct: undefined }), false);
  assert.equal(check({ ...p, direct: { ...p.direct, unaffected: false } }), false);
  assert.equal(check({ ...p, corroboration: [{ ...p.corroboration[0],
    observationId: p.direct.observationId }] }), false);
  for (const patch of [{ tests: 0 }, { skipped: 1 }, { signal: "SIGKILL" },
    { reportVerified: false }, { runId: "run-1" }]) {
    assert.equal(check({ ...p, retries: [{ ...p.retries[0], ...patch }, ...p.retries.slice(1)] }), false);
  }
});