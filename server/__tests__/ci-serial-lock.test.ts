/**
 * ci-serial-lock.test.ts — Behavioral tests for the validation lock.
 *
 * Guards against:
 *   • resource striping, priority, and same-resource reentrancy
 *   • heartbeat, stale/dead/max-hold recovery, cleanup, and exit propagation
 *   • signal cleanup and collision-safe acquisition
 *
 * All tests exercise the real scripts/serial-lock.mjs binary via child
 * processes. Config env vars (SERIAL_LOCK_HEARTBEAT_INTERVAL_MS,
 * SERIAL_LOCK_HEARTBEAT_STALE_MS, SERIAL_LOCK_WAIT_INTERVAL_MS) are set to
 * short values so tests complete in seconds without waiting 30–60 s.
 *
 * Run with:
 *   npx tsx server/__tests__/ci-serial-lock.test.ts
 */

import assert from "assert/strict";
import { spawn } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync } from "fs";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCK_SCRIPT = resolve(__dirname, "../../scripts/serial-lock.mjs");
const COLLISION_SCRIPT = resolve(__dirname, "../../scripts/ci-collision-test.mjs");

// Short timing overrides for tests (ms):
const HB_INTERVAL = 400;   // heartbeat fires every 400 ms
const HB_STALE = 900;      // stale after 900 ms (2.25 × HB_INTERVAL)
const POLL_INTERVAL = 200; // waiter polls every 200 ms

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
    failed++;
    failures.push(name);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempLockPath() {
  return join(tmpdir(), `repl-lock-unit-${randomBytes(4).toString("hex")}.lock`);
}

function cleanup(path: string) {
  try { if (existsSync(path)) unlinkSync(path); } catch { /* ignore */ }
}

/** Base env shared by all lock invocations in tests. */
function testEnv(lockPath: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SERIAL_LOCK_PATH: lockPath,
    SERIAL_LOCK_HEARTBEAT_INTERVAL_MS: String(HB_INTERVAL),
    SERIAL_LOCK_HEARTBEAT_STALE_MS: String(HB_STALE),
    SERIAL_LOCK_WAIT_INTERVAL_MS: String(POLL_INTERVAL),
    ...extra,
  };
}

/**
 * Spawn serial-lock.mjs with the given inner command and env.
 * Returns a promise that resolves to { code, stdout, stderr } and a ref to the process.
 */
function runLocked(
  lockPath: string,
  innerCmd: string[],
  extraEnv: Record<string, string> = {}
  , resource = "global"
  , priority = 5
  , timeoutMs = 0
): { proc: ReturnType<typeof spawn>; done: Promise<{ code: number; stdout: string; stderr: string }> } {
  const lockArgs = [
    LOCK_SCRIPT,
    "--resource",
    resource,
    "--priority",
    String(priority),
    ...(timeoutMs > 0 ? ["--timeout-ms", String(timeoutMs)] : []),
    "--",
    ...innerCmd,
  ];
  const proc = spawn(
    process.execPath,
    lockArgs,
    {
      env: testEnv(lockPath, extraEnv),
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let stdout = "";
  let stderr = "";
  proc.stdout!.on("data", (d: Buffer) => { stdout += d.toString(); });
  proc.stderr!.on("data", (d: Buffer) => { stderr += d.toString(); });

  const done = new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    proc.on("close", (code: number | null) => resolve({ code: code ?? 1, stdout, stderr }));
  });

  return { proc, done };
}

/** Read the lock file written by serial-lock.mjs. */
function readLockFile(path: string): {
  pid: number;
  acquiredAt: number;
  lastHeartbeat: number;
  ownership: {
    childPid: number | null;
    processGroupId: number | null;
    processGroupIdentity: { pid: number; startTime: number } | null;
    observedChildPids: number[];
    observedChildProcessIdentities: Array<{ pid: number; startTime: number }>;
    cleanupPending: boolean;
  };
  holderIdentity: { pid: number; startTime: number } | null;
} | null {
  try {
    const raw = readFileSync(path, "utf8").trim();
    const [pidStr, tsStr, hbStr, , ownershipRaw, holderIdentityRaw] = raw.split("\n");
    const pid = parseInt(pidStr, 10);
    const acquiredAt = parseInt(tsStr, 10);
    if (isNaN(pid) || isNaN(acquiredAt)) return null;
    const lastHeartbeat = hbStr ? parseInt(hbStr, 10) : acquiredAt;
    const ownership = ownershipRaw ? JSON.parse(ownershipRaw) : {};
    const holderIdentity = holderIdentityRaw ? JSON.parse(holderIdentityRaw) : null;
    return {
      pid,
      acquiredAt,
      lastHeartbeat: isNaN(lastHeartbeat) ? acquiredAt : lastHeartbeat,
      ownership: {
        childPid: ownership.childPid ?? null,
        processGroupId: ownership.processGroupId ?? null,
        processGroupIdentity: ownership.processGroupIdentity ?? null,
        observedChildPids: ownership.observedChildPids ?? [],
        observedChildProcessIdentities: ownership.observedChildProcessIdentities ?? [],
        cleanupPending: ownership.cleanupPending === true,
      },
      holderIdentity,
    };
  } catch { return null; }
}

function readProcessIdentity(pid: number): { pid: number; startTime: number } | null {
  if (process.platform !== "linux") return null;
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = raw.lastIndexOf(")");
    if (commandEnd < 0) return null;
    const fields = raw.slice(commandEnd + 1).trim().split(/\s+/);
    const startTime = Number(fields[19]);
    if (!Number.isInteger(startTime) || startTime < 0) return null;
    return { pid, startTime };
  } catch {
    return null;
  }
}

