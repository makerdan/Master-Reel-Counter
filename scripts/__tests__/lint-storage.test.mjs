import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const LINTER = resolve(ROOT, "scripts/lint-storage.mjs");

function runLint(source, args = []) {
  const directory = mkdtempSync(resolve(tmpdir(), "storage-lint-"));
  try {
    writeFileSync(resolve(directory, "fixture.ts"), source);
    return spawnSync(process.execPath, [LINTER, ...args], {
      cwd: ROOT,
      env: { ...process.env, STORAGE_LINT_SRC: directory },
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("report-only mode reports direct and multiline executable calls", () => {
  const result = runLint(`
localStorage.getItem("unsafe-direct");
localStorage.setItem(
  \`unsafe-template-\${id}\`,
  "value",
);
sessionStorage.removeItem(
  "unsafe-multiline",
);
`);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /3 violations found/);
  assert.match(result.stdout, /fixture\.ts:2/);
  assert.match(result.stdout, /fixture\.ts:3/);
  assert.match(result.stdout, /fixture\.ts:7/);
});

test("strict mode returns a failure when executable calls violate the registry", () => {
  const result = runLint(`localStorage.setItem("unsafe-strict", "value");`, ["--strict"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /1 violation found/);
});

test("raw indirect keys and local storage aliases cannot bypass strict mode", () => {
  const result = runLint(`
const unsafeConstant = "unsafe-constant";
const unsafeTemplate = \`unsafe-\${id}\`;
const unsafeConcatenation = "unsafe-" + id;
const browserStorage = localStorage;
const browserSession = window.sessionStorage;
browserStorage.setItem(unsafeConstant, "value");
browserStorage.getItem(unsafeTemplate);
browserSession.removeItem(unsafeConcatenation);
`, ["--strict"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /3 violations found/);
});

test("registry imports, namespace imports, and aliases are accepted", () => {
  const result = runLint(`
import * as storageKeys from "@/lib/storageKeys";
import { THEME_MODE_KEY, dashboardStateKey } from "@/lib/storageKeys";
const aliasedRegistryKey = THEME_MODE_KEY;
const dashboardKey = dashboardStateKey("searchQuery", userId);
localStorage.getItem(aliasedRegistryKey);
sessionStorage.setItem(dashboardKey, "value");
localStorage.removeItem(storageKeys.THEME_MODE_KEY);
`, ["--strict"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No unregistered storage key literals found/);
});

test("comments, strings, and template contents are not treated as calls", () => {
  const result = runLint(`
// localStorage.setItem("comment-key", "value");
/* sessionStorage.removeItem("block-comment-key"); */
const documentation = 'localStorage.getItem("string-content")';
const templateDocumentation = \`sessionStorage.setItem("template-content", "value")\`;
`);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No unregistered storage key literals found/);
});

test("dash-prefixed raw keys are not a broad exemption", () => {
  const result = runLint(`sessionStorage.setItem("dash:debugPanel", "value");`, ["--strict"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /1 violation found/);
});

test("malformed source fails closed without crashing the linter", () => {
  const result = runLint(`localStorage.setItem("malformed-key",`);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /malformed TypeScript source/);
  assert.match(result.stdout, /violation/);
});
