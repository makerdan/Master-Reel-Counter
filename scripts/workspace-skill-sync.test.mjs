import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  WorkspaceSkillSyncError,
  loadSkills,
  mirrorStatus,
  readSourceSnapshot,
  refreshProjection,
  validateProjection,
} from "./workspace-skill-sync.mjs";

const SCRIPT = join(process.cwd(), "scripts/workspace-skill-sync.mjs");
const APP_SUPPORT_OPS = join(process.cwd(), ".agents", "skills", "app-support-ops");
const PACKAGE_JSON = join(process.cwd(), "package.json");
const MAX_CLI_OUTPUT_BYTES = 1024;

function fixture(t, { revision = "revision-private-7" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "workspace-skill-sync-"));
  const source = join(root, "source");
  const projection = join(root, "projection");
  const mirror = join(root, "mirror");
  const lock = join(root, "refresh.lock");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, ".workspace-revision"), `${revision}\n`);
  const previous = {
    WORKSPACE_SKILLS_SOURCE: process.env.WORKSPACE_SKILLS_SOURCE,
    WORKSPACE_SKILLS_PROJECTION_DIR: process.env.WORKSPACE_SKILLS_PROJECTION_DIR,
    WORKSPACE_SKILLS_MIRROR_DIR: process.env.WORKSPACE_SKILLS_MIRROR_DIR,
    WORKSPACE_SKILLS_LOCK_FILE: process.env.WORKSPACE_SKILLS_LOCK_FILE,
    WORKSPACE_SKILLS_LOCK_WAIT_MS: process.env.WORKSPACE_SKILLS_LOCK_WAIT_MS,
    WORKSPACE_SKILLS_LOCK_POLL_MS: process.env.WORKSPACE_SKILLS_LOCK_POLL_MS,
    WORKSPACE_SKILLS_LOCK_STALE_MS: process.env.WORKSPACE_SKILLS_LOCK_STALE_MS,
  };
  process.env.WORKSPACE_SKILLS_SOURCE = source;
  process.env.WORKSPACE_SKILLS_PROJECTION_DIR = projection;
  process.env.WORKSPACE_SKILLS_MIRROR_DIR = mirror;
  process.env.WORKSPACE_SKILLS_LOCK_FILE = lock;
  process.env.WORKSPACE_SKILLS_LOCK_WAIT_MS = "250";
  process.env.WORKSPACE_SKILLS_LOCK_POLL_MS = "1";
  process.env.WORKSPACE_SKILLS_LOCK_STALE_MS = "25";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  return { root, source, projection, mirror, lock };
}

function addSkill(source, skillId, files = { "SKILL.md": `# ${skillId}\n` }) {
  const directory = join(source, skillId);
  mkdirSync(directory, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const destination = join(directory, ...path.split("/"));
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, content);
  }
}

function errorCode(callback) {
  try {
    callback();
    return null;
  } catch (error) {
    assert.ok(error instanceof WorkspaceSkillSyncError);
    return error.code;
  }
}

function npmCommand(fixturePaths, script, args = [], { source = fixturePaths.source, unsetSource = false } = {}) {
  const env = { ...process.env };
  if (unsetSource) delete env.WORKSPACE_SKILLS_SOURCE;
  else env.WORKSPACE_SKILLS_SOURCE = source;
  env.WORKSPACE_SKILLS_PROJECTION_DIR = fixturePaths.projection;
  env.WORKSPACE_SKILLS_MIRROR_DIR = fixturePaths.mirror;
  env.WORKSPACE_SKILLS_LOCK_FILE = fixturePaths.lock;
  const result = spawnSync("npm", ["run", "--silent", script, "--", ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
  });
  if (result.error) throw result.error;
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  assert.ok(Buffer.byteLength(stdout, "utf8") <= MAX_CLI_OUTPUT_BYTES);
  assert.ok(Buffer.byteLength(stderr, "utf8") <= MAX_CLI_OUTPUT_BYTES);
  return { status: result.status, stdout, stderr };
}

