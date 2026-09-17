---
name: Nested validation reentrancy
description: Same-resource validation tiers may nest through package scripts without reacquiring their owning lock.
---

Manifest steps that invoke another validation tier must preserve only the
outer lock marker for the active resource. The serial-lock wrapper remains the
authority: it bypasses reacquisition only when that marker identifies an
ancestor process.

**Why:** Removing the marker makes a nested tier wait behind the lock held by
its parent, while forwarding every marker can incorrectly make an unrelated
resource appear reentrant. An intentionally independent collision harness must
also clear inherited task-plan metadata, because a nested tier can otherwise
fail closed against the outer tier's command before testing lock reentrancy.

**How to apply:** Keep a non-smoke regression that reaches a manifest step and
asserts the nested step runs once without a waiting message or inherited task
plan. Clear inherited markers and task-plan metadata when a harness
intentionally creates independent lock contenders.