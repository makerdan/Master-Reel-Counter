---
name: Gate history read errors
description: Distinguish a buffered Git-output failure from damaged history before attempting repair.
---

A gate message saying `git prerequisite failed: show` does not establish missing
or corrupted Git objects. Inspect the failed subprocess's error code and the
committed object's size before treating it as a history-integrity problem.

**Why:** Append-only validation history exceeded a subprocess stdout buffer;
the shell could read the same object successfully, while the gate returned
`ENOBUFS` under a generic Git prerequisite message.

**How to apply:** Compare the exact bounded subprocess result with a direct
object read. Preserve the history and request scoped gate maintenance when
needed; do not truncate records, reset the registry, or attempt Git-history
repair solely on that generic message.
