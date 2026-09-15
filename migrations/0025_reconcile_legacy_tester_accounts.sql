BEGIN;

-- Managed Clerk cutover invariant: there must be one and only one retained
-- Admin before any account-owned data is removed. This deliberately aborts on
-- an empty, ambiguous, or already-corrupted release database.
DO $$
DECLARE
  admin_count integer;
BEGIN
  SELECT count(*) INTO admin_count FROM users WHERE role = 'Admin';
  IF admin_count <> 1 THEN
    RAISE EXCEPTION 'Managed Clerk cutover requires exactly one retained Admin; found %', admin_count;
  END IF;
END
$$;

CREATE TEMP TABLE cutover_non_admin_accounts (
  id varchar PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO cutover_non_admin_accounts (id)
SELECT id FROM users WHERE role <> 'Admin';

-- Sessions and folders owned by removed accounts are account-owned data. Their
-- foreign-key cascades remove the associated photos, pins, entries, comments,
-- review rows, activity, invites, and other session-scoped records together.
DELETE FROM counting_sessions
WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts);

DELETE FROM folders
WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts);

-- Remove removed accounts from sessions retained by the Admin without touching
-- the retained session or its shared inventory records.
DELETE FROM session_collaborators
WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts);

DELETE FROM session_invite_links
WHERE created_by IN (SELECT id FROM cutover_non_admin_accounts);

DELETE FROM user_settings
WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts);

DELETE FROM upload_intents
WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts);

DELETE FROM conversations
WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts);

DELETE FROM user_wire_catalogs
WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts);

DELETE FROM ai_usage_logs
WHERE user_id IN (SELECT id FROM cutover_non_admin_accounts);

DELETE FROM users
WHERE id IN (SELECT id FROM cutover_non_admin_accounts);

DO $$
BEGIN
  IF (SELECT count(*) FROM users) <> 1
     OR NOT EXISTS (SELECT 1 FROM users WHERE role = 'Admin') THEN
    RAISE EXCEPTION 'Managed Clerk cutover did not retain exactly one Admin account';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE role <> 'Admin') THEN
    RAISE EXCEPTION 'Managed Clerk cutover left a non-Admin account behind';
  END IF;
END
$$;

-- Clerk authenticates HTTP and WebSocket requests directly; application
-- sessions are not part of the managed Clerk identity boundary.
DROP TABLE IF EXISTS sessions;

COMMIT;