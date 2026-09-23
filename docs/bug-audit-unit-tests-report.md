# Bug & Error Audit Report

**Scope:** The `test:unit` command, all six directly selected suites, and the
`unit-tests` step in the `test-standard` validation tier.
**Mode:** Audit-and-fix
**Audit date:** 2026-09-23
**Validation ceiling:** `test-standard`
**Product behavior changed:** No

## Summary

| Status | Count |
|---|---:|
| Resolved | 2 |
| Open | 0 |

| # | Severity | Category | Status | One-line description |
|---|---|---|---|---|
| F-001 | High | Dead / unreachable code | Resolved | PATCH tests now execute the production `registerRoutes()` middleware and handlers with real database fixtures |
| F-002 | Medium | Concurrency & shared state | Resolved | Photo-deletion cases now create independent fixtures and clean them up in `finally` blocks |

## Findings

### Finding F-001 — Advertised real-server PATCH integration is never executed — Resolved

- **File and line:** `server/__tests__/routes.test.ts:1158-1201,1562-1663,2017-2070`
- **Category:** Dead / unreachable code
- **Severity:** High
- **Risk:** The file's comments describe real-server integration that is supposed
  to call the actual `registerRoutes()` handlers, authenticate through the
  `__test__` endpoint, create real database entities, and verify malformed
  PATCH requests. In the selected suite, the only PATCH integration tests call
  `buildTestApp()`, which reimplements the expected `safeParse` handlers in a
  fresh Express app. The later `DEV_SERVER`, `devServerReachable()`, and
  `devReq()` helpers are defined but never referenced by a test. A production
  regression that removes the validation middleware, mounts the wrong route, or
  changes parser/auth middleware ordering can therefore leave all 108 unit
  tests green while the real endpoint returns a 500 or accepts invalid input.
  The standard run reported zero skipped tests, so this missing coverage is
  silent rather than an explicit skip.
- **Resolution:** The synthetic Express app was replaced with a test context
  that invokes `registerRoutes()` on a real HTTP server. Clerk's branded test
  auth object exercises the production authentication and approval middleware,
  while controlled auth-storage records and real session/photo/pin/entry rows
  keep the test independent of the local auth migration state. The tests cover
  malformed and valid PATCH requests for photos, pins, pin flags, and entries.

### Finding F-002 — Photo deletion assertion is order-dependent — Resolved

- **File and line:** `server/__tests__/photo-delete.test.ts:91-164`
- **Category:** Concurrency & shared state
- **Severity:** Medium
- **Risk:** The `photo row no longer exists` test does not invoke
  `executePhotoDeletion`; it only queries the row created by the suite's
  `before` hook and assumes the preceding `resolves without throwing` test has
  already deleted it. Running that test by name, filtering the preceding test,
  or changing test scheduling makes the assertion fail even when the deletion
  implementation is correct. This was reproduced with
  `node --import tsx/esm --test --test-name-pattern='photo row no longer exists' server/__tests__/photo-delete.test.ts`:
  the deletion test was filtered out and the row assertion failed because the
  fixture row still existed. The full command currently passes because Node
  runs these tests in the present order.
- **Resolution:** Each database-backed photo-deletion case now creates a
  per-test session and photo with a unique identity. The deletion assertion
  explicitly invokes `executePhotoDeletion` for its own row, and fixture cleanup
  runs in `finally` blocks. Fixture creation also cleans up partially-created
  sessions when setup fails.

## Unit-test inventory and standard-tier integration

`package.json:16` selects these six suites:

1. `server/__tests__/routes.test.ts`
2. `server/__tests__/photo-delete.test.ts`
3. `server/__tests__/support-ops.test.ts`
4. `server/__tests__/poe-provider.test.ts`
5. `server/__tests__/integrity-release-schema.test.ts`
6. `scripts/__tests__/dev-supervisor.test.mjs`

`docs/validation/manifest.json:20-26` invokes the command as the
`test-standard` `unit-tests` step after typecheck and storage lint. The tier
also runs the Clerk release contract, Vite HMR tests, and manifest-parity
check. Its post-lock budget is enforced by the surrounding serial-lock
process; no timeout finding was recorded for the tier runner.

The suite-specific review covered:

- PostgreSQL schema creation, migrations, isolated pools, fixture teardown, and
  pool closure in the routes, photo deletion, and release-schema suites.
- Async server startup/closure, upstream timeout handling, SSE completion, and
  auth-storage/environment restoration in the routes suite.
- Environment restoration and provider failure assertions in the Poe suite.
- Owner-boundary and port-scanner assertions in the support-operations suite.
- Child-process startup, crash restart, signal cleanup, and port release in the
  development-supervisor suite.

## Tooling signals (Phase 0)

- **Typecheck:** Passed (`npm run typecheck`).
- **Storage lint:** Passed (`npm run lint:storage`).
- **Unit tests:** Passed in the required tier: 120 passed, 0 failed, 0
  skipped.
- **Standard tier:** Passed all steps, including the Clerk release contract
  (41 + 9 tests), Vite HMR tests (3 tests), and manifest parity.
- **Dependency audit:** Not run; it is outside the task's `test-standard`
  validation ceiling and out of scope for this unit-test audit.
- **Task-local baseline note:** The plan-mode run was blocked before any
  validation step by a serial-lock file write error. The required current
  `npm run test-standard` run acquired the lock after reclaiming a dead holder
  and completed successfully; no suite failure was observed.

## Deferred / not audited

This report does not audit browser, release, startup, dependency-audit,
collision, or full application behavior beyond the direct `test-standard`
integration. No production code, validation configuration, migrations,
dependencies, or secrets were changed.

Both findings were fixed within this task and verified by the focused suites,
`test-fast`, and `test-standard`.