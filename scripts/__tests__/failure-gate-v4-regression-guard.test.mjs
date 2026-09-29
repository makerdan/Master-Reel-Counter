import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const checker = resolve(process.cwd(), "scripts/check-regression-guard.mjs");
const plan = ({ title = "# Cosmetic behavior change", materiality = null, regression = "" } = {}) => `\
${title}

## Task identity
${materiality ? `**Materiality:** ${materiality}\n` : ""}**Task ID:** \`fixture-task\`

## Validation
**Why:** This change is not merely cosmetic; it changes behavior.

${regression}`;

test("strict Regression Guard uses only explicit scoped non-material classification", (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), "failure-gate-regression-guard-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let sequence = 0;
  const check = (content) => {
    const path = resolve(directory, `plan-${++sequence}.md`);
    writeFileSync(path, content);
    return spawnSync(process.execPath, [checker], {
      cwd: process.cwd(),
      env: { ...process.env, TASK_PLAN_FILE: path },
      encoding: "utf8",
    });
  };

  const proseKeyword = check(plan());
  assert.notEqual(proseKeyword.status, 0);
  assert.match(proseKeyword.stderr, /missing ## Regression Guard/);

  const unscopedClassification = check(plan({
    materiality: "This is non-material because it is cosmetic",
    regression: "## Regression Guard\n**N/A**\n**Why N/A:** No behavior changes.\n",
  }));
  assert.notEqual(unscopedClassification.status, 0);
  assert.match(unscopedClassification.stderr, /Materiality must be exactly/);
  assert.match(unscopedClassification.stderr, /N\/A requires an explicit non-material classification/);

  const explicitNonMaterial = check(plan({
    materiality: "non-material",
    regression: "## Regression Guard\n**N/A**\n**Why N/A:** Copy-only wording change; no behavior changes.\n",
  }));
  assert.equal(explicitNonMaterial.status, 0, explicitNonMaterial.stderr);

  const duplicateMateriality = check(plan({
    materiality: "non-material\n**Materiality:** material",
    regression: "## Regression Guard\n**N/A**\n**Why N/A:** Copy-only wording change; no behavior changes.\n",
  }));
  assert.notEqual(duplicateMateriality.status, 0);
  assert.match(duplicateMateriality.stderr, /Materiality must be exactly/);

  const exactDeleteTitle = check(plan({
    title: "# DELETE - retired fixture capability",
    regression: "## Regression Guard\n**N/A**\n**Why N/A:** Removes the obsolete fixture capability.\n",
  }));
  assert.equal(exactDeleteTitle.status, 0, exactDeleteTitle.stderr);

  const deletePhraseInProse = check(plan({
    title: "# Feature change",
    regression: "## Regression Guard\n**N/A**\n**Why N/A:** DELETE - is mentioned only as an example.\n",
  }));
  assert.notEqual(deletePhraseInProse.status, 0);
  assert.match(deletePhraseInProse.stderr, /explicit non-material classification/);

  const secondaryDeleteHeading = check(plan({
    title: "# Feature change",
    regression: "## Regression Guard\n**N/A**\n**Why N/A:** No behavioral change.\n",
  }).replace("\n## Task identity", "\n# DELETE - quoted heading in the description\n\n## Task identity"));
  assert.notEqual(secondaryDeleteHeading.status, 0);
  assert.match(secondaryDeleteHeading.stderr, /explicit non-material classification/);

  const selfSatisfying = check(plan({
    regression: "## Regression Guard\n**Self-satisfying** — this task changes the validation guard.\n",
  }));
  assert.notEqual(selfSatisfying.status, 0);
  assert.match(selfSatisfying.stderr, /Covers is empty or a placeholder/);

  const repairPath = resolve(directory, "repair-plan.md");
  writeFileSync(repairPath, plan({ title: "# Failure Gate guard implementation" }));
  const repair = spawnSync(process.execPath, [checker, "--fix-stub"], {
    cwd: process.cwd(), env: { ...process.env, TASK_PLAN_FILE: repairPath }, encoding: "utf8",
  });
  assert.equal(repair.status, 0, repair.stderr);
  assert.match(readFileSync(repairPath, "utf8"), /\*\*Covers:\*\* FILL IN/);
  assert.doesNotMatch(readFileSync(repairPath, "utf8"), /\*\*Self-satisfying\*\*/);
  const strictAfterRepair = spawnSync(process.execPath, [checker], {
    cwd: process.cwd(), env: { ...process.env, TASK_PLAN_FILE: repairPath }, encoding: "utf8",
  });
  assert.notEqual(strictAfterRepair.status, 0);
  assert.match(strictAfterRepair.stderr, /Covers is empty or a placeholder/);

  const placeholderReason = check(plan({
    materiality: "non-material",
    regression: "## Regression Guard\n**N/A**\n**Why N/A:** TBD\n",
  }));
  assert.notEqual(placeholderReason.status, 0);
  assert.match(placeholderReason.stderr, /N\/A reason is missing, ambiguous, or a placeholder/);
});