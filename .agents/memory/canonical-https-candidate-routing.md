---
name: Canonical HTTPS candidate routing
description: How to preserve a production browser origin while routing an unpublished candidate to a local TLS listener.
---

For Clerk release checks, the browser must use the exact production HTTPS origin; forwarded headers or an embedded publishable-key host do not reproduce origin, redirect, proxy-URL, and cookie semantics. Chromium host resolver rules can map the production hostname on port 443 to an unprivileged local TLS proxy on a dynamic high port.

**Why:** Direct HTTPS loopback URLs can be intercepted by the environment's browser networking, and loopback origins do not exercise Clerk's production host behavior. A hostname-and-port resolver rule preserves the browser-visible production URL while keeping traffic bound to the local candidate.

**How to apply:** When validating an unpublished production candidate, issue a temporary certificate for the canonical host, route that host's browser port 443 to the local TLS proxy, and verify a per-build identity through browser-side fetch. Do not use Node-side Playwright request contexts for candidate-bound assertions because they do not inherit Chromium resolver rules.