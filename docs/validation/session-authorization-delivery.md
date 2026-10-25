# Session authorization hardening

## Scope and governing plan

Execution plan `f208beda-d34e-4b11-9c15-0342f3b9efe5`, revision 1,
is bound to `test-standard`. Its pre-implementation `gate:guard` returned
`ADMITTED`. The plan uses Unified normative contract
`1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736`
and Regression Guard contract
`1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
No amendments or coverage exceptions apply. The baseline catalog was readable
and empty at admission.

This is material security/privacy repair, not new feature development:
normal-form regression coverage applies to both protected-data visibility and
review write permissions. Separate read-only verification was not selected.

## Requirement-to-delivery map

| Label | Recurrence / required outcome | Delivered implementation and guard | Evidence / disposition |
| --- | --- | --- | --- |
| R1 | A collaborator row retained after trash must not expose session names, contributors, inventory totals, or role totals through either aggregate method. | `server/storage.ts` filters both owned and collaborator session queries by null `deletedAt` in `getSharedSessionPerformance` and `getRoleComparisonStats`. `server/__tests__/session-authorization-cases.ts`, registered by `routes.test.ts`, exercises real PostgreSQL aggregate queries with active, trashed, restored, revoked, and owned-trashed sessions; checks exact baseline metadata, contributors, entry/reel/footage/photo totals, roles and empty results. | Delivered; execution evidence recorded by the bound runner in `docs/validation/unified-registry.json`. |
| R2 | A viewer must not create or overwrite a review response, implicitly anchor a cohort through a response, or explicitly anchor one. | Both existing POST handlers in `server/routes.ts` require `canEdit(access.role)` before writes. The registered regression suite uses actual HTTP production middleware and handlers in an isolated database schema: both verdicts get 403 with no new rows/cohort, an existing decision is unchanged, and explicit anchoring returns 403 for both empty and pre-existing cohorts. | Delivered; execution evidence recorded by the bound runner. |
| R3 | Existing authorized behavior and access denial must survive the patch. | The same suite checks owner/editor cohort anchoring and response create/update, per-user decision identity, wrong-session entry and invalid-verdict 400s, nonmember and trashed-session 404s, and viewer GET review-response access. | Delivered; execution evidence recorded by the bound runner. |

## Validation

Supported invocation:

```sh
TASK_ID=f208beda-d34e-4b11-9c15-0342f3b9efe5 \
TASK_PLAN_FILE=.local/tasks/f208beda-d34e-4b11-9c15-0342f3b9efe5.md \
npm run gate:run -- --tier test-standard
```

The registered tier supplies compiler checks, storage lint/contracts, production
API/unit tests (including this suite), port checks, Clerk release contracts,
live Vite HMR tests and manifest parity. Use the runner's revision-bound run
records for actual status and tested target; a command listed here is not
evidence of a successful run.

The regression cases would detect the old behavior directly: without the
`deletedAt` predicates the trashed sessions differ from the asserted live-only
baseline, and without either role check a viewer's real POST succeeds and
persists state instead of returning 403. No unsafe live negative control is
needed. The tests create no real storage blobs or external identity accounts.

## Observed results

- Bound run `ad61f2e4-8f62-4fbf-9a0b-b9a79a326c37`: **FAIL** overall.
  Typecheck, storage lint, port scan, storage-lint contracts, and all 274
  API/unit tests passed, including all five new session authorization cases.
  The implementation target was unchanged during the run.
- `clerk-release-contract` stopped the tier at
  `scripts/__tests__/release-schema-preflight.test.mjs`:
  **release-critical migration SQL executes against an isolated PostgreSQL target**.
  Actual candidate fingerprint starts `a71e8c45`; the reviewed constant starts
  `ab7c906a`. The subsequent Vite HMR and manifest-parity steps were not reached.
- Guarded single-case diagnostic `529bd2c7-b6b6-4d5d-b202-1b526fdc3b1d`
  executed one selected test and reproduced the same failure.
- **Self-classified pre-existing:** the failing case exports the unchanged
  `shared/schema.ts` into its own fresh database, executes unchanged reviewed
  migrations and compares against the unchanged fingerprint constant in
  `scripts/release-schema-preflight.mjs`. It does not execute the modified
  session routes or storage aggregates. The existing independent standard and
  standard-plus workflow logs show the same mismatch. This classification
  does not waive the failure, change the baseline catalog, or establish a
  full-tier PASS. The release-schema review repair remains outside this
  session authorization task.
- The application workflow restarted successfully on port 5000. The public
  landing page rendered normally. Signed-in UI was not visually verified;
  authenticated backend behavior was exercised through the real HTTP tests
  with the fixture's approved account, without weakening application auth.

No application source changes followed these checks; this results section is
a post-run documentation update. The runner's records retain the exact tested
implementation fingerprint and revision.
