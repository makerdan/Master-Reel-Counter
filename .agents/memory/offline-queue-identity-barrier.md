---
name: Offline queue identity barrier
description: Ownership and lifecycle rules for recovering identity-scoped browser queues safely.
---

Offline queue consumers must await one identity initialization barrier before reading, counting, recovering claims, cleaning, or draining records. Reassign ownership only from aliases freshly verified by the server for the current account. Ownerless and foreign records stay quarantined and unchanged.

**Why:** Independent drainers and auth transitions can otherwise observe a partial migration, reset another account's claim, or submit prior-account work under a replacement session.

**How to apply:** Use the same barrier in global and feature-local queue consumers, scope claim recovery to the canonical owner, abort work on identity changes, and preserve durable upload/registration state through retries.