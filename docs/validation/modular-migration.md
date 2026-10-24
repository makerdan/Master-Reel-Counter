# Master Reel Counter: modular Unified migration

## Outcome

Owner-authorized gate-only maintenance in the original Master Reel Counter.
**Package installed; maintenance checks partially pass; runtime readiness BLOCKED.**
No ordinary application-tier PASS is claimed. No new live task, reviewer,
native-approval service or independent verification task was created.

Selected full normative contract:
`cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
Core SHA-256:
`c71feec63190ee1d729b1e3efa6290ddeb26467b0fd955143a1742ac2e4cf9a2`.
The exact package includes SKILL.md, both normative references, README,
revision notes and package manifest. The externally selected pin, not a
self-updated manifest, controls runtime verification.

## Discovery, preservation and scope

Starting source: `fccd01544e85e53346851edf535d25640f047c43`.
`.replit` was already dirty and was left untouched.
The kit was inspected before extraction: bounded total/per-file sizes, no
absolute/traversal paths or symlinks; extracted only to a fresh `/tmp` directory.
Read START-HERE, this project's guide/prompt, core and both required references.
Read actual facade, store, plans, execution, workload runner, hooks and consumers.
The bounded inventory helper omitted the large registry; it was inspected
separately without printing plan or result contents.

There were eight sealed live identities, none with a RUNNING record, and no
active gate process found. Native task lookup found no pending/in-progress work.
Draft #722 is obsolete publisher-concurrency work, not a competing active
migration. No task-board record was changed. Native queries are ordinary Agent
discovery, not an installed admission integration.

Source archive:
`docs/validation/archive/fgu-migration/2026-10-24-modular/`.
Its inventory hashes 20 exact before-source copies and 658 kept-in-place files.
All hashes still match after migration. Environment-local copies reside at
`.local/fgu-migration/2026-10-24-modular/`, excluded from Git and deployment.
No raw private logs or task-plan contents were newly exported.
Local archives are not remote backups.

Unchanged: all eight identities and their complete event chains, reservations,
tombstones, original seals/plans/results, baseline catalog (zero records),
four tier workloads/budgets, old revision snapshots and legacy retirement archive.
Application code/tests/data, dependencies/lockfile, CI workflow files and remote
settings, deployments, runtime mirrors, shared library, other projects and
backups/remixes were not changed.

## Adapted mechanisms

- `unified-pin.json` schema 2 distinguishes complete normative-package revisions
  from historical single-file revision strings. Exact package snapshots coexist
  with both old single-file snapshots; historical hashes and records are intact.
- Store verifies core AND both reference hashes against the external current pin
  and each task's recorded snapshot. It retains transactional locking, merge
  preservation and permanent tombstones, without host/machine identity checks.
- Renderer retains byte-compatible historical rendering. New modular specs carry
  a scope-based Regression Guard declaration; semantic adequacy remains an Agent
  responsibility, not something a text field proves.
- `gate:draft` prepares a complete `UNADMITTED_NATIVE_DRAFT`, inspects catalog and
  workload, and writes no ledger, plan, stubs, binding or lock directory. Draft
  creation does not require approval notes or a native reference.
- `gate:new` still provisions under the existing writer. New modular admissions
  require a stable local `claim`, established before the first write. Retries
  reconcile the same reservation/seal, reject different work using that claim,
  and do not allocate a duplicate identity after an uncertain success.
- Supported amendments remain explicit and cannot change a running plan. New
  modular admission/amendment is currently blocked by unobserved runtime
  acceptance. This is local installation readiness, not native approval.
- CLI and exported runner share the same guard and bounded runner. Neither has
  custom native-host evidence, callbacks or authentication. Run evidence says
  native authorization `NOT_OBSERVED`.
- `run-tier.mjs` continues to delegate task context before independent CI options;
  `--allow-no-plan` and alternate manifest flags cannot bypass task admission.
  Independent CI/ad-hoc checks remain distinct and cannot establish task PASS.
- Staged Git hooks are retained for history preservation, not native approval.
  No CI configuration was changed.
- Removed only the archived, superseded canonical application-prompt that
  demanded a remix. Current guidance reconciles unadmitted drafts and dedicated
  follow-up route/parent/category/payload/one-shot constraints. Platform refreshes
  can replace default instructions; durable AGENTS.md retains this rule.

## Commands and actual checks

Maintenance uses disposable fixture repositories and the existing independently
bounded process supervisor. No live IDs are used to demonstrate installation.

```
timeout --signal=TERM --kill-after=3s 80s node --test --test-timeout=40000 \
  scripts/__tests__/unified-gate.test.mjs \
  scripts/__tests__/legacy-gate-retirement.test.mjs \
  scripts/__tests__/github-actions-workflow.test.mjs
