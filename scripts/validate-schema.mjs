#!/usr/bin/env node
/**
 * Read-only schema/data gate. It verifies that the tracked Drizzle schema and
 * SQL migration set are present, non-empty, and numerically ordered without
 * connecting to or mutating the database.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const schemaPath = resolve(root, "shared/schema.ts");
const migrationsPath = resolve(root, "migrations");

function fail(message) {
  console.error(`[schema-check] FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(schemaPath) || !readFileSync(schemaPath, "utf8").includes("export")) {
  fail("shared/schema.ts is missing or does not contain an exported schema");
}
if (!existsSync(migrationsPath)) fail("migrations directory is missing");

const migrations = readdirSync(migrationsPath)
  .filter((name) => name.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (migrations.length === 0) fail("no SQL migrations are tracked");

let previousNumber = -1;
for (const migration of migrations) {
  const match = migration.match(/^(\d+)_.*\.sql$/);
  if (!match) fail(`migration '${migration}' must begin with a numeric prefix`);
  const number = Number(match[1]);
  if (number < previousNumber) fail(`migration ordering is not monotonic at '${migration}'`);
  if (readFileSync(resolve(migrationsPath, migration), "utf8").trim().length === 0) {
    fail(`migration '${migration}' is empty`);
  }
  previousNumber = number;
}

console.log(`[schema-check] PASS: exported schema and ${migrations.length} ordered SQL migrations verified.`);