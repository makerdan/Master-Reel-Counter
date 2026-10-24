#!/usr/bin/env node
/**
 * Canonical Port Authority cleanup.
 *
 * Ports are deliberately explicit: a missing or malformed port is an error,
 * never an invitation to sweep a default production port.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
} from "fs";
import { basename } from "path";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
  console.error("[free-ports] Refusing to run during production execution.");
  process.exit(2);
}
if (process.env.FREE_PORTS_GUARD === "1") {
  process.exit(0);
}
process.env.FREE_PORTS_GUARD = "1";

const rawPorts = process.argv.slice(2);
if (rawPorts.length === 0) {
  console.error("[free-ports] ERROR: provide at least one TCP port (1-65535).");
  process.exit(2);
}

const ports = rawPorts.map((raw) => {
  if (!/^[0-9]+$/.test(raw)) {
    console.error(`[free-ports] ERROR: invalid port '${raw}'; expected an integer from 1 to 65535.`);
    process.exit(2);
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[free-ports] ERROR: invalid port '${raw}'; expected an integer from 1 to 65535.`);
    process.exit(2);
  }
  return port;
});
if (new Set(ports).size !== ports.length) {
  console.error("[free-ports] ERROR: duplicate ports are not accepted.");
  process.exit(2);
}

const graceMs = Number.parseInt(process.env.FREE_PORTS_GRACE_MS ?? "3000", 10);
if (!Number.isInteger(graceMs) || graceMs < 0) {
  console.error("[free-ports] ERROR: FREE_PORTS_GRACE_MS must be a non-negative integer.");
  process.exit(2);
}
const beforeSignalMs = Number.parseInt(process.env.FREE_PORTS_BEFORE_SIGNAL_MS ?? "0", 10);
if (!Number.isInteger(beforeSignalMs) || beforeSignalMs < 0) {
  console.error("[free-ports] ERROR: FREE_PORTS_BEFORE_SIGNAL_MS must be a non-negative integer.");
  process.exit(2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function getSelfTree() {
  const tree = new Set();
  let pid = process.pid;
  while (pid > 1) {
    tree.add(String(pid));
    pid = getParentPid(pid);
  }
  return tree;
}

function getCommandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    return "";
  }
}

function getListeningPortInodes() {
  const portInodes = new Map();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 10 || columns[3] !== "0A") continue;
      const port = Number.parseInt(columns[1].split(":")[1], 16);
      if (!Number.isInteger(port)) continue;
      const inodes = portInodes.get(port) ?? new Set();
      inodes.add(columns[9]);
      portInodes.set(port, inodes);
    }
  }
  return portInodes;
}

function getPortInodes(port, listeningPortInodes = getListeningPortInodes()) {
  return listeningPortInodes.get(port) ?? new Set();
}

function pidHoldsInode(pid, inodes) {
  const fdDir = `/proc/${pid}/fd`;
  if (!existsSync(fdDir)) return false;
  try {
    for (const fd of readdirSync(fdDir)) {
      try {
        const link = readlinkSync(`${fdDir}/${fd}`);
        const match = link.match(/^socket:\[(\d+)\]$/);
        if (match && inodes.has(match[1])) return true;
      } catch {
        // A descriptor can disappear during the scan.
      }
    }
  } catch {
    // The process can exit during the scan.
  }
  return false;
}

function findHolders(inodes, selfTree) {
  if (inodes.size === 0) return [];
  const holders = [];
  try {
    for (const pid of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
      if (!selfTree.has(pid) && pidHoldsInode(pid, inodes)) holders.push(Number(pid));
    }
  } catch {
    // Best effort; final port verification remains authoritative.
  }
  return holders;
}

function getListeningPortsForPid(pid, listeningPortInodes) {
  return [...listeningPortInodes.entries()]
    .filter(([, inodes]) => pidHoldsInode(pid, inodes))
    .map(([port]) => port);
}

function getProcessIdentity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return null;
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
    // The starttime field is field 22 in procfs, and field 3 is the first
    // value after the command name.
    const startTime = fields[19];
    if (!startTime) return null;
    return {
      pid: Number(pid),
      startTime,
      command: getCommandLine(pid),
    };
  } catch {
    return null;
  }
}

function sameProcessIdentity(expected, actual) {
  return Boolean(
    expected &&
    actual &&
    expected.pid === actual.pid &&
    expected.startTime === actual.startTime &&
    expected.command === actual.command,
  );
}

function getProcessParents() {
  const parents = new Map();
  try {
    for (const pid of readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
      const parent = getParentPid(pid);
      if (parent > 0) parents.set(pid, String(parent));
    }
  } catch {
    // Best effort.
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

function getSafeSupervisors(pid, selfTree) {
  const supervisors = new Set();
  let current = String(pid);
  while (true) {
    const parent = getParentPid(current);
    if (parent <= 1 || selfTree.has(String(parent))) break;
    const command = getCommandLine(String(parent));
    if (/\b(pid0|pid1|pid2)\b|\/mnt\/pid2|portauthority-vsock-port/.test(command)) break;
    const executable = basename(command.split(/\s+/)[0] || "");
    if (!["bash", "sh", "zsh", "npm", "npx", "node", "tsx"].includes(executable)) break;
    supervisors.add(parent);
    current = String(parent);
  }
  return supervisors;
}

function findKillTargets(holders, selfTree) {
  const parents = getProcessParents();
  const targets = new Map();
  const ownedTargetPids = new Set();
  for (const holder of holders) {
    if (selfTree.has(String(holder))) continue;
    targets.set(holder, { pid: holder, holder });
    ownedTargetPids.add(holder);
    for (const child of getDescendants(holder, parents)) {
      if (!selfTree.has(child)) {
        const pid = Number(child);
        targets.set(pid, { pid, holder });
        ownedTargetPids.add(pid);
      }
    }
    for (const supervisor of getSafeSupervisors(holder, selfTree)) {
      const unrelatedDescendant = [...getDescendants(supervisor, parents)]
        .some((descendant) => !ownedTargetPids.has(Number(descendant)));
      if (unrelatedDescendant) continue;
      targets.set(supervisor, { pid: supervisor, holder });
      ownedTargetPids.add(supervisor);
    }
  }
  return [...targets.values()].filter(
    (target) => target.pid > 1 && !selfTree.has(String(target.pid)),
  );
}

function signalPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

const selfTree = getSelfTree();
const requestedPorts = new Set(ports);
for (const port of ports) {
  console.log(`[free-ports] Clearing port ${port}…`);
  const listeningPortInodes = getListeningPortInodes();
  const inodes = getPortInodes(port, listeningPortInodes);
  if (inodes.size === 0) {
    console.log(`[free-ports] Port ${port} is already free.`);
    continue;
  }

  const holders = findHolders(inodes, selfTree);
  if (holders.length === 0) {
    console.error(`[free-ports] INCIDENT: Port ${port} has listeners but no accessible holder PIDs.`);
    process.exitCode = 1;
    continue;
  }

  const sharedHolders = holders.filter((pid) =>
    getListeningPortsForPid(pid, listeningPortInodes)
      .some((heldPort) => !requestedPorts.has(heldPort)),
  );
  if (holders.length > 1 || sharedHolders.length > 0) {
    const reason = holders.length > 1
      ? "multiple holder processes share the requested port"
      : `holder(s) also own listener(s) outside the requested set: ${sharedHolders.join(", ")}`;
    console.error(
      `[free-ports] WARNING: Port ${port} is shared; refusing to terminate holder process(es) (${reason}).`,
    );
    process.exitCode = 1;
    continue;
  }

  const targets = findKillTargets(holders, selfTree);
  const holderIdentities = new Map(
    holders.map((pid) => [pid, getProcessIdentity(pid)]),
  );
  const targetIdentities = targets.map((target) => ({
    ...target,
    holderIdentity: holderIdentities.get(target.holder),
    identity: getProcessIdentity(target.pid),
    inodes,
  }));
  const validTargets = targetIdentities.filter(
    (target) => target.holderIdentity && target.identity,
  );
  if (validTargets.length === 0) {
    console.error(`[free-ports] WARNING: Port ${port} ownership changed before cleanup; refusing to terminate any process.`);
    process.exitCode = 1;
    continue;
  }

  function targetStillOwned(target) {
    const holderIdentity = getProcessIdentity(target.holder);
    const identity = getProcessIdentity(target.pid);
    return (
      sameProcessIdentity(target.holderIdentity, holderIdentity) &&
      sameProcessIdentity(target.identity, identity) &&
      pidHoldsInode(target.holder, target.inodes)
    );
  }

  function signalOwnedTarget(target, signal) {
    if (!targetStillOwned(target)) {
      console.error(
        `[free-ports] WARNING: Port ${port} ownership changed for PID ${target.pid}; skipping ${signal}.`,
      );
      return false;
    }
    return signalPid(target.pid, signal);
  }

  console.error(
    `[free-ports] INCIDENT: Port ${port} held by ${holders.join(", ")}; terminating process tree ${validTargets.map((target) => target.pid).join(", ")}.`,
  );
  if (beforeSignalMs > 0) await sleep(beforeSignalMs);
  for (const target of validTargets) signalOwnedTarget(target, "SIGTERM");
  await sleep(graceMs);

  const survivors = validTargets.filter(
    (target) => targetStillOwned(target) && signalPid(target.pid, 0),
  );
  if (survivors.length > 0) {
    console.error(`[free-ports] INCIDENT: Port ${port} has ${survivors.length} survivor(s) after SIGTERM; sending SIGKILL.`);
    for (const target of survivors) signalOwnedTarget(target, "SIGKILL");
    await sleep(500);
  }

  if (getPortInodes(port).size === 0) {
    console.log(`[free-ports] Port ${port} is now free after forced cleanup.`);
  } else {
    console.error(`[free-ports] WARNING: Port ${port} is still in use after cleanup.`);
    process.exitCode = 1;
  }
}