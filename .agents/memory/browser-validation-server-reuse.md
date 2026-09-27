---
name: Browser validation server reuse
description: Why isolated Playwright validation can fail authorization when the development preview is still running.
---

Browser validation prepares an isolated database, but Playwright can reuse an already running server at the test port. If that server is the development preview connected to a different database, the disposable approved test account is absent there, and protected requests return `pending_approval`. Stop the preview before browser validation and restore it afterward.

**Why:** A locked heavy run passed with the test-owned server, while completion validation reused the subsequently restarted preview server and reported widespread 403 responses for the same browser suite. This is an environment identity mismatch, not a multipart parsing failure.

**How to apply:** For browser validation against an isolated database, ensure the test port is available before starting the tier. Check server ownership and the database target before treating mass authorization failures as application regressions.