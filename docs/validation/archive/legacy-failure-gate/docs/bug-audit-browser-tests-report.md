# Browser-Test Validation Bug Audit Report

**Scope:** `scripts/run-browser-tests.mjs`, the default and Clerk preview
Playwright configurations, global setup/teardown, shared fixtures, the
non-release browser specs selected by the heavy tier, and their validation
integration.
**Mode:** Report-only
**Audit date:** 2026-09-16
**Validation ceiling:** `test-heavy`
**Browser tests, fixtures, auth configuration, and runner code changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 4 |
| Medium | 2 |
| Low | 0 |

| ID | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Cancellation & process lifecycle | `scripts/run-browser-tests.mjs:26-33,84-110` | A cancelled browser child can outlive the runner and temporary database cleanup |
| F-002 | High | Fixture lifecycle & cleanup | `tests/global-setup.ts:88-111,116-142`; `tests/global-teardown.ts:10-32` | Setup failure after fixture creation can leave a disposable Clerk/local user until a later run |
| F-003 | High | Environment gating & false passes | `tests/undo-redo.spec.ts:60-82`; `tests/scan-parity.spec.ts:25-28,65-68,103-106,141-144`; `tests/pin-position.spec.ts:68-71`; `tests/export.spec.ts:36-43,94-101` | Capability failures are converted into green skips for core browser coverage |
| F-004 | High | Network mocking & assertion validity | `tests/scan-parity.spec.ts:57-93,95-131` | The named scan error test returns HTTP 200 and duplicates the skipped-count test |
| F-005 | Medium | Environment-dependent coverage | `playwright.config.ts:20-22,61-69` | Local heavy validation omits all WebKit orientation coverage |
| F-006 | Medium | Shared state isolation | `tests/mobile-photo-upload.spec.ts:482-499` | A mobile test permanently changes the authenticated user's photo settings |

The findings are ordered by severity and then operational impact. No finding
was fixed during this audit.

## Inventory and execution evidence

### Heavy-tier path

- `package.json:32-33` maps `test-heavy` to `scripts/run-tier.mjs`.
- `docs/validation/manifest.json:45-64` defines the heavy tier. It runs
  startup, dependency, schema, workspace-skill, typecheck, storage lint, unit,
  Vite HMR, serial-lock, Port Authority, manifest-parity, collision-smoke, and
  then `node scripts/run-browser-tests.mjs`.
- `scripts/run-browser-tests.mjs:84-105` prepares a release-shaped database and
  invokes the Playwright CLI. It does not add a `--grep`; therefore the default
  Playwright configuration selects every non-`release/**` spec.
- `playwright.config.ts:24-77` selects `tests/**`, excludes only `release/**`,
  runs one worker, uses the persisted Clerk state, and starts or reuses the
  development server.
- The browser run reached the Playwright step and reported `Running 59 tests
  using 1 worker`. It reached test 58 of 59 before the shell execution was
  terminated at the available 300-second command ceiling while processing the
  mobile orientation cases. No Playwright failure summary was emitted.

### Authentication and identity lifecycle

- `tests/global-setup.ts:53-69` waits for the app, requires Clerk and database
  configuration, validates the disposable tenant, and checks Clerk test
  permissions.
- `tests/global-setup.ts:71-111` creates a random Clerk user, records a marker,
  and upserts the corresponding approved Admin local user after schema
  validation.
- `tests/global-setup.ts:116-142` creates a fresh browser context, configures
  Clerk testing, signs in, waits for `/api/auth/user`, and writes
  `tests/.auth/user.json`.
- `tests/fixtures.ts:190-250` installs a testing token for every test and
  re-authenticates when the persisted session is stale. The
  `secondApprovedIdentity` fixture creates and removes a separate Clerk/local
  identity around the test.
- `tests/global-teardown.ts:10-32` removes the marked provider and local
  fixture after the run. `tests/clerk-fixture-cleanup.ts:54-108` also removes
  user-scoped rows before deleting the Clerk user.

