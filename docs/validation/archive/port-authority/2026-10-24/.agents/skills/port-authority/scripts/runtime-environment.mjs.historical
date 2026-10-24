/**
 * Runtime binding plus mandatory host-backed attestation for the exception.
 * Local record structure is not independent attestation or human authorization.
 * Host sources must be independently discovered and verified before adaptation.
 */
import {
  constants, openSync, closeSync, fstatSync, readFileSync, readSync, realpathSync,
} from "node:fs";
import { isAbsolute } from "node:path";
import { attestRuntime } from "./host-capabilities.mjs";

const MAX_CONTEXT_MS = 15 * 60 * 1000;
// Nonblocking open + descriptor checks prevent FIFO/device/symlink inputs from
// hanging before any JS timer runs. Bound bytes even if a regular file grows.
export function readBoundedJSON(path, maxBytes = 65536, privateOwner = true) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes ||
        (privateOwner && (stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o022) !== 0))) {
      throw new Error("unsafe or oversized JSON file");
    }
    const data = Buffer.alloc(maxBytes + 1);
    const length = readSync(fd, data, 0, data.length, 0);
    if (length > maxBytes) throw new Error("JSON input exceeds byte bound");
    return JSON.parse(data.subarray(0, length).toString("utf8"));
  } finally { closeSync(fd); }
}
export async function boundedHostCall(fn, request) {
  const controller = new AbortController();
  const deadlineAt = Date.now() + 2000;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn({ ...request, deadlineAt, abortSignal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("host capability deadline exceeded; outcome uncertain; no automatic retry"));
        }, 2000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
export function runtimeBinding(env = process.env) {
  return {
    projectRoot: realpathSync(process.cwd()),
    bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    indicators: { nodeEnv: env.NODE_ENV ?? null, deployment: env.REPLIT_DEPLOYMENT ?? null,
      environment: env.REPLIT_ENVIRONMENT ?? null, devDomain: env.REPLIT_DEV_DOMAIN ?? null },
  };
}
export async function verifiedHostAttestation(developmentRecord = null, env = process.env) {
  const binding = runtimeBinding(env);
  const result = await boundedHostCall(attestRuntime, { binding, developmentRecord });
  if (result?.protocolVersion !== 1 || result.environment !== "development" ||
      typeof result.attestationId !== "string" || !result.attestationId.trim() ||
      result.projectRoot !== binding.projectRoot || result.bootId !== binding.bootId ||
      !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() ||
      (developmentRecord && result.attestationId !== developmentRecord.attestationReference)) {
    throw new Error("host attestation missing, expired, or mismatched");
  }
  return result;
}
function incarnation(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    return { pid, state: f[0], ppid: Number(f[1]), startTime: f[19],
      uid: Number(status.match(/^Uid:\s+(\d+)/m)?.[1]) };
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ESRCH") return null;
    throw e;
  }
}
function verifiedDevelopment(env) {
  if (!env.REPLIT_DEV_DOMAIN?.trim()) throw new Error("development domain missing");
  const path = env.PORT_AUTHORITY_DEV_CONTEXT_FILE;
  if (!path || !isAbsolute(path)) throw new Error("absolute development-context file required");
  const record = readBoundedJSON(path, 8192);
  const now = Date.now();
  if (record.version !== 1 || record.kind !== "replit-development-workspace" ||
      record.bootId !== readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() ||
      record.projectRoot !== realpathSync(process.cwd()) ||
      record.devDomain !== env.REPLIT_DEV_DOMAIN ||
      typeof record.verificationReference !== "string" || !record.verificationReference.trim() ||
      typeof record.attestationReference !== "string" || !record.attestationReference.trim() ||
      !Number.isSafeInteger(record.issuedAt) || record.issuedAt <= 0 || record.issuedAt > now ||
      !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= now ||
      record.expiresAt <= record.issuedAt || record.expiresAt - record.issuedAt > MAX_CONTEXT_MS ||
      !Number.isInteger(record.supervisor?.pid) || record.supervisor.pid <= 1 ||
      typeof record.supervisor.startTime !== "string" || !/^\d+$/.test(record.supervisor.startTime)) {
    throw new Error("invalid, expired, or out-of-scope development context");
  }
  // Bind to a live, same-UID ancestor, not an arbitrary PID or self declaration.
  const seen = new Set();
  let current = incarnation(process.pid);
  while (current && current.ppid > 1 && !seen.has(current.ppid)) {
    seen.add(current.ppid);
    current = incarnation(current.ppid);
    if (current?.pid === record.supervisor.pid &&
        current.startTime === record.supervisor.startTime &&
        current.uid === process.getuid() && !["Z", "X"].includes(current.state)) return record;
  }
  throw new Error("verified development supervisor is not a live caller ancestor");
}
export async function classifyRuntimeEnvironment(env = process.env, { advanced = false } = {}) {
  if (env.NODE_ENV === "production" || env.REPLIT_DEPLOYMENT === "1") {
    return { allowed: false, classification: "production", reason: "hard production/deployment indicator takes precedence" };
  }
  if (env.REPLIT_ENVIRONMENT !== "production") {
    return { allowed: true, classification: "unmarked", reason: "no configured production indicator" };
  }
  if (!advanced) {
    return { allowed: false, classification: "production",
      reason: "core has no development-workspace exception; production indicator blocks" };
  }
  try {
    const record = verifiedDevelopment(env);
    const attestation = await verifiedHostAttestation(record, env);
    return { allowed: true, classification: "verified-development",
      reason: "host-attested development-context exception to REPLIT_ENVIRONMENT only", attestation };
  } catch (e) {
    return { allowed: false, classification: "unverified",
      reason: `REPLIT_ENVIRONMENT=production without verified development context: ${e.message}` };
  }
}