test("refreshes a complete recursive projection and loads selected or all skills", (t) => {
  const fixturePaths = fixture(t);
  addSkill(fixturePaths.source, "alpha-skill", {
    "SKILL.md": "# alpha\n",
    "references/nested.md": "nested support\n",
  });
  addSkill(fixturePaths.source, "beta-skill");

  const refreshed = refreshProjection();
  assert.deepEqual(refreshed.skills, ["alpha-skill", "beta-skill"]);
  assert.deepEqual(validateProjection().skills, ["alpha-skill", "beta-skill"]);
  assert.equal(loadSkills(["alpha-skill"])[0].files["references/nested.md"], "nested support\n");
  assert.equal(loadSkills().length, 2);
  assert.equal(readFileSync(join(fixturePaths.projection, "manifest.json"), "utf8").includes("nested.md"), true);
});

test("discovers and validates the tracked App Support Ops package recursively", (t) => {
  const fixturePaths = fixture(t, { revision: "tracked-app-support-ops" });
  const skill = readFileSync(join(APP_SUPPORT_OPS, "SKILL.md"), "utf8");
  const evals = readFileSync(join(APP_SUPPORT_OPS, "evals", "evals.json"), "utf8");
  addSkill(fixturePaths.source, "app-support-ops", {
    "SKILL.md": skill,
    "evals/evals.json": evals,
  });

  const parsed = JSON.parse(evals);
  assert.equal(parsed.skill_name, "app-support-ops");
  assert.deepEqual(parsed.evals.map(({ id }) => id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(parsed.evals.every(({ expectations }) => expectations.length >= 2), true);

  refreshProjection();
  assert.deepEqual(validateProjection().skills, ["app-support-ops"]);
  const [loaded] = loadSkills(["app-support-ops"]);
  assert.equal(loaded.files["SKILL.md"], skill);
  assert.equal(loaded.files["evals/evals.json"], evals);
});

test("supports arbitrary future skill counts without touching workspace-authored skills", (t) => {
  const fixturePaths = fixture(t);
  for (let index = 0; index < 12; index += 1) addSkill(fixturePaths.source, `skill-${String(index).padStart(2, "0")}`);
  const authored = join(fixturePaths.root, "workspace-authored-skill");
  mkdirSync(authored);
  writeFileSync(join(authored, "SKILL.md"), "workspace content\n");
  refreshProjection();
  assert.equal(loadSkills().length, 12);
  assert.equal(readFileSync(join(authored, "SKILL.md"), "utf8"), "workspace content\n");
});

test("fails closed for missing source, revision, malformed entries, and unsafe files", (t) => {
  const fixturePaths = fixture(t);
  rmSync(fixturePaths.source, { recursive: true, force: true });
  assert.equal(errorCode(readSourceSnapshot), "unavailable-source");
  mkdirSync(fixturePaths.source);
  writeFileSync(join(fixturePaths.source, ".workspace-revision"), "\n");
  assert.equal(errorCode(readSourceSnapshot), "unavailable-source");

  writeFileSync(join(fixturePaths.source, ".workspace-revision"), "revision\n");
  writeFileSync(join(fixturePaths.source, "not-a-skill.txt"), "unexpected\n");
  assert.equal(errorCode(readSourceSnapshot), "unexpected-source-entry");
  rmSync(join(fixturePaths.source, "not-a-skill.txt"));
  mkdirSync(join(fixturePaths.source, "BadSlug"));
  writeFileSync(join(fixturePaths.source, "BadSlug", "SKILL.md"), "bad\n");
  assert.equal(errorCode(readSourceSnapshot), "invalid-skill-id");
  rmSync(join(fixturePaths.source, "BadSlug"), { recursive: true, force: true });
  mkdirSync(join(fixturePaths.source, "safe-skill"));
  symlinkSync(join(fixturePaths.source, ".workspace-revision"), join(fixturePaths.source, "safe-skill", "SKILL.md"));
  assert.equal(errorCode(readSourceSnapshot), "unsafe-file");
});

test("rejects missing, extra, changed, reordered, and symlinked projection entries", (t) => {
  const fixturePaths = fixture(t);
  addSkill(fixturePaths.source, "another-skill");
  addSkill(fixturePaths.source, "safe-skill", {
    "SKILL.md": "safe\n",
    "docs/a.md": "a\n",
  });
  refreshProjection();
  rmSync(join(fixturePaths.projection, "safe-skill", "docs", "a.md"));
  assert.equal(errorCode(validateProjection), "file-set-mismatch");
  refreshProjection();
  writeFileSync(join(fixturePaths.projection, "safe-skill", "extra.md"), "extra\n");
  assert.equal(errorCode(validateProjection), "file-set-mismatch");
  refreshProjection();
  writeFileSync(join(fixturePaths.projection, "safe-skill", "SKILL.md"), "changed\n");
  assert.equal(errorCode(validateProjection), "fingerprint-mismatch");
  refreshProjection();
  const manifestPath = join(fixturePaths.projection, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.skills.reverse();
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(errorCode(validateProjection), "invalid-manifest");
  refreshProjection();
  symlinkSync(join(fixturePaths.projection, "safe-skill", "SKILL.md"), join(fixturePaths.projection, "linked-skill"));
  assert.equal(errorCode(validateProjection), "unexpected-projection-entry");
});

test("rejects special source files and cleans only owned interrupted artifacts", (t) => {
  const fixturePaths = fixture(t);
  addSkill(fixturePaths.source, "special-skill");
  const special = join(fixturePaths.source, "special-skill", "pipe");
  execFileSync("mkfifo", [special]);
  assert.equal(errorCode(readSourceSnapshot), "unsafe-file");
  rmSync(special);
  const parent = join(fixturePaths.root, "projection-parent");
  process.env.WORKSPACE_SKILLS_PROJECTION_DIR = join(parent, "projection");
  process.env.WORKSPACE_SKILLS_LOCK_FILE = join(parent, "lock");
  mkdirSync(parent, { recursive: true });
  mkdirSync(join(parent, ".workspace-skill-staging-0123456789abcdef"));
  mkdirSync(join(parent, ".workspace-skill-backup-fedcba9876543210"));
  mkdirSync(join(parent, ".workspace-skill-staging-not-owned"));
  refreshProjection();
  assert.equal(existsSync(join(parent, ".workspace-skill-staging-0123456789abcdef")), false);
  assert.equal(existsSync(join(parent, ".workspace-skill-backup-fedcba9876543210")), false);
  assert.equal(existsSync(join(parent, ".workspace-skill-staging-not-owned")), true);
});

test("detects source changes during staging and restores a prior projection on install failure", (t) => {
  const fixturePaths = fixture(t);
  addSkill(fixturePaths.source, "transactional-skill", { "SKILL.md": "old\n" });
  refreshProjection();
  assert.equal(errorCode(() => refreshProjection({
    maxAttempts: 1,
    afterStage: () => writeFileSync(join(fixturePaths.source, "transactional-skill", "SKILL.md"), "changed during copy\n"),
  })), "source-changed");
  assert.equal(readFileSync(join(fixturePaths.projection, "transactional-skill", "SKILL.md"), "utf8"), "old\n");
  writeFileSync(join(fixturePaths.source, "transactional-skill", "SKILL.md"), "new valid\n");
  assert.equal(errorCode(() => refreshProjection({
    maxAttempts: 1,
    afterInstall: () => { throw new Error("simulated install validation failure"); },
  })), "install-failed");
  assert.equal(readFileSync(join(fixturePaths.projection, "transactional-skill", "SKILL.md"), "utf8"), "old\n");
  assert.equal(readdirSync(fixturePaths.root).some((name) => name.includes("workspace-skill-")), false);
});

test("serializes concurrent refreshes of the same projection", async (t) => {
  const fixturePaths = fixture(t);
  addSkill(fixturePaths.source, "race-skill");
  const env = { ...process.env };
  env.WORKSPACE_SKILLS_SOURCE = fixturePaths.source;
  env.WORKSPACE_SKILLS_PROJECTION_DIR = fixturePaths.projection;
  env.WORKSPACE_SKILLS_LOCK_FILE = fixturePaths.lock;
  env.WORKSPACE_SKILLS_LOCK_WAIT_MS = "5000";
  env.WORKSPACE_SKILLS_LOCK_POLL_MS = "2";
  const run = () => new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SCRIPT, "refresh"], { env, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, output }));
  });
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.map((result) => result.code), [0, 0]);
  assert.deepEqual(validateProjection().skills, ["race-skill"]);
});

