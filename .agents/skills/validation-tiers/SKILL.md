---
name: Validation Tiers
description: Existing application-check workloads retained for later gate adaptation.
---

# Validation workloads

These are independent application-check groups, not task-admission rules.
No task ID, sealed-plan mechanism, tier binding, or completion permission is
provided by this document. The replacement gate is not installed.

`docs/validation/manifest.json` defines the executable runtime steps,
priorities, resources, and budgets. The adjacent `tiers.json` remains an
example workload registry, not a competing runtime authority.

- `test-fast`: typecheck, storage lint, storage-lint contract.
- `test-standard`: typecheck, storage lint, port-reference scan, storage-lint
  contract, unit tests, Clerk release contract, Vite HMR, manifest parity.
- `test-standard-plus`: typecheck, storage lint, port-reference scan,
  storage-lint contract, unit tests, Vite HMR, serial-lock tests,
  port-authority harness, manifest parity.
- `test-heavy`: startup smoke and boundaries, high-severity dependency audit,
  schema and release contracts, workspace-skill contract, typecheck, storage
  lint, port-reference scan, storage-lint contract, unit tests, Vite HMR
  recovery, serial-lock tests, port-authority harness, manifest parity,
  nested-tier regression, collision smoke, browser tests.

Retirement removed only the obsolete gate contract and package-parity steps.
Keep the remaining application checks and audit threshold intact. A workload
result is not evidence of task admission or a task-board completion decision.
