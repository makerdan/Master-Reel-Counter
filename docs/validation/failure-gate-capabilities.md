# Failure Gate capability checklist

This checklist is the tracked acceptance map for the canonical Failure Gate
specification. “Verified by” names executable contract coverage, not a manual
claim.

| Capability | Implementation | Verified by |
|---|---|---|
| Plan-time baseline discovery and required announcement | `SKILL.md`, `new-plan.mjs` | plan scaffold tests |
| Required baseline and validation sections | `check-failure-gate.mjs` | missing/malformed plan tests |
| Registered light, standard, and heavy tiers | `validation-tiers/tiers.json` | tier registry tests |
| Fail-closed missing, unreadable, malformed, or mismatched plans | `tier-lock-check.mjs`, `run-tier.mjs` | tier-lock tests |
| Explicit ad-hoc no-plan escape hatch | `run-tier.mjs --allow-no-plan` | ad-hoc test |
| Exact suite/test/signature resolution | `lib/baseline.mjs`, failure lint | mismatch/stale tests |
| Active, expired, resolved, intermittent, environment-limited, unknown, needs-review lifecycle | baseline catalog and lifecycle guide | catalog schema tests |
| Two-factor self-classification and retry/intermittency rules | canonical skill | contract text/parity test |
| Scoped fix-stub behavior and archive inspection | both lint guards | scoped/archive tests |
| Regression Guard strict, stub, N/A, and self-satisfying modes | `check-regression-guard.mjs` | regression guard tests |
| Task versus completion validation distinction | canonical skill | contract text test |
| Serial heavy execution and existing port controls | tier registry, `serial-lock.mjs`, `ci.sh` | heavy registry and CI collision tests |
| Baseline review deadlines and stale-verification report | maintenance script and guide | maintenance tests |
| Catalog promotion boundary and fail-closed reference resolution | baseline library | promotion/status tests |
| Canonical/generated mirror parity | parity script | parity command |
| Tracked distributable snapshot | publish script and zip | package inspection test |
| Safe extension for future suites and tiers | declarative registry | registry shape test |

All capabilities in the attached specification are implemented; none are
silently deferred. Unsupported capability count: **0**.