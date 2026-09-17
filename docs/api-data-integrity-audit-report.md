# API Data-Integrity Audit Report

**Scope:** API persistence and storage boundaries: Express route inputs,
PostgreSQL/Drizzle reads and writes, foreign-key relationships, transactions,
object-storage registration and cleanup, encryption boundaries, ownership
checks, deletion, restoration, duplication, and persisted admin data.

**Mode:** Report-only  
**Audit date:** 2026-09-16  
**Validation ceiling:** `test-standard`  
**Product behavior changed:** No

## Summary

The audit traced the API from authenticated route parameters and request bodies
through storage methods and schema constraints. Session access checks are
present on most resource entry points, but several resource relationships are
only checked for global row existence. The database therefore accepts
cross-session associations that the API later treats as trusted, including one
path that can delete another session's entry.

| Severity | Current new findings |
|---|---:|
| Critical | 1 |
| High | 4 |
| Medium | 3 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | Critical | Security / data integrity | `server/routes.ts:2233-2262,3039-3053`; `server/storage.ts:635-637`; `shared/schema.ts:167-170` | A pin can be linked to a foreign entry and later delete that entry |
| F-002 | High | Tenant isolation / data integrity | `server/routes.ts:1866-1884,1567-1634,6352-6369,1747-1808`; `shared/schema.ts:104-140,267-283` | Caller-supplied relationship IDs can cross session boundaries |
| F-003 | High | Object-storage ownership | `server/routes.ts:1533-1556,1747-1819`; `server/storage.ts:500-525`; `shared/schema.ts:491-499` | Photo registration and restore trust arbitrary object keys and resolve intents globally |
| F-004 | High | Atomicity / recovery | `server/storage.ts:1291-1387`; `server/routes.ts:1403-1439` | Session duplication can leave a visible partial copy after a later write fails |
| F-005 | High | Security / persisted admin data | `server/routes.ts:6509-6535` | Any authenticated user can list all persisted feedback |
| F-006 | Medium | Encryption / availability | `server/routes.ts:5154-5164,5170-5182,3321-3348` | Shared-session exports decrypt with the requester key instead of the session owner key |
| F-007 | Medium | Encryption / search integrity | `server/routes.ts:1498-1508`; `server/storage.ts:1408-1464` | Encrypted-entry search uses the requester's encoding setting |
| F-008 | Medium | Atomicity / state integrity | `server/storage.ts:1226-1263` | Folder trash and restore use multiple independent writes |

The findings are distinct from the current findings in
`docs/bug-audit-report.md` and from proposed remediation tasks listed in the
task catalog. A carried-forward finding and tracked findings are reconciled
below rather than counted as new duplicates.

## Phase 0 — Persistence and boundary map

### Stack and relevant storage surfaces

- **Backend:** Express with TypeScript route handlers and Drizzle ORM.
- **Database:** PostgreSQL through the module-global Drizzle client in
  `server/db.ts`; transactions are available but storage methods do not
  automatically inherit a caller's transaction handle.
- **Object storage:** Replit Object Storage through the Google Cloud Storage
  client, with a local `uploads` fallback. Photo rows store
  `objectStorageKey`; upload intents track direct-upload files until
  registration.
- **Encryption:** AES-256-GCM field encryption for selected entry columns,
  with per-user wrapped data keys in `user_settings`.
- **Authorization:** `verifySessionAccess` checks live session ownership or
  collaborator membership. Role and lock checks protect most mutations.
- **Persistence domains:** sessions and folders; photos, pins, and entries;
  comments, activity, review responses, scan results, dismissed duplicates;
  collaborators and invite links; user settings/catalogs; feedback; upload
  intents.

### Flow inventory

1. **Session and folder lifecycle:** session rows are soft-deleted and later
   permanently removed; folder trash unlinks sessions and stores a
   `trashedFromFolderId` snapshot for restoration.
2. **Photo upload and registration:** direct upload writes the object first,
   then creates an `upload_intents` row. Photo registration inserts a row in
   `atomicCreatePhoto`, assigns a server filename, and deletes the matching
   intent inside the transaction.
3. **Photo and entry relationships:** photos point to sessions and optionally
   parent photos; entries point to sessions and optionally photos; pins point
   to photos and optionally entries. These are separate foreign keys rather
   than composite session-consistency constraints.
4. **Mutation propagation:** photo and entry metadata propagation opens
   transaction callbacks, but several calls inside those callbacks use
   storage methods backed by the global `db`.
