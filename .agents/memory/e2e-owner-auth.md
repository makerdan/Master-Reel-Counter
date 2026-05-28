---
name: E2E test auth — run as owner
description: The Playwright global-setup must create storageState as the real app owner, not as a tester, to get full CRUD permissions in e2e tests.
---

## Rule
`tests/global-setup.ts` must authenticate as the **owner** (not the tester) to create `tests/.auth/user.json`.

**Why:** Testers have "editor" role on sessions (even their own). The `DELETE /api/sessions/:id` route requires `isOwner(role)` — testers always get 403. This breaks any test that trashes or permanently deletes a session via the browser UI. Similarly, the WS connection registers testers with `testerOwnerUserId` (owner's sub) but HTTP requests use the tester's own sub, creating a 2-user review cohort instead of 1, breaking the review-tab navigation.

**How to apply:**
- Use `POST /api/__test__/owner-login` (dev-only endpoint) in global-setup instead of the tester login form.
- This endpoint is registered inside `if (process.env.NODE_ENV !== "production")` in `server/routes.ts` and is exempt from the `isApproved` middleware via the `skipPaths` array.
- Tests that specifically exercise tester flows (e.g. offline-queue) still call the tester login themselves within the test body.
