# Unified host-portable execution update

## Delivered scope and identity

Owner-authorized gate-only maintenance in the original Master Reel Counter.
No new maintenance task, live UUID, application work, tier/workload change,
deployment, remote CI setting, shared-library publication, runtime mirror update
or unrelated skill migration. No independent reviewer or replacement orchestration.

Installed all six supplied payload files from the ZIP's `main/` wrapper at
`.agents/skills/failure-gate-unified/`. Revision:
**host-portable-execution-and-status-handoff**.

- Full normative contract: `1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736`.
- Core: `5a6f9d37b404108c19768969f7607e188a9b17c9cc80a595020f2b4eed2c6681`.
- Both normative references were read in full; the manifest covers their bytes.
- Exact new snapshot: `docs/validation/unified-revisions/1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736/`.
- Updated `unified-pin.json` prospectively; all older revision descriptors and
  the adopted Regression Guard identity remain unchanged.

Manifest payload sizes/hashes, full-contract encoding and exact supplied bytes
were verified before installation and after maintenance. The manifest is content
metadata, not approval, task admission or host acceptance.

## Discovery and reconciliation

Existing Unified was active, not dormant infrastructure. Read current instructions,
core/references, pin, contract/store/plan/execution/CLI/tier wiring, tests and prior
maintenance deliveries, including admission-readiness repair, guarded retries and
run summaries. Retained the existing bounded maintenance route and all retry/
summary behavior. Caller search found no active consumer requiring `status` to
return the literal READY string. Historical instructions/results are not rewritten.

The earlier admission repair already separated valid admission from the global
installation-acceptance flag. The remaining obsolete rule was `gate:status`
reporting BLOCKED solely because generic workspace-restart acceptance was absent.
AGENTS.md/replit.md also described that generic boundary as current readiness.
Those are superseded for current operations. No owner-specific task requirement
was waived and no prior exception was relabelled PASS.

Changed integration:

- `store.mjs`: read-only environment availability checks before new admission/
  amendment and modular-plan guarding. Verify actual selected full contract,
  adopted Regression Guard policy, 16 required local runner/helper files and
  their reported hashes; exercise native SQLite in memory and Git output.
  No live lock or ledger is opened by this probe.
- `unified-gate.mjs`: status reports actual CHECKS_AVAILABLE for the inspected
  process/checkout separately from runtime acceptance and historical task blockers.
  Missing/damaged runtime or policy still rejects the operation. An OBSERVED flag
  alone cannot produce an available result. No ordinaryReady flag was toggled.
- Main gate tests: false readiness rejection, missing runner/policy before ID
  consumption, preservation of the previous modular contract and owner-selected
  restart obligation, context separation, and fresh child-process exact-plan
  recovery plus bound fixture dispatch. Renamed a simulated filesystem-copy test
  so it does not claim observation of a native task environment.
- Retry test fixture: include the existing `run-tier.mjs` in its disposable copy,
  as required by the complete-runtime check; selection/cleanup assertions unchanged.
- AGENTS.md/replit.md: scoped readiness, distinct lifecycle observations, one
  authorized executor, destination admission and separate native-status handling.
  Current Follow-up Tasks rules remain intact; no publisher or task API added.

Checks execute only in the calling environment. Source hashes identify inspected
code, not a machine identity, remote host service or approval authority. They do
not promise all application-tier dependencies are healthy; a bound workload still
requires its actual dependencies and successful execution.

## Preserved history

Archive: `docs/validation/archive/unified-host-portable/2026-10-24/`.
It retains exact before-package bytes, references, pin, changed runtime/tests and
project instruction surfaces, with a historical-only README and inventory.

All **22 task identities and 22 tombstones** remain byte-for-byte in the live
registry. Revision distribution stays **8** under the historical single-file
contract and **14** under the previous modular contract. No existing task was
amended, rebound, closed, cancelled, transferred, approved or assigned the new pin.
No live ledger was copied into this archive or a fixture.

All **552 recorded preservation hashes** matched after maintenance: prior
contract snapshots, local task files present at discovery, companion-policy
snapshots/pin, baseline, workloads and dependency manifests. All prior selected
revision mappings match the before-pin. Newly admitted fixture plans select the
new revision; historical fixture plans retain the old revision and requirements.

## Actual bounded maintenance evidence

