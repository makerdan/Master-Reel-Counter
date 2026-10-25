# Unified bounded-recovery maintenance update

## Scope and outcome

Owner-directed gate maintenance in the original Master Reel Counter only, using
the six-file package in the supplied `failure-gate-unified_(10.24.2026)` archive.
No maintenance task, reviewer, live task identity, ordinary task execution,
application behavior, deployment, database data, remote CI setting, runtime
mirror, shared library or other custom skill was changed. No task was resumed,
relocated, resealed, rebound, closed or assigned a new executor.

**Delivery:** the complete package and compatible prospective selection are
installed. **Maintenance checks:** all 58 focused cases passed.
**Acceptance:** task-worker propagation, workspace restart and host restore
remain NOT_OBSERVED. **Activation:** unchanged; no disabled capability enabled,
accepted capability disabled, generic readiness flag added, or owner obligation
waived. Current-checkout checks are available; five historical tasks remain
individually blocked by missing local plans. This is not an ordinary tier PASS
or a claim of complete host acceptance. Native task-board status was not changed.

## Contract identities and changes

- Old full normative contract:
  `1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736`.
- New full normative contract:
  `5ea3dd706f5b8ab94ab7d9a2ce95365ed678d8acccb7f64cc7b78e178bd0323b`.
- Unchanged core SHA-256:
  `5a6f9d37b404108c19768969f7607e188a9b17c9cc80a595020f2b4eed2c6681`.
