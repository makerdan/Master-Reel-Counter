#!/usr/bin/env node
/**
 * Canonical Port Authority validation lock.
 *
 * Usage:
 *   node scripts/serial-lock.mjs [--resource name] [--priority 1-9]
 *     [--timeout-ms milliseconds] -- <command> [args...]
 *
 * The lock is striped by named resource. A holder heartbeat keeps healthy
 * long-running checks alive; dead, stale, or overlong holders are reclaimed
 * loudly. Waiters are represented by JSON manifests so priority decisions are
 * observable and deterministic.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from "fs";
import { spawn, spawnSync } from "child_process";
import { randomBytes } from "crypto";
import { dirname, resolve } from "path";

const LEGACY_HOLDER_ENV = "SERIAL_LOCK_HOLDER_PID";
const DEFAULT_RESOURCE = "global";
const WAIT_INTERVAL_MS = parseEnvInt("SERIAL_LOCK_WAIT_INTERVAL_MS", 2000);
const MAX_WAIT_MS = parseEnvInt("SERIAL_LOCK_MAX_WAIT_MS", 10 * 60 * 1000);
const MAX_HOLD_MS = parseEnvInt("SERIAL_LOCK_MAX_HOLD_MS", 2 * 60 * 60 * 1000);
const HEARTBEAT_INTERVAL_MS = parseEnvInt("SERIAL_LOCK_HEARTBEAT_INTERVAL_MS", 30_000);
const HEARTBEAT_STALE_MS = parseEnvInt(
  "SERIAL_LOCK_HEARTBEAT_STALE_MS",
  2 * HEARTBEAT_INTERVAL_MS,
);
const PRIORITY_GRACE_MS = parseEnvInt("SERIAL_LOCK_PRIORITY_GRACE_MS", 2_000);
const CLEANUP_GRACE_MS = parseEnvInt("SERIAL_LOCK_CLEANUP_GRACE_MS", 2_000);
const CLEANUP_POLL_INTERVAL_MS = parseEnvInt(
  "SERIAL_LOCK_CLEANUP_POLL_INTERVAL_MS",
  50,
);

function parseEnvInt(name, fallback) {
  const value = process.env[name];
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`[serial-lock] ERROR: ${name} must be a non-negative integer.`);
    process.exit(2);
  }
  return parsed;
}

function normalizeResource(value) {
  if (!value || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    console.error(`[serial-lock] ERROR: invalid resource '${value ?? ""}'.`);
    process.exit(2);
  }
  return value.toLowerCase();
}

function parseArgs() {
  const separator = process.argv.indexOf("--");
  if (separator < 0 || separator === process.argv.length - 1) {
    console.error(
      "[serial-lock] Usage: node scripts/serial-lock.mjs [options] -- <command> [args...]",
    );
    process.exit(2);
  }

  const options = process.argv.slice(2, separator);
  let resource = DEFAULT_RESOURCE;
  let priority = process.env.SERIAL_LOCK_PRIORITY === undefined
    ? 5
    : Number.parseInt(process.env.SERIAL_LOCK_PRIORITY, 10);
  let timeoutMs = 0;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--resource") resource = normalizeResource(options[++index]);
    else if (option === "--priority") priority = Number.parseInt(options[++index], 10);
    else if (option === "--timeout-ms") timeoutMs = Number.parseInt(options[++index], 10);
    else {
      console.error(`[serial-lock] ERROR: unknown option '${option}'.`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(priority) || priority < 1 || priority > 9) {
    console.error("[serial-lock] ERROR: priority must be from 1 (highest) to 9 (lowest).");
    process.exit(2);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
    console.error("[serial-lock] ERROR: timeout-ms must be a non-negative integer.");
    process.exit(2);
  }
  return {
    resource,
    priority,
    timeoutMs,
    command: process.argv.slice(separator + 1),
  };
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function getParentPid(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^PPid:\s+(\d+)/m);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function getProcessParents() {
  const parents = new Map();
  try {
    for (const pid of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
      const parent = getParentPid(pid);
      if (parent > 0) parents.set(pid, String(parent));
    }
  } catch {
    // Best effort; process-group cleanup remains authoritative where available.
  }
  return parents;
}

function getDescendants(pid, parents) {
  const descendants = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [candidate, parent] of parents) {
      if ((parent === String(pid) || descendants.has(parent)) && !descendants.has(candidate)) {
        descendants.add(candidate);
        changed = true;
      }
    }
  }
  return descendants;
}

function isRunning(pid) {
  if (!isAlive(pid)) return false;
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const state = status.match(/^State:\s+([A-Z])/m)?.[1];
    return state !== "Z";
  } catch {
    return isAlive(pid);
  }
}

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    console.error(`[serial-lock] WARNING: unable to send ${signal} to PID ${pid}: ${error.message}`);
    return false;
  }
}

function signalProcessGroup(pid, signal) {
  if (process.platform === "win32") return false;
  return signalPid(-pid, signal);
}

function getAncestors() {
  const ancestors = new Set();
  let pid = process.pid;
  while (pid > 1) {
    ancestors.add(String(pid));
    pid = getParentPid(pid);
  }
  return ancestors;
}

const args = parseArgs();
const RESOURCE = args.resource;
const RESOURCE_ENV = RESOURCE.toUpperCase().replace(/[^A-Z0-9]/g, "_");
const HELD_PID_ENV = `VALIDATION_LOCK_HELD_PID_${RESOURCE_ENV}`;
const LOCK_PATH = resolve(
  process.env.VALIDATION_LOCK_FILE ??
    process.env.SERIAL_LOCK_PATH ??
    `.local/validation-lock-${RESOURCE}.lock`,
);
const WAITERS_DIR = resolve(
  process.env.VALIDATION_LOCK_WAITERS_DIR ??
    `.local/validation-waiters-${RESOURCE}`,
);
mkdirSync(dirname(LOCK_PATH), { recursive: true });
mkdirSync(WAITERS_DIR, { recursive: true });

function atomicWrite(path, content) {
  const temporaryPath = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, path);
}

const LOCK_TOKEN = randomBytes(16).toString("hex");
let holderLockFd = null;

function lockContent(acquiredAt, lastHeartbeat = acquiredAt) {
  return `${String(process.pid).padStart(12, "0")}\n` +
    `${String(acquiredAt).padStart(16, "0")}\n` +
    `${String(lastHeartbeat).padStart(16, "0")}\n` +
    `${LOCK_TOKEN}\n`;
}

function writeLockToFd(fd, content) {
  writeSync(fd, content, 0, "utf8");
  fsyncSync(fd);
}

function readLock() {
  let raw = "";
  try {
    raw = readFileSync(LOCK_PATH, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) {
      return { kind: "malformed", raw, reason: "lock file is empty" };
    }
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      if (!Number.isInteger(parsed.pid) || !Number.isInteger(parsed.acquiredAt)) {
        return { kind: "malformed", raw, reason: "lock JSON is missing pid or acquiredAt" };
      }
      return {
        kind: "valid",
        raw,
        pid: parsed.pid,
        acquiredAt: parsed.acquiredAt,
        lastHeartbeat: Number.isInteger(parsed.lastHeartbeat)
          ? parsed.lastHeartbeat
          : parsed.acquiredAt,
        resource: parsed.resource ?? RESOURCE,
        token: typeof parsed.token === "string" ? parsed.token : null,
      };
    }
    const [pid, acquiredAt, lastHeartbeat, token] = trimmed.split("\n");
    const numericPid = Number(pid);
    const numericAcquiredAt = Number(acquiredAt);
    const numericLastHeartbeat = Number(lastHeartbeat);
    if (!Number.isInteger(numericPid) || !Number.isInteger(numericAcquiredAt)) {
      return { kind: "malformed", raw, reason: "lock file is missing numeric pid or acquiredAt" };
    }
    return {
      kind: "valid",
      raw,
      pid: numericPid,
      acquiredAt: numericAcquiredAt,
      lastHeartbeat: Number.isInteger(numericLastHeartbeat)
        ? numericLastHeartbeat
        : numericAcquiredAt,
      resource: RESOURCE,
      token: token || null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return {
      kind: "malformed",
      raw,
      reason: `unable to read lock file: ${error?.message ?? "unknown error"}`,
    };
  }
}

function sameLock(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "malformed") return left.raw === right.raw;
  if (left.token && right.token) return left.token === right.token;
  return (
    left.pid === right.pid &&
    left.acquiredAt === right.acquiredAt &&
    left.raw === right.raw
  );
}

function clearLock(expected) {
  const current = readLock();
  if (!sameLock(current, expected)) return false;
  try {
    unlinkSync(LOCK_PATH);
    return true;
  } catch {
    // Another contender may already have reclaimed it.
    return false;
  }
}

function tryCreateLock() {
  const now = Date.now();
  const temporaryPath = `${LOCK_PATH}.${LOCK_TOKEN}.tmp`;
  let descriptor = null;
  try {
    descriptor = openSync(temporaryPath, "wx");
    writeLockToFd(descriptor, lockContent(now));
    linkSync(temporaryPath, LOCK_PATH);
    unlinkSync(temporaryPath);
    holderLockFd = descriptor;
    descriptor = null;
    const lock = readLock();
    return lock?.kind === "valid" && lock.pid === process.pid && lock.token === LOCK_TOKEN;
  } catch (error) {
    if (error?.code === "EEXIST" || error?.code === "EISDIR") return false;
    throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    try { unlinkSync(temporaryPath); } catch { /* already gone */ }
  }
}

