---
name: Managed Clerk release key boundary
description: Why exact-production-origin managed Clerk authentication cannot be fully reproduced with development credentials.
---

An exact production-host release candidate derives a production publishable key from the browser hostname. Replit-managed development supplies a separate test secret, so that candidate cannot authenticate locally even when the proxy wiring is correct. The decisive smoke must run during publishing, where Replit injects the matched production key pair.

**Why:** Treating local 401 responses from an exact production-host candidate as an application defect led to attempts to override Clerk's canonical host-based key selection. Those overrides diverge from managed Clerk and can hide the behavior publishing must verify.

**How to apply:** Keep `publishableKeyFromHost(window.location.hostname, fallback)` canonical. Use local contract and standard-tier validation for release-harness changes, then use the publish build to verify the exact production origin and production proxy. For synthetic users, prefer Clerk's supported ticket sign-in helper over interactive password flows that can acquire client-trust or MFA steps. The ticket helper establishes an active session but may leave the page on `/sign-in`; verify the session first, then navigate explicitly to the authenticated entry page.