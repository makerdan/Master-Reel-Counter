import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { accessSync, constants, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
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
const startupSmokePath = resolve(root, "scripts/startup-smoke.sh");

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

function systemCommand(command, path = process.env.PATH ?? "") {
  for (const directory of path.split(delimiter)) {
    // Empty PATH entries mean the current directory; do not import tools from the repository.
    if (!directory) continue;
    const candidate = resolve(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep looking through the active validation process's PATH.
    }
  }
  throw new Error(`startup smoke fixture prerequisite missing: ${command} is not executable on the validation PATH`);
}

async function createStartupSmokeFixture({
  databaseName = EXPECTED_DATABASE,
  serverAddress = "127.0.0.1",
  serverPort = 5432,
  psqlDelaySeconds = 0,
  healthStatus = 200,
  includePsql = true,
  includeCurl = true,
  toolPath = process.env.PATH ?? "",
  expectedServerAddress = "",
  expectedServerPort = "",
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "startup-smoke-test-"));
  try {
    const binDirectory = join(directory, "bin");
    await mkdir(binDirectory);
    await writeFile(join(directory, "fixture-server.mjs"), `
    import { appendFileSync, writeFileSync } from "node:fs";
    import { createServer } from "node:http";
    import { spawn } from "node:child_process";

    const port = Number(process.env.PORT);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    writeFileSync(process.env.SMOKE_CHILD_PID_FILE, String(child.pid));
    const server = createServer((request, response) => {
      if (request.url === "/api/healthz") {
        response.statusCode = ${healthStatus};
        response.end(${healthStatus} === 200 ? JSON.stringify({ ok: true }) : "not ready");
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    const stop = () => {
      server.close(() => {
        try { child.kill("SIGTERM"); } catch {}
        process.exit(0);
      });
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
    server.listen(port, "127.0.0.1", () => {
      appendFileSync(process.env.SMOKE_READY_MARKER, "ready\\n");
    });
    `);
    const psqlPath = join(binDirectory, "psql");
    if (includePsql) {
      await writeFile(psqlPath, `#!/bin/sh
if [ "${psqlDelaySeconds}" -gt 0 ]; then
  exec sleep "${psqlDelaySeconds}"
fi
printf '%b\\n' '${databaseName}\\t16.10\\t160000\\t${serverAddress}\\t${serverPort}'
`);
      await chmod(psqlPath, 0o755);
    }
    await writeFile(join(directory, "child-pid"), "");
    await writeFile(join(directory, "ready"), "");
    await symlink(process.execPath, join(binDirectory, "node"));
    for (const command of ["cat", "env", "grep", "mktemp", "rm", "sleep", "timeout", "setsid"]) {
      await symlink(systemCommand(command, toolPath), join(binDirectory, command));
    }
    if (includeCurl) {
      await symlink(systemCommand("curl", toolPath), join(binDirectory, "curl"));
    }

    return {
      directory,
      binDirectory,
      entrypoint: join(directory, "fixture-server.mjs"),
      childPidFile: join(directory, "child-pid"),
      readyMarker: join(directory, "ready"),
      env: {
        ...process.env,
        PATH: binDirectory,
        DATABASE_URL: "postgresql://smoke-user:smoke-password@127.0.0.1:5432/smoke-target",
        SMOKE_EXPECTED_DATABASE: EXPECTED_DATABASE,
        SMOKE_EXPECTED_SERVER_ADDRESS: expectedServerAddress,
        SMOKE_EXPECTED_SERVER_PORT: String(expectedServerPort),
        SMOKE_SERVER_ENTRYPOINT: join(directory, "fixture-server.mjs"),
        SMOKE_CHILD_PID_FILE: join(directory, "child-pid"),
        SMOKE_READY_MARKER: join(directory, "ready"),
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function waitForFile(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(path, "utf8");
      if (content.trim()) return;
    } catch {
      // The fixture may not have created the marker yet.
    }
    await sleep(50);
  }
  throw new Error(`fixture did not create ${path} within ${timeoutMs}ms`);
}

async function processGone(pid) {
  if (!pid) return true;
  try {
    process.kill(Number(pid), 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

async function waitForProcessGone(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await processGone(pid)) return true;
    await sleep(50);
  }
  return processGone(pid);
}

async function assertPortFree(port) {
  const error = await new Promise((resolveProbe) => {
    const socket = createServer();
    socket.once("error", resolveProbe);
    socket.listen(port, "127.0.0.1", () => {
      socket.close(() => resolveProbe(null));
    });
  });
  assert.equal(
    error,
    null,
    `port ${port} remained occupied after startup-smoke cleanup`,
  );
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

test("startup smoke rejects invalid timeout configuration before checking tools", async () => {
  const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
    cwd: root,
    env: {
      ...process.env,
      SMOKE_TIMEOUT: "nope",
    },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /SMOKE_TIMEOUT must be a positive integer/);
});

test("startup smoke fixture uses the active PATH and reports a missing real timeout prerequisite", async () => {
  const fixture = await createStartupSmokeFixture();
  try {
    assert.equal(await readlink(join(fixture.binDirectory, "timeout")), systemCommand("timeout"));
    const result = await runCommand(join(fixture.binDirectory, "timeout"), ["--version"], {
      env: fixture.env,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /coreutils/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }

  const restrictedPath = await mkdtemp(join(tmpdir(), "startup-smoke-tools-"));
  try {
    for (const command of ["cat", "env", "grep", "mktemp", "rm", "sleep", "setsid", "curl"]) {
      await symlink(systemCommand(command), join(restrictedPath, command));
    }
    await assert.rejects(
      createStartupSmokeFixture({ toolPath: restrictedPath }),
      /startup smoke fixture prerequisite missing: timeout is not executable on the validation PATH/,
    );
  } finally {
    await rm(restrictedPath, { recursive: true, force: true });
  }
});

test("startup smoke reports a missing curl prerequisite immediately", async () => {
  const fixture = await createStartupSmokeFixture({ includeCurl: false });
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      cwd: root,
      env: fixture.env,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /curl is required for startup smoke/);
    assert.doesNotMatch(result.stderr, /did not bind|PostgreSQL readiness timeout/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("startup smoke reports a missing psql prerequisite immediately", async () => {
  const fixture = await createStartupSmokeFixture({ includePsql: false });
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      cwd: root,
      env: fixture.env,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /psql is required for startup smoke/);
    assert.doesNotMatch(result.stderr, /unable to query the configured database|Starting server on port/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("startup smoke bounds a stalled PostgreSQL preflight", async () => {
  const fixture = await createStartupSmokeFixture({ psqlDelaySeconds: 30 });
  const startedAt = Date.now();
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      cwd: root,
      env: {
        ...fixture.env,
        SMOKE_DB_TIMEOUT: "1",
      },
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /PostgreSQL readiness timeout after 1s/);
    assert.ok(Date.now() - startedAt < 5_000, "stalled preflight exceeded its deadline");
    assert.equal(await readFile(fixture.childPidFile, "utf8"), "");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("startup smoke rejects an unexpected database identity before launching", async () => {
  const fixture = await createStartupSmokeFixture({ databaseName: "wrong-target" });
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      cwd: root,
      env: fixture.env,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /PostgreSQL database identity mismatch/);
    assert.match(result.stderr, /Expected database: master_reel_counter_test/);
    assert.doesNotMatch(result.stdout, /Starting server on port/);
    assert.equal(await readFile(fixture.childPidFile, "utf8"), "");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("startup smoke rejects unexpected PostgreSQL address and port identities before launching", async (t) => {
  for (const scenario of [
    {
      name: "server address",
      fixtureOptions: {
        serverAddress: "10.20.30.40",
        expectedServerAddress: "127.0.0.1",
        expectedServerPort: "5432",
      },
      diagnostic: /PostgreSQL server endpoint identity mismatch/,
    },
    {
      name: "server port",
      fixtureOptions: {
        serverPort: 6432,
        expectedServerAddress: "127.0.0.1",
        expectedServerPort: "5432",
      },
      diagnostic: /PostgreSQL server endpoint port mismatch/,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const fixture = await createStartupSmokeFixture(scenario.fixtureOptions);
      try {
        const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
          cwd: root,
          env: fixture.env,
        });
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, scenario.diagnostic);
        assert.doesNotMatch(result.stdout, /Starting server on port/);
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("startup smoke removes the complete server group and listener after success", async () => {
  const fixture = await createStartupSmokeFixture();
  const port = await findAvailablePort();
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      cwd: root,
      env: {
        ...fixture.env,
        SMOKE_PORT: String(port),
        SMOKE_TIMEOUT: "5",
      },
    });
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS — server started cleanly/);
    const childPid = await readFile(fixture.childPidFile, "utf8");
    assert.equal(await waitForProcessGone(childPid.trim()), true);
    await assertPortFree(port);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("startup smoke removes the complete server group after readiness failure", async () => {
  const fixture = await createStartupSmokeFixture({ healthStatus: 503 });
  const port = await findAvailablePort();
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      cwd: root,
      env: {
        ...fixture.env,
        SMOKE_PORT: String(port),
        SMOKE_TIMEOUT: "1",
      },
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /server did not bind to port/);
    const childPid = await readFile(fixture.childPidFile, "utf8");
    assert.equal(await waitForProcessGone(childPid.trim()), true);
    await assertPortFree(port);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("startup smoke cleans its process group and port when interrupted", async () => {
  const fixture = await createStartupSmokeFixture({ healthStatus: 503 });
  const port = await findAvailablePort();
  const smoke = spawn(systemCommand("bash"), [startupSmokePath], {
    cwd: root,
    env: {
      ...fixture.env,
      SMOKE_PORT: String(port),
      SMOKE_TIMEOUT: "30",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  smoke.stdout.on("data", (chunk) => { output += chunk; });
  smoke.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await waitForFile(fixture.readyMarker);
    const childPid = (await readFile(fixture.childPidFile, "utf8")).trim();
    const interruptedAt = Date.now();
    smoke.kill("SIGINT");
    const [code, signal] = await once(smoke, "close");
    assert.notEqual(code, 0, `${output}\ninterrupted smoke unexpectedly passed`);
    assert.equal(signal, null);
    assert.ok(Date.now() - interruptedAt < 5_000, "interrupted smoke did not stop within its cleanup deadline");
    assert.equal(await waitForProcessGone(childPid), true);
    await assertPortFree(port);
  } finally {
    if (smoke.exitCode === null) smoke.kill("SIGKILL");
    await rm(fixture.directory, { recursive: true, force: true });
  }
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
      CLERK_SECRET_KEY: "sk_test_github_actions_validation_not_production",
      REPL_ID: "github-actions-validation",
      AI_INTEGRATIONS_OPENAI_API_KEY: "test-only-unavailable",
      AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:9",
    };

    const schema = await runCommand(
      process.execPath,
      [resolve(root, "node_modules/drizzle-kit/bin.cjs"), "push", "--force"],
      {
        cwd: root,
        env: bootstrapEnv,
      },
    );
    assert.equal(
      schema.code,
      0,
      `schema bootstrap failed (signal ${schema.signal ?? "none"})\n${redact(`${schema.stdout}\n${schema.stderr}`)}`,
    );

    const ownerPool = new Pool({ connectionString: disposableUrl, max: 1 });
    try {
      await ownerPool.query(`
        INSERT INTO users (id, email, first_name, approved, rejected, role)
        VALUES ($1, $2, 'GitHub Actions Owner', true, false, 'Admin')
        ON CONFLICT (id) DO UPDATE
          SET approved = true, rejected = false, role = 'Admin';
      `, [TEST_OWNER_ID, TEST_OWNER_EMAIL]);
    } finally {
      await ownerPool.end();
    }

    const port = await findAvailablePort();
    server = spawn(
      process.execPath,
      [resolve(root, "node_modules/tsx/dist/cli.mjs"), "server/index.ts"],
      {
        cwd: root,
        detached: true,
        env: { ...bootstrapEnv, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout.on("data", (chunk) => { serverOutput += chunk; });
    server.stderr.on("data", (chunk) => { serverOutput += chunk; });

    const healthUrl = await waitForHealth(server, port, () => serverOutput);
    const baseUrl = new URL(healthUrl);
    baseUrl.pathname = "/";

    const healthResponse = await fetch(new URL("/api/healthz", baseUrl));
    assert.equal(healthResponse.status, 200);
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