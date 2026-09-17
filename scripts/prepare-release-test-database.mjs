#!/usr/bin/env node

import { spawn } from "node:child_process";
import { Client } from "pg";
import {
  assertIsolatedReleaseDatabase,
  assertReleaseSchema,
  executeReviewedMigrations,
  ReleaseSchemaPreflightError,
} from "./release-schema-preflight.mjs";

const releaseDatabaseUrl = process.env.RELEASE_SMOKE_DATABASE_URL;
const publicationDatabaseUrl = process.env.DATABASE_URL;
const verifyPublicationSchema = process.env.RELEASE_PUBLICATION_SCHEMA_PREFLIGHT !== "0";

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
  throw new ReleaseSchemaPreflightError(
    "execution-failure",
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
  throw new ReleaseSchemaPreflightError(
    "invalid-migration",
    "Dedicated release smoke schema bootstrap is missing the reviewed Admin/User account role enum",
  );
}

const client = new Client({ connectionString: releaseDatabaseUrl });
try {
  await client.connect();
  let schema;
  try {
    await client.query(`
      ${bootstrap.stdout}
    `);
    await executeReviewedMigrations(client);
    schema = await assertReleaseSchema(client);
  } catch (error) {
    if (error instanceof ReleaseSchemaPreflightError) throw error;
    throw new ReleaseSchemaPreflightError(
      "execution-failure",
      `isolated release schema execution failed: ${
        error instanceof Error ? error.message : "unknown PostgreSQL error"
      }`,
      { cause: error },
    );
  }

  if (verifyPublicationSchema) {
    const publication = new Client({ connectionString: publicationDatabaseUrl });
    try {
      await publication.connect();
      await assertReleaseSchema(publication, {
        expectedSchema: schema,
        target: "publishing",
      });
    } catch (error) {
      if (error?.classification === "target-drift") throw error;
      throw new ReleaseSchemaPreflightError(
        "target-drift",
        `publishing schema could not be verified without mutation: ${
          error instanceof Error ? error.message : "unknown PostgreSQL error"
        }`,
        { cause: error },
      );
    } finally {
      await publication.end();
    }
  }

  console.log(
    verifyPublicationSchema
      ? `[release-schema] PASS — ${schema.databaseName}.${schema.schemaName} is initialized and matches the publishing schema`
      : `[release-schema] PASS — ${schema.databaseName}.${schema.schemaName} is initialized for isolated browser validation`,
  );
} finally {
  await client.end();
}