5. **Deletion and cleanup:** photo deletion uses a DB cascade transaction
   before best-effort object deletion. Expired-session cleanup checks object
   sharing before deleting files and then deletes the session. Upload-intent and
   legacy-orphan jobs delete unregistered or unreferenced objects.
6. **Encryption:** entry writes use the session owner's key; ordinary reads
   correctly use the owner key for collaborators. Export and search paths use
   requester settings inconsistently.
7. **Background and copy operations:** session duplication copies rows one
   table at a time and optionally copies object files. The copy callback can
   fall back to the original key, while the database copy itself has no
   encompassing transaction.

## Evidence and validation

The failure baseline catalog was empty before validation:

```json
{"schemaVersion":1,"records":[]}
```

The required command was run with the assigned task plan:

```text
TASK_PLAN_FILE=.local/tasks/task-757.md npm run test-standard
```

The validation runner repaired and passed the plan/guard stubs, then waited
briefly on the shared `validation` serial lock held by another process. The
tier subsequently completed successfully. All seven registered standard-tier
steps passed:

```text
[validation] PASS: typecheck
[validation] PASS: storage-lint
[validation] PASS: unit-tests
[validation] PASS: clerk-release-contract
[validation] PASS: vite-hmr-tests
[validation] PASS: failure-gate-parity
[validation] PASS: manifest-parity
[validation] PASS: test-standard completed.
```

The initial lock wait was validation-harness contention, not a product
failure. No standard-tier failure was recorded.

The source and focused tests were inspected without modifying them. No
application source, schema, migration, test, configuration, dependency,
storage object, or database data was changed.

## Phase 1 — Category passes

1. **Null / undefined safety:** No new null dereference was promoted. The
   strongest risks were relationship IDs that are syntactically valid but
   belong to another session.
2. **Async and timing:** Session duplication and folder lifecycle have
   multi-statement failure windows. Object-storage rollback and
   check-then-delete races remain deferred because live provider failure
   injection was not performed.
3. **Error handling:** Existing scan persistence has an explicit retryable
   response. Duplicate-session failures return 500 after partial writes
   without identifying or cleaning the incomplete copy.
4. **Type safety:** TypeScript and standard-tier type checks are applicable;
   request bodies still use broad types at several persistence boundaries.
   The findings below are runtime contract defects, not typecheck failures.
5. **State and data integrity:** F-001, F-002, F-004, and F-008 were verified
   from route-to-storage-to-schema traces. The prior photo-propagation issue
   remains current but is reconciled as tracked work.
6. **Security:** F-001, F-003, and F-005 cross an entry, object, or persisted
   tenant-data boundary.
7. **Performance:** No new verified performance defect was found in the
   selected persistence paths.
8. **Concurrency and shared state:** The photo propagation transaction
   boundary and separate folder writes were confirmed. Atomic photo
   registration and draft-pin replacement were observed as controls.
9. **Dead / unreachable code:** No dead branch was promoted from inspection.
10. **Dependency hygiene:** Dependency results belong to the separate
    dependency audit task; no dependency finding is included here.

## Findings

### Finding F-001 — A foreign pin entry can be deleted through the pin API

- **Severity:** Critical
- **Category:** Security / data integrity
- **Location:** `server/routes.ts:2233-2262,3039-3053`;
  `server/storage.ts:635-637,912-917`; `shared/schema.ts:167-170`
- **Failure scenario:** An editor who can write session A submits a valid
  entry ID from session B in `PATCH /api/pins/:id`. The route authorizes the
  pin by following `pin.photoId` to session A, then copies the caller's
  `entryId` into `safeUpdate` without loading or comparing the target entry's
  session. If the editor subsequently deletes that pin, the delete handler
  calls `storage.deleteEntry(pin.entryId)`, which deletes by global entry ID.
  Session B's inventory entry is therefore deleted even though the caller has
  no access to session B.
- **Evidence:** `patchPinSchema` accepts `entryId` at
  `server/routes.ts:572-583`; the patch route writes the allowed field at
  `2233-2262`. The delete route unconditionally deletes the linked entry at
  `3039-3053`, and `DatabaseStorage.deleteEntry` uses only
  `eq(entries.id, id)` at `server/storage.ts:635-637`. The schema's
  `pins.entryId` foreign key only requires that the entry exists
  (`shared/schema.ts:167-170`); it does not enforce matching
  `pins.photo_id`, `entries.photo_id`, or session ownership.
