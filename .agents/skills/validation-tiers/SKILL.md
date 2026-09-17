---
name: Validation Tiers
description: Declarative project validation tiers used by Failure Gate.
---

# Validation Tiers

This document is the host adapter between the portable Failure Gate contract
and this repository's validation commands. Adopters must supply a declarative
tier registry, but they do not need these tier names, commands, paths, or suite
composition.

In this repository tiers are registered in `tiers.json`, not in runner
conditionals. Each step has a stable name, command array, kind, and optional
serial requirement. `test-fast`, `test-standard`, `test-standard-plus`, and
`test-heavy` are this repository's package tiers; future suites are added as
registry entries and tests, then included in a tier by data.

- **fast**: typecheck and storage lint.
- **standard**: light checks plus backend unit tests.
- **standard-plus**: standard checks plus lock, cleanup, and resource-isolation tests.
- **heavy**: startup smoke, dependency audit, light checks, backend tests,
  serial-lock collision smoke, and Playwright e2e. The heavy group is wrapped
  by the existing serial lock and port cleanup controls.

`kind` distinguishes `typecheck`, `test`, `lint`, `audit`, `smoke`, and
`harness` results. Only `test` failures are eligible for exact baseline
classification. Typecheck, lint, audit, and smoke failures are task failures.
Audit commands and thresholds are integrity-sensitive and cannot be weakened or
waived to pass a tier. A started step without a valid result is incomplete, and
all required later steps are reported by name as not reached. Neither status can
be silently promoted to a baseline or a pass.

`tiers.json` is shipped as an example host registry, not as a portable default.
Adopters must replace its product-specific commands, paths, locks, and timeouts
while preserving the Failure Gate semantics above.