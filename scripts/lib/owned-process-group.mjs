import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readProcessTable() {
  let entries;
  try {
    entries = readdirSync("/proc", { withFileTypes: true });
  } catch {
    return new Map();
  }
  const processes = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const stat = readFileSync(`/proc/${entry.name}/stat`, "utf8");
      const closingParen = stat.lastIndexOf(")");
      if (closingParen < 0) continue;
      const fields = stat.slice(closingParen + 1).trim().split(/\s+/);
      processes.set(Number(entry.name), {
        pid: Number(entry.name),
        state: fields[0],
        parentPid: Number(fields[1]),
        processGroupId: Number(fields[2]),
        startTime: fields[19],
      });
    } catch {
      // Processes can exit between listing /proc and reading their status.
    }
  }
  return processes;
}

function processIdentity(processInfo) {
  return `${processInfo.pid}:${processInfo.startTime}`;
}

class OwnedProcessTree {
  constructor(rootPid, rootGroupId) {
    this.rootPid = rootPid;
    this.groups = new Set([rootGroupId]);
    this.processes = new Set();
    this.rootIdentity = undefined;
  }

  observe() {
    const table = readProcessTable();
    const childrenByParent = new Map();
    for (const info of table.values()) {
      const children = childrenByParent.get(info.parentPid) ?? [];
      children.push(info);
      childrenByParent.set(info.parentPid, children);
    }

    const rootInfo = table.get(this.rootPid);
    if (rootInfo && rootInfo.state !== "Z" && rootInfo.state !== "X") {
      this.rootIdentity ??= processIdentity(rootInfo);
    }
    const pending =
      rootInfo && processIdentity(rootInfo) === this.rootIdentity
        ? [this.rootPid]
        : [];
    const visited = new Set();
    while (pending.length > 0) {
      const pid = pending.pop();
      if (visited.has(pid)) continue;
      visited.add(pid);
      const info = table.get(pid);
      if (!info || info.state === "Z" || info.state === "X") continue;
      this.processes.add(processIdentity(info));
      this.groups.add(info.processGroupId);
      for (const child of childrenByParent.get(pid) ?? []) pending.push(child.pid);
    }

    // Forget process-group IDs as soon as all previously observed members
    // disappear. Linux may later reuse that ID for an unrelated process group.
    for (const processGroupId of this.groups) {
      const stillOwned = [...table.values()].some((info) =>
        info.processGroupId === processGroupId &&
        this.processes.has(processIdentity(info)) &&
        info.state !== "Z" &&
        info.state !== "X",
      );
      if (!stillOwned) this.groups.delete(processGroupId);
    }

    // Some browser helpers create their own session/process group. Once a
    // descendant group is known to belong to this run, track every process
    // currently in that group so it remains identifiable if its leader exits.
    for (const info of table.values()) {
      if (
        this.groups.has(info.processGroupId) &&
        info.state !== "Z" &&
        info.state !== "X"
      ) {
        this.processes.add(processIdentity(info));
      }
    }
    return table;
  }

  activeGroups(table = this.observe()) {
    const active = new Set();
    for (const info of table.values()) {
      if (
        this.groups.has(info.processGroupId) &&
        this.processes.has(processIdentity(info)) &&
        info.state !== "Z" &&
        info.state !== "X"
      ) {
        active.add(info.processGroupId);
      }
    }
    return active;
  }

  signalAll(signal) {
    const table = this.observe();
    for (const processGroupId of this.activeGroups(table)) {
      sendSignalToGroup(processGroupId, signal);
    }
  }

  hasLiveProcesses() {
    const table = this.observe();
    return this.activeGroups(table).size > 0;
  }
}

export function signalExitCode(signal) {
  return SIGNAL_EXIT_CODES[signal] ?? 1;
}

export function isProcessGroupAlive(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) return false;
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export async function waitForProcessGroupExit(
  processGroupId,
  { timeoutMs = 5_000, pollMs = 25 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessGroupAlive(processGroupId) && Date.now() < deadline) {
    await delay(pollMs);
  }
  return !isProcessGroupAlive(processGroupId);
}

function sendSignalToGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function terminateProcessGroup(
  processTree,
  signal,
  { graceMs, killWaitMs },
) {
  const until = Date.now() + graceMs;
  while (processTree.hasLiveProcesses() && Date.now() < until) {
    processTree.signalAll(signal);
    await delay(25);
  }
  if (!processTree.hasLiveProcesses()) return true;

  const killUntil = Date.now() + killWaitMs;
  while (processTree.hasLiveProcesses() && Date.now() < killUntil) {
    processTree.signalAll("SIGKILL");
    await delay(25);
  }
  return !processTree.hasLiveProcesses();
}

function cancellationSignal(reason) {
  return typeof reason === "string" && SIGNAL_EXIT_CODES[reason]
    ? reason
    : "SIGTERM";
}

/**
 * Runs a child in a private process group and does not resolve until the group
 * is gone. An AbortSignal terminates the full group, escalating to SIGKILL
 * after the grace period when needed.
 */
export async function runOwnedProcessGroup(
  command,
  args,
  {
    cwd,
    env,
    stdio = "inherit",
    signal,
    terminationGraceMs = 2_000,
    terminationWaitMs = 5_000,
    onOutput,
  } = {},
) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: onOutput ? ["ignore", "pipe", "pipe"] : stdio,
    detached: true,
  });
  const processGroupId = child.pid;
  if (!processGroupId) {
    const error = await new Promise((done) => child.once("error", done));
    throw error;
  }
  if (onOutput) {
    child.stdout.on("data", onOutput);
    child.stderr.on("data", onOutput);
  }
  const processTree = new OwnedProcessTree(processGroupId, processGroupId);
  processTree.observe();
  child.once("spawn", () => processTree.observe());
  const monitor = setInterval(() => processTree.observe(), 100);

  let spawnError;
  const closed = new Promise((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, childSignal) => {
      resolve({ code, childSignal });
    });
  });

  let termination;
  let terminationError;
  let receivedSignal;
  const terminate = (requestedSignal) => {
    receivedSignal ??= cancellationSignal(requestedSignal);
    termination ??= terminateProcessGroup(processTree, receivedSignal, {
      graceMs: terminationGraceMs,
      killWaitMs: terminationWaitMs,
    }).catch((error) => {
      terminationError = error;
      return false;
    });
    return termination;
  };
  const onAbort = () => {
    void terminate(signal.reason);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  const { code, childSignal } = await closed;
  signal?.removeEventListener("abort", onAbort);

  let groupGone;
  if (termination) {
    groupGone = await termination;
  } else if (processTree.hasLiveProcesses()) {
    // A normally exiting command must not leave browser or helper processes
    // attached to the temporary database either.
    groupGone = await terminate("SIGTERM");
  } else {
    groupGone = true;
  }
  clearInterval(monitor);

  if (spawnError) throw spawnError;

  const status = code !== null && code !== 0
    ? code
    : receivedSignal
      ? signalExitCode(receivedSignal)
      : code ?? (childSignal ? signalExitCode(childSignal) : 1);

  return {
    status,
    childSignal,
    processGroupId,
    groupGone,
    terminationError,
  };
}