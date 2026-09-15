# Critical Main-Logic Bug Audit Report

**Scope:** Critical end-to-end application logic: sign-in and local identity
resolution, approval and access enforcement, dashboard session creation and
lifecycle, photo upload and serving, entry and pin persistence, label scanning,
offline synchronization, realtime collaboration, and PDF/Excel export
initiation and completion.
**Mode:** Report-only
**Audit date:** 2026-09-15
**Validation ceiling:** `test-heavy`
**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 2 |
| High | 4 |
| Medium | 1 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | Critical | Security | `server/routes.ts:3234-3247` | Completed PDF export jobs remain downloadable after session access is revoked |
| F-002 | Critical | Security | `server/routes.ts:2470-2488,2572-2585` | Label scan accepts pin IDs that do not belong to the requested photo or session |
| F-003 | High | Security | `server/routes.ts:6316-6327` | Removed collaborators can still edit their existing comments |
| F-004 | High | Async & timing | `client/src/hooks/use-network-status.ts:257-308` | Offline photo reconciliation releases failed items without scheduling a retry |
| F-005 | High | State & data integrity | `client/src/lib/offlineEntryCreate.ts:63-75` | An uncertain entry POST can replay without idempotency and create duplicates |
| F-006 | High | Concurrency & shared state | `server/routes.ts:1530-1556` | Photo metadata propagation is not enclosed by the transaction that claims to protect it |
| F-007 | Medium | Error handling | `server/routes.ts:913-925` | Invalid session creation requests are reported as server failures |

The findings below are distinct from the confirmed findings in the existing
Clerk entry/identity, Clerk session-isolation, Clerk admin/realtime, and core
session UX reports. No prior finding was relabeled as new merely because the
same file or journey was inspected.

## Phase 0 — Discovery, scope, and app map

### Detected stack

- **Frontend:** React + TypeScript with Vite.
- **Client data/state:** TanStack Query, React state, localStorage/sessionStorage,
  IndexedDB offline queues, and service-worker cache cleanup.
- **Routing/authentication:** Wouter application routing with Clerk path-routed
  sign-in/sign-up and a server-side local identity/admission bridge.
- **Backend:** Express with PostgreSQL through Drizzle ORM.
- **Realtime:** `ws` WebSocket rooms, presence, authorization revalidation,
  reconnect, and authorization-change eviction.
- **Storage:** Object storage plus local upload fallback and photo registration
  records.
- **Exports:** Background in-memory PDF jobs and synchronous Excel generation.
- **AI workflow:** Per-photo and session-wide label scanning with persisted
  `scan_results`.
- **Test tooling:** Node test runner, Playwright, schema/startup checks,
  storage-key linting, dependency audit, serial-lock validation, and collision
  smoke checks.

### Applicable and skipped gates

- Type-safety checks are applicable because the project uses TypeScript.
- React lifecycle, effect cleanup, state, and stale-closure checks are
  applicable.
- Backend, database, authorization, object-storage, offline, realtime, scan,
  and export checks are applicable to this scope.
- All ten Bug Audit categories were considered. No category was skipped as
  inapplicable.
- Provider internals, visual/accessibility polish, broad non-critical
  admin/reporting behavior, payment behavior, and unsupported import/round-trip
  flows were outside this audit. Browser-provider completion was also limited
  by the validation harness failure described below.

### Audited journeys

1. Signed-out entry, Clerk-to-local identity resolution, approval/rejection,
   protected route selection, and session/resource ownership checks.
2. Dashboard session creation, loading, update/lifecycle, and access changes.
3. Direct and offline photo upload, object registration, serving, metadata
   propagation, pin creation, entry creation, and committed pin linkage.
4. Per-photo and session-wide scan crop requests, provider result validation,
   scan-result persistence, and persistence-failure responses.
5. IndexedDB queue claims, replay, retry, identity transitions, and online
   recovery for entries and photos.
6. WebSocket authentication, room joins, authorization changes, reconnect,
   presence, and session query synchronization.
7. PDF job start, generation kickoff, progress polling, download, cleanup, and
   Excel export completion.

## Evidence and validation baseline

`docs/validation/failure-baseline.json` contained no active records before the
run. The working tree was clean before the report was written, and no
application source, test, migration, configuration, secret, dependency, or
external service data was changed.