```

Final result: **43 passed, 1 failed, 0 skipped/cancelled; 44 tests; 14.83 seconds.**
The first run was 42/43 before an additional retry-concurrency fixture was added.
All Unified fixtures and CI contract tests passed. The suite as a whole is **not PASS**.

The failure is `retirement removes only gate steps and npm hooks, preserving
application workloads`: an old full-package snapshot comparison rejects already
merged dependency upgrades (including multer, sharp and Vite). Reproduced using
HEAD's original test and package.json in a temporary read-only-source harness:
same test FAIL, other two cases filtered out. No baseline was added or failure
waived. Migration changes to package.json add only `gate:draft`.

Passing fixture coverage:

- Read-only unadmitted draft without approval; denied readiness consumes no ID.
- Core, each reference and snapshot tampering; original historical seals intact.
- Interrupted/concurrent local-claim retries; permanent reservations and IDs.
- Wrong tier/context, stale seals/stubs/workloads; supported amendments.
- CLI and exported dispatch without native integration; task-context bypass denial.
- Stale/changed target results cannot PASS, diagnostics do not replace full tiers.
- Timeouts, SIGTERM, top-level SIGKILL, bounded child cleanup and run recovery.
- Exact ignored/owned baselines, provenance and administrative closure.
- Append-only preservation, both merge parents, staged hook checks.
- Fresh-process/copied fixture restoration. This is NOT actual host acceptance.

Other observed checks:

- Supplied `contract-fingerprint.mjs` against installed package: CONTENT_VERIFIED_ONLY,
  exact selected digest; not admission or runtime readiness.
- `node scripts/validate-validation-manifest.mjs`: PASS, four tiers/package parity.
- `node scripts/unified-gate.mjs merge-guard`: READY, history preservation.
- `node scripts/unified-gate.mjs status`: BLOCKED (exit 2); detailed reasons below.
- All 20 archived-source and 658 preservation hashes match.
- Protected application/CI/lockfile/registry/baseline/workload/archive diff: empty.
- `git diff --check`: clean.

## Remaining blockers and acceptance

1. Actual ordinary isolated-task environment and normal workspace restart
   acceptance have **NOT_OBSERVED** status. No live host reboot, new task or
   infrastructure was used. Disposable fixtures cannot satisfy this criterion.
   New modular admissions stay blocked in the current pin. Do not change its
   acceptance to OBSERVED without real evidence; no environment bypass exists.
   Owner-directed maintenance can run the same bounded fixture probes in the
   actual ordinary task environment and after the host's normal restart, then
   record observed evidence through reviewed source maintenance.
2. All eight historical sealed plan files are absent from `.local/tasks/` in this
   workspace. Portable sealed contents remain intact in the registry.
   `gate:status` lists every affected ID. The supported `gate:restore-plan --id`
   command can materialize an individual historical plan/stubs unchanged when
   that work actually resumes; this migration did not bulk-restore or rewrite
   them. Current source/workload applicability still requires its own guard.
3. The historical retirement package-comparison test fails as documented above.
   This is not a product failure introduced by the migration, but no all-green
   maintenance verdict or runtime-ready claim is made.

Missing OS write capability blocks admission; no alternate write path exists.
The tested capability-denial fixture covers installation-readiness denial;
it does not claim to reproduce every host filesystem permission mode.
Native approval/cancellation/scope checks remain cooperative Agent duties.
Local scripts cannot intercept platform Start, all editor writes or shell commands.
No application server restart establishes workspace-restart acceptance; this
migration did not restart unrelated app or validation workflows.

## Safe rollback

Quiesce affected gate work first; inspect current live registry and revisions.
Restore compatible gate source/configuration from the `.historical` copies or
the project's source checkpoint, not a database or full-workspace reset.
Never restore the registry, ledger, tombstones, local task state or run results
from a prior snapshot; identities consumed since it must survive.
Keep every later contract snapshot/mapping and its handler. If later modular tasks
exist, retain modular support or explicitly block them pending repair rather than
silently reverting their policy. With no new live identities in this migration,
the archived single-file integration is the prior compatible source state.
Run bounded maintenance and merge preservation checks after source restoration.
Do not deploy, reset Git, delete locks, reclaim processes or rewrite history.

## Regression Guard delivery

Material contract/identity changes use the new modular tests in
`scripts/__tests__/unified-gate.test.mjs`: core/reference mutation is the negative
control for pinning; obstructed plan generation proves reservation retention;
concurrent repeated claims prove same-identity recovery; rejected readiness
leaves registry and local output absent; CLI/exported probes enforce tier binding.
Existing cleanup, stale-result, baseline and merge tests retain their coverage.
Historical compatibility is asserted against a pre-migration fixture seal.
Optional independent verification was not selected and is not required.
