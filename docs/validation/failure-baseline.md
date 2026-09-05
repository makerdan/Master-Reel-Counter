# Failure baseline lifecycle

`failure-baseline.json` is the only durable source for pre-existing test
failures. An entry is referenceable only when its `status` is `active`, its
`reviewBy` date has not passed, and the plan's suite, test, and exact failure
signature match the entry. An ID alone is never sufficient.

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
evidence, two-factor provenance, exact matching fields, dated evidence, an
owner, and a review deadline. A task may report a finding without editing this
catalog.

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