No ordinary application-tier PASS is claimed.

1. `timeout --signal=TERM --kill-after=5s 150s node --test scripts/__tests__/unified-gate.test.mjs scripts/__tests__/unified-gate-retry.test.mjs scripts/__tests__/unified-gate-summaries.test.mjs`
   - Initial run: 45 passed, 11 failed, 21.856s. All 11 failures were the retry
     fixture omitting `run-tier.mjs`; the new availability check rejected it.
   - After including the required file, targeted retry suite: **11 passed**,
     15.201s; no weakened runtime check.
   - After adding adopted-policy integrity probing, full run: **55 passed,
     1 failed**, 21.510s. The negative test correctly rejected policy drift but
     expected the word “mismatch”; actual error was “Regression Guard:
     core/reference contract drift.”
2. `timeout --signal=TERM --kill-after=3s 35s node --test --test-name-pattern='claimed acceptance|new modular admissions' scripts/__tests__/unified-gate.test.mjs`
   - Corrected the expected error and strengthened the historical binding case
     to exercise the real previous modular snapshot. **2 passed**, 33 explicitly
     skipped by selection, 0.859s. Those skips are not reported as passing tests.
   - Together with unaffected full-run results, all **56 distinct current
     maintenance cases have applicable passing evidence**. There is not a claim
     that the last full invocation alone passed every case.
3. Exact package/manifest/full-contract checks succeeded; preserved-file checks
   had zero mismatches; live ledger digest is unchanged; `git diff --check` clean.
4. `timeout 20s node scripts/unified-gate.mjs status`:
   - Exit **2**, top-level **BLOCKED** for 21 affected historical task plans.
   - Inspected execution environment: **CHECKS_AVAILABLE**; 16 runner/helper
     files present, selected policies valid, native SQLite query succeeded.
   - Actual Node `v20.20.0`, Git `2.54.0`; zero baseline records/warnings.
   - Host acceptance remains **NOT_OBSERVED**. No readiness flag promoted.

Session logs: `/tmp/unified-host-portable-maintenance.log`,
`/tmp/unified-host-portable-retry.log`, `/tmp/unified-host-portable-final.log`,
`/tmp/unified-host-portable-targeted.log`; live status observation:
`/tmp/unified-host-portable-status-final.json`. These are temporary session
evidence, not required future authorization receipts.

## Regression Guard delivery map

Classification: **normal guard required** for material gate availability,
admission/reporting and compatibility changes. Covered as owner-directed gate
maintenance, not application admission. Separate verification: **not selected**.

| Boundary / recurrence | Delivered assertion | Evidence |
| --- | --- | --- |
| Unobserved generic restart becomes universal block | Valid fixture admission/bound run allowed while all host lifecycle observations remain NOT_OBSERVED | Main suite plus changed status assertions |
| False acceptance hides broken runtime or companion policy | Missing runner or drifted normative reference rejects availability/admission; registry bytes unchanged | Targeted negative case |
| Update silently changes old binding or erases explicit restart requirement | Prior modular pin, entire historical record and requirement text unchanged; new task pin differs | Strengthened targeted history case |
| Context reused for another task | CLI rejects differing TASK_ID and selected ID; old task has no run | Same targeted history case |
| Restart/recovery mints another identity or skips binding | Fresh child processes restore exact sealed fixture plan, guard/run bound workload and reuse claim with one tombstone | Main suite fresh-process case |
| Existing safety controls or reporting regress | Wrong-tier/seal/revision/merge checks, bounded cleanup, diagnostic/retry selection and truthful summary cases retained | Unaffected main/retry/summary checks |

## Environment-specific readiness and blockers

| Environment / boundary | Actual observation | Disposition |
| --- | --- | --- |
| Current main checkout / process | Full policy/runtime availability and native dependency outputs checked; bounded disposable provision/guard/runner tests exercised here | Supported maintenance evidence, not a live application admission or universal READY |
| Fresh Node processes | Actual child CLI guard, exact-plan recovery and bound fixture dispatch | Observed process behavior on this host |
| Filesystem-copy recovery fixture | Portable fixture ledger/seal checks in a second temporary directory | Simulated recovery, NOT a native task-worker or host restore |
| Existing isolated task workers | Read-only board metadata only; actual worker files, dependencies and exclusive ownership not accessible/established here | Unverified; main edits do not establish propagation |
| Normal workspace restart | No supported non-disruptive operation exercised | NOT_OBSERVED; no universal denial, no proof of restart safety |
| Host restore | Not performed | NOT_OBSERVED; block an operation whose safety actually depends on it |

