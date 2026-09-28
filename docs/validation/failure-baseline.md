# Failure baseline lifecycle

`failure-baseline.json` is the only durable catalog for reusable pre-existing
test failures. An entry is referenceable only when its `status` is `active`, its
`reviewBy` date has not passed, and suite, test, signature and applicable
environment/variant match unambiguously. An ID alone is never sufficient.
The currently empty catalog authorizes no ignores. Catalog review does not
approve a task's tier or waive an owned repair.

## Record fields

Every record has a unique `id`, `suite`, `test`, `signature`, `status`, `owner`,
`observedOn`, `verifiedOn`, and `reviewBy`. Dates use `YYYY-MM-DD`.

| Status | Meaning | May authorize an ignore? |
|---|---|---|
| `active` | Verified, owned, and currently accepted as pre-existing | Yes, before `reviewBy` |
| `expired` | Review deadline passed | No |
| `resolved` | The failure no longer reproduces | No |
| `intermittent` | Retry passed but provenance is not established | No |
| `environment-limited` | Harness or resource limitation | No |
| `unknown` | Observed without sufficient provenance | No |
| `needs-review` | Candidate awaiting separate maintenance verification | No |

Promotion is separate from task execution. A candidate needs isolated retry
evidence, direct evidence of the same failure on a verified earlier unaffected
snapshot plus independently sourced corroboration, exact matching fields and
explicit applicability, dated evidence, owner, reviewer and a review deadline.
Define allowed normalization and clock/expiry semantics before activation;
ambiguity fails closed. An unlisted test failure gets exactly three authorized
safe isolation retries after its initial failure when a registered diagnostic
capability supports them. A passing retry proves intermittency, not provenance.
A task may report a finding without editing this catalog.

Recheck ignore eligibility at activation, run launch, classification and
completion. Revocation or expiry before completion invalidates an ignored
failure. An **owned baseline repair** is a separate task obligation and
survives expiry or reclassification: require positive evidence that its
proving test was discovered and fixed. Skips, renames and removal do not
discharge it. Do not classify typecheck, lint, audit, smoke or harness failures
as catalog test ignores.

## Maintenance

Run `npm run maintain:validation-baseline` with optional
`BASELINE_WARNING_DAYS` (default 30) and `BASELINE_STALE_DAYS` (default 90).
The report is opt-in and never part of ordinary tiers. It reports
`review-due`, `expired-active`, and `stale-verification`.

Exit codes:

- `0`: catalog is valid and no findings are present.
- `1`: findings are present (including expired active records).
- `2`: catalog is malformed or unreadable.

Unknown, stale, expired, intermittent, environment-limited, and resolved
records always fail closed during plan resolution, regardless of maintenance
output.