# Label scan resource bounds

## Context

- Scope: assigned security repair for excessive session label-scan image resources, including the equivalent single-photo scan path.
- Admitted plan: `.local/tasks/d3da8c23-8f0e-4b45-a99d-44c2ba36261d.md`, revision 1.
- Unified contract: `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Regression Guard contract: `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- Preflight: local guard admitted revision 1 before application edits.
- Validation: `TASK_ID=d3da8c23-8f0e-4b45-a99d-44c2ba36261d TASK_PLAN_FILE=.local/tasks/d3da8c23-8f0e-4b45-a99d-44c2ba36261d.md npm run gate:run -- --id d3da8c23-8f0e-4b45-a99d-44c2ba36261d --tier test-standard`.
- Separate independent verification: not selected.

## Requirement map

| Requirement | Delivered guard | Detecting assertion | Evidence |
| --- | --- | --- | --- |
| R1: bounded actual downloads | `readBoundedScanImage` used for both object-storage and local scan reads | Exact limit accepted; overflow and stream errors reject and destroy the stream; route wiring reaches bounded readers | `server/__tests__/routes.test.ts`, `label scan resource boundaries` |
| R2: bounded decode and retained memory | `prepareLabelScan` checks actual input bytes and metadata dimensions, rejects multiple pages, and keeps only bounded crops between photos; explicit Sharp limits and operation timeouts | Header-only pixel bomb, individually valid photos exceeding aggregate pixels, trailing bytes exceeding aggregate input, and excessive crop payload all reject; ordinary rotated crops match production crop output | Same suite; real Sharp image fixtures |
| R3: concurrency, isolation and cleanup | Shared nonqueued process-wide slot used by both scan endpoints; release in each route's `finally`; only current-session photos prepared | Overlap rejects with 429, error cleanup admits the next scan, stale release cannot unlock a later scan, foreign/missing photos are never loaded, and both production handlers acquire after authorization and prepare before provider calls | Same suite; production-helper execution plus route-wiring assertions |

## Operational behavior and limits

- Per scan: at most 64 MiB of compressed input, 40 million source pixels, and 16 MiB of retained base64 crop data. Each photo is limited to 20 million pixels and one page.
- Full transformed images are scoped to one preparation call, not stored across the session. Sharp processing is sequential and each decode has an explicit pixel limit; transform/extraction operations have a 10-second native processing timeout.
- Download streams have a 15-second deadline and are destroyed on completion or failure. Actual streamed bytes, not database sizes or storage metadata, enforce the budget.
- Resource violations return 413 before any AI call or result persistence. Concurrent scans return 429 with `Retry-After: 5`; they are not queued.
- The slot protects one Node process, not a distributed fleet. Every serving process has the same local memory bound. Existing request rate limits and provider boundaries remain unchanged.
- Existing image uploads, session access checks, provider batches, scan result shape and persistence remain in place. Legitimate images/scans above the new limits must use smaller photos or fewer pins.
- Preview restarted successfully; the public landing page rendered. Authenticated scanning UI was not browser-verified; backend regression fixtures cover the changed processing boundary.

## Validation outcome

The first admitted run (`30209e55-9fca-406f-9e5b-28878e4d1395`) observed PASS for all eight steps, including the unit tests and compiler checks, but was correctly marked INCOMPLETE because these delivery notes changed the target fingerprint during execution. It is not a tier PASS. Final stable-target validation is recorded under the same admitted plan in `docs/validation/unified-registry.json`; use its latest observed outcome, not the earlier incomplete run.
