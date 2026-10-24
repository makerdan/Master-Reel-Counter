#!/usr/bin/env node
/**
 * Linux/local-filesystem cooperative validation lease v2.
 * Core: node validation-lock.mjs -- CMD...
 * Advanced: node validation-lock.mjs --advanced [--resource lowercase-name]
 *           [--priority 1-9] -- CMD...
 * The advanced switch selects features, not approval. Core rejects nesting.
 * Named locks (including "global") are independent, not hierarchical.
 * Env: VALIDATION_LOCK_FILE, VALIDATION_LOCK_WAITERS_DIR, *_POLL_MS,
 * *_TIMEOUT_MS (queue only), *_HEARTBEAT_MS, *_STALE_HEARTBEAT_MS,
 * *_MAX_HOLD_MS (execution), *_STOP_GRACE_MS, *_STOP_KILL_MS.
 * Reentry uses verified token/incarnation/path context, plus a nested sibling
 * slot. Legacy PID variables are never authorization. No command arguments
 * are logged. Unknown lifecycle/corrupt leases/abandoned transition mutexes
 * block and retain evidence for host-authorized recovery.
 * Commands must not daemonize or escape supervision. This is neither Failure
 * Gate's task single-flight/evidence system nor protection from malicious code.
 */
import {
  readFileSync, readdirSync, mkdirSync, rmdirSync, unlinkSync, openSync,
  closeSync, writeFileSync, fsyncSync, renameSync, realpathSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { classifyRuntimeEnvironment, readBoundedJSON } from "./runtime-environment.mjs";

// Private IPC-only workers. No CLI execution/authorization fallback. The gate
// cannot launch user work until the owner has durably registered its identity
// with an independently running watchdog. Both are cooperative, not a sandbox.
function workerProc(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
    return { pid, state: f[0], ppid: Number(f[1]), pgrp: Number(f[2]),
      session: Number(f[3]), startTime: f[19] };
  } catch (e) { if (["ENOENT", "ESRCH"].includes(e.code)) return null; throw e; }
}
const workerSame = (a, b) => a && b && a.pid === b.pid && a.startTime === b.startTime;
const workerLive = p => p && !["Z", "X"].includes(p.state);
const monotonicNs = () => process.hrtime.bigint();
async function privateWorker(mode) {
  if (!process.send || !process.connected) process.exit(2);
  if (mode === "--pa-workload-gate") {
    let dispatched = false, commandChild;
    // Retain the group leader during graceful termination. The watchdog owns
    // the group, and the normal wrapper still verifies exact owned identities.
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => {});
    process.on("disconnect", () => { if (!dispatched) process.exit(1); });
    process.on("message", m => {
      if (dispatched || m?.type !== "dispatch" || !Array.isArray(m.command) ||
          !m.command.length || m.command.some(a => typeof a !== "string")) return;
      dispatched = true;
      commandChild = spawn(m.command[0], m.command.slice(1), { stdio: "inherit", env: process.env });
      commandChild.once("error", () => process.exit(127));
      commandChild.once("exit", (code, signal) => {
        const finish = () => process.exit(signal ? 1 : code ?? 1);
        if (process.connected) process.send({ type: "command-exit", code, signal }, finish);
        else finish();
      });
    });
    process.send({ type: "gate-ready" });
    return;
  }
  const parent = workerProc(process.ppid);
  if (!parent) process.exit(4);
  let scope, stopAt, reason, quiet = false, busy = false;
  const observed = new Map();
  const delivered = new Set();
  const send = m => { if (process.connected) process.send(m, () => {}); };
  function snapshot() {
    const all = readdirSync("/proc").filter(n => /^\d+$/.test(n))
      .map(n => workerProc(Number(n))).filter(workerLive);
    const known = new Set([...observed.values()].filter(p =>
      all.some(a => workerSame(a, p))).map(p => p.pid));
    let added = true;
    while (added) {
      added = false;
      for (const p of all) if (p.pid !== process.pid &&
          ((p.pgrp === scope.root.pid && p.session === scope.root.pid) || known.has(p.ppid))) {
        if (!observed.has(`${p.pid}:${p.startTime}`)) {
          observed.set(`${p.pid}:${p.startTime}`, p); added = true;
        }
        known.add(p.pid);
      }
    }
    return all.filter(p => observed.has(`${p.pid}:${p.startTime}`));
  }
  function signalOwned(signal, all) {
    for (const p of all) {
      if (!workerSame(workerProc(p.pid), p)) continue;
      const key = `${signal}:${p.pid}:${p.startTime}`;
      if (delivered.has(key)) continue;
      console.error(JSON.stringify({ incident: "independent-watchdog-signal",
        pid: p.pid, startTime: p.startTime, signal }));
      try { process.kill(p.pid, signal); delivered.add(key); } catch (e) { if (e.code !== "ESRCH") throw e; }
    }
  }
  process.on("disconnect", () => { reason ??= "owner-disconnected"; });
  process.on("message", m => {
    if (m?.type === "register" && !scope) {
      try {
        const root = workerProc(m.root?.pid);
        if (!workerSame(root, m.root) || root.ppid !== parent.pid ||
            root.pgrp !== root.pid || root.session !== root.pid ||
            !/^\d+$/.test(m.deadlineNs) ||
            ![m.graceMs, m.killMs].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2147483647)) {
          throw new Error("watchdog scope invalid");
        }
        scope = m; observed.set(`${root.pid}:${root.startTime}`, root);
        send({ type: "registered", identity: workerProc(process.pid) });
      } catch { process.exit(4); }
    } else if (["disarm", "settle"].includes(m?.type) && scope) {
      try {
        if ((reason && !(m.type === "settle" && reason === "execution-budget")) ||
            snapshot().length) throw new Error("watchdog cannot confirm healthy quiescence");
        process.send({ type: "disarmed" }, () => { process.disconnect(); process.exit(0); });
      } catch { reason ??= "unsafe-disarm"; }
    }
  });
  // Independent from the owner's timers and original process group. An absent
  // scope cannot contain a running command: the gate has not been dispatched.
  const started = monotonicNs();
  setInterval(() => {
    if (busy) return;
    busy = true;
    try {
      const now = monotonicNs();
      if (!workerSame(workerProc(parent.pid), parent)) reason ??= "owner-dead";
      if (!scope) {
        if (reason || now - started >= 2000000000n) process.exit(reason ? 1 : 4);
        return;
      }
      const all = snapshot(); // continuously remember nested sessions/identities
      if (now >= BigInt(scope.deadlineNs)) reason ??= "execution-budget";
      if (!reason) return;
      stopAt ??= now;
      const elapsedMs = Number(now - stopAt) / 1e6;
      quiet = all.length === 0;
      console.error(JSON.stringify({ incident: "independent-watchdog-stop", reason,
        workloadStopped: quiet }));
      send({ type: "watchdog-stop", reason });
      if (quiet && !workerSame(workerProc(parent.pid), parent)) process.exit(1);
      signalOwned(elapsedMs < scope.graceMs ? "SIGTERM" : "SIGKILL", all);
      if (elapsedMs >= scope.graceMs + scope.killMs) {
        // The parent's already-written recoveryRequired lease remains. Never
        // unlink it, declare a PASS, or launch replacement work here.
        if (workerSame(workerProc(parent.pid), parent)) {
          try { process.kill(parent.pid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
        }
        process.exit(quiet ? 1 : 4);
      }
    } catch (e) {
      reason ??= "watchdog-discovery-error";
      stopAt ??= monotonicNs();
      // Known identities only; an incomplete snapshot never proves release.
      try { signalOwned("SIGKILL", [...observed.values()].filter(p =>
        workerSame(workerProc(p.pid), p))); } catch {}
      if (monotonicNs() - stopAt >= BigInt(scope?.killMs ?? 2000) * 1000000n) process.exit(4);
    } finally { busy = false; }
  }, 20);
  send({ type: "watchdog-ready" });
}
if (["--pa-workload-gate", "--pa-watchdog"].includes(process.argv[2])) {
  await privateWorker(process.argv[2]);
} else {
const fail = (message, code = 4, details = {}) => {
  console.error(JSON.stringify({ tool: "validation-lock", state: "BLOCKED", reason: message, ...details }));
  process.exit(code);
};
if (process.platform !== "linux") fail("Linux process-incarnation discovery required", 2);
const advanced = process.argv[2] === "--advanced";
const admission = await classifyRuntimeEnvironment(process.env, { advanced });
if (!admission.allowed) fail(admission.reason, 2);
if (admission.classification === "verified-development") {
  console.error(JSON.stringify({ tool: "validation-lock", incident: "verified-development-context-admission" }));
}
function ms(name, fallback) {
  const n = Number(process.env[`VALIDATION_LOCK_${name}`] ?? fallback);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 2147483647) fail(`invalid ${name}: explicit finite timer-safe milliseconds required`, 2);
  return n;
}
const pollMs = ms("POLL_MS", 100);
const queueMs = ms("TIMEOUT_MS");
const heartbeatMs = ms("HEARTBEAT_MS", 1000);
const staleMs = ms("STALE_HEARTBEAT_MS", 10000);
const maxHoldMs = ms("MAX_HOLD_MS");
const graceMs = ms("STOP_GRACE_MS", 3000);
const killMs = ms("STOP_KILL_MS", 5000);
const priorityGraceMs = ms("PRIORITY_GRACE_MS", 2000);
if (staleMs <= heartbeatMs) fail("stale heartbeat must exceed heartbeat interval", 2);
const args = process.argv.slice(advanced ? 3 : 2), sep = args.indexOf("--");
if (sep < 0 || sep === args.length - 1) fail("command after -- required", 2);
if (!advanced && (sep !== 0 || Object.entries(process.env).some(([k, v]) =>
  v && (k.startsWith("VALIDATION_LOCK_CONTEXT_") || k.startsWith("VALIDATION_LOCK_HELD_PID"))))) {
  fail("core requires a single outer lease and unwrapped inner commands; resource/priority/reentry features require the advanced profile", 2);
}
let resource = "global", priority = 5;
for (let i = 0; i < sep; i++) {
  if (args[i] === "--resource" && i + 1 < sep) resource = args[++i];
  else if (args[i] === "--priority" && i + 1 < sep && /^[1-9]$/.test(args[i + 1])) priority = Number(args[++i]);
  else fail("invalid option", 2);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(resource)) fail("resource must be lowercase alphanumeric/hyphen", 2);
const command = args.slice(sep + 1);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = resolve(process.env.VALIDATION_LOCK_FILE ??
  join(projectRoot, ".local", `validation-lock-${resource}.lock`));
mkdirSync(dirname(requested), { recursive: true, mode: 0o700 });
const baseFile = join(realpathSync(dirname(requested)), requested.split("/").at(-1));
const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
function proc(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
    return { pid, state: f[0], ppid: Number(f[1]), pgrp: Number(f[2]),
      session: Number(f[3]), startTime: f[19] };
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ESRCH") return null;
    throw e;
  }
}
const self = proc(process.pid);
const same = (a, b) => a && b && a.pid === b.pid && a.startTime === b.startTime;
const alive = identity => {
  const actual = proc(identity.pid);
  return same(actual, identity) && !["Z", "X"].includes(actual.state);
};
function allProcesses() {
  return readdirSync("/proc").filter(n => /^\d+$/.test(n)).map(n => proc(Number(n))).filter(Boolean);
}
function ancestor(identity) {
  let current = self, seen = new Set();
  while (current && current.pid > 1 && !seen.has(current.pid)) {
    if (same(current, identity)) return current.pid !== self.pid;
    seen.add(current.pid);
    current = proc(current.ppid);
  }
  return false;
}
function readLease(path) {
  try {
    const r = readBoundedJSON(path, 1024 * 1024);
    if (r.version !== 2 || r.bootId !== bootId ||
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.token) ||
        !Number.isInteger(r.owner?.pid) || r.owner.pid <= 1 ||
        typeof r.owner.startTime !== "string" || !/^\d+$/.test(r.owner.startTime) ||
        r.baseFile !== baseFile || r.resource !== resource ||
        !Array.isArray(r.observed) || typeof r.recoveryRequired !== "boolean" ||
        !["reserved", "launching", "running", "finished"].includes(r.phase) ||
        !Number.isFinite(r.heartbeatAt) || r.heartbeatAt <= 0 ||
        !Number.isFinite(r.acquiredAt) || r.acquiredAt <= 0 ||
        (r.watchdog != null && (!Number.isInteger(r.watchdog.pid) || r.watchdog.pid <= 1 ||
          typeof r.watchdog.startTime !== "string" || !/^\d+$/.test(r.watchdog.startTime))) ||
        (r.group !== null && (!Number.isInteger(r.group) || r.group <= 1)) ||
        (r.phase === "running" && r.group === null) ||
        r.observed.some(p => !Number.isInteger(p.pid) || p.pid <= 1 ||
          typeof p.startTime !== "string" || !/^\d+$/.test(p.startTime))) {
      throw new Error("invalid, foreign-boot, or incompatible lease");
    }
    return r;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
// Path identity, not a normalized resource name, is the reentry key.
const contextKey = `VALIDATION_LOCK_CONTEXT_${createHash("sha256").update(baseFile).digest("hex")}`;
let context, lockFile = baseFile;
if (process.env[contextKey]) {
  try {
    context = JSON.parse(process.env[contextKey]);
    if (context.baseFile !== baseFile || context.resource !== resource ||
        !Array.isArray(context.chain) || !context.chain.length || context.chain.length > 64) throw new Error("invalid context binding");
    for (let i = 0; i < context.chain.length; i++) {
      const entry = context.chain[i];
      const expectedFile = i === 0 ? baseFile : `${baseFile}.nested-${context.chain[i - 1].token}`;
      if (entry.file !== expectedFile) throw new Error("invalid nested path");
      const lease = readLease(entry.file);
      if (!lease || lease.token !== entry.token || !same(lease.owner, entry.owner) ||
          !ancestor(entry.owner) || !alive(entry.owner)) throw new Error("unverified reentry lease/ancestor");
    }
    lockFile = `${baseFile}.nested-${context.chain.at(-1).token}`;
  } catch (e) { fail(e.message); }
} else {
  const key = `VALIDATION_LOCK_HELD_PID_${resource.toUpperCase().replaceAll("-", "_")}`;
  if (process.env[key] || (resource === "global" && process.env.VALIDATION_LOCK_HELD_PID)) {
    fail("legacy PID-only reentry rejected; verified v2 context required");
  }
}
const transitionDir = `${lockFile}.transition`;
const transitionToken = randomUUID();
let transitionDirty = false;
function guarded(fn) {
  try { mkdirSync(transitionDir, { mode: 0o700 }); }
  catch (e) { if (e.code === "EEXIST") return { busy: true }; throw e; }
  let completed = false, ownerWritten = false;
  transitionDirty = false;
  try {
    writeFileSync(join(transitionDir, "owner.json"), JSON.stringify({ token: transitionToken, owner: self }), { mode: 0o600 });
    ownerWritten = true;
    const value = fn(); completed = true;
    return { value };
  } finally {
    // Never steal an abandoned mutex: uncertain interrupted transitions require
    // an authorized host recovery with contenders stopped, not a timed unlink.
    try {
      const owner = readBoundedJSON(join(transitionDir, "owner.json"), 8192);
      if ((completed || (ownerWritten && !transitionDirty)) && owner.token === transitionToken) {
        unlinkSync(join(transitionDir, "owner.json"));
        rmdirSync(transitionDir);
      }
    } catch { /* preserve uncertain state */ }
  }
}
function durableWrite(path, record, exclusive = false) {
  transitionDirty = true;
  const temp = exclusive ? path : `${path}.write-${record.token}`;
  const fd = openSync(temp, exclusive ? "wx" : "w", 0o600);
  try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd); } finally { closeSync(fd); }
  if (!exclusive) renameSync(temp, path);
  const dirFd = openSync(dirname(path), "r");
  try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
}
function workloadAlive(record, processes = allProcesses()) {
  if (record.phase === "launching" && !record.group) throw new Error("interrupted launch: child identity unknown");
  if (record.group && !Number.isInteger(record.group)) throw new Error("invalid workload group");
  return processes.some(p => !["Z", "X"].includes(p.state) &&
    ((record.group && p.pgrp === record.group && p.session === record.group) ||
      record.observed.some(old => same(p, old))));
}
const waitersDir = resolve(process.env.VALIDATION_LOCK_WAITERS_DIR ??
  `${lockFile}.waiters`);
