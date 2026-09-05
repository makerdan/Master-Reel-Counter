#!/usr/bin/env node
/**
 * Safe account-managed skill projection helper.
 *
 * The account source is the only authority. This helper may generate the
 * workspace projection, but it never writes .local/custom_skills.
 */

import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PROJECTION = resolve(ROOT, ".agents/skills/.account-projections");
const DEFAULT_MIRROR = resolve(ROOT, ".local/custom_skills");
const MANIFEST_NAME = "manifest.json";
const MANIFEST_FORMAT = "account-skill-projection/v1";
const STATUS_FORMAT = "account-skill-metadata/v1";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION_RE = /\S/;
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 30 * 1000;

export const STATUS_EXIT_CODES = Object.freeze({
  pass: 0,
  mismatch: 1,
  "unavailable-source": 2,
  "missing-mirror": 3,
});

export class AccountSkillError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "AccountSkillError";
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new AccountSkillError(code, message);
}

function projectionRoot() {
  return resolve(process.env.ACCOUNT_SKILLS_PROJECTION_DIR || DEFAULT_PROJECTION);
}

function mirrorRoot() {
  return resolve(process.env.ACCOUNT_SKILLS_MIRROR_DIR || DEFAULT_MIRROR);
}

function lockPath() {
  return resolve(
    process.env.ACCOUNT_SKILLS_LOCK_FILE ||
      join(dirname(projectionRoot()), ".account-projections.lock"),
  );
}

function safeSlug(value) {
  return typeof value === "string" && SLUG_RE.test(value);
}

function assertSlug(value) {
  if (!safeSlug(value)) fail("invalid-skill-id");
  return value;
}

function assertRegular(path, code = "unsafe-file") {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail("unavailable-source");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(code);
  return stat;
}

function assertDirectory(path, code = "invalid-directory") {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail(code);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code);
  return stat;
}

function assertRelativePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail("invalid-entry");
  }
}

function readRevision(source) {
  const revisionPath = join(source, ".account-revision");
  assertRegular(revisionPath);
  const revision = readFileSync(revisionPath, "utf8").trim();
  if (!REVISION_RE.test(revision)) fail("unavailable-source");
  return revision;
}

function hashEntries(entries) {
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.path, "utf8");
    hash.update(Buffer.from([0]));
    hash.update(entry.bytes);
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

function walkSkill(skillPath, skillId) {
  const entries = [];
  const walk = (directory, prefix) => {
    let names;
    try {
      names = readdirSync(directory).sort((a, b) => a.localeCompare(b));
    } catch {
      fail("unavailable-source");
    }
    for (const name of names) {
      const absolute = join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      assertRelativePath(relativePath);
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch {
        fail("unavailable-source");
      }
      if (stat.isSymbolicLink()) fail("unsafe-file");
      if (stat.isDirectory()) walk(absolute, relativePath);
      else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        entries.push({
          path: relativePath,
          bytes,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        });
      } else {
        fail("unsafe-file");
      }
    }
  };
  walk(skillPath, "");
  entries.sort((a, b) => a.path.localeCompare(b.path));
  if (!entries.some((entry) => entry.path === "SKILL.md")) fail("missing-entry");
  return {
    skillId,
    fingerprint: hashEntries(entries),
    files: entries,
  };
}

function discoverSource(source) {
  assertDirectory(source, "unavailable-source");
  const revision = readRevision(source);
  let names;
  try {
    names = readdirSync(source).sort((a, b) => a.localeCompare(b));
  } catch {
    fail("unavailable-source");
  }
  const skills = [];
  for (const name of names) {
    if (name === ".account-revision") continue;
    const absolute = join(source, name);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      fail("unavailable-source");
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("unexpected-source-entry");
    assertSlug(name);
    skills.push(walkSkill(absolute, name));
  }
  skills.sort((a, b) => a.skillId.localeCompare(b.skillId));
  if (!skills.length) fail("no-skills");
  return { sourceRevision: revision, skills };
}

function sourceFromEnvironment() {
  const configured = process.env.ACCOUNT_SKILLS_SOURCE;
  if (!configured) fail("unavailable-source");
  let source;
  try {
    source = resolve(configured);
  } catch {
    fail("unavailable-source");
  }
  return source;
}

