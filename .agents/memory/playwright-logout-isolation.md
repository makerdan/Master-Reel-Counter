---
name: Playwright logout isolation
description: Why browser tests that destroy sessions must not reuse the suite's saved authentication cookie.
---

Browser tests that exercise a real logout must create a context with an explicitly empty storage state and authenticate that context independently.

**Why:** Contexts initialized from the same saved authentication state reuse the same server-session identifier. Destroying that session in one context invalidates later tests even though their browser contexts are separate.

**How to apply:** For logout or identity-transition tests, start with no cookies or origins, establish a fresh test identity, and close the context in a `finally` block. Keep the shared authenticated fixture for tests that never destroy its session.