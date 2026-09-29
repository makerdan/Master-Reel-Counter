---
name: Tracked approval snapshot stability
description: Why a staged review file is not a stable decision source during authorization.
---

Git index membership proves only that a path is known to Git. Reading its
mutable working copy and checking the index afterward does not stabilize the
reviewer's decision through an authorization transaction. Use an immutable
source revision for the reviewer roster and decision together, or a verified
writer boundary that covers them.

**Why:** A concurrent file writer can change the working copy or index between
the source check and the coordinator commit. A path-only tracking check can
accept bytes that were never the reviewed source.

**How to apply:** When adding or replacing project-local approval routes, pin
the complete decision context to one stable source and retain its provenance.
Do not confuse a stable snapshot with proof that a particular human authored
it; designation and authorship remain procedural unless independently
attested.