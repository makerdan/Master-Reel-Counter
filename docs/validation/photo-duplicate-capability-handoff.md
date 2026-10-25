# Photo duplication capability repair

## Context

- Approved scope: assigned authorization repair; no new flows or capabilities.
- Classification: material security authorization fix, normal Regression Guard.
- Governing plan: `5b7b81f0-7985-48a0-be6f-cf8ea1f13322`, revision 1.
- Contract identity: the admitted seal records the complete Unified and Regression
  Guard package pins; the source specification is
  `docs/validation/photo-duplicate-capability.spec.json`.
- Pre-implementation `gate:guard -- --tier test-standard`: ADMITTED.
- Validation: bound `test-standard`, including compiler checks and `unit-tests`
  which runs `server/__tests__/routes.test.ts`.
- Separate read-only verification: not selected.

## Requirement map

| Label | Required outcome | Delivery / detecting assertion | Evidence |
| --- | --- | --- | --- |
| R1 | Session creation permission cannot override denied photo management | Production middleware uses explicit case-insensitive matches for session and photo duplication. HTTP duplication matrix covers all four explicit persisted capability combinations, exact denial payloads, uppercase photo URLs, and zero mutation-handler calls on denial. | Corrected boundary passed in run `d1791233-1378-4dbb-ae0d-6f5c8d12c2c9`, unit-tests, account capability route guard. |
| R2 | Session creation and duplication still use session creation permission alone | Same HTTP matrix asserts session routes succeed or deny independently of photo management; optional trailing slash, query string and case variants exercise default Express routing. | Expanded 32-request matrix passed in that same renewed run. |

The original suffix-wide condition would fail R1: with `session_create: true`
and `photo_management: false` it allows the photo mutation handler to execute,
returning 200 instead of the asserted 403. The inverse combination would also
incorrectly deny authorized photo duplication. The guard calls the actual
production middleware with user capabilities returned by the auth-storage
boundary, not a copied capability implementation. Existing production photo
session-access, edit-role and lock checks remain untouched.

## Observed validation and remaining environment failures

The complete assigned `test-standard` run finished **FAIL**, not PASS, in 80.5
seconds. Typecheck, storage lint, port-reference scan and storage-lint contract
passed. Unit tests reported 257 passed and 8 failed; the new authorization case
and existing capability case both passed. Later tier steps were not reached.
The run recorded identical before/after target fingerprints.

Evidence is in `.local/failure-gate-unified/runs/` under these run IDs:

- `80eddcb5-a41b-4b63-846c-961fad423204`: complete required tier.
- `97de8f58-79e5-489d-b796-3ef9e62cc9cb`: isolated network-dependency retry;
  6 passed, 3 failed (installed body parser version and compressed-input crash).
- `8ea1d11c-659b-469f-b3fd-7cb26732c5e9`: isolated tooling-dependency retry;
  15 passed, 5 failed (sandbox installed versions and picomatch fixtures).

Executor classification: these eight failures are pre-existing environment
issues, not authorization regressions. Both isolated files reproduce the failures
without importing `server/routes.ts`. Their tests, manifests and lockfiles are
unchanged by this patch. The root lockfile already requires body-parser 2.4.0 but
the installed copy is 2.3.0; the sandbox lockfile requires Vite 7.3.7 but the
installed copy is 7.3.1. The dependency fixtures execute those installed libraries
directly, so the middleware change cannot alter their results. Retry outcomes
alone are not the provenance evidence. No baseline was added or checks weakened.
Synchronizing installed dependencies to the existing lockfiles is the remaining
validation prerequisite; it is not included as an unrelated dependency change.

The development workflow restarted successfully and the public landing page
rendered. The screenshot browser is unauthenticated, so signed-in UI was not
verified; the backend authorization boundary was exercised by HTTP tests.
The original evidence update occurred after that run and was documentation only;
the later completion-check correction below changes executable sources and
requires renewed validation.

## Completion-check correction

The first completion check identified an additional spelling of the same
photo-duplication bypass: Express matches uppercase `/PHOTOS/` but the general
photo fallback checks lowercase text only. The correction adds a dedicated
case-insensitive photo-duplication matcher, including optional trailing slash,
before the unrelated capability branches. The same admitted scope and normal
guard cover this repair. The HTTP matrix now includes uppercase photo collection
and fully uppercase route variants, all permission combinations, exact denial
payloads and mutation-handler invocation counts. Renewed execution below the
same sealed plan supersedes the original case coverage; the original failed run
is retained rather than described as passing.

Renewed execution uses the same `gate:run -- --tier test-standard` invocation,
task ID and plan path. Its terminal state, snapshot and individual step results
are retained by the task's gate registry and `.local/failure-gate-unified/runs/`.
The known installed-dependency failures remain outside this patch; a repeated
failed suite is not a full-tier pass.

Renewed run `d1791233-1378-4dbb-ae0d-6f5c8d12c2c9` observed passing compiler,
lint and both capability cases, including all 32 requests. Unit tests still
failed in the unrelated dependency suites. The overall recorder state was
INCOMPLETE because the platform removed `exposeLocalhost = true` for port 5001
from `.replit` during the workflow restart. That unrelated generated configuration
change was restored after the run; no executable source changed during or after
it. Neither this recorder state nor the dependency failures are reported as a
full-tier pass. The restarted app served its landing page successfully.