- **Impact:** A caller with a valid session-A editor role can cause destructive
  cross-session data loss if a foreign entry ID is known or guessed.
- **Recommended fix:** Before accepting a non-null `entryId`, load the entry
  and require its session to match the pin photo's session. Make the delete
  operation session-scoped or perform the relationship validation and delete
  in one transaction. Add a negative test that links a session-B entry to a
  session-A pin and verifies that both patch and delete are rejected without
  deleting session B's row.
- **Confirmed controls:** Pin lookup and photo-to-session access checks are
  present. The foreign-key constraint prevents a nonexistent entry ID, but
  that is not a tenant-boundary check.

### Finding F-002 — Caller-supplied resource IDs can create cross-session associations

- **Severity:** High
- **Category:** Tenant isolation / data integrity
- **Location:** `server/routes.ts:1567-1634,1747-1808,1866-1884,6352-6369`;
  `server/storage.ts:557-562,627-632,1837-1855`;
  `shared/schema.ts:104-140,267-283`
- **Failure scenario:** An authorized editor of session A can submit valid
  global IDs that belong to another session. The entry-create route spreads
  the body into `insertEntrySchema` and only overwrites `sessionId` and
  `userId`; a caller-supplied `photoId` is not checked against session A.
  Photo patch accepts `parentPhotoId`, loads that row, and copies its aisle or
  section without requiring the parent to share the child's session. Comment
  creation similarly accepts `entryId`, `photoId`, and `parentCommentId`
  after authorizing only the route session. The photo-restore path also
  preserves caller-supplied entry and parent relationships except for the
  narrow old-photo ID remapping.
- **Evidence:** Entry creation at `server/routes.ts:1866-1884` parses the
  body after adding the route session, with no `photoId` ownership query.
  Photo parent inheritance at `1567-1634` calls `storage.getPhoto` on the
  submitted ID and then updates the target photo and entries. Comment
  creation at `6352-6369` inserts the submitted IDs directly. The schema
  defines independent foreign keys for these columns but no composite
  session-consistency constraints (`shared/schema.ts:104-140,267-283`).
- **Impact:** Rows can be valid to PostgreSQL while representing data from
  different tenants or sessions. Later photo deletion, propagation, export,
  comments, and relationship queries can expose or mutate the wrong
  session's metadata and inventory relationships.
- **Recommended fix:** Resolve every caller-supplied parent ID server-side and
  require the target row's session to equal the authorized route session.
  Apply the same check to restored entries, restored pins, photo parents,
  comment attachments, and any future relationship fields. Add composite
  database constraints or transaction-local checks where PostgreSQL can
  enforce the invariant.
- **Confirmed controls:** Route-level session access and role/lock checks
  protect the target route resource. Foreign keys reject missing IDs. Neither
  control proves same-session ownership.

### Finding F-003 — Photo registration trusts arbitrary object-storage keys

- **Severity:** High
- **Category:** Object-storage ownership
- **Location:** `server/routes.ts:1533-1556,1747-1819`;
  `server/storage.ts:500-525`; `shared/schema.ts:491-499`
- **Failure scenario:** A caller with edit access to session A submits an
  object path belonging to another user's direct upload or an existing object
  instead of the path returned by their own upload. Photo registration accepts
  the string and inserts a photo row for session A. `atomicCreatePhoto`
  resolves any matching upload-intent row by object path alone, without
  checking `upload_intents.user_id`. The restore endpoint accepts the same
  arbitrary key without requiring an upload intent at all. If the key is
  known, the registered object is served through the new session's authorized
  photo route, creating an object-rebinding and possible cross-tenant read
  path.
- **Evidence:** `insertPhotoBodySchema` permits `objectStorageKey` as a
  non-null text field and the registration route passes it through at
  `server/routes.ts:1543-1556`. `atomicCreatePhoto` deletes
  `upload_intents` using only `objectPath` at `server/storage.ts:522-525`.
  The intent table does store `userId`, but the resolution method does not use
  it (`shared/schema.ts:491-499`, `server/storage.ts:2775-2783`). Photo
  restore builds `safePhotoData.objectStorageKey` directly from the request
  at `server/routes.ts:1756-1775`.
- **Impact:** A leaked or discoverable object path can be rebound into an
  authorized session and served as that session's photo. A registrant can also
  consume another user's pending intent, causing that user's later cleanup or
  registration assumptions to diverge.
