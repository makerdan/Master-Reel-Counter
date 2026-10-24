# Historical installation report

This describes the previous single-file installation, not the current admission
policy. Historical commands remain compatible where documented, but current
contract, draft lifecycle, readiness and recovery are in
`docs/validation/modular-migration.md` and `AGENTS.md`. Do not use this historical
report to claim current runtime readiness or require pre-publication admission.

# Failure Gate Unified installation

## Authorization and source

Installed under the owner's 16-point attachment in the active conversation,
using the canonical ZIP's exact `SKILL.md`, not a runtime mirror. The ZIP's
separate CloudPainter planning prompt was not this project's installation scope.

- Current/only source: `.agents/skills/failure-gate-unified/SKILL.md`
- Bytes: **21724**
- SHA-256 pin: **3cc2ed109bed775e188dd4b3db0e17834fd07ef013b03e682de5079d0ae7e937**
- Pin map: `docs/validation/unified-pin.json`
- Immutable historical bytes: `docs/validation/unified-revisions/`

Every gate operation checks the current canonical bytes against the current pin.
Every task is additionally checked against its recorded historical revision.
An owner-authorized update replaces the canonical file and current pin together,
adds the new immutable snapshot/map entry, and retains old revisions. Existing
tasks are not migrated or rebound. Apply a newer revision to a task only with
the supported amendment route.

## Retired, adapted and installed

The earlier retirement removed the legacy gate definitions, coordinator,
workspace/receipt admission, old enforcement scripts and hooks, and their
instruction text. The historical inventory, original task IDs/records, reports,
plans and byte-preservation manifest remain at
`docs/validation/archive/legacy-failure-gate/`. They were not rewritten here.
Legacy tasks remain under their original contracts or owner-directed closure.

Adapted:

- `docs/validation/manifest.json`: approved, unchanged executable tier registry.
- `scripts/run-tier.mjs`: retained independent CI/diagnostic behavior; task
  context now delegates to Unified before loading override/example workloads.
- Existing baseline loader/maintenance: the existing catalog already has the
  valid `schemaVersion: 1, records: []` format. It remains empty and unchanged.
  No failure entries or inferred signatures were invented.
- `scripts/lib/owned-process-group.mjs`: reuses its owned-tree cleanup and adds
  opt-in bounded output capture and safe missing-command handling.
- Retirement checks: still prove historical bytes, application workloads and
  protected CI/release files are preserved; now recognize installed Unified.

Installed: canonical source/pin/snapshot, portable append-only JSON task registry,
transactional provisioner, exact renderer and required stubs, guards, supported
amendment/cancellation/restoration, bounded runner, independent step supervisor,
classification logging, maintenance warnings, merge guard and local Git hooks,
instructions and isolated setup tests.

**No live task IDs were minted.** The live registry has zero task records and
zero tombstones. All provisioning/run identities used during checks belong only
to disposable fixture repositories. No application source/test, CI workflow,
package dependency/lockfile, database hook, provider, browser, paid operation,
or live host restart was changed or run.

## Approved tiers

The runner reads `docs/validation/manifest.json` directly and seals the selected
definition's content hash into each plan. Do not substitute the older
`.agents/skills/validation-tiers/tiers.json` example. A material workload change
requires coverage reassessment and amendment, even if the tier alias is unchanged.

| Tier | Expected workload time (no queue) | Existing budget | Coverage |
|---|---|---|---|
| `test-fast` | ~25 seconds; measured ~23s | 3 minutes | TypeScript and storage-lint contracts |
| `test-standard` | ~2m40s; measured ~157s | 5 minutes | Fast + API/unit, ports, Clerk release contracts, live HMR, manifest parity |
| `test-standard-plus` | ~3½–4 minutes; updated workload estimate | 7 minutes | Standard + serial-lock lifecycle and port authority |
| `test-heavy` | 5–10 minutes target, not a successful full-run measurement | 15 minutes | Plus + startup/empty-DB contract, audit/schema, workspace skills, HMR recovery, reentrancy/collision and browser checks |

### Exact registered commands

Fast:

```sh
npm run typecheck
npm run lint:storage
npm run test:storage-lint-contract
```

Standard adds:

```sh
npm run check:port-references
npm run test:unit
npm run test:managed-clerk-release-contract
npm run test:vite-hmr
node scripts/validate-validation-manifest.mjs
```

Standard-Plus adds:

```sh
npx tsx server/__tests__/ci-serial-lock.test.ts
node scripts/port-authority-test.mjs
```

Heavy retains all those workloads and adds:

