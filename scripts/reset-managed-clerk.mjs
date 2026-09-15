import pg from "pg";

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

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query("BEGIN");

  const adminResult = await client.query(
    `SELECT id, clerk_user_id
     FROM users
     WHERE role = 'Admin'
     FOR UPDATE`,
  );
  if (adminResult.rowCount !== 1 || adminResult.rows[0].id !== retainedAdminId) {
    throw new Error(
      `Managed Clerk cutover requires exactly the requested retained Admin (${retainedAdminId})`,
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
    `CREATE TEMP TABLE cutover_non_admin_accounts (
       id varchar PRIMARY KEY
     ) ON COMMIT DROP`,
  );
  await client.query(
    `INSERT INTO cutover_non_admin_accounts (id)
     SELECT id FROM users WHERE role <> 'Admin'`,
  );

  // Delete account-owned session graphs first so their foreign-key cascades
  // remove session-scoped records atomically.
  await client.query(
    `DELETE FROM counting_sessions
     WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts)`,
  );
  await client.query(
    `DELETE FROM folders
     WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts)`,
  );
  await client.query(
    `DELETE FROM session_collaborators
     WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts)`,
  );
  await client.query(
    `DELETE FROM session_invite_links
     WHERE created_by IN (SELECT id FROM cutover_non_admin_accounts)`,
  );

  for (const table of [
    "user_settings",
    "upload_intents",
    "conversations",
    "user_wire_catalogs",
    "ai_usage_logs",
  ]) {
    await client.query(
      `DELETE FROM "${table}"
       WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts)`,
    );
  }

  await client.query(
    `UPDATE users
     SET clerk_user_id = $1, approved = true, rejected = false, updated_at = now()
     WHERE id = $2 AND role = 'Admin'`,
    [managedClerkUserId, retainedAdminId],
  );
  await client.query(
    `DELETE FROM users
     WHERE id IN (SELECT id FROM cutover_non_admin_accounts)`,
  );

  const finalState = await client.query(
    `SELECT id, role, clerk_user_id
     FROM users
     ORDER BY id`,
  );
  if (
    finalState.rowCount !== 1 ||
    finalState.rows[0].id !== retainedAdminId ||
    finalState.rows[0].role !== "Admin" ||
    finalState.rows[0].clerk_user_id !== managedClerkUserId
  ) {
    throw new Error("Managed Clerk cutover verification failed; rolling back");
  }

  await client.query("COMMIT");
  console.log("Managed Clerk cutover completed for the retained Admin.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}