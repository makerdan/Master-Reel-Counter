---
name: Validation lock survivor ownership
description: Safety invariant for stale validation-lock recovery after wrapper cleanup cannot be verified.
---

If a validation wrapper cannot verify cleanup, its lock must retain enough child
process-group/tree ownership evidence for later recovery to refuse takeover while
any of that work remains alive.

**Why:** The wrapper PID can exit after SIGTERM/SIGKILL escalation while a
detached descendant continues using the validation resource. Checking only the
wrapper PID can let a later run collide with that survivor.

**How to apply:** Persist the detached child process group and observed tree
before cleanup escalation, preserve the lock when the wrapper is dead but that
ownership survives, and reclaim only after the ownership disappears.