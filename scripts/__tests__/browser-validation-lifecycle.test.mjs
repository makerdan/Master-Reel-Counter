import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  formatBrowserProjectCoverage,
  getBrowserProjectCoverage,
} from "../lib/browser-project-coverage.mjs";
import {
  isProcessGroupAlive,
  runOwnedProcessGroup,
} from "../lib/owned-process-group.mjs";

const root = resolve(import.meta.dirname, "../..");

test("local heavy coverage explicitly classifies WebKit as CI-only", () => {
  assert.deepEqual(
    getBrowserProjectCoverage({}),
    {
      projects: ["chromium", "mobile-chromium"],
      webkitEnabled: false,
    },
  );
  assert.match(
    formatBrowserProjectCoverage({}),
    /mobile-webkit is CI-only.*local heavy run is partial, not full browser-matrix coverage/,
  );
});

test("CI and explicit opt-in include WebKit in the reported project matrix", () => {
  for (const env of [
    { CI: "true" },
    { PLAYWRIGHT_WEBKIT_ENABLED: "true" },
  ]) {
    assert.deepEqual(
      getBrowserProjectCoverage(env),
      {
        projects: ["chromium", "mobile-chromium", "mobile-webkit"],
        webkitEnabled: true,
      },
    );
    assert.match(formatBrowserProjectCoverage(env), /WebKit coverage is included/);
  }
});

test("Playwright config uses the same WebKit coverage decision as the runner", async () => {
  const config = await readFile(resolve(root, "playwright.config.ts"), "utf8");
  assert.match(config, /getBrowserProjectCoverage\(process\.env\)/);
  assert.match(config, /webkitEnabled\s*\?/);
});

test("cancellation kills descendants and waits for the group before cleanup", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "browser-process-group-"));
  const parentScript = resolve(directory, "parent.mjs");
  const descendantReady = resolve(directory, "descendant-ready");
  const childPidFile = resolve(directory, "child.pid");
  const cleanupMarker = resolve(directory, "database-cleanup");
  const cancellation = new AbortController();
  const descendantSource = [
    'const { writeFileSync } = require("node:fs");',
    'process.on("SIGTERM", () => {});',
    `writeFileSync(${JSON.stringify(descendantReady)}, String(process.pid));`,
    "setInterval(() => {}, 1_000);",
  ].join("\n");
  await writeFile(
    parentScript,
    [
      'import { spawn } from "node:child_process";',
      'import { access, writeFile } from "node:fs/promises";',
      'process.on("SIGTERM", () => process.exit(23));',
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}], { detached: true, stdio: "ignore" });`,
      "let ready = false;",
      "for (let i = 0; i < 500; i += 1) {",
      `  try { await access(${JSON.stringify(descendantReady)}); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }`,
      "}",
      "if (!ready) process.exit(99);",
      `await writeFile(${JSON.stringify(childPidFile)}, String(child.pid));`,
      "setInterval(() => {}, 1_000);",
    ].join("\n"),
  );

  let running;
  try {
    running = runOwnedProcessGroup(process.execPath, [parentScript], {
      cwd: root,
      env: process.env,
      stdio: "ignore",
      signal: cancellation.signal,
      terminationGraceMs: 100,
      terminationWaitMs: 2_000,
    });

    let childPid;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      childPid = Number(await readFile(childPidFile, "utf8").catch(() => ""));
      if (childPid > 0) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
    assert.ok(childPid > 0, "fixture descendant did not become ready");

    cancellation.abort("SIGTERM");
    const result = await running;
    assert.equal(result.status, 23, "the child's original nonzero status is preserved");
    assert.equal(result.groupGone, true);
    assert.equal(isProcessGroupAlive(result.processGroupId), false);

    // The runner's temporary database cleanup is safe only after this point.
    await writeFile(cleanupMarker, "database dropped\n");
    assert.equal(await readFile(cleanupMarker, "utf8"), "database dropped\n");
  } finally {
    cancellation.abort("SIGTERM");
    if (running) await running.catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

test("browser runner refuses temporary database cleanup when the group survives", async () => {
  const runner = await readFile(resolve(root, "scripts/run-browser-tests.mjs"), "utf8");
  assert.match(runner, /mostRecentProcessGroup && !mostRecentProcessGroup\.groupGone/);
  assert.match(runner, /Refusing to drop .*browser process group .* could not be confirmed stopped/);
});

test("guarded retry browser selection uses the existing database wrapper after successful compilation", async () => {
  const compiler = await readFile(resolve(root, "scripts/run-typechecked-playwright.mjs"), "utf8");
  assert.ok(compiler.indexOf('if (typecheckStatus !== 0) process.exit(typecheckStatus)') <
    compiler.indexOf('args[0] === "--isolated-database"'));
  assert.match(compiler, /\[resolve\(root, "scripts\/run-browser-tests\.mjs"\), \.\.\.args\]/);
  const runner = await readFile(resolve(root, "scripts/run-browser-tests.mjs"), "utf8");
  assert.match(runner, /prepare-release-test-database\.mjs/);
  assert.match(runner, /"test", \.\.\.process\.argv\.slice\(2\)/);
  assert.match(runner, /DATABASE_URL: browserDatabaseUrl/);
  assert.doesNotMatch(runner, /"--project"/);
});