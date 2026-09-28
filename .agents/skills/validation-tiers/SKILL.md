---
name: Validation Tiers
description: Declarative project validation tiers used by Failure Gate.
---

# Validation Tiers

This document is the packaged example adapter between the portable Failure Gate
v4 contract and this repository's validation commands. The effective runtime
registry for this host is `docs/validation/manifest.json`. Adopters must supply
registered real checks, but these tier names, commands, paths, and suites are
not portable requirements. Changes to runtime steps or command wrappers are
governing-policy changes, not approvals a task can grant itself.

In this repository example tiers are packaged in `tiers.json`, not runner
conditionals; the runtime manifest determines the actual commands. Each step
has a stable name, command array, kind, and optional serial requirement.
`test-fast`, `test-standard`, `test-standard-plus`, and `test-heavy` are this
repository's tier names, not portable requirements.

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

For v4, a tier name is not sufficient authorization: the current task must
bind its approved plan and effective runtime definition digest to one active
authorization. Ad-hoc runs, baseline discovery and bounded diagnostics do not
satisfy a full-tier completion obligation. Record every required step and
preserve raw failure status even if an exact unrelated baseline is eligible.
Retries establish intermittency, not provenance; consult the canonical
Failure Gate skill for earlier-snapshot and ownership requirements.

`tiers.json` is shipped as an example host registry, not as a portable default.
Adopters must replace its product-specific commands, paths, locks, and timeouts
while preserving the Failure Gate semantics above.