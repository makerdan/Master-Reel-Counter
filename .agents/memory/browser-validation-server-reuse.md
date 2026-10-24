---
name: Browser validation server reuse
description: Why isolated Playwright validation can fail authorization when the development preview is still running.
---

Browser validation prepares an isolated database, but Playwright can reuse an already running server at the test port. If that server is the development preview connected to a different database, the disposable approved test account is absent there, and protected requests return `pending_approval`. Stop the preview before browser validation and restore it afterward.

**Why:** A locked heavy run passed with the test-owned server, while completion validation reused the subsequently restarted preview server and reported widespread 403 responses for the same browser suite. This is an environment identity mismatch, not a multipart parsing failure.

**How to apply:** For browser validation against an isolated database, ensure the test port is available before starting the tier. Check server ownership and the database target before treating mass authorization failures as application regressions.

A previously unmapped smoke-test port can also cause workspace port configuration
to change during a run. An all-source validation fingerprint correctly treats
that as a source change even if application code is untouched.

**Why:** An isolated smoke run added a port mapping while validation was running;
the gate retained INCOMPLETE rather than certifying a changed target.

**How to apply:** Inspect existing port declarations and free-port ownership
before choosing a smoke target. Prefer an already-declared idle test port when
appropriate. Never weaken the fingerprint check; record actual configuration
drift and clean up diagnostic mappings through the supported configuration route.