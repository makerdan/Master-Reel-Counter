#!/usr/bin/env node
/**
 * lint-storage.mjs
 * ─────────────────
 * Finds any call to localStorage / sessionStorage .getItem / .setItem /
 * .removeItem whose first argument is a raw string or template literal.
 * These should instead use a typed constant from
 * client/src/lib/storageKeys.ts.
 *
 * Usage:
 *   node scripts/lint-storage.mjs
 *   node scripts/lint-storage.mjs --strict   (exit 1 if violations found)
 *
 * Intentionally out-of-scope files (documented, not enforced here):
 *   client/src/lib/storageKeys.ts       — the registry itself (raw strings allowed)
 *   client/src/lib/theme-provider.tsx   — theme system (themeMode, theme keys)
 *   client/src/App.tsx                  — theme system (themeMode check on init)
 *   client/src/pages/session/PhotoStrip.tsx — transient per-photo UI hint
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SRC = join(ROOT, "client", "src");

const EXCLUDE_FILES = new Set([
  "client/src/lib/storageKeys.ts",
]);

/**
 * Matches a raw string literal or template literal as the FIRST argument of
 * a localStorage / sessionStorage call, e.g.:
 *   localStorage.getItem("some-key")
 *   sessionStorage.setItem(`some-key-${id}`, ...)
 */
const RAW_LITERAL_RE =
  /(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\s*\(\s*(['"`])/;

/**
 * Secondary check: catches raw key-like template literals assigned to a
 * variable outside storageKeys.ts, e.g.:
 *   const lsKey = `disregarded-dups-${sessionId}`;
 *
 * Requires ≥ 2 hyphen-separated word segments before the interpolation so
 * generic template literals (`` `error-${id}` ``) are NOT flagged.
 * Arrow-function returns are excluded because key factory definitions live
 * in storageKeys.ts (which is already in EXCLUDE_FILES).
 */
const RAW_KEY_FACTORY_RE = /\b\w*[kK]ey\w*\s*=\s*`(?:[a-z][a-z]*-){2,}\${/;
const ARROW_RETURN_RE = /=>\s*`/;

/**
 * Patterns that are intentionally exempt from the registry.
 * These are raw string literals whose keys are out of scope per the registry
 * table in storageKeys.ts — tested against each matching line.
 *
 * - `dash:` keys — dashboard sessionStorage filter/sort UI state; resets on
 *   every page load, no cross-session leak risk, excluded from migration.
 */
const EXEMPT_PATTERNS = [
  /sessionStorage\.(getItem|setItem|removeItem)\s*\(\s*['"`]dash:/,
];

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      entries.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

let violations = 0;

for (const filePath of walk(SRC)) {
  const rel = relative(ROOT, filePath).replace(/\\/g, "/");
  if (EXCLUDE_FILES.has(rel)) continue;

  const lines = readFileSync(filePath, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isRawStorageCall = RAW_LITERAL_RE.test(line) && !EXEMPT_PATTERNS.some(p => p.test(line));
    const isRawKeyFactory = RAW_KEY_FACTORY_RE.test(line) && !ARROW_RETURN_RE.test(line);
    if (!isRawStorageCall && !isRawKeyFactory) continue;
    console.log(`${rel}:${i + 1}  ${line.trim()}`);
    violations++;
  }
}

console.log();
if (violations === 0) {
  console.log("No unregistered storage key literals found.");
} else {
  console.log(
    `${violations} violation${violations === 1 ? "" : "s"} found. ` +
      "Replace raw string literals with typed constants from client/src/lib/storageKeys.ts",
  );
}

const strict = process.argv.includes("--strict");
if (strict && violations > 0) process.exit(1);