function writeHeartbeat() {
  try {
    const lock = readLock();
    if (
      holderLockFd !== null &&
      lock?.kind === "valid" &&
      lock.pid === process.pid &&
      lock.token === LOCK_TOKEN
    ) {
      writeLockToFd(holderLockFd, lockContent(lock.acquiredAt, Date.now()));
    }
  } catch {
    // A transient heartbeat write failure is handled by the stale recovery path.
  }
}

function waiterPath(pid = process.pid) {
  return `${WAITERS_DIR}/${pid}.json`;
}

function writeWaiter() {
  atomicWrite(
    waiterPath(),
    `${JSON.stringify({
      pid: process.pid,
      resource: RESOURCE,
      priority: args.priority,
      queuedAt: Date.now(),
      command: args.command,
    })}\n`,
  );
}

function clearWaiter() {
  try {
    unlinkSync(waiterPath());
  } catch {
    // Already gone.
  }
}

function readWaiters() {
  try {
    return readdirSync(WAITERS_DIR)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        try {
          return JSON.parse(readFileSync(`${WAITERS_DIR}/${file}`, "utf8"));
        } catch {
          return null;
        }
      })
      .filter((waiter) => waiter && waiter.pid !== process.pid);
  } catch {
    return [];
  }
}

function higherPriorityWaiterIsDue() {
  const now = Date.now();
  for (const waiter of readWaiters()) {
    if (!isAlive(waiter.pid)) {
      try { unlinkSync(waiterPath(waiter.pid)); } catch { /* already gone */ }
      continue;
    }
    if (
      Number.isInteger(waiter.priority) &&
      waiter.priority < args.priority &&
      now - Number(waiter.queuedAt) >= PRIORITY_GRACE_MS
    ) {
      return true;
    }
  }
  return false;
}

