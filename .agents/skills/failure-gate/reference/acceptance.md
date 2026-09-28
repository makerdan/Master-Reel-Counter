# Failure Gate v4 — acceptance reference

This is a test matrix, not test results. The original approved v4 source is
identified in `docs/validation/task-907-bootstrap-observation.md`. Mark
categories verified only after actual executable evidence and a post-change
comparison against the prior governing policy. The local implementation
cannot prove external platform dispatch.

| Category | Required evidence |
|---|---|
| Portability and discovery | Example paths/tier names/memory/catalog are optional; no invented manual or automated checks |
| Identity and namespace | Unique persisted IDs/tombstones after restart; provisional drafts cannot run; independently issued task and exact approved plan bind atomically |
| Activation | Plan guards work before activation; missing approval or mismatched plan/version leaves draft blocked; audit failure rolls back permission |
| Tier lock and override safety | Wrong task, wrong plan, path escape, stale digest, alternate tier, argv/config/env coverage override launch zero steps |
| Approval and transition | No self-approval; one pending request, idempotent compare-and-swap, audit and plan projection atomicity, rejection preserves independent suspension |
| Concurrent lifecycle | Launch versus amendment/cancel/release races cannot orphan an accepted run or replace a live lease |
| Snapshot integrity | Dirty/untracked/generated/dependency inputs reflected; report outputs excluded; concurrent edits and contaminated earlier snapshots cannot be accepted |
| Run completeness | Ignored failing tests do not hide missing steps/reports/discovery; raw failures persist; diagnostics and ad-hoc runs never substitute full validation |
| Retries and provenance | Exactly three permitted isolation retries; passing retry is intermittency only; pre-existing requires earlier snapshot plus independent corroboration |
| Catalog and ownership | Exact environment/variant/signature match, expiry/revocation recheck at completion; owned repair survives expiry, skipped/deleted/renamed tests |
| Recovery | Poll timeout does not start duplicate; safe quarantine/stop; terminal cleanup revokes permission and retains history without passing validation |
| Local completion | Recompute acceptance from final inputs, plan/policy versions, full results and ownership; reject stale/forged results |
| Security | Bound reports; reject path escapes, shell injection, secret-bearing logs and forged trusted identity |
| Migration | Existing coverage and audit thresholds retained; no second active authority or invented historical approval |
| Platform handoff | Requires observed platform-origin active ID + exact plan, single checked invocation, run and decision; local launcher fixtures do not prove this |

The task 907 baseline is blocked by the absent platform-owned legacy mirror;
do not classify its eight release-contract failures as known unrelated
baselines. Replacing mirror parity with canonical/published source parity
requires separate acceptance under the prior policy; tests can exercise
candidate behavior without claiming that operational cutover happened.