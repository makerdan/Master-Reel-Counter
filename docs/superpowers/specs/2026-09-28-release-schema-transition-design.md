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