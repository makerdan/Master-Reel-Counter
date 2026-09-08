---
name: Clerk testing through the production proxy
description: How Clerk's supported Playwright testing-token helper must target a proxied production candidate.
---

Configure Clerk's Playwright testing-token helper to intercept the candidate host plus same-origin proxy path, then explicitly forward its Node-side fetch to the local candidate app.

**Why:** The helper only intercepts the configured HTTPS Frontend API pattern, but its internal route fetch does not use Chromium host-resolver rules. A canonical candidate URL alone can silently reach the already-published app instead of the local build.

**How to apply:** Derive the interception target from the verified candidate origin and proxy path. Forward the helper's fetch to loopback while retaining canonical Host and forwarded-protocol headers. Test with a real local server.