function processIsRunning(pid: number): boolean {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    return status.match(/^State:\s+([A-Z])/m)?.[1] !== "Z";
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/** Poll until fn() returns truthy or deadline is exceeded. */
async function waitFor(fn: () => boolean, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

await test("acquires and releases lock, exits 0 for successful command", async () => {
  const lockPath = tempLockPath();
  try {
    const { done } = runLocked(lockPath, [process.execPath, "-e", "process.exit(0)"]);
    const result = await done;
    assert.equal(result.code, 0, `expected exit 0, got ${result.code}`);
    const out = result.stdout + result.stderr;
    assert.ok(out.includes("acquired lock"), "should log lock acquisition");
    assert.ok(out.includes("released lock"), "should log lock release");
    assert.ok(!existsSync(lockPath), "lock file should be removed on clean exit");
  } finally {
    cleanup(lockPath);
  }
});

await test("lock file records holder timing and child ownership metadata", async () => {
  const lockPath = tempLockPath();
  const { proc } = runLocked(lockPath, ["sleep", "5"]);

  try {
    // Poll until the lock file appears.
    let recordedLock: ReturnType<typeof readLockFile> = null;
    const ownershipRecorded = await waitFor(
      () => {
        const candidate = readLockFile(lockPath);
        if (candidate && Number.isInteger(candidate.ownership.childPid) && candidate.ownership.childPid > 0) {
          recordedLock = candidate;
          return true;
        }
        return false;
      },
      4_000,
    );
    assert.ok(ownershipRecorded, "lock file should record child ownership once holder acquires");

    const lock = recordedLock;
    assert.ok(lock !== null, "lock file must be readable");
    assert.ok(lock!.pid > 0, `pid should be positive (got ${lock!.pid})`);
    assert.ok(lock!.ownership.childPid > 0, "lock should record the child PID");
    assert.equal(
      lock!.ownership.processGroupId,
      lock!.ownership.childPid,
      "lock should record the detached child process group",
    );
    assert.equal(
      lock!.ownership.processGroupIdentity?.pid,
      lock!.ownership.childPid,
      "lock should record the process-group leader identity",
    );
    assert.ok(
      Number.isInteger(lock!.ownership.processGroupIdentity?.startTime),
      "group identity should include the process start time",
    );
    assert.ok(
      lock!.ownership.observedChildPids.includes(lock!.ownership.childPid),
      "lock should record the child in its observed ownership tree",
    );
    assert.ok(
      lock!.ownership.observedChildProcessIdentities.some(
        ({ pid, startTime }) => pid === lock!.ownership.childPid && Number.isInteger(startTime),
      ),
      "lock should record process identities for observed children",
    );
    assert.equal(
      lock!.holderIdentity?.pid,
      lock!.pid,
      "lock should record the holder process identity",
    );
    assert.ok(lock!.acquiredAt > 0, "acquiredAt should be a positive timestamp");
    assert.ok(lock!.lastHeartbeat > 0, "lastHeartbeat should be written on acquisition");
    assert.ok(
      Math.abs(lock!.lastHeartbeat - lock!.acquiredAt) < 500,
      "initial lastHeartbeat should be close to acquiredAt"
    );
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => proc.on("close", r));
    cleanup(lockPath);
  }
});

await test("holder refreshes lastHeartbeat over time (heartbeat interval = 400 ms)", async () => {
  const lockPath = tempLockPath();
  // Holder sleeps 3 s — long enough to emit at least 3 heartbeats at 400 ms each.
  const { proc } = runLocked(lockPath, ["sleep", "3"]);

  try {
    // Wait for the lock file to appear.
    const appeared = await waitFor(() => readLockFile(lockPath) !== null, 4_000);
    assert.ok(appeared, "lock file should appear");

    const initial = readLockFile(lockPath)!.lastHeartbeat;

    // Wait > 2× heartbeat interval then check the timestamp has advanced.
    await new Promise((r) => setTimeout(r, HB_INTERVAL * 2 + 100));

    const updated = readLockFile(lockPath);
    assert.ok(updated !== null, "lock file should still exist");
    assert.ok(
      updated!.lastHeartbeat > initial,
      `lastHeartbeat should advance over time: initial=${initial}, updated=${updated!.lastHeartbeat}`
    );
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => proc.on("close", r));
    cleanup(lockPath);
  }
});

await test("heartbeat storage loss stops the protected command and reports lock loss", async () => {
  const lockPath = tempLockPath();
  const holder = runLocked(lockPath, ["sleep", "10"]);
  let childPid = 0;

  try {
    assert.ok(
      await waitFor(() => {
        const lock = readLockFile(lockPath);
        if (!lock?.ownership.childPid) return false;
        childPid = lock.ownership.childPid;
        return true;
      }, 4_000),
      "holder should record its protected child before storage is changed",
    );

    unlinkSync(lockPath);
    mkdirSync(lockPath);

    const completion = await Promise.race([
      holder.done.then((result) => ({ kind: "done" as const, result })),
      new Promise<{ kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), 4_000),
      ),
    ]);
    assert.equal(completion.kind, "done", "lock loss should stop the command promptly");
    if (completion.kind !== "done") return;

    const output = completion.result.stdout + completion.result.stderr;
    assert.notEqual(completion.result.code, 0, "lost ownership must fail validation");
    assert.match(output, /lock ownership lost/i, "failure should identify lock loss");
    assert.ok(
      await waitFor(() => !processIsRunning(childPid), 2_000),
      "the protected child should be terminated after heartbeat failure",
    );
    assert.ok(existsSync(lockPath), "heartbeat failure cleanup must preserve changed storage");
  } finally {
    if (holder.proc.exitCode === null) holder.proc.kill("SIGTERM");
    await holder.done;
    try { rmdirSync(lockPath); } catch { /* already removed */ }
    cleanup(lockPath);
  }
});

await test("completion fails and release preserves a same-token replacement lock file", async () => {
  const lockPath = tempLockPath();
  const holder = runLocked(
    lockPath,
    [process.execPath, "-e", "setTimeout(() => process.exit(0), 500)"],
    { SERIAL_LOCK_HEARTBEAT_INTERVAL_MS: "5000" },
  );

  try {
    assert.ok(
      await waitFor(() => {
        const lock = readLockFile(lockPath);
        return Boolean(lock?.ownership.childPid);
      }, 4_000),
      "holder should acquire and record its protected child",
    );

    const ownedContents = readFileSync(lockPath);
    unlinkSync(lockPath);
    writeFileSync(lockPath, ownedContents);

    const result = await holder.done;
    const output = result.stdout + result.stderr;
    assert.notEqual(result.code, 0, "validation must fail if lock ownership changed before completion");
    assert.match(output, /lock ownership lost/i, "completion should report the lost lock");
    assert.match(
      output,
      /lock storage changed before release.*leaving replacement state untouched/i,
      "release should report that replacement storage was preserved",
    );
    assert.equal(
      readFileSync(lockPath, "utf8"),
      ownedContents.toString("utf8"),
      "cleanup must not unlink a replacement that copied the former owner's token",
    );
  } finally {
    if (holder.proc.exitCode === null) holder.proc.kill("SIGTERM");
    await holder.done;
    cleanup(lockPath);
  }
});

