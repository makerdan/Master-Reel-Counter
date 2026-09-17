#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { assertIsolatedReleaseDatabase } from "./release-schema-preflight.mjs";

function databaseUrlWithName(urlString, databaseName) {
  const url = new URL(urlString);
  url.pathname = `/${encodeURIComponent(databaseName)}`;
  return url.toString();
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function safeFailure(action, error) {
  const code = typeof error?.code === "string" ? ` (${error.code})` : "";
  return new Error(
    `Managed Clerk release could not ${action}${code}. Verify that DATABASE_URL is a PostgreSQL credential with permission to create and drop temporary databases. No publishing data was used.`,
  );
}

async function writeState(statePath, state) {
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(state));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, statePath);
    await chmod(statePath, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function createOwnedDatabase(
  publicationDatabaseUrl,
  statePath,
  { ClientClass = Client, uuid = randomUUID } = {},
) {
  const databaseName = `release_smoke_${process.pid}_${uuid().replaceAll("-", "")}`;
  const adminUrl = databaseUrlWithName(publicationDatabaseUrl, "postgres");
  const state = {
    owned: true,
    databaseName,
  };
  await writeState(statePath, state);
  const admin = new ClientClass({ connectionString: adminUrl });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } catch (error) {
    await dropOwnedDatabase(state, {
      ClientClass,
      publicationDatabaseUrl,
    }).catch(() => undefined);
    throw safeFailure("create its isolated temporary database", error);
  } finally {
    await admin.end().catch(() => undefined);
  }
  return state;
}

export async function dropOwnedDatabase(
  state,
  {
    ClientClass = Client,
    publicationDatabaseUrl = process.env.DATABASE_URL,
  } = {},
) {
  if (!state.owned) return;
  if (!publicationDatabaseUrl) {
    throw new Error("DATABASE_URL is required to remove an owned release smoke database");
  }
  const adminUrl = databaseUrlWithName(publicationDatabaseUrl, "postgres");
  const admin = new ClientClass({ connectionString: adminUrl });
  try {
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [state.databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(state.databaseName)}`);
  } catch (error) {
    throw safeFailure("remove its isolated temporary database", error);
  } finally {
    await admin.end().catch(() => undefined);
  }
}

export async function selectTarget(
  statePath,
  environment = process.env,
  dependencies = {},
) {
  const publicationDatabaseUrl = environment.DATABASE_URL;
  if (!publicationDatabaseUrl) {
    throw new Error(
      "Managed Clerk release requires DATABASE_URL as the publishing database target before compilation.",
    );
  }

  let state;
  if (environment.RELEASE_SMOKE_DATABASE_URL) {
    assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: environment.RELEASE_SMOKE_DATABASE_URL,
      publicationDatabaseUrl,
    });
    state = {
      owned: false,
    };
    await writeState(statePath, state);
  } else {
    state = await createOwnedDatabase(publicationDatabaseUrl, statePath, dependencies);
    assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: databaseUrlWithName(publicationDatabaseUrl, state.databaseName),
      publicationDatabaseUrl,
    });
  }

  console.log(
    state.owned
      ? `[release-database] Created run-owned temporary database ${state.databaseName}.`
      : "[release-database] Using explicitly configured isolated smoke database.",
  );
}

async function main() {
  const [action, statePath] = process.argv.slice(2);
  if (action === "select") {
    if (!statePath) throw new Error("Release database state path is required");
    await selectTarget(statePath);
  } else if (action === "url") {
    if (!statePath) throw new Error("Release database state path is required");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    const selectedUrl = state.owned
      ? databaseUrlWithName(process.env.DATABASE_URL, state.databaseName)
      : process.env.RELEASE_SMOKE_DATABASE_URL;
    if (!selectedUrl) throw new Error("Selected release smoke database URL is unavailable");
    process.stdout.write(selectedUrl);
  } else if (action === "cleanup") {
    if (!statePath) throw new Error("Release database state path is required");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    await dropOwnedDatabase(state);
    if (state.owned) {
      console.log(`[release-database] Removed run-owned temporary database ${state.databaseName}.`);
    }
  } else {
    throw new Error("Usage: release-smoke-database.mjs <select|url|cleanup> <state-path>");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Managed Clerk release database lifecycle failed.");
    process.exitCode = 1;
  });
}