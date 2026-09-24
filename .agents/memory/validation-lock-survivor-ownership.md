---
name: Validation lock survivor ownership
description: Safety invariant for stale validation-lock recovery after wrapper cleanup cannot be verified.
---

If a validation wrapper cannot verify cleanup, its lock must retain enough child
process-group/tree ownership evidence for later recovery to refuse takeover while
any of that work remains alive.

On Linux, bind recorded holder, group-leader, and observed-child PIDs to their
`/proc/<pid>/stat` start time before treating a currently occupied PID as the
same process. A mismatched identity proves reuse; a missing or unreadable group
leader identity remains ambiguous and must preserve the fail-closed group check.
Locks without identity metadata also retain the conservative legacy behavior.

**Why:** The wrapper PID can exit after SIGTERM/SIGKILL escalation while a
detached descendant continues using the validation resource. Checking only the
wrapper PID can let a later run collide with that survivor, while trusting a
reused PID can strand recovery behind unrelated work.

**How to apply:** Persist the detached child process group and observed tree
before cleanup escalation, preserve the lock when the wrapper is dead but that
ownership survives, and reclaim only after the ownership disappears. Compare
start-time identities where available; when identity evidence is absent or
ambiguous, prefer waiting over risking a concurrent validation run.