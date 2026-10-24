# Pin entry authorization delivery

## Context

- Assigned scope: broken access control through pin entry links and deletion.
- Admitted plan: `682ad15d-d101-4587-835b-17d2e936006e`, revision 2.
- Unified contract: `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Regression Guard contract: `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- Classification: material authorization and data-integrity repair; normal guard.
- Pre-implementation preflight: `gate:guard --tier test-standard` returned
  `ADMITTED` for revision 1 before original application edits and revision 2
  before the creation-path repair. Revision 2 preserves the original changes
  and covers the completion check's discovered POST/draft-promotion bypass of
  the same entry-link invariant, within the assigned security scope.
- Baseline catalog inspected: valid, no records. No ignored or owned baselines.
- Separate independent verification: not selected.
- No new UI, schema migration, or product flow is introduced.

## Requirement map

| Label | Recurrence / expected outcome | Delivered guard | Evidence / disposition |
|---|---|---|---|
| R1 | An authorized pin editor must not attach another session's entry or a missing entry | `server/__tests__/routes.test.ts`, “foreign and missing entry links reject the whole patch without mutation”: actual PATCH endpoint returns 400; the pin and victim entry remain unchanged | Included in the bound tier's `unit-tests` step; execution outcome recorded below |
| R2 | Same-session entry links, omitted entry links, and explicit null detachment must continue working | Same file, “same-session linking, omitted links and explicit null detachment remain supported”: actual PATCH returns 200 with the expected link; detachment does not delete the entry | Included in `unit-tests` |
| R3 | Existing malformed pins must not allow either DELETE handler to delete a foreign entry | Same file, both “pin deletion” suites: seed a malformed link, execute each real handler through HTTP/auth middleware, assert pin deletion and unchanged foreign entry | Included in `unit-tests`; the fixture removes only the shadowing first route to exercise the second registration |
| R4 | Storage must enforce the session predicate at deletion, without a read-check-delete race | Same file, “storage deletion predicates on both entry ID and authorized session”: real PostgreSQL preserves the foreign entry on mismatched session and deletes it on matching session | Included in `unit-tests`; required session argument also compiler-checked for all callers |
| R5 | Valid linked and unlinked pin deletion must keep working | Both production DELETE suites remove same-session linked and unlinked pins; assert linked entry deletion and foreign entry preservation | Included in `unit-tests` |
| R6 | Pin creation must not bypass entry-link authorization, including unlabelled rows and draft promotion | “creation and draft promotion reject foreign and missing entry links without mutation”: real POST returns 400, all photo pins and the victim entry are unchanged across all creation branches | Included in `unit-tests` |
| R7 | Same-session creation, draft promotion, and null or omitted links must continue working | “same-session creation and draft promotion still succeed, including unlabelled pins” and “creation still accepts explicit null and omitted entry links”: POST returns 200, persists the authorized link or null, and retains the draft ID on promotion | Included in `unit-tests` |

## Detection rationale

The new pin suites use an approved User with `photo_management` and persisted
editor membership, not ownership of the pin's session or access to the victim's.
The old PATCH handler returns 200 and mutates the pin for a foreign entry, failing
R1. The old DELETE handlers remove the seeded foreign entry, failing R3. Removing
the session predicate from the real storage DELETE fails R4. These assertions run
against an isolated PostgreSQL schema generated from the current shared schema,
not a reimplementation of the route or a source-text approximation.
Before the revision 2 creation guard, POST accepts the foreign link for new rows
and promotes an existing draft to that link, failing R6. The revision 1 full-tier
PASS did not cover that omitted creation path; revision 2 requires a fresh full
tier covering it.

## Validation

Bound tier: `test-standard`, as defined in `docs/validation/manifest.json`.

Supported invocation:

```sh
TASK_ID=682ad15d-d101-4587-835b-17d2e936006e \
TASK_PLAN_FILE=.local/tasks/682ad15d-d101-4587-835b-17d2e936006e.md \
npm run gate:run -- --tier test-standard
```

Execution outcomes are recorded in the gate-owned registry and run summaries for
this admitted identity. Only a full-tier PASS whose source fingerprint matches
the delivered snapshot establishes validation; filtered diagnostics and any
source-change INCOMPLETE results do not.

The application workflow was started successfully and the unauthenticated landing
page rendered in preview. No signed-in UI was visually verified; the affected
authorization behavior is exercised by the authenticated backend tests above.