The required command was run exactly through the task environment:

```text
TASK_PLAN_FILE=.local/tasks/task-673.md npm run test-heavy
```

### Phase 0 tooling signals

- **Startup/schema:** `startup-smoke` passed; PostgreSQL 16.10 matched the
  validation contract. `schema-check` passed for the exported schema and
  ordered migrations.
- **Dependency audit:** passed with `npm audit --audit-level=high`; 0
  vulnerabilities were reported.
- **Typecheck:** passed for the application and Playwright TypeScript
  projects.
- **Storage lint:** passed with no unregistered storage-key literals.
- **Backend/unit coverage:** the registered unit/backend test step passed,
  including the route, photo-delete, support-ops, provider, and development
  supervisor test groups.
- **Runtime/harness checks:** workspace-skill contract, Vite HMR, serial-lock,
  port-authority, validation-manifest, and collision-smoke checks passed.
- **Browser coverage:** the Playwright step did not begin test execution.
  `tests/global-setup.ts:69` failed while creating the disposable Clerk user
  with `ClerkAPIResponseError: Unprocessable Entity`. This is recorded as a
  provider/test-access validation limitation, not as a product finding. The
  repository has active follow-up work concerning disposable Clerk access, and
  no browser result was treated as a pass.
- **Failure Gate classification:** no active baseline authorized ignoring the
  browser setup failure. Because the failure occurred before product journeys
  ran, it is preserved as an unresolved validation limitation rather than
  being promoted into an application defect or repaired in this report-only
  task. The plan's validation ceiling was not exceeded.

Existing focused tests and prior report evidence were inspected as supporting
context. They cover normal photo registration, scan result persistence-failure
contracts, scan parity, offline cache behavior, session cleanup, and normal
PDF/Excel downloads. They do not cover the revocation, hostile pin-ID,
uncertain-response, or transient-photo-failure cases reported here.

## Phase 1 — Ten Bug Audit category passes

1. **Null / undefined safety:** No new critical null/undefined failure was
   verified after tracing the relevant guards and response construction.
   Unverified array/index and provider-shape candidates remain deferred.
2. **Async & timing:** F-004 was verified in the photo queue. Entry retry
   scheduling exists, but the analogous photo path has no bounded retry or
   terminal state.
3. **Error handling:** F-007 was verified at session creation. Scan
   persistence already has an explicit retryable response contract and was
   not reported again.
4. **Type safety:** Typecheck passed. Existing `any` use in request handlers
   was reviewed around the selected boundaries; only the runtime authorization
   and integrity defects below were reported.
5. **State & data integrity:** F-005 covers uncertain entry replay; the
   normal atomic pin deduplication and draft replacement paths were not
   reported as defects. F-006 covers partial photo metadata propagation.
6. **Security:** F-001, F-002, and F-003 are current authorization or
   cross-session integrity failures.
7. **Performance:** No verified critical performance defect was found in the
   selected journeys. The bounded PDF cleanup and scan batch limits were
   observed.
8. **Concurrency & shared state:** F-006 was verified from the transaction
   boundary and storage implementation. WebSocket authorization invalidation
   and the server-side atomic pin helpers were observed as existing controls.
9. **Dead / unreachable code:** Typecheck, storage lint, and the registered
   test checks were clean; no reachable dead branch affecting a critical
   journey was verified.
10. **Dependency hygiene:** The high-severity dependency audit passed with zero
    advisories, so no dependency finding is reported.

## Findings

### Finding F-001 — Completed PDF export jobs outlive session access

- **Journey:** PDF export initiation and completion; active session
  authorization change
- **File and line:** `server/routes.ts:3234-3247`
- **Category:** Security
- **Severity:** Critical
- **Risk:** The start endpoint checks `verifySessionAccess` and stores the
  originating `userId` and `sessionId`, but the progress and download
  endpoints only compare those stored identifiers with the request. If an
  editor starts an export, the job completes, and the owner then removes that
  editor from the session, the removed editor can continue polling and
  downloading the protected PDF until the in-memory job expires or is
  downloaded. The response contains session inventory data even though the
  user no longer has current session access.
