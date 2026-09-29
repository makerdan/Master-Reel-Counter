#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { execFileSync } from "child_process";
import { withInputWriterBoundary } from "./lib/failure-gate/input-writer-boundary.mjs";
const outDir = resolve("artifacts/bathyscan/public");
const staging = mkdtempSync(resolve(tmpdir(), "failure-gate-package-"));
const zipPath = resolve(outDir, "failure-gate-skill.zip");
const packageDate = new Date("1980-01-01T00:00:00Z");
const packageFiles = [
  ["README.md", ".agents/skills/failure-gate-v4/README.md"],
  ["SKILL.md", ".agents/skills/failure-gate-v4/SKILL.md"],
  ["reference/acceptance.md", ".agents/skills/failure-gate-v4/reference/acceptance.md"],
  ["reference/implementation.md", ".agents/skills/failure-gate-v4/reference/implementation.md"],
];
mkdirSync(outDir, { recursive: true });
try {
  for (const [name, source] of packageFiles) {
    const target = resolve(staging, name);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, readFileSync(source));
    utimesSync(target, packageDate, packageDate);
  }
  withInputWriterBoundary(process.cwd(), () => {
    rmSync(zipPath, { force: true });
    execFileSync("zip", [
      "-q",
      "-X",
      zipPath,
      ...packageFiles.map(([name]) => name),
    ], { cwd: staging });
  });
} finally {
  rmSync(staging, { recursive: true, force: true });
}
console.log(zipPath);