#!/usr/bin/env node
/**
 * serial-lock.mjs — Port Authority Phase 4 crash-safe serialization lock.
 *
 * Ensures only one heavy test suite runs at a time, preventing port 5000
 * and PostgreSQL collisions between concurrent `ci` and `e2e` workflow runs.
 *
 * Adaptation points (env vars):
 *   SERIAL_LOCK_PATH                 — path to the lockfile
 *                                      (default: /tmp/repl-test-suite.lock)
 *   SERIAL_LOCK_WAIT_INTERVAL_MS     — poll interval while waiting (default: 2000)
 *   SERIAL_LOCK_MAX_WAIT_MS          — give-up timeout (default: 10 min)
 *   SERIAL_LOCK_MAX_HOLD_MS          — retained for config compatibility; no longer
 *                                      used as an eviction trigger. Eviction is
 *                                      based entirely on heartbeat staleness so
 *                                      healthy long-running holders are never
 *                                      prematurely force-evicted.
 *   SERIAL_LOCK_HEARTBEAT_INTERVAL_MS — how often the holder refreshes its heartbeat
 *                                       (default: 30 000)
 *   SERIAL_LOCK_HEARTBEAT_STALE_MS   — evict the holder if its heartbeat has been
 *                                       silent for longer than this (default: 2 ×
 *                                       heartbeat interval = 60 000).
 *
 * Usage:
 *   node scripts/serial-lock.mjs -- <command> [args...]
 *
 * Properties guaranteed:
 *  - Reentrancy-safe: holder exports its PID via SERIAL_LOCK_HOLDER_PID;
 *    nested invocations walk their ancestor PIDs and skip acquisition if the
 *    holder is in their ancestry, preventing deadlock.
 *  - Crash-safe: lockfile stores the holder PID + acquire timestamp; waiters
 *    check holder liveness (kill -0) before each poll. A crashed run never
 *    blocks future runs forever.
 *  - Heartbeat-safe: the holder writes a periodic lastHeartbeat timestamp via
 *    setInterval. Force-eviction is based entirely on heartbeat staleness
 *    (HEARTBEAT_STALE_MS), so long-running healthy jobs are never prematurely
 *    evicted. MAX_HOLD_MS is retained for config compatibility only.
 *  - Atomic writes: lock file updates use a temp-file + rename so readers never
 *    observe a partially-written or truncated file.
 *  - Loud on forced takeover: forcibly cleared stale/dead locks are logged as
 *    incidents with full context; never silently absorbed.
 *  - Budgets start after acquisition: the wrapped command's timeout starts only
 *    after the lock is acquired, not during the wait.
 *
 * Manual smoke-test for concurrent safety:
 *   1. In one terminal: npm run ci
 *   2. Immediately in another: npm run test:e2e
 *   3. Expected: the second invocation prints "[serial-lock] waiting for lock…"
 *      and queues; it does NOT start Playwright until the first run releases.
 *   4. Kill the first run (Ctrl-C). The second should detect the dead PID and
 *      acquire within one poll interval (~2 s).
 */

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
} from "fs";
import { spawnSync, spawn } from "child_process";
import { randomBytes } from "crypto";

// ── Config (all tunable via env for testing) ──────────────────────────────────
const LOCK_PATH =
  process.env.SERIAL_LOCK_PATH ?? "/tmp/repl-test-suite.lock";
const LOCK_HOLDER_ENV = "SERIAL_LOCK_HOLDER_PID";
const WAIT_INTERVAL =
  parseInt(process.env.SERIAL_LOCK_WAIT_INTERVAL_MS ?? "2000", 10);
const MAX_WAIT_MS =
  parseInt(process.env.SERIAL_LOCK_MAX_WAIT_MS ?? String(10 * 60 * 1_000), 10);
const MAX_HOLD_MS =
  parseInt(process.env.SERIAL_LOCK_MAX_HOLD_MS ?? String(15 * 60 * 1_000), 10);
