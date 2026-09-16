# Bug & Error Audit Report

**Scope:** The `test:unit` command, all six directly selected suites, and the
`unit-tests` step in the `test-standard` validation tier.
**Mode:** Report-only
**Audit date:** 2026-09-16
**Validation ceiling:** `test-standard`
**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Dead / unreachable code | `server/__tests__/routes.test.ts:1158-1201,1562-1663,2017-2070` | The advertised real-server PATCH integration is not registered or executed |
| F-002 | Medium | Concurrency & shared state | `server/__tests__/photo-delete.test.ts:91-164` | The photo-row assertion depends on a preceding test's side effect |

## Findings

### Finding F-001 — Advertised real-server PATCH integration is never executed

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
- **Recommended fix:** Add invoked tests that construct the real route
  registration with controlled auth, database, and storage fixtures, or make
  the existing real-server checks a separately selected suite. If the external
  development server is required, make reachability an explicit failure or
  separate validation mode rather than leaving unused helpers and a claim of
  coverage in the unit suite.

### Finding F-002 — Photo deletion assertion is order-dependent

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
- **Recommended fix:** Make each test self-contained: create and delete its own
  fixture within one test, or move the deletion operation into a shared
  setup helper that each assertion explicitly invokes. Use a unique fixture
  identity per test and retain a teardown assertion that cleanup succeeded.

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
- **Unit tests:** Passed in the required tier: 108 passed, 0 failed, 0
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
integration. No production code, tests, validation configuration, migrations,
dependencies, or secrets were changed.

This audit is report-only. The two findings are deferred for a separately
approved fix task.