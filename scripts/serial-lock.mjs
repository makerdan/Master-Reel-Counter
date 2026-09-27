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
  ftruncateSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  realpathSync,
  unlinkSync,
  writeSync,
  writeFileSync,
  statSync,
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

function readLinuxProcessInfo(pid) {
  if (process.platform !== "linux" || !Number.isInteger(pid) || pid <= 0) {
    return { kind: "unsupported" };
  }
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = raw.lastIndexOf(")");
    if (commandEnd < 0) return { kind: "unknown" };
    const fields = raw.slice(commandEnd + 1).trim().split(/\s+/);
    const processGroupId = Number(fields[2]);
    const startTime = Number(fields[19]);
    if (!Number.isInteger(processGroupId) || !Number.isInteger(startTime) || startTime < 0) {
      return { kind: "unknown" };
    }
    return { kind: "present", processGroupId, startTime };
  } catch (error) {
    return error?.code === "ENOENT" ? { kind: "absent" } : { kind: "unknown" };
  }
}

function getProcessIdentity(pid) {
  const info = readLinuxProcessInfo(pid);
  return info.kind === "present" ? { pid, startTime: info.startTime } : null;
}

function normalizeProcessIdentity(value, expectedPid = null) {
  if (!value || typeof value !== "object") return null;
  if (
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
    !Number.isInteger(value.startTime) ||
    value.startTime < 0 ||
    (expectedPid !== null && value.pid !== expectedPid)
  ) {
    return null;
  }
  return { pid: value.pid, startTime: value.startTime };
}