test("recovers only abandoned locks and leaves live work busy", (t) => {
  const fixturePaths = fixture(t);
  addSkill(fixturePaths.source, "locked-skill");
  writeFileSync(fixturePaths.lock, JSON.stringify({
    format: "workspace-skill-lock/v1",
    pid: 999999999,
    token: "dead-owner",
    acquiredAt: Date.now(),
  }));
  refreshProjection();
  assert.equal(lstatSync(fixturePaths.projection).isDirectory(), true);

  writeFileSync(fixturePaths.lock, JSON.stringify({
    format: "workspace-skill-lock/v1",
    pid: process.pid,
    token: "live-owner",
    acquiredAt: Date.now(),
  }));
  assert.equal(errorCode(refreshProjection), "busy");
  rmSync(fixturePaths.lock, { force: true });
  writeFileSync(fixturePaths.lock, "legacy lock");
  const old = new Date(Date.now() - 1000);
  utimesSync(fixturePaths.lock, old, old);
  refreshProjection();
});

test("keeps source-change and stale projection failures fail-closed", (t) => {
  const fixturePaths = fixture(t);
  addSkill(fixturePaths.source, "changing-skill", { "SKILL.md": "before\n" });
  refreshProjection();
  writeFileSync(join(fixturePaths.source, "changing-skill", "SKILL.md"), "after\n");
  assert.equal(errorCode(() => loadSkills(["changing-skill"])), "fingerprint-mismatch");
  assert.equal(errorCode(validateProjection), "fingerprint-mismatch");
});

