---
name: Clerk Playwright session lifecycle
description: How Clerk testing tokens, saved sessions, logout, and Playwright API fixtures interact in long browser suites.
---

Clerk browser suites must install the official testing-token routing in every new browser context, establish or refresh authentication before each test body, and bind API calls to that same live context. A static storage-state token is not sufficient for a long serial suite.

**Why:** Clerk session JWTs can expire during the suite, route handlers are not preserved in Playwright storage state, and a logout test can revoke the shared saved session. A separate API fixture can also keep using the original stale cookie after the page refreshes successfully.

**How to apply:** Conditionally perform a fresh ticket sign-in when the context is signed out, verify the authenticated user endpoint before entering the test body, and use the browser context's request client for authenticated API setup and cleanup. Tests that intentionally log out must finish registered API cleanup before logout or isolate that browser context from the authenticated cleanup client. Avoid `networkidle` waits because Clerk maintains background session traffic.