- **Recommended fix:** Make object registration server-owned: require a
  matching intent owned by the authenticated user, validate its canonical
  path, and consume it with an owner predicate in the same transaction as
  photo insertion. Apply the same proof to restore, or use a server-issued
  restore token tied to the original row and caller.
- **Confirmed controls:** Direct upload itself is authenticated, rate-limited,
  MIME-filtered, size-limited, and uses random object IDs. Those controls do
  not protect a later endpoint that accepts an arbitrary key.

### Finding F-004 — Session duplication is not atomic

- **Severity:** High
- **Category:** Atomicity / recovery
- **Location:** `server/storage.ts:1291-1387`;
  `server/routes.ts:1403-1439`
- **Failure scenario:** The duplication endpoint creates the destination
  session, then copies photos, entries, pins, comments, scan results, and
  dismissed-duplicate rows through independent global-DB operations. If a
  later insert fails because of a database outage, constraint problem, or
  process interruption, the earlier destination rows remain. The route
  returns 500, so retrying creates another destination and can leave multiple
  partial copies. Object-copy failures are also swallowed by the callback and
  may cause the duplicate to share the original storage key.
- **Evidence:** `duplicateSession` inserts `countingSessions` at
  `server/storage.ts:1295-1301`, then performs the child writes through
  `1387` with no enclosing transaction. The route only catches the final
  error and returns 500 at `server/routes.ts:1436-1439`; it has no cleanup or
  idempotency key. The copy callback catches storage-copy errors and returns
  the original key at `server/routes.ts:1425-1434`.
- **Impact:** Users can see incomplete sessions after a failed duplicate and
  cannot distinguish them from valid copies. A retry can multiply partial
  records; a later cleanup or edit may operate on a copy missing part of the
  original inventory.
- **Recommended fix:** Use one transaction for the relational copy and an
  explicit durable object-copy state machine or compensating cleanup for
  storage files. Do not silently convert a failed object copy into a shared
  reference unless that behavior is an explicit, tested product contract.
  Add failure-injection and retry tests that assert no partial destination
  remains after a failed copy.
- **Confirmed controls:** The route checks source access and target-folder
  ownership. Foreign-key cascades can clean a partial destination only after
  it is identified and deleted; they do not make the copy atomic.

### Finding F-005 — Authenticated users can list all persisted feedback

- **Severity:** High
- **Category:** Security / persisted admin data
- **Location:** `server/routes.ts:6509-6535`; `server/storage.ts:2448-2455`
- **Failure scenario:** `GET /api/admin/feedback` requires only
  `isAuthenticated`. Any authenticated user can call it and receive recent
  feedback submitted by all users. The response removes `userId`, but the
  topic, message, page, and timestamps remain available. The adjacent
  `GET /api/feedback` route correctly uses `ownerOnly`, which makes the
  missing guard on the `/api/admin/feedback` alias a distinct authorization
  defect.
- **Evidence:** `server/routes.ts:6509` applies `ownerOnly` to
  `/api/feedback`; `server/routes.ts:6523` applies only `isAuthenticated` to
  `/api/admin/feedback` and calls the unfiltered `storage.listFeedback()`.
  The storage method returns all rows ordered by date at
  `server/storage.ts:2448-2455`.
- **Impact:** A normal approved account can read other users' support
  messages, which may contain operational details or personal information.
- **Recommended fix:** Apply the same owner/admin capability guard to the
  admin path, or remove the duplicate path and have the client use the
  guarded canonical endpoint. Add authenticated non-owner and owner negative
  and positive tests.
- **Confirmed controls:** Authentication exists, and the canonical feedback
  endpoint is owner-only. The alternate path bypasses that control.

### Finding F-006 — Shared-session exports use the requester encryption key

- **Severity:** Medium
- **Category:** Encryption / availability
- **Location:** `server/routes.ts:3321-3348,5154-5164,5170-5182`
- **Failure scenario:** The owner enables entry encryption and shares a
  session with a collaborator. The normal entry-read route uses
  `access.session.userId` for collaborators, but JSON, Excel, and PDF export
  use `getEncryptionKey(userId)`, where `userId` is the requester. A
  collaborator without the owner's settings receives unreadable/sentinel
  values or an incomplete export despite having valid access to the session.
- **Evidence:** The collaborator-safe read path is at
  `server/routes.ts:1848-1857`. JSON export uses the requester key at
  `5154-5164`; Excel uses it at `5170-5182`; PDF generation uses it at
  `3321-3338`. `decryptEntry` best-effort mode then substitutes
  `[unreadable]` for fields that cannot be decrypted.
