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
  assertPublicationSchema,
  assertReleaseSchema,
  compareReleaseSchema,
  executeReviewedMigrations,
  readReleaseSchema,
  releaseSchemaFingerprint,
  REVIEWED_PUBLICATION_TRANSITION,
} from "../release-schema-preflight.mjs";
import {
  validateMigrationSet,
  validateSchemaWithDrizzle,
} from "../validate-schema.mjs";
import { createOwnedDatabase, dropOwnedDatabase } from "../release-smoke-database.mjs";
import { reviewedPublicationFixture } from "./fixtures/reviewed-publication-schema.mjs";

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

function readOnlySchemaClient(schema) {
  const client = fakeClient({
    columns: schema.schemaState.columns.filter((c) => c.table_name === "users").map((c) => c.column_name),
    roleValues: schema.roleValues,
    legacyColumns: schema.legacyObjects.filter((name) => name.includes(".")).map((name) => name.split(".")),
    sessions: schema.legacyObjects.includes("sessions") ? ["sessions"] : [],
    schemaColumns: schema.schemaState.columns,
    indexes: schema.schemaState.indexes,
  });
  return {
    query: (sql) => {
      assert.match(sql.trimStart(), /^SELECT /, "publication fixture must remain read-only");
      return client.query(sql);
    },
  };
}