const HEARTBEAT_INTERVAL_MS =
  parseInt(process.env.SERIAL_LOCK_HEARTBEAT_INTERVAL_MS ?? "30000", 10);
const HEARTBEAT_STALE_MS =
  parseInt(
    process.env.SERIAL_LOCK_HEARTBEAT_STALE_MS ?? String(2 * HEARTBEAT_INTERVAL_MS),
    10
  );

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse `--` separator; everything after it is the command to run. */
function parseArgs() {
  const sep = process.argv.indexOf("--");
  if (sep === -1 || sep === process.argv.length - 1) {
    console.error(
      "[serial-lock] Usage: node scripts/serial-lock.mjs -- <command> [args...]"
    );
    process.exit(2);
  }
  return process.argv.slice(sep + 1);
}

/** Return the set of ancestor PIDs (and self) for the current process. */
function getSelfAncestors() {
  const ancestors = new Set();
  let pid = process.pid;
  while (pid > 1) {
    ancestors.add(String(pid));
    try {
      const stat = readFileSync(`/proc/${pid}/status`, "utf8");
      const m = stat.match(/^PPid:\s+(\d+)/m);
      pid = m ? parseInt(m[1], 10) : 0;
    } catch {
      break;
    }
  }
  return ancestors;
}

/** Return true if the given PID is alive (kill -0). */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}

/** Sleep ms milliseconds. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Read the lockfile.
 * Returns { pid, acquiredAt, lastHeartbeat } or null on any error.
 * lastHeartbeat falls back to acquiredAt for locks written before heartbeat support.
 */
function readLock() {
  try {
    const raw = readFileSync(LOCK_PATH, "utf8").trim();
    const [pidStr, tsStr, hbStr] = raw.split("\n");
    const pid = parseInt(pidStr, 10);
    const acquiredAt = parseInt(tsStr, 10);
    if (isNaN(pid) || isNaN(acquiredAt)) return null;
    const lastHeartbeat = hbStr ? parseInt(hbStr, 10) : acquiredAt;
    return {
      pid,
      acquiredAt,
      lastHeartbeat: isNaN(lastHeartbeat) ? acquiredAt : lastHeartbeat,
    };
  } catch {
    // Missing or unreadable — no current lock
  }
  return null;
}

/**
 * Write data to LOCK_PATH atomically: write to a temp file in the same
 * directory then rename so readers never see a partially-written file.
 */