### Fixture isolation and cleanup

- `tests/fixtures.ts:18-33,252-277` tracks sessions created through
  `createSessionViaApi` by request context and permanently deletes each tracked
  session in fixture teardown, treating 404 as already clean.
- `tests/session-fixture-cleanup.spec.ts:5-20` specifically verifies that a
  session created in one serial test is removed before the next test.
- `tests/folder-expand.spec.ts:82-93,166-169` cleans folders in `finally`
  blocks. The offline tests restore network state in their cleanup blocks, and
  their custom browser contexts are closed.
- The mobile queue tests use isolated IndexedDB state per browser context, but
  the authenticated API settings are account-scoped rather than session-scoped;
  this is reported as F-006.

### Network, service-worker, and assertion review

- `tests/scan-parity.spec.ts:37-47,75-77,113-115,151-153` mocks the expensive
  label-analysis endpoints. Stable test IDs and visible toast assertions are
  used, but one nominal error case is not actually an error case (F-004).
- `tests/offline-queue.spec.ts:59-148` explicitly installs and controls the
  service worker, and `tests/offline-queue.spec.ts:288-375,377-471` checks
  protected-cache removal, offline responses, public shell caching, and
  handled cache failures.
- `tests/mobile-photo-upload.spec.ts:140-223,379-480` seeds queue records with
  explicit owner identities and verifies that only server-verified prior-owner
  claims are recovered.
- `tests/photo-upload.spec.ts:19-65` simulates lost registration responses by
  committing through a cookie-bearing request and aborting the browser route;
  it then asserts registration-key reuse.
- The external AI and label-analysis mocks are scoped to expensive provider
  boundaries. They are not classified as defects by themselves because the
  tested UI contracts are still exercised.

## Findings

### Finding F-001 — Cancellation can strand the browser process and temporary database

- **File and line:** `scripts/run-browser-tests.mjs:26-33,84-110`
- **Category:** Cancellation & process lifecycle
- **Severity:** High
- **Risk:** The runner starts Playwright with synchronous `spawnSync` and relies
  on the JavaScript `finally` block to drop a temporary database. It has no
  signal handler, process-group management, or explicit child termination
  path. If the outer serial-lock timeout or a user cancellation sends
  `SIGTERM` while Playwright is running, the runner can terminate before the
  `finally` block executes, while a Playwright/browser descendant remains
  alive. The temporary `browser_test_*` database can then remain, and the
  orphaned development server/browser can continue using ports or test state.
  A later validation may reclaim the lock while the old browser work is still
  active.
- **Evidence:** `spawnSync` is the only child-process launch at lines 26-33 and
  95-104; cleanup is only in the normal `finally` path at lines 106-110.
  `run-tier`/serial-lock enforces a post-acquisition timeout around this
  command, so cancellation is a real path even though the run reached the
  browser suite before the command ceiling interrupted this audit run.
- **Recommended fix:** Run the browser process in a managed process group,
  handle `SIGINT`/`SIGTERM` idempotently, terminate the Playwright/browser
  descendants, wait for them to exit, and then drop the temporary database.
  Preserve the original signal/child failure status while reporting cleanup
  failures separately. The cleanup path must also be safe when the database
  creation step completed but Playwright never started.

### Finding F-002 — Setup failure can leave a disposable Clerk fixture behind

- **File and line:** `tests/global-setup.ts:88-111,116-142`;
  `tests/global-teardown.ts:10-32`
- **Category:** Fixture lifecycle & cleanup
- **Severity:** High
- **Risk:** Setup writes the fixture marker at line 96, creates/upserts the
  provider and local identities, and only later launches a browser, configures
  Clerk testing, signs in, waits for the authenticated response, and writes
  storage state. If any later setup operation fails—such as browser launch,
  Clerk setup, sign-in, or the authenticated response—the run has no usable
  storage state and can fail before normal test completion. The marked Clerk
  user and local rows are then left behind until a future invocation happens
  to run setup and clean the previous marker. A failed or abandoned workspace
  can therefore leak disposable provider accounts and database rows.
