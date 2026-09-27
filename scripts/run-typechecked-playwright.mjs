#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const typecheckStatus = run("npm", ["run", "typecheck"]);
if (typecheckStatus !== 0) process.exit(typecheckStatus);

const playwrightCli = resolve(root, "node_modules/@playwright/test/cli.js");
process.exit(run(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)]));