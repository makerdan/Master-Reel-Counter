---
name: Failure Gate writer coordination
description: Why a cooperative file lock is necessary but not sufficient for local completion.
---

Local completion must not infer file stability from a SQLite transaction or a
caller-reported lock. Even a real OS file lock protects only writers that use
the same boundary; it does not stop editor, Git, build, or arbitrary shell
edits. Keep ordinary completion blocked until the relevant writer inventory
and its coverage are independently verified, or use an immutable final input.

**Why:** A writer can alter an input after the final manifest check but before
the terminal transaction commits if it does not cooperate with the boundary.

**How to apply:** When connecting a runtime host or expanding file-writing
scripts, audit every relevant writer and ensure it shares the boundary before
claiming live completion safety. Fixture contention proves cooperative
serialization only, not protection against uncoordinated writes.