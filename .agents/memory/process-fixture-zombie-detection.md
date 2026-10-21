---
name: Process-fixture zombie detection
description: Distinguishes a terminated orphan process from a still-running process in Linux process-only tests.
---

In minimal Linux containers, `process.kill(pid, 0)` can continue succeeding for a killed orphan while its `/proc/<pid>/stat` state is `Z` because PID 1 has not reaped it yet. Process-only cleanup tests should treat `Z` and `X` as not running, while separately asserting that the process no longer owns its listening port.

**Why:** A test that equates PID existence with a running process can report false cleanup failures even after the owned-process supervisor has killed the child and released its socket.

**How to apply:** When checking process cleanup in Linux fixtures, inspect `/proc/<pid>/stat` state and pair it with a port availability check instead of relying only on signal 0.
