#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";
const outDir = resolve("artifacts/bathyscan/public");
const staging = resolve("/tmp/failure-gate-package");
const zipPath = resolve(outDir, "failure-gate-skill.zip");
const packageDate = new Date("1980-01-01T00:00:00Z");
const packageFiles = [
  ["SKILL.md", ".agents/skills/failure-gate/SKILL.md"],
  ["validation-tiers.md", ".agents/skills/validation-tiers/SKILL.md"],
  ["tiers.json", ".agents/skills/validation-tiers/tiers.json"],
];
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
mkdirSync(outDir, { recursive: true });
for (const [name, source] of packageFiles) {
  const target = resolve(staging, name);
  writeFileSync(target, readFileSync(source));
  utimesSync(target, packageDate, packageDate);
}
rmSync(zipPath, { force: true });
execFileSync("zip", [
  "-q",
  "-X",
  "-j",
  zipPath,
  ...packageFiles.map(([name]) => resolve(staging, name)),
]);
console.log(zipPath);