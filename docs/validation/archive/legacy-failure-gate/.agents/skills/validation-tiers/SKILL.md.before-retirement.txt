---
name: Validation Tiers
description: Declarative project validation tiers used by Failure Gate.
---

# Validation Tiers

This document is the packaged example adapter between the portable Failure Gate
v4 contract and this repository's validation commands. Adopters must supply
registered real checks, but these tier names, commands, paths, and suites are
not portable requirements. Changes to runtime steps or command wrappers are
governing-policy changes, not approvals a task can grant itself.

The Failure Gate package includes `tiers.json` as an example host registry,
not a runtime step list. For the current `npm run test-*` package commands,
`docs/validation/manifest.json` is the runtime source of truth: its entries
determine the ordered checks, resource, priority, and timeout. Each step has a
stable name, command array, kind, and optional serial requirement. The runtime
step names below are copied from that manifest so planners can compare the
tiers by their actual coverage.

## Runtime tier coverage

- **test-fast**: typecheck, storage lint, and its contract test. Manifest steps:
  `typecheck`, `storage-lint`, `storage-lint-contract`.
- **test-standard**: typecheck, storage lint and contract, port-reference scan,
  unit tests, managed Clerk release contract, Vite HMR tests, Failure Gate
  contract, Failure Gate archive parity, and manifest parity. Manifest steps:
  `typecheck`, `storage-lint`, `port-reference-scan`, `storage-lint-contract`,
  `unit-tests`, `clerk-release-contract`, `vite-hmr-tests`,
  `failure-gate-contract`, `failure-gate-parity`, `manifest-parity`.
- **test-standard-plus**: shared typecheck, storage, port-reference, unit, and
  Vite HMR checks, plus serial-lock tests and the port-authority harness.
  Unlike `test-standard`, it omits the managed Clerk release contract and
  Failure Gate contract. Manifest steps: `typecheck`, `storage-lint`,
  `port-reference-scan`, `storage-lint-contract`, `unit-tests`,
  `vite-hmr-tests`, `serial-lock-tests`, `port-authority-tests`,
  `failure-gate-parity`, `manifest-parity`.
- **test-heavy**: startup smoke and its boundary contract, dependency audit,
  schema and release contracts, workspace-skill contract, standard-plus
  static/unit checks with Vite HMR recovery coverage, nested-tier and collision
  checks, and browser tests. Manifest steps: `startup-smoke`,
  `startup-smoke-boundaries`, `security-audit`, `schema-check`,
  `release-schema-contract`, `workspace-skill-contract`, `typecheck`,
  `storage-lint`, `port-reference-scan`, `storage-lint-contract`,
  `unit-tests`, `vite-hmr-recovery-tests`, `serial-lock-tests`,
  `port-authority-tests`, `failure-gate-parity`, `manifest-parity`,
  `nested-tier-regression`, `collision-smoke`, `browser-tests`.

`tiers.json` is a separate portable example host registry, not the runtime
step list for these package commands. The current `test-standard` example
registers a narrower `backend-tests` command for the routes and photo-delete
tests; runtime uses `unit-tests` and additionally runs Vite HMR, Failure Gate
contract, archive-parity, and manifest-parity checks. Keep the registries
distinct rather than changing runtime coverage to match the example.

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