export function readSourceSnapshot() {
  return discoverSource(sourceFromEnvironment());
}

function manifestFor(snapshot) {
  return {
    format: MANIFEST_FORMAT,
    sourceRevision: snapshot.sourceRevision,
    skills: snapshot.skills.map((skill) => ({
      skillId: skill.skillId,
      fingerprint: skill.fingerprint,
      files: skill.files.map(({ path, sha256, size }) => ({ path, sha256, size })),
    })),
  };
}

function snapshotComparable(snapshot) {
  return JSON.stringify(manifestFor(snapshot));
}

function readManifest(directory) {
  const manifestPath = join(directory, MANIFEST_NAME);
  assertRegular(manifestPath, "invalid-manifest");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail("invalid-manifest");
  }
  if (
    !manifest ||
    manifest.format !== MANIFEST_FORMAT ||
    typeof manifest.sourceRevision !== "string" ||
    !REVISION_RE.test(manifest.sourceRevision) ||
    !Array.isArray(manifest.skills)
  ) {
    fail("invalid-manifest");
  }
  return manifest;
}

function validateFileList(files) {
  if (!Array.isArray(files) || !files.length) fail("invalid-manifest");
  const seen = new Set();
  let previous = "";
  for (const file of files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !Number.isInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      fail("invalid-manifest");
    }
    assertRelativePath(file.path);
    if (seen.has(file.path)) fail("invalid-manifest");
    if (previous && previous.localeCompare(file.path) >= 0) fail("invalid-manifest");
    previous = file.path;
    seen.add(file.path);
  }
  if (!seen.has("SKILL.md")) fail("missing-entry");
  return seen;
}

function projectionEntries(directory, skillId) {
  const skillPath = join(directory, skillId);
  assertDirectory(skillPath, "missing-projection-skill");
  const entries = [];
  const walk = (current, prefix) => {
    let names;
    try {
      names = readdirSync(current).sort((a, b) => a.localeCompare(b));
    } catch {
      fail("invalid-projection");
    }
    for (const name of names) {
      const absolute = join(current, name);
      const path = prefix ? `${prefix}/${name}` : name;
      assertRelativePath(path);
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch {
        fail("invalid-projection");
      }
      if (stat.isSymbolicLink()) fail("unsafe-file");
      if (stat.isDirectory()) walk(absolute, path);
      else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        entries.push({
          path,
          bytes,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.length,
        });
      } else {
        fail("unsafe-file");
      }
    }
  };
  walk(skillPath, "");
  entries.sort((a, b) => a.path.localeCompare(b.path));
  if (!entries.some((entry) => entry.path === "SKILL.md")) fail("missing-entry");
  return entries;
}

function skillMap(skills) {
  return new Map(skills.map((skill) => [skill.skillId, skill]));
}

