import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  SUPPORTED_POSTGRES_IMAGE,
  SUPPORTED_POSTGRES_MAJOR_VERSION,
} from "../lib/github-actions-validation-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const workflowPath = resolve(root, ".github/workflows/validation.yml");
const workflow = readFileSync(workflowPath, "utf8");

function sectionBetween(start, end) {
  const startIndex = workflow.indexOf(start);
  assert.notEqual(startIndex, -1, `workflow is missing ${start}`);
  const endIndex = end ? workflow.indexOf(end, startIndex + start.length) : workflow.length;
  assert.notEqual(endIndex, -1, `workflow is missing section boundary ${end}`);
  return workflow.slice(startIndex, endIndex);
}

function permissionBlocks() {
  const lines = workflow.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)permissions:\s*$/);
    if (!match) continue;
    const parentIndent = match[1].length;
    const entries = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const indent = line.match(/^\s*/)[0].length;
      if (indent <= parentIndent) break;
      const entry = line.trim().match(/^([a-z-]+):\s*(\S+)$/);
      assert.ok(entry, `invalid permissions entry: ${line.trim()}`);
      entries.push([entry[1], entry[2]]);
    }
    blocks.push(entries);
  }
  return blocks;
}

test("workflow covers every required GitHub event", () => {
  const triggers = sectionBetween("on:\n", "\n\n# This workflow");
  assert.match(triggers, /pull_request:/);
  assert.match(triggers, /push:\s+branches:\s+- main/s);
  assert.match(triggers, /merge_group:/);
  assert.match(triggers, /workflow_dispatch:/);
});

test("workflow is read-only and cannot replace an in-flight result", () => {
  const blocks = permissionBlocks();
  assert.equal(blocks.length, 3, "expected workflow and both jobs to declare permissions");
  for (const entries of blocks) {
    assert.deepEqual(entries, [["contents", "read"]]);
  }
  assert.match(workflow, /cancel-in-progress:\s+false/);
  assert.match(workflow, /group: canonical-validation-/);
});

test("all third-party actions use immutable commit pins", () => {
  const actionUses = [...workflow.matchAll(/^\s+uses:\s+([^\s#]+)@([^\s#]+)/gm)];
  assert.ok(actionUses.length >= 3, "expected checkout, setup-node, and upload-artifact");
  for (const [, action, ref] of actionUses) {
    assert.match(ref, /^[0-9a-f]{40}$/, `${action} must use a 40-character commit SHA`);
  }
});

test("workflow installs the declared runtime with frozen dependencies", () => {
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /node-version:\s+"20"/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: node --test scripts\/__tests__\/github-actions-workflow\.test\.mjs/);
});

test("workflow provisions and checks the test prerequisites", () => {
  assert.match(
    workflow,
    new RegExp(`image:\\s+${SUPPORTED_POSTGRES_IMAGE.replace(":", "\\:")}\\b`),
    `PostgreSQL service image drifted from the validation contract (expected ${SUPPORTED_POSTGRES_IMAGE}); update scripts/lib/github-actions-validation-contract.mjs only when intentionally upgrading the test harness`,
  );
  assert.equal(
    [...workflow.matchAll(/image:\s+postgres:\d+\b/g)].length,
    1,
    "workflow must declare exactly one PostgreSQL service image",
  );
  assert.match(workflow, /POSTGRES_DB:\s+master_reel_counter_test/);
  assert.match(workflow, /pg_isready/);
  assert.match(workflow, /psql "\$DATABASE_URL"/);
  assert.match(workflow, /drizzle-kit push --force/);
  assert.match(workflow, /github-actions-owner/);
  assert.match(workflow, /REPL_ID:\s+github-actions-validation/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /chromium\.launch/);
  assert.match(workflow, /DATABASE_URL:\s+postgresql:\/\/postgres:postgres@localhost:5432\/master_reel_counter_test/);
  assert.match(workflow, /Verify blank-database startup and test authentication/);
  assert.match(workflow, /node --test scripts\/__tests__\/github-actions-empty-database\.test\.mjs/);
});

test("workflow checks its contract before database and application validation", () => {
  const contractCheck = workflow.indexOf("run: node --test scripts/__tests__/github-actions-workflow.test.mjs");
  const readinessCheck = workflow.indexOf("name: Verify PostgreSQL readiness");
  assert.ok(contractCheck >= 0, "workflow contract check is missing");
  assert.ok(readinessCheck >= 0, "PostgreSQL readiness check is missing");
  assert.ok(
    contractCheck < readinessCheck,
    "workflow contract check must run before PostgreSQL readiness and application validation",
  );
});

test("PostgreSQL contract derives the service image from its supported major version", () => {
  assert.match(String(SUPPORTED_POSTGRES_MAJOR_VERSION), /^\d+$/);
  assert.equal(SUPPORTED_POSTGRES_IMAGE, `postgres:${SUPPORTED_POSTGRES_MAJOR_VERSION}`);
});

test("workflow routes validation through the canonical command", () => {
  assert.match(workflow, /npm run ci/);
  assert.match(workflow, /timeout-minutes:\s+30/);
});

test("stable aggregate fails closed for failure, cancellation, or skips", () => {
  const aggregate = sectionBetween("validation-result:", null);
  assert.match(aggregate, /if:\s+\$\{\{\s*always\(\)\s*\}\}/);
  assert.match(aggregate, /needs:\s+- validate/);
  assert.match(aggregate, /needs\.validate\.result/);
  assert.match(aggregate, /case "\$VALIDATION_RESULT"/);
  assert.match(aggregate, /success\)/);
  assert.match(aggregate, /exit 1/);
});

test("diagnostic uploads are bounded, always attempted, and non-authoritative", () => {
  const upload = sectionBetween("name: Upload diagnostic validation artifacts", "  validation-result:");
  assert.match(upload, /if:\s+\$\{\{\s*always\(\)\s*\}\}/);
  assert.match(upload, /continue-on-error:\s+true/);
  assert.match(upload, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(upload, /retention-days:\s+7/);
  assert.match(upload, /include-hidden-files:\s+false/);
  const pathBlock = upload.match(/path:\s*\|\n([\s\S]*?)\n\s+if-no-files-found:/);
  assert.ok(pathBlock, "artifact upload must declare a bounded path block");
  const paths = pathBlock[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert.deepEqual(paths, ["ci-artifacts/", "playwright-report/", "test-results/"]);
  assert.doesNotMatch(upload, /\.env|secrets\.|tests\/\.auth|credential/i);
});