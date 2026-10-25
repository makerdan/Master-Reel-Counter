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

## Portable lockfile sources after managed installation

Inspect newly resolved lockfile URLs after using the managed root package
installer or the sandbox's documented package procedure. Preserve versions and
integrities, but use the matching public npm tarball URLs for registry packages.

**Why:** Both procedures have emitted workspace-internal HTTP package-firewall
URLs. Installation succeeded locally, but existing portability guards correctly
rejected these sources because clean external CI cannot rely on that host.

**How to apply:** Keep the existing unconditional root/sandbox portability guards,
normalize only affected registry URLs, and rerun those guards. Never suppress
the portability check or treat a local successful install as portable evidence.