function runDirect() {
  const [command, ...commandArgs] = args.command;
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  process.exit(result.status ?? (result.signal ? 1 : 0));
}

const inheritedHolder = process.env[HELD_PID_ENV] ??
  (RESOURCE === DEFAULT_RESOURCE ? process.env[LEGACY_HOLDER_ENV] : undefined);
if (inheritedHolder && getAncestors().has(String(Number(inheritedHolder)))) {
  console.log(`[serial-lock] reentrant resource '${RESOURCE}'; running without reacquiring.`);
  runDirect();
}

let waiterWritten = false;
const waitStartedAt = Date.now();

function waitElapsed() {
  return Date.now() - waitStartedAt;
}

function failWait(waitedMs) {
  console.error(
    `[serial-lock] ERROR: waited ${Math.round(waitedMs / 1000)}s for resource '${RESOURCE}' ` +
    `(MAX_WAIT_MS=${Math.round(MAX_WAIT_MS / 1000)}s).`,
  );
  clearWaiter();
  process.exit(1);
}

async function acquireLock() {
  while (true) {
    const lock = readLock();
    if (!lock) {
      if (higherPriorityWaiterIsDue()) {
        const waitedMs = waitElapsed();
        if (waitedMs >= MAX_WAIT_MS) failWait(waitedMs);
        if (!waiterWritten) {
          writeWaiter();
          waiterWritten = true;
        }
        await sleep(WAIT_INTERVAL_MS);
        continue;
      }
      if (tryCreateLock()) return;
    } else if (lock.kind === "malformed") {
      const waitedMs = waitElapsed();
      if (waitedMs >= MAX_WAIT_MS) failWait(waitedMs);
      if (clearLock(lock)) {
        console.error(
          `[serial-lock] INCIDENT: reclaimed malformed lock for resource '${RESOURCE}' ` +
          `(${lock.reason}).`,
        );
        continue;
      }
      if (!waiterWritten) {
        writeWaiter();
        waiterWritten = true;
      }
      console.log(
        `[serial-lock] waiting for resource '${RESOURCE}' because its lock file is malformed` +
        ` (elapsed ${Math.round(waitedMs / 1000)}s)`,
      );
    } else {
      const heldMs = Date.now() - lock.acquiredAt;
      const heartbeatAgeMs = Date.now() - lock.lastHeartbeat;
      let takeoverReason = "";
      if (!isAlive(lock.pid)) takeoverReason = "holder PID is dead";
      else if (heartbeatAgeMs > HEARTBEAT_STALE_MS) takeoverReason = "heartbeat is stale";
      else if (heldMs > MAX_HOLD_MS) takeoverReason = "maximum hold duration exceeded";

      if (takeoverReason) {
        console.error(
          `\n[serial-lock] INCIDENT: reclaiming resource '${RESOURCE}' from PID ${lock.pid}; ` +
          `${takeoverReason} (held ${Math.round(heldMs / 1000)}s).\n`,
        );
        if (clearLock(lock) && tryCreateLock()) return;
      } else {
        const waitedMs = waitElapsed();
        if (waitedMs >= MAX_WAIT_MS) {
          failWait(waitedMs);
        }
        if (!waiterWritten) {
          writeWaiter();
          waiterWritten = true;
        }
        console.log(
          `[serial-lock] waiting for resource '${RESOURCE}' held by PID ${lock.pid}` +
          ` (held ${Math.round(heldMs / 1000)}s, heartbeat ${Math.round(heartbeatAgeMs / 1000)}s ago)` +
          ` (elapsed ${Math.round(waitedMs / 1000)}s)`,
        );
      }
    }
    await sleep(WAIT_INTERVAL_MS);
  }
}