```sh
bash scripts/startup-smoke.sh
node --test scripts/__tests__/github-actions-empty-database.test.mjs
npm audit --audit-level=high
node scripts/validate-schema.mjs
npm run test:workspace-skill
npm run test:vite-hmr-recovery
npm run test:validation-reentrancy
node scripts/ci-collision-test.mjs
node scripts/run-browser-tests.mjs
```

The manifest is authoritative for order and step names. Heavy's
`release-schema-contract` is the same Clerk command called
`clerk-release-contract` in lower tiers; it is not a duplicate invocation.
Previously observed SIGTERM-test, startup-smoke and audit failures were not
repaired or re-run during this gate installation.

## Provisioning and plan policy

Use `npm run gate:new -- --spec /path/to/spec.json` for the next ordinary task,
not during gate maintenance. A complete input contains:

- `title`, `scope`, one `tier`, `why`, and `coverage` naming an actual tier step;
- `approval.reference`, `approval.direction`, `approval.applicability`: local
  attribution notes for the Agent's ordinary task approval and its scope;
- `ignoredBaselines` and `ownedBaselines`: disjoint arrays of exact catalog IDs;
- `assertions`: nonempty `{requirement, check}` declarations for planned guards.

Ordinary task approval authorizes the Agent's work. The Agent is responsible for
tracking whether it covers the scope, honoring cancellation or supersession, and
handling material scope changes. The local approval fields are notes sealed with
the plan; the gate checks their local consistency, not their truth or native host
task state. They are not a second approval authority. A task start alone does not
authorize materially changed scope.

The provisioner reserves a random UUID and permanent tombstone before generating
files. It renders `.local/tasks/<uuid>.md` and `<uuid>.stubs.json`, completes the
declarations, binds one tier, records the current pin/workload hash/approval
evidence, seals and guards before reporting the task as usable. The local plan
and stubs are ignored, not bulk-committed; their sealed contents live in the
portable registry. A partial generation leaves a reserved, ineligible identity.
`gate:new -- --spec ... --resume <reserved-uuid>` can finish only that same work.
No ID is reused after cancellation, closure, deletion or a failed allocation.

## Preflight, amendments and execution

```sh
export TASK_ID=<provisioned-uuid>
export TASK_PLAN_FILE=.local/tasks/$TASK_ID.md
npm run gate:guard -- --tier <bound-tier>
npm run gate:run -- --tier <bound-tier>
```

The local guard checks the sealed plan and assigned tier; the runner checks them
again before workload dispatch under the writer lock. Plan content, required
stubs, local identity/context, local eligibility, pin and workload must agree.
A wrong tier blocks before any workload. No `--allow-no-plan`, `--execute`,
manifest override or smoke flag bypasses local task-context checks.

The Agent follows ordinary task approval and tracks host-side scope changes,
cancellation and supersession. The local gate does not independently verify
native approval, lifecycle, current revision or task association, and it cannot
intercept platform actions, Start or arbitrary Agent/editor/shell writes. No
native-host lifecycle or admission adapter is required to run it.

- `gate:amend -- --id <uuid> --spec <complete-spec.json> --reason <rationale>`
  records a new sealed revision, including old/new binding through immutable
  history. Record the local approval attribution/applicability notes for that
  revision; the Agent must obtain renewed task approval if the change exceeds
  existing authorization. It cannot change a running,
  cancelled or administratively closed task.
- `gate:restore-plan -- --id <uuid>` restores the exact sealed plan/stubs in a
  fresh task environment, without creating an ID, changing approval or rebinding.
- `gate:run -- --tier <bound-tier> --step <registered-test-step>` is a supervised
  isolated diagnostic. It preserves the parent task's binding but ends
  `INCOMPLETE`, never the required full-tier PASS.
- `gate:run -- --tier <bound-tier> --recover` records an interrupted run as
  `INCOMPLETE`, only after the sole writer is free and its independent cleanup
  deadline has elapsed. It runs no tests and cannot certify old work.
- `gate:cancel -- --id <uuid> --reason <reason>` retains the identity/history.
  Add `--direction <actual-owner-direction> --reference <attribution>` for
  `completionMode: owner_direction`: administrative closure with `INCOMPLETE`,
  **not PASS**. This does not provide a migration route for legacy IDs.

Writer/run exclusion uses a local SQLite transaction only as an OS-released
mutex; the tracked JSON registry, not this disposable file, holds authority.
There are no host/device/inode/boot fingerprints, signed workspace receipts or
single-workspace admission. Fresh-process and independent-copy fixture checks
verify portability without rebooting a host.

The runner and independent per-step watchdog enforce the existing total budget,
terminate owned process trees on timeout/interruption, and bound cleanup by an
additional three seconds. Duplicate supported task runs and concurrent amendments
are blocked. Supervised steps carry `UNIFIED_TASK_ID`, `UNIFIED_TASK_PLAN_FILE`
and revision context; their primary `TASK_*` dispatch fields are cleared to
avoid treating internal fixture/child workloads as new top-level tasks. These
context fields confer no admission authority.

