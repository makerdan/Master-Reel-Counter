# E2E Testing Guide

## Overview

Master Reel Counter uses [Playwright](https://playwright.dev/) for end-to-end tests. The suite exercises complete user journeys through the real UI backed by the dev server and database, making it effective at catching integration-level bugs — particularly the class of "feature X wired for path A but not path B."

## Prerequisites

- Node.js 18+
- A running PostgreSQL database (same as dev)
- At least one Replit Auth login on the dev instance so the seed endpoint has an owner user to configure

### Local PostgreSQL compatibility

The startup smoke check verifies the connected database before starting the
application. It requires an explicit `DATABASE_URL`, the `psql` and `curl`
clients, and a PostgreSQL server whose major version matches the shared GitHub
Actions validation contract (currently PostgreSQL 16).

```bash
DATABASE_URL=postgresql://... bash scripts/startup-smoke.sh
```

Missing connection details, unavailable validation tools, an invalid timeout,
a non-PostgreSQL or unreachable database, incomplete server metadata, and a
PostgreSQL major version mismatch all fail explicitly before the application
boots. CI sets `SMOKE_EXPECTED_DATABASE` to require the validation database
identity. Local or externally managed database mode remains available when
that variable is omitted; it is reported as generic external mode rather than
being treated as the canonical validation target.

Contexts that need endpoint identity can additionally set
`SMOKE_EXPECTED_SERVER_ADDRESS` and `SMOKE_EXPECTED_SERVER_PORT`. Database
connection and compatibility-query work is bounded by `SMOKE_DB_TIMEOUT`
(default 10 seconds), while application readiness is bounded by
`SMOKE_TIMEOUT` (default 20 seconds).

To intentionally upgrade the validation version, update
`SUPPORTED_POSTGRES_MAJOR_VERSION` in
`scripts/lib/github-actions-validation-contract.mjs` and the matching
`postgres:<major>` image in `.github/workflows/validation.yml` together, then
rerun the workflow contract test and the locked validation tier.

## Running the Tests

### 1. Start the dev server (if not already running)

```bash
npm run dev
```

Playwright will start it automatically if not running, but pre-starting it reduces test startup time.

### 2. Run the full suite

```bash
npm run test:e2e
```

### 3. Run a single spec

```bash
npm run test:e2e -- tests/undo-redo.spec.ts
```

### 4. Run tests matching a tag

All specs are tagged with `@<feature>` labels (e.g. `@undo`, `@scan`, `@mobile`):

```bash
npm run test:e2e -- --grep "@undo"
npm run test:e2e -- --grep "@mobile"
```

### 5. View the HTML report

```bash
npx playwright show-report
```

## Authentication Setup

Browser tests authenticate through the configured managed Clerk test account. The global setup script (`tests/global-setup.ts`) saves the resulting browser state to `tests/.auth/user.json`; no tester password or application-managed login exists.

### Custom credentials

Override the test password and base URL via environment variables:

```bash
TEST_TESTER_PASSWORD=my-secret npm run test:e2e
TEST_BASE_URL=http://localhost:5001 npm run test:e2e
```

## Adding New Tests

### 1. Pick a spec file or create one

Group tests by feature area. Use the `@<feature>` tag in the `test.describe` name.

### 2. Import the shared fixtures

```typescript
import { test, expect, createSessionViaApi, createEntryViaApi } from "./fixtures";
```

The `test` fixture provides:
- `sessionId` — a fresh session created before the test and deleted after
- `cleanupIds` — push extra session IDs here for automatic post-test cleanup
- Standard `page` and `request` from Playwright

### 3. Use `data-testid` attributes

All interactive elements in the app carry `data-testid` attributes. Prefer them over text-based selectors for stability:

```typescript
await expect(page.getByTestId("dialog-logout-guard")).toBeVisible();
```

### 4. Skip gracefully when preconditions aren't met

Some tests require photo upload or OpenAI availability. Use `test.skip` for conditional skips:

```typescript
const photo = await uploadTestPhoto(request, sess.id);
if (!photo) {
  test.skip(true, "Photo upload unavailable in this environment");
  return;
}
```

### 5. Mock expensive external APIs

Use `page.route()` to mock AI endpoints so tests never consume real API credits:

```typescript
await page.route("**/api/photos/:id/analyze-labels", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ results: [], skippedPins: 2 }),
  }),
);
```

## Test Coverage Map

| Spec file | Feature tag | What it guards |
|---|---|---|
| `undo-redo.spec.ts` | `@undo` | Undo toast parity: entry vs pin deletion |
| `scan-parity.spec.ts` | `@scan` | Skipped-pin count in per-photo vs session-wide scan toasts |
| `session-cleanup.spec.ts` | `@session-cleanup` | localStorage key hygiene on trash and reset |
| `mobile-layout.spec.ts` | `@mobile` | NetworkStatusIndicator visibility at 390px viewport |
| `review-tab.spec.ts` | `@review` | Reviewer position persistence across hard reloads |
| `offline-queue.spec.ts` | `@offline-queue` | Logout guard dialog when offline queue is non-empty |
| `folder-expand.spec.ts` | `@folder-expand` | Folder auto-expand on create-and-move vs Move-to-Folder |

## File Structure

```
tests/
  .auth/
    user.json          # Saved session cookie (git-ignored)
  fixtures.ts          # Shared test utilities and base `test` fixture
  global-setup.ts      # Logs in through managed Clerk once before all tests
  undo-redo.spec.ts
  scan-parity.spec.ts
  session-cleanup.spec.ts
  mobile-layout.spec.ts
  review-tab.spec.ts
  offline-queue.spec.ts
  folder-expand.spec.ts
playwright.config.ts   # Root-level Playwright configuration
docs/
  testing.md           # This file
```

## CI Integration

The suite is designed to run locally and in the Replit environment without a separate CI pipeline. When you add CI (GitHub Actions etc.), set:

- `CI=true` — enables `forbidOnly` and `retries: 2`
- `TEST_TESTER_PASSWORD` — a secret password distinct from dev
- Ensure the dev server and database are running before `npm run test:e2e`

The repository now includes a read-only GitHub Actions workflow at
`.github/workflows/validation.yml`. It provisions a test PostgreSQL service,
installs Chromium, runs the workflow contract test, and then routes validation
through the canonical `npm run ci` command. See
`docs/validation/github-actions.md` for the local-to-remote coverage table,
private-repository and fork boundaries, manual activation evidence, and
rollback procedure. The workflow file itself is not evidence that GitHub has
run the check or that branch protection requires it.


## Independent workload checks

The previous task-admission tooling has been retired. Historical reports and
plans are under `docs/validation/archive/legacy-failure-gate/`; they are not
current instructions. No replacement gate is installed. The workload commands
below remain available for application diagnostics and CI, not task admission.
## Canonical validation tiers

The tracked source of truth is `docs/validation/manifest.json`. Each tier is
registered as an on-demand validation command and acquires one resource-aware
lock before running its steps. The timeout budget begins after lock acquisition,
so queue time is reported separately from test duration.

| Tier | Scope | Expected run time (excluding lock queue) | Post-lock budget |
|---|---|---:|---:|
| `npm run test-fast` | TypeScript, storage lint, and lint-contract tests | About 25 seconds | 3 minutes |
| `npm run test-standard` | Fast checks, port scan, unit tests, Clerk release contract, Vite HMR, and manifest parity | About 2 minutes 40 seconds | 5 minutes |
| `npm run test-standard-plus` | Standard checks plus serial-lock and port-authority tests | About 3½–4 minutes | 7 minutes |
| `npm run test-heavy` | Standard-Plus, startup/database/schema checks, dependency audit, HMR recovery, collision checks, and browser tests | 5–10 minute target; successful full run not yet measured | 15 minutes |

The Standard-Plus workload includes every Standard step, including the Clerk
release contract. Heavy additionally runs both the regular HMR test and its
recovery variant. Its time range is provisional: recent runs failed at startup
smoke or the high-severity dependency audit, so it is not a passing-duration
measurement.

Do not run tier scripts inside another tier step. The public tier command owns
the lock; inner commands are deliberately unwrapped to avoid double-locking.