- Unchanged adopted Regression Guard contract:
  `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.

Inspected every supplied file and the existing canonical package, selected pin,
contract/store/plan/CLI consumers, gate tests, active project guidance and relevant
prior maintenance/delivery evidence. The supplied previous-contract identity
matches the selected contract. There was no separate newer/custom governing
contract to downgrade. The core and planning reference are byte-identical;
the maintenance reference, manifest and revision notes change. All six supplied
files, including unchanged payloads, were installed directly into the canonical
directory, without a nested `main/`.

Archive inspection rejected unsafe paths, duplicate members, symbolic links and
encrypted entries, checked a finite extracted-size bound, and verified all
declared file lengths/hashes and the full normative fingerprint before extraction
to a fresh temporary directory. The final canonical package and new immutable
snapshot both match all six ZIP entries byte-for-byte.

The existing runtime already verifies all normative files and supports historical
package descriptors. No runtime handler, storage design, recovery operation,
approval adapter, allocator or dependency change was needed. Under the existing
`withWriter` transaction, the prior selection and accessible live state were
rechecked, before-source records preserved, the immutable new snapshot installed,
and canonical payloads plus prospective pin written through `atomicWrite`.
The lock excludes supported writers/runners; it does not intercept arbitrary
editor or platform operations. Mixed source/pin observations fail closed.
All four previous revision descriptors remain exact; the fifth descriptor is
additive. No live registry was copied, reset or reconstructed.

AGENTS.md and replit.md now explain environment-first diagnosis, task-executor
idleness versus unrelated services, bounded missing-state searches, separate
authorization for future operation after loss, and distinct delivery/acceptance/
activation/native-status reporting. Existing dedicated follow-up constraints
remain unchanged. Definition text is cooperative Agent guidance, not a new
automatic runtime recovery handler or proof of future Agent compliance.
Platform instruction refreshes may replace runtime guidance; this reconciliation
is retained in canonical project guidance without editing a runtime mirror.

## Preservation evidence

Archive:
`docs/validation/archive/unified-bounded-recovery/2026-10-25/`.

The complete prior six-file package was verified against its existing immutable
snapshot before replacement; it remains unchanged at
`docs/validation/unified-revisions/1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736/`.
The archive retains exact before-pin mappings, AGENTS.md, replit.md and the changed
gate test, with a historical-only README and preservation inventory.

All **631 of 631** preservation hashes match after maintenance: existing contract
and companion snapshots, local task files, recorded local run/summary files,
baseline, tier workloads and root/sandbox dependency manifests.
The live registry remains byte-identical:
`3b72e584c977d76c9dd9b5661f29ae1796fd1558d3e931383dff5cc73531ae0d`.
All **28 identities and 28 tombstones** retain their original records and seals:
8 single-file, 16 previous modular, and 4 host-portable bindings. None uses the
new contract merely because this source update was installed.
The accessible registry had no reserved task or unresolved RUNNING operation.
The writer lock was acquired without cancelling an operation or stopping services.
Inaccessible worker state was not reconstructed; main is not evidence of every
worker's reservations, dependencies or ownership. No checkpoint search was needed
or restarted because main's authoritative registry was intact.

## Actual bounded maintenance results

1. `timeout --signal=TERM --kill-after=5s 150s node --test scripts/__tests__/unified-gate.test.mjs scripts/__tests__/unified-gate-retry.test.mjs scripts/__tests__/unified-gate-summaries.test.mjs`
   - Exit 0; **58 passed, 0 failed, 0 skipped, 0 cancelled**, 30.512 seconds.
   - This full combined invocation passed, not just a filtered retry.
   - Log: `/tmp/unified-bounded-recovery-maintenance.log`.
2. `timeout --signal=TERM --kill-after=3s 20s node scripts/unified-gate.mjs status`
   - Exit **2**, top-level **BLOCKED** for the five task-scoped missing plans below.
   - Actual inspected environment **CHECKS_AVAILABLE**, selected new full contract,
     16 runner/helper files, adopted policy valid, native SQLite in-memory query
     successful, Node v20.20.0 and Git 2.54.0.
   - Zero baseline entries/warnings; existing local hooks configured.
   - Acceptance remains NOT_OBSERVED; no new acceptance or activation claimed.
   - Observation: `/tmp/unified-bounded-recovery-status.json`.
3. `timeout 20s npm run gate:merge-guard`
   - Exit 0, READY for task/tombstone and committed-history preservation only.
4. Package/manifest/full-contract checks, all six canonical/snapshot byte
   comparisons, exact prior-map/policy comparisons and all 631 preservation hashes
   succeeded. `git diff --check` was clean.

Temporary logs are session evidence, not required future authorization receipts.
The tested gate test SHA-256 is
`f9f8d470f3c3816a06e2ebf3735a75c280da4cc85239c67b552fb001f9c1256f`.
The selected pin file SHA-256 is
`da30da90349b6fe7e88365ae19f70d2f0292dd378ca8f1291c97439ab148fd9a`.
The application test tiers were not run or changed. No unrelated warning or
existing application/release failure was relabelled as passing.

## Regression Guard handoff

Classification: **normal guard required** for compatibility/recovery-policy
changes. Authorization is the owner's gate-maintenance exception, not ordinary
task admission. Separate read-only verification: **not selected**.

| Requirement | Delivered guard and actual assertion | Evidence / limit |
| --- | --- | --- |
| Core-only pin accepts changed maintenance rules | Strengthened `new modular admissions preserve old bindings and task-specific restart obligations`: replace the old maintenance reference with the new valid reference while leaving identical core bytes and old selection; real guard rejects, workload sentinel absent, historical record unchanged | Combined passing maintenance suite; safe negative control in a disposable repository |
| Prospective update rewrites historical policy or acceptance | Same fixture checks every prior descriptor and acceptance object unchanged, historical guard succeeds under its recorded pin, new admission selects a different pin, explicit restart obligation and prior record remain intact | Combined passing suite; no live IDs or records used |
| Incomplete package or lost recovery/deferral instructions | New `selected maintenance package verifies all six files and preserves recovery decision boundaries` checks exact payload lengths/hashes, immutable snapshot bytes, unchanged core and concrete maintenance boundaries | Combined passing suite; instruction artifact coverage, not automatic Agent enforcement |
| Existing binding, cleanup, retry and reporting guarantees regress | Existing main, retry and summary fixtures retain wrong-tier/seal/revision rejection, bounded dispatch/cleanup, concurrency, fresh-process recovery and honest summary coverage | All three suites passed together; fresh process is not workspace restart or task-worker acceptance |

## Unresolved limits and next prerequisites

Five sealed historical tasks lack local plan files:

```text
e5723d04-c01b-47c4-8fcc-aa09dfb9e154
c1f179ff-48dc-4754-9327-e2f627cbf06c
5b7b81f0-7985-48a0-be6f-cf8ea1f13322
f208beda-d34e-4b11-9c15-0342f3b9efe5
aa4227c8-a7e9-4c86-a6e6-982fed1ec67c
```

Their existing supported exact-plan recovery route remains available where
authorized, followed by their own preflight. This update does not authorize
using it, inventing replacement plans, resuming those tasks, or resolving
unestablished executor ownership. Missing local copies do not prove loss of
authoritative state or historical test failure. The limitation is task-specific,
not a denial of every valid unrelated admission.

Current-checkout fixtures and fresh child processes were exercised; isolated
workers, actual workspace restart and host restore were not. Explicit
owner-selected restart requirements remain binding. Main source changes do not
synchronize workers. Their actual environment must be inspected before affected
execution; any handoff still needs authorized scope, one confirmed-idle prior
executor and reconciliation of accessible conflicting state. Unrelated
development services were left running. No whole-host shutdown, native status
change or new acceptance ceremony was attempted.

## Compatible rollback

With supported gate writers/runners quiescent, restore the prior canonical
six-file package from its immutable snapshot, restore compatible guidance/tests
from the before archive as appropriate, and select the old full-contract identity
through the same guarded source/pin maintenance route. Before changing selection,
inspect the current pin and later records; retain every revision descriptor,
including the new snapshot if any work was subsequently sealed under it.
Do not blindly overwrite the current pin with the archived older map.

Never rewind, overwrite or replay the live registry, IDs, tombstones,
reservations, seals, local task files, run results or locks. Source rollback
does not waive obligations, claim historical acceptance, resume an executor or
perform a native task-board action. No application/data/deployment rollback is
involved.
