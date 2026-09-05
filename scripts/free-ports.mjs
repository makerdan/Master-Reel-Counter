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

function getPortInodes(port) {
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 10 || columns[3] !== "0A") continue;
      if (columns[1].split(":")[1]?.toUpperCase() === hexPort) {
        inodes.add(columns[9]);
      }
    }
  }
  return inodes;
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
  const targets = new Set();
  for (const holder of holders) {
    if (selfTree.has(String(holder))) continue;
    targets.add(holder);
    for (const child of getDescendants(holder, parents)) {
      if (!selfTree.has(child)) targets.add(Number(child));
    }
    for (const supervisor of getSafeSupervisors(holder, selfTree)) targets.add(supervisor);
  }
  return [...targets].filter((pid) => pid > 1 && !selfTree.has(String(pid)));
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
for (const port of ports) {
  console.log(`[free-ports] Clearing port ${port}…`);
  const inodes = getPortInodes(port);
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

  const targets = findKillTargets(holders, selfTree);
  console.error(`[free-ports] INCIDENT: Port ${port} held by ${holders.join(", ")}; terminating process tree ${targets.join(", ")}.`);
  for (const pid of targets) signalPid(pid, "SIGTERM");
  await sleep(graceMs);

  const remainingHolders = findHolders(getPortInodes(port), selfTree);
  const survivors = findKillTargets(remainingHolders, selfTree)
    .filter((pid) => signalPid(pid, 0));
  if (survivors.length > 0) {
    console.error(`[free-ports] INCIDENT: Port ${port} has ${survivors.length} survivor(s) after SIGTERM; sending SIGKILL.`);
    for (const pid of survivors) signalPid(pid, "SIGKILL");
    await sleep(500);
  }

  if (getPortInodes(port).size === 0) {
    console.log(`[free-ports] Port ${port} is now free after forced cleanup.`);
  } else {
    console.error(`[free-ports] WARNING: Port ${port} is still in use after cleanup.`);
    process.exitCode = 1;
  }
}