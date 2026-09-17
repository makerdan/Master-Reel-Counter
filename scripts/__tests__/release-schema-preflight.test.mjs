import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  assertIsolatedReleaseDatabase,
  assertReleaseSchema,
} from "../release-schema-preflight.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

function fakeClient({ columns, roleValues = ["Admin", "User"], legacyColumns = [], sessions = [] }) {
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