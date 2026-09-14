# Clerk identity mapping migration

Migration `0026_add_users_clerk_user_id.sql` adds a nullable native Clerk user
ID to each local account. Existing accounts are backfilled lazily: the server
loads Clerk's profile once, verifies the local ID against Clerk's `externalId`,
and then stores the immutable native ID.

## Apply

Run the normal release schema preparation. The release preflight requires the
new column before creating test identities, and the unique index prevents one
native Clerk identity from linking to multiple local accounts.

## Roll back

Run `migrations/rollback/0026_add_users_clerk_user_id.sql`. This removes only
the lookup link; it does not remove local accounts, roles, approval state, or
historical data. After rollback, the first authentication after each server
restart calls Clerk's Users API again to recover legacy external IDs.

Do not roll back while the application version that queries `clerk_user_id` is
running. Deploy the prior application version first, run the rollback, and
then verify HTTP and WebSocket sign-in with a legacy account.