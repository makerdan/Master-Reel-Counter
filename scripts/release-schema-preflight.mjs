import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

export const REQUIRED_AUTH_COLUMNS = new Set([
  "id",
  "clerk_user_id",
  "email",
  "first_name",
  "last_name",
  "approved",
  "rejected",
  "role",
  "capabilities",
]);

const REQUIRED_ROLE_VALUES = new Set(["Admin", "User"]);
const REVIEWED_MIGRATION_NAMES = [
  "0023_remove_tester_auth_add_account_roles.sql",
  "0025_reconcile_legacy_tester_accounts.sql",
  "0026_add_users_clerk_user_id.sql",
  "0027_add_user_capabilities.sql",
];

// Metadata-only fingerprints of the reviewed public-schema transition. The
// legacy target was read without mutation; the candidate was exported into
// an owned disposable database and checked with the reviewed migrations.
// Re-review BOTH sides before updating these values.
// Review provenance and complete metadata delta:
// docs/superpowers/specs/2026-09-28-release-schema-transition-design.md
export const REVIEWED_PUBLICATION_TRANSITION = Object.freeze({
  schemaName: "public",
  legacyFingerprint: "dad8f2e20ffdf33fa056d5e0bb384ea7489b3464e131d4c70e5f5cb949c26764",
  candidateFingerprint: "a71e8c45bff0a02298b691e89f8968d03a5105afb8259f6e8b8fd0affd22373f",
});

export class ReleaseSchemaPreflightError extends Error {
  constructor(classification, message, options = {}) {
    super(`${message} [classification: ${classification}]`, options);
    this.name = "ReleaseSchemaPreflightError";
    this.classification = classification;
  }
}

function databaseTarget(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Release smoke database target must be a valid PostgreSQL URL");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Release smoke database target must use the PostgreSQL protocol");
  }

  if (!url.hostname || !url.pathname || url.pathname === "/") {
    throw new Error(
      "Release smoke database target must include an explicit host and database name",
    );
  }
  if (url.hostname.includes(",")) {
    throw new Error(
      "Release smoke database target cannot use a multi-host connection value",
    );
  }
  const endpointOverride = [
    "host",
    "hostaddr",
    "port",
    "dbname",
    "database",
    "service",
    "servicefile",
  ].find((name) => url.searchParams.has(name));
  if (endpointOverride) {
    throw new Error(
      `Release smoke database target cannot prove effective identity when ${endpointOverride} is supplied as connection metadata`,
    );
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(
      "Release smoke database target contains an invalid encoded database name",
    );
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new Error(
      "Release smoke database target must include exactly one database name",
    );
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const port = url.port || "5432";
  return {
    host,
    port,
    databaseName,
    identity: `${host}:${port}/${databaseName}`,
  };
}

export function assertIsolatedReleaseDatabase({
  releaseDatabaseUrl,
  publicationDatabaseUrl,
}) {
  if (!releaseDatabaseUrl) {
    throw new Error(
      "RELEASE_SMOKE_DATABASE_URL is required; refusing to run release smoke against an implicit database",
    );
  }
  if (!publicationDatabaseUrl) {
    throw new Error(
      "DATABASE_URL is required as the publishing target; refusing to verify an unscoped release database",
    );
  }

  const releaseTarget = databaseTarget(releaseDatabaseUrl);
  const publicationTarget = databaseTarget(publicationDatabaseUrl);
  if (
    releaseTarget.host !== publicationTarget.host ||
    releaseTarget.port !== publicationTarget.port
  ) {
    throw new Error(
      "Release smoke database endpoint aliases cannot be proven distinct safely; use explicit targets on the same PostgreSQL host and port with different database names",
    );
  }
  if (releaseTarget.databaseName === publicationTarget.databaseName) {
    throw new Error(
      "RELEASE_SMOKE_DATABASE_URL must be a dedicated target distinct from DATABASE_URL; refusing to mutate the publishing database",
    );
  }

  return releaseTarget.identity;
}

