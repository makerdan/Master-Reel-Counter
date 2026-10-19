# API Route Security Audit Report

**Scope:** Core Express API routes, route registration, authentication and
approval middleware, capability enforcement, administrator boundaries, session
and resource authorization, request validation, response/error contracts, and
media/export access paths.

**Mode:** Report-only

**Audit date:** 2026-09-16

**Validation ceiling:** `test-standard`

**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 1 |
| High | 2 |
| Medium | 1 |
| Low | 0 |

| ID | Severity | Category | File and line | One-line description |
|---|---|---|---|---|
| API-001 | Critical | Security | `server/routes.ts:1866-1883,1908-1947,2206-2218,2233-2262,2269-2293,6345-6369`; `shared/schema.ts:136-140,167-170,270-283` | Mutating routes accept related resource IDs from another session |
| API-002 | High | Security | `server/routes.ts:701-743,2386-2395` | Per-photo label analysis is gated by photo management instead of AI scanning |
| API-003 | High | Security | `server/routes.ts:1747-1808`; `shared/schema.ts:304-323` | Photo restore can attach an arbitrary object-storage key to an authorized session |
| API-004 | Medium | Async & timing | `server/routes.ts:915-937` | A media stream failure after headers are sent can leave the response open |

These are newly verified in this route-focused audit. Findings already present
in `docs/bug-audit-report.md` or already represented by current project work
are reconciled below and are not repeated as new findings.

## Validation evidence

The failure baseline was empty before validation:

```json
{"schemaVersion":1,"records":[]}
```

The required command was run exactly at the task-plan ceiling:

```text
TASK_PLAN_FILE=.local/tasks/task-756.md node scripts/run-locked-tier.mjs .local/tasks/task-756.md
```

Result:

- `test-standard` passed.
- Typecheck passed.
- Storage-key lint passed.
- Backend/unit tests passed.
- Clerk release-contract tests passed.
- Vite HMR tests passed.
- Failure Gate parity and validation-manifest parity passed.
- No test failure required pre-existing-failure classification.

The report-only work changed only this report. No application source, tests,
configuration, dependencies, migrations, secrets, or external service data
were changed.

## Phase 0 — Route and middleware inventory

### Application middleware order

The core route registration in `server/routes.ts` applies these boundaries in
order:

1. `/api` responses receive no-cache headers at `server/routes.ts:673-678`.
2. `/api` requests at `server/routes.ts:684-696` skip authentication only for
   `/api/auth/user`, `/api/track/pageview`, and `/api/healthz`. All other API
   requests run `isAuthenticated`, then `isApproved`.
3. The capability middleware at `server/routes.ts:698-743` maps protected
   operations to account capabilities and calls `requireCapability`.
4. `/api/admin` receives the `ownerOnly`/`adminOnly` boundary at
   `server/routes.ts:745-747`.
5. Individual handlers still perform session membership, resource lookup,
   role, lock, and input checks.

The global approval layer is important when a route's local middleware list
shows only `isAuthenticated`: it still runs before the handler unless the
route is one of the three explicit skip paths. `/api/auth/user` is
intentionally authentication-only so an authenticated but not-yet-provisioned
identity can receive its `404 not_provisioned` response.

The administrator routes in `server/replit_integrations/auth/routes.ts` also
repeat `isApproved` and `adminOnly` locally. `adminOnly` reads the persisted
local role through `isAdminIdentity`; it does not trust a caller-supplied role
or a client capability list.

### Route inventory

The route registration scan found 137 Express route registrations across
`server/routes.ts`, the auth routes, and the object-storage routes. The
following grouped inventory covers the core externally reachable surfaces.
Routes shown with only `isAuthenticated` still receive global approval and
capability middleware as described above.

