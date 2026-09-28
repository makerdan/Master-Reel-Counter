import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync,
  readdirSync, realpathSync, chmodSync, rmSync, writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

// Workflow evidence, NOT protected attestation. The coordinator must supply
// trusted policy and retain returned manifests itself, not import caller JSON.
// environment = { identity: nonSecretFixtureVersion, externalState:
//   "none" | "verified", resetPolicy: nonSecretResetPolicyVersion }
// "verified" means the host adapter actually verified applicable fixture state.
// Never pass environment variables or connection strings to this API.
export const DEFAULT_EXCLUSIONS = Object.freeze([
  ".git", ".local", ".failure-gate-state", "test-results", "playwright-report",
  "tests/.auth", ".agents/skills/.workspace-projections", ".crash_log.json",
]);
const digestBytes = (value) => createHash("sha256").update(value).digest("hex");
export const evidenceDigest = (value) => digestBytes(JSON.stringify(value));
const safeIdentity = (s) => typeof s === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(s);
const blocked = (message) => { throw new Error(`EVIDENCE BLOCKED: ${message}`); };

export function environmentIdentity(environment) {
  if (!environment || !safeIdentity(environment.identity) ||
      !["none", "verified"].includes(environment.externalState) ||
      !safeIdentity(environment.resetPolicy)) {
    blocked("explicit non-secret environment and fixture/reset identity required");
  }
  return {
    identity: environment.identity, externalState: environment.externalState,
    resetPolicy: environment.resetPolicy,
  };
}

function inside(root, path) {
  const r = relative(root, path);
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
}

function excluded(path, exclusions) {
  const parts = path.split("/");
  // These are secret containers, not executable inputs. Projects that require
  // them must use an explicit secret-injection adapter with safe identity.
  if (parts.some((part) => /^\.env(?:\.|$)/.test(part) ||
      [".npmrc", ".netrc", ".ssh", ".aws", ".credentials"].includes(part) ||
      /\.(?:pem|key|p12|pfx)$/i.test(part))) return true;
  return exclusions.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function checkedExclusions(exclusions) {
  if (!Array.isArray(exclusions) || exclusions.some((p) =>
    typeof p !== "string" || !p || p.includes("\\") || p.startsWith("/") ||
    p.split("/").some((v) => v === "." || v === ".." || !v))) {
    blocked("invalid input exclusions");
  }
  return [...new Set([...DEFAULT_EXCLUSIONS, ...exclusions])].sort();
}

function fileBytes(path, maxBytes) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maxBytes) blocked("non-file or oversized input");
    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const n = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!n) blocked("input changed during read");
      offset += n;
    }
    const after = fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs) blocked("input changed during read");
    return { bytes: buffer, executable: Boolean(before.mode & 0o111) };
  } finally { closeSync(fd); }
}

// Includes tracked AND untracked/generated/dependency files; no git dependency.
// Exclusions are a policy input and must be approved/pinned with the tier.
// Internal file symlinks (.bin tools) are safely dereferenced into independent
// copies; directory symlinks and escaping links fail closed (no shared deps).
export function inputManifest({
  root, exclusions = [], environment, maxFileBytes = 128 * 1024 * 1024,
  maxTotalBytes = 4 * 1024 * 1024 * 1024, maxFiles = 250000,
}) {
  root = realpathSync(root);
  const omitted = checkedExclusions(exclusions);
  const files = [];
  let total = 0;
  function walk(directory, prefix = "") {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (excluded(path, omitted)) continue;
      const absolute = resolve(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) { walk(absolute, path); continue; }
      let source = absolute;
      if (stat.isSymbolicLink()) {
        source = realpathSync(absolute);
        if (!inside(root, source) || excluded(relative(root, source).split(sep).join("/"), omitted) ||
            !lstatSync(source).isFile()) blocked("escaping, excluded, or directory symlink input");
      } else if (!stat.isFile()) blocked("special filesystem input");
      const { bytes, executable } = fileBytes(source, maxFileBytes);
      total += bytes.length;
      if (total > maxTotalBytes || files.length >= maxFiles) blocked("input budget exceeded");
      files.push({ path, size: bytes.length, executable, digest: digestBytes(bytes) });
    }
  }
  walk(root);
  const runtime = {
    version: process.version, platform: process.platform, arch: process.arch,
    executableDigest: digestBytes(fileBytes(realpathSync(process.execPath), maxFileBytes).bytes),
  };
  const content = { version: 1, files, exclusions: omitted,
    environment: environmentIdentity(environment), runtime };
  return { ...content, digest: evidenceDigest(content) };
}

// Destination MUST be a new directory outside the source. Caller owns its
// lifecycle and must run only there, with no source-tree dependency symlinks.
// Parent directories are checked against symlink redirection before creation.
export function createSnapshot({ root, destination, ...options }) {
  root = realpathSync(root);
  destination = resolve(destination);
  let parent = resolve(destination, "..");
  if (realpathSync(parent) !== parent || inside(root, destination) || inside(destination, root)) {
    blocked("snapshot must have a real parent outside the input tree");
  }
  const manifest = inputManifest({ root, ...options });
  mkdirSync(destination, { mode: 0o700 }); // EEXIST intentionally fails closed.
  try {
    for (const entry of manifest.files) {
      const source = realpathSync(resolve(root, entry.path));
      if (!inside(root, source)) blocked("source escaped during copy");
      const { bytes, executable } = fileBytes(source, options.maxFileBytes ?? 128 * 1024 * 1024);
      if (digestBytes(bytes) !== entry.digest || executable !== entry.executable) {
        blocked("source changed during copy");
      }
      const target = resolve(destination, entry.path);
      mkdirSync(resolve(target, ".."), { recursive: true, mode: 0o700 });
      writeFileSync(target, bytes, { flag: "wx", mode: executable ? 0o500 : 0o400 });
      chmodSync(target, executable ? 0o500 : 0o400);
    }
    if (inputManifest({ root, ...options }).digest !== manifest.digest ||
        inputManifest({ root: destination, ...options }).digest !== manifest.digest) {
      blocked("input changed or isolated copy differs");
    }
    return { root: destination, manifest, digest: manifest.digest,
      isolation: "independent-copy", enforcementMode: "workflow" };
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

export function verifySnapshot({ root, manifest, ...options }) {
  if (!manifest?.digest) blocked("missing snapshot manifest");
  const current = inputManifest({
    ...options, root, exclusions: manifest.exclusions, environment: manifest.environment,
  });
  if (current.digest !== manifest.digest) blocked("snapshot inputs changed");
  return current;
}

// Caller passes a coordinator-retained digest and report path. This function
// cannot turn agent-written reports into trusted/protected evidence.
export function readVerifiedReport({ root, path, digest, maxBytes = 1024 * 1024 }) {
  if (typeof path !== "string" || isAbsolute(path) || path.includes("\\") ||
      path.split("/").some((p) => !p || p === "." || p === "..") ||
      !/^[a-f0-9]{64}$/.test(digest ?? "") ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) {
    blocked("invalid report reference or budget");
  }
  root = realpathSync(root);
  let target = root;
  for (const component of path.split("/")) {
    target = resolve(target, component);
    if (lstatSync(target).isSymbolicLink()) blocked("report symlink forbidden");
  }
  if (!inside(root, realpathSync(target))) blocked("report escaped evidence root");
  const { bytes } = fileBytes(target, maxBytes);
  if (digestBytes(bytes) !== digest) blocked("report digest mismatch");
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { blocked("invalid JSON report"); }
}