---
name: Transitive npm override verification
description: Why successful package installation is insufficient evidence that a nested security override took effect.
---

Do not infer that a transitive security override was applied from npm's successful
exit alone. Verify the installed version relative to its actual consumer and
repeat resolution in a disposable clean installation.

**Why:** In this workspace, an override nested under a grandparent left the
already-locked leaf at its vulnerable version despite a successful installation.
Scoping the same compatible constraint to the immediate owning package applied
the patch, and a fresh install confirmed it. This is an observed result, not a
claim that all nested npm overrides are broken.

**How to apply:** Prefer the narrowest effective consumer constraint, inspect the
real resolution chain after installation, and keep consumer-relative recurrence
checks. Do not compensate with a broad incompatible override or an audit waiver.
