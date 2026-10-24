// Instruction-artifact checks only. No platform callback, ledger or host operation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const core = await readFile(new URL("../SKILL.md", import.meta.url), "utf8");
const reference = await readFile(new URL("../reference/installation-contract.md", import.meta.url), "utf8");
const normalize = text => text.replace(/\s+/g, " ");
const text = normalize(core);
const installation = normalize(reference);
const includesAll = (source, phrases) => {
  for (const phrase of phrases) assert.ok(source.includes(phrase), phrase);
};
function assertDraftBoundary(source) {
  const value = normalize(source);
  includesAll(value, [
    "Do not invoke a writing provisioner just to propose work.",
    "Validate candidate declarations without ledger writes.",
    "provision and seal unadmitted drafts only in the writable execution environment before implementation",
  ]);
  for (const forbidden of [
    /Seal and guard every candidate before publication/i,
    /require a sealed local plan before showing follow-ups/i,
    /persist publication intent with expected revision\/context/i,
    /Associate returned references separately/i,
    /complete exact host readback/i,
    /use createProjectTask when proposeFollowUpTasks is unavailable/i,
  ]) assert.doesNotMatch(value, forbidden);
}

test("complete proposals precede the display-producing callback, not execution sealing", () => {
  const checkpoint = core.indexOf("## Before suggestions are shown: proposal completeness checkpoint");
  const route = core.indexOf("## Dedicated proposal route and limits");
  const callback = core.indexOf("proposeFollowUpTasks({");
  assert.ok(checkpoint > 0 && route > checkpoint && callback > route);
  includesAll(text, ["Prepare the applicable proposal", "Prepare applicable Regression Guard coverage",
    "Validate every proposal", "Check the dedicated publication capability", "Refuse incomplete publication",
    "do not call the proposal API for that batch"]);
  assertDraftBoundary(core);
});

test("dedicated route, parent, categories, limits and downstream skip remain explicit", () => {
  includesAll(text, ["up to 3", "automatic current-task parent linkage", "required `category`",
    "already lists downstream dependent tasks", "one-shot per assigned project task",
    "not `bulkCreateProjectTasks` or", "`createProjectTask`",
    "incomplete_scope", "next_steps", "tech_debt", "test_gaps", "custom_analytics", "new_artifact"]);
});

test("uncertain or partial outcomes never justify another create", () => {
  includesAll(text, ["Never repeat it after uncertain or partial outcomes",
    "reconcile uncertainty using available platform", "unresolved outcomes are not success",
    "do not propose a second batch", "markFollowUpTaskObsolete"]);
});

test("standalone sessions need an actual offer and do not infer archival cause", () => {
  includesAll(text, ["system reminder explicitly offers it", "one call per offer",
    "respecting any tighter current system limits", "archived suggestions",
    "`CANCELLED` alone does not establish its cause", "Users dismiss standalone suggestions"]);
});

test("supported schema is required but custom host evidence is not", () => {
  includesAll(text, [
    "Do not manufacture host support with environment flags, fixture results or a general creation adapter.",
    "Use only actual supported host capabilities; this safeguard does not introduce custom host-evidence prerequisites.",
    "Use the supported live schema, not invented gate fields.",
    "No custom publication/readback/association or native-approval evidence is required.",
    "Custom publication intent, exact host readback and a separate association route are not prerequisites.",
    "No unsupported fields, truncated contract, pointer-only substitute, placeholder task, fabricated native reference or fallback to general task creation.",
  ]);
});

test("Unified and Regression Guard adoption are assessed independently", () => {
  includesAll(text, ["Determine adoption separately for Failure Gate Unified and Regression Guard.",
    "If only Regression Guard is adopted", "not Unified IDs, ledgers, seals or tiers",
    "If only Unified is adopted", "without silently installing another skill",
    "If neither is adopted, use the actual host policy.",
    "A definition's presence alone does not establish adopted enforcement."]);
});

test("guard forms need meaningful scope and real deferral support", () => {
  includesAll(text, ["every material component", "exactly one", "justified permitted N/A",
    "pure-test-only self-satisfaction", "Wholly excluded work", "Review the affected boundary",
    "Planned tests are not delivered tests", "real committed follow-up",
    "A permitted deferral form does not establish a supported local admission route"]);
});

test("execution preflight, historical records and delivery remain separate", () => {
  includesAll(text, ["first action after Start", "before implementation or validation workloads",
    "do not create Unified identities, seals or tiers", "Never edit a sealed plan in place",
    "required revision-bound requirement-to-delivery handoff", "verification is optional",
    "owner-directed gate-maintenance exception", "not native Start interception"]);
});

test("current scope and artifact suggestions cannot be manufactured to fill a quota", () => {
  includesAll(text, ["Do not create extra work merely to fill a suggestion quota",
    "do not relabel them as follow-ups to claim completion",
    "Require evidence of a concrete unmet user need",
    "an absent mobile artifact alone is not justification",
    "do not propose a kind already present", "Read `project-analytics` before proposing"]);
});

test("canonical selection preserves runtime-managed copies and platform priority", () => {
  includesAll(text, ["under `.agents/skills/follow-up-tasks/`",
    "Do not edit, replace or claim to suppress that runtime copy",
    "Project instructions cannot override higher-priority rules or actual callback limits",
    "Never publish dummy tasks"]);
  includesAll(installation, ["Project guidance improves selection", "cannot guarantee the platform stops loading",
    "not evidence that live publication or later Agent behavior has been verified",
    "Do not call proposeFollowUpTasks", "General task creation is not a fallback"]);
});

test("negative text fixtures detect reintroduced sealing or custom publisher requirements", () => {
  for (const bad of [
    "Seal and guard every candidate before publication.",
    "Require a sealed local plan before showing follow-ups.",
    "Persist publication intent with expected revision/context.",
    "Associate returned references separately.",
    "Use createProjectTask when proposeFollowUpTasks is unavailable.",
  ]) assert.throws(() => assertDraftBoundary(core + "\n" + bad));
});

test("negative text fixture detects loss of no-ledger-write proposal boundary", () => {
  assert.throws(() => assertDraftBoundary(core.replace(
    "Validate candidate declarations without ledger writes.", "Validate candidate declarations.")));
});
