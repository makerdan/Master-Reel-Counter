# Page-view privacy repair

## Authorization and admission

The owner approved collection minimization and regression tests, then separately
authorized the narrow admission/readiness repair. Maintenance evidence is in
`admission-readiness-repair.md`. Its registry-before hash matched before normal
application provisioning. No maintenance identity was minted.

Application identity: `1bc92e1d-057b-4d8b-baa6-e75ab3ca0115`, sealed revision 1,
bound only to test-standard. Governing Unified revision:
`cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`;
Regression Guard:
`1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
Ordinary owner approval is tracked by the Agent, not a fabricated native receipt.
The supported guard returned ADMITTED before application edits.
Baseline catalog was valid and empty; no baseline entry was added.

## Delivered boundaries

The route retains its existing rate limiter and parameterized database write.
`server/pageview-tracking.ts` is the actual installed handler, with a small injected
persistence boundary for tests. It:
- Keeps only coarse known page labels; removes query/fragment data and maps
  session/invite identifiers to templates. Other local paths become `/other`.
- Rejects malformed, non-local, control-character and oversized inputs.
- Uses HMAC-SHA256 with the existing SESSION_SECRET, a page-view-specific domain
  and UTC date. No fixed/default key or raw visitor address reaches persistence.
- Skips collection without a usable secret or request IP. Public error bodies
  are generic; no secret or request content is logged.
- Responds without awaiting persistence and absorbs async persistence failures.
- Deduplicates coarse visitor/page events for 30 seconds in a bounded cache.
  Request IP uses Express's existing proxy policy rather than a separate parser.

No historical rows, schema, provider, client surface, workload, deployment,
authorization policy or runtime controller was changed. Existing data remains
untouched. Visitor identifiers rotate at UTC midnight; key/format cutover can
temporarily count an existing visitor again on the transition day. Stored older
paths are not retroactively anonymized by this collection-only change.

## Regression delivery map

All cases reside in the already registered `server/__tests__/support-ops.test.ts`.

| Requirement | Actual assertions | Boundary/limits |
|---|---|---|
| PV-MINIMIZE | Persisted records contain only coarse labels; queries, tokens, arbitrary paths and raw IPs absent; malformed inputs produce no write | Actual handler with recording sink |
| PV-KEYED | Exact domain-separated HMAC; key/day/IP separation; absent/blank/throwing secret and missing IP produce no writes | Fixture secrets only; no live values read |
| PV-ISOLATE | Immediate response with stalled/rejecting/throwing sink; no error disclosure; minimized-route dedupe expires at 30 seconds | No database call or browser navigation |
| PV-WIRING | Installed route invokes tested factory with existing limiter and parameterized path/hash values | Static wiring assertion, not live database persistence proof |

Normal material privacy/error-path Regression Guard coverage; no exception or
deferral substitutes for these tests. Separate review was not selected.

## Execution evidence

Supported invocation:
```
TASK_ID=1bc92e1d-057b-4d8b-baa6-e75ab3ca0115 \
TASK_PLAN_FILE=.local/tasks/1bc92e1d-057b-4d8b-baa6-e75ab3ca0115.md \
npm run gate:run -- --id 1bc92e1d-057b-4d8b-baa6-e75ab3ca0115 --tier test-standard
```

The registered complete 300000ms tier includes typecheck, storage lint, port
reference scan, storage-lint contracts, unit tests, Clerk release contracts,
Vite HMR tests and manifest parity. No skipped step, filters or alternative tier.

First run: all eight steps PASS, cleanup confirmed, unit tests 198/198;
overall **INCOMPLETE**, because tracked source changed during execution.
The observed change was removal of `exposeLocalhost = true` from .replit's 5001
port entry; this Agent did not edit it and did not revert it. No test failure
was baseline-waived. Full same-tier retry is required against the current state.

Final bound-tier outcome is recorded in the portable task registry and local
run evidence; delivery result will be updated when that retry completes.

Main application was already stopped; no live restart/reclaim is performed
under this request. Signed-in UI and production traffic were not exercised.
Host installation readiness remains NOT_OBSERVED, independently of task admission.

## Rollback

Restore compatible application source through checkpoints, retaining all task
IDs and validation history. No data restore is required or authorized. Restoring
the older collector would reintroduce its privacy defects. Keep the gate repair
separate; reverting it would reinstate the admission blocker without changing
actual installation acceptance.