- **Impact:** Authorized collaborators can receive exports that silently omit
  or corrupt protected inventory fields, while the same data is readable
  through the normal session endpoint.
- **Recommended fix:** Use the session owner's key for session entry
  decryption in all export paths. Keep requester-specific preferences such as
  units and footer settings separate from the data-decryption key. Add an
  encrypted-owner/shared-collaborator export test for JSON, Excel, and PDF.
- **Reconciliation:** Ownership-transfer encryption continuity is tracked by
  in-progress Task 694 and is not duplicated here; this finding concerns
  exports before or without an ownership transfer.

### Finding F-007 — Encrypted-entry search uses requester state

- **Severity:** Medium
- **Category:** Encryption / search integrity
- **Location:** `server/routes.ts:1498-1508`;
  `server/storage.ts:1408-1464`
- **Failure scenario:** A collaborator searches a session whose owner has
  encryption enabled. The route loads `userSettings` for the requester and
  passes that user's `encodingEnabled` flag to storage. If the collaborator
  has encoding disabled, storage searches encrypted columns with plaintext
  `ILIKE`, producing no matches. If the requester has encoding enabled while
  the session's data is plaintext or mixed, storage searches only aisle and
  section and omits searchable fields that should be available.
- **Evidence:** The route reads requester settings and passes
  `encodingEnabled` at `server/routes.ts:1498-1508`. Storage chooses either
  plaintext-only or all-field SQL conditions at `server/storage.ts:1412-1429`
  and labels the result using the same requester-derived flag at
  `1449-1464`. The session owner is the data-key authority in the entry read
  path, but search does not use the session owner or a session encryption
  state.
- **Impact:** Search results vary by collaborator identity rather than the
  authorized session's data state. Users can miss inventory records without
  an error, undermining data discovery and review.
- **Recommended fix:** Determine encryption/search capability from the
  session owner or a persisted session-level encryption state. If encrypted
  fields must remain unsearchable, make that behavior explicit and return
  consistent metadata; otherwise decrypt in a bounded, owner-key-controlled
  application search path.
- **Deferred qualification:** Product policy may intentionally disable
  encrypted-field search. The current identity-dependent behavior is
  verified; whether it is an accepted limitation should be confirmed before
  implementation.

### Finding F-008 — Folder trash and restore are multi-write operations

- **Severity:** Medium
- **Category:** Atomicity / state integrity
- **Location:** `server/storage.ts:1226-1263`;
  `shared/schema.ts:67-85`
- **Failure scenario:** Folder soft-delete first marks the folder trashed and
  then, in a separate statement, moves its sessions to root while recording
  snapshots. A database interruption between those statements leaves a
  trashed folder with sessions still pointing at it. Restore has three
  independent writes: untrash the folder, relink eligible sessions, and
  clear snapshots for sessions moved elsewhere. An interruption can leave the
  folder live with only some sessions relinked or stale snapshot state.
- **Evidence:** `softDeleteFolder` performs separate updates at
  `server/storage.ts:1226-1239`. `restoreFolder` performs separate updates at
  `1242-1263`. `countingSessions.folderId` uses `ON DELETE SET NULL`, which
  prevents a missing-folder FK but does not make the transition atomic
  (`shared/schema.ts:67-85`).
- **Impact:** Folder and session listings can disagree after a transient
  database failure, and later restore operations may make a different
  relinking decision from the user's last action.
- **Recommended fix:** Wrap each folder state transition in one transaction
  and test failure injection after every statement. Keep the existing
  predicates that avoid overriding an explicit move made while the folder was
  in trash.
- **Confirmed controls:** Route-level owner checks protect folder mutations;
  the FK prevents a permanently deleted folder from leaving a hard invalid
  `folderId`.

## Reconciled existing findings and tracked work

The following current issues were inspected but are not counted as new findings
because they already have an existing report or task:

- **Photo metadata propagation remains broken:** The prior
  `docs/bug-audit-report.md` F-006 is still present. The route updates the
  photo before its propagation transaction, and the callback calls global-DB
  storage methods (`server/routes.ts:1592-1618`,
  `server/storage.ts:557-562,627-632`). This is verified current behavior,
  and proposed Task 785 now tracks making it atomic.
- **Scan pin/photo ownership:** The prior scan mismatch finding remains
  current at `server/routes.ts:2386-2493,2514-2647`; proposed Task 782 tracks
  secure label-scan ownership. It is not duplicated as F-002.