function validateProjectionContents(directory, snapshot) {
  assertDirectory(directory, "missing-projection");
  const manifest = readManifest(directory);
  if (manifest.sourceRevision !== snapshot.sourceRevision) fail("revision-mismatch");
  const expected = skillMap(snapshot.skills);
  const actual = new Map();
  let names;
  try {
    names = readdirSync(directory).sort((a, b) => a.localeCompare(b));
  } catch {
    fail("invalid-projection");
  }
  for (const name of names) {
    if (name === MANIFEST_NAME) continue;
    if (!safeSlug(name)) fail("unexpected-projection-entry");
    const path = join(directory, name);
    assertDirectory(path, "unexpected-projection-entry");
    actual.set(name, path);
  }
  if (actual.size !== expected.size || manifest.skills.length !== expected.size) {
    fail("skill-set-mismatch");
  }
  const manifestIds = new Set();
  let previousSkillId = "";
  for (const manifestSkill of manifest.skills) {
    if (
      !manifestSkill ||
      !safeSlug(manifestSkill.skillId) ||
      manifestIds.has(manifestSkill.skillId) ||
      !/^[a-f0-9]{64}$/.test(manifestSkill.fingerprint)
    ) {
      fail("invalid-manifest");
    }
    if (previousSkillId && previousSkillId.localeCompare(manifestSkill.skillId) >= 0) {
      fail("invalid-manifest");
    }
    previousSkillId = manifestSkill.skillId;
    manifestIds.add(manifestSkill.skillId);
    const sourceSkill = expected.get(manifestSkill.skillId);
    if (!sourceSkill || !actual.has(manifestSkill.skillId)) fail("skill-set-mismatch");
    const actualEntries = projectionEntries(directory, manifestSkill.skillId);
    const manifestFiles = manifestSkill.files;
    const manifestPaths = validateFileList(manifestFiles);
    if (manifestPaths.size !== actualEntries.length) fail("file-set-mismatch");
    const actualFingerprint = hashEntries(actualEntries);
    if (actualFingerprint !== manifestSkill.fingerprint) fail("fingerprint-mismatch");
    if (actualFingerprint !== sourceSkill.fingerprint) fail("fingerprint-mismatch");
    const expectedFiles = new Map(sourceSkill.files.map((file) => [file.path, file]));
    for (const entry of actualEntries) {
      const declared = manifestFiles.find((file) => file.path === entry.path);
      const sourceFile = expectedFiles.get(entry.path);
      if (
        !declared ||
        !sourceFile ||
        declared.sha256 !== entry.sha256 ||
        declared.size !== entry.size ||
        sourceFile.sha256 !== entry.sha256 ||
        sourceFile.size !== entry.size
      ) {
        fail("file-mismatch");
      }
    }
  }
  if (manifestIds.size !== expected.size) fail("skill-set-mismatch");
  return { manifest, skills: [...expected.keys()] };
}

export function validateProjection(snapshot = readSourceSnapshot(), directory = projectionRoot()) {
  return validateProjectionContents(directory, snapshot);
}

function atomicWrite(path, bytes) {
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temp, bytes, { mode: 0o600 });
  renameSync(temp, path);
}

function createToken() {
  return randomBytes(8).toString("hex");
}

function lockOwner(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Number.isInteger(parsed.pid) &&
      typeof parsed.token === "string" &&
      Number.isInteger(parsed.acquiredAt)
    ) {
      return parsed;
    }
  } catch {
    // An old or interrupted lock is handled by the mtime path.
  }
  return null;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function tryReclaim(lock, now) {
  let stat;
  try {
    stat = lstatSync(lock);
  } catch {
    return false;
  }
  const raw = (() => {
    try {
      return readFileSync(lock, "utf8");
    } catch {
      return "";
    }
  })();
  const owner = lockOwner(raw);
  if (owner && pidAlive(owner.pid)) return false;
  if (!owner && now - stat.mtimeMs < Number(process.env.ACCOUNT_SKILLS_LOCK_STALE_MS || LOCK_STALE_MS)) {
    return false;
  }
  const reclaimed = `${lock}.reclaim-${createToken()}`;
  try {
    renameSync(lock, reclaimed);
    rmSync(reclaimed, { force: true });
    return true;
  } catch {
    try { rmSync(reclaimed, { force: true }); } catch { /* another contender won */ }
    return false;
  }
}