function isRecordedProcessRunning(pid, identity) {
  if (!identity || process.platform !== "linux") return isRunning(pid);
  const current = readLinuxProcessInfo(pid);
  if (current.kind === "present") return current.startTime === identity.startTime;
  if (current.kind === "absent") return isAlive(pid);
  return isRunning(pid);
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
  const root = String(pid);
  const descendants = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [candidate, parent] of parents) {
      if ((parent === root || descendants.has(parent)) && !descendants.has(candidate)) {
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

function isProcessGroupRunning(processGroupId) {
  if (process.platform === "win32" || !Number.isInteger(processGroupId) || processGroupId <= 0) {
    return false;
  }
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function hasSurvivingOwnership(lock) {
  const ownership = lock?.ownership;
  if (!ownership) return false;
  if (isProcessGroupRunning(ownership.processGroupId)) {
    const groupIdentity = ownership.processGroupIdentity;
    if (!groupIdentity || process.platform !== "linux") return true;

    const leader = readLinuxProcessInfo(ownership.processGroupId);
    if (leader.kind !== "present") {
      // Without the group leader's identity, retain the existing fail-closed
      // behavior: the numeric group may still contain the original work.
      return true;
    }
    if (
      leader.startTime === groupIdentity.startTime &&
      leader.processGroupId === ownership.processGroupId
    ) {
      return true;
    }
  }

  const identities = new Map(
    ownership.observedChildProcessIdentities.map((identity) => [identity.pid, identity]),
  );
  return ownership.observedChildPids.some((pid) =>
    isRecordedProcessRunning(pid, identities.get(pid)),
  );
}

function isLockHolderRunning(lock) {
  return isRecordedProcessRunning(lock.pid, lock.holderIdentity);
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
const HELD_FD_ENV = `VALIDATION_LOCK_ATTESTATION_HOLDER_FD_${RESOURCE_ENV}`;
const ATTESTATION_FD_ENV = "VALIDATION_LOCK_ATTESTATION_FD";
const LOCK_PATH = resolve(
  process.env.VALIDATION_LOCK_FILE ??
    process.env.SERIAL_LOCK_PATH ??
    `.local/validation-lock-${RESOURCE}.lock`,
);
const WAITERS_DIR = resolve(
  process.env.VALIDATION_LOCK_WAITERS_DIR ??
    `.local/validation-waiters-${RESOURCE}`,
);
let storageInitializationError = null;
try {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });
  mkdirSync(WAITERS_DIR, { recursive: true });
} catch (error) {
  storageInitializationError = `unable to initialize lock storage: ${error?.message ?? "unknown error"}`;
}

function atomicWrite(path, content) {
  const temporaryPath = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, path);
}

const LOCK_TOKEN = randomBytes(16).toString("hex");
let holderLockFd = null;

function emptyOwnership() {
  return {
    childPid: null,
    processGroupId: null,
    processGroupIdentity: null,
    observedChildPids: [],
    observedChildProcessIdentities: [],
    cleanupPending: false,
  };
}

function normalizeOwnership(value) {
  if (!value || typeof value !== "object") return emptyOwnership();
  const positiveInteger = (candidate) =>
    Number.isInteger(candidate) && candidate > 0 ? candidate : null;
  return {
    childPid: positiveInteger(value.childPid),
    processGroupId: positiveInteger(value.processGroupId),
    processGroupIdentity: normalizeProcessIdentity(
      value.processGroupIdentity,
      positiveInteger(value.processGroupId),
    ),
    observedChildPids: Array.isArray(value.observedChildPids)
      ? [...new Set(value.observedChildPids.map(positiveInteger).filter(Boolean))]
      : [],
    observedChildProcessIdentities: Array.isArray(value.observedChildProcessIdentities)
      ? [...new Map(
        value.observedChildProcessIdentities
          .map((identity) => normalizeProcessIdentity(identity))
          .filter(Boolean)
          .map((identity) => [identity.pid, identity]),
      ).values()]
      : [],
    cleanupPending: value.cleanupPending === true,
  };
}

function lockContent(
  acquiredAt,
  lastHeartbeat = acquiredAt,
  ownership = emptyOwnership(),
  holderIdentity = getProcessIdentity(process.pid),
) {
  return `${String(process.pid).padStart(12, "0")}\n` +
    `${String(acquiredAt).padStart(16, "0")}\n` +
    `${String(lastHeartbeat).padStart(16, "0")}\n` +
    `${LOCK_TOKEN}\n` +
    `${JSON.stringify(normalizeOwnership(ownership))}\n` +
    `${JSON.stringify(normalizeProcessIdentity(holderIdentity, process.pid))}\n`;
}

function writeLockToFd(fd, content) {
  writeSync(fd, content, 0, "utf8");
  ftruncateSync(fd, Buffer.byteLength(content));
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
        ownership: normalizeOwnership(parsed.ownership),
          holderIdentity: normalizeProcessIdentity(parsed.holderIdentity, parsed.pid),
      };
    }
      const [pid, acquiredAt, lastHeartbeat, token, ownershipRaw, holderIdentityRaw] =
        trimmed.split("\n");
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
      ownership: (() => {
        try {
          return normalizeOwnership(ownershipRaw ? JSON.parse(ownershipRaw) : null);
        } catch {
          return emptyOwnership();
        }
      })(),
      holderIdentity: (() => {
        try {
          return normalizeProcessIdentity(
            holderIdentityRaw ? JSON.parse(holderIdentityRaw) : null,
            numericPid,
          );
        } catch {
          return null;
        }
      })(),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return {
      kind: "unusable",
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

function lockPathMatchesDescriptor(fd) {
  if (fd === null) return false;
  try {
    const pathStat = statSync(LOCK_PATH);
    const descriptorStat = fstatSync(fd);
    return pathStat.dev === descriptorStat.dev && pathStat.ino === descriptorStat.ino;
  } catch {
    return false;
  }
}

function clearLock(expected, ownerFd = null) {
  const current = readLock();
  if (!sameLock(current, expected)) return false;
  if (ownerFd !== null && !lockPathMatchesDescriptor(ownerFd)) return false;
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
    failStorage(`unable to create lock file: ${error?.message ?? "unknown error"}`);
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
      lock.token === LOCK_TOKEN &&
      lockPathMatchesDescriptor(holderLockFd)
    ) {
      writeLockToFd(
        holderLockFd,
        lockContent(lock.acquiredAt, Date.now(), lock.ownership, lock.holderIdentity),
      );
      return true;
    }
  } catch {
    // The caller stops protected work when a heartbeat cannot be persisted.
  }
  return false;
}