- **Comment edits after revocation:** The prior
  `docs/bug-audit-report.md` F-003 remains current at
  `server/routes.ts:6378-6389`; proposed Task 783 tracks the fix.
- **Offline photo retry and uncertain entry replay:** The prior report's
  F-004 and F-005 are unchanged and are already tracked by the proposed
  recovery/idempotency work. They are client queue findings rather than new
  API storage-boundary findings.
- **Revoked collaborator PDF jobs:** The prior PDF job finding remains
  current at `server/routes.ts:3295-3319` and is tracked by Task 678.
- **Legacy object-key normalization:** The existing legacy-path cleanup risk
  and Task 703 were not duplicated. Cleanup paths still normalize
  `/objects/uploads/` inconsistently; this report focuses on the separate
  ownership proof failure in F-003.
- **Schema validator and migration reports:** Findings in
  `docs/schema-validation-bug-audit-report.md` concern release validation
  and migration tooling, not current API persistence behavior. They were used
  as context and not relabeled here.
- **Storage-key lint report:** Findings in
  `docs/storage-lint-audit-report.md` concern the client-side scanner and
  have no direct API persistence counterpart.

## Confirmed controls and passes

- `verifySessionAccess` gates normal session resource reads and writes and
  respects soft-deleted sessions unless a route explicitly allows trash.
- Mutating session resources generally enforce editor/owner roles and session
  lock state.
- `atomicCreatePhoto` uses a transaction and the
  `(sessionId, registrationKey)` uniqueness contract for normal registration
  retries.
- Draft-pin replacement is transactional; duplicate-label pin creation has
  database-backed conflict handling.
- Review-response creation validates that the target entry belongs to the
  requested session before writing.
- Session deletion uses PostgreSQL foreign-key cascades for session-owned
  children, and photo deletion uses a transaction for its DB-side dependent
  cleanup.
- Encryption uses AES-256-GCM with random IVs, authenticated tags, PBKDF2
  key derivation, and wrapped per-user data keys. The findings are about
  caller/key selection and persistence boundaries, not a break in the
  primitive.
- Direct upload limits memory-backed files to 50 MB, filters image MIME types,
  requires authentication, and records upload intents before reporting
  success.

## Deferred candidates and evidence limits

These candidates were observed but not promoted to verified findings in this
report:

- Actual GCS/local-provider failure injection for upload rollback, photo
  deletion, object-copy, and metadata lookup. The code has best-effort or
  swallowed cleanup branches, but a provider-specific data-loss claim needs
  the failure behavior exercised.
- Concurrent photo registration, deletion, and expired-trash cleanup races.
  The shared-key check and delete are separate operations; a real PostgreSQL
  concurrency probe is needed to establish the impact under the deployment's
  isolation settings.
- Whether a foreign object key can be practically learned in production.
  F-003 is a missing ownership proof at a protected boundary; exploitation
  likelihood depends on key disclosure and is not inferred from random IDs.
- Whether existing production rows already contain cross-session links. This
  task did not inspect production data, as required.
- Whether encrypted-field search is intentionally limited for collaborators.
  F-007 records the identity-dependent behavior; product policy determines
  whether the remediation should be owner-state selection or an explicit
  unsupported-search response.
- Avatar/logo upload rollback and old-object deletion failure behavior. These
  use authenticated user-scoped settings, but provider failure injection is
  required before classifying orphan cleanup as a confirmed data-loss defect.

## Recommended remediation order

1. Fix F-001 immediately because an authorized session editor can cause
   destructive cross-session deletion.
2. Close the shared relationship validation boundary in F-002 and the
   object-key ownership boundary in F-003; add database or transaction-level
   invariants so valid global IDs cannot create invalid tenant relationships.
3. Make duplication atomic and retry-safe (F-004), then protect the persisted
   feedback listing with the existing owner/admin capability boundary (F-005).
4. Correct the encryption key/state selection for exports and search
   (F-006/F-007) so authorized users receive consistent data.
5. Transactionalize folder trash/restore (F-008) and add statement-level
   failure tests.
6. Complete the already tracked work for scan ownership, comment revocation,
   offline recovery, photo propagation, and PDF-job revocation before using
   those paths as evidence of full boundary coverage.

## Report-only stop

This audit stops at the report phase. No API behavior, database schema,
migration, tests, validation configuration, dependency, secret, storage
object, or database data was changed. The eight current findings above are
ready for separate remediation tasks; tracked prior findings remain linked to
their existing work rather than being duplicated.