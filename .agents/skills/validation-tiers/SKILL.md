---
name: Validation Tiers
description: Existing application-check workloads retained for later gate adaptation.
---

# Validation workloads

These describe application-check workloads, not a second task-admission policy.
The current Failure Gate authority is `.agents/skills/failure-gate-unified/SKILL.md`
and its two normative references, pinned as one package.
Unified reads the approved runtime registry at `docs/validation/manifest.json`.
The adjacent `tiers.json` is older example data, not Unified's runtime registry.
No task ID, sealed-plan mechanism, tier binding, or completion permission is
provided by this document. See `docs/validation/modular-migration.md` for installed
integration, actual maintenance results and outstanding runtime acceptance.

`docs/validation/manifest.json` defines the executable runtime steps,
priorities, resources, and budgets. The adjacent `tiers.json` remains an
example workload registry, not a competing runtime authority.

- `test-fast`: typecheck, storage lint, storage-lint contract.
- `test-standard`: typecheck, storage lint, port-reference scan, storage-lint
  contract, unit tests, Clerk release contract, Vite HMR, manifest parity.
- `test-standard-plus`: all `test-standard` steps, plus serial-lock tests
  and the port-authority harness. This retains the Clerk release contract
  and makes the tier a strict workload superset of `test-standard`.
- `test-heavy`: startup smoke and boundaries, high-severity dependency audit,
  schema and release contracts, workspace-skill contract, typecheck, storage
  lint, port-reference scan, storage-lint contract, unit tests, Clerk release
  contract, both regular HMR and HMR recovery, serial-lock tests,
  port-authority harness, manifest parity, nested-tier regression, collision
  smoke, and browser tests.

## Expected local duration

These estimates exclude time queued for the shared validation lock:

| Tier | Expected workload duration | Current budget |
|---|---:|---:|
| `test-fast` | About 25 seconds; recently measured at 23 seconds | 3 minutes |
| `test-standard` | About 2 minutes 40 seconds; recently completed successfully | 5 minutes |
| `test-standard-plus` | About 3½–4 minutes after adding the Standard Clerk contract | 7 minutes |
| `test-heavy` | 5–10 minute target, not yet measured as a successful full run | 15 minutes |

The heavy estimate is provisional: its most recent run timed out during startup
smoke, and a prior run failed the dependency audit. A timing estimate is not a
claim that the tier currently passes.

Retirement removed only the obsolete gate contract and package-parity steps.
Keep the remaining application checks and audit threshold intact. A workload
result is not evidence of task admission or a task-board completion decision.
