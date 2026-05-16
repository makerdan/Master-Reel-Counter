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

Tests authenticate as a *tester* user via `/tester-login`. The global setup script (`tests/global-setup.ts`) calls the dev-only endpoint `POST /api/__test__/seed-tester-password` to install a known bcrypt-hashed tester password for the first owner account, then logs in once and saves the session cookie to `tests/.auth/user.json`.

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