| Surface | Route patterns audited | Primary boundary |
|---|---|---|
| Public/identity | `GET /api/auth/user`, `GET /api/healthz`, `GET /api/track/pageview` | Explicit public skip paths where applicable; auth user remains Clerk-authenticated |
| Admin/auth | `GET /api/admin/users`, `GET /api/admin/rejected-users/count`, `POST /api/admin/users/clear-rejected`, `DELETE /api/admin/users/:id`, `PATCH /api/admin/users/:id/approval`, `PATCH /api/admin/users/:id/capabilities`, `GET /api/admin/ai-health`, Clerk proxy health | Approved authenticated admin/owner boundary |
| Uploads/media serving | `POST /api/uploads/direct`, `POST /api/uploads/request-url`, `GET /uploads/:filename`, `GET /objects/{*objectPath}` | Auth, approval, rate limits, filename allowlist, and session/avatar/logo ownership checks; the retired presigned route returns 410 |
| Sessions | `GET/POST /api/sessions`, `GET /api/sessions/shared`, `GET/PATCH /api/sessions/:id`, lock/delete/restore/permanent-delete, bulk status/move/delete | Auth plus `verifySessionAccess`, owner/editor role checks, folder ownership, optimistic locking, and capability mapping |
| Folders | `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id`, restore/permanent-delete/trash/reorder | Auth plus current-user ownership and folder/session relationship checks |
| Session movement/duplication | `POST /api/sessions/:id/move`, `/duplicate`, `/reset-to-photos` | Auth plus owner and target-folder checks |
| Session search | `GET /api/search/sessions`, `GET /api/sessions/:id/entries/search` | Auth plus user/session access; query filters are bounded by type/range checks where applicable |
| Photos | `GET/POST /api/sessions/:sessionId/photos`, `PATCH/POST/DELETE /api/photos/:id`, `POST /api/sessions/:id/photos/restore` | Auth plus session access, editor role, lock checks, Zod validation on normal create/update, and object registration paths |
| Entries and pins | Session/photo list and create routes, `PATCH/DELETE /api/entries/:id`, pin list/create/update/delete/flag/keep routes | Auth plus session/photo access and editor role; API-001 applies to relationship IDs |
| Duplicate/draft data | Dismissed-duplicate GET/POST/DELETE, `PUT /api/photos/:photoId/draft-pins` | Auth plus session/photo access and photo-management capability for mutations |
| AI/image processing | Per-photo and session-wide `analyze-labels`, sample-pixel, detect-received, label-cache, scan-results GET/DELETE | Auth plus session/photo access and editor role; rate limiting on scans; API-002 applies to per-photo capability selection |
| Review | Review cohort, review response GET/POST/DELETE/resolve | Auth plus session access; review response create/resolve verifies the entry belongs to the route session |
| Collaboration | Collaborator list/add/remove/role update/leave/transfer ownership, invite-link list/create/revoke, invite join | Auth plus session access and owner/editor role checks; invite tokens are checked for active state and expiry |
| Activity/comments | Activity, activity users, comments GET/POST/PATCH/DELETE, online users | Auth plus session access; comment update has a previously documented revocation gap and is not counted again here |
| Exports/tasks | PDF start/progress/download, synchronous JSON/Excel export, active-tasks | Auth plus session access on the initiating/download data routes; completed PDF revocation is prior finding F-001 |
| Profile/settings/storage | Profile PATCH/avatar upload/delete, settings/logo upload/delete/GET/PATCH/encoding, storage usage/global usage/backfill/dedupe | Auth plus account-settings or photo-management capabilities, with owner/admin checks on global operations |
| Stats/feedback/catalogs | Stats, feedback create/list/admin list, wire-catalog list/create/bulk/delete | Auth; statistics and collaborator/account capability boundaries apply where mapped; admin feedback uses admin boundary |
| Support/admin diagnostics | Orphan sweeps, crashes, stalled intents, integrity checks/fixes, PDF jobs, admin summary/AI usage/page views | Global approved-admin boundary plus handler-specific admin checks |

### Authorization model observed

