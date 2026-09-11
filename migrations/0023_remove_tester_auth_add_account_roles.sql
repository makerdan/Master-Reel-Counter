DO $$ BEGIN
  CREATE TYPE account_role AS ENUM ('Admin', 'User');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role account_role NOT NULL DEFAULT 'User';

ALTER TABLE users
  DROP COLUMN IF EXISTS is_tester;

ALTER TABLE user_settings
  DROP COLUMN IF EXISTS tester_password;

-- The initial Admin is selected at authenticated runtime from the one existing
-- legacy account whose Clerk/Replit identity matches REPL_OWNER. New accounts
-- and ambiguous/unverified identities remain User by default.