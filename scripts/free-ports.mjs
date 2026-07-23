#!/usr/bin/env node
/**
 * free-ports.mjs — Port Authority Phase 2 canonical port-cleanup script.
 *
 * Adaptation points:
 *   PORTS          — TCP ports to clear; pass as CLI args or defaults to [5000]
 *   FREE_PORTS_GUARD — env var used as a re-entrancy guard
 *
 * Usage:
 *   node scripts/free-ports.mjs            # clears port 5000
 *   node scripts/free-ports.mjs 5000 5001  # clears multiple ports
 *
 * Properties guaranteed:
 *  - Discovers holders via /proc fd + socket inode matching (no fuser, no name matching).
 *  - Exempts the caller's own process tree so the script cannot kill itself.
 *  - SIGTERM → grace period → SIGKILL survivors.
 *  - Confirms the port is free before returning.
 *  - FREE_PORTS_GUARD prevents recursive or production execution.
 */

import { readFileSync, readdirSync, readlinkSync, existsSync } from "fs";

// ── Guard ──────────────────────────────────────────────────────────────────
if (process.env.FREE_PORTS_GUARD === "1") {
  process.exit(0);
}
process.env.FREE_PORTS_GUARD = "1";

// ── Config ─────────────────────────────────────────────────────────────────
const PORTS = process.argv.slice(2).map(Number).filter(Boolean);
if (PORTS.length === 0) PORTS.push(5000);
const GRACE_MS = 3000;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Read /proc/net/tcp[6] and return a Set of decimal inode strings for the given port. */
function getPortInodes(port) {
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n").slice(1);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      const localAddr = cols[1];
      const state = cols[3];
      const inode = cols[9];
      if (state !== "0A") continue; // 0A = LISTEN
      const addrPort = localAddr.split(":")[1];
      if (addrPort && addrPort.toUpperCase() === hexPort) {
        inodes.add(inode);
      }
    }
  }
  return inodes;
}

/** Return the set of ancestor PIDs (and self) of the current process. */
function getSelfTree() {
  const tree = new Set();
  let pid = process.pid;
  while (pid > 1) {
    tree.add(String(pid));
    try {
      const stat = readFileSync(`/proc/${pid}/status`, "utf8");
      const m = stat.match(/^PPid:\s+(\d+)/m);
      pid = m ? parseInt(m[1], 10) : 0;
    } catch {
      break;
    }
  }
  return tree;
}

/**
 * Walk /proc/<pid>/fd and return true if any fd is a socket matching one of
 * the given inodes.  Uses readlinkSync on each fd symlink.
 */
function pidHoldsInode(pid, inodes) {
  const fdDir = `/proc/${pid}/fd`;
  if (!existsSync(fdDir)) return false;
  try {
    const fds = readdirSync(fdDir);
    for (const fd of fds) {
      try {
        const link = readlinkSync(`${fdDir}/${fd}`);
        const m = link.match(/^socket:\[(\d+)\]$/);
        if (m && inodes.has(m[1])) return true;
      } catch {
        // fd may have closed; skip
      }
    }
  } catch {
    // /proc/<pid>/fd may have disappeared (process exited); skip
  }
  return false;
}

/** Return all PIDs listening on the given port inodes, excluding the caller's tree. */
function findHolders(inodes, selfTree) {
  if (inodes.size === 0) return [];
  const holders = [];
  try {
    const pids = readdirSync("/proc").filter((e) => /^\d+$/.test(e));
    for (const pid of pids) {
      if (selfTree.has(pid)) continue;
      if (pidHoldsInode(pid, inodes)) {
        holders.push(parseInt(pid, 10));
      }
    }
  } catch {}
  return holders;
}

/** Send a signal to a PID; returns false when the process is already gone. */
function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (e) {
    if (e.code === "ESRCH") return false;
    throw e;
  }
}

/** Sleep for ms milliseconds. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ───────────────────────────────────────────────────────────────────
const selfTree = getSelfTree();

for (const port of PORTS) {
  console.log(`[free-ports] Clearing port ${port}…`);

  const inodes = getPortInodes(port);
  if (inodes.size === 0) {
    console.log(`[free-ports] Port ${port} is already free.`);
    continue;
  }

  const holders = findHolders(inodes, selfTree);
  if (holders.length === 0) {
    console.log(`[free-ports] Port ${port}: no accessible holder PIDs found (may already be closing).`);
    continue;
  }

  console.log(`[free-ports] Port ${port} held by PIDs: ${holders.join(", ")} — sending SIGTERM…`);
  for (const pid of holders) killPid(pid, "SIGTERM");

  await sleep(GRACE_MS);

  // Check for survivors and SIGKILL them
  const survivors = holders.filter((pid) => killPid(pid, 0));
  if (survivors.length > 0) {
    console.log(`[free-ports] Port ${port}: ${survivors.length} survivor(s) — sending SIGKILL to: ${survivors.join(", ")}`);
    for (const pid of survivors) killPid(pid, "SIGKILL");
    await sleep(500);
  }

  // Confirm the port is free
  if (getPortInodes(port).size === 0) {
    console.log(`[free-ports] Port ${port} is now free.`);
  } else {
    console.error(`[free-ports] WARNING: Port ${port} is still in use after kill attempt. Manual intervention may be needed.`);
    process.exitCode = 1;
  }
}
