# Tier 1: Bound WebSocket work before Clerk authentication

## What & Why
Unauthenticated sockets can retain unlimited messages while asynchronous Clerk/local authorization is unresolved.

## Evidence
server/routes.ts:6570-6602 allocates pendingMessages and drains only after authentication; :6645-6650 pushes every incoming pre-auth message without a count/byte cap or deadline. server/websocket-upgrade.ts accepts /ws upgrades before this check.

## Done looks like
- Unauthenticated sockets have explicit bounded message count, aggregate bytes, payload size and auth time.
- Overflow, timeout and disconnect release retained messages/listeners and never run queued operations after close.
- Valid authenticated join, ping and authorization eviction continue working.

## Out of scope
No unrelated realtime protocol rewrite, authorization weakening, load attack on the running service, or duplication of collaborator-revocation tests.

## Pre-existing failures to ignore
None known at plan time. No authoritative baseline entries exist; observed failures are not authorized ignores.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.

## Validation
**Command:** `test-standard`
**Why:** Backend authorization lifecycle tests cover this change; register the focused regression in this tier.
**Do not escalate:** Run exactly this command. Unrelated failures do not authorize broader work.

## Task-local environment observations
Read-only evidence on 2026-09-11: fast, standard, standard-plus passed; heavy failed before browser execution with incomplete Clerk browser configuration; both newest publishes failed at missing users.role. No approved ignored baseline. Recheck prerequisites before implementation.

## Regression Guard
**Covers:** Unauthenticated sockets can retain unlimited messages while asynchronous Clerk/local authorization is unresolved.
**Test location:** server/__tests__/routes.test.ts or a focused imported WebSocket authentication lifecycle suite registered in test-standard
**What it checks:** A controlled never-resolving authentication promise plus many frames cannot increase retained work past limits; timeout and close release resources, and late authentication cannot process messages.

## Steps
1. Set conservative explicit pre-auth limits and a short authentication deadline; stop accepting work and close on overflow or expiry. Bound individual payload size without breaking documented valid messages.
2. Cancel/release pre-auth state on close/error and prevent late auth resolutions from draining a closed socket.
3. Add controlled delayed-auth tests for floods, oversized frames, timeout, disconnect, late resolution, and normal authenticated joins; use fake time or isolated ephemeral ports, not live abuse traffic.

## Relevant files
- `server/routes.ts`
- `server/websocket-upgrade.ts`
- `server/realtime-authorization.ts`
- `server/__tests__/routes.test.ts`

## Durable plan copy
At implementation start, preserve this full task description under docs/plans using its task slug. The user authorized .local/tasks solely as task-submission transport, not as the durable deliverable location.