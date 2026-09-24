#!/usr/bin/env node
/**
 * Read-only schema/migration contract gate.
 *
 * The schema is loaded by Drizzle Kit, migration identity comes from the
 * canonical journal, and migration files are checked by a deliberately small
 * PostgreSQL statement lexer. This gate does not connect to or mutate a
 * database; release-database execution is covered by the focused preflight
 * contract.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
const defaultSchemaPath = resolve(root, "shared/schema.ts");
const defaultMigrationsPath = resolve(root, "migrations");
const defaultJournalPath = resolve(defaultMigrationsPath, "meta/_journal.json");
const SQL_START_KEYWORDS = new Set([
  "ALTER",
  "BEGIN",
  "COMMENT",
  "COMMIT",
  "CREATE",
  "DELETE",
  "DO",
  "DROP",
  "GRANT",
  "INSERT",
  "REINDEX",
  "RELEASE",
  "ROLLBACK",
  "SAVEPOINT",
  "SET",
  "TRUNCATE",
  "UPDATE",
  "WITH",
]);

function stripLeadingComments(value) {
  let remaining = value.trimStart();
  while (remaining.startsWith("--") || remaining.startsWith("/*")) {
    if (remaining.startsWith("--")) {
      const end = remaining.indexOf("\n");
      remaining = end === -1 ? "" : remaining.slice(end + 1).trimStart();
      continue;
    }
    const end = remaining.indexOf("*/", 2);
    if (end === -1) return "";
    remaining = remaining.slice(end + 2).trimStart();
  }
  return remaining;
}

function dollarQuoteAt(sql, index) {
  if (sql[index] !== "$") return null;
  const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
  return match?.[0] ?? null;
}