await test("waiter queues behind holder then acquires after holder exits", async () => {
  const lockPath = tempLockPath();
  const holderDone = runLocked(lockPath, ["sleep", "2"]).done;

  // Give holder time to acquire.
  await new Promise((r) => setTimeout(r, 300));

  const waiter = runLocked(lockPath, [process.execPath, "-e", "process.exit(0)"]);

  try {
    const [holder, waiterResult] = await Promise.all([holderDone, waiter.done]);

    assert.equal(holder.code, 0, `holder should exit 0 (got ${holder.code})`);
    assert.equal(waiterResult.code, 0, `waiter should exit 0 (got ${waiterResult.code})`);

    const waiterOut = waiterResult.stdout + waiterResult.stderr;
    assert.ok(
      waiterOut.includes("[serial-lock] waiting"),
      "waiter should print a waiting message before acquiring"
    );
    assert.ok(
      waiterOut.includes("acquired lock"),
      "waiter should eventually acquire the lock"
    );
  } finally {
    cleanup(lockPath);
  }
});

await test("stale heartbeat triggers INCIDENT force-eviction (live holder PID)", async () => {
  const lockPath = tempLockPath();

  // Write a fake lock: live PID (self), very old acquiredAt, stale heartbeat.
  // HEARTBEAT_STALE_MS for this test = 900 ms; make heartbeat 2000 ms old.
  const now = Date.now();
  const staleBeat = now - HB_STALE - 1_100;
  writeFileSync(lockPath, `${process.pid}\n${now - 300_000}\n${staleBeat}\n`, "utf8");

  try {
    // Spawn a waiter — should detect stale heartbeat and force-evict.
    const { done } = runLocked(lockPath, [process.execPath, "-e", "process.exit(0)"]);
    const result = await done;

    const out = result.stdout + result.stderr;
    assert.ok(
      out.includes("INCIDENT"),
      `waiter should emit INCIDENT on stale-heartbeat eviction (got: ${out.substring(0, 400)})`
    );
    assert.ok(
      out.includes("heartbeat"),
      "INCIDENT message should mention heartbeat"
    );
    assert.equal(result.code, 0, `waiter should complete successfully after takeover (got ${result.code})`);
  } finally {
    cleanup(lockPath);
  }
});

await test("fresh heartbeat protects a live holder from waiter eviction", async () => {
  const lockPath = tempLockPath();
  // Holder runs long enough to be past any legacy time-based eviction.
  // heartbeat interval = 400 ms so it will refresh well within the 900 ms stale threshold.
  const holderResult = runLocked(lockPath, ["sleep", "2"]);

  // Give holder time to acquire and write initial heartbeat.
  await new Promise((r) => setTimeout(r, 300));

  // Launch a waiter with the same short timing env.
  const waiterResult = runLocked(lockPath, [process.execPath, "-e", "process.exit(0)"]);

  try {
    const [holder, waiter] = await Promise.all([holderResult.done, waiterResult.done]);

    const waiterOut = waiter.stdout + waiter.stderr;
    const holderOut = holder.stdout + holder.stderr;

    // Waiter must NOT have force-evicted the holder.
    assert.ok(
      !waiterOut.includes("INCIDENT"),
      `waiter should NOT emit INCIDENT for a holder with fresh heartbeat (got: ${waiterOut.substring(0, 400)})`
    );

    // Waiter must have waited normally.
    assert.ok(
      waiterOut.includes("[serial-lock] waiting"),
      "waiter should have queued normally"
    );

    // Both should succeed.
    assert.equal(holder.code, 0, `holder should exit 0 (got ${holder.code})`);
    assert.equal(waiter.code, 0, `waiter should exit 0 (got ${waiter.code})`);
  } finally {
    cleanup(lockPath);
  }
});

await test("holder with fresh heartbeat is NOT evicted even when SERIAL_LOCK_MAX_HOLD_MS is exceeded", async () => {
  // A fresh heartbeat protects a holder until the explicit max-hold safety
  // valve. The max-hold test below verifies that valve separately.
  const lockPath = tempLockPath();
  const overrides = {
    SERIAL_LOCK_MAX_HOLD_MS: "5000",
  };

  // Holder sleeps 2 s — during which heartbeats fire every 400 ms.
  const holderResult = runLocked(lockPath, ["sleep", "2"], overrides);

  // Give holder 300 ms to acquire and write initial heartbeat.
  await new Promise((r) => setTimeout(r, 300));

  // Waiter arrives while the holder is running; heartbeat is fresh and max hold
  // has not elapsed, so it must queue normally.
  const waiterResult = runLocked(lockPath, [process.execPath, "-e", "process.exit(0)"], overrides);

  try {
    const [holder, waiter] = await Promise.all([holderResult.done, waiterResult.done]);

    const waiterOut = waiter.stdout + waiter.stderr;

    // Waiter must NOT have emitted an INCIDENT (forced takeover).
    assert.ok(
      !waiterOut.includes("INCIDENT"),
      `waiter must NOT force-evict a holder whose heartbeat is fresh, even past MAX_HOLD_MS\n` +
      `(got: ${waiterOut.substring(0, 500)})`
    );

    // Waiter must have queued normally.
    assert.ok(
      waiterOut.includes("[serial-lock] waiting"),
      "waiter should have queued normally behind the heartbeating holder"
    );

    // Both should complete successfully.
    assert.equal(holder.code, 0, `holder should exit 0 (got ${holder.code})`);
    assert.equal(waiter.code, 0, `waiter should exit 0 (got ${waiter.code})`);
  } finally {
    cleanup(lockPath);
  }
});