function hasCurrentLockOwnership() {
  const lock = readLock();
  return (
    holderLockFd !== null &&
    lock?.kind === "valid" &&
    lock.pid === process.pid &&
    lock.token === LOCK_TOKEN &&
    lockPathMatchesDescriptor(holderLockFd)
  );
}

function reportLockOwnershipLost() {
  if (lockOwnershipLost) return;
  lockOwnershipLost = true;
  clearInterval(heartbeatTimer);
  console.error(
    `[serial-lock] ERROR: lock ownership lost for resource '${RESOURCE}'; ` +
    "heartbeat update failed. Stopping protected work.",
  );
}

function updateOwnership(ownership) {
  try {
    const lock = readLock();
    if (
      holderLockFd !== null &&
      lock?.kind === "valid" &&
      lock.pid === process.pid &&
      lock.token === LOCK_TOKEN
    ) {
      writeLockToFd(
        holderLockFd,
        lockContent(
          lock.acquiredAt,
          Date.now(),
          normalizeOwnership(ownership),
          lock.holderIdentity,
        ),
      );
    }
  } catch {
    // A failed ownership update leaves the lock recoverable through its last known metadata.
  }
}

function waiterPath(pid = process.pid) {
  return `${WAITERS_DIR}/${pid}.json`;
}

function writeWaiter() {
  try {
    atomicWrite(
      waiterPath(),
      `${JSON.stringify({
        pid: process.pid,
        processIdentity: getProcessIdentity(process.pid),
        resource: RESOURCE,
        priority: args.priority,
        queuedAt: Date.now(),
        command: args.command,
      })}\n`,
    );
  } catch (error) {
    failStorage(`unable to write waiter manifest: ${error?.message ?? "unknown error"}`);
  }
}

function clearWaiter() {
  try {
    unlinkSync(waiterPath());
  } catch {
    // Already gone.
  }
}

function failStorage(reason) {
  console.error(
    `[serial-lock] ERROR: lock storage is unusable for resource '${RESOURCE}': ${reason}`,
  );
  clearWaiter();
  process.exit(1);
}

function readWaiters() {
  try {
    return readdirSync(WAITERS_DIR)
      .filter((file) => file.endsWith(".json"))
      .map((file) => {
        const path = `${WAITERS_DIR}/${file}`;
        try {
          const raw = readFileSync(path, "utf8");
          return { manifest: JSON.parse(raw), path, raw };
        } catch {
          return null;
        }
      })
      .filter((entry) => entry && entry.manifest?.pid !== process.pid);
  } catch {
    return [];
  }
}

function isWaiterRunning(waiter) {
  const identity = normalizeProcessIdentity(waiter.processIdentity, waiter.pid);
  // Manifests written before process identities were added remain authoritative
  // while their PID is running; only a recorded identity mismatch proves reuse.
  if (!identity) return isRunning(waiter.pid);
  return isRecordedProcessRunning(waiter.pid, identity);
}

