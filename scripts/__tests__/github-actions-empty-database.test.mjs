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
import { runOwnedProcessGroup } from "../lib/owned-process-group.mjs";
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

async function runCommand(command, args, { signal, timeoutMs = 60_000, ...options } = {}) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, "command timeoutMs must be a positive integer");
  const cancellation = new AbortController();
  let timedOut = false;
  let stdout = "";
  let stderr = "";
  const onAbort = () => cancellation.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => {
    if (cancellation.signal.aborted) return;
    timedOut = true;
    cancellation.abort();
  }, timeoutMs);
  try {
    const owned = await runOwnedProcessGroup(command, args, {
      ...options,
      signal: cancellation.signal,
      terminationGraceMs: 2_000,
      terminationWaitMs: 2_000,
      onOutput: (chunk, stream) => {
        if (stream === "stdout") stdout += chunk;
        else stderr += chunk;
      },
    });
    const result = { code: owned.status, signal: owned.childSignal, stdout, stderr };
    if (cancellation.signal.aborted || !owned.groupGone || owned.terminationError) {
      const error = new Error(
        `${timedOut ? `command timed out after ${timeoutMs}ms` : cancellation.signal.aborted ? "command cancelled" : "command cleanup failed"}: ${command}\n${redact(`${stdout}\n${stderr}`)}`,
      );
      error.name = timedOut ? "CommandTimeoutError" : cancellation.signal.aborted ? "AbortError" : "CommandCleanupError";
      error.code = timedOut ? "COMMAND_TIMEOUT" : cancellation.signal.aborted ? "ABORT_ERR" : "COMMAND_CLEANUP_FAILED";
      error.result = result;
      error.groupGone = owned.groupGone;
      error.cause = owned.terminationError;
      throw error;
    }
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
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

async function processRunning(pid) {
  if (!pid) return false;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const closingParen = stat.lastIndexOf(")");
    if (closingParen < 0) return false;
    const state = stat.slice(closingParen + 1).trim().split(/\s+/)[0];
    return state !== "Z" && state !== "X";
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function waitForProcessStopped(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await processRunning(pid))) return true;
    await sleep(50);
  }
  return !(await processRunning(pid));
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

