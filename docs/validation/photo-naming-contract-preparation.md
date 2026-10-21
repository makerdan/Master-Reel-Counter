# Backend photo naming test plan preparation

## Result

**PASS — planning prerequisite only.** No tests were implemented and no
application workload was run. This is not a `test-standard` PASS.

The supported provisioner sealed the complete specification in
`docs/validation/photo-naming-contract.spec.json`:

- ID: `02c166db-db53-4a90-91bf-169e3edac331`
- Revision: `1`
- Bound tier: `test-standard` only
- Plan: `.local/tasks/02c166db-db53-4a90-91bf-169e3edac331.md`
- Plan hash: `00cf0263075fb41cb69678e11641f0a741bf78a8906fc68a6b2f2ffa29c07f7d`
- Skill pin: `2025d914d570b364dea2e7b8bd9dda35881a9b60ccaca67d9d904060b37f6c22`
- Recorded application runs: none

The portable registry preserves the plan and assertion stubs. If local files
are absent in a future task environment, use:

```sh
npm run gate:restore-plan -- --id 02c166db-db53-4a90-91bf-169e3edac331
```

Do not edit a sealed plan or provision another identity for the same work.

## Inspected contract and coverage gap

`server/storage.ts` implements `atomicCreatePhoto` as a real transaction:
insert a photo, lock its owned upload intent, update `originalFilename`,
consume the intent, and return the updated row. Its exact filename is
`S${inserted.sessionId}_P${String(inserted.id).padStart(4, "0")}${ext}`.
Registration retries return the existing row.

`server/routes.ts` takes the final extension from the submitted source
filename, defaulting to `.jpg`. A PNG source therefore supplies `.png` to
storage; the display name is not the original source name. The physical
`objectStorageKey` is a separate identity and is not renamed.

Inspection found `atomicCreatePhoto` tests in
`server/__tests__/photo-delete.test.ts` covering ownership rejection and
idempotent registration, but not exact generated filenames. The plan extends
this already registered backend test file, leaving the mobile JPEG handoff
repair and sign-in work untouched.

## Fixture choice

Three approaches were considered:

1. **Shared database fixtures:** easy to extend, but deterministic boundary IDs
   would require unsafe shared sequence changes or assumptions about existing
   rows. Rejected.
2. **Fake transaction rows:** cheap and deterministic, but can pass without
   proving real SQL persistence, intent handling, or retries. Rejected.
3. **Isolated PostgreSQL schema with real storage callback:** selected. Reuse
   the reviewed schema-export pattern from
   `server/__tests__/integrity-release-schema.test.ts` and dedicated
   schema-scoped pool pattern from `server/__tests__/routes.test.ts`.
   A serial scoped mock delegates only `db.transaction` to the isolated
   Drizzle connection; it does not replace `atomicCreatePhoto` or its SQL.

The specification includes schema-qualified private sequence control, explicit
session IDs, valid owned intents, query/connection/subprocess/suite bounds,
mock restoration, partial-setup cleanup and pool teardown. No live blobs,
shared/public sequence changes, schema pushes, production injection seam or
upload-security changes are authorized. Fixture feasibility is source-based;
database availability and permissions were not probed during planning.

## Requirement-to-delivery handoff

Classification: **pure test/guard work, self-satisfying**. The declaration is
preserved in the sealed specification's scope using the existing renderer.
No renderer or gate-policy change was needed. Separate independent
verification: **not selected**.

| Label | Planned delivery | Preparation evidence | Delivery status |
|---|---|---|---|
| R1 | Twenty real storage registrations: session IDs 7/12345, photo IDs 1/42/9999/10000/123456, extensions `.jpg`/`.png`; exact returned and independently selected names | Read storage and route implementation; sealed explicit token oracle | Planned, not implemented or run |
| R2 | Same physical key, owned intent consumed, same name/ID/key on retry and one row | Read transaction and existing intent/retry tests; sealed invariants | Planned, not implemented or run |
| R3 | Private reviewed-schema fixture, real transaction SQL, private sequence control and bounded cleanup | Inspected existing release-schema export and schema-scoped pool fixtures | Planned, runtime feasibility unverified |
| R4 | Full unchanged `test-standard`, revision-bound case/assertion/result handoff, independent of browser repairs | Read canonical manifest and explicit `test:unit` file list | Tier bound; workload not run |

Use the literal photo-token table `0001`, `0042`, `9999`, `10000`, `123456`
rather than duplicating `padStart` in the oracle. Detection reasoning:

- Source-name passthrough differs from every exact generated expectation.
- Missing padding fails IDs 1 and 42.
- Session padding fails the exact `S7` prefix.
- Hardcoded JPEG fails all ten PNG cases.
- Four-digit truncation fails IDs 10000 and 123456.
- Physical-key renaming fails independent returned/persisted key equality.

These describe the planned assertions, not observed negative-control runs.
The implementation must supply actual case/assertion mappings and validation
results before claiming the guard was delivered.

## Baseline and tier decision

`docs/validation/failure-baseline.json` is readable, schema version 1, with
empty `records`; provisioning and admission also validate it. No known
baselines were ignored or owned. Every future unlisted failure remains a
potential regression until classified with evidence; passing retries do not
establish pre-existing provenance.

`docs/validation/manifest.json` defines `test-standard` with eight steps and a
300000 ms budget. Its `unit-tests` step runs `npm run test:unit`;
`package.json` explicitly includes `server/__tests__/photo-delete.test.ts`.
`test-fast` lacks that step. Broader tiers add lock/port/browser workloads
unnecessary to establish this unchanged backend naming contract.

The normal typecheck excludes `*.test.ts`; do not claim compiler coverage of
these backend cases based on it. The unit runner executes their assertions.
No workload, script or test-registration changes are needed.

## Observed planning checks

1. `npm run gate:new -- --spec docs/validation/photo-naming-contract.spec.json`
   returned `sealed`, revision 1, tier `test-standard`, with no runs.
2. The following returned `ADMITTED`, revision 1:

   ```sh
   TASK_ID=02c166db-db53-4a90-91bf-169e3edac331 \
   TASK_PLAN_FILE=.local/tasks/02c166db-db53-4a90-91bf-169e3edac331.md \
   npm run gate:guard -- --tier test-standard
   ```

3. `npm run gate:merge-guard` returned `READY`.
4. `git diff --check` passed.

These checks validate plan preparation, not test delivery or runtime behavior.
No application server, browser, database query, unit test, compiler, or provider
request was run. Production code, existing tests, security, gate policy,
manifest, baseline catalog and unrelated plans remain unchanged.

## Subsequent implementation

Publish only the narrow test-only implementation against the identity and
revision above. Establish applicable owner authorization and repeat its
Agent-first guard before editing; this planning assignment does not itself
authorize implementation. Use the full supported command afterward:

```sh
TASK_ID=02c166db-db53-4a90-91bf-169e3edac331 \
TASK_PLAN_FILE=.local/tasks/02c166db-db53-4a90-91bf-169e3edac331.md \
npm run gate:run -- \
  --id 02c166db-db53-4a90-91bf-169e3edac331 --tier test-standard
```

Missing database access or schema privileges are execution blockers, not
reasons to use a fake result, mutate shared sequences, waive failures, or
switch tiers. Scope/fixture/tier changes require a supported amendment.

HTTP coverage proving the route's source-extension extraction is a distinct
possible follow-up, not delivered or authorized by this storage-boundary
plan. The present plan faithfully tests `.jpg` and `.png` inputs but would not
catch a future route that passes the wrong extension to storage.
