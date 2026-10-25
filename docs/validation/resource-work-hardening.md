# Excel export and storage-size backfill hardening

## Scope and validation context

Security, performance/reliability and concurrency changes only. No new flow,
entry-creation restrictions, schema migration or background processing.
The admitted plan is revision 2 of
`43ef035b-95b8-4785-9d16-43e5ccecfc3d`, associated with assigned task 1017.
Its Regression Guard contract is
`1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
Agent-first `gate:guard -- --tier test-standard` succeeded before implementation.
The second revision addresses completion feedback about failure starvation and
misleading progress. Its pre-implementation guard also passed; the existing
button now supports continuation and reports batch progress. No independent
verifier was selected.

## Limits and compatibility

- Excel allows 5,000 entries, 2,000 photos and 10,000 pins. SQL fetches at
  most limit + 1 and rejects overflow with HTTP 413 before decryption or workbook
  construction. Reports are never silently truncated.
- Excel section totals use one input traversal, with distinct tuple keys for
  aisle/section values. Existing footage and reel-count conventions are preserved.
- Backfill selects at most 101 missing-size photos using an owner-filtered join;
  only 100 may trigger work, with one lookahead row for continuation.
  Trashed sessions remain excluded. There is no unbounded session-ID list.
- Backfill stops starting photo work after 15 seconds or a detected disconnect.
  Each file's storage HTTP requests have a 3-second timeout and zero retries;
  the timeout is applied to request options, not metadata query parameters.
  The existing local-stat fallback remains. The batch budget is checked between
  photos, not a guarantee that the full HTTP response completes in 15 seconds.
  Database latency and credential acquisition remain infrastructure dependencies.
- Backfill retains `{total, updated, failed}` and adds `hasMore` and `nextCursor`;
  `total` is processed in this call, not all eligible photos. A validated optional
  `afterPhotoId` continues strictly after the last attempted row, even on failure
  or time-budget cutoff. A new pass from zero can retry all remaining failures.
  Cursor values cannot remove the owner filter or change the batch cap.
- The existing settings action retains the cursor for its next request, labels
  the button Continue while work remains, and describes batch counts rather
  than claiming all files are complete. Ending a pass resets the cursor.
  Identity changes clear the local cursor. Errors preserve continuation for retry.
- Excel allows five requests per user per minute; backfill allows two.
  Failed and overlapping attempts count toward the same budget. Each operation
  allows one active request per user and two active users per server process.
  Limiters and active-work sets are process-local, consistent with the existing
  application rate-limit infrastructure; they are not distributed quotas.
- Work slots release when handlers settle, not when a client disconnects.

## Requirement-to-delivery map

All cases are in `server/__tests__/bounded-resource-cases.ts`, registered by
`server/__tests__/routes.test.ts` in the canonical `unit-tests` tier step.

| Requirement | Recurrence guard and detecting assertion | Delivery |
|---|---|---|
| Linear section calculation | Distinct sections aggregate in one traversal; exactly 5,000 input visits and correct multi-reel/repeated-location totals; delimiter-bearing locations remain distinct | Executable aggregation cases plus real workbook section-band assertion |
| Bounded Excel database work | Each entry/photo/pin limit-plus-one overflow rejects before subsequent queries; a real 5,001-entry session returns 413 | Bounded-query cases and real production HTTP handler |
| Workbook compatibility | Real workbook parses successfully and contains the expected two-entry, five-reel, 110-foot section band | Production HTTP export fixture |
| Bounded owner backfill | Compiled SQL contains ownership, null-size and trash filters plus SQL limit; real owner batches process 100 then 3 photos and never foreign/trashed keys | SQL compilation and production HTTP handler |
| Repeated requests | HTTP 429 after exact per-user budget; independent user still succeeds; rate-limited calls perform no additional cloud reads | Mounted protection and production handler cases |
| Overlapping requests | A deferred cloud lookup keeps the first handler active; a second actual backfill returns 429 with one total cloud call | Production HTTP deferred-storage fixture |
| Concurrency and cleanup | Global capacity returns 429; exceptions and completed handlers release capacity; user budgets remain separate | Mounted protection cases and deterministic saturation assertion |
| Storage failure and timeout policy | Failed metadata and local fallback report one failure; repeated failure cannot bypass budget; request interceptor sets a 3,000ms timeout and zero retries on each metadata operation | Production HTTP storage fakes inspect actual file-local options |
| Failed-prefix starvation | 100 persistently failed earlier objects return a cursor; the next real bounded request reaches and sizes later valid photos; a fresh selection from zero still contains the failed rows | Production HTTP continuation fixture |
| Deadline continuation | A deterministic clock advance during the first cloud operation stops the batch; the returned last-attempt cursor resumes all remaining photos on the next request | Production HTTP time-budget fixture |
| Truthful progress | Pure presentation tests assert the cursor, more-photos message, per-batch counts and later-pass retry message; Settings uses that shared result and sends its cursor | Shared presentation helper wired to the existing settings action |

## Evidence

The bound invocation is:

```sh
TASK_ID=43ef035b-95b8-4785-9d16-43e5ccecfc3d \
TASK_PLAN_FILE=.local/tasks/43ef035b-95b8-4785-9d16-43e5ccecfc3d.md \
npm run gate:run -- --tier test-standard
```

Observed run outcomes, tested-target fingerprints, any guarded diagnostics and
failure classifications are retained in the existing append-only Unified
registry under this plan identity. This document maps delivered assertions; it
does not independently claim that an unobserved or failed command passed.
