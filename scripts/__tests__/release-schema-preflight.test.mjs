import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Client } from "pg";
import test from "node:test";
import { promisify } from "node:util";
import {
  assertIsolatedReleaseDatabase,
  assertReleaseSchema,
  compareReleaseSchema,
  executeReviewedMigrations,
} from "../release-schema-preflight.mjs";
import {
  validateMigrationSet,
  validateSchemaWithDrizzle,
} from "../validate-schema.mjs";
import { createOwnedDatabase, dropOwnedDatabase } from "../release-smoke-database.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

function fakeClient({
  columns,
  roleValues = ["Admin", "User"],
  legacyColumns = [],
  sessions = [],
  schemaColumns = columns.map((column_name) => ({
    table_name: "users",
    column_name,
    data_type: "character varying",
    udt_name: "varchar",
    is_nullable: "YES",
    column_default: null,
  })),
  indexes = [],
}) {
  return {
    query: async (query) => {
      if (query.includes("current_database")) {
        return { rows: [{ database_name: "release_test", schema_name: "public" }] };
      }
      if (query.includes("pg_type")) {
        return { rows: roleValues.map((enumlabel) => ({ enumlabel })) };
      }
      if (query.includes("tester_password")) {
        return {
          rows: legacyColumns.map(([table_name, column_name]) => ({
            table_name,
            column_name,
          })),
        };
      }
      if (query.includes("information_schema.columns") && query.includes("table_name = 'users'")) {
        return { rows: columns.map((column_name) => ({ column_name })) };
      }
      if (query.includes("pg_indexes")) return { rows: indexes };
      if (query.includes("ORDER BY table_name, ordinal_position")) {
        return { rows: schemaColumns };
      }
      return { rows: sessions.map((table_name) => ({ table_name })) };
    },
  };
}

const currentColumns = [
  "id",
  "clerk_user_id",
  "email",
  "first_name",
  "last_name",
  "approved",
  "rejected",
  "role",
  "capabilities",
];

function writeMigrationFixture(directory, tags, contents = {}) {
  return Promise.all([
    mkdir(resolve(directory, "meta"), { recursive: true }),
    writeFile(
      resolve(directory, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: tags.map((tag, idx) => ({
          idx,
          version: "7",
          when: idx + 1,
          tag,
          breakpoints: true,
        })),
      }),
    ),
    ...tags.map((tag) =>
      writeFile(
        resolve(directory, `${tag}.sql`),
        contents[tag] ?? "CREATE TABLE contract_fixture (id integer);",
      ),
    ),
  ]);
}

test("release target identity ignores credentials and equivalent URL spelling", () => {
  for (const releaseDatabaseUrl of [
    "postgresql://alice:one@DB/release",
    "postgres://bob:two@db:5432/release",
    "postgresql://carol:three@db./release?sslmode=require",
    "postgresql://dave:four@db/release?schema=release_smoke",
    "postgresql://erin:five@db/release?options=-csearch_path%3Drelease_smoke",
  ]) {
    assert.throws(
      () => assertIsolatedReleaseDatabase({
        releaseDatabaseUrl,
        publicationDatabaseUrl: "postgresql://publisher:secret@db:5432/release?schema=public",
      }),
      /dedicated target distinct/,
    );
  }
});

test("schema contract rejects a source that Drizzle cannot load", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "schema-contract-invalid-"));
  const schemaPath = resolve(directory, "schema.ts");
  try {
    await writeFile(schemaPath, "// export is not a Drizzle schema\n");
    assert.throws(
      () => validateSchemaWithDrizzle({ schemaPath, cwd: root }),
      /configured Drizzle schema could not be loaded|exported no PostgreSQL tables or types/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration contract rejects malformed SQL instead of accepting non-empty text", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "migration-contract-malformed-"));
  try {
    await writeMigrationFixture(directory, ["0001_malformed"], {
      "0001_malformed": "this is not SQL;",
    });
    assert.throws(
      () =>
        validateMigrationSet({
          migrationsPath: directory,
          journalPath: resolve(directory, "meta/_journal.json"),
        }),
      /unsupported or malformed SQL statement/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration contract rejects duplicate journal identities", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "migration-contract-duplicate-"));
  try {
    await writeMigrationFixture(directory, ["0001_first"]);
    await writeFile(
      resolve(directory, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 0, version: "7", when: 1, tag: "0001_first", breakpoints: true },
          { idx: 1, version: "7", when: 2, tag: "0001_first", breakpoints: true },
        ],
      }),
    );
    assert.throws(
      () =>
        validateMigrationSet({
          migrationsPath: directory,
          journalPath: resolve(directory, "meta/_journal.json"),
        }),
      /duplicate identity/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("migration contract rejects journal order that moves backward", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "migration-contract-order-"));
  try {
    await writeMigrationFixture(directory, ["0001_first", "0002_second"]);
    await writeFile(
      resolve(directory, "meta/_journal.json"),
      JSON.stringify({
        version: "7",
        dialect: "postgresql",
        entries: [
          { idx: 0, version: "7", when: 1, tag: "0002_second", breakpoints: true },
          { idx: 1, version: "7", when: 2, tag: "0001_first", breakpoints: true },
        ],
      }),
    );
    assert.throws(
      () =>
        validateMigrationSet({
          migrationsPath: directory,
          journalPath: resolve(directory, "meta/_journal.json"),
        }),
      /journal order is not monotonic/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("release target fails closed when endpoint aliases cannot be proven distinct", () => {
  for (const releaseDatabaseUrl of [
    "postgresql://smoke:secret@db-alias/release_smoke",
    "postgresql://smoke:secret@db:6543/release_smoke",
  ]) {
    assert.throws(
      () => assertIsolatedReleaseDatabase({
        releaseDatabaseUrl,
        publicationDatabaseUrl: "postgresql://publisher:secret@db/release",
      }),
      /endpoint aliases cannot be proven distinct/,
    );
  }
  assert.throws(
    () => assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: "postgresql://smoke@db/release_smoke?host=db-alias",
      publicationDatabaseUrl: "postgresql://publisher@db/release",
    }),
    /cannot prove effective identity when host is supplied/,
  );
});

test("release target must be explicit, valid, and a different database", () => {
  assert.throws(
    () => assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: "",
      publicationDatabaseUrl: "postgresql://postgres:secret@db/public",
    }),
    /RELEASE_SMOKE_DATABASE_URL is required/,
  );
  assert.throws(
    () => assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: "postgresql://smoke@db",
      publicationDatabaseUrl: "postgresql://publisher@db/public",
    }),
    /explicit host and database name/,
  );
  assert.throws(
    () => assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: "postgresql://smoke@db/release",
      publicationDatabaseUrl: "",
    }),
    /DATABASE_URL is required/,
  );
  assert.equal(
    assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: "postgresql://postgres:secret@db/release",
      publicationDatabaseUrl: "postgresql://postgres:secret@db/public",
    }),
    "db:5432/release",
  );
  for (const releaseDatabaseUrl of [
    "postgresql://other:changed@db/public?sslmode=require",
    "postgres://other:changed@db/public?sslmode=require",
    "postgresql://postgres:other@DB:5432/public?application_name=smoke",
    "postgresql://postgres@db/%70ublic",
  ]) {
    assert.throws(
      () => assertIsolatedReleaseDatabase({
        releaseDatabaseUrl,
        publicationDatabaseUrl: "postgresql://postgres:secret@db/public?sslmode=disable",
      }),
      /dedicated target distinct/,
    );
  }
});