function acquireLock() {
  const lock = lockPath();
  mkdirSync(dirname(lock), { recursive: true });
  const started = Date.now();
  const token = createToken();
  while (Date.now() - started <= Number(process.env.ACCOUNT_SKILLS_LOCK_WAIT_MS || LOCK_WAIT_MS)) {
    try {
      const descriptor = openSync(lock, "wx", 0o600);
      const owner = JSON.stringify({ format: "account-skill-lock/v1", pid: process.pid, token, acquiredAt: Date.now() });
      writeFileSync(descriptor, `${owner}\n`, "utf8");
      closeSync(descriptor);
      return () => {
        try {
          const current = lockOwner(readFileSync(lock, "utf8"));
          if (current?.token === token && current.pid === process.pid) unlinkSync(lock);
        } catch { /* lock was reclaimed or already released */ }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") fail("lock-error");
      if (!tryReclaim(lock, Date.now())) {
        const delay = Number(process.env.ACCOUNT_SKILLS_LOCK_POLL_MS || 50);
        const end = Date.now() + Math.max(1, delay);
        while (Date.now() < end) { /* bounded synchronous wait */ }
      }
    }
  }
  fail("busy");
}

const OWNED_ARTIFACT_RE = /^\.account-skill-(?:staging|backup)-[a-f0-9]{16}$/;

function cleanupOwnedArtifacts(parent) {
  if (!existsSync(parent)) return;
  for (const name of readdirSync(parent)) {
    if (!OWNED_ARTIFACT_RE.test(name)) continue;
    const path = join(parent, name);
    try {
      if (lstatSync(path).isDirectory()) rmSync(path, { recursive: true, force: true });
    } catch {
      // A later validation or cleanup attempt reports an owned artifact issue.
    }
  }
}

function copySnapshot(snapshot, target) {
  mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const skill of snapshot.skills) {
    const skillTarget = join(target, skill.skillId);
    mkdirSync(skillTarget, { recursive: true, mode: 0o700 });
    for (const file of skill.files) {
      assertRelativePath(file.path);
      const fileTarget = join(skillTarget, ...file.path.split("/"));
      mkdirSync(dirname(fileTarget), { recursive: true, mode: 0o700 });
      atomicWrite(fileTarget, file.bytes);
    }
  }
  atomicWrite(join(target, MANIFEST_NAME), `${JSON.stringify(manifestFor(snapshot), null, 2)}\n`);
}

function removeOwnDirectory(path) {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

function sameSnapshot(left, right) {
  return snapshotComparable(left) === snapshotComparable(right);
}

export function refreshProjection({ maxAttempts = 2, afterStage, afterInstall } = {}) {
  const release = acquireLock();
  const destination = projectionRoot();
  const parent = dirname(destination);
  let staging;
  let backup;
  mkdirSync(parent, { recursive: true });
  try {
    cleanupOwnedArtifacts(parent);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const snapshot = readSourceSnapshot();
      const token = createToken();
      staging = join(parent, `.account-skill-staging-${token}`);
      backup = join(parent, `.account-skill-backup-${token}`);
      copySnapshot(snapshot, staging);
      validateProjectionContents(staging, snapshot);
      if (afterStage) afterStage({ source: sourceFromEnvironment(), staging });
      const afterCopy = readSourceSnapshot();
      if (!sameSnapshot(snapshot, afterCopy)) {
        removeOwnDirectory(staging);
        staging = undefined;
        if (attempt + 1 === maxAttempts) fail("source-changed");
        continue;
      }
      let movedExisting = false;
      try {
        if (existsSync(destination)) {
          renameSync(destination, backup);
          movedExisting = true;
        }
        renameSync(staging, destination);
        staging = undefined;
        if (afterInstall) afterInstall({ destination, backup: movedExisting ? backup : undefined });
        validateProjectionContents(destination, snapshot);
        if (movedExisting) removeOwnDirectory(backup);
        backup = undefined;
        return { skills: snapshot.skills.map((skill) => skill.skillId), sourceRevision: snapshot.sourceRevision };
      } catch (error) {
        try {
          if (existsSync(destination)) removeOwnDirectory(destination);
          if (movedExisting && existsSync(backup)) {
            renameSync(backup, destination);
            backup = undefined;
          }
        } catch {
          fail("rollback-failed");
        }
        if (error instanceof AccountSkillError) throw error;
        fail("install-failed");
      } finally {
        if (staging) removeOwnDirectory(staging);
        if (backup) removeOwnDirectory(backup);
      }
    }
    fail("source-changed");
  } finally {
    if (staging) removeOwnDirectory(staging);
    if (backup) removeOwnDirectory(backup);
    cleanupOwnedArtifacts(parent);
    release();
  }
}

export function loadSkills(skillIds = []) {
  const snapshot = readSourceSnapshot();
  validateProjectionContents(projectionRoot(), snapshot);
  const requested = skillIds.length ? skillIds.map(assertSlug) : snapshot.skills.map((skill) => skill.skillId);
  const available = skillMap(snapshot.skills);
  const result = [];
  for (const skillId of requested) {
    const sourceSkill = available.get(skillId);
    if (!sourceSkill) fail("missing-skill");
    const files = {};
    for (const file of sourceSkill.files) {
      files[file.path] = readFileSync(join(projectionRoot(), skillId, ...file.path.split("/")), "utf8");
    }
    result.push({ skillId, files });
  }
  return result;
}