Evidence retains task/revision/pin/plan/workload hashes, content-based target
identity, exit/signal/timeout/cleanup results, skipped steps, bounded
pattern-redacted diagnostic excerpts and output hashes. Source or plan changes,
timeouts, unobserved/truncated results and filtered checks cannot produce PASS.
Diagnostic redaction is pattern-based, not a guarantee against arbitrary secret
formats: do not make application tests print credentials. No secret environment
values are read to construct redaction patterns.

## Classification and baselines

Use `gate:classify -- --tier <bound-tier> --observation <json>` with
`{"failure":{"suite":"...","test":"...","signature":"..."}}` and, if needed,
`evidence: {kind: "untouched-diff" | "documented-pattern", note: "observed evidence"}`.
The route retains task context, exact identities and the classification in the
registry. Active ignored matches are not owned repairs; owned matches remain
owned. Unmatched failures are potential regressions absent contextual evidence.
A passing retry alone is rejected as provenance. Self-classification emits the
skill's exact `[SELF-CLASSIFIED PRE-EXISTING] ... — evidence: ...` log.

Classification is not a test pass. This installation does not silently waive a
failed aggregate process on agent-supplied identity alone: the raw failing run
remains failed, and skipped/unknown checks are disclosed. No ignored baseline
was added to make any existing application tier green.

`gate:baseline-warnings` uses the retained catalog maintenance logic. Expired
or stale ignored entries warn rather than blocking task execution; they are
not automatically safe to ignore. Missing/malformed catalog data blocks.

## Merge preservation and enforcement coverage

`npm run gate:merge-guard` compares the candidate to the last committed registry;
`-- --staged` checks the actual proposed Git index. During a merge it also checks
`MERGE_HEAD`. No known ID, tombstone or committed history event may disappear.
Changes append only supported `amend`, `cancel` or `run` events after the initial
reservation. Independent task IDs can be unioned across branches; divergent
histories for the same ID block rather than silently choosing a branch.

Tracked `.githooks/pre-commit` and `.githooks/pre-merge-commit` run the staged
guard. This installation sets local `core.hooksPath=.githooks` only after verifying
there is no existing active hook path or non-sample hook to displace. On a fresh
clone, enable those hooks with the same Git configuration after checking existing
hooks. Every gate mutation/dispatch also runs the preservation check.

These are local enforcement paths, **not** interception of Replit Start, platform
actions, arbitrary Agent/editor/shell writes, remote branch protection or
`--no-verify` commits. The Agent is responsible for host-side approval,
cancellation and scope tracking. Independent application CI retains its existing
scripts and is not task-completion evidence. No CI workflow was edited; adding
remote merge enforcement requires separate owner approval.

## Initial installation setup results (historical)

The following records the original installation checks, not current workspace
readiness. Keep it as historical installation evidence.

Checks are run directly with explicit outer and test-file time bounds, using
disposable repositories, dummy Node commands and local fixture mutexes only:

```sh
timeout --signal=TERM --kill-after=3s 80s node --test --test-timeout=40000 \
  scripts/__tests__/unified-gate.test.mjs \
  scripts/__tests__/legacy-gate-retirement.test.mjs \
  scripts/__tests__/github-actions-workflow.test.mjs
node scripts/validate-validation-manifest.mjs
npm run gate:status
npm run gate:merge-guard
git diff --check
```

The initial extended fixture run hit an overly short 12-second whole-file test
limit after its passing cases; that interrupted attempt was not a PASS. The
final bounded command above supersedes it. These are **setup checks, not a tier PASS**.

Final observed results:

- **39/39 setup checks passed**, no skipped/cancelled cases, in **15.4 seconds**:
  21 Unified fixtures, 3 legacy-preservation checks and 15 CI contract checks.
- Manifest validation: **PASS**, four tiers/package-script parity intact.
- `gate:status`: **READY**, matching canonical pin, **0 tasks**, **0 baselines**,
  **0 warnings**, local hooks configured at `.githooks`.
- `gate:merge-guard`: **READY**. The fixture also verified a real Git hook rejects
  a staged registry deletion, and both merge parents preserve their identities.
- Uploaded and installed skill SHA-256 values match exactly.
- Protected-path diff is empty for application source/tests, CI workflows,
  package lock, baseline catalog and legacy archive. Historical byte checks pass.
- `git diff --check`: clean.

No application tier was run or declared PASS. Gate installation is ready for
the next ordinary plan to use normal provisioning and admission.
