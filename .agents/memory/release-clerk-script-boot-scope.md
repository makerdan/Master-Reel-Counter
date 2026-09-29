---
name: Release Clerk script boot scope
description: Distinguishing repeated browser script loads from ordinary full-page navigation in release smoke checks.
---

Assert the Clerk browser script contract for each completed main-document boot rather than counting responses over the entire Playwright page lifetime. Keep origin, exact proxy path, successful status, JavaScript MIME type, and one-script-per-boot requirements strict.

**Why:** The release smoke spans protected-entry navigation, a sign-in link, and another full Settings navigation before asserting. A cumulative count treats normal script loads in separate documents as a duplicate bootstrap.

**How to apply:** Associate script responses with successful main-frame document responses, not client-side route transitions. Preserve bounded path-only diagnostics so a future same-boot duplicate can be distinguished from separate reloads without exposing request secrets.