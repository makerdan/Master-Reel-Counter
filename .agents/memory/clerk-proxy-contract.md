---
name: Clerk proxy contract
description: Shared path and streaming rules for production Clerk proxy release checks.
---

Production proxying, browser testing-token transport, and release-candidate health probes must derive their path from the shared Clerk configuration.

**Why:** Separate path literals let a release check pass while the production middleware serves a different route. A controlled local upstream catches rewriting, safe headers, response metadata, and stream completion without contacting Clerk.

**How to apply:** Keep proxy path consumers on the shared export. Exercise multi-chunk responses without an upstream `content-length`; reset the timeout per chunk, then preserve the established complete-response contract with a computed length.