- `isAuthenticated` establishes the Clerk-derived request identity.
- `isApproved` reads the local account state and denies pending/rejected
  accounts.
- `verifySessionAccess` is the normal tenant boundary for owned or shared
  sessions and returns the effective collaborator role.
- `canEdit` and `isOwner` distinguish viewer/editor/owner operations.
- `checkLocked` blocks edits to locked sessions where required.
- The capability layer is server-authoritative and maps route paths to
  account-level capabilities.
- `ownerOnly` is an alias of `adminOnly`; the local persisted role, not a
  client claim, decides administrator access.
- Resource handlers usually resolve the resource first, then verify access
  through its session. The gaps below occur where related IDs or object keys
  are accepted without repeating that relationship check.

## Phase 1 — Category passes

All ten Bug Audit categories were considered for the route boundary:

1. **Null / undefined safety:** Route-level resource existence checks are
   present on the reviewed session/photo/entry/pin paths. The confirmed stream
   failure is recorded under async/timing rather than as a null dereference.
2. **Async & timing:** API-004 was verified in the file streaming handlers.
   Other background PDF and task lifecycle behavior was reconciled to prior
   audit coverage.
3. **Error handling:** Most route handlers normalize unexpected failures to a
   stable message. The global fallback's raw `err.message` exposure was
   reviewed but deferred because the inspected route handlers catch their
   operational errors and no route-specific sensitive message exposure was
   demonstrated.
4. **Type safety:** TypeScript validation passed. Request handlers still use
   `req: any` in places, but only cases with a demonstrated authorization or
   contract consequence are reported.
5. **State & data integrity:** API-001 covers relationship integrity between
   session-scoped objects; API-003 covers storage-key rebinding.
6. **Security:** API-001, API-002, and API-003 are the confirmed
   authorization/tenant-boundary defects.
7. **Performance:** Scan requests are rate-limited and crop batches are
   bounded. Unbounded legacy list responses and caller-provided pagination
   values were inspected but not promoted without evidence of production
   impact.
8. **Concurrency & shared state:** Route transactions and atomic pin helpers
   were reviewed. The stream lifecycle defect is reported; no additional
   verified cross-request shared-state defect was found in this scope.
9. **Dead / unreachable code:** The retired presigned upload endpoint
   intentionally returns 410, and the object route deliberately restricts
   itself to `/objects/uploads/`; no security-relevant dead branch was
   reported.
10. **Dependency hygiene:** The standard tier's registered checks passed.
    No dependency finding is reported here; the dependency audit task is
    tracked separately.

## Findings

### API-001 — Mutating routes accept related resource IDs from another session

- **Category:** Security
- **Severity:** Critical
- **Files and lines:** `server/routes.ts:1866-1883`,
  `server/routes.ts:1908-1947`, `server/routes.ts:2206-2218`,
  `server/routes.ts:2233-2262`, `server/routes.ts:2269-2293`,
  `server/routes.ts:6345-6369`; `shared/schema.ts:136-140,167-170,270-283`
- **Affected contracts:** Entry creation/update, pin creation/update/delete,
  comment creation, and photo restore relationship fields

#### Risk and realistic failure scenario

The handlers verify access to the route's session or photo, but several then
trust caller-supplied foreign keys without proving that each related record
belongs to that same session:

- `POST /api/sessions/:sessionId/entries` passes the body through
  `insertEntrySchema` after overwriting only `sessionId` and `userId`.
  `photoId` remains caller-controlled.
- `PATCH /api/entries/:id` permits `photoId` in `patchEntrySchema` and updates
  it without checking the target photo's session.
- `POST /api/photos/:photoId/pins` passes `entryId` through
  `insertPinSchema`; `PATCH /api/pins/:id` likewise permits `entryId` without
  a same-session check.
- `DELETE /api/pins/:id` deletes `pin.entryId` before deleting the authorized
  pin. If a pin was created or patched with an entry from another session,
  an editor who can modify the pin's photo can delete the foreign entry.