function splitSqlStatements(sql, fileName) {
  const statements = [];
  let start = 0;
  let index = 0;
  let parenDepth = 0;
  let state = "normal";
  let dollarTag = null;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (state === "line-comment") {
      if (current === "\n") state = "normal";
      index += 1;
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        state = "normal";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "single-quote") {
      if (current === "'" && next === "'") {
        index += 2;
      } else if (current === "'") {
        state = "normal";
        index += 1;
      } else if (current === "\\") {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "double-quote") {
      if (current === '"' && next === '"') {
        index += 2;
      } else if (current === '"') {
        state = "normal";
        index += 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "dollar-quote") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        state = "normal";
        dollarTag = null;
      } else {
        index += 1;
      }
      continue;
    }

    if (current === "-" && next === "-") {
      state = "line-comment";
      index += 2;
      continue;
    }
    if (current === "/" && next === "*") {
      state = "block-comment";
      index += 2;
      continue;
    }
    if (current === "'") {
      state = "single-quote";
      index += 1;
      continue;
    }
    if (current === '"') {
      state = "double-quote";
      index += 1;
      continue;
    }
    const tag = dollarQuoteAt(sql, index);
    if (tag) {
      state = "dollar-quote";
      dollarTag = tag;
      index += tag.length;
      continue;
    }
    if (current === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }
    if (current === ")") {
      parenDepth -= 1;
      if (parenDepth < 0) {
        throw new Error(`migration '${fileName}' has an unmatched closing parenthesis`);
      }
      index += 1;
      continue;
    }
    if (current === ";" && parenDepth === 0) {
      statements.push(sql.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }

  if (state === "block-comment") {
    throw new Error(`migration '${fileName}' has an unterminated block comment`);
  }
  if (state === "single-quote" || state === "double-quote") {
    throw new Error(`migration '${fileName}' has an unterminated quoted literal`);
  }
  if (state === "dollar-quote") {
    throw new Error(`migration '${fileName}' has an unterminated dollar-quoted body`);
  }
  if (parenDepth !== 0) {
    throw new Error(`migration '${fileName}' has unbalanced parentheses`);
  }
  statements.push(sql.slice(start));
  return statements.map(stripLeadingComments).filter(Boolean);
}

function firstKeyword(statement) {
  return statement.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase() ?? null;
}

function validateSqlMigration(sql, fileName) {
  const statements = splitSqlStatements(sql, fileName);
  if (statements.length === 0) {
    throw new Error(`migration '${fileName}' contains no SQL statements`);
  }
  for (const statement of statements) {
    const keyword = firstKeyword(statement);
    if (!keyword || !SQL_START_KEYWORDS.has(keyword)) {
      throw new Error(
        `migration '${fileName}' contains an unsupported or malformed SQL statement (${statement
          .trim()
          .slice(0, 40)
          .replace(/\s+/g, " ")})`,
      );
    }
    const normalized = statement.trim().replace(/\s+/g, " ");
    const shape = {
      ALTER: /^ALTER\s+(?:TABLE|TYPE|INDEX|SEQUENCE|DATABASE|SCHEMA|VIEW|MATERIALIZED VIEW|FUNCTION|TRIGGER|ROLE)\s+\S/i,
      CREATE: /^CREATE\s+(?:(?:OR REPLACE|TEMP(?:ORARY)?|UNLOGGED|UNIQUE)\s+)*(?:TABLE|INDEX|TYPE|SEQUENCE|SCHEMA|VIEW|MATERIALIZED VIEW|FUNCTION|TRIGGER|EXTENSION|POLICY)\s+\S/i,
      DROP: /^DROP\s+(?:TABLE|TYPE|INDEX|SEQUENCE|DATABASE|SCHEMA|VIEW|MATERIALIZED VIEW|FUNCTION|TRIGGER|ROLE)\s+\S/i,
      DELETE: /^DELETE\s+FROM\s+\S/i,
      INSERT: /^INSERT\s+INTO\s+\S/i,
      UPDATE: /^UPDATE\s+\S/i,
      TRUNCATE: /^TRUNCATE\s+(?:TABLE\s+)?\S/i,
      COMMENT: /^COMMENT\s+ON\s+\S/i,
      DO: /^DO\s+(?:\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$|')/i,
      SET: /^SET\s+\S/i,
      GRANT: /^GRANT\s+\S/i,
      REINDEX: /^REINDEX\s+\S/i,
      WITH: /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i,
    }[keyword];
    if (shape && !shape.test(normalized)) {
      throw new Error(`migration '${fileName}' contains an incomplete ${keyword} statement`);
    }
  }
  return statements.length;
}

function migrationIdentity(name) {
  const match = name.match(/^(\d+)_([A-Za-z0-9][A-Za-z0-9_-]*)\.sql$/);
  if (!match) {
    throw new Error(
      `migration '${name}' must use the canonical <numeric-prefix>_<identity>.sql filename`,
    );
  }
  return { name, tag: name.slice(0, -4), prefix: Number(match[1]) };
}

export function validateMigrationSet({
  migrationsPath = defaultMigrationsPath,
  journalPath,
} = {}) {
  journalPath ??= migrationsPath === defaultMigrationsPath
    ? defaultJournalPath
    : resolve(migrationsPath, "meta/_journal.json");
  if (!existsSync(migrationsPath)) throw new Error("migrations directory is missing");
  if (!existsSync(journalPath)) throw new Error("migrations/meta/_journal.json is missing");

  const migrations = readdirSync(migrationsPath)
    .filter((name) => name.endsWith(".sql"))
    .map(migrationIdentity);
  if (migrations.length === 0) throw new Error("no SQL migrations are tracked");

  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch (error) {
    throw new Error(`migration journal is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error("migration journal must contain an ordered entries array");
  }

  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const entryTags = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      !entry ||
      entry.idx !== index ||
      typeof entry.tag !== "string" ||
      !/^\d+_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.tag)
    ) {
      throw new Error(`migration journal entry ${index} has an invalid canonical identity`);
    }
    if (entryTags.has(entry.tag)) {
      throw new Error(`migration journal contains duplicate identity '${entry.tag}'`);
    }
    entryTags.add(entry.tag);
  }

  const migrationTags = new Set(migrations.map(({ tag }) => tag));
  const missingFromJournal = migrations
    .filter(({ tag }) => !entryTags.has(tag))
    .map(({ tag }) => tag);
  const missingFromFiles = entries
    .map(({ tag }) => tag)
    .filter((tag) => !migrationTags.has(tag));
  if (missingFromJournal.length || missingFromFiles.length) {
    throw new Error(
      `migration journal/file identity mismatch${
        missingFromJournal.length ? `; missing journal entries: ${missingFromJournal.join(", ")}` : ""
      }${missingFromFiles.length ? `; missing migration files: ${missingFromFiles.join(", ")}` : ""}`,
    );
  }

  const byTag = new Map(migrations.map((migration) => [migration.tag, migration]));
  let previousPrefix = -1;
  for (const entry of entries) {
    const migration = byTag.get(entry.tag);
    if (migration.prefix < previousPrefix) {
      throw new Error(`migration journal order is not monotonic at '${entry.tag}'`);
    }
    previousPrefix = migration.prefix;
    validateSqlMigration(
      readFileSync(resolve(migrationsPath, migration.name), "utf8"),
      migration.name,
    );
  }

  const duplicateGroups = new Map();
  for (const migration of migrations) {
    const group = duplicateGroups.get(migration.prefix) ?? [];
    group.push(migration.tag);
    duplicateGroups.set(migration.prefix, group);
  }
  const explicitOrder = journal.samePrefixOrder;
  if (explicitOrder !== undefined && (!Array.isArray(explicitOrder) || explicitOrder.some((group) => !Array.isArray(group)))) {
    throw new Error("migration journal samePrefixOrder must be an array of tag arrays");
  }
  const declaredGroups = new Map(
    (explicitOrder ?? []).map((group) => [Number(group[0]?.match(/^(\d+)_/)?.[1]), group]),
  );
  for (const [prefix, group] of duplicateGroups) {
    if (group.length === 1) continue;
    const declared = declaredGroups.get(prefix);
    const journalGroup = entries
      .filter((entry) => byTag.get(entry.tag).prefix === prefix)
      .map((entry) => entry.tag);
    if (!declared || declared.length !== group.length || declared.join("|") !== journalGroup.join("|")) {
      throw new Error(
        `duplicate migration prefix ${String(prefix).padStart(4, "0")} requires an explicit samePrefixOrder matching journal order`,
      );
    }
  }
  for (const [prefix, declared] of declaredGroups) {
    const actual = duplicateGroups.get(prefix);
    if (!actual || declared.length !== actual.length || new Set(declared).size !== declared.length) {
      throw new Error(`migration journal declares an invalid samePrefixOrder for prefix ${prefix}`);
    }
  }

  return {
    migrations: entries.map(({ tag }) => byTag.get(tag).name),
    duplicatePrefixes: [...duplicateGroups.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([prefix, group]) => ({ prefix, tags: group })),
  };
}

export function validateSchemaWithDrizzle({
  schemaPath = defaultSchemaPath,
  cwd = root,
  run = execFileSync,
} = {}) {
  if (!existsSync(schemaPath)) throw new Error("shared/schema.ts is missing");
  let output;
  try {
    output = run(
      "npx",
      [
        "--no-install",
        "drizzle-kit",
        "export",
        "--sql",
        "--dialect",
        "postgresql",
        "--schema",
        schemaPath,
      ],
      { cwd, encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`configured Drizzle schema could not be loaded${details ? `: ${details}` : ""}`);
  }
  if (!/\bCREATE\s+(?:TYPE|TABLE)\b/i.test(output)) {
    throw new Error("configured Drizzle schema exported no PostgreSQL tables or types");
  }
  return output;
}

export function validateSchemaContracts(options = {}) {
  const schemaSql = validateSchemaWithDrizzle(options);
  const migrationResult = validateMigrationSet(options);
  return { schemaSql, ...migrationResult };
}

function fail(message) {
  console.error(`[schema-check] FAIL: ${message}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const schemaPath = process.env.SCHEMA_CHECK_SCHEMA_PATH ?? defaultSchemaPath;
    const migrationsPath = process.env.SCHEMA_CHECK_MIGRATIONS_PATH ?? defaultMigrationsPath;
    const journalPath =
      process.env.SCHEMA_CHECK_JOURNAL_PATH ?? resolve(migrationsPath, "meta/_journal.json");
    const result = validateSchemaContracts({ schemaPath, migrationsPath, journalPath });
    console.log(
      `[schema-check] PASS: Drizzle exported the configured schema and ${result.migrations.length} journal-ordered SQL migrations; ${result.duplicatePrefixes.length} same-prefix groups are explicit.`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}