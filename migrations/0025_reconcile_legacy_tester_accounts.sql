BEGIN;

-- Synthetic tester accounts were always created with the tester- prefix.
-- Fail closed rather than deleting an account that has since become an Admin.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE id LIKE 'tester-%'
      AND role = 'Admin'
  ) THEN
    RAISE EXCEPTION 'Refusing to remove a legacy tester account with the Admin role';
  END IF;
END
$$;

CREATE TEMP TABLE legacy_tester_accounts (
  id varchar PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO legacy_tester_accounts (id)
SELECT id
FROM users
WHERE id LIKE 'tester-%';

-- Remove account-owned ephemeral data. Inventory, photos, entries, comments,
-- reviews, feedback, and audit rows intentionally retain their denormalized
-- actor IDs so legitimate historical provenance is preserved.
DELETE FROM user_settings
WHERE user_id IN (SELECT id FROM legacy_tester_accounts);

DELETE FROM upload_intents
WHERE user_id IN (SELECT id FROM legacy_tester_accounts);

DELETE FROM conversations
WHERE user_id IN (SELECT id FROM legacy_tester_accounts);

DELETE FROM users
WHERE id IN (SELECT id FROM legacy_tester_accounts);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id LIKE 'tester-%') THEN
    RAISE EXCEPTION 'Legacy tester account reconciliation did not complete';
  END IF;
END
$$;

-- Clerk authenticates HTTP and WebSocket requests directly; the application
-- no longer creates or reads database-backed application sessions.
DROP TABLE IF EXISTS sessions;

COMMIT;