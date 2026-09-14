---
name: Clerk bootstrap recovery
description: Recovery behavior for Clerk script-load failures in the browser.
---

Clerk script-load failures should render the provider's supported failure state,
while terminal configuration errors must be handled before constructing the
provider. A full page reload is the reliable user-triggered retry because a
same-tree provider remount can retain a failed Clerk singleton in the browser
SDK.

**Why:** A failed Clerk script emitted an unhandled-rejection development
overlay, and remounting the provider did not reliably clear the SDK's failed
singleton. The recovery UI must remain interactive and cannot expose protected
routes while Clerk is unresolved.

**How to apply:** Use `ClerkFailed`/`ClerkLoaded`/`ClerkLoading` for lifecycle
gating, bound unresolved loading with a user-visible timeout, preserve the
current validated URL on retry, and filter only the known Clerk bootstrap error
from the development overlay. Never clear broad browser storage or treat a
failed provider as authenticated.