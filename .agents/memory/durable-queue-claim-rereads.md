---
name: Durable queue claim rereads
description: Preventing duplicate side effects when multiple browser queue drainers use stale snapshots.
---

After atomically claiming a durable queue item, reread the record inside the claim-owning flow before deciding which side effect is still required.

**Why:** Multiple drainers can snapshot the same item before either acts. A later drainer may acquire the released claim after an earlier drainer persisted partial progress, but its old snapshot will not contain that progress and can repeat an upload or other non-idempotent step.

**How to apply:** Treat the claim as ownership, not as fresh data. Reload the claimed record from durable storage, then branch on its latest persisted progress markers.