function higherPriorityWaiterIsDue() {
  const now = Date.now();
  for (const entry of readWaiters()) {
    const waiter = entry.manifest;
    if (!isWaiterRunning(waiter)) {
      try {
        // Do not remove a new manifest atomically written after this snapshot.
        if (readFileSync(entry.path, "utf8") === entry.raw) unlinkSync(entry.path);
      } catch { /* already gone or storage changed */ }
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
  const stdio = Number.isInteger(inheritedCapabilityFd) && inheritedCapabilityFd >= 3
    ? ["inherit", "inherit", "inherit", inheritedCapabilityFd]
    : "inherit";
  const result = spawnSync(command, commandArgs, {
    stdio,
    shell: false,
    env: process.env,
  });
  process.exit(result.status ?? (result.signal ? 1 : 0));
}

const inheritedHolder = process.env[HELD_PID_ENV] ??
  (RESOURCE === DEFAULT_RESOURCE ? process.env[LEGACY_HOLDER_ENV] : undefined);
const inheritedLock = readLock();
let inheritedAttestation = null;
let inheritedCapabilityMatchesHolder = false;
let inheritedCapabilityFd = null;
function inspectInheritedCapability(fd) {
  const buffer = Buffer.alloc(4096);
  const bytes = readSync(fd, buffer, 0, buffer.length, 0);
  const attestation = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
  const localStat = fstatSync(fd);
  const holderStat = statSync(`/proc/${attestation.holderPid}/fd/${attestation.holderFd}`);
  const holderCommand = readFileSync(`/proc/${attestation.holderPid}/cmdline`, "utf8").split("\0");
  return {
    attestation,
    matches:
      localStat.dev === holderStat.dev &&
      localStat.ino === holderStat.ino &&
      realpathSync(`/proc/${attestation.holderPid}/exe`) === realpathSync(process.execPath) &&
      resolve(holderCommand[1] ?? "") === resolve(import.meta.dirname, "serial-lock.mjs"),
  };
}
try {
  let fd = Number(process.env[ATTESTATION_FD_ENV]);
  let inspected;
  if (Number.isInteger(fd) && fd >= 3) {
    try {
      inspected = inspectInheritedCapability(fd);
    } catch {
      inspected = null;
    }
  }
  if (!inspected) {
    const holderFd = Number(process.env[HELD_FD_ENV]);
    fd = openSync(`/proc/${Number(inheritedHolder)}/fd/${holderFd}`, "r");
    inspected = inspectInheritedCapability(fd);
  }
  inheritedCapabilityFd = fd;
  inheritedAttestation = inspected.attestation;
  inheritedCapabilityMatchesHolder = inspected.matches;
} catch {
  // Missing or malformed inherited capability disables reentrant execution.
}
if (
  inheritedHolder &&
  getAncestors().has(String(Number(inheritedHolder))) &&
  inheritedLock?.kind === "valid" &&
  inheritedLock.pid === Number(inheritedHolder) &&
  inheritedLock.token === inheritedAttestation?.token &&
  inheritedCapabilityMatchesHolder &&
  inheritedAttestation?.holderPid === Number(inheritedHolder) &&
  inheritedAttestation?.resource === RESOURCE &&
  inheritedAttestation?.lockPath === LOCK_PATH
) {
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
  if (storageInitializationError) failStorage(storageInitializationError);
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
    } else if (lock.kind === "unusable") {
      failStorage(lock.reason);
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
      const holderIsRunning = isLockHolderRunning(lock);
      if (!holderIsRunning) takeoverReason = "holder PID is dead or has been reused";
      else if (heartbeatAgeMs > HEARTBEAT_STALE_MS) takeoverReason = "heartbeat is stale";
      else if (heldMs > MAX_HOLD_MS) takeoverReason = "maximum hold duration exceeded";

      const survivingOwnership = hasSurvivingOwnership(lock);
      const mustPreserveSurvivor =
        survivingOwnership && (!holderIsRunning || lock.ownership.cleanupPending);
      if (takeoverReason && mustPreserveSurvivor) {
        const waitedMs = waitElapsed();
        if (waitedMs >= MAX_WAIT_MS) {
          failWait(waitedMs);
        }
        if (!waiterWritten) {
          writeWaiter();
          waiterWritten = true;
        }
        console.log(
          `[serial-lock] waiting for resource '${RESOURCE}' because stale holder PID ${lock.pid} ` +
          `still has surviving child process-group/tree work (elapsed ${Math.round(waitedMs / 1000)}s)`,
        );
      } else if (takeoverReason) {
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
const attestationPath = `${LOCK_PATH}.${LOCK_TOKEN}.attestation`;
const attestationFd = openSync(attestationPath, "w+", 0o600);
writeFileSync(attestationFd, JSON.stringify({
  holderPid: process.pid,
  holderFd: attestationFd,
  token: LOCK_TOKEN,
  resource: RESOURCE,
  lockPath: LOCK_PATH,
}), { mode: 0o600 });
unlinkSync(attestationPath);
process.env[ATTESTATION_FD_ENV] = "3";
process.env[HELD_FD_ENV] = String(attestationFd);

let lockOwnershipLost = false;
let heartbeatTimer;
heartbeatTimer = setInterval(() => {
  if (writeHeartbeat()) return;
  reportLockOwnershipLost();
  void terminateChild("lock ownership lost (heartbeat update failed)");
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();
let released = false;
function release() {
  if (released) return !lockOwnershipLost;
  released = true;
  clearInterval(heartbeatTimer);
  const lock = readLock();
  let releasedOwnedLock = false;
  if (
    lock?.kind === "valid" &&
    lock.pid === process.pid &&
    lock.token === LOCK_TOKEN &&
    lockPathMatchesDescriptor(holderLockFd)
  ) {
    if (clearLock(lock, holderLockFd)) {
      console.log(`[serial-lock] PID ${process.pid} released lock for resource '${RESOURCE}'.`);
      releasedOwnedLock = true;
    } else {
      reportLockOwnershipLost();
      console.error(
        `[serial-lock] WARNING: unable to safely remove lock state for resource '${RESOURCE}'.`,
      );
    }
  } else {
    reportLockOwnershipLost();
    console.error(
      `[serial-lock] WARNING: lock storage changed before release for resource '${RESOURCE}'; ` +
      "leaving replacement state untouched.",
    );
  }
  if (holderLockFd !== null) {
    closeSync(holderLockFd);
    holderLockFd = null;
  }
  closeSync(attestationFd);
  clearWaiter();
  return releasedOwnedLock && !lockOwnershipLost;
}

const [command, ...commandArgs] = args.command;
const child = spawn(command, commandArgs, {
  stdio: ["inherit", "inherit", "inherit", attestationFd],
  shell: false,
  env: process.env,
  detached: process.platform !== "win32",
});
let timeoutTimer;
let timedOut = false;
let interruptedSignal = null;
let cleanupPromise = null;
const observedChildPids = new Set(child.pid ? [child.pid] : []);
const observedChildProcessIdentities = new Map();

function rememberChildProcessIdentity(pid) {
  if (!observedChildProcessIdentities.has(pid)) {
    const identity = getProcessIdentity(pid);
    if (identity) observedChildProcessIdentities.set(pid, identity);
  }
}

if (child.pid) rememberChildProcessIdentity(child.pid);

function observeChildTree() {
  if (!child.pid) return;
  const parents = getProcessParents();
  for (const pid of getDescendants(String(child.pid), parents)) {
    const numericPid = Number(pid);
    observedChildPids.add(numericPid);
    rememberChildProcessIdentity(numericPid);
  }
}

function persistChildOwnership(cleanupPending = false) {
  const processGroupId = process.platform === "win32" ? null : child.pid ?? null;
  updateOwnership({
    childPid: child.pid ?? null,
    processGroupId,
    processGroupIdentity: processGroupId
      ? observedChildProcessIdentities.get(processGroupId) ?? null
      : null,
    observedChildPids: [...observedChildPids],
    observedChildProcessIdentities: [...observedChildProcessIdentities.values()],
    cleanupPending,
  });
}

observeChildTree();
persistChildOwnership();

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
    persistChildOwnership(true);
    console.error(
      `[serial-lock] INCIDENT: terminating resource '${RESOURCE}' command after ${reason}.`,
    );
    signalProcessGroup(child.pid, initialSignal);
    for (const pid of observedChildPids) signalPid(pid, initialSignal);

    let cleaned = await waitForChildCleanup();
    if (!cleaned) {
      observeChildTree();
      persistChildOwnership(true);
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
  if (!hasCurrentLockOwnership()) reportLockOwnershipLost();
  const cleanupVerified = interruptedSignal || timedOut || lockOwnershipLost
    ? await terminateChild(
      timedOut
        ? `timeout (${args.timeoutMs}ms)`
        : interruptedSignal
          ? `signal ${interruptedSignal}`
          : "lock ownership lost (heartbeat update failed)",
      interruptedSignal ?? "SIGTERM",
    )
    : true;
  const exitCode = timedOut
    ? 124
    : interruptedSignal
      ? 128 + ({ SIGINT: 2, SIGTERM: 15 }[interruptedSignal] ?? 1)
      : lockOwnershipLost
        ? 1
      : code ?? (signal ? 1 : 0);
  const releaseVerified = cleanupVerified ? release() : false;
  process.exit(cleanupVerified && releaseVerified ? exitCode : 1);
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