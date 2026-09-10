---
name: Clerk key resync sessions
description: How to interpret key-mismatch redirect warnings immediately after synchronizing Replit-managed Clerk credentials.
---

After synchronizing Replit-managed Clerk credentials, browser sessions created with the previous development keys can emit an infinite session-refresh redirect warning that says the publishable and secret keys do not match. Do not treat that warning alone as proof that the newly synchronized keys are still mismatched.

**Why:** Existing cookies and open pages retain session state tied to the previous managed credentials. A fresh browser context can load sign-in and begin OAuth cleanly while an older open page continues to emit the warning.

**How to apply:** Restart the application after synchronization, validate sign-in and OAuth initiation in a fresh browser context, and ask affected users to clear the app's site data or retry in a private window before investigating a persistent mismatch.