- **Recommended fix:** Re-run `verifySessionAccess` for the current user and
  route session on both progress and download, rejecting deleted or revoked
  sessions. Consider cancelling or invalidating jobs when collaborator or
  account authorization changes. Add a regression test that completes a job,
  revokes the originating user's session access, and asserts both endpoints
  deny access.
- **Evidence:** `POST /api/sessions/:id/export/pdf/start` authorizes at
  `server/routes.ts:3221-3226`. The later endpoints at
  `server/routes.ts:3235-3239` and `3244-3249` do not call
  `verifySessionAccess`; they only check `job.userId` and `job.sessionId`.
  Existing export coverage verifies non-empty downloads but does not revoke
  access during a job.

### Finding F-002 — Label scans trust caller-supplied pin IDs

- **Journey:** Per-photo and session-wide label scan persistence
- **File and line:** `server/routes.ts:2337-2368,2470-2488,2572-2585`;
  `server/storage.ts:2457-2472`
- **Category:** Security
- **Severity:** Critical
- **Risk:** The per-photo endpoint accepts each submitted `pinId` without
  resolving it to the authorized photo. The session-wide endpoint verifies
  that each submitted `photoId` belongs to the authorized session, but it does
  not verify that each `pinId` belongs to that photo or session. The supplied
  IDs then flow into `scan_results`; storage upserts by globally unique
  `pinId`. An authorized user can submit a valid target photo plus a pin ID
  from another session, causing a mismatched row to be inserted or an
  existing scan result for the foreign pin to be overwritten. Even a
  same-session, wrong-photo pin can corrupt the photo/pin relationship.
- **Recommended fix:** Resolve submitted pins server-side before crop work.
  Require every pin to belong to the requested photo and authorized session,
  reject mismatches before calling the provider, and build persisted rows
  from those verified records rather than caller-supplied `pinId`/`photoId`
  pairs. Add a database-level consistency constraint or transaction strategy
  so `scan_results.sessionId`, `photoId`, and `pinId` cannot disagree. Add
  cross-session and wrong-photo negative tests for both scan endpoints.
- **Evidence:** The session-wide route filters only `photoId` at
  `server/routes.ts:2470-2479`, then copies the submitted `pinId` at
  `server/routes.ts:2482-2492` and persists the submitted `photoId` with it
  at `server/routes.ts:2573-2585`. `upsertScanResults` conflicts on the
  globally unique `scanResults.pinId` and updates scan text at
  `server/storage.ts:2461-2471`. The schema has separate foreign keys but no
  composite relationship tying the three IDs together.

### Finding F-003 — Removed collaborators can edit their old comments

- **Journey:** Realtime collaboration after collaborator removal
- **File and line:** `server/routes.ts:6316-6327`
- **Category:** Security
- **Severity:** High
- **Risk:** The comment update route checks authentication and ownership of the
  comment author, but it never checks current access to the comment's
  session. A user can create a comment, lose collaboration access, and replay
  `PATCH /api/comments/:id` to change the protected session's comment. The
  route then broadcasts the unauthorized update to the session room. The
  adjacent delete route does perform `verifySessionAccess`, which makes this
  an inconsistent authorization boundary.
- **Recommended fix:** Load current session access with
  `verifySessionAccess(comment.sessionId, userId, ...)` before allowing the
  author update, and require the appropriate editable role. Return the same
  non-disclosing denial used by other session resources after access is
  revoked. Add a remove-collaborator-then-update-comment regression test.
- **Evidence:** `server/routes.ts:6320-6326` checks only
  `comment.userId !== userId` before updating and broadcasting. The delete
  implementation immediately below calls `verifySessionAccess` at
  `server/routes.ts:6337-6341`; the update route has no equivalent check.

### Finding F-004 — Failed offline photo uploads do not retry automatically

- **Journey:** Offline photo reconciliation and recovery while online
- **File and line:** `client/src/hooks/use-network-status.ts:257-308`
- **Category:** Async & timing
- **Severity:** High
- **Risk:** When the direct object upload returns a transient non-OK response,
  the drainer clears the in-flight claim and continues to the next photo.
  When photo registration returns a non-OK response, it also only clears the
  claim; a caught network error clears the claim and breaks the loop. Unlike
  the entry path, there is no bounded retry timer, retry count, failed-photo
  state, or user-visible terminal error. If the browser remains online and no
  later online/queue event triggers another drain, the photo remains pending
  indefinitely even though the temporary outage has ended. Uploaded object
  bytes can also remain unregistered until a later unrelated trigger.
