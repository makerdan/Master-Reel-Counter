#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  validateProductionBaseUrl,
  validateProductionDeploymentId,
} from "./validate-production-base-url.mjs";

const root = resolve(import.meta.dirname, "..");
const publishedTarget = validateProductionBaseUrl();
const expectedDeploymentId = validateProductionDeploymentId();

const publishedSmokeTarget = process.env.RELEASE_PUBLISHED_SMOKE_TARGET?.trim();
if (!publishedSmokeTarget) {
  throw new Error(
    "RELEASE_PUBLISHED_SMOKE_TARGET is required and must pair the published URL with the read-only smoke boundary.",
  );
}
const normalizedSmokeTarget = validateProductionBaseUrl(publishedSmokeTarget);
if (normalizedSmokeTarget.origin !== publishedTarget.origin) {
  throw new Error(
    "RELEASE_PUBLISHED_SMOKE_TARGET must match PRODUCTION_BASE_URL exactly; refusing an ambiguous published smoke pairing.",
  );
}
if (process.env.RELEASE_PUBLISHED_SMOKE_MODE !== "read-only") {
  throw new Error(
    "RELEASE_PUBLISHED_SMOKE_MODE must be read-only; published verification cannot use a fixture-writing smoke mode.",
  );
}

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
const forbiddenPublishedInputs = [
  "DATABASE_URL",
  "RELEASE_SMOKE_DATABASE_URL",
  "RELEASE_PUBLICATION_DATABASE_URL",
  "RELEASE_PUBLISHED_SMOKE_DATABASE_URL",
  "RELEASE_SMOKE_INTERNAL_CANDIDATE",
  "RELEASE_SMOKE_CANDIDATE_HOST",
  "RELEASE_SMOKE_CANDIDATE_TLS_PORT",
  "RELEASE_SMOKE_CANDIDATE_APP_ORIGIN",
  "RELEASE_SMOKE_CANDIDATE_ID",
  "CLERK_SECRET_KEY",
];
const suppliedForbiddenInputs = forbiddenPublishedInputs.filter(
  (name) => process.env[name],
);
if (suppliedForbiddenInputs.length > 0) {
  throw new Error(
    `Published read-only verification refuses database or Clerk-secret inputs: ${suppliedForbiddenInputs.join(", ")}`,
  );
}
for (const name of forbiddenPublishedInputs) {
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