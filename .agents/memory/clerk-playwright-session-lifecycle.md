---
name: Clerk Playwright session lifecycle
description: How Clerk testing tokens, saved sessions, logout, and Playwright API fixtures interact in long browser suites.
---

Clerk browser suites must install the official testing-token routing in every new browser context, establish or refresh authentication before each test body, and bind API calls to that same live context. A static storage-state token is not sufficient for a long serial suite.

**Why:** Clerk session JWTs can expire during the suite, route handlers are not preserved in Playwright storage state, and a logout test can revoke the shared saved session. A separate API fixture can also keep using the original stale cookie after the page refreshes successfully.

**How to apply:** Conditionally perform a fresh ticket sign-in when the context is signed out, verify the authenticated user endpoint before entering the test body, and use the browser context's request client for authenticated API setup and cleanup. Tests that intentionally log out must finish registered API cleanup before logout or isolate that browser context from the authenticated cleanup client. Avoid `networkidle` waits because Clerk maintains background session traffic.

When testing rejection of a truly anonymous API write, do not assume a new Playwright API request context is anonymous in this browser harness: one such context unexpectedly resolved to the active test owner. Use an explicitly empty request storage state and confirm /api/auth/user returns 401 before sending protected requests. For a different approved account, create an explicitly empty browser context, sign it in separately, and verify the resolved local identity differs before testing resource access.

**Why:** A supposed negative replay check returned 200 under the owner identity when sent from a fresh Playwright request context; the same POST sent by bare Node fetch returned 401. The suite defaults to saved owner storage state, and its authenticated request fixture aliases the live browser context's request client. A misleadingly authenticated "anonymous" assertion can hide missing authorization coverage.

**How to apply:** Check the actual identity of each request source in browser authorization tests; never infer anonymity solely from context creation.