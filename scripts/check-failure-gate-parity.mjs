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
const canonicalText = readFileSync(canonical, "utf8").replace(/\r\n/g, "\n");
const mirrorText = readFileSync(mirror, "utf8").replace(/\r\n/g, "\n");
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
const publishedSkill = execFileSync("unzip", ["-p", published, "SKILL.md"], { encoding: "utf8" });
if (publishedSkill.trim() !== canonicalText.trim()) {
  console.error("Failure Gate parity: published SKILL.md differs from the canonical source.");
  process.exit(1);
}
console.log("Failure Gate parity: canonical and generated mirror contain the required contract anchors.");