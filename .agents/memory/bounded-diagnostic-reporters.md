---
name: Bounded diagnostic reporters
description: Why a failed test can lack its assertion details in the gate's displayed excerpt.
---

Do not infer the cause of a test failure solely from the gate's displayed tail.
Filtered reporters may retain case outcomes without assertion details, and
verbose test events can displace early errors from bounded output.

**Why:** A failing collection guard's assertion detail was absent from both the
displayed tail and the structured case summary; it was a harness error rather
than a vulnerable dependency.

**How to apply:** Use retained browser error-context artifacts or a temporary,
bounded, nonsecret diagnostic capture at the failing test boundary through the
guarded runner. Remove temporary instrumentation after identifying the cause.