async function writeMigrationFixture(directory, tags, contents = {}) {
  await mkdir(resolve(directory, "meta"), { recursive: true });
  return Promise.all([
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

test("post-merge rejects a closed-stdin Drizzle prompt even when push exits 0", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "post-merge-prompt-"));
  const npmPath = resolve(directory, "npm");
  const outputPath = resolve(directory, "push-output");
  const callsPath = resolve(directory, "calls");
  try {
    await writeFile(npmPath, `#!/bin/sh
echo "$*" >> "$FAKE_NPM_CALLS"
if [ "$1" = "install" ]; then exit 0; fi
if [ "$1" = "run" ] && [ "$2" = "db:push" ]; then
  cat "$FAKE_PUSH_OUTPUT"
  exit "\${FAKE_PUSH_EXIT:-0}"
fi
exit 99
`);
    await chmod(npmPath, 0o755);
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      FAKE_PUSH_OUTPUT: outputPath,
      FAKE_NPM_CALLS: callsPath,
    };
    const run = () => execFileAsync("bash", ["scripts/post-merge.sh"], { cwd: root, env });

    await writeFile(
      outputPath,
      "Pulling schema from database...\nIs clerk_user_id column in users table created or renamed from another column?\n❯ + clerk_user_id create column\n  ~ is_tester › clerk_user_id rename column\n",
    );
    await assert.rejects(run(), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /requires schema review and an explicit choice/);
      assert.match(error.stdout, /Is clerk_user_id column/);
      return true;
    });

    await writeFile(outputPath, "[✓] Changes applied\n");
    const success = await run();
    assert.match(success.stdout, /Changes applied/);
    assert.equal(success.stderr, "");

    env.FAKE_PUSH_EXIT = "7";
    await assert.rejects(run(), (error) => {
      assert.equal(error.code, 7);
      assert.doesNotMatch(error.stderr, /requires schema review/);
      return true;
    });
    assert.equal(
      await readFile(callsPath, "utf8"),
      "install\nrun db:push\ninstall\nrun db:push\ninstall\nrun db:push\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

test("publication accepts an already-current schema without a transition", async () => {
  const expected = await assertReleaseSchema(fakeClient({ columns: currentColumns }));
  const reordered = fakeClient({ columns: [...currentColumns].reverse() });
  const result = await assertPublicationSchema(
    reordered,
    { expectedSchema: expected },
  );
  assert.equal(result.mode, "current");
  const changedDefault = fakeClient({
    columns: currentColumns,
    schemaColumns: currentColumns.map((column_name) => ({
      table_name: "users",
      column_name,
      data_type: "character varying",
      udt_name: "varchar",
      is_nullable: "YES",
      column_default: column_name === "approved" ? "'different'" : null,
    })),
  });
  await assert.rejects(
    assertPublicationSchema(changedDefault, { expectedSchema: expected }),
    (error) => error.classification === "target-drift",
  );
});

test("publication fingerprint uses canonical index order, not the database collation", async () => {
  const indexes = [
    { indexname: "IDX_session_expire", indexdef: 'CREATE INDEX "IDX_session_expire" ON public.sessions USING btree (expire)' },
    { indexname: "activity_logs_pkey", indexdef: "CREATE UNIQUE INDEX activity_logs_pkey ON public.activity_logs USING btree (id)" },
  ];
  const original = await readReleaseSchema(fakeClient({
    columns: currentColumns,
    indexes,
  }));
  const reordered = await readReleaseSchema(fakeClient({
    columns: [...currentColumns].reverse(),
    indexes: [...indexes].reverse(),
  }));
  assert.equal(releaseSchemaFingerprint(original), releaseSchemaFingerprint(reordered));
  assert.deepEqual(compareReleaseSchema(original, reordered), []);
  assert.equal(
    releaseSchemaFingerprint(original),
    "40d165f4e17df9344bdabd701ba5caf558a23a4119947608af7a1bd907f33b97",
  );
});

test("publication accepts only the exact reviewed legacy and candidate pair", async () => {
  const current = await assertReleaseSchema(fakeClient({ columns: currentColumns }));
  const legacyColumns = currentColumns.filter(
    (column) => !["clerk_user_id", "role", "capabilities"].includes(column),
  ).concat("is_tester");
  const legacyOptions = {
    columns: legacyColumns,
    roleValues: [],
    legacyColumns: [["users", "is_tester"], ["user_settings", "tester_password"]],
    sessions: ["sessions"],
  };
  const legacy = fakeClient(legacyOptions);
  const legacySchema = await readReleaseSchema(legacy);
  const transition = {
    schemaName: "public",
    legacyFingerprint: releaseSchemaFingerprint(legacySchema),
    candidateFingerprint: releaseSchemaFingerprint(current),
  };
  const readOnly = (client) => ({
    query: (sql) => {
      assert.match(sql.trimStart(), /^SELECT /);
      return client.query(sql);
    },
  });
  const result = await assertPublicationSchema(readOnly(fakeClient(legacyOptions)), {
    expectedSchema: current,
    transition,
  });
  assert.equal(result.mode, "reviewed-legacy");

  for (const changed of [
    { ...legacyOptions, columns: legacyColumns.concat("unreviewed") },
    { ...legacyOptions, indexes: [{ indexname: "unreviewed", indexdef: "CREATE INDEX unreviewed" }] },
    { ...legacyOptions, sessions: [] },
    { ...legacyOptions, roleValues: ["Unexpected"] },
  ]) {
    await assert.rejects(
      assertPublicationSchema(readOnly(fakeClient(changed)), { expectedSchema: current, transition }),
      (error) => error.classification === "target-drift",
    );
  }
  const changedCandidate = await assertReleaseSchema(fakeClient({
    columns: currentColumns.concat("unreviewed"),
  }));
  await assert.rejects(
    assertPublicationSchema(readOnly(fakeClient(legacyOptions)), {
      expectedSchema: changedCandidate,
      transition,
    }),
    (error) => error.classification === "target-drift",
  );
  for (const invalid of [null, {}, { ...transition, candidateFingerprint: "not-a-hash" }]) {
    await assert.rejects(
      assertPublicationSchema(readOnly(fakeClient(legacyOptions)), {
        expectedSchema: current,
        transition: invalid,
      }),
      (error) => error.classification === "target-drift",
    );
  }
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
    assertIsolatedReleaseDatabase({
      releaseDatabaseUrl,
      publicationDatabaseUrl: process.env.DATABASE_URL,
    });
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
      assert.deepEqual(
        schema.schemaState.columns.filter((c) =>
          c.table_name === "folders" && c.column_name === "trashed_from_parent_folder_id"),
        [{
          table_name: "folders", column_name: "trashed_from_parent_folder_id",
          data_type: "integer", udt_name: "int4", is_nullable: "YES", column_default: null,
        }],
      );
      const previousCandidate = structuredClone(schema);
      previousCandidate.schemaState.columns = previousCandidate.schemaState.columns.filter((c) =>
        !(c.table_name === "folders" && c.column_name === "trashed_from_parent_folder_id"));
      assert.equal(
        releaseSchemaFingerprint(previousCandidate),
        "ab7c906a008a22f19d2c976cab07f15b57180009ec564e0bc73b007c4d74063c",
        "the entire previous candidate differs only by the reviewed folder snapshot column",
      );
      assert.equal(
        releaseSchemaFingerprint(schema),
        REVIEWED_PUBLICATION_TRANSITION.candidateFingerprint,
        "a changed candidate schema needs a fresh review of the transition pair",
      );
      assert.equal(
        (await assertPublicationSchema(client, { expectedSchema: schema })).mode,
        "current",
      );

      // Execute 0029 independently without adding it to the auth migration set.
      await client.query("BEGIN");
      try {
        await client.query('ALTER TABLE folders DROP COLUMN trashed_from_parent_folder_id');
        await client.query(await readFile(resolve(root, "migrations/0029_add_folder_parent_trash_snapshot.sql"), "utf8"));
        assert.deepEqual(compareReleaseSchema(schema, await readReleaseSchema(client)), []);
      } finally {
        await client.query("ROLLBACK");
      }

      const legacy = reviewedPublicationFixture(schema);
      assert.equal(legacy.schemaState.columns.length, 212);
      assert.equal(legacy.schemaState.indexes.length, 65);
      assert.equal(releaseSchemaFingerprint(legacy), REVIEWED_PUBLICATION_TRANSITION.legacyFingerprint);
      assert.equal(
        (await assertPublicationSchema(readOnlySchemaClient(legacy), { expectedSchema: schema })).mode,
        "reviewed-legacy",
      );
      // Negative controls mutate metadata only, never a live endpoint. Each
      // dimension is tested independently on BOTH sides of the actual pins.
      const mutations = [
        (s) => { s.schemaState.columns[0].data_type = "unexpected"; },
        (s) => { s.schemaState.columns[0].is_nullable = "YES"; },
        (s) => { s.schemaState.columns[0].column_default = "'unexpected'"; },
        (s) => { s.schemaState.indexes[0].indexdef += " /* unexpected */"; },
        (s) => { s.roleValues.push("Unexpected"); },
        (s) => {
          s.legacyObjects = s.legacyObjects.includes("sessions")
            ? s.legacyObjects.filter((name) => name !== "sessions")
            : ["sessions"];
        },
      ];
      for (const mutate of mutations) {
        const changedCandidate = structuredClone(schema);
        mutate(changedCandidate);
        await assert.rejects(
          assertPublicationSchema(readOnlySchemaClient(legacy), { expectedSchema: changedCandidate }),
          (error) => error.classification === "target-drift",
        );
        const changedPublication = structuredClone(legacy);
        mutate(changedPublication);
        assert.notEqual(releaseSchemaFingerprint(changedPublication), REVIEWED_PUBLICATION_TRANSITION.legacyFingerprint);
        await assert.rejects(
          assertPublicationSchema(readOnlySchemaClient(changedPublication), { expectedSchema: schema }),
          (error) => error.classification === "target-drift",
        );
      }
    } finally {
      await client.end();
    }
  } finally {
    if (owned) {
      await dropOwnedDatabase(owned, {
        publicationDatabaseUrl: process.env.DATABASE_URL,
      });
      const adminUrl = new URL(process.env.DATABASE_URL);
      adminUrl.pathname = "/postgres";
      const admin = new Client({ connectionString: adminUrl.toString() });
      try {
        await admin.connect();
        assert.equal((await admin.query(
          "SELECT datname FROM pg_database WHERE datname = $1", [owned.databaseName],
        )).rowCount, 0, "the run-owned schema database must be removed");
      } finally {
        await admin.end();
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});