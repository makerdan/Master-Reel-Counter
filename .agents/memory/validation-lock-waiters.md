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

Waiter manifests with process identities should be ignored when the recorded
process start time no longer matches the live PID. Legacy manifests without an
identity should still count while their PID is running, preserving priority for
checks already queued before the format change; zombie processes must not keep
them active. Remove a stale manifest only if its contents have not changed since
the scheduler read it.

**Why:** Rollouts can leave valid older waiters in the queue, while PID reuse or
concurrent manifest replacement can make stale queue records delay or disrupt
new checks.

**How to apply:** When changing waiter scheduling or cleanup, preserve the
identity check, live-PID fallback for legacy entries, zombie handling, and
snapshot-safe removal as one behavior contract.