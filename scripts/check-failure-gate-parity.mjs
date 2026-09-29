#!/usr/bin/env node
import { existsSync, readFileSync } from "fs";
import { execFileSync } from "child_process";
import { resolve } from "path";
const canonicalDirectory = ".agents/skills/failure-gate-v4";
const canonical = resolve(canonicalDirectory, "SKILL.md");
if (!existsSync(canonical)) {
  console.error("Failure Gate parity: canonical source is missing.");
  process.exit(1);
}
const normalize = (text) => text.replace(/\r\n/g, "\n");
const canonicalText = normalize(readFileSync(canonical, "utf8"));
const requiredContract = [
  "name: failure-gate-v4",
  "# Failure Gate v4",
  "project-local, cooperative workflow",
  "Core invariants",
  "Plan and activate",
  "Classify failures without expanding scope",
  "Decide completion and report accurately",
];
const missing = requiredContract.filter((marker) => !canonicalText.includes(marker));
if (missing.length) {
  console.error(`Failure Gate parity: canonical contract is missing ${missing.join(", ")}.`);
  process.exit(1);
}
const publishedEntries = [
  { archiveName: "README.md", sourcePath: resolve(canonicalDirectory, "README.md") },
  { archiveName: "SKILL.md", sourcePath: canonical },
  {
    archiveName: "reference/acceptance.md",
    sourcePath: resolve(canonicalDirectory, "reference/acceptance.md"),
  },
  {
    archiveName: "reference/implementation.md",
    sourcePath: resolve(canonicalDirectory, "reference/implementation.md"),
  },
];
for (const { sourcePath } of publishedEntries) {
  if (!existsSync(sourcePath)) {
    console.error(`Failure Gate parity: canonical package file ${sourcePath} is missing.`);
    process.exit(1);
  }
}
if (existsSync(resolve(".agents/skills/failure-gate"))) {
  console.error("Failure Gate parity: retired Failure Gate source still exists.");
  process.exit(1);
}
const published = resolve("artifacts/bathyscan/public/failure-gate-skill.zip");
if (!existsSync(published)) {
  console.error("Failure Gate parity: published snapshot is missing; run npm run publish:failure-gate.");
  process.exit(1);
}

let entries;
try {
  entries = execFileSync("unzip", ["-Z", "-1", published], { encoding: "utf8" }).trim().split(/\r?\n/);
} catch {
  console.error("Failure Gate parity: published snapshot is invalid; run npm run publish:failure-gate.");
  process.exit(1);
}
if (entries.length !== publishedEntries.length ||
    entries.some((name, index) => name !== publishedEntries[index].archiveName)) {
  console.error("Failure Gate parity: published snapshot entries differ; run npm run publish:failure-gate.");
  process.exit(1);
}
for (const { archiveName, sourcePath } of publishedEntries) {
  const sourceText = normalize(readFileSync(sourcePath, "utf8"));
  let publishedText;
  try {
    publishedText = normalize(execFileSync("unzip", ["-p", published, archiveName], { encoding: "utf8" }));
  } catch {
    console.error(`Failure Gate parity: published ${archiveName} is unreadable; run npm run publish:failure-gate.`);
    process.exit(1);
  }
  if (publishedText !== sourceText) {
    console.error(
      `Failure Gate parity: published ${archiveName} differs from its canonical source; run npm run publish:failure-gate.`,
    );
    process.exit(1);
  }
}

console.log("Failure Gate parity: canonical four-file v4 package and published snapshot agree.");