- `POST /api/sessions/:id/comments` validates the types of `entryId`,
  `photoId`, and `parentCommentId`, but does not validate their session
  ownership before inserting the comment.

The schema's individual foreign keys only prove that the referenced rows
exist. They do not express the composite invariant that the entry, photo,
pin, comment, and session IDs must agree. A malicious or merely stale client
can therefore create cross-session associations, corrupt inventory joins, and
in the pin-delete path cause destructive action against a foreign entry. The
same missing relationship validation also appears in the nested relationship
payload accepted by photo restore at `server/routes.ts:1787-1808`.

#### Evidence

- Route access is established for the parent session/photo before the
  relationship value is parsed or written.
- `insertEntrySchema` and `insertPinSchema` are generated from individual
  table columns; the relevant columns are nullable integer foreign keys at
  `shared/schema.ts:140` and `shared/schema.ts:170`.
- `patchEntrySchema` explicitly includes `photoId` at
  `server/routes.ts:591-607`; `patchPinSchema` explicitly includes `entryId`
  at `server/routes.ts:572-583`.
- Comment creation accepts all three related IDs at
  `server/routes.ts:6345-6369` but only checks the text/body shape.
- The delete path calls `storage.deleteEntry(pin.entryId)` at
  `server/routes.ts:2289-2293` after authorizing only the pin's photo
  session.

#### Recommended fix

Resolve every supplied related ID server-side and require the resolved
resource to belong to the route's authorized session and, where applicable,
the route's photo. Reject mismatches before writes. For pin deletion, derive
the entry relationship from a verified same-session pin or use a
session-scoped delete query so a foreign entry can never be deleted. Apply the
same invariant to comments, restore payloads, and nested parent/detail-photo
relationships. Add cross-session negative tests for create, patch, delete,
restore, and comment creation, plus a database-level strategy for composite
session consistency where feasible.

### API-002 — Per-photo label analysis bypasses the AI-scanning capability

- **Category:** Security
- **Severity:** High
- **Files and lines:** `server/routes.ts:701-743,2386-2395`
- **Affected contract:** `POST /api/photos/:photoId/analyze-labels`

#### Risk and realistic failure scenario

The capability middleware selects the first matching capability. Its
`else-if` branch treats any path containing `/photos` as
`photo_management` at `server/routes.ts:721-727`. The per-photo analysis path
also contains `/photos`, so it never reaches the later `analyze-labels` or
`/scan` branch that assigns `ai_scanning` at `server/routes.ts:735-740`.

An approved account with photo-management enabled but AI scanning disabled can
therefore invoke the per-photo vision route. The route checks session access
and editor role, but it does not perform a separate `requireCapability` call;
the global middleware has already allowed the request. This bypasses an
explicit account control and can incur provider usage and send authorized
private photo content to the AI provider despite the account's configured
capability.

#### Evidence

- Capability selection is mutually exclusive at
  `server/routes.ts:704-740`.
- The `/api/photos/:photoId/analyze-labels` path matches
  `path.includes("/photos")` before the AI branch.
- The handler begins provider work after session and editor checks at
  `server/routes.ts:2386-2397`; there is no second AI-capability check.
- The session-wide route at `server/routes.ts:2514-2522` does not include
  `/photos` and therefore follows the AI branch, demonstrating the
  inconsistent capability behavior between the two scan routes.

#### Recommended fix

Classify the two label-analysis routes as `ai_scanning` before the generic
photo-management match, or use explicit route predicates that cannot overlap.
Keep photo-management enforcement for photo mutations. Add a negative test
that disables AI scanning while retaining photo management and asserts both
per-photo and session-wide analysis routes return the capability denial.

### API-003 — Photo restore can attach an arbitrary object-storage key

- **Category:** Security
- **Severity:** High
- **Files and lines:** `server/routes.ts:1747-1765,1766-1775,1781-1808`;
  `shared/schema.ts:304-323`