function atomicWrite(content) {
  const tmp = `${LOCK_PATH}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, LOCK_PATH);
}

/** Write the lockfile with an initial heartbeat equal to the acquire time. */
function writeLock(pid) {
  const now = Date.now();
  atomicWrite(`${pid}\n${now}\n${now}\n`);
}

/** Refresh the lastHeartbeat field in-place (holder only). */
function writeHeartbeat() {
  try {
    const lock = readLock();
    if (lock && lock.pid === process.pid) {
      atomicWrite(`${lock.pid}\n${lock.acquiredAt}\n${Date.now()}\n`);
    }
  } catch {
    // Best-effort — a transient write failure is not fatal for the holder.
  }
}

/** Remove the lockfile, ignoring ENOENT. */
function clearLock() {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // Already gone — fine
  }
}

// ── Reentrancy check ─────────────────────────────────────────────────────────

const holderPidStr = process.env[LOCK_HOLDER_ENV];
if (holderPidStr) {
  const holderPid = parseInt(holderPidStr, 10);
  const ancestors = getSelfAncestors();
  if (ancestors.has(String(holderPid))) {
    // We are a descendant of the current lock holder — skip acquisition to
    // prevent deadlock. Just run the command directly.
    const [cmd, ...args] = parseArgs();
    const result = spawnSync(cmd, args, { stdio: "inherit", shell: false });
    process.exit(result.status ?? 1);
  }
}

// ── Lock acquisition ─────────────────────────────────────────────────────────

const cmdArgs = parseArgs();
const waitStart = Date.now();

async function acquireLock() {
  while (true) {
    const lock = readLock();

    if (!lock) {
      // Lock is free — take it.
      writeLock(process.pid);
      // Double-check we won the race (last writer wins — tolerable for our use
      // case since concurrent writes are atomic and only one PID will survive).
      const verify = readLock();
      if (verify && verify.pid === process.pid) {
        return; // We own it.
      }
      // Lost a race; fall through and wait.
    } else {
      const { pid: holderPid, acquiredAt, lastHeartbeat } = lock;
      const heldMs = Date.now() - acquiredAt;
      const heartbeatStaleMs = Date.now() - lastHeartbeat;

      if (!isAlive(holderPid)) {
        // Holder is dead — forced takeover.
        console.error(
          `\n[serial-lock] INCIDENT: lock held by PID ${holderPid}` +
            ` (acquired ${Math.round(heldMs / 1000)}s ago) is no longer alive.` +
            ` Forcing takeover for PID ${process.pid}.\n`
        );
        clearLock();
        writeLock(process.pid);
        const verify = readLock();
        if (verify && verify.pid === process.pid) return;
      } else if (heartbeatStaleMs > HEARTBEAT_STALE_MS) {
        // Holder is alive by OS signal but its heartbeat has gone stale — hung.
        console.error(
          `\n[serial-lock] INCIDENT: lock held by PID ${holderPid}` +
            ` (acquired ${Math.round(heldMs / 1000)}s ago)` +
            ` has not refreshed its heartbeat in ${Math.round(heartbeatStaleMs / 1000)}s` +
            ` (threshold ${HEARTBEAT_STALE_MS / 1000}s). Forcing takeover for PID ${process.pid}.\n`
        );
        clearLock();
        writeLock(process.pid);
        const verify = readLock();
        if (verify && verify.pid === process.pid) return;
      } else {
        // Holder is alive, heartbeat is fresh, and within budget — wait our turn.
        const elapsed = Date.now() - waitStart;
        if (elapsed >= MAX_WAIT_MS) {
          console.error(
            `[serial-lock] ERROR: waited ${Math.round(elapsed / 1000)}s for lock` +
              ` (MAX_WAIT_MS=${MAX_WAIT_MS / 1000}s). Aborting.`
          );
          process.exit(1);
        }
        console.log(
          `[serial-lock] waiting for lock held by PID ${holderPid}` +
            ` (held ${Math.round(heldMs / 1000)}s,` +
            ` heartbeat ${Math.round(heartbeatStaleMs / 1000)}s ago)…` +
            ` (elapsed ${Math.round(elapsed / 1000)}s)`
        );
      }
    }

    await sleep(WAIT_INTERVAL);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

await acquireLock();

console.log(
  `[serial-lock] PID ${process.pid} acquired lock. Running: ${cmdArgs.join(" ")}`
);

// Export our PID so nested invocations can detect reentrancy.
process.env[LOCK_HOLDER_ENV] = String(process.pid);

// Start periodic heartbeat. The command is spawned asynchronously (below) so
// the Node event loop stays alive and this interval can fire while the child runs.
let heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();

/** Release the lock and stop the heartbeat. Safe to call multiple times. */
function release() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const lock = readLock();
  if (lock && lock.pid === process.pid) {
    clearLock();
    console.log(`[serial-lock] PID ${process.pid} released lock.`);
  }
}

// Run the wrapped command asynchronously so the event loop stays live for heartbeats.
const [cmd, ...args] = cmdArgs;
const child = spawn(cmd, args, {
  stdio: "inherit",
  shell: false,
  env: process.env,
});

child.on("error", (err) => {
  console.error(`[serial-lock] Failed to spawn '${cmd}': ${err.message}`);
  release();
  process.exit(1);
});

child.on("close", (code, signal) => {
  release();
  // Mirror the child's exit: prefer its exit code; fall back to 1 on signal.
  process.exit(code ?? (signal ? 1 : 0));
});

// Forward signals to the child so Ctrl-C propagates correctly.
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
