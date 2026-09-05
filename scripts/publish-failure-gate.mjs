#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";
const outDir = resolve("artifacts/bathyscan/public");
const staging = resolve("/tmp/failure-gate-package");
const zipPath = resolve(outDir, "failure-gate-skill.zip");
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(staging, "SKILL.md"), readFileSync(".agents/skills/failure-gate/SKILL.md"));
writeFileSync(resolve(staging, "validation-tiers.md"), readFileSync(".agents/skills/validation-tiers/SKILL.md"));
writeFileSync(resolve(staging, "tiers.json"), readFileSync(".agents/skills/validation-tiers/tiers.json"));
rmSync(zipPath, { force: true });
execFileSync("zip", ["-q", "-j", zipPath, resolve(staging, "SKILL.md"), resolve(staging, "validation-tiers.md"), resolve(staging, "tiers.json")]);
console.log(zipPath);