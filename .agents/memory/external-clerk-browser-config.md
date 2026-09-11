---
name: External Clerk browser configuration
description: Environment-only configuration required for browser validation against the project's external Clerk instance.
---

Keep Clerk tenant hosts and owner identifiers out of tracked configuration. Browser validation must accept either a valid environment-provided publishable key or an explicitly injected development frontend host, and must validate rather than trust a present key.

**Why:** This workspace can expose publishable-key variables that exist but contain invalid placeholders. Removing a committed tenant host correctly cleans the repository, but browser setup then fails unless the external instance's public host is supplied through the development environment.

**How to apply:** When Clerk browser setup fails before tests run, check key validity without printing values. Preserve the fail-closed setup check and use an environment-only frontend host when no valid publishable key is available.