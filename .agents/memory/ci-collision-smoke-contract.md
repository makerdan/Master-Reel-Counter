---
name: CI collision smoke contract
description: Durable requirements for validation collision probes that exercise shared resources safely.
---

The collision smoke contract must prove that every participating child acquired
the intended lock, that at least one child actually queued, and that timeout or
signal paths terminate the full child process tree before releasing temporary
shared state.

**Why:** A one-sided log assertion can pass when one route bypasses the lock,
and waiting only for natural child completion can leave validation descendants
and lock files behind after cancellation.

**How to apply:** Keep deliberately shared collision probes separate from
independent-resource probes. Give each probe isolated lock and waiter
directories, use bounded cleanup, and assert resource identity in captured
evidence.