await test("max-hold safety valve reclaims a live but overlong holder", async () => {
  const lockPath = tempLockPath();
  const overrides = {
    SERIAL_LOCK_MAX_HOLD_MS: "100",
    SERIAL_LOCK_HEARTBEAT_STALE_MS: "5000",
  };
  const holder = runLocked(lockPath, ["sleep", "2"], overrides);
  await new Promise((r) => setTimeout(r, 300));
  const waiter = runLocked(lockPath, [process.execPath, "-e", "process.exit(0)"], overrides);
  try {
    const [holderResult, waiterResult] = await Promise.all([holder.done, waiter.done]);
    const output = waiterResult.stdout + waiterResult.stderr;
    assert.ok(output.includes("maximum hold duration exceeded"), "takeover should identify max-hold recovery");
    assert.equal(waiterResult.code, 0);
    assert.notEqual(holderResult.code, 0, "the evicted holder must stop protected work");
    assert.match(
      holderResult.stdout + holderResult.stderr,
      /lock ownership lost/i,
      "the evicted holder should report that heartbeat ownership was lost",
    );
  } finally {
    holder.proc.kill("SIGTERM");
    waiter.proc.kill("SIGTERM");
    cleanup(lockPath);
  }
});

await test("dead holder is reclaimed loudly", async () => {
  const lockPath = tempLockPath();
  writeFileSync(lockPath, `${999999}\n${Date.now() - 300_000}\n${Date.now() - 300_000}\n`, "utf8");
  try {
    const { done } = runLocked(lockPath, [process.execPath, "-e", "process.exit(0)"]);
    const result = await done;
    assert.equal(result.code, 0);
    assert.ok((result.stdout + result.stderr).includes("holder PID is dead"));
  } finally {
    cleanup(lockPath);
  }
});

await test("reused holder and process-group IDs do not block stale recovery", async () => {
  const lockPath = tempLockPath();
  const unrelated = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000);"],
    { detached: true, stdio: "ignore" },
  );
  const unrelatedPid = unrelated.pid ?? 0;

  try {
    assert.ok(unrelatedPid > 0, "unrelated process should have a PID");
    assert.ok(
      await waitFor(() => readProcessIdentity(unrelatedPid) !== null, 4_000),
      "unrelated process identity should be readable",
    );
    const actualIdentity = readProcessIdentity(unrelatedPid);
    assert.ok(actualIdentity, "unrelated process identity must be available");
    const mismatchedIdentity = {
      pid: unrelatedPid,
      startTime: actualIdentity.startTime + 1,
    };
    const now = Date.now();
    const ownership = {
      childPid: unrelatedPid,
      processGroupId: unrelatedPid,
      processGroupIdentity: mismatchedIdentity,
      observedChildPids: [unrelatedPid],
      observedChildProcessIdentities: [mismatchedIdentity],
      cleanupPending: true,
    };
    writeFileSync(
      lockPath,
      `${unrelatedPid}\n${now - 300_000}\n${now}\nreused-owner\n` +
        `${JSON.stringify(ownership)}\n${JSON.stringify(mismatchedIdentity)}\n`,
      "utf8",
    );

    const { done } = runLocked(
      lockPath,
      [process.execPath, "-e", "process.exit(0)"],
      {
        SERIAL_LOCK_MAX_WAIT_MS: "1_200",
        SERIAL_LOCK_WAIT_INTERVAL_MS: "100",
      },
    );
    const result = await done;
    const output = result.stdout + result.stderr;

    assert.equal(
      result.code,
      0,
      `stale recovery should not wait on unrelated reused IDs (got ${result.code}: ${output})`,
    );
    assert.ok(output.includes("holder PID is dead or has been reused"), output);
    assert.ok(processIsRunning(unrelatedPid), "unrelated process must remain untouched");
  } finally {
    if (unrelatedPid > 0) {
      try { process.kill(-unrelatedPid, "SIGKILL"); } catch { /* already gone */ }
      unrelated.kill("SIGKILL");
      await new Promise((resolve) => unrelated.once("close", resolve));
    }
    cleanup(lockPath);
  }
});

await test("partially-created lock files are reclaimed safely", async () => {
  const lockPath = tempLockPath();
  writeFileSync(lockPath, "", "utf8");
  try {
    const { done } = runLocked(
      lockPath,
      [process.execPath, "-e", "process.exit(0)"],
      { SERIAL_LOCK_MAX_WAIT_MS: "1200" },
    );
    const result = await done;
    assert.equal(result.code, 0, `waiter should recover the empty lock (got ${result.code})`);
    assert.ok(
      (result.stdout + result.stderr).includes("malformed lock"),
      "recovery should identify the malformed lock",
    );
  } finally {
    cleanup(lockPath);
  }
});

await test("unusable lock parent fails clearly during storage initialization", async () => {
  const parentPath = tempLockPath();
  const lockPath = join(parentPath, "lock");
  writeFileSync(parentPath, "not a directory", "utf8");
  const startedAt = Date.now();
  try {
    const { done } = runLocked(
      lockPath,
      [process.execPath, "-e", "process.exit(0)"],
      { SERIAL_LOCK_MAX_WAIT_MS: "550" },
    );
    const result = await done;
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.code, 1, `waiter should fail clearly (got ${result.code})`);
    assert.ok(
      (result.stdout + result.stderr).includes("lock storage is unusable"),
      "failure should identify unusable lock storage",
    );
    assert.ok(elapsedMs < 2_000, `timeout should be bounded (elapsed ${elapsedMs}ms)`);
  } finally {
    cleanup(parentPath);
    cleanup(lockPath);
  }
});

