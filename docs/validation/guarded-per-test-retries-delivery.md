# Guarded per-test retry delivery

## Authority and tested target

- Work: assigned **Add Guarded Per-Test Retries** gate-maintenance plan.
  Scope classification: material execution-contract, error-path and lifecycle repair;
  normal Regression Guard R1–R5 declaration, not a pure-test exemption.
- Owner-directed maintenance under the canonical Unified maintenance exception:
  no live Unified identity, admission, seal, binding or ordinary tier PASS claimed.
  Fixtures provision disposable identities only in temporary repositories.
- Verified full Unified contract pin:
  `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
  Adopted Regression Guard pin:
  `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
  The full package and maintenance rules were inspected before implementation.
- Source base: `6e6d2466d184a77f8223e70164d330843c14954d` plus the delivered
  implementation/test files below. Tested on Node **20.20.0**.
- Implementation/test snapshot digest:
  `8067d390c8e5d102b91207cb2f2a46a8af1dbcfb10281c723e4478f03ed85abb`.
  Reproduce with `sha256sum <files in the following order> | sha256sum`:

```text
scripts/unified-gate.mjs
scripts/lib/unified-gate/execution.mjs
scripts/lib/unified-gate/retry.mjs
scripts/lib/unified-gate/retry-dispatch.mjs
scripts/lib/unified-gate/retry-node-reporter.mjs
scripts/lib/unified-gate/retry-browser-reporter.mjs
scripts/run-typechecked-playwright.mjs
scripts/check-playwright-config-coverage.mjs
scripts/__tests__/unified-gate.test.mjs
scripts/__tests__/unified-gate-retry.test.mjs
scripts/__tests__/browser-validation-lifecycle.test.mjs
scripts/__tests__/playwright-config-coverage.test.mjs
```

This snapshot intentionally excludes this handoff, operator documentation and
memory notes so recording results does not recursively change the tested code identity.

## Requirement-to-delivery map

All rows use the plan's normal-form guard, delivered at the actual execution boundary.

| Label | Recurrence / expected outcome | Delivered files, cases and assertions | Evidence / disposition |
|---|---|---|---|
| R1 | Ignored or malformed selectors must not dispatch a whole suite | Strict `run` CLI parsing and shared exported `retryOptions`; adapter-generated command arrays. `unified-gate-retry.test.mjs`: real exact-name case leaves only `chosen` marker; CLI selection agrees; compound-script selection excludes sibling constituent; nested leaf identities exclude suite containers. Main `unified-gate.test.mjs` also asserts unknown/missing selectors leave the dispatch sentinel absent and append no run. | Delivered; all applicable fixtures passed. Negative control runs the prior whole-step behavior and proves it writes sibling/other-file markers, so the isolation assertion would reject the original bug. |
| R2 | Wrong tier, stale/unknown task, arbitrary file/flags or ambiguous workload must not execute | Existing `guard` remains before adapter dispatch under the existing writer transaction. Shared selector validation rejects unsafe paths/symlinks, unknown keys, invalid patterns, conflicting options and files outside workload. Retry fixtures reject wrong tier/ID, changed sealed plan, unregistered step/file, dependency symlinks and duplicate constituent membership; CLI rejects unknown/duplicate/missing/unsupported flag syntax. Existing gate fixtures retain amendments, full pin drift, single-flight, cancelled identities, recovery and stale-context rejection. | Delivered; admission-denial fixtures passed without workload markers. No custom native-host approval mechanism introduced. |
| R3 | Isolated/no-match/skipped/missing evidence cannot become required PASS or provenance | Structured Node/Playwright reporters; conservative executed-body counts; `readRetryEvidence` rejects missing/malformed/incomplete/foreign/inconsistent reports. Retry cases exercise real passing/failing, zero-match, skipped-only, exit-zero without reporter, and exit-zero file with no test declarations. Synthetic Node file-process success is not a case execution. Previous full-step failure remains in history after retry success, and passing-retry provenance is rejected. Existing unfiltered full workload alone still returns PASS in its fixture. | Delivered; Node zero/skip/synthetic-file and native Playwright zero/skip cases passed. `SUCCEEDED` is diagnostic-only, CLI exit 1, run state INCOMPLETE. Individual identities/outcomes and observed/selected/executed/passed/failed/skipped/cancelled/todo/filtered counts are embedded alongside task/revision/tier/target/commands. |
| R4 | Filtering must retain loaders/environment, compiler/lifecycle/project policy and bounded cleanup | Node compound fixture asserts both loader effect and `VITE_HMR_RECOVERY` environment. Browser adapter calls the existing shared compiler wrapper's isolated-database branch; actual Playwright fixture verifies regex/exact selection, project/attempt, compiler-first sequence and cleanup markers. Compiler failure launches no browser/database boundary. Lifecycle/config fixtures cover project policy, unchanged DB forwarding and process-tree cleanup, plus transitive compiler-boundary detection without hiding config discovery. Retry timeout and SIGINT/SIGTERM fixtures assert interrupted outcome and confirmed process cleanup. | Delivered; applicable adapter/lifecycle/config fixtures passed. Actual database/Clerk/browser-engine integration was not exercised: fake DB boundary, real Playwright test worker with no page fixture. Existing database wrapper source/lifecycle is unchanged; no live data or infrastructure touched. |
| R5 | Unsupported isolation must not broaden execution or pretend success | Explicit adapter capability boundary; `UNSUPPORTED` record contains requested selector, runner, registered step/command, limitation reason and `dispatched: false`. Opaque-harness fixture verifies no compiler/workload sentinel is created. | Delivered; unsupported-harness fixture passed. No arbitrary command/argument passthrough or fallback suite. |

