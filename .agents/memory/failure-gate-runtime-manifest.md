---
name: Failure Gate runtime manifest
description: Distinguishes routine validation registration from the published Failure Gate tier contract.
---

Routine validation steps are registered in `docs/validation/manifest.json`. The
`.agents/skills/validation-tiers/tiers.json` file is packaged into the published
Failure Gate archive and should only change when the published tier contract
itself changes.

**Why:** The runtime manifest is the source of truth for resource-aware
validation, while the packaged registry is consumed as a portable skill
contract. Mixing the two can change tier semantics when only routine coverage
was intended.

**How to apply:** Add ordinary parity or safety checks to the appropriate
manifest tier and cover the registration with a focused test. If the packaged
tier registry changes, regenerate the published archive before running release
contract tests; those tests fail closed on a stale snapshot.