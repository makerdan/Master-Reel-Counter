# Task #642: Tier 2: Recover visibly when Clerk cannot start

# Tier 2: Recover visibly when Clerk cannot start

## What & Why
Clerk initialization occurs outside the application error boundary, leaving a loader failure as an unhandled rejection instead of a usable recovery screen.

## Evidence
App.tsx throws missing-key errors at module scope and wraps Application rather than the outer ClerkProvider. Browser logs show repeated unhandled failed_to_load_clerk_js after workflow restart.

## Done looks like
- A missing configuration, blocked script or temporary provider failure shows a safe recovery view rather than an indefinite spinner or runtime overlay alone.
- Retry after recovery loads Clerk and preserves a validated internal return destination.
- Protected content stays inaccessible until both Clerk and local authorization are verified.

## Out of scope
Do not bypass authentication, swallow errors as signed-in success, redesign sign-in, or duplicate identity-bridge recovery already implemented.

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
**Covers:** Clerk initialization occurs outside the application error boundary, leaving a loader failure as an unhandled rejection instead of a usable recovery screen.
**Test location:** New Clerk bootstrap recovery browser spec
**What it checks:** Abort the Clerk script before first load, assert visible safe failure, restore the route and retry successfully; invalid configuration remains blocked and retries do not leak listeners or render protected data.

## Steps
1. Move bootstrap failure handling outside provider-dependent hooks and distinguish terminal configuration errors from retryable transport failures. Handle asynchronous load failures using supported provider lifecycle behavior rather than relying only on a React render boundary.
2. Offer a bounded user-triggered retry or reload with clear text, no infinite polling, no alternate tenant fallback, and no broad browser-storage deletion.
3. Add browser outage/recovery scenarios, missing-key handling, repeated retries and unmount cleanup; verify safe return paths and authorization remain enforced.

## Relevant files
- `client/src/App.tsx`
- `client/src/main.tsx`
- `shared/auth-routing.ts`

## Durable plan copy
At implementation start, preserve this full task description under docs/plans using its task slug. The user authorized .local/tasks solely as task-submission transport, not as the durable deliverable location.

