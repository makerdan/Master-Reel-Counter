#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { validateProductionBaseUrl } from "./validate-production-base-url.mjs";

const root = resolve(import.meta.dirname, "..");
validateProductionBaseUrl();

const result = spawnSync(
  process.execPath,
  [
    resolve(root, "scripts/serial-lock.mjs"),
    "--resource",
    "managed-clerk-release",
    "--priority",
    "3",
    "--timeout-ms",
    "900000",
    "--",
    process.execPath,
    resolve(root, "node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    resolve(root, "playwright.release.config.ts"),
  ],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);