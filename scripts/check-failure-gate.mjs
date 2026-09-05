#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadCatalog, findExactRecord } from "./lib/baseline.mjs";
import { loadTiers } from "./lib/tiers.mjs";

const fix = process.argv.includes("--fix-stub");
const archive = process.argv.includes("--archive");
const target = process.env.TASK_PLAN_FILE;
if (target && (!target.endsWith(".md") || !existsSync(target))) {
  console.error(`FAILURE-GATE: TASK_PLAN_FILE must name an existing .md file: ${target}`);
  process.exit(1);
}
let files = target ? [target] : [];
const archiveDir = process.env.FAILURE_GATE_ARCHIVE_DIR ?? ".local/tasks";
if (!target && archive && existsSync(archiveDir)) {
  files = readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => resolve(archiveDir, entry.name));
}
if (files.length === 0) process.exit(0);

const errors = [];
let catalog;
try { catalog = loadCatalog(); } catch (error) {
  console.error(`FAILURE-GATE: ${error.message}`);
  process.exit(1);
}
const tiers = loadTiers();
const placeholder = (value) => !value || /<[^>]+>|\b(FILL IN|TBD|TODO)\b/i.test(value);
const section = (content, title) => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start < 0) return "";
  const next = lines.slice(start + 1).findIndex((line) => /^## /.test(line));
  return lines.slice(start + 1, next < 0 ? lines.length : start + 1 + next).join("\n");
};

for (const file of files) {
  let content = readFileSync(file, "utf8");
  if (fix) {
    let changed = false;
    if (!/^## Pre-existing failures to ignore\s*$/m.test(content)) {
      content += `\n## Pre-existing failures to ignore\nNone known at plan time. Treat every failure as a potential regression.\n\n**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.\n`;
      changed = true;
    }
    if (!/^## Validation\s*$/m.test(content)) {
      content += `\n## Validation\n**Command:** \`test-standard\`\n**Why:** FILL IN — explain why this registered tier covers the task.\n**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.\n`;
      changed = true;
    }
    if (changed) writeFileSync(file, content);
  }
  const baseline = section(content, "Pre-existing failures to ignore");
  const validation = section(content, "Validation");
  if (!baseline) errors.push(`${file}: missing ## Pre-existing failures to ignore`);
  if (!validation) errors.push(`${file}: missing ## Validation`);
  const command = validation.match(/^\*\*Command:\*\*\s*`?([^`\n]+)`?\s*$/m)?.[1]?.trim();
  if (!command || !tiers[command]) errors.push(`${file}: Validation Command must be a registered tier`);
  const why = validation.match(/^\*\*Why:\*\*\s*(.+)$/m)?.[1]?.trim();
  if (placeholder(why)) errors.push(`${file}: Validation Why is empty or a placeholder`);
  const ceiling = validation.match(/^\*\*Do not escalate:\*\*\s*(.+)$/m)?.[1]?.trim();
  if (placeholder(ceiling)) errors.push(`${file}: Validation Do not escalate is empty or a placeholder`);
  const markerLines = baseline.split("\n").filter((line) => /^\s*-\s*\*\*(Ignored baseline|Owned baseline repair):/.test(line));
  for (const line of markerLines) {
    const id = line.match(/`([^`]+)`/)?.[1];
    const details = line.match(/—\s*(.+?)\s*›\s*(.+?);\s*match only this signature:\s*(.+)$/);
    if (!id || !details || details.slice(1).some(placeholder)) {
      errors.push(`${file}: baseline ${id ?? "<missing>"} must declare exact suite, test, and signature`);
      continue;
    }
    const result = findExactRecord(catalog, { id, suite: details[1].trim(), test: details[2].trim(), signature: details[3].trim() });
    if (!result.ok) errors.push(`${file}: ${result.reason}`);
  }
  const referencedIds = [...baseline.matchAll(/`([A-Z][A-Z0-9_-]+)`/g)].map((match) => match[1]);
  for (const id of referencedIds) {
    if (!markerLines.some((line) => line.includes(`\`${id}\``))) errors.push(`${file}: baseline ${id} lacks an ownership marker`);
  }
}
if (fix) {
  console.log(`Failure Gate: stub repair completed for ${files.length} plan(s); strict mode is a separate check.`);
  process.exit(0);
}
if (errors.length) {
  for (const error of errors) console.error(`FAILURE-GATE: ${error}`);
  process.exit(1);
}
console.log(`Failure Gate: ${files.length} plan(s) compliant.`);