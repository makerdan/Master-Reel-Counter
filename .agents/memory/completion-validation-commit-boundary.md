---
name: Completion-validation commit boundary
description: How to select a trustworthy pre-task revision after a failed completion-validation handoff.
---

After platform-managed completion validation starts, a task commit may already be present even if validation later fails and the task remains incomplete. A clean working tree or current `HEAD` therefore does not prove the task was completed or merged.

**Why:** A pre-task reproduction run against the post-task `HEAD` can include the change under investigation and falsely appear to establish pre-existing provenance.

**How to apply:** After a failed completion handoff, inspect the newest commit and its parent. Use the task commit's parent (or the recorded starting revision when appropriate) for pre-task baseline comparisons.