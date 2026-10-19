# Retained adaptation candidates — no gate installed

These items remain at their existing locations. They are not Unified
admission or authorization and must not be described as an enforced gate.

| Item | Disposition for a later installation |
| --- | --- |
| `docs/validation/manifest.json` | Retain all application workloads, budgets and audit thresholds; remove only retired gate contract/package checks. Owner approval of future workloads still applies. |
| `.agents/skills/validation-tiers/tiers.json` | Retain workload example data, without retired gate checks. |
| `scripts/run-tier.mjs`, `scripts/lib/tiers.mjs` | Ungated workload execution and registry reading. Legacy task-plan admission and host-bound execute attestation are removed. |
| `scripts/serial-lock.mjs`, collision/reentrancy tests | Shared process/resource concurrency and cleanup, not workspace or machine task admission. Process identity and file ownership checks here prevent killing unrelated processes or losing locks; do not confuse them with workspace receipts. |
| `scripts/check-baseline.mjs`, `scripts/maintain-validation-baseline.mjs`, `scripts/lib/baseline.mjs` | Leave catalog tooling unchanged for format conversion review. |
| `docs/validation/failure-baseline.json`, `docs/validation/failure-baseline.md` | Leave existing catalog and documentation at their original paths with unchanged contents. |
| `.github/workflows/validation.yml` | Keep application CI. Its called workload manifest no longer contains retired gate checks. Workflow file unchanged. |
| `.github/workflows/managed-clerk-release.yml` | Keep the application release verifier unchanged. |
| `scripts/build-and-verify-release.sh` | Keep all application release checks; remove only the legacy package-parity invocation. |
| Playwright JSON reporting | Leave the application test configuration and historical output path unchanged; the path name is not active gate enforcement. |
| Other custom skills that mention validation | Independent skills, not alternate gate definitions; assess integration wording when Unified is installed. |
| Attached Unified ZIP and existing platform-provided Unified mirror | Input/projection only. Do not load the mirror as canonical, install the ZIP, or create a revision pin during retirement. |
| `scripts/__tests__/legacy-gate-retirement.test.mjs` | Maintenance-only checks of byte-preserved history, retained application workloads, and the absence of legacy admission. Not a task-tier PASS or a new gate. |

No `AGENTS.md` was found in the project outside dependencies. The dedicated
legacy instructions in `replit.md`, README, and testing documentation are
removed. Git history, platform runtime records, and third-party caches are
not current instructions and are not rewritten.