Read-only task discovery reported #980, #1004, #1005, #1006 and #1007 IN_PROGRESS/
WAITING_FOR_INPUT. That does not establish quiescence or that any copy has current
files. No task was restarted or relocated. Do not assert these copies are old or
new without inspecting their complete actual environment.

Official task documentation consulted:
https://docs.replit.com/core-concepts/agent/task-system and
https://docs.replit.com/learn/build-in-parallel describe isolated task copies.
No supported task-filesystem refresh operation was established by this session.
Compute restart is not treated as synchronization or proof of task propagation.

### Historical plan recovery remains task-scoped

The live ledger is valid, but local plan files are absent for the following 21
sealed records. This existed outside the migration's source edits; no claim that
their historical validation failed follows from an absent local copy.

```
02c166db-db53-4a90-91bf-169e3edac331
02401352-2967-439c-afc2-0456d418271a
2cf86765-b2fc-4d01-a337-d1f80548fb37
9af9b4d3-d322-47a1-8953-89efa669e2a2
a9a1db88-8e4c-4ce7-b4f3-6cbf42db21d0
fdd8da6e-7ac7-4aa2-9477-53f8b6215ec6
9f6ba563-0544-401f-8c22-74e8ba1e26bc
92db6839-28d1-4983-8040-9330c75e530a
d34e33db-d6c0-4ba1-bacb-405b5005e34c
3377dcff-a1df-4f30-9439-0707a0a66949
28d4420c-0cbf-457c-90be-997a3585fab1
0cb595c3-9f84-42c8-ae0b-a72d6cf230b7
c0f0b40a-2791-4143-af29-28c643f18da2
d3da8c23-8f0e-4b45-a99d-44c2ba36261d
36eaaf32-3ce7-4eb0-a940-f4a5fa31b01f
682ad15d-d101-4587-835b-17d2e936006e
ff5f011e-7a04-45c8-a9f4-3792cf7e471f
8c2b0797-9aba-44b4-84da-8e199e66fa4c
b2d99b11-c81f-4bb6-8b52-74737e18a5a7
d3f849a7-0691-4ca8-bf2e-6b3b2a81a024
c88fb94c-a4b5-4d2b-937c-65e1b99fa056
```

For authorized continuation of an affected task whose record is already known
in this registry, the existing `gate:restore-plan -- --id <id>` restores its exact
recorded plan, not a new identity/revision. Then rerun its own preflight. This
does not establish prior-executor idleness or transfer otherwise inaccessible
isolated records. No bulk recovery was performed merely to turn status green.

## Handoff, completion and remaining decisions

The update adds no native lifecycle verifier or transfer orchestration. An actual
handoff needs owner authorization for that scope, confirmed one-executor control
and accessible-state reconciliation before destination admission. BLOCKED alone
is insufficient. Inaccessible reservations/ownership or an unavailable required
transfer route are dependent blockers, not permission to copy/reset a ledger or
mint a competing admission. Exact-plan recovery is not general ledger transfer.

Local validation/delivery and native task status remain separate. Use only actual
supported native Agent interfaces and authority to reconcile a label from valid
delivery evidence; none was called to mutate a task in this migration. Do not
reimplement stale work solely for a native completion label.

No further owner decision is needed to adopt this revision. Future handoff,
explicit owner-selected requirement amendment or real host restore/restart is
not authorized by this maintenance update and must not be silently performed.
No workspace-wide propagation, native completion or application PASS is claimed.

## Safe rollback

With gate execution quiescent, restore archived before-source/configuration files
and the previous canonical package/pin. Preserve the new immutable revision
snapshot and descriptor if any later task has been admitted under it; rolling
the current selection back must not delete that task's governing mapping.
Inspect records first rather than blindly overwrite a later pin.

Never restore/reset the live registry, permanent IDs, tombstones, reservations,
seals, run results, current locks or environment-local task state from an archive.
Rollback cannot retroactively remove a task requirement or replay native actions.
No application/data/deployment rollback is involved.
