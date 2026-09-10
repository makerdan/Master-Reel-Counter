---
name: Agent build failure evidence
description: Evidence rules for reviewing historical Replit/Agent validation failures.
---

Explicit dated validation records and retained platform artifacts are the only reliable basis for historical build outcomes. Git commits, reflogs, task titles, and passing retries show activity or intermittency, not a complete run population or root cause. Missing artifacts leave the failure stage or ownership inconclusive even when an aggregate failure is known.

**Why:** A 30-day review found repeated local dependency-gate stops and remote aggregate failures, but no durable Agent run ledger and no diagnostic artifacts for the remote failures.

**How to apply:** State the evidence denominator and retention gaps first; count only observed executions; separate a known failure signature from its unproven underlying cause; never infer missing outcomes from repository activity.