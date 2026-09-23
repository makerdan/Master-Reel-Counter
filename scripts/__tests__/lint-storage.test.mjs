import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { analyzeSource } from "../lint-storage.mjs";

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

test("malformed source fails strict mode", () => {
  const result = runLint(`sessionStorage.getItem("malformed-key",`, ["--strict"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /malformed TypeScript source/);
});

test("accepts multiline registry constants, factories, and local aliases", () => {
  const violations = analyzeSource(`
    import { THEME_MODE_KEY, scannerResultsKey as resultKey } from "@/lib/storageKeys";
    const aliasedConstant = THEME_MODE_KEY;
    const aliasedFactory = resultKey;
    localStorage.getItem(
      aliasedConstant,
    );
    sessionStorage.setItem(
      aliasedFactory(sessionId),
      value,
    );
  `);
  assert.deepEqual(violations, []);
});

test("rejects unknown registry exports and expression-built keys", () => {
  const violations = analyzeSource(`
    import {
      DASHBOARD_STATE_FIELDS,
      HELP_CHAT_MAX_MESSAGES,
      THEME_MODE_KEY,
    } from "@/lib/storageKeys";
    const unknownExport = DASHBOARD_STATE_FIELDS;
    const numericExport = HELP_CHAT_MAX_MESSAGES;
    const concatenated = THEME_MODE_KEY + "-suffix";
    const templated = \`\${THEME_MODE_KEY}-suffix\`;
    localStorage.getItem(unknownExport);
    localStorage.getItem(numericExport);
    localStorage.getItem(concatenated);
    localStorage.getItem(templated);
  `);
  assert.equal(violations.length, 4);
});

test("accepts only the documented identity-scoped dashboard factory shape", () => {
  const violations = analyzeSource(`
    import { dashboardStateKey } from "@/lib/storageKeys";
    const field = "searchQuery";
    const valid = dashboardStateKey(field, userId);
    sessionStorage.getItem(valid);
    sessionStorage.getItem(dashboardStateKey("filterStatus", currentUser.id));
    sessionStorage.getItem(dashboardStateKey("debugPanel", userId));
    sessionStorage.getItem(dashboardStateKey("searchQuery"));
    sessionStorage.getItem(dashboardStateKey("searchQuery", "fixed-user"));
  `);
  assert.equal(violations.length, 3);
  assert.deepEqual(
    violations.map(({ line }) => line),
    [7, 8, 9],
  );
});

test("does not treat shadowed storage globals as browser storage", () => {
  const violations = analyzeSource(`
    function unsafe(localStorage) {
      localStorage.setItem("shadowed-key", value);
    }
    function alsoUnsafe(sessionStorage) {
      sessionStorage.removeItem("shadowed-key");
    }
  `);
  assert.deepEqual(violations, []);
});

test("rejects shadowed registry factories and namespace aliases", () => {
  const violations = analyzeSource(`
    import * as registry from "@/lib/storageKeys";
    function unsafe(dashboardStateKey, registry) {
      localStorage.getItem(dashboardStateKey("searchQuery", userId));
      localStorage.getItem(registry.THEME_MODE_KEY);
    }
  `);
  assert.equal(violations.length, 2);
});

test("accepts namespace imports and window storage aliases for registry keys", () => {
  const violations = analyzeSource(`
    import * as registry from "@/lib/storageKeys";
    const browserStorage = window.localStorage;
    browserStorage.setItem(
      registry.scannerResultsKey(sessionId),
      value,
    );
  `);
  assert.deepEqual(violations, []);
});

test("does not let a shadowed unsafe alias inherit a registered outer key", () => {
  const violations = analyzeSource(`
    import { THEME_MODE_KEY } from "@/lib/storageKeys";
    const key = THEME_MODE_KEY;
    localStorage.getItem(key);
    function writeUnsafe() {
      const key = "unsafe-shadowed-key";
      localStorage.setItem(key, value);
    }
  `);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 7);
});

test("rejects multiline literals, indirect literals, and aliased storage objects", () => {
  const violations = analyzeSource(`
    const rawConstant = "unsafe-constant";
    const rawTemplate = \`unsafe-\${sessionId}\`;
    const browserStorage = localStorage;
    browserStorage.setItem(
      rawConstant,
      value,
    );
    localStorage.removeItem(rawTemplate);
    sessionStorage.getItem(
      "unsafe-direct",
    );
    sessionStorage.setItem("dash:unregistered", value);
  `);
  assert.equal(violations.length, 4);
  assert.deepEqual(
    violations.map(({ line }) => line),
    [5, 9, 10, 13],
  );
});
