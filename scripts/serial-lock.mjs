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
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
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

function readLock() {
  try {
    const raw = readFileSync(LOCK_PATH, "utf8").trim();
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      if (!Number.isInteger(parsed.pid) || !Number.isInteger(parsed.acquiredAt)) return null;
      return {
        pid: parsed.pid,
        acquiredAt: parsed.acquiredAt,
        lastHeartbeat: Number.isInteger(parsed.lastHeartbeat)
          ? parsed.lastHeartbeat
          : parsed.acquiredAt,
        resource: parsed.resource ?? RESOURCE,
      };
    }
    const [pid, acquiredAt, lastHeartbeat] = raw.split("\n").map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(acquiredAt)) return null;
    return {
      pid,
      acquiredAt,
      lastHeartbeat: Number.isInteger(lastHeartbeat) ? lastHeartbeat : acquiredAt,
      resource: RESOURCE,
    };
  } catch {
    return null;
  }
}

function writeLock() {
  const now = Date.now();
  atomicWrite(LOCK_PATH, `${process.pid}\n${now}\n${now}\n`);
}

function tryCreateLock() {
  try {
    const descriptor = openSync(LOCK_PATH, "wx");
    closeSync(descriptor);
    writeLock();
    return readLock()?.pid === process.pid;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

function clearLock() {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // Another contender may already have reclaimed it.
  }
}

function writeHeartbeat() {
  try {
    const lock = readLock();
    if (lock?.pid === process.pid) {
      atomicWrite(LOCK_PATH, `${process.pid}\n${lock.acquiredAt}\n${Date.now()}\n`);
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

async function acquireLock() {
  while (true) {
    const lock = readLock();
    if (!lock) {
      if (higherPriorityWaiterIsDue()) {
        if (!waiterWritten) {
          writeWaiter();
          waiterWritten = true;
        }
        await sleep(WAIT_INTERVAL_MS);
        continue;
      }
      if (tryCreateLock()) return;
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
        clearLock();
        if (tryCreateLock()) return;
      } else {
        const waitedMs = Date.now() - waitStartedAt;
        if (waitedMs >= MAX_WAIT_MS) {
          console.error(
            `[serial-lock] ERROR: waited ${Math.round(waitedMs / 1000)}s for resource '${RESOURCE}' ` +
            `(MAX_WAIT_MS=${Math.round(MAX_WAIT_MS / 1000)}s).`,
          );
          clearWaiter();
          process.exit(1);
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
  if (lock?.pid === process.pid) {
    clearLock();
    console.log(`[serial-lock] PID ${process.pid} released lock for resource '${RESOURCE}'.`);
  }
  clearWaiter();
}

const [command, ...commandArgs] = args.command;
const child = spawn(command, commandArgs, {
  stdio: "inherit",
  shell: false,
  env: process.env,
});
let timeoutTimer;
if (args.timeoutMs > 0) {
  timeoutTimer = setTimeout(() => {
    console.error(
      `[serial-lock] INCIDENT: resource '${RESOURCE}' command exceeded post-acquisition ` +
      `budget of ${args.timeoutMs}ms; terminating child.`,
    );
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2_000).unref();
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
  if (timeoutTimer) clearTimeout(timeoutTimer);
  release();
  process.exit(code ?? (signal ? 1 : 0));
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));