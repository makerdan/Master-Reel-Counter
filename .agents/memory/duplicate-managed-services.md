---
name: Duplicate managed service instances
description: Managed workflow stop results do not establish quiescence when duplicate instances exist.
---

After a managed stop, inspect actual affected listeners and process ownership
before starting a replacement.

**Why:** Two sandbox instances existed under the same workflow name. The status
reported the newer fallback-port instance, but the first successful named stop
removed the older instance instead. A second named stop removed the remaining
instance; neither a successful response nor the displayed workflow port alone
proved that the service was fully stopped.

**How to apply:** Prefer bounded reconciliation through the same managed stop
route, rechecking affected listeners between calls. Start one replacement only
after observed quiescence. Do not blindly kill platform processes or treat this
observation as authority for unmanaged reclaim.
