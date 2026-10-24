# Comparable validation summaries — delivery handoff

## Context and maintenance boundary

- Assignment: Record Comparable Validation Summaries (native task 984).
- Owner-directed gate maintenance, outside ordinary admission. No live Unified
  ID, assigned tier, seal or ordinary task-tier PASS was created/claimed.
- Starting implementation: `24573fcb` (merged guarded per-test diagnostic retries).
- Full canonical Failure Gate contract verified before implementation:
  `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Full canonical Regression Guard contract verified:
  `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- The baseline catalog was re-read: valid schemaVersion 1, empty records.
  Every unexpected check failure was treated as a potential regression.
- Classification: normal guard; privacy/retention, persistence/atomicity,
  lifecycle and existing runner/CLI compatibility. Planned R1–R4 retained.
  The canonical skills, pins, tier definitions, workload hashes and live registry
  have no task diff. Existing historical observations are not backfilled.
- Separate read-only verification: **not selected**. Executor tests below are
  maintenance evidence, not independent verification or installed-gate acceptance.

## Delivered snapshot

The source/test checks below apply to these SHA-256 bytes, on the starting
revision plus the delivery diff. Documentation is not part of the executable
comparison profile. Hashes bind the tested implementation without requiring a
new seal, ledger entry or mutable task-plan amendment.

| Path | SHA-256 |
|---|---|
| `scripts/lib/unified-gate/execution.mjs` | `2fc8b77e8f68d4685f170f63567e023bf10cf21cb7cda6c0c7e14108398bb718` |
| `scripts/lib/unified-gate/summaries.mjs` | `9f465dc1c1eb8dc9724e37e2bec775b71ced179ab02becc9d4adb219d030563f` |
| `scripts/unified-gate.mjs` | `75046a00283fb6c541e64c0b640ff768acdfbf54c86debe548bd75251f38a70e` |
| `scripts/__tests__/unified-gate.test.mjs` | `6ff0abab11eb13612e9c7c13e160ada2916f2fdc03fb90b7f0b4ff49f2e57ee8` |
| `scripts/__tests__/unified-gate-summaries.test.mjs` | `1d76780fcfb092289186b5d8e1c16441bfc26eb9b1b7be42560ea1b86d1ba9fa` |
| `scripts/__tests__/unified-gate-retry.test.mjs` (unchanged) | `e15572811d5503d1fb6a6f96a5e3e3b05548cf3d9203d960c275c3a9432b0da0` |
| `package.json` | `a01ba2643ce5bf199f3f775a7aca4a5627e64420b36c46bcede63dc39b4f6c82` |

## Requirement-to-delivery map

All new cases below are in `scripts/__tests__/unified-gate-summaries.test.mjs`
unless stated otherwise.

| Requirement | Actual cases / detecting assertions | Evidence and disposition |
|---|---|---|
| R1: compare only equivalent eligible workloads, across task/plan changes | “across-task/revision comparison…” asserts the prior run is selected despite changed task UUID, plan revision/hash, source revision/fingerprint and dirty state; most-recent eligible ordering is asserted. “every incompatible/missing/unknown applicability…” rejects changed tier/workload/contract/runtime/lock/step identity, missing/unknown schema fields, diagnostics, classifications, RUNNING/BLOCKED/INCOMPLETE, source change, omitted detail, timeout/recovery/interruption and untrustworthy/missing durations. | Delivered, observed passing. Incorrect task/plan equality would fail the positive control; accepting mismatched profiles would fail the negative controls. Real exported/CLI fixtures independently assert cross-task/plan selection. |
| R2: accurate observed step transitions, no false test/provenance/fix attribution | “across-task/revision comparison…” asserts PASS→FAIL, FAIL→PASS, repeated step failure, unchanged/not-reached handling and timing delta only on jointly executed steps. It explicitly checks that the later unexecuted step is unknown and has no timing delta; repeated-failure data has no test-level or causal claim. Real CLI fail-fast fixture asserts later `notReached`; source-change/timeout fixtures assert INCOMPLETE and ineligibility. Existing gate suite’s abrupt-loss/recovery case now asserts no fabricated terminal summary, recovered/interrupted flags and unknown uncommitted steps; SIGTERM case asserts interruption. | Delivered, observed passing. Incorrect fixed attribution for a not-reached step or acceptance of a recovered run would fail explicit assertions. |
| R3: private, bounded derived persistence; warnings preserve authoritative outcomes | “strict allowlist…” exercises omitted step detail/64-KiB size, excluding command/error/output/env canaries; real process canary case confirms stdout evidence retains the controlled canary while summary/report do not. “bounded private retention…” writes 105 records, asserts only 100 retained, aged record deletion, 0700/0600 permissions and untouched unrelated/catalog/evidence sentinels. Corrupt/oversize/symlink/traversal cases warn/refuse safely; 4 concurrent processes produce valid complete records/no staging residue. Real injected storage failures assert original PASS/FAIL/BLOCKED JSON, exit status and committed registry outcomes remain intact, with generic warnings. | Delivered, observed passing. No authoritative file is pruned by the report store. Corrupt/unsafe records conservatively stop writes, not validation. |
| R4: preserve execution guards, supervision, diagnostic-only meaning and consumers | Real exported/CLI fixtures assert parseable ordinary stdout JSON, unchanged PASS/FAIL/BLOCKED/INCOMPLETE exit meanings, wrong-tier denial and no extra summaries on pre-dispatch refusal. Read-only history preserves registry bytes, catalog bytes and directory entries. Existing 30-case gate suite covers guards, seals, single-flight, timeout/child cleanup, SIGTERM/SIGKILL/recovery and staged merge preservation. Existing 11-case retry suite remains unchanged and passes against the shared execution/CLI changes, including selectors and diagnostic-only evidence. | Delivered, observed passing. No new workload dispatch, permission, completion exemption or acceptance path. |

