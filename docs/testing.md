# E2E Testing Guide

## Overview

Master Reel Counter uses [Playwright](https://playwright.dev/) for end-to-end tests. The suite exercises complete user journeys through the real UI backed by the dev server and database, making it effective at catching integration-level bugs — particularly the class of "feature X wired for path A but not path B."

## Prerequisites

- Node.js 18+
- A running PostgreSQL database (same as dev)
- At least one Replit Auth login on the dev instance so the seed endpoint has an owner user to configure

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
npx playwright test tests/undo-redo.spec.ts
```

### 4. Run tests matching a tag

All specs are tagged with `@<feature>` labels (e.g. `@undo`, `@scan`, `@mobile`):

```bash
npx playwright test --grep "@undo"
npx playwright test --grep "@mobile"
```

### 5. View the HTML report

```bash
npx playwright show-report
```

## Authentication Setup

Tests seed the tester password for the first owner account, then authenticate as the real owner through the dev-only `/api/__test__/owner-login` endpoint. This keeps CRUD and trash cleanup permissions available to the full suite. The global setup script (`tests/global-setup.ts`) saves that session cookie to `tests/.auth/user.json`.

**Important:** you must log in to the app at least once via Replit Auth before running tests, so the seed endpoint has an owner user to configure.

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
await page.click('[data-testid="button-tester-login"]');
await expect(page.locator('[data-testid="dialog-logout-guard"]')).toBeVisible();
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
  global-setup.ts      # Seeds tester password + logs in once before all tests
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


## Failure Gate validation

Task plans are created with `npm run new-plan -- --name <slug> --why
"<reason>"`. Before editing, record exact pre-existing failures in
`docs/validation/failure-baseline.json` only when an active, unexpired record
matches the suite, test, and signature. A passing retry means intermittent,
not pre-existing.

Run the tier locked by the plan:

```bash
TASK_PLAN_FILE=.local/tasks/<name>.md node scripts/run-locked-tier.mjs
```

The registered tiers are `test-light`, `test-standard`, and `test-heavy`.
Task validation cannot be escalated above the plan. Completion validation is a
separate platform check. Missing, malformed, unreadable, or mismatched plans
fail before any suite starts. An ad-hoc caller must opt in explicitly with
`node scripts/run-tier.mjs test-standard --allow-no-plan`.

The plan guards run as an auto-remediate plus strict pair. `--fix-stub` adds
structure only; the strict pass still requires a real tier, rationale,
ownership, and exact baseline resolution. Archive inspection is opt-in with
`node scripts/check-failure-gate.mjs --archive`. Baseline review and stale
verification reporting is opt-in with `npm run maintain:validation-baseline`.

The Failure Gate capability map is maintained in
`docs/validation/failure-gate-capabilities.md`. Add future suites and tiers to
`.agents/skills/validation-tiers/tiers.json`, with a contract test, rather
than adding runner-specific branching.
## Canonical validation tiers

The tracked source of truth is `docs/validation/manifest.json`. Each tier is
registered as an on-demand validation command and acquires one resource-aware
lock before running its steps. The timeout budget begins after lock acquisition,
so queue time is reported separately from test duration.

| Tier | Scope | Post-lock budget |
|---|---|---:|
| `npm run test-fast` | TypeScript and storage-key lint | 3 minutes |
| `npm run test-standard` | Fast checks, unit tests, and manifest parity | 5 minutes |
| `npm run test-standard-plus` | Standard checks plus lock, cleanup, and resource-isolation tests | 7 minutes |
| `npm run test-heavy` | Startup, high-severity audit, schema check, all static/unit checks, collision checks, and Playwright | 15 minutes |

Do not run tier scripts inside another tier step. The public tier command owns
the lock; inner commands are deliberately unwrapped to avoid double-locking.
