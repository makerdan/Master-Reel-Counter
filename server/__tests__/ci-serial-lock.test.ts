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
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCK_SCRIPT = resolve(__dirname, "../../scripts/serial-lock.mjs");

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
): { proc: ReturnType<typeof spawn>; done: Promise<{ code: number; stdout: string; stderr: string }> } {
  const proc = spawn(
    process.execPath,
    [LOCK_SCRIPT, "--resource", resource, "--priority", String(priority), "--", ...innerCmd],
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
function readLockFile(path: string): { pid: number; acquiredAt: number; lastHeartbeat: number } | null {
  try {
    const raw = readFileSync(path, "utf8").trim();
    const [pidStr, tsStr, hbStr] = raw.split("\n");
    const pid = parseInt(pidStr, 10);
    const acquiredAt = parseInt(tsStr, 10);
    if (isNaN(pid) || isNaN(acquiredAt)) return null;
    const lastHeartbeat = hbStr ? parseInt(hbStr, 10) : acquiredAt;
    return { pid, acquiredAt, lastHeartbeat: isNaN(lastHeartbeat) ? acquiredAt : lastHeartbeat };
  } catch { return null; }
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

await test("lock file has three lines: pid, acquiredAt, lastHeartbeat", async () => {
  const lockPath = tempLockPath();
  const { proc } = runLocked(lockPath, ["sleep", "5"]);

  try {
    // Poll until the lock file appears.
    const appeared = await waitFor(() => readLockFile(lockPath) !== null, 4_000);
    assert.ok(appeared, "lock file should appear once holder acquires");

    const lock = readLockFile(lockPath);
    assert.ok(lock !== null, "lock file must be readable");
    assert.ok(lock!.pid > 0, `pid should be positive (got ${lock!.pid})`);
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
    assert.equal(holderResult.code, 0);
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

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`Failed tests: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("All serial-lock heartbeat tests passed.");
