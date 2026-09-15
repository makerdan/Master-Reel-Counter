---
name: Clerk release test permissions
description: Required Clerk API permissions for disposable release browser accounts
---

Release browser setup requires a Clerk secret that can create disposable users
and issue testing tokens. A secret can be present and otherwise authenticate
successfully while still returning `Forbidden` or `422 form_data_missing` when
the setup creates its disposable account.

**Why:** The release harness must provision and clean up throwaway identities
without using personal Google credentials or committed browser state. Matching
publishable-key metadata does not prove that the connected provider credential
has disposable-user provisioning capability.

**How to apply:** Treat a setup-time `Forbidden` or `422 form_data_missing` from
disposable-user creation as a release environment/permission failure. Repair
the release secret scope outside the application code, then rerun the release
gate without weakening its browser assertions.