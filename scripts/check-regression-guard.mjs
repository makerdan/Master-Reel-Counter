#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const fix = process.argv.includes("--fix-stub");
const stubsOnly = process.argv.includes("--stubs-only");
const target = process.env.TASK_PLAN_FILE;
if (target && (!target.endsWith(".md") || !existsSync(target))) {
  console.error(`REGRESSION-GUARD: TASK_PLAN_FILE must name an existing .md file: ${target}`);
  process.exit(1);
}
let files = target ? [target] : [];
if (!target && existsSync(".local/tasks")) {
  files = readdirSync(".local/tasks", { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => resolve(".local/tasks", entry.name));
}
if (files.length === 0) process.exit(0);
const errors = [];
const placeholder = (value) => !value || /<[^>]+>|\b(FILL IN|TBD|TODO)\b/i.test(value);
const section = (content, title) => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start < 0) return "";
  const next = lines.slice(start + 1).findIndex((line) => /^## /.test(line));
  return lines.slice(start + 1, next < 0 ? lines.length : start + 1 + next).join("\n");
};
const field = (body, name) => body.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, "m"))?.[1]?.trim();
const nonMaterialClassification = (content) => {
  const taskIdentity = section(content, "Task identity");
  const classifications = [...taskIdentity.matchAll(/^\*\*Materiality:\*\*\s*(.*?)\s*$/gm)]
    .map((match) => match[1].trim());
  const classification = classifications[0];
  const titleLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const titleIsDeletion = /^# DELETE -(?:\s|$)/.test(titleLine);
  if (classifications.length > 1 ||
      (classification !== undefined &&
        !["material", "non-material"].includes(classification.toLowerCase()))) {
    return { nonMaterial: false, invalid: true };
  }
  return { nonMaterial: classification
    ? classification.toLowerCase() === "non-material"
    : titleIsDeletion, invalid: false };
};
for (const file of files) {
  let content = readFileSync(file, "utf8");
  const classification = nonMaterialClassification(content);
  if (classification.invalid) errors.push(`${file}: Task identity Materiality must be exactly material or non-material`);
  const qualifies = !classification.nonMaterial;
  if (fix && !stubsOnly && qualifies && !/^## Regression Guard\s*$/m.test(content)) {
    content += "\n## Regression Guard\n**Covers:** FILL IN\n**Test location:** FILL IN\n**What it checks:** FILL IN\n";
    writeFileSync(file, content);
  }
  const body = section(content, "Regression Guard");
  if (!body) {
    if (qualifies && !stubsOnly) errors.push(`${file}: missing ## Regression Guard`);
    continue;
  }
  if (/^\s*\*\*N\/A\*\*/m.test(body)) {
    if (qualifies) errors.push(`${file}: N/A requires an explicit non-material classification`);
    const reasons = [...body.matchAll(/^\*\*Why N\/A:\*\*\s*(.*?)\s*$/gm)].map((match) => match[1].trim());
    if (reasons.length !== 1 || placeholder(reasons[0])) errors.push(`${file}: N/A reason is missing, ambiguous, or a placeholder`);
    continue;
  }
  for (const field of ["Covers", "Test location", "What it checks"]) {
    const value = body.match(new RegExp(`^\\*\\*${field}:\\*\\*\\s*(.+)$`, "m"))?.[1]?.trim();
    if (placeholder(value)) errors.push(`${file}: Regression Guard ${field} is empty or a placeholder`);
  }
}
if (fix) {
  console.log(`Regression Guard: stub repair completed for ${files.length} plan(s); strict mode is a separate check.`);
  process.exit(0);
}
if (errors.length) {
  for (const error of errors) console.error(`REGRESSION-GUARD: ${error}`);
  process.exit(1);
}
console.log(`Regression Guard: ${files.length} plan(s) compliant.`);