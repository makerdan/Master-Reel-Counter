---
name: E2E test auth — run as Admin
description: Playwright global setup needs a real Clerk account with persisted Admin role for full CRUD permissions.
---

## Rule
Playwright global setup must authenticate a real Clerk account whose local account has persisted `Admin` role when creating shared browser storage state.

**Why:** Full browser coverage creates, trashes, and permanently deletes sessions and exercises protected account-management boundaries. An ordinary `User` account cannot cover Admin-only operations, while synthetic authentication bypasses the real Clerk identity path.

**How to apply:**
- Create or reuse a disposable Clerk user through the supported server-side test setup.
- Seed that user's local account with persisted `Admin` role before saving browser storage state.
- Verify the authenticated local identity endpoint before tests begin.
