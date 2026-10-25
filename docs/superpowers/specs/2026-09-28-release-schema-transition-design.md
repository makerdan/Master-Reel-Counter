# Release schema transition during Publish

## Problem and safety boundary

The release build successfully compiles and initializes an isolated candidate database, but then requires the existing production schema to equal that candidate. Production still has the older tester schema, so this pre-Publish equality requirement blocks Publish from presenting and applying its reviewed development-to-production schema diff.

The build must not mutate production, choose a create/rename answer, authorize data deletion, or bypass the isolated candidate's schema and migration checks. The current production version remains in service until the user completes Publish.

## Approaches considered

1. **Recommended: pin one reviewed schema transition.** Continue accepting an already-current production schema. Also accept the exact pair of the reviewed older production schema and this release candidate schema, using deterministic, database-name-independent schema fingerprints. Reject any other pair. This is narrow and auditable, but subsequent schema changes require a new review and updated fingerprints.
2. **Allowlist individual schema differences.** Compare every column and index against a maintained list of permitted additions, removals, and changed defaults. More flexible, but complicated to keep aligned with the whole Publish diff and easier to accept an unintended combination.
3. **Remove the production comparison.** Simple, but loses the fail-closed protection against unexpected target drift. Do not use this approach.

## Proposed flow

After exporting the current schema to the run-owned temporary database, keep the existing reviewed-migration execution and strict candidate preflight. Read production metadata without modifying it. If production already equals the candidate, proceed as today. Otherwise, compute a stable fingerprint from the existing schema reader's sorted columns, indexes, role values, and legacy-auth objects, excluding database identity and any row data. Proceed only if **both** fingerprints match a checked-in reviewed transition record: the known older production shape and the corresponding release-candidate shape. The record describes the expected legacy-to-current changes in readable text; it stores no connection details or user data.

An accepted transition prints a clear warning that Publish still needs to review the schema diff, including removal of the legacy `sessions` table, `users.is_tester`, and `user_settings.tester_password`; it does not claim those changes are harmless or applied. Any missing metadata, unexpected production modification, or changed candidate shape fails before release browser fixtures. Once production is current, the normal equality route works without the transitional record.

The Publish UI remains the only production migration path. Its destructive-change and rename prompts remain the user's decisions. This work does not run a schema push, alter a deployment command, or publish the app.

## Verification

Add deterministic tests for current-equals-candidate, the precise old-production/current-candidate pair, and rejection of altered production, altered candidate, and missing/invalid transition metadata. Exercise the integration between the isolated release setup and publication check. Run the appropriate registered validation tier and a local release preflight against a disposable candidate database, without changing production. If the full release check needs credentials or live browser access unavailable locally, report that limitation rather than treating partial checks as a pass.

## Reviewed endpoint update — 2026-10-25

This review does not require publishing first. The supported production database
metadata query initially refused access, then succeeded in the resumed authenticated
session. It used only SELECTs against `information_schema`, `pg_indexes`, and
the account-role enum catalogs; no rows, credentials, target URLs, or data were
captured. `readReleaseSchema` reconstructed its normal metadata shape and
`releaseSchemaFingerprint` computed the digest using the application's own
canonicalizer (including JavaScript index ordering). No SQL-side hashing or
independently implemented sorting was used.

| Endpoint | Canonical SHA-256 | Columns / indexes |
|---|---|---|
| Read-only publication, unchanged legacy | `dad8f2e20ffdf33fa056d5e0bb384ea7489b3464e131d4c70e5f5cb949c26764` | 212 / 65 |
| Previously reviewed candidate | `ab7c906a008a22f19d2c976cab07f15b57180009ec564e0bc73b007c4d74063c` | 223 / 68 |
| Updated candidate | `a71e8c45bff0a02298b691e89f8968d03a5105afb8259f6e8b8fd0affd22373f` | 224 / 68 |

The configured development schema was inspected in a READ ONLY transaction and
has the updated candidate digest. Removing only the metadata entry for
`folders.trashed_from_parent_folder_id` recovers the entire previously reviewed
candidate digest. The only structural source change since the prior review is
this nullable `integer` (`int4`) column, with no default. The other schema source
change is a request-body path validator, not database DDL. Index definitions,
existing columns/defaults, role values, and legacy-object markers otherwise
remain identical to the prior candidate. The real export/migration contract
independently asserts both candidate digests and the column's exact shape; it
also executes migration 0029 on a disposable target inside rollback and compares
the result with the export. Auth migration membership remains 0023/0025/0026/0027.

### Complete publication-to-candidate metadata delta

The following changes were reviewed, not implicitly approved as safe to apply:

- Add eight `ai_usage_logs` columns: `provider` (text NOT NULL, default
  `'replit-openai-compatible'::text`), `endpoint` and `route` (nullable text),
  `status` (text NOT NULL, default `'success'::text`), `latency_ms` (nullable
  integer), `retry_count` (integer NOT NULL, default `0`), `fallback_state`
  (text NOT NULL, default `'none'::text`), `cache_state` (text NOT NULL,
  default `'not-applicable'::text`).
- Add `conversations.user_id` (varchar NOT NULL, no default),
  `entries.client_operation_id` and `photos.registration_key` (nullable varchar,
  no default), and `folders.trashed_from_parent_folder_id` (nullable integer,
  no default).
- Add `user_settings.help_guide_version` (integer NOT NULL, default `0`) and
  `help_guide_completed_at` (nullable timestamp without time zone, no default).
  Change `photo_quality`'s default from `85` to `95`; type/nullability unchanged.
- Add `users.clerk_user_id` (nullable varchar, no default), `role` (account_role
  NOT NULL, default `'User'::account_role`), and `capabilities` (jsonb NOT NULL,
  default object with `photo_management: true` and exports/statistics/ai_scanning/
  session_create/session_delete/account_settings/collaborator_management false).
- Remove `users.is_tester` (boolean NOT NULL, default false),
  `user_settings.tester_password` (nullable text), and the `sessions` table's
  `sid` (varchar), `sess` (jsonb), `expire` (timestamp without time zone) columns
  (all NOT NULL, no defaults).
- Add indexes `ai_usage_logs_provider_idx` on provider,
  `conversations_user_id_idx` on user_id,
  `entries_session_user_operation_id_unique` on session_id/user_id/client_operation_id,
  `photos_session_registration_key_unique` on session_id/registration_key,
  and `users_clerk_user_id_unique` on clerk_user_id (the last three unique).
  Remove `IDX_session_expire` on sessions.expire and `sessions_pkey` on sessions.sid.
  No other index definitions changed.
- Account-role values change from absent to exactly `Admin`, `User`. Legacy
  markers `sessions`, `users.is_tester`, `user_settings.tester_password` disappear.

The reviewed delta is encoded as a metadata-only test fixture, not a migration
or runtime allowlist. Its reconstructed complete publication shape must match
the independently observed legacy pin. Tests exercise the real default pins
and independently mutate types, nullability, defaults, indexes, enum values and
legacy markers on either endpoint, expecting `target-drift`. Current-schema
equality remains accepted; an older candidate is not added to an allowlist.

No production DDL, schema push, row query, or publication was performed. The
Publish diff and any destructive/rename choices remain the user's decisions.
The fingerprint covers the existing columns/indexes/role-values/legacy-objects
contract, not an expanded claim about every PostgreSQL object or constraint.