import pg from "pg";
import { createClerkClient } from "@clerk/backend";
import {
  COUNT_REMAINING_REMOVED_ACCOUNT_DATA_SQL,
  FILTER_REMOVED_REVIEW_COHORT_SQL,
  SELECT_REMOVED_ACCOUNT_OBJECT_KEYS_SQL,
} from "./lib/managed-clerk-reset-queries.mjs";
import { deletePrivateObjectsAndVerify } from "../server/replit_integrations/object_storage/objectStorageClient.mjs";

const { Client } = pg;

const retainedAdminId = process.env.RETAINED_ADMIN_LOCAL_ID;
const managedClerkUserId = process.env.RETAINED_ADMIN_CLERK_USER_ID;
const confirmation = process.env.MANAGED_CLERK_RESET_CONFIRMATION;

if (!retainedAdminId || !managedClerkUserId) {
  throw new Error(
    "RETAINED_ADMIN_LOCAL_ID and RETAINED_ADMIN_CLERK_USER_ID are required; refusing an ambiguous Clerk cutover",
  );
}
if (!/^user_[A-Za-z0-9_-]+$/.test(managedClerkUserId)) {
  throw new Error("RETAINED_ADMIN_CLERK_USER_ID must be a managed Clerk user id");
}
if (confirmation !== "RESET_MANAGED_CLERK") {
  throw new Error(
    "MANAGED_CLERK_RESET_CONFIRMATION=RESET_MANAGED_CLERK is required for destructive account cleanup",
  );
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}
if (!process.env.CLERK_SECRET_KEY) {
  throw new Error("CLERK_SECRET_KEY is required");
}

let managedIdentity;
try {
  managedIdentity = await createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  }).users.getUser(managedClerkUserId);
} catch {
  throw new Error(
    "The retained managed Clerk identity could not be verified in the configured tenant",
  );
}
if (
  managedIdentity.externalId !== null &&
  managedIdentity.externalId !== retainedAdminId
) {
  throw new Error(
    "The retained managed Clerk identity is linked to a different local account",
  );
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query(
    `LOCK TABLE users, counting_sessions, folders, session_collaborators,
       session_invite_links, photos, entries, scan_results, user_settings,
       upload_intents, conversations, user_wire_categories, ai_usage_logs,
       feedback, comments, review_responses, activity_logs
     IN SHARE ROW EXCLUSIVE MODE`,
  );

  const retainedAdminResult = await client.query(
    `SELECT id, clerk_user_id
     FROM users
     WHERE id = $1 AND approved = true AND rejected = false
     FOR UPDATE`,
    [retainedAdminId],
  );
  if (retainedAdminResult.rowCount !== 1) {
    throw new Error(
      `Managed Clerk cutover requires the requested retained account (${retainedAdminId}) to be approved`,
    );
  }

  const conflictingIdentity = await client.query(
    `SELECT id
     FROM users
     WHERE clerk_user_id = $1 AND id <> $2
     FOR UPDATE`,
    [managedClerkUserId, retainedAdminId],
  );
  if (conflictingIdentity.rowCount !== 0) {
    throw new Error("The replacement Clerk identity is already bound to another local account");
  }

  await client.query(
    `CREATE TEMP TABLE cutover_removed_accounts (
       id varchar PRIMARY KEY,
       clerk_user_id varchar
     ) ON COMMIT DROP`,
  );
  await client.query(
    `INSERT INTO cutover_removed_accounts (id, clerk_user_id)
     SELECT id, clerk_user_id FROM users WHERE id <> $1`,
    [retainedAdminId],
  );
  await client.query(
    `CREATE TEMP TABLE cutover_removed_identities (
       id varchar PRIMARY KEY
     ) ON COMMIT DROP`,
  );
  await client.query(
    `INSERT INTO cutover_removed_identities (id)
     SELECT id FROM cutover_removed_accounts
     UNION
     SELECT clerk_user_id
     FROM cutover_removed_accounts
     WHERE clerk_user_id IS NOT NULL`,
  );

  const removedObjectKeys = await client.query(
    SELECT_REMOVED_ACCOUNT_OBJECT_KEYS_SQL,
  );
  const objectCleanup = await deletePrivateObjectsAndVerify({
    objectPaths: removedObjectKeys.rows.map((row) => row.object_storage_key),
  });
  console.log(
    `Managed Clerk object cleanup verified for batch ${objectCleanup.batchId}: ${objectCleanup.removed} object(s) absent.`,
  );

  // Delete account-owned session graphs first so their foreign-key cascades
  // remove session-scoped records atomically.
  await client.query(
    `DELETE FROM counting_sessions
     WHERE user_id IN (SELECT id FROM cutover_removed_accounts)`,
  );
  await client.query(
    `DELETE FROM folders
     WHERE user_id IN (SELECT id FROM cutover_removed_accounts)`,
  );
  await client.query(
    `DELETE FROM session_collaborators
     WHERE user_id IN (SELECT id FROM cutover_removed_accounts)`,
  );
  await client.query(
    `DELETE FROM session_invite_links
     WHERE created_by IN (SELECT id FROM cutover_removed_accounts)`,
  );
  await client.query(
    `DELETE FROM scan_results
     WHERE scanned_by IN (SELECT id FROM cutover_removed_identities)`,
  );
  await client.query(
    `DELETE FROM entries
     WHERE user_id IN (SELECT id FROM cutover_removed_accounts)`,
  );
  await client.query(
    `DELETE FROM photos
     WHERE user_id IN (SELECT id FROM cutover_removed_accounts)`,
  );
  await client.query(FILTER_REMOVED_REVIEW_COHORT_SQL);

  for (const table of [
    "user_settings",
    "upload_intents",
    "conversations",
    "user_wire_categories",
    "ai_usage_logs",
    "feedback",
    "comments",
    "review_responses",
    "activity_logs",
  ]) {
    await client.query(
      `DELETE FROM "${table}"
       WHERE user_id IN (SELECT id FROM cutover_removed_accounts)`,
    );
  }

  await client.query(
    `UPDATE users
     SET clerk_user_id = $1,
         approved = true,
         rejected = false,
         role = 'Admin',
         updated_at = now()
     WHERE id = $2 AND approved = true AND rejected = false`,
    [managedClerkUserId, retainedAdminId],
  );
  await client.query(
    `DELETE FROM users
     WHERE id IN (SELECT id FROM cutover_removed_accounts)`,
  );

  const finalState = await client.query(
    `SELECT id, role, approved, rejected, clerk_user_id
     FROM users
     ORDER BY id`,
  );
  if (
    finalState.rowCount !== 1 ||
    finalState.rows[0].id !== retainedAdminId ||
    finalState.rows[0].role !== "Admin" ||
    finalState.rows[0].approved !== true ||
    finalState.rows[0].rejected !== false ||
    finalState.rows[0].clerk_user_id !== managedClerkUserId
  ) {
    throw new Error("Managed Clerk cutover verification failed; rolling back");
  }

  const remainingOwnedData = await client.query(
    COUNT_REMAINING_REMOVED_ACCOUNT_DATA_SQL,
  );
  if (remainingOwnedData.rows[0]?.count !== 0) {
    throw new Error(
      "Managed Clerk cutover left removed-account data; rolling back",
    );
  }

  await client.query("COMMIT");
  console.log("Managed Clerk cutover completed for the retained Admin.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}