- **Evidence:** The marker is written before the browser is launched
  (`tests/global-setup.ts:96-99,116`), while cleanup is implemented only in the
  separate global teardown (`tests/global-teardown.ts:10-32`). The setup
  function has no `try/finally` covering fixture creation through storage-state
  generation. The next-run recovery in `global-setup.ts:83-86` confirms that
  this marker is expected to survive some interrupted runs, but it does not
  provide same-run cleanup or a bounded retention guarantee.
- **Recommended fix:** Put fixture creation and storage-state setup under a
  cleanup `try/finally`, retaining the marker until both provider and local
  cleanup succeed. Make teardown idempotent and report a cleanup failure without
  masking the original setup error. Keep the next-run marker recovery as a
  crash-recovery backstop, not the primary cleanup path.

### Finding F-003 — Capability failures become green skips for core coverage

- **File and line:** `tests/undo-redo.spec.ts:60-82`;
  `tests/scan-parity.spec.ts:25-28,65-68,103-106,141-144`;
  `tests/pin-position.spec.ts:68-71`; `tests/export.spec.ts:36-43,94-101`
- **Category:** Environment gating & false passes
- **Severity:** High
- **Risk:** A failed photo upload or pin creation causes the undo, scanner, and
  pin-position tests to call `test.skip` and return. A missing export button
  also calls `test.skip` and returns. In the heavy tier, all scanner parity
  checks can consequently report a green suite with zero assertions about
  scanner behavior, and export regressions can pass by removing the export
  control entirely. These conditions include ordinary route failures such as
  401/403/404/500 responses, not just a deliberately detected unavailable
  external service.
- **Evidence:** `uploadTestPhoto` returns `null` for every non-OK response at
  `tests/fixtures.ts:65-76`; callers convert that result directly into a
  skip. The export tests treat a missing primary control as an allowed skip
  before checking any menu item or download. Playwright reports skipped tests
  separately, but the heavy-tier command does not enforce a zero-skip policy or
  distinguish an environment preflight from a failed product precondition.
- **Recommended fix:** Fail on unexpected HTTP responses and reserve skips for a
  separately verified environment preflight with an explicit, audited reason.
  Make required controls such as export and scanner buttons hard assertions.
  Either fail the heavy tier when required browser capabilities are absent or
  run capability-limited cases in a separately named, non-release validation
  mode whose skipped result cannot satisfy the full browser gate.

### Finding F-004 — The scan error test does not exercise an error path

- **File and line:** `tests/scan-parity.spec.ts:57-93,95-131`
- **Category:** Network mocking & assertion validity
- **Severity:** High
- **Risk:** The test titled `per-photo scan shows a user-visible error when the
  route fails` fulfills the analysis route with HTTP 200 and
  `MOCK_SKIP_PAYLOAD`. It then asserts the skipped-pin toast, not a transport or
  server-error recovery message. The following test repeats the same mocked
  200/skipped-pin journey. A regression in non-2xx handling, JSON error parsing,
  or the UI's failure state can therefore pass the entire scan parity spec.
  The success test similarly does not assert that the mocked route was actually
  requested, so a locally generated toast could satisfy the assertion without
  the network contract being exercised.
- **Evidence:** The route at lines 75-77 explicitly uses `status: 200`; the
  assertion at lines 89-92 searches for `/1\s+skip/i`, which is the success
  payload's metric. Lines 113-130 reproduce that same payload and assertion.
  No route in this spec returns a 4xx/5xx response, and no request counter or
  `waitForRequest` assertion proves that the endpoint was called.
- **Recommended fix:** Change the error case to return a representative 5xx
  or network abort and assert the exact user-visible recovery/error contract.
  Remove the duplicate or give it a distinct contract. For each mocked scan
  flow, await a request matching the endpoint and assert the response payload
  was consumed before checking the toast.

### Finding F-005 — Local heavy validation omits WebKit orientation coverage

