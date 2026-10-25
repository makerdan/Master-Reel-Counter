---
name: Completion validation commit boundary
description: How to inspect task commits and choose a pre-task revision after failed completion validation.
---

Platform-managed completion validation may commit task changes and advance `HEAD` before checks finish. A failed result or clean working tree does not mean the task changes are uncommitted, complete, or merged.

**Why:** This happened during an assigned task: a later validation failure exposed a stale assertion after the implementation was already committed, and a baseline check against the post-task `HEAD` could have falsely attributed the failure to the pre-task revision.

**How to apply:** After a failed completion check, inspect `git log`, `git status`, and the diff. Identify the task commit and its parent; use that parent or the recorded starting revision for pre-task comparisons, and do not reapply changes already committed.

Platform completion can also run all registered validation commands as independent workloads, rather than dispatching only the task's sealed Unified tier. A passing admitted tier does not guarantee the platform will mark the task complete.

After completion synchronizes with main, installed dependencies can still reflect
the pre-sync lockfile. Compare actual installed versions with the merged lockfile
before changing source to address an apparent API/type incompatibility.

**Why:** A completion typecheck encountered a Zod-4 option with Zod-3 installed,
even though main already contained the correct Zod-4 dependency repair.

**How to apply:** Synchronize installed dependencies to the merged package files,
preserve portable lockfile URLs, and retry validation before considering source
workarounds or dependency downgrades.

Include separately installed artifacts in that synchronization; matching root
versions do not establish artifact parity.

**Why:** A rebased root installation matched its lockfile while the independent
sandbox retained old Vite, Babel, picomatch and Zod versions, causing six security
guard failures. Synchronizing its own locked install resolved those checks.

**Why:** Package-only work with an admitted fast-tier PASS was still refused completion when the independently launched heavy tier failed its dependency audit.

**How to apply:** Inspect registered completion checks before claiming the only remaining step is administrative. Keep independent results separate from admitted-tier evidence. Do not silently remove checks, switch the bound tier, waive a failure, or expand into dependency changes; report the exact mismatch and obtain authorization for changes outside the task scope.
