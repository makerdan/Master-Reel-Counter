import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";
import test from "node:test";
import {
  postgresMajorVersion,
  SUPPORTED_POSTGRES_MAJOR_VERSION,
} from "../lib/github-actions-validation-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const EXPECTED_DATABASE = "master_reel_counter_test";
const TEST_OWNER_ID = "github-actions-owner";
const TEST_OWNER_EMAIL = "github-actions-owner@example.invalid";
const TEST_PASSWORD = "github-actions-tester-password";

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrlWithName(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.hash = "";
  return url.toString();
}

function redact(output) {
  return output
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "<database-url>")
    .slice(-4_000);
}

async function runCommand(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal }));
  });
  return { ...result, stdout, stderr };
}

async function findAvailablePort() {
  const probe = createServer();
  await new Promise((resolveProbe, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolveProbe);
  });
  const address = probe.address();
  assert.ok(address && typeof address === "object", "port probe did not return an address");
  const port = address.port;
  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  await Promise.race([
    once(child, "close"),
    sleep(5_000),
  ]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await once(child, "close").catch(() => {});
  }
}

async function waitForHealth(child, port, output) {
  const url = `http://127.0.0.1:${port}/api/healthz`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `application exited before health check (code ${child.exitCode})\n${redact(output())}`,
      );
    }
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    } catch {
      // The server can be compiling or waiting for its database pool.
      await sleep(250);
      continue;
    }
    if (response.ok) {
      const body = await response.json();
      assert.deepEqual(body, { ok: true });
      return url;
    }
    await sleep(250);
  }
  throw new Error(`application did not become healthy within 60 seconds\n${redact(output())}`);
}

test("PostgreSQL contract parses server version numbers by major version", () => {
  assert.equal(postgresMajorVersion("160004"), SUPPORTED_POSTGRES_MAJOR_VERSION);
  assert.equal(postgresMajorVersion("170000"), 17);
  assert.throws(
    () => postgresMajorVersion("not-a-version"),
    /invalid PostgreSQL server_version_num/,
  );
});

test("GitHub Actions boots the app against a blank disposable database", async (t) => {
  if (!process.env.CI) {
    t.skip("the disposable-database guard runs only in the isolated GitHub Actions PostgreSQL service");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required when running the CI empty-database guard");
  }

  const sourceUrl = new URL(databaseUrl);
  assert.equal(
    sourceUrl.hostname,
    "localhost",
    "refusing to run the disposable-database guard against a non-local database",
  );
  assert.equal(
    sourceUrl.port || "5432",
    "5432",
    "refusing to run the disposable-database guard against an unexpected PostgreSQL port",
  );
  assert.equal(
    decodeURIComponent(sourceUrl.username),
    "postgres",
    "refusing to run the disposable-database guard with an unexpected PostgreSQL user",
  );
  assert.equal(
    sourceUrl.pathname.replace(/^\/+/, ""),
    EXPECTED_DATABASE,
    "refusing to run the disposable-database guard against an unexpected database",
  );

  const disposableDatabase = `ci_empty_db_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({
    connectionString: databaseUrlWithName(databaseUrl, "postgres"),
    max: 1,
  });
  let server;
  let serverOutput = "";
  let primaryError;
  const cleanupErrors = [];

  try {
    const versionResult = await adminPool.query(
      "SELECT current_setting('server_version') AS version, current_setting('server_version_num') AS version_num",
    );
    const serverVersion = versionResult.rows[0]?.version;
    const serverVersionNum = versionResult.rows[0]?.version_num;
    assert.equal(
      postgresMajorVersion(serverVersionNum),
      SUPPORTED_POSTGRES_MAJOR_VERSION,
      `PostgreSQL major version drift detected: the CI service reports ${serverVersion} (${serverVersionNum}), but the validation contract supports PostgreSQL ${SUPPORTED_POSTGRES_MAJOR_VERSION}. Update scripts/lib/github-actions-validation-contract.mjs and the workflow image together only when intentionally upgrading the test harness.`,
    );

    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(disposableDatabase)}`);

    const disposableUrl = databaseUrlWithName(databaseUrl, disposableDatabase);
    const bootstrapEnv = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      CI: "true",
      NODE_ENV: "test",
      DATABASE_URL: disposableUrl,
      SESSION_SECRET: "github-actions-test-session-secret-not-production",
      TEST_TESTER_PASSWORD: TEST_PASSWORD,
      REPL_ID: "github-actions-validation",
      AI_INTEGRATIONS_OPENAI_API_KEY: "test-only-unavailable",
      AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:9",
    };

    const schema = await runCommand("npx", ["drizzle-kit", "push", "--force"], {
      cwd: root,
      env: bootstrapEnv,
    });
    assert.equal(
      schema.code,
      0,
      `schema bootstrap failed (signal ${schema.signal ?? "none"})\n${redact(`${schema.stdout}\n${schema.stderr}`)}`,
    );

    const ownerPool = new Pool({ connectionString: disposableUrl, max: 1 });
    try {
      await ownerPool.query(`
        INSERT INTO users (id, email, first_name, approved, rejected, is_tester)
        VALUES ($1, $2, 'GitHub Actions Owner', true, false, false)
        ON CONFLICT (id) DO UPDATE
          SET approved = true, rejected = false, is_tester = false;
      `, [TEST_OWNER_ID, TEST_OWNER_EMAIL]);
    } finally {
      await ownerPool.end();
    }

    const port = await findAvailablePort();
    server = spawn("npx", ["tsx", "server/index.ts"], {
      cwd: root,
      detached: true,
      env: { ...bootstrapEnv, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => { serverOutput += chunk; });
    server.stderr.on("data", (chunk) => { serverOutput += chunk; });

    const healthUrl = await waitForHealth(server, port, () => serverOutput);
    const baseUrl = new URL(healthUrl);
    baseUrl.pathname = "/";

    const seedResponse = await fetch(new URL("/api/__test__/seed-tester-password", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    assert.equal(seedResponse.status, 200, `test-password seeding failed: ${await seedResponse.text()}`);
    const seedBody = await seedResponse.json();
    assert.deepEqual(seedBody, { ok: true, ownerUserId: TEST_OWNER_ID });

    const loginResponse = await fetch(new URL("/api/__test__/owner-login", baseUrl), {
      method: "POST",
    });
    assert.equal(loginResponse.status, 200, `test-owner login failed: ${await loginResponse.text()}`);
    const loginBody = await loginResponse.json();
    assert.deepEqual(loginBody, { ok: true, userId: TEST_OWNER_ID });
    assert.match(loginResponse.headers.get("set-cookie") ?? "", /connect\.sid=/);
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await stopProcess(server);
    } catch (error) {
      cleanupErrors.push(`failed to stop application: ${error.message}`);
    }

    try {
      await adminPool.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [disposableDatabase],
      );
    } catch (error) {
      cleanupErrors.push(`failed to terminate disposable-database connections: ${error.message}`);
    }

    try {
      await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(disposableDatabase)}`);
    } catch (error) {
      cleanupErrors.push(`failed to drop disposable database: ${error.message}`);
    }

    try {
      await adminPool.end();
    } catch (error) {
      cleanupErrors.push(`failed to close PostgreSQL admin pool: ${error.message}`);
    }
  }

  if (primaryError) {
    if (cleanupErrors.length > 0) {
      primaryError.message += `\nCleanup errors:\n${cleanupErrors.join("\n")}`;
    }
    throw primaryError;
  }
  assert.deepEqual(cleanupErrors, [], cleanupErrors.join("\n"));
});