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
for (const file of files) {
  let content = readFileSync(file, "utf8");
  const qualifies = !/DELETE\s*-|cosmetic|purely additive|not-applicable/i.test(content);
  if (fix && !stubsOnly && qualifies && !/^## Regression Guard\s*$/m.test(content)) {
    const selfSatisfying = /failure[\s-]?gate|validation contract|regression guard/i.test(content.slice(0, 400));
    content += selfSatisfying
      ? "\n## Regression Guard\n**Self-satisfying** — this task's deliverable is the validation guard itself.\n"
      : "\n## Regression Guard\n**Covers:** FILL IN\n**Test location:** FILL IN\n**What it checks:** FILL IN\n";
    writeFileSync(file, content);
  }
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Regression Guard");
  if (start < 0) {
    if (qualifies && !stubsOnly) errors.push(`${file}: missing ## Regression Guard`);
    continue;
  }
  const next = lines.slice(start + 1).findIndex((line) => /^## /.test(line));
  const body = lines.slice(start + 1, next < 0 ? lines.length : start + 1 + next).join("\n");
  if (/^\s*\*\*Self-satisfying\*\*/m.test(body)) continue;
  if (/^\s*\*\*N\/A\*\*/m.test(body)) {
    if (placeholder(body.match(/^\*\*Why N\/A:\*\*\s*(.+)$/m)?.[1])) errors.push(`${file}: N/A reason is empty or a placeholder`);
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