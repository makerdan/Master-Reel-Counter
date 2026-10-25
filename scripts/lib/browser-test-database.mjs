import { Client } from "pg";

const DEFAULT_TIMEOUTS = {
  connectMs: 15_000,
  queryMs: 30_000,
  shutdownMs: 5_000,
};

function destroyTransport(client) {
  // pg has no public force-close API. A deadline must stop the socket as well
  // as the awaiting promise, or it can keep the validation process alive.
  client.connection?.stream?.destroy();
}

async function bounded(operation, timeoutMs, label, client) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Browser PostgreSQL ${label} exceeded ${timeoutMs}ms`));
          destroyTransport(client);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function endBrowserDatabaseClient(client, timeoutMs = DEFAULT_TIMEOUTS.shutdownMs) {
  try {
    await bounded(() => client.end(), timeoutMs, "client shutdown", client);
  } finally {
    destroyTransport(client);
  }
}

export async function withBrowserDatabaseClient(adminUrl, operation, {
  timeouts = {},
  createClient = (options) => new Client(options),
} = {}) {
  const limits = { ...DEFAULT_TIMEOUTS, ...timeouts };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Browser PostgreSQL deadlines must be positive integers");
    }
  }
  const client = createClient({
    connectionString: adminUrl,
    connectionTimeoutMillis: limits.connectMs,
    query_timeout: limits.queryMs,
    statement_timeout: limits.queryMs,
  });
  // Connection errors can arrive after a deadline has already rejected.
  client.on("error", () => {});
  let primaryError;
  let result;
  try {
    await bounded(() => client.connect(), limits.connectMs, "connect", client);
    result = await operation((label, ...args) =>
      bounded(() => client.query(...args), limits.queryMs, label, client));
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await endBrowserDatabaseClient(client, limits.shutdownMs);
    } catch (error) {
      if (!primaryError) primaryError = error;
      else {
        // Preserve the original error object, stack and code.
        primaryError.cleanupErrors = [...(primaryError.cleanupErrors ?? []), error];
      }
    }
  }
  if (primaryError) throw primaryError;
  return result;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function createTemporaryDatabase({ databaseName, adminUrl }, options) {
  await withBrowserDatabaseClient(adminUrl, (query) =>
    query("create database", `CREATE DATABASE ${quoteIdentifier(databaseName)}`), options);
}

export async function dropTemporaryDatabase({ databaseName, adminUrl }, options) {
  await withBrowserDatabaseClient(adminUrl, async (query) => {
    await query(
      "terminate database connections",
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1
         AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await query("drop database", `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }, options);
}
