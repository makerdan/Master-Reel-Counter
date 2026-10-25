# Five historical plans: exact local recovery

## Scope and outcome

Owner-directed recovery only: all five original plan files and their five
companion assertion files were restored in the assigned checkout. All five
supported restoration commands exited 0 and their local guards succeeded.
This is artifact recovery, not an application-validation PASS or authorization
to resume any historical task.

The files remain environment-local under `.local/tasks/`; they are not added
to source control. This report records the observed recovery in this checkout,
not propagation to main, other workers, or a future workspace restore.

## Preflight and operation

- Read and validated the current registry event chains and tombstones using the
  existing store reader. No reserved identity or latest RUNNING operation existed.
- Confirmed all five records were sealed at revision 1, with latest run
  INCOMPLETE. Both destination files were absent for every target. No conflicting
  existing contents were overwritten.
- Verified each preserved plan's SHA-256 against its recorded seal and checked
  destination confinement with the supported path validator.
- Verified the selected complete normative contract
  `5ea3dd706f5b8ab94ab7d9a2ce95365ed678d8acccb7f64cc7b78e178bd0323b`
  and each target's historical complete contract through `pins`.
- Ran `node scripts/unified-gate.mjs restore-plan --id <id>` once per target,
  sequentially, with `TASK_ID` and `TASK_PLAN_FILE` removed from child context
  and a 20-second per-command bound. Each operation acquired the supported
  writer transaction and performed its own bound-tier local plan guard.
- Existing unrelated tier processes were observed, not launched or restarted by
  this recovery. No historical executor was resumed or relocated; no process was
  stopped to perform recovery. Inaccessible executors were not inspected or
  claimed idle. No conflicting supported gate writer prevented recovery.

## Individual observed results

Each plan destination is `.local/tasks/<id>.md`; each companion destination is
`.local/tasks/<id>.stubs.json`. Every pair was written before the successful
guard. There were no already-present, failed, or blocked targets.

| Existing ID | Preserved title | Original tier | Historical contract | Result |
| --- | --- | --- | --- | --- |
| e5723d04-c01b-47c4-8fcc-aa09dfb9e154 | Catch pageview limits that block legitimate visitors | test-heavy | cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c | Restored; exit 0; local guard succeeded |
| c1f179ff-48dc-4754-9327-e2f627cbf06c | Prevent compressed requests from exhausting the server | test-heavy | cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c | Restored; exit 0; local guard succeeded |
| 5b7b81f0-7985-48a0-be6f-cf8ea1f13322 | Enforce photo-management capability for photo duplication | test-standard | 1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736 | Restored; exit 0; local guard succeeded |
| f208beda-d34e-4b11-9c15-0342f3b9efe5 | Session Authorization Gaps | test-standard | 1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736 | Restored; exit 0; local guard succeeded |
| aa4227c8-a7e9-4c86-a6e6-982fed1ec67c | Enforce label scan pin, photo and session ownership | test-standard | 1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736 | Restored; exit 0; local guard succeeded |

## Integrity evidence

All five recovered plans matched the preserved UTF-8 bytes exactly, not merely
equivalent Markdown. All companion JSON objects matched the authoritative
original ID, revision 1 and assertions; their exact serialized hashes also
matched the expected supported output.

| Existing ID | Plan SHA-256 | Companion SHA-256 |
| --- | --- | --- |
| e5723d04-c01b-47c4-8fcc-aa09dfb9e154 | b618ba5b9730009bca366e753a52b707eda233e5d612babe0dfec76d65b45bab | aeb8bccf3e2cf1096ccaafda64949c3e96bc765aeadf84025d994c7892b84e98 |
| c1f179ff-48dc-4754-9327-e2f627cbf06c | c04362c9b37d0de9a1651146fa2c5f181b60b16ae6c294eb9c0d053890d49690 | cf0588dffc254e7c52f52e5885b8c99217b01eb4eac446016bfcd90209140a73 |
| 5b7b81f0-7985-48a0-be6f-cf8ea1f13322 | 8cb8e1d46fcf64edb12883de0ad39d78f669c37f9cf46f72ec29311ff8ad665e | 43f6793a8230daaf5fdd65a55a286e87cb2e6b1adb39947c2018e720f54a1bc1 |
| f208beda-d34e-4b11-9c15-0342f3b9efe5 | 9f9ac16b8379aa1de91beb56a9235437e2bd7593ae10f4f9ffc3fcc2ba9b8c75 | fc9851f8c777ce90f720efa39bf554d0827c7af7696a94d585294ea244ef3f57 |
| aa4227c8-a7e9-4c86-a6e6-982fed1ec67c | 16bda1f17aba1f152eff2c386a692530563737e91e11e0a3b8cd8e2643ccf61c | cea9ca0ce1fcb28aa2dfe0b431a8f79f20373f746fb7402fc352140ec1bebd26 |

Registry SHA-256 before and after:
`c95dba309c389e50a53d9e55c062eae93f823d623525592faf294bf7f0ebfb35`.
The current digest differs from the older bounded-recovery report; the current
registry was used as the baseline, never replaced with that older state.
Exact unchanged registry bytes preserve event history, tombstones, identities,
revisions, historical run results and tier bindings. Every latest historical run
remains INCOMPLETE.

Pin-file SHA-256 before and after:
`da30da90349b6fe7e88365ae19f70d2f0292dd378ca8f1291c97439ab148fd9a`.
No policy, pin, workload, ledger, seal or application source was modified.
No historical native task lifecycle action was invoked. Native states were not
independently re-read; this recovery makes no claim about external concurrent
task-board changes. Only this maintenance assignment is submitted for completion.

## Remaining limits

The separately missing plan for closed identity
`8255f524-e4dd-4b79-8094-cfa274957434` (Repair reviewed release schema fingerprint)
remains absent and was not restored or guarded. A read-only existence check found
no other missing registry plan destinations after these five recoveries.

No ordinary tier workload, application test, independent review, acceptance
ceremony or activation was performed. Acceptance and activation are unchanged.
Regression Guard: N/A; exact artifact restoration changes no behavior or contract.
No new follow-up is proposed: this bounded recovery uncovered no separate
actionable work beyond the explicitly excluded closed-plan artifact.