- **Recommended fix:** Classify retryable photo upload and registration
  failures, persist attempt metadata, and schedule bounded backoff retries
  while the page is active. Surface a durable failed-photo state after the
  retry budget is exhausted, while treating authorization and validation
  responses as explicit user-action failures. Add a test that injects one or
  more 5xx/network failures and verifies automatic recovery without another
  online event.
- **Evidence:** The entry branch schedules retries at
  `client/src/hooks/use-network-status.ts:169-187,196-214`. The photo branch
  instead clears the claim and `continue`s at lines 257-260, clears it without
  scheduling at lines 301-304, and breaks after a caught failure at lines
  305-308. No photo retry timer or failed-photo collection exists in this
  drainer.

### Finding F-005 — Uncertain entry writes can be replayed as duplicates

- **Journey:** Photo-mode entry commit with a lost response or reconnect
- **File and line:** `client/src/lib/offlineEntryCreate.ts:63-75`;
  `client/src/hooks/use-network-status.ts:138-155`
- **Category:** State & data integrity
- **Severity:** High
- **Risk:** A network error after the server has committed an entry is treated
  as a queueable offline failure. The queued replay posts the same logical
  entry again, while `POST /api/sessions/:sessionId/entries` has no
  client-supplied idempotency key or deduplication check. The entry drainer
  retries the POST after a lost response, so a single user action can create
  duplicate inventory rows. In the PhotoMode path,
  `entryQueued === true` skips the pin creation step at
  `client/src/pages/session/PhotoMode.tsx:1602-1618`; a replayed entry can
  therefore also remain disconnected from the intended pin.
- **Recommended fix:** Give each logical entry commit a stable client
  operation key and enforce idempotent create semantics server-side, including
  queue replay and ordinary retry. Prefer an atomic entry-plus-pin operation
  or a follow-up reconciliation that uses the same operation key. Add a lost
  response test that confirms exactly one entry and one committed pin after
  replay.
- **Evidence:** `createEntryWithOfflineFallback` queues on a network error
  after the online POST at `client/src/lib/offlineEntryCreate.ts:63-75`.
  Queue replay issues a plain POST and removes the item only after a successful
  response at `client/src/hooks/use-network-status.ts:138-155`. The server
  creates a fresh serial entry for every request at
  `server/routes.ts:1804-1822`; no operation key is accepted or checked.

### Finding F-006 — Photo metadata propagation is not atomic

- **Journey:** Photo aisle/section edit and propagation to committed entries
  and detail shots
- **File and line:** `server/routes.ts:1530-1556,1559-1572`;
  `server/storage.ts:557-563,627-633`
- **Category:** Concurrency & shared state
- **Severity:** High
- **Risk:** The photo is updated before the route opens its propagation
  transaction. Inside the transaction callback, the route calls storage
  methods that use the module-global `db`, not the transaction handle:
  `updateEntry`, `updatePhoto`, `getPhotoPins`, and `getSessionPhotos` all
  operate outside the callback's transaction. If one downstream entry/detail
  update fails, or a concurrent edit interleaves, the photo and only part of
  its related data can commit. The API then returns a generic 500 while the
  database contains a partially propagated state.
- **Recommended fix:** Make all reads and writes in the propagation operation
  use one transaction-aware storage interface or execute the Drizzle queries
  directly with the transaction handle. Include the initial photo update in
  that same transaction and add an appropriate session/photo lock or
  optimistic version check. Add failure-injection coverage proving rollback
  leaves the photo, detail shots, and committed entries consistent.
- **Evidence:** `server/routes.ts:1530` updates the photo before
  `db.transaction`; the callback at lines 1534-1556 ignores its `tx`
  parameter. `DatabaseStorage.updatePhoto` and `updateEntry` call `db.update`
  directly at `server/storage.ts:558-562` and `627-632`, so the callback
  cannot roll back those writes.

### Finding F-007 — Session validation failures return HTTP 500