await test("unusable lock storage fails fast and removes its waiter manifest", async () => {
  const lockPath = tempLockPath();
  const waitersDir = `${lockPath}.waiters`;
  mkdirSync(waitersDir);
  const holder = runLocked(lockPath, ["sleep", "2"], {
    VALIDATION_LOCK_WAITERS_DIR: waitersDir,
  });
  let waiter: ReturnType<typeof runLocked> | null = null;

  try {
    assert.ok(
      await waitFor(() => readLockFile(lockPath) !== null, 4_000),
      "holder should create a lock before the waiter starts",
    );

    waiter = runLocked(
      lockPath,
      [process.execPath, "-e", "process.exit(0)"],
      {
        VALIDATION_LOCK_WAITERS_DIR: waitersDir,
        SERIAL_LOCK_MAX_WAIT_MS: "10_000",
      },
    );
    const waiterManifest = join(waitersDir, `${waiter.proc.pid}.json`);
    assert.ok(
      await waitFor(() => existsSync(waiterManifest), 4_000),
      "waiter should create its manifest while the lock is held",
    );
    const waiterDetails = JSON.parse(readFileSync(waiterManifest, "utf8"));
    assert.equal(
      waiterDetails.processIdentity?.pid,
      waiter.proc.pid,
      "waiter manifest should identify its owning process",
    );
    assert.ok(
      Number.isInteger(waiterDetails.processIdentity?.startTime),
      "waiter identity should include the process start time where supported",
    );
    assert.match(
      waiterDetails.waiterToken,
      /^[a-f0-9]{32}$/,
      "waiter manifest should include a per-run ownership token",
    );

    unlinkSync(lockPath);
    mkdirSync(lockPath);

    const startedAt = Date.now();
    const result = await waiter.done;
    const elapsedMs = Date.now() - startedAt;
    const output = result.stdout + result.stderr;

    assert.equal(result.code, 1, `waiter should fail clearly (got ${result.code})`);
    assert.ok(
      output.includes("lock storage is unusable"),
      `failure should identify unusable lock storage (got: ${output})`,
    );
    assert.ok(elapsedMs < 2_000, `storage failure should be immediate (elapsed ${elapsedMs}ms)`);
    assert.ok(!existsSync(waiterManifest), "storage failure should remove the waiter manifest");
  } finally {
    if (waiter && !waiter.proc.killed) waiter.proc.kill("SIGTERM");
    holder.proc.kill("SIGTERM");
    await Promise.all([
      holder.done,
      waiter?.done ?? Promise.resolve(),
    ]);
    try { rmdirSync(lockPath); } catch { /* already removed */ }
    try { rmdirSync(waitersDir); } catch { /* already removed */ }
    cleanup(lockPath);
  }
});

await test("waiter cleanup preserves a replacement manifest at the same PID path", async () => {
  const lockPath = tempLockPath();
  const waitersDir = `${lockPath}.waiters`;
  mkdirSync(waitersDir);
  const holder = runLocked(lockPath, ["sleep", "4"], {
    VALIDATION_LOCK_WAITERS_DIR: waitersDir,
  });
  let waiter: ReturnType<typeof runLocked> | null = null;

  try {
    assert.ok(
      await waitFor(() => readLockFile(lockPath) !== null, 4_000),
      "holder should create a lock before the waiter starts",
    );

    waiter = runLocked(
      lockPath,
      [process.execPath, "-e", "process.exit(0)"],
      {
        VALIDATION_LOCK_WAITERS_DIR: waitersDir,
        SERIAL_LOCK_MAX_WAIT_MS: "10_000",
      },
    );
    const waiterManifest = join(waitersDir, `${waiter.proc.pid}.json`);
    assert.ok(
      await waitFor(() => existsSync(waiterManifest), 4_000),
      "waiter should create its manifest while the lock is held",
    );
    const originalDetails = JSON.parse(readFileSync(waiterManifest, "utf8"));
    assert.match(
      originalDetails.waiterToken,
      /^[a-f0-9]{32}$/,
      "original manifest should carry its per-run ownership token",
    );

    const replacementContents = `${JSON.stringify({
      ...originalDetails,
      command: ["replacement-waiter"],
      waiterToken: "replacement-entry",
    })}\n`;
    unlinkSync(waiterManifest);
    writeFileSync(waiterManifest, replacementContents, "utf8");

    unlinkSync(lockPath);
    mkdirSync(lockPath);
    const result = await waiter.done;
    const output = result.stdout + result.stderr;

    assert.equal(result.code, 1, `waiter should fail clearly (got ${result.code})`);
    assert.ok(
      output.includes("lock storage is unusable"),
      `failure should identify unusable lock storage (got: ${output})`,
    );
    assert.equal(
      readFileSync(waiterManifest, "utf8"),
      replacementContents,
      "cleanup must leave replacement manifest contents intact",
    );
  } finally {
    if (waiter && !waiter.proc.killed) waiter.proc.kill("SIGTERM");
    holder.proc.kill("SIGTERM");
    await Promise.all([holder.done, waiter?.done ?? Promise.resolve()]);
    cleanup(join(waitersDir, `${waiter?.proc.pid}.json`));
    try { rmdirSync(lockPath); } catch { /* already removed */ }
    try { rmdirSync(waitersDir); } catch { /* already removed */ }
    cleanup(lockPath);
  }
});

await test("concurrent stale reclaimers do not remove a replacement holder", async () => {
  const lockPath = tempLockPath();
  const activePath = `${lockPath}.active`;
  const now = Date.now();
  writeFileSync(
    lockPath,
    `${process.pid}\n${now - 30_000}\n${now - 30_000}\nstale-owner\n`,
    "utf8",
  );
  const command = [
    "const {openSync,unlinkSync}=require('fs');",
    `const active=${JSON.stringify(activePath)};`,
    "let fd;",
    "try { fd=openSync(active,'wx'); } catch { process.exit(73); }",
    "setTimeout(() => { unlinkSync(active); process.exit(0); }, 250);",
  ].join("");
  const contenders = Array.from({ length: 8 }, () =>
    runLocked(
      lockPath,
      [process.execPath, "-e", command],
      {
        SERIAL_LOCK_HEARTBEAT_INTERVAL_MS: "25",
        SERIAL_LOCK_HEARTBEAT_STALE_MS: "100",
        SERIAL_LOCK_MAX_WAIT_MS: "5000",
      },
    ),
  );
  try {
    const results = await Promise.all(contenders.map(({ done }) => done));
    for (const result of results) {
      assert.equal(
        result.code,
        0,
        `every contender should run serially (got ${result.code}; ${result.stderr})`,
      );
    }
  } finally {
    for (const contender of contenders) contender.proc.kill("SIGTERM");
    cleanup(lockPath);
    cleanup(activePath);
  }
});

await test("same resource is reentrant without waiting", async () => {
  const lockPath = tempLockPath();
  const nestedCode = [
    "const {spawnSync}=require('child_process');",
    `const r=spawnSync(process.execPath,[${JSON.stringify(LOCK_SCRIPT)},'--resource','nested','--','${process.execPath}','-e','process.exit(0)'],{stdio:'pipe',env:process.env});`,
    "process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status ?? 1);",
  ].join("");
  try {
    const { done } = runLocked(lockPath, [process.execPath, "-e", nestedCode], {}, "nested");
    const result = await done;
    assert.equal(result.code, 0);
    assert.ok((result.stdout + result.stderr).includes("reentrant resource 'nested'"));
  } finally {
    cleanup(lockPath);
  }
});

