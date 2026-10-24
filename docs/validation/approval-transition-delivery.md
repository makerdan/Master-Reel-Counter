# Approval transition delivery

## Scope and admission

Native task 975 repairs approval idempotency and rejected-account conflict handling.
Classification: normal Regression Guard coverage for bug fix, authorization,
data integrity and concurrency. No promotion, final-Admin policy, schema, Clerk,
deployment or socket-eviction implementation changes.

Agent-first preflight inspected the canonical contracts, empty baseline catalog,
current tier manifest and approved scope before application edits or workloads.
The supported provisioner admitted local identity
`d34e33db-d6c0-4ba1-bacb-405b5005e34c`, revision 1, with `test-standard`;
`gate:guard` returned `ADMITTED` before implementation. No amendments or deferrals.

- Sealed plan: `.local/tasks/d34e33db-d6c0-4ba1-bacb-405b5005e34c.md`
- Plan SHA-256: `0aa8ef0d4e070432207bbb4de7b502a08c5627696e03f4d864281db063de2c37`
- Unified pin: `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`
- Regression Guard package: `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`
- Workload: `docs/validation/manifest.json`, hash
  `78b73575d338b3a1d7b39a33d624d29bbb3c763bb3161366731a5fcb10fe9675`

Admission and supervision enforce local seals and the bound workload; they do not
authenticate native approval or intercept arbitrary edits. Ordinary task approval
was the authorization. Separate read-only verification: **not selected**.

## Requirement-to-delivery map

All cases below are subtests of
`approval transitions — persisted state and mounted HTTP boundaries` in
`server/__tests__/routes.test.ts`. The fixture injects a real isolated `AuthStorage`
into the production singleton methods, mounts `registerAuthRoutes`, and exercises
real authentication, approval and Admin middleware with branded test session
identities backed by fixture rows. No provider requests or real accounts are used.

| Requirement | Planned guard | Actual delivery / detecting assertion | Disposition |
| --- | --- | --- | --- |
| R1: repeated approval preserves custom capabilities | Approve, grant through the capability endpoint, repeat and reread | `R1 genuine approval restricts defaults; repeat approval preserves a custom HTTP grant`: exports remains enabled in HTTP response and stored row; full row, including update timestamp, is unchanged; no reduction event | Delivered; unit-tests PASS |
| R1: concurrent grant survives stale approval reads | Controlled competing capability update | `R1 blocked repeated approval rereads a newer capability grant`: writer holds uncommitted grant while real HTTP approval sees the prior committed row; PostgreSQL lock-wait observation precedes writer commit; HTTP and stored exports remain true | Delivered; unit-tests PASS |
| R2: rejected account cannot be approved implicitly | Reject, approve, conflict and unchanged state | `R2 rejected approval conflicts without writes; explicit clear then approve recovers`: DELETE succeeds, subsequent PATCH returns 409 with clear-rejection guidance; complete persisted rejected row and notification list remain unchanged | Delivered; unit-tests PASS |
| R2: explicit recovery remains available | Clear rejection, then approve | Same recovery case POSTs clear-rejected, checks recovery notification and still-pending state, then approves successfully with rejected=false and restricted capabilities | Delivered; unit-tests PASS |
| R2: concurrent rejection cannot be overwritten | Controlled competing rejection | `R2 blocked approval cannot overwrite an intervening rejection`: observe blocked real approval before committing rejection; assert 409, rejected/unapproved stored state, preserved capabilities/timestamps and no spurious approval event | Delivered; unit-tests PASS |
| R3: genuine admission retains defaults | Pending target with a preexisting grant | First R1 case sets exports on a pending account; first successful approval stores the exact restricted capability map | Delivered; unit-tests PASS |
| R3: authentication, Admin, self and input guards remain | Boundary requests with persisted state checks | `R3 guards reject unauthorized, self-targeted, malformed and missing-target requests`: 401 missing identity; 403 ordinary/pending/rejected identities; 400 self-targeted enable/disable and nonboolean body; 404 missing target; denied target row unchanged; persisted role still governs Admin checks; existing final-Admin storage check retained | Delivered; unit-tests PASS |
| R3: admission reductions notify and reset grants | Remove approval after custom grant | `R3 admission removal resets capabilities and emits authorization reduction`: HTTP 200, stored approved=false, exact restricted defaults and approval_removed event; rejection case also checks account_rejected | Delivered; unit-tests PASS |

The storage transition reads the latest target with `SELECT ... FOR UPDATE` and
decides and writes in that transaction. Rejected approval returns a typed conflict,
missing targets return not_found, unchanged approved state performs no write, and
genuine approval/removal retains restricted defaults. The route maps typed outcomes
to HTTP responses and retains existing removal notifications and safety checks.

The former unconditional update would fail the stored-grant assertions and return
200 instead of 409 in both rejection cases. Those assertions test real persisted
behavior rather than intended mocked outcomes. This is recurrence-detection
reasoning; no unsafe old behavior was reintroduced into live resources.

## Tested revision and observed results

Base HEAD: `621fc2b7dc34bf25a5d4f26b52f198ec5866de74`, plus the delivered diff.
Tested application/test file SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `server/replit_integrations/auth/routes.ts` | `f0baf392d9074104b1d21f0064ccc4e1618d7f2db9ccbf65df2dbc5def0a2b34` |
| `server/replit_integrations/auth/storage.ts` | `786ba8d0cdb17c8546689aadf589e1908ab630c09f03a1e63cb8830edd129531` |
| `server/__tests__/routes.test.ts` | `3c0893795716cf3ba9723df64428a3dcee72306d87958beed772f3c96e2d34ee` |

Supported invocation:

```sh
TASK_ID=d34e33db-d6c0-4ba1-bacb-405b5005e34c \
TASK_PLAN_FILE=.local/tasks/d34e33db-d6c0-4ba1-bacb-405b5005e34c.md \
npm run gate:run -- --tier test-standard
```

Observed **PASS**, 2026-10-24T20:30:00.188Z–20:30:58.136Z.
Run `2b6bbca1-abcb-4b5c-956a-51f8bcbd143f` is retained in
`docs/validation/unified-registry.json`; detailed local evidence:
`.local/failure-gate-unified/runs/2b6bbca1-abcb-4b5c-956a-51f8bcbd143f.jsonl`.
Before/after tested target hashes match:
`c0330a74e6aaaa4f4d4433d3aa5b776e334411b5f3d63f4cbbc4c00ae5316bfe`.

| Step | Result |
| --- | --- |
| typecheck | PASS |
| storage-lint | PASS |
| port-reference-scan | PASS |
| storage-lint-contract | PASS, 16 tests |
| unit-tests | PASS, 205 tests; zero skipped |
| clerk-release-contract | PASS, 72 + 9 tests |
| vite-hmr-tests | PASS, 9 passed; 1 existing opt-in recovery test skipped by this tier |
| manifest-parity | PASS |

The first admitted run caught an introduced TypeScript narrowing error in event
assertions and reported INCOMPLETE with a changing target; it is not acceptance
evidence. Assertions now compare event copies. The complete rerun above passed
without baseline exclusions, source changes or omitted configured steps. This
handoff document was added afterward; the tested code hashes remain unchanged.

The app was restarted successfully and the public landing page was captured.
The signed-in UI was not verified; protected behavior was verified through the
mounted HTTP and database cases instead.

## Remaining boundaries

No current-scope requirements are deferred. Final-Admin concurrency/access policy
and atomic partial capability edits are separate proposed follow-ups, not claims
of functionality delivered here. Realtime eviction remains a separate assignment.
No production or identity-provider state was modified.
