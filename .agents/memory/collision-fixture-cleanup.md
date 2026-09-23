---
name: Collision fixture cleanup
description: Durable safety rule for temporary lock and waiter resources used by collision smoke harnesses.
---

Collision smoke harnesses must create one owned temporary root for both the lock file and waiter directory, and install termination handlers before spawning or announcing child processes.

**Why:** An interrupted run can arrive during startup, before child cleanup logic exists. Separate or late-initialized paths leave stale fixtures that confuse later validation runs.

**How to apply:** Remove the entire fixture root in a `finally` path, signal child process groups before waiting for their completion, and keep cleanup errors from replacing the harness or child exit status.