#!/usr/bin/env node

import { spawn } from "node:child_process";
import { Client } from "pg";
import {
  assertIsolatedReleaseDatabase,
  assertReleaseSchema,
} from "./release-schema-preflight.mjs";

const releaseDatabaseUrl = process.env.RELEASE_SMOKE_DATABASE_URL;
const publicationDatabaseUrl = process.env.DATABASE_URL;

assertIsolatedReleaseDatabase({
  releaseDatabaseUrl,
  publicationDatabaseUrl,
});

function redact(output) {
  return output
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<database-url>")
    .slice(-4_000);
}

function exportSchema() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "drizzle-kit",
        "export",
        "--sql",
        "--dialect",
        "postgresql",
        "--schema",
        "./shared/schema.ts",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: releaseDatabaseUrl,
          NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

const bootstrap = await exportSchema();
if (bootstrap.code !== 0) {
  throw new Error(
    `Dedicated release smoke schema bootstrap failed (signal ${
      bootstrap.signal ?? "none"
    })\n${redact(bootstrap.stderr)}`,
  );
}
if (
  !/CREATE TYPE "public"\."account_role" AS ENUM\('Admin', 'User'\)/.test(
    bootstrap.stdout,
  )
) {
  throw new Error(
    "Dedicated release smoke schema bootstrap is missing the reviewed Admin/User account role enum",
  );
}

const client = new Client({ connectionString: releaseDatabaseUrl });
try {
  await client.connect();
  await client.query(`
    ${bootstrap.stdout}
  `);
  const schema = await assertReleaseSchema(client);
  console.log(
    `[release-schema] PASS — ${schema.databaseName}.${schema.schemaName} is initialized for release smoke`,
  );
} finally {
  await client.end();
}