test("unsafe release target stops schema preparation before the first DDL command", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-boundary-"));
  const marker = resolve(directory, "npx-invoked");
  const fakeNpx = resolve(directory, "npx");
  await writeFile(fakeNpx, `#!/bin/sh\n: > "${marker}"\nexit 99\n`);
  await chmod(fakeNpx, 0o755);

  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        ["scripts/prepare-release-test-database.mjs"],
        {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH ?? ""}`,
            RELEASE_SMOKE_DATABASE_URL:
              "postgresql://smoke:one@db:5432/application?schema=smoke",
            DATABASE_URL:
              "postgresql://publisher:two@DB/application?options=-csearch_path%3Dpublic",
          },
        },
      ),
      /dedicated target distinct/,
    );
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("schema preflight fails before release fixtures when users.role is absent", async () => {
  await assert.rejects(
    assertReleaseSchema(fakeClient({ columns: currentColumns.filter((column) => column !== "role") })),
    /missing users\.role/,
  );
});

test("schema preflight fails before release fixtures when durable Clerk identity mapping is absent", async () => {
  await assert.rejects(
    assertReleaseSchema(
      fakeClient({ columns: currentColumns.filter((column) => column !== "clerk_user_id") }),
    ),
    /missing users\.clerk_user_id/,
  );
});

test("schema preflight accepts the reviewed current auth schema", async () => {
  const schema = await assertReleaseSchema(fakeClient({ columns: currentColumns }));
  assert.deepEqual(schema.missingColumns, []);
  assert.deepEqual(schema.missingRoleValues, []);
});

test("schema preflight rejects legacy tester objects and sessions", async () => {
  await assert.rejects(
    assertReleaseSchema(
      fakeClient({
        columns: currentColumns,
        legacyColumns: [["users", "is_tester"]],
        sessions: ["sessions"],
      }),
    ),
    /legacy auth objects remain/,
  );
});

test("publishing schema comparison reports structural drift", async () => {
  const expected = await assertReleaseSchema(fakeClient({ columns: currentColumns }));
  await assert.rejects(
    assertReleaseSchema(
      fakeClient({ columns: currentColumns.filter((column) => column !== "capabilities") }),
      { expectedSchema: expected, target: "publishing" },
    ),
    (error) => {
      assert.equal(error.classification, "target-drift");
      return true;
    },
  );
  assert.deepEqual(compareReleaseSchema(expected, {
    ...expected,
    schemaState: {
      ...expected.schemaState,
      columns: expected.schemaState.columns.slice(0, -1),
    },
  }), ["columns or indexes differ from the reviewed schema"]);
});

test("release-critical migration SQL executes against an isolated PostgreSQL target", {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "release-migration-execution-"));
  const statePath = resolve(directory, "state.json");
  let owned;
  try {
    owned = await createOwnedDatabase(process.env.DATABASE_URL, statePath);
    const releaseDatabaseUrl = new URL(
      `/${owned.databaseName}`,
      process.env.DATABASE_URL,
    ).toString();
    const bootstrap = await execFileAsync(
      "npx",
      [
        "drizzle-kit",
        "export",
        "--sql",
        "--dialect",
        "postgresql",
        "--schema",
        "./shared/schema.ts",
      ],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: releaseDatabaseUrl },
      },
    );
    const client = new Client({ connectionString: releaseDatabaseUrl });
    try {
      await client.connect();
      await client.query(bootstrap.stdout);
      await executeReviewedMigrations(client);
      const schema = await assertReleaseSchema(client);
      assert.deepEqual(schema.missingColumns, []);
      assert.deepEqual(schema.missingRoleValues, []);
    } finally {
      await client.end();
    }
  } finally {
    if (owned) {
      await dropOwnedDatabase(owned, {
        publicationDatabaseUrl: process.env.DATABASE_URL,
      });
    }
    await rm(directory, { recursive: true, force: true });
  }
});