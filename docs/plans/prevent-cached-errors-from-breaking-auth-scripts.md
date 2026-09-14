# Tier 2: Prevent cached errors from breaking auth scripts

## What & Why
The worker classifies same-origin JavaScript by suffix and caches responses without checking success or content type; an error response can persist across reloads.

## Evidence
client/public/sw.js caches same-origin .js responses without response.ok/content-type checks. The observed failing Clerk hostname is cross-origin and its TLS failure is NOT caused by this worker. This task addresses a distinct confirmed cache-admission defect affecting same-origin script delivery, including any Clerk script routed outside the excluded /api prefix.

## Done looks like
- Only successful intended application assets enter the static cache; Clerk/auth transport and error/HTML script responses never do.
- Existing invalid/auth script cache entries are safely evicted without touching queued offline work.
- A restored script/network response recovers after an earlier error rather than replaying it indefinitely.

## Out of scope
Not the cause of the current cross-origin TLS failure. No wholesale storage clearing and no duplication of the existing direct-logout protected-cache task.

## Pre-existing failures to ignore
None known at plan time. No authoritative baseline entries exist; observed failures are not authorized ignores.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.

## Validation
**Command:** `test-heavy`
**Why:** Browser, release and lifecycle coverage requires the heavy registered tier.
**Do not escalate:** Run exactly this command. Unrelated failures do not authorize broader work.

## Task-local environment observations
Read-only evidence on 2026-09-11: fast, standard, standard-plus passed; heavy failed before browser execution with incomplete Clerk browser configuration; both newest publishes failed at missing users.role. No approved ignored baseline. Recheck prerequisites before implementation.

## Regression Guard
**Covers:** The worker classifies same-origin JavaScript by suffix and caches responses without checking success or content type; an error response can persist across reloads.
**Test location:** New worker script-cache regressions alongside tests/offline-queue.spec.ts
**What it checks:** Seed a same-origin .js response with HTML or 404, then restore JavaScript and reload; the worker must not retain/replay the failure. Offline IndexedDB records survive upgrade cleanup.

## Steps
1. Constrain static cache admission by application asset ownership, response status/type, and auth-route exclusions; preserve current protected API exclusions.
2. Implement narrowly scoped upgrade cleanup of invalid legacy script entries and regenerate the worker through the canonical build path.
3. Add service-worker browser tests for error/HTML JavaScript, auth-path exclusions, upgrade cleanup, successful app assets, and offline queue preservation.

## Relevant files
- `client/public/sw.js`
- `client/src/main.tsx`
- `tests/offline-queue.spec.ts`

## Durable plan copy
At implementation start, preserve this full task description under docs/plans using its task slug. The user authorized .local/tasks solely as task-submission transport, not as the durable deliverable location.