- **File and line:** `playwright.config.ts:20-22,61-69`
- **Category:** Environment-dependent coverage
- **Severity:** Medium
- **Risk:** The mobile WebKit project is added only when `CI === "true"` or
  `PLAYWRIGHT_WEBKIT_ENABLED === "true"`. A normal Replit/local
  `npm run test-heavy` therefore runs Chromium desktop, Chromium mobile, and
  the six orientation tests only under mobile Chromium; it does not exercise
  the WebKit device configuration. A browser-specific EXIF/orientation or
  mobile layout regression can pass the required local heavy tier while still
  failing the CI-only project.
- **Evidence:** The conditional project construction is explicit at lines
  61-69. The audited local heavy run enumerated 59 tests and reached the
  `mobile-chromium` orientation cases; no `mobile-webkit` project was enabled.
  The omission is intentional environment gating rather than a browser
  availability failure, so it should be visible in the validation result.
- **Recommended fix:** Make the heavy-tier contract report the project matrix
  and fail or classify the run as environment-limited when required WebKit
  coverage is unavailable. If WebKit is intentionally CI-only because of the
  NixOS browser ABI, document the split in the tier output and keep a
  separately protected CI check for the WebKit cases.

### Finding F-006 — A mobile test mutates shared account settings without restoring them

- **File and line:** `tests/mobile-photo-upload.spec.ts:482-499`
- **Category:** Shared state isolation
- **Severity:** Medium
- **Risk:** The test patches the authenticated Admin user's persistent settings
  to photo quality 65 with receiving and on-floor quality 30. It never reads
  the previous settings or restores them. The default Playwright run uses one
  persisted authenticated identity across tests, so later tests or a rerun
  against a reused release-smoke database can observe altered settings and
  produce order-dependent quality, UI, or settings failures. A failure after
  the patch leaves the mutation in place as well.
- **Evidence:** The only operation in this test is a PATCH with fixed values at
  lines 490-498; there is no `finally` block or compensating PATCH. The
  neighboring default-quality test mocks the GET response, which hides the
  mutation for that case but does not restore the database state for other
  specs or subsequent validation.
- **Recommended fix:** Snapshot the authenticated user's settings before the
  mutation and restore them in `finally`, or use a test-only account/settings
  fixture that is deleted with the rest of the browser fixture. Assert the
  restore response and ensure cleanup runs when the test body fails.

## Tooling signals and classification

- **Plan guards:** Failure Gate and Regression Guard plan checks passed before
  the heavy tier began.
- **Heavy-tier pre-browser steps:** Startup smoke, dependency audit, schema
  check, workspace-skill contract, typecheck, storage lint, unit tests, Vite
  HMR tests, serial-lock tests, Port Authority tests, manifest parity, and
  collision smoke all passed in the required run.
- **Browser step:** The runner created and initialized an isolated temporary
  release-smoke database and Playwright started 59 tests. The command was
  terminated by the shell's 300-second execution ceiling while the final
  mobile orientation tests were running. Because no Playwright summary was
  produced, this is recorded as a validation-harness limitation, not as a
  browser-suite failure or a pre-existing product failure.
- **Dependency/security result:** `npm audit --audit-level=high` passed with no
  vulnerabilities in the required heavy run.
- **Baseline classification:** No browser failure was observed that could be
  matched to a pre-existing failure record. The findings above are static
  harness findings verified against current source and execution wiring.
- **Working tree:** No browser-test, fixture, auth, runner, or configuration
  implementation was changed. This report is the only audit deliverable.

## Deferred / not audited

- No customer, published production, or non-disposable account was used.
- The required run did not reach a Playwright result summary because of the
  command execution ceiling; no retry or heavier tier was started.
- Chromium and local development-server behavior were exercised by the
  heavy run. WebKit, the real Clerk preview-origin configuration, and
  published release behavior were inspected statically but not run as separate
  commands.
- No product behavior, browser spec, fixture, auth setup, Playwright
  configuration, or runner implementation was changed. The six findings are
  deferred to separately approved remediation work.