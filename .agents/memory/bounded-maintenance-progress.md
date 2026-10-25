---
name: Bounded maintenance progress
description: Avoid starvation when limiting maintenance work over records that can repeatedly fail.
---

Bounded maintenance must advance past attempted records, including failures, and
retain a way to retry those failures on a later pass. Report batch progress
separately from overall completion.

**Why:** Repeatedly selecting only the earliest eligible records can permanently
strand later valid records behind a full batch of persistent failures. A time
budget can cause the same problem even before the row limit is reached.

**How to apply:** When introducing batch or time limits over a retryable work
set, test a fully failing prefix followed by valid work. Continuation must
advance by the last attempt, not by the last success, and must retain all
authorization and per-request work limits.
