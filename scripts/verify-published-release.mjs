#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  FORBIDDEN_PUBLISHED_SMOKE_INPUTS,
  validatePublishedSmokeConfiguration,
} from "./validate-published-smoke-config.mjs";

const root = resolve(import.meta.dirname, "..");
const { publishedTarget, expectedDeploymentId } =
  validatePublishedSmokeConfiguration(process.env);

async function verifyPublishedDeploymentIdentity() {
  const healthUrl = new URL("/api/healthz", publishedTarget.origin);
  let response;
  try {
    response = await fetch(healthUrl, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(
      `Published deployment health check failed before browser verification: ${
        error instanceof Error ? error.message : "request failed"
      }`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Published deployment health check returned HTTP ${response.status}; refusing to verify an unknown deployment.`,
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "Published deployment health check returned invalid JSON; refusing to verify an unknown deployment.",
    );
  }

  if (body?.ok !== true || body?.deploymentId !== expectedDeploymentId) {
    throw new Error(
      "Published deployment identity is absent or does not match the intended deployment.",
    );
  }
}

await verifyPublishedDeploymentIdentity();

const publishedReadOnlyEnvironment = { ...process.env };
for (const name of FORBIDDEN_PUBLISHED_SMOKE_INPUTS) {
  delete publishedReadOnlyEnvironment[name];
}
publishedReadOnlyEnvironment.RELEASE_SMOKE_PUBLISHED_READ_ONLY = "1";
publishedReadOnlyEnvironment.RELEASE_PUBLISHED_SMOKE_MODE = "read-only";
publishedReadOnlyEnvironment.RELEASE_PUBLISHED_SMOKE_TARGET = publishedTarget.origin;

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