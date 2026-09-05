#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadCatalog, findExactRecord } from "./lib/baseline.mjs";
import { loadTiers } from "./lib/tiers.mjs";

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const all = (flag) => args.flatMap((item, index) => item === flag ? [args[index + 1]] : []).filter(Boolean);
const name = value("--name");
const why = value("--why");
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name) || !why?.trim()) {
  console.error("Usage: node scripts/new-plan.mjs --name <slug> --why \"<reason>\" [--tier test-standard]");
  process.exit(2);
}
const tier = value("--tier") ?? "test-standard";
if (!loadTiers()[tier]) throw new Error(`unregistered validation tier ${tier}`);
const catalog = loadCatalog();
const ids = [...all("--baseline-id"), ...all("--owned-baseline-id")];
const records = new Map();
for (const id of ids) {
  const record = catalog.records.find((item) => item.id === id);
  if (!record || !findExactRecord(catalog, { id, suite: record.suite, test: record.test, signature: record.signature }).ok) {
    throw new Error(`baseline ${id} is not an active, unexpired referenceable record`);
  }
  records.set(id, record);
}
const observations = all("--environment-observation");
const preExisting = all("--pre-existing");
const marker = (flag, id) => {
  const record = records.get(id);
  const label = flag === "--baseline-id" ? "Ignored baseline" : "Owned baseline repair";
  return `- **${label}:** \`${id}\` — ${record.suite} › ${record.test}; match only this signature: ${record.signature}.`;
};
const plan = `# ${name}

## Why
${why.trim()}

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.
${all("--baseline-id").map((id) => marker("--baseline-id", id)).join("\n")}
${all("--owned-baseline-id").map((id) => marker("--owned-baseline-id", id)).join("\n")}
${preExisting.map((item) => `- ${item}`).join("\n")}

## Task-local environment observations
${observations.length ? observations.map((item) => `- ${item}`).join("\n") : "None recorded."}

## Validation
**Command:** \`${tier}\`
**Why:** FILL IN — explain why this registered tier covers the task.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Self-satisfying** — replace this with a concrete guard when the task changes existing behavior.

## Relevant files
- <FILL IN>
`;
const path = resolve(".local/tasks", `${name}.md`);
mkdirSync(resolve(".local/tasks"), { recursive: true });
writeFileSync(path, plan);
console.log(path);