await test("distinct resources run concurrently", async () => {
  const alphaPath = tempLockPath();
  const betaPath = tempLockPath();
    const alpha = runLocked(alphaPath, ["sleep", "1"], { VALIDATION_LOCK_FILE: alphaPath }, "alpha");
  await new Promise((r) => setTimeout(r, 150));
  const startedAt = Date.now();
    const beta = runLocked(betaPath, [process.execPath, "-e", "process.exit(0)"], { VALIDATION_LOCK_FILE: betaPath }, "beta");
  try {
    const betaResult = await beta.done;
    assert.equal(betaResult.code, 0);
    assert.ok(Date.now() - startedAt < 850, "independent resource should not wait for alpha");
    await alpha.done;
  } finally {
    alpha.proc.kill("SIGTERM");
    beta.proc.kill("SIGTERM");
    cleanup(alphaPath);
    cleanup(betaPath);
  }
});

await test("higher-priority waiter acquires before lower-priority waiter", async () => {
  const lockPath = tempLockPath();
  const overrides = { SERIAL_LOCK_PRIORITY_GRACE_MS: "50" };
  const holder = runLocked(lockPath, ["sleep", "1"], overrides);
  await new Promise((r) => setTimeout(r, 150));
  const low = runLocked(lockPath, [process.execPath, "-e", "setTimeout(() => process.exit(0), 50)"], overrides, "priority", 8);
  await new Promise((r) => setTimeout(r, 150));
  const high = runLocked(lockPath, [process.execPath, "-e", "process.exit(0)"], overrides, "priority", 1);
  try {
    const completion: string[] = [];
    low.done.then(() => completion.push("low"));
    high.done.then(() => completion.push("high"));
    await Promise.all([holder.done, low.done, high.done]);
    assert.equal(completion[0], "high", `expected high-priority completion first, got ${completion.join(",")}`);
  } finally {
    holder.proc.kill("SIGTERM");
    low.proc.kill("SIGTERM");
    high.proc.kill("SIGTERM");
    cleanup(lockPath);
  }
});

await test("priority scheduling ignores a waiter manifest with a reused PID", async () => {
  const lockPath = tempLockPath();
  const waitersDir = `${lockPath}.waiters`;
  mkdirSync(waitersDir);
  const unrelated = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000);"],
    { detached: true, stdio: "ignore" },
  );
  const unrelatedPid = unrelated.pid ?? 0;

  try {
    assert.ok(unrelatedPid > 0, "unrelated process should have a PID");
    assert.ok(
      await waitFor(() => readProcessIdentity(unrelatedPid) !== null, 4_000),
      "unrelated process identity should be readable",
    );
    const actualIdentity = readProcessIdentity(unrelatedPid);
    assert.ok(actualIdentity, "unrelated process identity must be available");
    const now = Date.now();
    writeFileSync(
      join(waitersDir, `${unrelatedPid}.json`),
      `${JSON.stringify({
        pid: unrelatedPid,
        processIdentity: { pid: unrelatedPid, startTime: actualIdentity.startTime + 1 },
        resource: "global",
        priority: 1,
        queuedAt: now - 10_000,
        command: ["stale-waiter"],
      })}\n`,
      "utf8",
    );

    const startedAt = Date.now();
    const contender = runLocked(
      lockPath,
      [process.execPath, "-e", "process.exit(0)"],
      {
        VALIDATION_LOCK_WAITERS_DIR: waitersDir,
        SERIAL_LOCK_MAX_WAIT_MS: "1500",
        SERIAL_LOCK_WAIT_INTERVAL_MS: "50",
        SERIAL_LOCK_PRIORITY_GRACE_MS: "0",
      },
      "global",
      8,
    );
    const result = await contender.done;
    const output = result.stdout + result.stderr;
    assert.equal(
      result.code,
      0,
      `unrelated reused PID must not delay acquisition (got ${result.code}: ${output})`,
    );
    assert.ok(
      Date.now() - startedAt < 1_500,
      "valid lower-priority check should acquire before its bounded wait expires",
    );
    assert.ok(processIsRunning(unrelatedPid), "the unrelated process must remain untouched");
  } finally {
    if (unrelatedPid > 0) {
      try { process.kill(-unrelatedPid, "SIGKILL"); } catch { /* already gone */ }
      unrelated.kill("SIGKILL");
      await new Promise((resolve) => unrelated.once("close", resolve));
    }
    cleanup(join(waitersDir, `${unrelatedPid}.json`));
    try { rmdirSync(waitersDir); } catch { /* already removed */ }
    cleanup(lockPath);
  }
});

await test("legacy waiter manifests remain prioritized while their PID is live", async () => {
  const lockPath = tempLockPath();
  const waitersDir = `${lockPath}.waiters`;
  mkdirSync(waitersDir);
  const legacyWaiter = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000);"],
    { detached: true, stdio: "ignore" },
  );
  const legacyClosed = new Promise<void>((resolve) => {
    legacyWaiter.once("close", () => resolve());
  });
  const legacyPid = legacyWaiter.pid ?? 0;
  let contender: ReturnType<typeof runLocked> | null = null;

  try {
    assert.ok(legacyPid > 0, "legacy waiter process should have a PID");
    assert.ok(
      await waitFor(() => processIsRunning(legacyPid), 4_000),
      "legacy waiter process should be running",
    );
    writeFileSync(
      join(waitersDir, `${legacyPid}.json`),
      `${JSON.stringify({
        pid: legacyPid,
        resource: "global",
        priority: 1,
        queuedAt: Date.now() - 10_000,
        command: ["legacy-waiter"],
      })}\n`,
      "utf8",
    );

    contender = runLocked(
      lockPath,
      [process.execPath, "-e", "process.exit(0)"],
      {
        VALIDATION_LOCK_WAITERS_DIR: waitersDir,
        SERIAL_LOCK_MAX_WAIT_MS: "3000",
        SERIAL_LOCK_WAIT_INTERVAL_MS: "50",
        SERIAL_LOCK_PRIORITY_GRACE_MS: "0",
      },
      "global",
      8,
    );
    let contenderOutput = "";
    contender.proc.stdout!.on("data", (data: Buffer) => { contenderOutput += data.toString(); });
    contender.proc.stderr!.on("data", (data: Buffer) => { contenderOutput += data.toString(); });
    const queued = await waitFor(
      () => existsSync(join(waitersDir, `${contender!.proc.pid}.json`)),
      2_000,
    );
    assert.ok(
      queued,
      `lower-priority contender should queue behind the live legacy waiter ` +
        `(exitCode=${contender.proc.exitCode}; running=${processIsRunning(contender.proc.pid!)}; ` +
        `output=${contenderOutput})`,
    );
    assert.ok(processIsRunning(contender.proc.pid!), "contender should still be waiting");
    assert.ok(!existsSync(lockPath), "contender should not acquire ahead of the legacy waiter");

    try { process.kill(-legacyPid, "SIGKILL"); } catch { /* already gone */ }
    legacyWaiter.kill("SIGKILL");
    const result = await contender.done;
    assert.equal(result.code, 0, `contender should proceed after the legacy PID exits: ${result.stderr}`);
  } finally {
    if (legacyPid > 0) {
      try { process.kill(-legacyPid, "SIGKILL"); } catch { /* already gone */ }
      legacyWaiter.kill("SIGKILL");
      await legacyClosed;
    }
    if (contender && contender.proc.exitCode === null) contender.proc.kill("SIGKILL");
    await (contender?.done ?? Promise.resolve());
    cleanup(join(waitersDir, `${legacyPid}.json`));
    if (contender) cleanup(join(waitersDir, `${contender.proc.pid}.json`));
    try { rmdirSync(waitersDir); } catch { /* already removed */ }
    cleanup(lockPath);
  }
});

