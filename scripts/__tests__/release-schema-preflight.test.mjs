import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIsolatedReleaseDatabase,
  assertReleaseSchema,
} from "../release-schema-preflight.mjs";

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

const currentColumns = ["id", "email", "first_name", "last_name", "approved", "rejected", "role"];

test("release target must be explicit and distinct from the publishing database", () => {
  assert.throws(
    () => assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: "postgresql://postgres:secret@db/release",
      publicationDatabaseUrl: "postgresql://postgres:secret@db/release",
    }),
    /dedicated target distinct/,
  );
  assert.throws(
    () => assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: "",
      publicationDatabaseUrl: "postgresql://postgres:secret@db/public",
    }),
    /RELEASE_SMOKE_DATABASE_URL is required/,
  );
  assert.equal(
    assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: "postgresql://postgres:secret@db/release",
      publicationDatabaseUrl: "postgresql://postgres:secret@db/public",
    }),
    "postgresql://postgres@db/release",
  );
});

test("schema preflight fails before release fixtures when users.role is absent", async () => {
  await assert.rejects(
    assertReleaseSchema(fakeClient({ columns: currentColumns.filter((column) => column !== "role") })),
    /missing users\.role/,
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