// Always await owned-tree cleanup before deleting fixture files. Killing only
// bash bypasses its EXIT trap and can strand the server's separate setsid group.
async function withInterruptibleSmoke(t, fixture, port, exercise) {
  const controller = new AbortController();
  let output = "";
  const finished = runOwnedProcessGroup(systemCommand("bash"), [startupSmokePath], {
    cwd: root,
    env: {
      ...fixture.env,
      SMOKE_PORT: String(port),
      SMOKE_TIMEOUT: "30",
    },
    signal: controller.signal,
    terminationGraceMs: 2_000,
    terminationWaitMs: 2_000,
    onOutput: (chunk) => { output += chunk; },
  });
  // Attach immediately, including when readiness fails before we await it.
  finished.catch(() => {});
  const cleanup = async () => {
    controller.abort("SIGTERM");
    const result = await finished;
    assert.equal(result.groupGone, true, `smoke process tree survived cleanup\n${output}`);
    assert.equal(result.terminationError, undefined);
    await assertPortFree(port);
  };
  t.after(cleanup);
  try {
    return await exercise({
      interrupt: () => controller.abort("SIGINT"),
      finished,
      output: () => output,
    });
  } finally {
    await cleanup();
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

test("command supervision preserves normal exit codes and separate diagnostics", async (t) => {
  for (const code of [0, 7]) {
    const result = await runCommand(process.execPath, ["-e", `
      console.log("ordinary stdout");
      console.error("ordinary stderr");
      process.exitCode = ${code};
    `], { signal: t.signal });
    assert.equal(result.code, code);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "ordinary stdout\n");
    assert.equal(result.stderr, "ordinary stderr\n");
  }
  await assert.rejects(
    runCommand("/nonexistent/smoke-command", [], { signal: t.signal }),
    { code: "ENOENT" },
  );
});

test("hung commands stop their owned tree on deadline and test cancellation without killing unrelated processes", { timeout: 30_000 }, async (t) => {
  for (const mode of ["deadline", "test cancellation"]) {
    await t.test(mode, async (t) => {
      const directory = await mkdtemp(join(tmpdir(), "hung-smoke-command-"));
      const pidFile = join(directory, "pids.json");
      const unrelatedPidFile = join(directory, "unrelated.pid");
      const harnessPath = join(directory, "command-harness.test.mjs");
      const unrelatedCancellation = new AbortController();
      // A real unrelated OS process, not just a listener in this test process.
      const unrelated = runOwnedProcessGroup(process.execPath, ["-e", `
        require("node:fs").writeFileSync(${JSON.stringify(unrelatedPidFile)}, String(process.pid));
        setInterval(() => {}, 1_000);
      `], {
        signal: unrelatedCancellation.signal,
        stdio: "ignore",
        terminationGraceMs: 2_000,
        terminationWaitMs: 2_000,
      });
      unrelated.catch(() => {});
      try {
        await waitForFile(unrelatedPidFile);
        const unrelatedPid = (await readFile(unrelatedPidFile, "utf8")).trim();
        const fixturePath = resolve(root, "scripts/__tests__/fixtures/hung-smoke-command.mjs");
        // A cancelled Node test is expected to fail, so isolate its runner.
        await writeFile(harnessPath, `
import assert from "node:assert/strict";
import test from "node:test";
import { runOwnedProcessGroup } from ${JSON.stringify(new URL("../lib/owned-process-group.mjs", import.meta.url).href)};
${redact.toString()}
${runCommand.toString()}
test("hung command ${mode}", { timeout: ${mode === "deadline" ? 8_000 : 1_000} }, async (t) => {
  try {
    await runCommand(process.execPath, [${JSON.stringify(fixturePath)}, ${JSON.stringify(pidFile)}], {
      signal: t.signal,
      timeoutMs: ${mode === "deadline" ? 1_000 : 30_000},
    });
    assert.fail("hung command unexpectedly completed");
  } catch (error) {
    assert.equal(error.code, ${JSON.stringify(mode === "deadline" ? "COMMAND_TIMEOUT" : "ABORT_ERR")});
    assert.equal(error.name, ${JSON.stringify(mode === "deadline" ? "CommandTimeoutError" : "AbortError")});
    assert.equal(error.groupGone, true);
    assert.equal(error.result.stdout, "hung-command stdout ready\\n");
    assert.equal(error.result.stderr, "hung-command stderr ready\\n");
    assert.match(error.message, /${mode === "deadline" ? "timed out after 1000ms" : "command cancelled"}/);
    console.log("COMMAND_GUARD_VERIFIED", error.code);
  }
});
`);
        const harnessEnv = { ...process.env };
        delete harnessEnv.NODE_TEST_CONTEXT;
        const startedAt = Date.now();
        const result = await runCommand(process.execPath, ["--test", harnessPath], {
          env: harnessEnv,
          signal: t.signal,
          timeoutMs: 10_000,
        });
        const output = `${result.stdout}\n${result.stderr}`;
        assert.ok(Date.now() - startedAt < 8_000, `hung command exceeded its cleanup bound\n${output}`);
        assert.match(output, new RegExp(`COMMAND_GUARD_VERIFIED ${mode === "deadline" ? "COMMAND_TIMEOUT" : "ABORT_ERR"}`));
        if (mode === "deadline") assert.equal(result.code, 0, output);
        else {
          assert.notEqual(result.code, 0, output);
          assert.match(output, /testTimeoutFailure/);
        }
        const pids = JSON.parse(await readFile(pidFile, "utf8"));
        assert.equal(await waitForProcessGone(pids.parent), true, "hung parent survived");
        assert.equal(await waitForProcessGone(pids.child), true, "hung child survived");
        assert.equal(await processGone(unrelatedPid), false, "unrelated process was killed");
      } finally {
        unrelatedCancellation.abort();
        const cleanup = await unrelated;
        assert.equal(cleanup.groupGone, true, "unrelated fixture cleanup failed");
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});

for (const { name, ignoreTerm } of [
  { name: "an exited launcher with a surviving child", ignoreTerm: false },
  { name: "a TERM-resistant child", ignoreTerm: true },
]) {
  test(`owned cleanup stops ${name} before the port is reused`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "empty-database-process-"));
    const launcherPath = join(directory, "launcher.mjs");
    const childPath = join(directory, "server.mjs");
    const pidPath = join(directory, "child.pid");
    const exitedPath = join(directory, "launcher-exited");
    const port = await findAvailablePort();
    await writeFile(childPath, [
      'import { writeFileSync } from "node:fs";',
      'import { createServer } from "node:net";',
      ignoreTerm ? 'process.on("SIGTERM", () => {});' : "",
      "const server = createServer();",
      `server.listen(${port}, "127.0.0.1", () => writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)));`,
      "setInterval(() => {}, 1_000);",
    ].filter(Boolean).join("\n"));
    await writeFile(launcherPath, [
      'import { spawn } from "node:child_process";',
      'import { access, writeFile } from "node:fs/promises";',
      `const child = spawn(process.execPath, [${JSON.stringify(childPath)}], { stdio: "ignore" });`,
      "child.unref();",
      "let ready = false;",
      "for (let attempt = 0; attempt < 500; attempt += 1) {",
      `  try { await access(${JSON.stringify(pidPath)}); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }`,
      "}",
      "if (!ready) process.exit(99);",
      "await new Promise((resolve) => setTimeout(resolve, 250));",
      `await writeFile(${JSON.stringify(exitedPath)}, "exited");`,
    ].join("\n"));

    let running;
    try {
      running = runOwnedProcessGroup(process.execPath, [launcherPath], {
        cwd: root,
        env: process.env,
        stdio: "ignore",
        terminationGraceMs: 100,
        terminationWaitMs: 2_000,
      });
      const cleanupStartedAt = Date.now();
      await waitForFile(pidPath);
      const childPid = Number((await readFile(pidPath, "utf8")).trim());
      const result = await running;
      assert.ok(Date.now() - cleanupStartedAt < 4_000, "owned cleanup exceeded its bound");
      assert.equal(result.groupGone, true, "owned process group should be confirmed stopped");
      assert.equal(result.terminationError, undefined);
      assert.equal(await processGone(result.processGroupId), true, "launcher did not exit before cleanup");
      assert.equal((await readFile(exitedPath, "utf8")), "exited");
      assert.equal(await waitForProcessStopped(childPid), true, "fixture child survived cleanup");
      await assertPortFree(port);
    } finally {
      if (running) await running.catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("startup smoke rejects invalid timeout configuration before checking tools", async (t) => {
  const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
    signal: t.signal,
    cwd: root,
    env: {
      ...process.env,
      SMOKE_TIMEOUT: "nope",
    },
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /SMOKE_TIMEOUT must be a positive integer/);
});

test("startup smoke fixture uses the active PATH and reports a missing real timeout prerequisite", async (t) => {
  const fixture = await createStartupSmokeFixture();
  try {
    assert.equal(await readlink(join(fixture.binDirectory, "timeout")), systemCommand("timeout"));
    const result = await runCommand(join(fixture.binDirectory, "timeout"), ["--version"], {
      signal: t.signal,
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

test("startup smoke reports a missing curl prerequisite immediately", async (t) => {
  const fixture = await createStartupSmokeFixture({ includeCurl: false });
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      signal: t.signal,
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

test("startup smoke reports a missing psql prerequisite immediately", async (t) => {
  const fixture = await createStartupSmokeFixture({ includePsql: false });
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      signal: t.signal,
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

test("startup smoke bounds a stalled PostgreSQL preflight", async (t) => {
  const fixture = await createStartupSmokeFixture({ psqlDelaySeconds: 30 });
  const startedAt = Date.now();
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      signal: t.signal,
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

test("startup smoke rejects an unexpected database identity before launching", async (t) => {
  const fixture = await createStartupSmokeFixture({ databaseName: "wrong-target" });
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      signal: t.signal,
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
    await t.test(scenario.name, async (t) => {
      const fixture = await createStartupSmokeFixture(scenario.fixtureOptions);
      try {
        const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
          signal: t.signal,
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

test("startup smoke removes the complete server group and listener after success", async (t) => {
  const fixture = await createStartupSmokeFixture();
  const port = await findAvailablePort();
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      signal: t.signal,
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

test("startup smoke removes the complete server group after readiness failure", async (t) => {
  const fixture = await createStartupSmokeFixture({ healthStatus: 503 });
  const port = await findAvailablePort();
  try {
    const result = await runCommand(systemCommand("bash"), [startupSmokePath], {
      signal: t.signal,
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

test("startup smoke cleans its process group and port when interrupted", async (t) => {
  const fixture = await createStartupSmokeFixture({ healthStatus: 503 });
  const port = await findAvailablePort();
  try {
    await withInterruptibleSmoke(t, fixture, port, async ({ interrupt, finished, output }) => {
      await waitForFile(fixture.readyMarker);
      const childPid = (await readFile(fixture.childPidFile, "utf8")).trim();
      const interruptedAt = Date.now();
      interrupt();
      const result = await finished;
      assert.notEqual(result.status, 0, `${output()}\ninterrupted smoke unexpectedly passed`);
      assert.equal(result.childSignal, null);
      assert.ok(Date.now() - interruptedAt < 5_000, "interrupted smoke did not stop within its cleanup deadline");
      assert.equal(await waitForProcessGone(childPid), true);
      await assertPortFree(port);
    });
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("startup smoke harness cleans owned children and listener after abnormal exits", async (t) => {
  for (const failure of ["assertion", "cancelled wait"]) {
    await t.test(failure, async (t) => {
      const fixture = await createStartupSmokeFixture({ healthStatus: 503 });
      const port = await findAvailablePort();
      // A separate listener must not be affected by cleanup of the smoke tree.
      const unrelated = createServer();
      await new Promise((resolveListen, reject) => {
        unrelated.once("error", reject);
        unrelated.listen(0, "127.0.0.1", resolveListen);
      });
      const unrelatedPort = unrelated.address().port;
      let childPid;
      let failedAt;
      try {
        await assert.rejects(
          withInterruptibleSmoke(t, fixture, port, async () => {
            await waitForFile(fixture.readyMarker);
            childPid = (await readFile(fixture.childPidFile, "utf8")).trim();
            assert.equal(await processGone(childPid), false);
            failedAt = Date.now();
            if (failure === "assertion") {
              assert.fail("injected harness assertion");
            }
            const cancellation = new AbortController();
            const waiting = sleep(30_000, undefined, { signal: cancellation.signal });
            cancellation.abort();
            await waiting;
          }),
          failure === "assertion" ? /injected harness assertion/ : { name: "AbortError" },
        );
        assert.ok(Date.now() - failedAt < 5_000, "abnormal cleanup exceeded its deadline");
        assert.equal(await waitForProcessGone(childPid), true, "smoke child survived harness failure");
        await assertPortFree(port);
        assert.equal(unrelated.listening, true);
        await assert.rejects(assertPortFree(unrelatedPort), /remained occupied/);
      } finally {
        await new Promise((resolveClose) => unrelated.close(resolveClose));
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("startup smoke harness after-hook cleans the server when a test times out", async () => {
  const fixture = await createStartupSmokeFixture({ healthStatus: 503 });
  const port = await findAvailablePort();
  const harnessPath = join(fixture.directory, "interrupted-harness.test.mjs");
  // Exercise the real helper in a separate test runner: an intentionally timed
  // out subtest would otherwise mark this parent suite as failed too.
  await writeFile(harnessPath, `
import assert from "node:assert/strict";
import test from "node:test";
import { accessSync, constants, statSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { runOwnedProcessGroup } from ${JSON.stringify(new URL("../lib/owned-process-group.mjs", import.meta.url).href)};
const root = ${JSON.stringify(root)};
const startupSmokePath = ${JSON.stringify(startupSmokePath)};
${systemCommand.toString()}
${assertPortFree.toString()}
${waitForFile.toString()}
${withInterruptibleSmoke.toString()}
test("interrupted harness", { timeout: 5_000 }, async (t) => {
  await withInterruptibleSmoke(t, {
    env: {
      ...process.env,
      PATH: ${JSON.stringify(fixture.env.PATH)},
      SMOKE_SERVER_ENTRYPOINT: ${JSON.stringify(fixture.entrypoint)},
      SMOKE_CHILD_PID_FILE: ${JSON.stringify(fixture.childPidFile)},
      SMOKE_READY_MARKER: ${JSON.stringify(fixture.readyMarker)},
    },
  }, ${port}, async () => {
    await waitForFile(${JSON.stringify(fixture.readyMarker)});
    // Keep the wrapper unresolved so only t.after, not finally, can clean up.
    await new Promise(() => {});
  });
});
`);
  try {
    const startedAt = Date.now();
    const harnessEnv = { ...fixture.env, PATH: process.env.PATH };
    // Nested runners need their own reporter/IPC context, not the parent's.
    delete harnessEnv.NODE_TEST_CONTEXT;
    const deadline = AbortSignal.timeout(10_000);
    let output = "";
    const result = await runOwnedProcessGroup(process.execPath, ["--test", harnessPath], {
      cwd: root,
      env: harnessEnv,
      signal: deadline,
      terminationGraceMs: 2_000,
      terminationWaitMs: 2_000,
      onOutput: (chunk) => { output += chunk; },
    });
    assert.equal(deadline.aborted, false, "outer safety supervisor had to rescue the timed out harness");
    assert.equal(result.groupGone, true);
    assert.notEqual(result.status, 0, `timed out harness unexpectedly passed\n${output}`);
    assert.match(output, /testTimeoutFailure/);
    assert.ok(Date.now() - startedAt < 10_000, "test cancellation cleanup exceeded its deadline");
    const childPid = (await readFile(fixture.childPidFile, "utf8")).trim();
    assert.match(childPid, /^\d+$/, "timeout must occur after the smoke child starts");
    assert.equal(await waitForProcessGone(childPid), true);
    await assertPortFree(port);
  } finally {
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
  let serverRun;
  let serverOutput = "";
  let primaryError;
  const cleanupErrors = [];
  let processCleanupConfirmed = true;
  let serverController;

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
        signal: t.signal,
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
    let resolveServerSpawn;
    let rejectServerSpawn;
    const serverSpawned = new Promise((resolve, reject) => {
      resolveServerSpawn = resolve;
      rejectServerSpawn = reject;
    });
    serverController = new AbortController();
    serverRun = runOwnedProcessGroup(
      process.execPath,
      [resolve(root, "node_modules/tsx/dist/cli.mjs"), "server/index.ts"],
      {
        cwd: root,
        env: { ...bootstrapEnv, PORT: String(port) },
        stdio: "ignore",
        signal: serverController.signal,
        onOutput: (chunk) => { serverOutput += chunk; },
        onSpawn: (child) => {
          server = child;
          resolveServerSpawn(child);
        },
      },
    );
    serverRun.catch(rejectServerSpawn);
    server = await serverSpawned;

    const healthUrl = await waitForHealth(server, port, () => serverOutput);
    const baseUrl = new URL(healthUrl);
    baseUrl.pathname = "/";

    const healthResponse = await fetch(new URL("/api/healthz", baseUrl));
    assert.equal(healthResponse.status, 200);
  } catch (error) {
    primaryError = error;
  } finally {
    serverController?.abort("SIGTERM");
    try {
      if (serverRun) {
        const result = await serverRun;
        if (!result.groupGone || result.terminationError) {
          processCleanupConfirmed = false;
          cleanupErrors.push(
            `failed to confirm application process cleanup${result.terminationError ? `: ${result.terminationError.message}` : ""}`,
          );
        }
      }
    } catch (error) {
      processCleanupConfirmed = false;
      cleanupErrors.push(`failed to stop application: ${error.message}`);
    }

    if (processCleanupConfirmed) {
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