await test("SIGTERM releases the lock and terminates the child", async () => {
  const lockPath = tempLockPath();
  const holder = runLocked(lockPath, ["sleep", "10"]);
  try {
    const appeared = await waitFor(() => readLockFile(lockPath) !== null, 4_000);
    assert.ok(appeared);
    holder.proc.kill("SIGTERM");
    const result = await holder.done;
    assert.notEqual(result.code, 0);
    assert.ok(!existsSync(lockPath), "signal cleanup should remove lock");
  } finally {
    holder.proc.kill("SIGKILL");
    cleanup(lockPath);
  }
});

await test("SIGTERM escalates when the child ignores the signal", async () => {
  const lockPath = tempLockPath();
  const readyPath = join(tmpdir(), `repl-lock-ignore-sigterm-${randomBytes(4).toString("hex")}.ready`);
  const overrides = {
    SERIAL_LOCK_CLEANUP_GRACE_MS: "300",
    SERIAL_LOCK_CLEANUP_POLL_INTERVAL_MS: "20",
  };
  const childCode = [
    "const fs=require('fs');",
    "process.on('SIGTERM',()=>{});",
    `fs.writeFileSync(${JSON.stringify(readyPath)},String(process.pid));`,
    "setInterval(()=>{},1000);",
  ].join("");
  const holder = runLocked(
    lockPath,
    [process.execPath, "-e", childCode],
    overrides,
  );
  let childPid = 0;
  try {
    const childReady = await waitFor(() => {
      const lock = readLockFile(lockPath);
      childPid = lock?.ownership.childPid ?? childPid;
      try {
        const readyPid = Number(readFileSync(readyPath, "utf8"));
        return readyPid > 0 &&
          readyPid === childPid &&
          processIsRunning(readyPid);
      } catch {
        return false;
      }
    }, 4_000, 10);
    assert.ok(childReady, "child must install its SIGTERM handler and report readiness before interruption");
    assert.ok(processIsRunning(childPid), "SIGTERM-ignoring child must be alive before interruption");

    const startedAt = Date.now();
    assert.ok(holder.proc.kill("SIGTERM"), "wrapper should receive SIGTERM");

    const cleanupStarted = await waitFor(() => {
      const lock = readLockFile(lockPath);
      if (lock?.ownership.cleanupPending) return true;
      assert.ok(existsSync(lockPath), "lock must remain present until child cleanup is verified");
      return false;
    }, 1_000, 5);
    assert.ok(cleanupStarted, "wrapper should record pending cleanup before releasing its lock");
    assert.ok(processIsRunning(childPid), "child should still be alive because it ignores SIGTERM");

    const cleanupBoundMs = 3_000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      holder.done,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`wrapper did not finish cleanup within ${cleanupBoundMs}ms`)),
          cleanupBoundMs,
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    assert.notEqual(result.code, 0, "interrupted check must exit non-zero");
    assert.match(
      result.stderr,
      /survived SIGTERM; escalating to SIGKILL/,
      "wrapper must report that SIGKILL escalation actually occurred",
    );
    assert.ok(Date.now() - startedAt < cleanupBoundMs, "cleanup should finish within its bound");
    assert.ok(
      await waitFor(() => !processIsRunning(childPid), 1_000, 10),
      `SIGKILL should leave no child process running (PID ${childPid})`,
    );
    assert.ok(!existsSync(lockPath), "lock should be released after child cleanup is verified");
  } finally {
    if (childPid && processIsRunning(childPid)) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
        try { process.kill(childPid, "SIGKILL"); } catch { /* already gone */ }
      }
      await waitFor(() => !processIsRunning(childPid), 1_000, 10);
    }
    holder.proc.kill("SIGKILL");
    cleanup(readyPath);
    cleanup(lockPath);
  }
});

