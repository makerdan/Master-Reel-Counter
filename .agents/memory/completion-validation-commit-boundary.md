---
name: Completion validation commit boundary
description: How to inspect task commits and choose a pre-task revision after failed completion validation.
---

Platform-managed completion validation may commit task changes and advance `HEAD` before checks finish. A failed result or clean working tree does not mean the task changes are uncommitted, complete, or merged.

**Why:** This happened during an assigned task: a later validation failure exposed a stale assertion after the implementation was already committed, and a baseline check against the post-task `HEAD` could have falsely attributed the failure to the pre-task revision.

**How to apply:** After a failed completion check, inspect `git log`, `git status`, and the diff. Identify the task commit and its parent; use that parent or the recorded starting revision for pre-task comparisons, and do not reapply changes already committed.