function sourceSkillMetadata(snapshot, skillId) {
  assertSlug(skillId);
  const skill = snapshot.skills.find((candidate) => candidate.skillId === skillId);
  if (!skill) fail("missing-skill");
  return {
    format: STATUS_FORMAT,
    skillId,
    sourceRevision: snapshot.sourceRevision,
    fingerprint: skill.fingerprint,
  };
}

export function mirrorStatus(skillId) {
  let snapshot;
  try {
    snapshot = readSourceSnapshot();
  } catch (error) {
    if (error instanceof AccountSkillError) {
      return { outcome: "unavailable-source", code: STATUS_EXIT_CODES["unavailable-source"] };
    }
    return { outcome: "unavailable-source", code: STATUS_EXIT_CODES["unavailable-source"] };
  }
  let expected;
  try {
    expected = sourceSkillMetadata(snapshot, skillId);
  } catch {
    return { outcome: "mismatch", code: STATUS_EXIT_CODES.mismatch };
  }
  const sidecar = join(mirrorRoot(), skillId, ".account-skill-metadata.json");
  if (!existsSync(sidecar)) {
    return { outcome: "missing-mirror", code: STATUS_EXIT_CODES["missing-mirror"] };
  }
  try {
    assertRegular(sidecar, "mismatch");
    const actual = JSON.parse(readFileSync(sidecar, "utf8"));
    const exact =
      actual &&
      Object.keys(actual).length === Object.keys(expected).length &&
      Object.keys(expected).every((key) => actual[key] === expected[key]);
    return exact
      ? { outcome: "pass", code: STATUS_EXIT_CODES.pass }
      : { outcome: "mismatch", code: STATUS_EXIT_CODES.mismatch };
  } catch {
    return { outcome: "mismatch", code: STATUS_EXIT_CODES.mismatch };
  }
}

function parseArgs(argv) {
  const args = { command: argv[0], skills: [], json: false };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skill") {
      const value = argv[++index];
      if (!value) fail("invalid-skill-id");
      args.skills.push(value);
    } else if (argument === "--all") {
      args.all = true;
    } else if (argument === "--json") {
      args.json = true;
    } else {
      fail("invalid-argument");
    }
  }
  return args;
}

function printResult(command, result, json) {
  if (json) {
    console.log(JSON.stringify({ command, outcome: "pass", skills: result.skills || [] }));
  } else {
    console.log(`[account-skill] PASS ${command}: ${result.skills?.length || 0} skill(s).`);
  }
}

function main(argv) {
  const args = parseArgs(argv);
  if (!["refresh", "validate", "audit", "load", "status"].includes(args.command)) fail("invalid-command");
  if (args.command === "status") {
    if (args.skills.length !== 1) fail("skill-required");
    const result = mirrorStatus(args.skills[0]);
    if (args.json) console.log(JSON.stringify({ skill: args.skills[0], outcome: result.outcome }));
    else console.log(`[account-skill] ${result.outcome}: ${args.skills[0]}`);
    return result.code;
  }
  if (args.command === "refresh") {
    const result = refreshProjection();
    printResult("refresh", result, args.json);
    return 0;
  }
  const snapshot = readSourceSnapshot();
  validateProjectionContents(projectionRoot(), snapshot);
  const selected = args.skills.length ? args.skills.map(assertSlug) : snapshot.skills.map((skill) => skill.skillId);
  const available = new Set(snapshot.skills.map((skill) => skill.skillId));
  if (selected.some((skill) => !available.has(skill))) fail("missing-skill");
  if (args.command === "load") {
    loadSkills(selected);
  }
  printResult(args.command, { skills: selected }, args.json);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    const code = error instanceof AccountSkillError ? error.code : "internal-error";
    console.error(`[account-skill] FAIL ${code}.`);
    process.exitCode = 1;
  }
}