- **Journey:** Dashboard session creation and recovery from invalid input
- **File and line:** `server/routes.ts:913-925`
- **Category:** Error handling
- **Severity:** Medium
- **Risk:** `insertSessionSchema.parse` and the database insert are in one
  catch block that always returns HTTP 500. An invalid name, malformed body,
  or schema constraint failure is therefore presented as “Failed to create
  session,” the same as an unexpected server failure. The dashboard can only
  show a generic failure toast, so the user cannot correct the invalid field
  and may retry a request that was actually committed before a response was
  lost.
- **Recommended fix:** Use `safeParse` and return a structured 400 response
  for invalid input; keep the existing explicit invalid-folder response and
  reserve 500 for unexpected failures. Provide a stable error code/field
  payload for the dashboard to render. Add API coverage for invalid session
  input and a client assertion that the validation error is actionable.
- **Evidence:** `server/routes.ts:916` calls `.parse` and
  `server/routes.ts:921` performs the insert inside the same try. Every thrown
  error reaches `server/routes.ts:923-925`, which returns 500. The dashboard
  mutation at `client/src/pages/dashboard.tsx:433-450` presents a generic
  “Failed to create session” toast.

## Prior evidence and confirmed passes

The following prior reports were used as seed context and were not duplicated:

- `docs/ux-audit-report.md` — core session UX and entry-editing finding.
- `docs/clerk-entry-identity-audit-report.md` — identity bridge and protected
  deep-link findings.
- `docs/clerk-session-isolation-audit-report.md` — identity-bound browser
  state, offline ownership, tester fallback, and expiry cleanup findings.
- `docs/clerk-admin-realtime-audit-report.md` — account admission, role,
  active-account socket, and admin-query findings.

Current code and focused tests also support these passes within the selected
scope:

- Server approval middleware, local identity resolution, session ownership,
  and representative photo/entry resource checks remain server-authoritative.
- WebSocket join denial, authorization-change eviction, periodic identity
  revalidation, and client terminal authorization handling are present; no
  distinct new WebSocket defect was reported.
- Photo registration uses a registration key and the normal upload path has
  focused idempotency coverage.
- Scan provider-shape validation and scan persistence-failure responses are
  explicit and retryable.
- Normal Excel and PDF downloads are covered by existing focused tests.
- Pin deduplication and draft replacement use atomic/server-side paths and
  were not included as findings.

## Deferred / not audited

These items were inspected or suggested by heuristics but were not counted as
confirmed findings because the available evidence was insufficient or they
were outside this task's scope:

- Live Clerk sign-in, approval transition, expiry, identity switching, and
  cross-user browser behavior could not run after the disposable-user setup
  failure. Existing confirmed Clerk findings remain in their prior reports.
- Actual object-storage stream failure behavior, multitab photo-drain races,
  browser termination during a durable claim, and physical offline/online
  transitions need failure-injection or browser QA.
- The scan findings are server/data-flow findings; provider OCR correctness,
  prompt quality, and visual scanner UX were not audited.
- PDF/Excel layout, accessibility, browser download UX, and export/import
  round trips were outside this critical-main-logic audit. Normal initiation
  and completion contracts were inspected.
- Broad admin/reporting behavior, visual polish, accessibility, dependency
  upgrades, and non-critical settings were outside scope.
- Grep-only `any`, optional-field, effect-dependency, and unused-code
  candidates were deferred unless surrounding data flow demonstrated a
  critical failure.

## Recommended remediation order

1. Fix F-001 and F-002 first because they cross a current authorization or
   session-data boundary.
2. Fix F-003 next to close the matching collaboration authorization gap.
3. Fix F-005 and F-006 to prevent duplicate or partially propagated inventory
   writes.
4. Fix F-004 so transient offline photo failures recover without requiring an
   unrelated browser event.
5. Fix F-007 so dashboard users can distinguish invalid input from a server
   outage.
6. Add the targeted regression tests described in each finding before
   releasing the corresponding fixes. Resolve the Clerk test-access
   validation limitation before relying on browser-suite results.

## Report-only stop

This audit stops at the report phase. No application behavior, source code,
tests, migrations, configuration, dependencies, secrets, account data, or
external service data was changed. The seven findings above are ready for a
separate approved fix task; select which findings should be addressed next.