---
name: Validation cancellation
description: Managed background-shell cancellation can prevent the validation recorder from completing its signal cleanup.
---

Do not assume stopping a managed background shell produces a terminal validation
record. Inspect the recorded state before starting another run, and use the
supported recovery route only after its recorded cleanup deadline.

**Why:** Cancelling a background shell while supervised validation was running
left its durable record RUNNING even though the processes were gone. The gate
correctly refused further validation until its original cleanup deadline.

**How to apply:** Prefer allowing bounded validation to finish. If cancellation
is necessary, preserve its evidence, verify owned processes have stopped, and
respect the recorder's supported recovery conditions rather than editing state
or shortening its deadline.

Foreground shell-tool timeouts can leave the same unresolved record. For a
validation budget longer than the tool's foreground timeout, use a managed
background shell and observe completion rather than letting the outer call
terminate the recorder early.