await acquireLock();
clearWaiter();
console.log(
  `[serial-lock] PID ${process.pid} acquired lock for resource '${RESOURCE}'. ` +
  `Running: ${args.command.join(" ")}`,
);
process.env[LEGACY_HOLDER_ENV] = String(process.pid);
process.env[HELD_PID_ENV] = String(process.pid);

let heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();
let released = false;
function release() {
  if (released) return;
  released = true;
  clearInterval(heartbeatTimer);
  const lock = readLock();
  if (lock?.kind === "valid" && lock.pid === process.pid && lock.token === LOCK_TOKEN) {
    if (clearLock(lock)) {
      console.log(`[serial-lock] PID ${process.pid} released lock for resource '${RESOURCE}'.`);
    }
  }
  if (holderLockFd !== null) {
    closeSync(holderLockFd);
    holderLockFd = null;
  }
  clearWaiter();
}

const [command, ...commandArgs] = args.command;
const child = spawn(command, commandArgs, {
  stdio: "inherit",
  shell: false,
  env: process.env,
  detached: process.platform !== "win32",
});
let timeoutTimer;
let timedOut = false;
let interruptedSignal = null;
let cleanupPromise = null;
const observedChildPids = new Set(child.pid ? [child.pid] : []);

function observeChildTree() {
  if (!child.pid) return;
  const parents = getProcessParents();
  for (const pid of getDescendants(String(child.pid), parents)) {
    observedChildPids.add(Number(pid));
  }
}

