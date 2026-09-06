#!/usr/bin/env node
import { existsSync, readFileSync } from "fs";
import { execFileSync } from "child_process";
import { resolve } from "path";
const canonical = resolve(".agents/skills/failure-gate/SKILL.md");
const mirror = resolve(".local/custom_skills/failure-gate/SKILL.md");
if (!existsSync(canonical) || !existsSync(mirror)) {
  console.error("Failure Gate parity: canonical source or generated mirror is missing.");
  process.exit(1);
}
const normalize = (text) => text.replace(/\r\n/g, "\n");
const canonicalText = normalize(readFileSync(canonical, "utf8"));
const mirrorText = normalize(readFileSync(mirror, "utf8"));
const requiredContract = [
  "name: Failure Gate",
  "Non-negotiable contract",
  "Plan time",
  "Execute time",
  "Archive",
  "maintenance",
];
const missing = requiredContract.filter((marker) => !canonicalText.includes(marker) || !mirrorText.includes(marker));
if (missing.length) {
  console.error(`Failure Gate parity: mirror contract is missing ${missing.join(", ")}.`);
  process.exit(1);
}
const published = resolve("artifacts/bathyscan/public/failure-gate-skill.zip");
if (!existsSync(published)) {
  console.error("Failure Gate parity: published snapshot is missing; run npm run publish:failure-gate.");
  process.exit(1);
}
const publishedEntries = [
  { archiveName: "SKILL.md", sourcePath: canonical },
  {
    archiveName: "validation-tiers.md",
    sourcePath: resolve(".agents/skills/validation-tiers/SKILL.md"),
  },
  {
    archiveName: "tiers.json",
    sourcePath: resolve(".agents/skills/validation-tiers/tiers.json"),
  },
];

for (const { archiveName, sourcePath } of publishedEntries) {
  const sourceText = normalize(readFileSync(sourcePath, "utf8"));
  const publishedText = normalize(
    execFileSync("unzip", ["-p", published, archiveName], { encoding: "utf8" }),
  );
  if (publishedText.trim() !== sourceText.trim()) {
    console.error(`Failure Gate parity: published ${archiveName} differs from its canonical source.`);
    process.exit(1);
  }
}

console.log("Failure Gate parity: canonical and generated mirror contain the required contract anchors.");
