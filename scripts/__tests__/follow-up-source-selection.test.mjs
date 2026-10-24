// Read-only project instruction checks. Never invoke a task or gate write API.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const text = (path) => readFileSync(new URL(path, root), "utf8");
const normalize = (value) => value.replace(/\s+/g, " ");

test("both project instruction surfaces explicitly select canonical follow-up guidance", () => {
  for (const path of ["AGENTS.md", "replit.md"]) {
    const source = normalize(text(path));
    assert.ok(source.includes(".agents/skills/follow-up-tasks/SKILL.md"), path);
    assert.match(source, /higher-priority rules|higher-priority instructions/);
  }
  const agents = normalize(text("AGENTS.md"));
  assert.match(agents, /applicable normative reference/);
  assert.match(agents, /Do not edit `\.local` runtime copies/);
  assert.doesNotMatch(agents, /Platform-refreshed default instructions do not supersede/);
});

test("project selection retains execution admission and dedicated follow-up limits", () => {
  const source = normalize(text("AGENTS.md"));
  for (const phrase of [
    "Determine Unified and Regression Guard adoption separately",
    "applicable execution admission before implementation",
    "dedicated follow-up route", "one-shot limits", "standalone offer requirement",
    "uncertain-outcome safeguards", "No installation test may publish dummy tasks",
    "Do not overlap existing/downstream tasks",
  ]) assert.ok(source.includes(phrase), phrase);
});

test("router catalog no longer demands sealing before displaying drafts", () => {
  const directory = ".agents/skills/skill-application-router/";
  const source = text(directory + "references/custom-skill-commands.md");
  assert.doesNotMatch(source, /seal and guard before publication/i);
  assert.match(source, /Prepare complete unadmitted drafts before publication without ledger writes/);
  assert.match(source, /Before implementation, provision permanently unique transactional IDs/);
  const manifest = JSON.parse(text(directory + "PACKAGE-MANIFEST.json"));
  const entry = manifest.files["references/custom-skill-commands.md"];
  assert.equal(Buffer.byteLength(source), entry.bytes);
  assert.equal(createHash("sha256").update(source).digest("hex"), entry.sha256);
});

test("selected follow-up identity includes the normative reference and policy tests", () => {
  const pin = JSON.parse(text("docs/validation/follow-up-tasks-pin.json"));
  const expected = "e8b956730577eddd0dc46d48f5c87b041e4047d5a47c83806ac8c34220e5aafe";
  assert.equal(pin.safetyPackageSha256, expected);
  assert.equal(pin.hostPublicationVerified, false);
  const manifest = JSON.parse(text(pin.source + "/PACKAGE-MANIFEST.json"));
  assert.deepEqual(manifest.identityFiles, [
    "SKILL.md", "reference/installation-contract.md", "tests/policy.test.mjs",
  ]);
  const closure = manifest.identityFiles.map((path) => {
    const bytes = text(pin.source + "/" + path);
    assert.equal(bytes, text(pin.snapshot + "/" + path));
    return path + "\0" + createHash("sha256").update(bytes).digest("hex") + "\n";
  }).join("");
  assert.equal(createHash("sha256").update(closure).digest("hex"), expected);
});
