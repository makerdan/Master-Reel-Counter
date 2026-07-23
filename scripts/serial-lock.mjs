#!/usr/bin/env node
/**
 * serial-lock.mjs — Port Authority Phase 4 crash-safe serialization lock.
 *
 * Ensures only one heavy test suite runs at a time, preventing port 5000
 * and PostgreSQL collisions between concurrent `ci` and `e2e` workflow runs.
 *
 * Adaptation points:
 *   LOCK_PATH       — path to the lockfile (default: /tmp/repl-test-suite.lock)
 *   LOCK_HOLDER_ENV — env var name that carries the holder PID for reentrancy
 *                     (default: SERIAL_LOCK_HOLDER_PID)
 *   WAIT_INTERVAL   — poll interval in ms while waiting for the lock (default: 2000)
 *   MAX_WAIT_MS     — max time to wait before giving up entirely (default: 10 min)
 *   MAX_HOLD_MS     — safety valve: forcibly clear a live-but-hung lock older
 *                     than this (default: 15 min)
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
 *  - Loud on forced takeover: forcibly cleared stale/dead locks are logged as
 *    incidents with full context; never silently absorbed.
 *  - Budgets start after acquisition: timeouts of the wrapped command start
 *    only after the lock is acquired, not during the wait.
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
  existsSync,
  statSync,
} from "fs";
import { spawnSync } from "child_process";

// ── Config ──────────────────────────────────────────────────────────────────
const LOCK_PATH = "/tmp/repl-test-suite.lock";
const LOCK_HOLDER_ENV = "SERIAL_LOCK_HOLDER_PID";
const WAIT_INTERVAL = 2_000;
const MAX_WAIT_MS = 10 * 60 * 1_000;
const MAX_HOLD_MS = 15 * 60 * 1_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse `--` separator; everything after it is the command to run. */
function parseArgs() {
  const sep = process.argv.indexOf("--");
  if (sep === -1 || sep === process.argv.length - 1) {
    console.error("[serial-lock] Usage: node scripts/serial-lock.mjs -- <command> [args...]");
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

/** Read the lockfile; return { pid, acquiredAt } or null on any error. */
function readLock() {
  try {
    const raw = readFileSync(LOCK_PATH, "utf8").trim();
    const [pidStr, tsStr] = raw.split("\n");
    const pid = parseInt(pidStr, 10);
    const acquiredAt = parseInt(tsStr, 10);
    if (!isNaN(pid) && !isNaN(acquiredAt)) return { pid, acquiredAt };
  } catch {
    // Missing or unreadable — no current lock
  }
  return null;
}

/** Write the lockfile atomically-ish (single write call). */
function writeLock(pid) {
  writeFileSync(LOCK_PATH, `${pid}\n${Date.now()}\n`, "utf8");
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
    // prevent deadlock.  Just run the command directly.
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
      // Double-check we won the race (last writer wins — tolerable for our use case
      // since concurrent writes here are both in the "no lock" branch and only
      // one PID will match after the second read).
      const verify = readLock();
      if (verify && verify.pid === process.pid) {
        return; // We own it.
      }
      // Lost a race; fall through and wait.
    } else {
      const { pid: holderPid, acquiredAt } = lock;
      const heldMs = Date.now() - acquiredAt;

      if (!isAlive(holderPid)) {
        // Holder is dead — forced takeover.
        console.error(
          `\n[serial-lock] INCIDENT: lock held by PID ${holderPid} (acquired ${Math.round(heldMs / 1000)}s ago) is no longer alive.` +
          ` Forcing takeover for PID ${process.pid}.\n`
        );
        clearLock();
        writeLock(process.pid);
        const verify = readLock();
        if (verify && verify.pid === process.pid) return;
      } else if (heldMs > MAX_HOLD_MS) {
        // Holder is alive but hung beyond the safety valve.
        console.error(
          `\n[serial-lock] INCIDENT: lock held by PID ${holderPid} for ${Math.round(heldMs / 1000)}s` +
          ` exceeds MAX_HOLD_MS (${MAX_HOLD_MS / 1000}s). Forcing takeover for PID ${process.pid}.\n`
        );
        clearLock();
        writeLock(process.pid);
        const verify = readLock();
        if (verify && verify.pid === process.pid) return;
      } else {
        // Holder is alive and within budget — wait our turn.
        const elapsed = Date.now() - waitStart;
        if (elapsed >= MAX_WAIT_MS) {
          console.error(
            `[serial-lock] ERROR: waited ${Math.round(elapsed / 1000)}s for lock (MAX_WAIT_MS=${MAX_WAIT_MS / 1000}s). Aborting.`
          );
          process.exit(1);
        }
        console.log(
          `[serial-lock] waiting for lock held by PID ${holderPid}` +
          ` (held ${Math.round(heldMs / 1000)}s)… (elapsed ${Math.round(elapsed / 1000)}s)`
        );
      }
    }

    await sleep(WAIT_INTERVAL);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

await acquireLock();

console.log(`[serial-lock] PID ${process.pid} acquired lock. Running: ${cmdArgs.join(" ")}`);

// Export our PID so nested invocations can detect reentrancy.
process.env[LOCK_HOLDER_ENV] = String(process.pid);

// Release lock on any exit path.
function release() {
  const lock = readLock();
  if (lock && lock.pid === process.pid) {
    clearLock();
    console.log(`[serial-lock] PID ${process.pid} released lock.`);
  }
}

process.on("exit", release);
process.on("SIGINT", () => { release(); process.exit(130); });
process.on("SIGTERM", () => { release(); process.exit(143); });

// Run the wrapped command.
const [cmd, ...args] = cmdArgs;
const result = spawnSync(cmd, args, {
  stdio: "inherit",
  shell: false,
  env: process.env,
});

process.exit(result.status ?? 1);