## Observed bounded maintenance checks

Executed on 2026-10-24, as **maintenance checks**, never ordinary task-tier validation:

```sh
timeout 100s node --test \
  scripts/__tests__/unified-gate.test.mjs \
  scripts/__tests__/unified-gate-retry.test.mjs \
  scripts/__tests__/browser-validation-lifecycle.test.mjs \
  scripts/__tests__/playwright-config-coverage.test.mjs
```

- A complete run before the final synthetic-file guard passed **59/59**.
- After adding that guard, a combined run observed **58 passed, 1 failed**:
  the real Playwright fixture exceeded its original 6-second local fixture budget.
  It was truthfully recorded as interrupted with cleanup confirmed, not successful
  or pre-existing. No baseline entry was added.
- The fixture-only budget now allows a bounded 20-second cold-start/scheduling
  margin. This changes neither production tier budgets nor workload hashes.
  The affected final suite was rerun:

```sh
timeout 100s node --test scripts/__tests__/unified-gate-retry.test.mjs
```

- Final affected suite: **11 passed, 0 failed, 0 skipped/cancelled**,
  approximately 12.23 seconds. The other **48** passing gate/lifecycle/config
  cases remain applicable: no measured implementation changed after their run.
  Thus all **59 distinct maintenance cases** have applicable passing evidence;
  this is not a claim that the last combined invocation passed.
- `node scripts/check-playwright-config-coverage.mjs`: passed, all **3** executable
  TypeScript Playwright configurations covered.
- `npm run gate:merge-guard`: observed **READY**, committed task/tombstone/history
  preservation check. Rerun immediately before completion/publication.
- `git diff --check`: clean.
- Explicit protected-source comparison against the source base was unchanged for
  the manifest, live registry, baseline, Unified pin/package and package.json.

## Operator guidance, limitations and remaining scope

Exact commands and examples are in
[`unified-installation.md#guarded-per-test-retries`](unified-installation.md#guarded-per-test-retries)
and [`../testing.md`](../testing.md).

Supported Node commands are explicit literal Node test workloads and understood
compound npm aliases, not arbitrary harnesses. Node 20 native name matching is
component/leaf based; it does not offer a unique hierarchical ID for identical
leaf names across suites. Playwright selection keeps default project/grep policy
and excludes release/custom-config workloads. Body execution on unsuccessful
attempts is counted only when reporter events establish it; absent proof is not
promoted to success. Reports are evidence of observed execution, not a complete
inventory of undiscovered/filtered browser cases.

No automatic retry/quarantine/baseline change, CI activation, application change,
live admission/rebinding or resumption of another task was performed. Ordinary
unfiltered workload definitions/hashes, historical records and completion meanings
are preserved. No unresolved requested implementation scope is deferred.

Separate read-only verification: **not selected**. This record is executor
delivery/maintenance evidence, not an independent review or host-runtime acceptance.
The existing downstream **Record Comparable Validation Summaries** work owns the
next summary/reporting stage; no duplicate follow-up proposals are needed.
