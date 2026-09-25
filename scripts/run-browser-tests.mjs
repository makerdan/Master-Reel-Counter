#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";
import { assertIsolatedReleaseDatabase } from "./release-schema-preflight.mjs";
import { formatBrowserProjectCoverage } from "./lib/browser-project-coverage.mjs";
import {
  runOwnedProcessGroup,
  signalExitCode,
} from "./lib/owned-process-group.mjs";

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

async function createTemporaryDatabase(databaseName, databaseUrl) {
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
    databaseUrl,
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
let mostRecentProcessGroup;
let validationStatus = 0;
let validationError;
let cleanupError;
let requestedSignal;
const cancellation = new AbortController();

function requestCancellation(signal) {
  if (requestedSignal) return;
  requestedSignal = signal;
  cancellation.abort(signal);
}

const onSigint = () => requestCancellation("SIGINT");
const onSigterm = () => requestCancellation("SIGTERM");
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);

async function run(command, args, env) {
  if (cancellation.signal.aborted) {
    return {
      status: signalExitCode(requestedSignal),
      groupGone: true,
      processGroupId: undefined,
    };
  }
  const result = await runOwnedProcessGroup(command, args, {
    cwd: resolve(import.meta.dirname, ".."),
    env,
    stdio: "inherit",
    signal: cancellation.signal,
  });
  mostRecentProcessGroup = result;
  return result;
}

try {
  if (!cancellation.signal.aborted) {
    console.log(formatBrowserProjectCoverage(process.env));
    if (browserDatabaseUrl) {
      assertIsolatedReleaseDatabase({
        releaseDatabaseUrl: browserDatabaseUrl,
        publicationDatabaseUrl: sourceDatabaseUrl,
      });
    } else {
      const databaseName = `browser_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
      browserDatabaseUrl = databaseUrlWithName(sourceDatabaseUrl, databaseName);
      assertIsolatedReleaseDatabase({
        releaseDatabaseUrl: browserDatabaseUrl,
        publicationDatabaseUrl: sourceDatabaseUrl,
      });
      temporaryDatabase = await createTemporaryDatabase(databaseName, browserDatabaseUrl);
      browserDatabaseUrl = temporaryDatabase.databaseUrl;
    }

    const setupResult = await run(
      process.execPath,
      [resolve(import.meta.dirname, "prepare-release-test-database.mjs")],
      {
        ...process.env,
        DATABASE_URL: sourceDatabaseUrl,
        RELEASE_SMOKE_DATABASE_URL: browserDatabaseUrl,
        RELEASE_PUBLICATION_SCHEMA_PREFLIGHT: "0",
      },
    );
    validationStatus = setupResult.status;
    if (validationStatus === 0 && !cancellation.signal.aborted) {
      const browserPort = process.env.PORT;
      const parsedBrowserPort =
        browserPort && /^\d+$/.test(browserPort) ? Number(browserPort) : Number.NaN;
      if (
        !Number.isInteger(parsedBrowserPort) ||
        parsedBrowserPort < 1 ||
        parsedBrowserPort > 65535
      ) {
        throw new Error("Browser validation requires PORT to be set to an integer from 1 to 65535.");
      }
      const browserResult = await run(
        process.execPath,
        [resolve(import.meta.dirname, "../node_modules/@playwright/test/cli.js"), "test", ...process.argv.slice(2)],
        {
          ...process.env,
          PORT: browserPort,
          TEST_BASE_URL:
            process.env.TEST_BASE_URL ?? `http://localhost:${parsedBrowserPort}`,
          DATABASE_URL: browserDatabaseUrl,
          RELEASE_SMOKE_DATABASE_URL: browserDatabaseUrl,
          RELEASE_PUBLICATION_DATABASE_URL: sourceDatabaseUrl,
        },
      );
      validationStatus = browserResult.status;
    }
  }
} catch (error) {
  validationError = error;
} finally {
  if (temporaryDatabase) {
    if (mostRecentProcessGroup && !mostRecentProcessGroup.groupGone) {
      cleanupError = new Error(
        `Refusing to drop ${temporaryDatabase.databaseName}: browser process group ${mostRecentProcessGroup.processGroupId} could not be confirmed stopped`,
      );
      if (mostRecentProcessGroup.terminationError) {
        cleanupError.cause = mostRecentProcessGroup.terminationError;
      }
    } else {
      try {
        await dropTemporaryDatabase(temporaryDatabase);
      } catch (error) {
        cleanupError = error;
      }
    }
  }
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
}

if (validationError) {
  console.error("Browser validation failed:", validationError);
  if (validationStatus === 0) validationStatus = 1;
}
if (cleanupError) {
  console.error("Browser validation cleanup failed:", cleanupError);
  if (validationStatus === 0) validationStatus = 1;
}
if (requestedSignal && validationStatus === 0) {
  validationStatus = signalExitCode(requestedSignal);
}
process.exitCode = validationStatus;
