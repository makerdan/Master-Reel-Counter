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

  const normalized = new URL(url);
  normalized.password = "";
  normalized.searchParams.sort();
  return normalized.toString();
}

function databaseIdentity(urlString) {
  const url = new URL(databaseTarget(urlString));
  return JSON.stringify({
    hostname: url.hostname.toLowerCase(),
    port: url.port || "5432",
    databaseName: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
  });
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
    releaseTarget === publicationTarget ||
    databaseIdentity(releaseDatabaseUrl) === databaseIdentity(publicationDatabaseUrl)
  ) {
    throw new Error(
      "RELEASE_SMOKE_DATABASE_URL must be a dedicated target distinct from DATABASE_URL; refusing to mutate the publishing database",
    );
  }

  return releaseTarget;
}

async function verifyReviewedMigrations() {
  const migration23 = await readFile(
    resolve(root, "migrations/0023_remove_tester_auth_add_account_roles.sql"),
    "utf8",
  );
  const migration25 = await readFile(
    resolve(root, "migrations/0025_reconcile_legacy_tester_accounts.sql"),
    "utf8",
  );
  const migration26 = await readFile(
    resolve(root, "migrations/0026_add_users_clerk_user_id.sql"),
    "utf8",
  );
  const migration27 = await readFile(
    resolve(root, "migrations/0027_add_user_capabilities.sql"),
    "utf8",
  );

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
}

export async function readReleaseSchema(client) {
  const [identity, columns, roleValues, legacyColumns, legacySessions] =
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
    ]);

  const actualColumns = new Set(columns.rows.map(({ column_name }) => column_name));
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
  };
}

export async function assertReleaseSchema(client) {
  await verifyReviewedMigrations();
  const schema = await readReleaseSchema(client);
  if (schema.missingColumns.length > 0 || schema.missingRoleValues.length > 0) {
    const missing = [
      ...schema.missingColumns.map((column) => `users.${column}`),
      ...schema.missingRoleValues.map((value) => `account_role=${value}`),
    ];
    throw new Error(
      `Release schema preflight failed before fixture provisioning: missing ${missing.join(", ")} in ${schema.databaseName}.${schema.schemaName}`,
    );
  }
  if (schema.legacyObjects.length > 0) {
    throw new Error(
      `Release schema preflight failed before fixture provisioning: legacy auth objects remain (${schema.legacyObjects.join(", ")})`,
    );
  }
  return schema;
}