test("status has exact parity outcomes and does not mutate source, projection, or mirror", (t) => {
  const fixturePaths = fixture(t, { revision: "opaque-private-revision" });
  addSkill(fixturePaths.source, "status-skill");
  refreshProjection();
  mkdirSync(join(fixturePaths.mirror, "status-skill"), { recursive: true });
  const snapshot = readSourceSnapshot();
  const skill = snapshot.skills[0];
  const sidecar = join(fixturePaths.mirror, "status-skill", ".workspace-skill-metadata.json");
  const metadata = {
    format: "workspace-skill-metadata/v1",
    skillId: "status-skill",
    sourceRevision: snapshot.sourceRevision,
    fingerprint: skill.fingerprint,
  };
  writeFileSync(sidecar, JSON.stringify(metadata));
  assert.deepEqual(mirrorStatus("status-skill"), { outcome: "pass", code: 0 });
  writeFileSync(sidecar, JSON.stringify({ ...metadata, fingerprint: "0".repeat(64) }));
  assert.deepEqual(mirrorStatus("status-skill"), { outcome: "mismatch", code: 1 });
  rmSync(sidecar);
  assert.deepEqual(mirrorStatus("status-skill"), { outcome: "missing-mirror", code: 3 });
  const before = readFileSync(join(fixturePaths.source, ".workspace-revision"), "utf8");
  delete process.env.WORKSPACE_SKILLS_SOURCE;
  assert.deepEqual(mirrorStatus("status-skill"), { outcome: "unavailable-source", code: 2 });
  process.env.WORKSPACE_SKILLS_SOURCE = fixturePaths.source;
  assert.equal(readFileSync(join(fixturePaths.source, ".workspace-revision"), "utf8"), before);
});

test("status CLI returns documented codes and redacts private values", (t) => {
  const fixturePaths = fixture(t, { revision: "do-not-print-this-revision" });
  addSkill(fixturePaths.source, "cli-skill", { "SKILL.md": "private skill body\n" });
  const env = { ...process.env };
  const run = () => execFileSync(process.execPath, [SCRIPT, "status", "--skill", "cli-skill"], {
    env,
    encoding: "utf8",
  });
  env.WORKSPACE_SKILLS_SOURCE = fixturePaths.source;
  env.WORKSPACE_SKILLS_PROJECTION_DIR = fixturePaths.projection;
  env.WORKSPACE_SKILLS_MIRROR_DIR = fixturePaths.mirror;
  env.WORKSPACE_SKILLS_LOCK_FILE = fixturePaths.lock;
  assert.throws(run, (error) => error.status === 3 && !error.stdout.includes("do-not-print-this-revision"));
  mkdirSync(join(fixturePaths.mirror, "cli-skill"), { recursive: true });
  writeFileSync(join(fixturePaths.mirror, "cli-skill", ".workspace-skill-metadata.json"), "{}");
  assert.throws(run, (error) => error.status === 1 && !error.stdout.includes("private skill body"));
  chmodSync(join(fixturePaths.source, ".workspace-revision"), 0o600);
});

