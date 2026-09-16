---
name: Validation lock waiter isolation
description: Parallel validation runs can share a lock file while accidentally sharing waiter manifests.
---

When running a validation tier alongside another validation run, give the run a
dedicated `VALIDATION_LOCK_WAITERS_DIR`; collision smoke tests inherit that
directory, while the lock path can remain project-managed.

**Why:** The collision harness intentionally starts nested validation commands.
If unrelated queued tiers share the default waiter directory, the nested smoke
command can see higher-priority waiters and remain queued indefinitely.

**How to apply:** Use an isolated waiter directory for manual or parallel
validation runs, and do not treat a queue stall as an application failure until
the active lock and waiter manifests have been inspected.

A configured browser-validation workflow can also hold the shared validation
lock for a long time without producing new logs. Release that unrelated holder
before running focused package checks; the resulting wait is harness contention,
not evidence against the package.