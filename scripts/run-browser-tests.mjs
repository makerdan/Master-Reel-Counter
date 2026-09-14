#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { assertIsolatedReleaseDatabase } from "./release-schema-preflight.mjs";

const sourceDatabaseUrl = process.env.DATABASE_URL;
if (!sourceDatabaseUrl) {
  throw new Error(
    "Heavy browser validation requires DATABASE_URL as the publishing database target",
  );
}

function databaseUrlWithName(urlString, databaseName) {
  const url = new URL(urlString);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: resolve(import.meta.dirname, ".."),
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function createTemporaryDatabase() {
  const databaseName = `browser_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const adminUrl = databaseUrlWithName(sourceDatabaseUrl, "postgres");
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
  return {
    databaseName,
    databaseUrl: databaseUrlWithName(sourceDatabaseUrl, databaseName),
    adminUrl,
  };
}

async function dropTemporaryDatabase({ databaseName, adminUrl }) {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1
         AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
}

let temporaryDatabase;
let browserDatabaseUrl = process.env.RELEASE_SMOKE_DATABASE_URL;

try {
  if (browserDatabaseUrl) {
    assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: browserDatabaseUrl,
      publicationDatabaseUrl: sourceDatabaseUrl,
    });
  } else {
    temporaryDatabase = await createTemporaryDatabase();
    browserDatabaseUrl = temporaryDatabase.databaseUrl;
  }

  const setupStatus = run(
    process.execPath,
    [resolve(import.meta.dirname, "prepare-release-test-database.mjs")],
    {
      ...process.env,
      DATABASE_URL: sourceDatabaseUrl,
      RELEASE_SMOKE_DATABASE_URL: browserDatabaseUrl,
    },
  );
  if (setupStatus !== 0) process.exitCode = setupStatus;
  else {
    process.exitCode = run(
      process.execPath,
      [resolve(import.meta.dirname, "../node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)],
      {
        ...process.env,
        DATABASE_URL: browserDatabaseUrl,
        RELEASE_SMOKE_DATABASE_URL: browserDatabaseUrl,
        RELEASE_PUBLICATION_DATABASE_URL: sourceDatabaseUrl,
      },
    );
  }
} finally {
  if (temporaryDatabase) {
    await dropTemporaryDatabase(temporaryDatabase);
  }
}