test("public workspace-skill npm commands run against isolated fixtures", (t) => {
  const fixturePaths = fixture(t, { revision: "private-cli-revision" });
  addSkill(fixturePaths.source, "cli-alpha", {
    "SKILL.md": "private cli skill body\n",
    "references/private.md": "private cli reference\n",
  });
  addSkill(fixturePaths.source, "cli-beta");

  const refresh = npmCommand(fixturePaths, "workspace-skill:refresh", ["--json"]);
  assert.equal(refresh.status, 0);
  assert.deepEqual(JSON.parse(refresh.stdout), {
    command: "refresh",
    outcome: "pass",
    skills: ["cli-alpha", "cli-beta"],
  });
  assert.doesNotMatch(refresh.stdout, /private-cli-revision|private cli skill body|private cli reference/);
  assert.doesNotMatch(refresh.stdout, /workspace-skill-sync-[^/]+/);
  const successfulCommands = [
    ["workspace-skill:validate", ["--json"], ["cli-alpha", "cli-beta"]],
    ["workspace-skill:audit", ["--json"], ["cli-alpha", "cli-beta"]],
    ["workspace-skill:load", ["--skill", "cli-alpha", "--json"], ["cli-alpha"]],
  ];
  for (const [script, args, skills] of successfulCommands) {
    const result = npmCommand(fixturePaths, script, args);
    assert.equal(result.status, 0, `${script} should succeed: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.skills, skills);
    assert.equal(payload.outcome, "pass");
    assert.doesNotMatch(result.stdout, /private-cli-revision|private cli skill body|private cli reference/);
    assert.doesNotMatch(result.stdout, /workspace-skill-sync-[^/]+/);
  }

  const snapshot = readSourceSnapshot();
  const skill = snapshot.skills.find(({ skillId }) => skillId === "cli-alpha");
  mkdirSync(join(fixturePaths.mirror, "cli-alpha"), { recursive: true });
  writeFileSync(
    join(fixturePaths.mirror, "cli-alpha", ".workspace-skill-metadata.json"),
    JSON.stringify({
      format: "workspace-skill-metadata/v1",
      skillId: "cli-alpha",
      sourceRevision: snapshot.sourceRevision,
      fingerprint: skill.fingerprint,
    }),
  );
  const status = npmCommand(fixturePaths, "workspace-skill:status", ["--skill", "cli-alpha", "--json"]);
  assert.equal(status.status, 0);
  assert.deepEqual(JSON.parse(status.stdout), { skill: "cli-alpha", outcome: "pass" });
  assert.doesNotMatch(status.stdout, /private-cli-revision|private cli skill body|private cli reference/);
  assert.doesNotMatch(status.stdout, /workspace-skill-sync-[^/]+/);
});

test("workspace-skill npm commands fail closed for unavailable and invalid inputs", (t) => {
  const fixturePaths = fixture(t);
  addSkill(fixturePaths.source, "cli-skill");

  for (const script of [
    "workspace-skill:refresh",
    "workspace-skill:validate",
    "workspace-skill:audit",
    "workspace-skill:load",
  ]) {
    const result = npmCommand(fixturePaths, script, ["--json"], { unsetSource: true });
    assert.notEqual(result.status, 0, `${script} must reject an unavailable source`);
    assert.match(result.stderr, /\[workspace-skill\] FAIL unavailable-source\./);
  }

  const refresh = npmCommand(fixturePaths, "workspace-skill:refresh");
  assert.equal(refresh.status, 0);
  const missingSkill = npmCommand(fixturePaths, "workspace-skill:load", ["--skill", "missing-skill"]);
  assert.equal(missingSkill.status, 1);
  assert.match(missingSkill.stderr, /\[workspace-skill\] FAIL missing-skill\./);

  const missingMirror = npmCommand(fixturePaths, "workspace-skill:status", ["--skill", "cli-skill"]);
  assert.equal(missingMirror.status, 3);
  assert.match(missingMirror.stdout, /\[workspace-skill\] missing-mirror: cli-skill/);

  const unavailableStatus = npmCommand(fixturePaths, "workspace-skill:status", ["--skill", "cli-skill"], {
    unsetSource: true,
  });
  assert.equal(unavailableStatus.status, 2);
  assert.match(unavailableStatus.stdout, /\[workspace-skill\] unavailable-source: cli-skill/);
});

test("package scripts do not register retired account-managed skill aliases", () => {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  const retiredAliases = Object.keys(packageJson.scripts).filter((name) => /^account-skill(?::|$)/.test(name));
  assert.deepEqual(retiredAliases, []);
});
