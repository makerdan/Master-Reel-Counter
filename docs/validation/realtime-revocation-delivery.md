# Realtime account revocation — delivery

## Context and admitted revision

- Approved scope: F-003, account eviction and asynchronous room admission; authorization and concurrency/lifecycle repair. No provider configuration, deployment, frontend or multi-process changes.
- Unified identity: `3377dcff-a1df-4f30-9439-0707a0a66949`, sealed revision 1.
- Plan SHA-256: `a31a2bdf80993a45b76fa46ed74bdf263dcabde221575019739e983492bd737a`.
- Unified normative contract: `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Regression Guard normative contract: `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- Preparation: `docs/validation/realtime-revocation.spec.json`; generated sealed plan/stubs remain environment-local, not committed.
- `gate:new` provisioned and bound only `test-standard`; Agent-first `gate:guard -- --tier test-standard` returned ADMITTED before application edits. No amendment or scope deferral.
- Baseline catalog inspected: empty records array; no failures ignored or self-classified.
- Local guard/runner checks do not authenticate native approval or intercept platform actions. Installation-wide acceptance remains NOT_OBSERVED, independent of this task's valid admission and observed workload.

## Delivery

`server/realtime-authorization.ts` now evicts the account's entire tracked socket set, not just room members. It marks each affected socket revoked before clearing membership and closing with 1008. The terminal marker prevents stale asynchronous work from restoring access even before close cleanup completes.

The production `/ws` join handler in `server/routes.ts` calls `joinRealtimeRoom`, which retains session authorization/version retries and adds current persisted account admission. Both async checks sit inside the session-consistency retry, so a collaborator removal during account lookup cannot make the earlier session result valid. After these checks, admission requires the same tracked socket-info object, an open socket, and no revocation marker. Membership insertion and acknowledgement have no intervening await.

Protected room broadcasts use the shared production `broadcastRealtimeRoom` boundary, allowing the fixtures to assert actual delivery/exclusion with the same room registry and implementation. Existing account notification routes remain unchanged.

## Requirement-to-delivery map

All cases below are in `server/__tests__/routes.test.ts`, under `RealtimeAuthorizationTracker`. Fifteen new deterministic cases use isolated in-memory socket/room state and context-restored persisted-account lookup mocks. They call the production admission, eviction, account-outcome and broadcast functions; no live Clerk account or production data is used.

| Requirement | Planned guard | Actual assertions and outcome | Disposition |
|---|---|---|---|
| R1: rejection and approval removal close joined and unjoined sockets | Extend account eviction coverage | For each outcome, `closes joined and unjoined sockets and excludes later broadcasts without affecting another account` asserts 1008, the exact authorization outcome, cleared membership, and no successful later unjoined admission. Existing multi-room eviction coverage also passes. | Delivered, PASS |
| R2: delayed authorization cannot restore revoked access | Controlled production-boundary delayed joins | For each outcome, `during delayed session authorization cannot restore room access` and `during delayed account authorization cannot restore room access` release held authorization after eviction and assert no joined acknowledgement, no membership and no protected update. Stale account reads deliberately return approved. | Delivered, PASS |
| R2: current admission and socket lifecycle remain required | Current account and closed-socket guards | Pending, rejected and missing accounts are denied even with owner session access. Closing, closed, removed and replaced socket records cannot be inserted after a delayed authorization result. | Delivered, PASS |
| R3: unrelated approved users remain connected | Isolation and positive coverage | Both outcome families retain the other user's room membership, deliver its protected update and assert no close. Approved owner/viewer joins preserve roles, switch rooms correctly and receive broadcasts; denied session access remains denied. | Delivered, PASS |
| Preserve collaborator-removal behavior | Existing eviction/version tests plus delayed boundary case | Existing collaborator eviction tests pass. `session invalidation during account admission still rechecks collaborator access` invalidates session permission while account lookup is pending and asserts a second session lookup, denied_join, 1008 and no room creation. | Delivered, PASS |

### Recurrence sensitivity

- The joined/unjoined cases assert that both sockets close; the old room-only eviction omits the unjoined close.
- The fake sockets intentionally remain OPEN after close, so room and broadcast assertions cannot pass merely because transport readiness hides stale membership.
- Delayed tests hold the exact production authorization dependency and release it after eviction; without the terminal revocation check they insert the stale socket and acknowledge it.
- Fresh-admission tests fail if account checks are removed. Lifecycle cases fail if final registration/readiness checks are removed.
- The invalidation case fails if session consistency covers only the earlier session read rather than the complete async admission decision.

## Observed validation

Supported full-tier invocation:

```sh
TASK_ID=3377dcff-a1df-4f30-9439-0707a0a66949 \
TASK_PLAN_FILE=.local/tasks/3377dcff-a1df-4f30-9439-0707a0a66949.md \
npm run gate:run -- --tier test-standard
```

**PASS**, run `2dfaa9e3-c19c-40e5-8c7c-8286d204a0fa`, 2026-10-24 20:29:02–20:30:22 UTC, approximately 80 seconds. All eight registered steps returned PASS with complete cleanup and no timeout, interruption, output truncation or unreached steps:

- typecheck
- storage-lint
- port-reference-scan
- storage-lint-contract
- unit-tests — 213 passed, 0 failed/skipped/cancelled
- clerk-release-contract
- vite-hmr-tests — 9 passed; its recovery-only case is conditionally skipped in the unchanged standard workload, not exercised or claimed passing here
- manifest-parity

Workload SHA-256: `78b73575d338b3a1d7b39a33d624d29bbb3c763bb3161366731a5fcb10fe9675`.
Tested source filesHash: `bfd7f25b49ffc088fe74d5bbe5f4663245649031e607f2596728bea42b47e8dd`.
Tracked registry contains the revision-bound run observations; local detailed evidence is `.local/failure-gate-unified/runs/2dfaa9e3-c19c-40e5-8c7c-8286d204a0fa.jsonl`.

Implementation file SHA-256 values, unchanged after the successful run:

| File | SHA-256 |
|---|---|
| `server/routes.ts` | `b8a8d7a54f9412fda041ebd73663401e02d35581c6002cc2196c0769ba14cfc2` |
| `server/realtime-authorization.ts` | `27d117299873a851f20c43a8a85eb612a060f3078746e846174bd0fdbaef3883` |
| `server/__tests__/routes.test.ts` | `3072d2b7077a5c53ea3e7da0821802d6f1329ccae6a9d4114e4ab7dae03122b9` |

This handoff was added after the run; it changes documentation, not the measured implementation or workload.

An attempted filtered `typecheck` diagnostic was rejected before running any workload because diagnostic dispatch permits only registered test steps. No bypass was used; the full admitted tier above includes the successful typecheck.

## Runtime check and limits

- Restarted the existing application workflow once after backend changes; server reported ready on port 5000.
- Public landing-page screenshot loaded successfully. No signed-in UI was verified; the public page's unauthenticated 401 is not realtime authorization evidence.
- New cases exercise controlled production backend boundaries, not real authenticated network clients or provider sessions. Separate test-only follow-ups propose full administrator-HTTP-to-WebSocket wiring and periodic identity-revalidation coverage; neither is a deferral of R1–R3.
- Multi-process revocation remains outside the approved scope.
- Separate read-only verification: not selected.