## Observed bounded maintenance checks

Executed on 2026-10-24 in disposable fixture repositories only:

1. `timeout 150s node --test scripts/__tests__/unified-gate.test.mjs scripts/__tests__/unified-gate-summaries.test.mjs scripts/__tests__/unified-gate-retry.test.mjs`
   — exit 0; **50 passed, 0 failed**, approximately 18.7 seconds.
   This used the final implementation bytes above, the 30 existing lifecycle
   cases, 11 unchanged retry cases and the first 9 summary cases.
   Session evidence: `/tmp/gate-maintenance-tests.log`.
2. After adding the real process privacy-canary case:
   `timeout 120s node --test scripts/__tests__/unified-gate-summaries.test.mjs`
   — exit 0; **10 passed, 0 failed**, approximately 4.2 seconds.
   This establishes the final summary-test hash above; runner/CLI/lifecycle/retry
   bytes did not change after check 1.
   Session evidence: `/tmp/gate-summary-final.log`.
3. `npm run gate:merge-guard` — exit 0, `READY`,
   `task/tombstone and committed-history preservation`.
4. `git diff --check` — exit 0, no whitespace errors.
5. `node scripts/unified-gate.mjs history --limit 2` — exit 0, empty local
   records, no warnings, expected isolated-history message. This read-only
   operator probe neither dispatched a workload nor populated live history.
6. Full-contract verification was repeated after implementation; both identities
   above remained unchanged. Protected registry/manifest/catalog/pin paths had
   no task diff.

The first focused test attempt found two fixture expectation mistakes (expired
synthetic dates and diagnostic FAIL expectation); the fixtures were corrected
without changing validation-result semantics. No baseline or exemption was added.

## Limits and unresolved acceptance

- No in-scope requirement is intentionally deferred. Operator guidance and
  examples are in [run-summaries.md](run-summaries.md), linked from the installation
  report and testing guide.
- History is local/disposable, not synchronized or imported into isolated task
  environments. The runtime profile is bounded evidence, not proof of identical
  ambient environment values, dependency contents, network or external services.
- Source stability is observed with the existing before/after source snapshots;
  this does not intercept arbitrary concurrent editor writes.
- A hard kill may leave RUNNING and private staging residue. No completion is
  fabricated. Existing recovery establishes INCOMPLETE after its deadline; old
  runs lacking metadata may warn rather than produce a reconstructed summary.
  Derived retention happens on successful writes, not a background timer.
- Storage is cooperative same-user local filesystem safety, not protection
  against malicious concurrent replacement of ancestor directories.
- No live task validation, production/Clerk operation, workload/tier change,
  authoritative-history rewrite, baseline classification or remote CI integration
  was used to prove this work.
- Existing whole-installation task-environment/restart acceptance is not
  established by these maintenance fixtures.
- An app screenshot probe could not connect to port 5000. No application/UI code
  changed and no app restart was performed for gate-only maintenance; signed-in
  UI behavior was not verified.
- An unrelated environment-generated `.replit` localhost-exposure setting appeared
  during work; it is not used as validation evidence or part of the gate design.