mkdirSync(waitersDir, { recursive: true, mode: 0o700 });
const waiterFile = join(waitersDir, `${process.pid}-${self.startTime}.json`);
const enqueuedAt = Date.now();
const enqueuedMono = performance.now();
writeFileSync(waiterFile, JSON.stringify({ owner: self, priority, enqueuedAt, lockFile }), { mode: 0o600 });
const deregister = () => { try { unlinkSync(waiterFile); } catch { /* absent */ } };
function yieldPriority() {
  for (const file of readdirSync(waitersDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const w = readBoundedJSON(join(waitersDir, file), 8192);
      if (w.lockFile === lockFile && w.priority < priority &&
          Date.now() - w.enqueuedAt > priorityGraceMs && alive(w.owner)) return true;
    } catch { /* priority is advisory; manifests never grant ownership */ }
  }
  return false;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let lease, child, watchdog, stopReason, acquiredMono, cancelled = false, released = false;
let watchdogExpectedExit = false, watchdogAlive = false;
function ipcReply(worker, type, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`private worker ${type} timeout`)), 2000);
    const receive = m => { if (m?.type === type) done(null, m); };
    const exited = () => done(new Error(`private worker exited before ${type}`));
    function done(error, value) {
      clearTimeout(timer); worker.off("message", receive); worker.off("exit", exited);
      error ? reject(error) : resolve(value);
    }
    worker.on("message", receive); worker.once("exit", exited);
    if (message) worker.send(message, e => { if (e) done(e); });
  });
}
const delivered = new Set();
function discover() {
  const processes = allProcesses();
  const known = new Set(lease.observed.filter(alive).map(p => p.pid));
  let added = true;
  while (added) {
    added = false;
    for (const p of processes) if (!["Z", "X"].includes(p.state) &&
        ((lease.group && p.pgrp === lease.group && p.session === lease.group) || known.has(p.ppid))) {
      if (!lease.observed.some(old => same(old, p))) { lease.observed.push(p); added = true; }
      known.add(p.pid);
    }
  }
  return processes;
}
function signalOwned(signal, processes) {
  for (const old of lease.observed) {
    const now = processes.find(p => same(p, old));
    if (!now || ["Z", "X"].includes(now.state)) continue;
    const key = `${signal}:${old.pid}:${old.startTime}`;
    if (delivered.has(key)) continue;
    const fresh = proc(now.pid);
    if (!fresh || ["Z", "X"].includes(fresh.state)) continue;
    if (!same(fresh, old)) throw new Error("process incarnation changed before signal");
    console.error(JSON.stringify({ incident: "owned-workload-signal", pid: old.pid, startTime: old.startTime, signal }));
    try { process.kill(old.pid, signal); delivered.add(key); } catch (e) { if (e.code !== "ESRCH") throw e; }
  }
}
async function stopAfterFailure() {
  if (!child?.pid || !lease?.group) return { cleanupAttempted: false };
  const started = performance.now();
  let discoveryComplete = true, lastError = null;
  console.error(JSON.stringify({ incident: "supervision-error-owned-cleanup", token: lease.token }));
  do {
    let processes;
    try { processes = discover(); }
    catch (e) {
      discoveryComplete = false; lastError = e.message;
      // Partial discovery cannot prove quiescence; only previously owned exact
      // incarnations may receive best-effort signals. Never release this lease.
      processes = lease.observed.map(p => proc(p.pid)).filter(Boolean);
    }
    if (!workloadAlive(lease, processes)) {
      return { cleanupAttempted: true, workloadStopped: discoveryComplete, cleanupError: lastError, leaseRetained: true };
    }
    try { signalOwned(performance.now() - started < graceMs ? "SIGTERM" : "SIGKILL", processes); }
    catch (e) { lastError = e.message; }
    await sleep(Math.min(pollMs, 50));
  } while (performance.now() - started < graceMs + killMs);
  return { cleanupAttempted: true, workloadStopped: false, cleanupError: lastError, leaseRetained: true };
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => { cancelled = true; stopReason ??= signal; });
}
process.on("exit", deregister);
try {
  while (!cancelled && performance.now() - enqueuedMono < queueMs) {
    if (yieldPriority()) { await sleep(pollMs); continue; }
    const result = guarded(() => {
      const old = readLease(lockFile);
      if (old) {
        if (alive(old.owner)) return false; // age/heartbeat never authorizes takeover
        if (old.recoveryRequired || old.phase !== "finished") {
          throw new Error("retained/error or unfinalized lease requires separately authorized recovery");
        }
        if (workloadAlive(old)) throw new Error("dead supervisor has surviving workload; recovery required");
        console.error(JSON.stringify({ incident: "verified-quiescent-stale-recovery", token: old.token }));
        transitionDirty = true;
        unlinkSync(lockFile); // all cooperating transitions use this same mutex
      }
      lease = { version: 2, bootId, token: randomUUID(), owner: self, baseFile, resource,
        acquiredAt: Date.now(), heartbeatAt: Date.now(), phase: "reserved", group: null, observed: [],
        recoveryRequired: true };
      durableWrite(lockFile, lease, true);
      acquiredMono = performance.now();
      return true;
    });
    if (result.value) break;
    await sleep(pollMs);
  }
  deregister();
  if (!lease || cancelled) {
    if (lease) guarded(() => { if (readLease(lockFile)?.token === lease.token && !lease.group) unlinkSync(lockFile); });
    fail(cancelled ? "cancelled while queued" : "queue timeout; no takeover of live/uncertain ownership", cancelled ? 1 : 3);
  }
  // Revalidate every inherited lease after queueing, before child dispatch.
  if (context) for (const entry of context.chain) {
    const current = readLease(entry.file);
    if (!current || current.token !== entry.token || !alive(entry.owner)) throw new Error("parent lease changed while queued");
  }
  const transition = async fn => {
    const until = performance.now() + Math.max(1000, graceMs);
    do {
      const r = guarded(fn);
      if (!r.busy) return r.value;
      await sleep(Math.min(pollMs, 25));
    } while (performance.now() < until);
    throw new Error("transition interrupted/busy; lifecycle cannot be recorded");
  };
  const mutate = () => transition(() => {
    if (readLease(lockFile)?.token !== lease.token) throw new Error("lease ownership changed");
    durableWrite(lockFile, lease);
  });
  const chain = [...(context?.chain ?? []), { file: lockFile, token: lease.token, owner: self }];
  const env = { ...process.env, [contextKey]: JSON.stringify({ baseFile, resource, chain }) };
  // Do not export PID-only reentry authority.
  const legacyKey = `VALIDATION_LOCK_HELD_PID_${resource.toUpperCase().replaceAll("-", "_")}`;
  delete env[legacyKey];
  if (resource === "global") delete env.VALIDATION_LOCK_HELD_PID;
  const dispatchAdmission = await classifyRuntimeEnvironment(process.env, { advanced });
  if (!dispatchAdmission.allowed) throw new Error(`runtime guard blocked before dispatch: ${dispatchAdmission.reason}`);
  lease.phase = "launching"; await mutate(); // crash in launch gap must remain blocked
  console.log(JSON.stringify({ tool: "validation-lock", state: "ACQUIRED", resource,
    nested: Boolean(context), token: lease.token, queueWaitMs: Math.round(performance.now() - enqueuedMono),
    queueLimitMs: queueMs, executionLimitMs: maxHoldMs, stopGraceMs: graceMs,
    stopVerificationMs: killMs, clock: "monotonic", authority: "local-supervision-not-checked-approval" }));
  const launchAdmission = await classifyRuntimeEnvironment(process.env, { advanced });
  if (!launchAdmission.allowed) throw new Error(`runtime guard blocked before launch: ${launchAdmission.reason}`);
  if (cancelled || performance.now() - acquiredMono >= maxHoldMs) {
    throw new Error(cancelled ? "cancelled before launch" : "execution-budget expired before launch");
  }
  const ownScript = fileURLToPath(import.meta.url);
  watchdog = spawn(process.execPath, [ownScript, "--pa-watchdog"], {
    detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"], env,
  });
  watchdog.once("error", () => { cancelled = true; stopReason ??= "watchdog-spawn-failed"; });
  watchdog.once("exit", () => {
    watchdogAlive = false;
    if (!watchdogExpectedExit) { cancelled = true; stopReason ??= "watchdog-failed"; }
  });
  watchdog.on("message", m => {
    if (m?.type === "watchdog-stop") stopReason ??= m.reason;
  });
  await ipcReply(watchdog, "watchdog-ready"); watchdogAlive = true;
  child = spawn(process.execPath, [ownScript, "--pa-workload-gate"], {
    detached: true, stdio: ["inherit", "inherit", "inherit", "ipc"], env,
  });
  const gateReady = ipcReply(child, "gate-ready").then(() => null, e => e);
  let exitCode = null, childSignal = null, spawnError = null, ended = false, commandOutcome;
  child.on("message", m => {
    if (m?.type === "command-exit" && (m.code === null || Number.isInteger(m.code)) &&
        (m.signal === null || typeof m.signal === "string")) {
      commandOutcome = { exitCode: m.code, signal: m.signal };
    }
  });
  child.on("error", e => { spawnError = e; ended = true; });
  child.on("exit", (code, signal) => {
    exitCode = commandOutcome ? commandOutcome.exitCode : code;
    childSignal = commandOutcome ? commandOutcome.signal : signal; ended = true;
    if (performance.now() - acquiredMono >= maxHoldMs) stopReason ??= "execution-budget";
  });
  if (Number.isInteger(child.pid)) {
    lease.group = child.pid;
    const identity = proc(child.pid);
    if (identity) lease.observed.push(identity);
    lease.phase = "running"; await mutate();
    const gateError = await gateReady;
    if (gateError) throw gateError;
    const registration = await ipcReply(watchdog, "registered", { type: "register", root: identity,
      deadlineNs: String(monotonicNs() + BigInt(Math.max(0, Math.floor(maxHoldMs -
        (performance.now() - acquiredMono)))) * 1000000n), graceMs, killMs });
    if (!same(proc(registration.identity?.pid), registration.identity)) {
      throw new Error("independent watchdog identity unavailable");
    }
    console.error(JSON.stringify({ incident: "independent-watchdog-registered",
      pid: registration.identity.pid, startTime: registration.identity.startTime }));
    lease.watchdog = { pid: registration.identity.pid, startTime: registration.identity.startTime };
    await mutate();
    if (cancelled || !watchdogAlive || performance.now() - acquiredMono >= maxHoldMs) {
      throw new Error("dispatch cancelled, watchdog unavailable, or execution budget expired");
    }
    child.send({ type: "dispatch", command });
  } else {
    // spawn() failed before creating a child; no unknown launch is inferred.
    await sleep(0);
    if (!spawnError) throw new Error("launch outcome unknown");
    lease.phase = "finished"; await mutate();
  }
  let lastHeartbeat = performance.now(), stoppingAt = null, killedAt = null;
  while (true) {
    let processes = discover(), active = workloadAlive(lease, processes);
    if (performance.now() - lastHeartbeat >= heartbeatMs || active) {
      lease.heartbeatAt = Date.now(); await mutate(); lastHeartbeat = performance.now();
    }
    // A contended journal await may deliver exit after the original snapshot.
    // Do not mistake that pre-exit snapshot for a surviving descendant.
    if (ended) { processes = discover(); active = workloadAlive(lease, processes); }
    if (performance.now() - acquiredMono >= maxHoldMs) stopReason ??= "execution-budget";
    if (ended && !active) break;
    if (ended && active) stopReason ??= "surviving-descendant";
    if (stopReason && stoppingAt === null) {
      stoppingAt = performance.now();
    }
    if (stoppingAt !== null && killedAt === null && performance.now() - stoppingAt >= graceMs) {
      killedAt = performance.now();
    }
    if (stoppingAt !== null) signalOwned(killedAt === null ? "SIGTERM" : "SIGKILL", processes);
    if (killedAt !== null && performance.now() - killedAt >= killMs && active) {
      throw new Error("owned workload not confirmed stopped; lease retained");
    }
    await sleep(Math.min(pollMs, 50));
  }
  if (!watchdogAlive) throw new Error("independent watchdog unavailable at release");
  // Ask for independent quiescence before release. Expected budget/cancellation
  // stops may complete locally; the watchdog never accepts uncertain cleanup.
  watchdogExpectedExit = true;
  await ipcReply(watchdog, "disarmed", { type: stopReason ? "settle" : "disarm" });
  await transition(() => {
    if (readLease(lockFile)?.token !== lease.token || workloadAlive(lease)) throw new Error("unsafe release");
    lease.phase = "finished"; lease.heartbeatAt = Date.now();
    lease.recoveryRequired = false;
    durableWrite(lockFile, lease);
    unlinkSync(lockFile);
    released = true;
  });
  if (!released) throw new Error("release transition unavailable; lease retained");
  const status = stopReason || spawnError || childSignal ? 1 : exitCode ?? 1;
  console.log(JSON.stringify({ tool: "validation-lock", state: status === 0 ? "FINISHED" : "FAILED",
    rawExitCode: exitCode, signal: childSignal, reason: stopReason ?? (spawnError ? "spawn-failed" : null),
    workloadStopped: true, commandOutcome: commandOutcome ?? null, token: lease.token }));
  process.exit(status);
} catch (e) {
  // A malformed or interrupted lease remains for verified recovery. Do not
  // turn an evidence/lifecycle gap into an unlocked successful validation.
  deregister();
  let cleanup;
  try { cleanup = await stopAfterFailure(); }
  catch (cleanupError) { cleanup = { cleanupAttempted: true, workloadStopped: false, cleanupError: cleanupError.message, leaseRetained: Boolean(lease) }; }
  fail(e.message, 4, cleanup);
}
}