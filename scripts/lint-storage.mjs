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
  "client/src/lib/theme-provider.tsx",
  "client/src/App.tsx",
  "client/src/pages/session/PhotoStrip.tsx",
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
    if (!RAW_LITERAL_RE.test(lines[i])) continue;
    if (EXEMPT_PATTERNS.some(p => p.test(lines[i]))) continue;
    console.log(`${rel}:${i + 1}  ${lines[i].trim()}`);
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