- **Affected contract:** `POST /api/sessions/:id/photos/restore`

#### Risk and realistic failure scenario

After verifying that the caller can edit the target session, the restore
handler accepts any non-empty string as `objectStorageKey` and inserts it into
the new photo row. It does not require a server-created upload intent owned by
the caller, verify that the key is already referenced by the caller's upload,
or prove that the key is not owned by another account. It also copies
relationship fields such as `parentPhotoId` from the request without resolving
them to the target session.

A user with edit access to one session who obtains another account's storage
key from an old response, copied URL, or client state can register that object
as a new photo in the accessible session. Normal `/uploads/:filename`
authorization then treats the object as belonging to the new session and can
serve it to that session's collaborators. This rebinds a private object across
tenant boundaries without an authorized upload/ownership transition.

#### Evidence

- The only key validation is
  `typeof body.objectStorageKey === "string"` at
  `server/routes.ts:1756-1759`.
- The value is copied directly into `safePhotoData` at
  `server/routes.ts:1761-1765` and inserted at `server/routes.ts:1781-1785`.
- The normal photo-registration schema exposes `objectStorageKey` at
  `shared/schema.ts:304-323`, but schema shape validation does not establish
  ownership or an upload-intent relationship.
- Nested entries and pins are inserted from caller-provided payloads at
  `server/routes.ts:1787-1808`; only a local old-entry ID map is applied to
  pin `entryId`.

#### Recommended fix

Make restore consume a server-issued, user-owned upload intent or an
explicitly authorized existing photo reference. Resolve and validate the
object key against that intent/reference before inserting the photo; reject
unknown, expired, already-consumed, or differently owned keys. Validate
`parentPhotoId`, nested entry/photo IDs, and pin relationships against the
target session before the transaction writes them. Preserve the existing
object-storage alias fix tracked by the prior audit rather than treating the
raw key as an authorization token.

### API-004 — Media stream failure after headers can leave the response open

- **Category:** Async & timing
- **Severity:** Medium
- **Files and lines:** `server/routes.ts:915-937`
- **Affected contract:** `GET /uploads/:filename` and its redirected object
  route

#### Risk and realistic failure scenario

Both the GCS and local streaming branches set response headers and pipe a
read stream. Their error listeners only send a 500 response when
`!res.headersSent`:

```ts
if (!res.headersSent) res.status(500).json({ error: "Stream failed" });
```

Once a stream has emitted headers and transferred part of an image, a later
GCS/local read failure is logged but no response termination or explicit
connection destruction occurs. A browser or proxy waiting for the remaining
body can keep the request open until a transport timeout. Repeated transient
storage failures can consume connections and cause visible image loads to
hang rather than fail promptly.

#### Evidence

- GCS sets headers and starts `createReadStream().pipe(res)` at
  `server/routes.ts:921-923`.
- The GCS error listener logs and conditionally sends an error only before
  headers at `server/routes.ts:922`.
- The local disk branch has the same behavior at
  `server/routes.ts:935-937`.
- The outer catch cannot reliably normalize a post-header failure because the
  stream callback runs after the handler has returned and the response has
  already begun.

#### Recommended fix

Use a shared stream helper that handles errors before and after headers:
destroy or end the response on a post-header source failure, destroy the
source stream, and ensure the error path cannot leave the destination open.
Add failure-injection tests for both GCS and local streams covering errors
before headers, after partial data, and successful completion.

## Prior findings and project-task reconciliation

The existing `docs/bug-audit-report.md` was treated as seed evidence, not as a
source of duplicate findings:

| Existing finding | Current status in this report |
|---|---|
| F-001 — completed PDF jobs outlive access | Not repeated; the PDF progress/download authorization gap remains the prior finding |
| F-002 — label scans trust caller-supplied pin IDs | Not repeated; the current route audit confirms it and the project backlog now has “Secure label scan ownership” |
| F-003 — removed collaborators can edit old comments | Not repeated; the backlog now has “Protect comment updates after revocation” |
| F-004 — offline photo uploads do not retry | Not repeated; the backlog now has “Recover offline photo uploads” |
| F-005 — uncertain entry writes replay as duplicates | Not repeated; this audit does not inspect the offline implementation as a new route finding |
| F-006 — photo metadata propagation is not atomic | Not repeated; the backlog now has “Make photo propagation atomic” |
| F-007 — session validation failures return 500 | Not repeated; the backlog now has “Return actionable session errors” |

The older object-storage route security work is also reconciled. The
`/objects/{*objectPath}` alias now requires authentication and approval and
redirects only the `/objects/uploads/` namespace to the ownership-enforcing
`/uploads/:filename` route. The retired presigned upload endpoint returns 410.
Those changes are not reported again. API-003 is different: it concerns the
restore route's ability to register an arbitrary key as a new photo record.

The existing request-body hardening task covers generic missing-body handling
and typed request migration. It does not establish cross-session ownership for
validly shaped foreign IDs, so it does not subsume API-001. The database
integrity task proposes individual foreign keys and cascades; those constraints
likewise do not prove that independently stored session IDs agree, so API-001
remains a route/data-boundary finding.

## Confirmed passes

- The global `/api` middleware is deny-by-default for unauthenticated and
  unapproved requests, with only the documented identity, pageview, and health
  exemptions.
- Administrator routes use the persisted local admin boundary. The
  capability update route rejects unknown keys and non-boolean values.
- Session, photo, entry, pin, scan-result, review, collaboration, invite-link,
  activity, and comment read routes generally resolve the parent resource and
  call `verifySessionAccess` before returning data.
- The normal session photo registration route uses Zod body validation,
  session-derived ownership fields, and the existing atomic registration
  helper.
- Normal photo, pin, entry, review-response, collaborator, invite-link, and
  export handlers use stable non-disclosing not-found responses for resources
  outside the caller's session.
- Scan requests are rate-limited, crop batches are bounded, provider errors are
  normalized, and scan persistence failures have an explicit response helper.
- PDF job access revocation, scan pin ownership, comment revocation, offline
  photo retry, uncertain entry replay, photo propagation atomicity, and session
  creation error classification were reviewed as existing findings rather than
  duplicated.
- The standard validation tier passed without a new failure and the dependency
  and storage-key checks did not produce a new route finding.

## Deferred candidates

These candidates were inspected but are not counted as verified findings in
this report:

- The global error handler in `server/index.ts:211-221` returns
  `err.message`. Route handlers reviewed in scope normalize their own
  operational errors, and no route-specific sensitive message exposure was
  demonstrated. A dedicated error-injection audit should test parser,
  multipart, database, and provider errors at the global boundary.
- Several list endpoints support an optional `limit`/`offset` but do not
  impose a common maximum. The application intentionally supports full
  session list responses when pagination is omitted; a performance finding
  needs scale data or failure-injection evidence before changing that
  contract.
- Provider-specific object-storage internals, Clerk proxy internals, and
  server lifecycle behavior were excluded except where needed to trace the
  route contracts above.
- Frontend-only behavior, visual behavior, export layout, and browser-provider
  setup were outside this server route audit.

## Recommended remediation order

1. Fix API-001 first because an authorized editor can create cross-session
   relationships and the pin-delete path can delete a foreign entry.
2. Fix API-002 next to restore the account-level AI usage and privacy boundary.
3. Fix API-003 next so photo restore cannot rebind a private storage object
   without an ownership proof.
4. Fix API-004 after the security boundaries to prevent storage failures from
   tying up clients and server connections.
5. Add negative route tests for each finding, including cross-session IDs,
   capability combinations, unknown/foreign upload keys, and injected stream
   failures.

## Report-only stop

This audit stops at the report phase. No product behavior, source code, tests,
migrations, configuration, dependencies, secrets, account data, or external
service data was changed. The four findings above are ready for separate
approved fix tasks.