export async function readReviewedMigrations() {
  const migrations = Object.fromEntries(
    await Promise.all(
      REVIEWED_MIGRATION_NAMES.map(async (name) => [
        name,
        await readFile(resolve(root, "migrations", name), "utf8"),
      ]),
    ),
  );

  const migration23 = migrations["0023_remove_tester_auth_add_account_roles.sql"];
  const migration25 = migrations["0025_reconcile_legacy_tester_accounts.sql"];
  const migration26 = migrations["0026_add_users_clerk_user_id.sql"];
  const migration27 = migrations["0027_add_user_capabilities.sql"];

  if (
    !/CREATE TYPE account_role/.test(migration23) ||
    !/ADD COLUMN IF NOT EXISTS role account_role/.test(migration23)
  ) {
    throw new Error(
      "Reviewed auth migration 0023 is missing the account role schema changes",
    );
  }
  if (
    !/DROP TABLE IF EXISTS sessions/.test(migration25) ||
    !/requires exactly one retained Admin/.test(migration25) ||
    !/DELETE FROM counting_sessions/.test(migration25)
  ) {
    throw new Error(
      "Reviewed auth migration 0025 is missing its safe legacy-account reconciliation guard",
    );
  }
  if (
    !/ADD COLUMN IF NOT EXISTS "clerk_user_id"/.test(migration26) ||
    !/CREATE UNIQUE INDEX IF NOT EXISTS "users_clerk_user_id_unique"/.test(migration26)
  ) {
    throw new Error(
      "Reviewed auth migration 0026 is missing the durable Clerk identity mapping",
    );
  }
  if (
    !/ADD COLUMN IF NOT EXISTS "capabilities" jsonb/.test(migration27) ||
    !/users_capabilities_object_check/.test(migration27)
  ) {
    throw new Error(
      "Reviewed auth migration 0027 is missing persisted User capabilities",
    );
  }

  return migrations;
}

async function verifyReviewedMigrations() {
  try {
    return await readReviewedMigrations();
  } catch (error) {
    if (error instanceof ReleaseSchemaPreflightError) throw error;
    throw new ReleaseSchemaPreflightError(
      "invalid-migration",
      error instanceof Error ? error.message : "reviewed migration content could not be read",
      { cause: error },
    );
  }
}