function remainingChildPids() {
  return [...observedChildPids].filter((pid) => isRunning(pid));
}

async function waitForChildCleanup() {
  const deadline = Date.now() + CLEANUP_GRACE_MS;
  while (true) {
    observeChildTree();
    if (remainingChildPids().length === 0) return true;
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(CLEANUP_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
}

async function terminateChild(reason, initialSignal = "SIGTERM") {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    observeChildTree();
    console.error(
      `[serial-lock] INCIDENT: terminating resource '${RESOURCE}' command after ${reason}.`,
    );
    signalProcessGroup(child.pid, initialSignal);
    for (const pid of observedChildPids) signalPid(pid, initialSignal);

    let cleaned = await waitForChildCleanup();
    if (!cleaned) {
      observeChildTree();
      const survivors = remainingChildPids();
      console.error(
        `[serial-lock] INCIDENT: ${survivors.length} child process(es) survived ` +
        `${initialSignal}; escalating to SIGKILL.`,
      );
      signalProcessGroup(child.pid, "SIGKILL");
      for (const pid of survivors) signalPid(pid, "SIGKILL");
      cleaned = await waitForChildCleanup();
    }
    if (!cleaned) {
      console.error(
        `[serial-lock] ERROR: child process cleanup could not be verified; ` +
        `resource '${RESOURCE}' lock will remain for stale-holder recovery.`,
      );
    }
    return cleaned;
  })();
  return cleanupPromise;
}

async function finish(code, signal) {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  const cleanupVerified = interruptedSignal || timedOut
    ? await terminateChild(
      timedOut ? `timeout (${args.timeoutMs}ms)` : `signal ${interruptedSignal}`,
      interruptedSignal ?? "SIGTERM",
    )
    : true;
  const exitCode = timedOut
    ? 124
    : interruptedSignal
      ? 128 + ({ SIGINT: 2, SIGTERM: 15 }[interruptedSignal] ?? 1)
      : code ?? (signal ? 1 : 0);
  if (cleanupVerified) release();
  process.exit(cleanupVerified ? exitCode : 1);
}

if (args.timeoutMs > 0) {
  timeoutTimer = setTimeout(() => {
    if (timedOut || interruptedSignal) return;
    timedOut = true;
    void terminateChild(`timeout (${args.timeoutMs}ms)`);
  }, args.timeoutMs);
  timeoutTimer.unref();
}

child.on("error", (error) => {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  console.error(`[serial-lock] Failed to spawn '${command}': ${error.message}`);
  release();
  process.exit(1);
});
child.on("close", (code, signal) => {
  void finish(code, signal);
});

function handleInterruption(signal) {
  if (interruptedSignal || timedOut) return;
  interruptedSignal = signal;
  void terminateChild(`signal ${signal}`, signal);
}

process.on("SIGINT", () => handleInterruption("SIGINT"));
process.on("SIGTERM", () => handleInterruption("SIGTERM"));