await test("timeout cleans up a detached descendant before releasing the lock", async () => {
  const lockPath = tempLockPath();
  const markerPath = join(tmpdir(), `repl-lock-detached-${randomBytes(4).toString("hex")}.pid`);
  const overrides = {
    SERIAL_LOCK_CLEANUP_GRACE_MS: "150",
    SERIAL_LOCK_CLEANUP_POLL_INTERVAL_MS: "20",
  };
  const childCode = [
    "const fs=require('fs');",
    "const {spawn}=require('child_process');",
    `const p=spawn(process.execPath,['-e',${JSON.stringify("process.on('SIGTERM',()=>{});setInterval(()=>{},1000);")}],{detached:true,stdio:'ignore'});`,
    `fs.writeFileSync(${JSON.stringify(markerPath)},String(p.pid));`,
    "setInterval(()=>{},1000);",
  ].join("");
  const holder = runLocked(
    lockPath,
    [process.execPath, "-e", childCode],
    { ...overrides, SERIAL_LOCK_CLEANUP_POLL_INTERVAL_MS: "20" },
    "global",
    5,
    200,
  );
  let detachedPid = 0;
  try {
    assert.ok(await waitFor(() => existsSync(markerPath), 4_000), "detached child should start");
    detachedPid = Number(readFileSync(markerPath, "utf8"));
    assert.ok(detachedPid > 0, "detached child PID should be recorded");
    const result = await holder.done;
    assert.notEqual(result.code, 0, "timed-out check must exit non-zero");
    assert.ok(
      await waitFor(() => !processIsRunning(detachedPid), 4_000),
      "detached descendant should be terminated",
    );
    assert.ok(!existsSync(lockPath), "lock should be released after descendant cleanup");
  } finally {
    if (detachedPid && processIsRunning(detachedPid)) {
      try { process.kill(detachedPid, "SIGKILL"); } catch { /* already gone */ }
    }
    cleanup(markerPath);
    cleanup(lockPath);
  }
});

await test("stale recovery preserves a lock while cleanup survivors still own the process group", async () => {
  const lockPath = tempLockPath();
  const markerPath = join(tmpdir(), `repl-lock-survivor-${randomBytes(4).toString("hex")}.marker`);
  const survivor = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000);"],
    { detached: true, stdio: "ignore" },
  );
  const survivorPid = survivor.pid ?? 0;
  const survivorIdentity = survivorPid ? readProcessIdentity(survivorPid) : null;
  const now = Date.now();
  const ownership = {
    childPid: survivorPid,
    processGroupId: survivorPid,
    processGroupIdentity: survivorIdentity,
    observedChildPids: [survivorPid],
    observedChildProcessIdentities: survivorIdentity ? [survivorIdentity] : [],
    cleanupPending: true,
  };
  writeFileSync(
    lockPath,
    `${999999}\n${now - 30_000}\n${now - 30_000}\nstale-owner\n${JSON.stringify(ownership)}\n`,
    "utf8",
  );
  const command = [
    "const fs=require('fs');",
    `fs.writeFileSync(${JSON.stringify(markerPath)},'acquired');`,
    "process.exit(0);",
  ];
  const contenders = Array.from({ length: 2 }, () =>
    runLocked(
      lockPath,
      [process.execPath, "-e", command.join("")],
      {
        SERIAL_LOCK_MAX_WAIT_MS: "550",
        SERIAL_LOCK_WAIT_INTERVAL_MS: "100",
      },
    ),
  );

  try {
    assert.ok(survivorPid > 0, "surviving process group should have a PID");
    assert.ok(processIsRunning(survivorPid), "surviving process should be running");
    const results = await Promise.all(contenders.map(({ done }) => done));
    for (const result of results) {
      assert.equal(result.code, 1, "later checks must refuse takeover while cleanup work survives");
      assert.match(
        result.stdout + result.stderr,
        /surviving child process-group\/tree work/,
        "recovery should explain why the stale lock remains held",
      );
    }
    assert.ok(existsSync(lockPath), "stale lock must remain while the survivor owns the group");
    assert.ok(!existsSync(markerPath), "no later check may run concurrently with the survivor");

    process.kill(-survivorPid, "SIGKILL");
    assert.ok(
      await waitFor(() => !processIsRunning(survivorPid), 4_000),
      "surviving process group should terminate before takeover",
    );
    const recovered = runLocked(
      lockPath,
      [process.execPath, "-e", command.join("")],
      { SERIAL_LOCK_MAX_WAIT_MS: "2_000" },
    );
    const recoveredResult = await recovered.done;
    assert.equal(recoveredResult.code, 0, "lock should be reclaimable after cleanup is verified");
    assert.ok(existsSync(markerPath), "the post-cleanup check should run only after takeover is safe");
  } finally {
    try { process.kill(-survivorPid, "SIGKILL"); } catch { /* already gone */ }
    survivor.kill("SIGKILL");
    cleanup(markerPath);
    cleanup(lockPath);
  }
});

await test("serial-lock forwards child exit code correctly", async () => {
  const lockPath = tempLockPath();
  try {
    const { done } = runLocked(lockPath, [process.execPath, "-e", "process.exit(42)"]);
    const result = await done;
    assert.equal(result.code, 42, `expected exit code 42, got ${result.code}`);
  } finally {
    cleanup(lockPath);
  }
});

await test("collision harness removes its isolated fixture after SIGTERM", async () => {
  const proc = spawn(process.execPath, [COLLISION_SCRIPT], {
    cwd: resolve(__dirname, "../.."),
    env: {
      ...process.env,
      TASK_PLAN_FILE: "",
      CI_COLLISION_TEST_HOLD_MS: "10_000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stderr!.on("data", (data: Buffer) => { output += data.toString(); });

  const fixturePath = await new Promise<string>((resolveFixture, rejectFixture) => {
    const timer = setTimeout(() => {
      rejectFixture(new Error(`collision harness did not reach its interruptible phase:\n${output}`));
    }, 5_000);
    let announcedFixture: string | null = null;
    const onData = (data: Buffer) => {
      output += data.toString();
      const match = output.match(/\[ci-collision-test\] Temporary fixture: (.+)/);
      if (match) announcedFixture = match[1].trim();
      if (
        announcedFixture &&
        output.includes("[ci-collision-test] All validation entry routes spawned.")
      ) {
        clearTimeout(timer);
        proc.stdout!.off("data", onData);
        resolveFixture(announcedFixture);
      }
    };
    proc.stdout!.on("data", onData);
    proc.once("close", (code, signal) => {
      clearTimeout(timer);
      rejectFixture(new Error(
        `collision harness exited before interruption (code ${code}, signal ${signal}):\n${output}`,
      ));
    });
  });

  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult) => {
    proc.once("close", (code, signal) => resolveResult({ code, signal }));
    proc.kill("SIGTERM");
  });

  assert.equal(result.code, 143, `SIGTERM should preserve the harness status (output:\n${output})`);
  assert.equal(result.signal, null, "the harness should translate SIGTERM into an exit code");
  assert.match(output, /Interrupted by SIGTERM/);
  assert.ok(!existsSync(fixturePath), "interrupted cleanup should remove the lock and waiter fixture");
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`Failed tests: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("All serial-lock heartbeat tests passed.");