export async function readReleaseSchema(client) {
  const [
    identity,
    columns,
    roleValues,
    legacyColumns,
    legacySessions,
    schemaColumns,
    indexes,
  ] =
    await Promise.all([
      client.query(
        "SELECT current_database() AS database_name, current_schema() AS schema_name",
      ),
      client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'users'`,
      ),
      client.query(
        `SELECT e.enumlabel
         FROM pg_type AS t
         JOIN pg_enum AS e ON e.enumtypid = t.oid
         JOIN pg_namespace AS n ON n.oid = t.typnamespace
         WHERE n.nspname = current_schema()
           AND t.typname = 'account_role'
         ORDER BY e.enumsortorder`,
      ),
      client.query(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND (
             (table_name = 'users' AND column_name = 'is_tester')
             OR (table_name = 'user_settings' AND column_name = 'tester_password')
           )`,
      ),
      client.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name = 'sessions'`,
      ),
      client.query(
        `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = current_schema()
         ORDER BY table_name, ordinal_position`,
      ),
      client.query(
        `SELECT indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = current_schema()
         ORDER BY indexname`,
      ),
    ]);

  const actualColumns = new Set(
    columns.rows.map(({ column_name }) => column_name),
  );
  const missingColumns = [...REQUIRED_AUTH_COLUMNS].filter(
    (column) => !actualColumns.has(column),
  );
  const actualRoleValues = new Set(roleValues.rows.map(({ enumlabel }) => enumlabel));
  const missingRoleValues = [...REQUIRED_ROLE_VALUES].filter(
    (value) => !actualRoleValues.has(value),
  );
  const legacyObjects = [
    ...legacyColumns.rows.map(
      ({ table_name, column_name }) => `${table_name}.${column_name}`,
    ),
    ...legacySessions.rows.map(({ table_name }) => table_name),
  ];

  return {
    databaseName: identity.rows[0]?.database_name,
    schemaName: identity.rows[0]?.schema_name,
    missingColumns,
    missingRoleValues,
    legacyObjects,
    schemaState: {
      columns: schemaColumns.rows.map(
        ({
          table_name,
          column_name,
          data_type,
          udt_name,
          is_nullable,
          column_default,
        }) => ({
          table_name,
          column_name,
          data_type,
          udt_name,
          is_nullable,
          column_default,
        }),
      ),
      indexes: indexes.rows.map(({ indexname, indexdef }) => ({
        indexname,
        indexdef,
      })),
    },
    roleValues: [...actualRoleValues].sort(),
  };
}

function canonicalReleaseShape(schema) {
  if (
    !Array.isArray(schema?.schemaState?.columns) ||
    !Array.isArray(schema?.schemaState?.indexes) ||
    !Array.isArray(schema?.roleValues) ||
    !Array.isArray(schema?.legacyObjects)
  ) {
    throw new ReleaseSchemaPreflightError(
      "target-drift",
      "Cannot fingerprint incomplete publication schema metadata",
    );
  }
  const shape = {
    // A Publish migration appends columns; a fresh export may place them
    // elsewhere. Column position is not part of the schema contract.
    columns: [...schema.schemaState.columns].sort(
      (a, b) => a.table_name.localeCompare(b.table_name) ||
        a.column_name.localeCompare(b.column_name),
    ),
    indexes: [...schema.schemaState.indexes].sort(
      (a, b) => a.indexname.localeCompare(b.indexname),
    ),
    roleValues: [...schema.roleValues].sort(),
    legacyObjects: [...schema.legacyObjects].sort(),
  };
  return shape;
}

export function releaseSchemaFingerprint(schema) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalReleaseShape(schema)))
    .digest("hex");
}

function schemaDifferences(expected, actual) {
  const differences = [];
  const expectedShape = canonicalReleaseShape(expected);
  const actualShape = canonicalReleaseShape(actual);
  if (
    JSON.stringify([expectedShape.columns, expectedShape.indexes]) !==
    JSON.stringify([actualShape.columns, actualShape.indexes])
  ) {
    differences.push("columns or indexes differ from the reviewed schema");
  }
  if (JSON.stringify(expectedShape.roleValues) !== JSON.stringify(actualShape.roleValues)) {
    differences.push(
      `account_role values differ (expected ${[...REQUIRED_ROLE_VALUES].join(", ")})`,
    );
  }
  if (JSON.stringify(expectedShape.legacyObjects) !== JSON.stringify(actualShape.legacyObjects)) {
    differences.push("legacy auth objects differ");
  }
  return differences;
}

export function compareReleaseSchema(expected, actual) {
  return schemaDifferences(expected, actual);
}

export async function assertPublicationSchema(
  client,
  { expectedSchema, transition = REVIEWED_PUBLICATION_TRANSITION } = {},
) {
  if (
    !expectedSchema || !transition || transition.schemaName !== "public" ||
    !/^[a-f0-9]{64}$/.test(transition.legacyFingerprint ?? "") ||
    !/^[a-f0-9]{64}$/.test(transition.candidateFingerprint ?? "")
  ) {
    throw new ReleaseSchemaPreflightError(
      "target-drift",
      "Publication schema transition metadata is missing or invalid",
    );
  }
  await verifyReviewedMigrations();
  const actual = await readReleaseSchema(client);
  if (
    expectedSchema.schemaName !== transition.schemaName ||
    actual.schemaName !== transition.schemaName ||
    !expectedSchema.databaseName ||
    !actual.databaseName
  ) {
    throw new ReleaseSchemaPreflightError(
      "target-drift",
      "Publication schema identity differs from the reviewed public schema",
    );
  }
  const differences = compareReleaseSchema(expectedSchema, actual);
  if (differences.length === 0) {
    if (actual.missingColumns.length || actual.missingRoleValues.length || actual.legacyObjects.length) {
      throw new ReleaseSchemaPreflightError(
        "target-drift",
        "Publishing database is missing required auth schema or retains legacy auth objects",
      );
    }
    return { mode: "current", schema: actual };
  }
  if (
    releaseSchemaFingerprint(expectedSchema) === transition.candidateFingerprint &&
    releaseSchemaFingerprint(actual) === transition.legacyFingerprint
  ) {
    return { mode: "reviewed-legacy", schema: actual };
  }
  throw new ReleaseSchemaPreflightError(
    "target-drift",
    `publishing schema differs from the reviewed isolated schema and the one approved legacy transition ` +
      `(candidate=${releaseSchemaFingerprint(expectedSchema)}, publishing=${releaseSchemaFingerprint(actual)}; ` +
      `${differences.join("; ")})`,
  );
}

function migrationBody(sql) {
  return sql
    .replace(/^\s*BEGIN;\s*/i, "")
    .replace(/\s*COMMIT;\s*$/i, "");
}

async function executeInRollback(client, sql, setupSql = []) {
  await client.query("BEGIN");
  try {
    for (const statement of setupSql) await client.query(statement);
    await client.query(migrationBody(sql));
  } finally {
    await client.query("ROLLBACK");
  }
}

export async function executeReviewedMigrations(client) {
  const migrations = await verifyReviewedMigrations();
  try {
    await executeInRollback(
      client,
      migrations["0023_remove_tester_auth_add_account_roles.sql"],
      [
        'ALTER TABLE "users" DROP COLUMN IF EXISTS "role"',
        'DROP TYPE IF EXISTS "account_role"',
        'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_tester" boolean DEFAULT false NOT NULL',
        'ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "tester_password" text',
      ],
    );
    await executeInRollback(
      client,
      migrations["0026_add_users_clerk_user_id.sql"],
      ['ALTER TABLE "users" DROP COLUMN IF EXISTS "clerk_user_id"'],
    );
    await executeInRollback(
      client,
      migrations["0027_add_user_capabilities.sql"],
      [
        'ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_capabilities_object_check"',
        'ALTER TABLE "users" DROP COLUMN IF EXISTS "capabilities"',
      ],
    );

    const adminId = `release-schema-admin-${process.pid}`;
    const userId = `release-schema-user-${process.pid}`;
    await executeInRollback(
      client,
      migrations["0025_reconcile_legacy_tester_accounts.sql"],
      [
        `INSERT INTO "users" ("id", "email", "approved", "rejected", "role") VALUES ('${adminId}', '${adminId}@invalid.test', true, false, 'Admin'), ('${userId}', '${userId}@invalid.test', true, false, 'User')`,
      ],
    );
  } catch (error) {
    if (error instanceof ReleaseSchemaPreflightError) throw error;
    throw new ReleaseSchemaPreflightError(
      "execution-failure",
      `reviewed migration execution failed: ${error instanceof Error ? error.message : "unknown PostgreSQL error"}`,
      { cause: error },
    );
  }
}

export async function assertReleaseSchema(client, { expectedSchema, target = "release" } = {}) {
  await verifyReviewedMigrations();
  const schema = await readReleaseSchema(client);
  if (schema.missingColumns.length > 0 || schema.missingRoleValues.length > 0) {
    const missing = [
      ...schema.missingColumns.map((column) => `users.${column}`),
      ...schema.missingRoleValues.map((value) => `account_role=${value}`),
    ];
    throw new ReleaseSchemaPreflightError(
      target === "publishing" ? "target-drift" : "execution-failure",
      `Release schema preflight failed before fixture provisioning: missing ${missing.join(", ")} in ${schema.databaseName}.${schema.schemaName}`,
    );
  }
  if (schema.legacyObjects.length > 0) {
    throw new ReleaseSchemaPreflightError(
      target === "publishing" ? "target-drift" : "execution-failure",
      `Release schema preflight failed before fixture provisioning: legacy auth objects remain (${schema.legacyObjects.join(", ")})`,
    );
  }
  if (expectedSchema) {
    const differences = compareReleaseSchema(expectedSchema, schema);
    if (differences.length > 0) {
      throw new ReleaseSchemaPreflightError(
        "target-drift",
        `publishing schema differs from the reviewed isolated schema (${differences.join("; ")})`,
      );
    }
  }
  return schema;
}