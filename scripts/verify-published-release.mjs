#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { validateProductionBaseUrl } from "./validate-production-base-url.mjs";

const root = resolve(import.meta.dirname, "..");
validateProductionBaseUrl();

const publishedReadOnlyEnvironment = { ...process.env };
for (const name of [
  "DATABASE_URL",
  "RELEASE_SMOKE_DATABASE_URL",
  "RELEASE_PUBLICATION_DATABASE_URL",
  "RELEASE_SMOKE_INTERNAL_CANDIDATE",
  "RELEASE_SMOKE_CANDIDATE_HOST",
  "RELEASE_SMOKE_CANDIDATE_TLS_PORT",
  "RELEASE_SMOKE_CANDIDATE_APP_ORIGIN",
  "RELEASE_SMOKE_CANDIDATE_ID",
  "CLERK_SECRET_KEY",
]) {
  delete publishedReadOnlyEnvironment[name];
}
publishedReadOnlyEnvironment.RELEASE_SMOKE_PUBLISHED_READ_ONLY = "1";

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
    env: publishedReadOnlyEnvironment,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);