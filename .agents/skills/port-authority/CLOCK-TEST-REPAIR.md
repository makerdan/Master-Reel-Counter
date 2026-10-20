# Clock-reversal fixture repair

## Authorization and diagnosed boundary

The owner authorized a test-only repair after reporting task #41's finding:
the old 200 ms fixture could expire during startup, correctly returning exit 4
before dispatch rather than the test's assumed exit 1.

The original test put execution and queue expiry in one test body. Its exact
exit-1 assertion neither established that workload dispatch occurred nor allowed
the queue assertions to execute after an execution assertion failure. Its
call-count clock stub also did not demonstrate a reversal while actually queued.

This package fixes those test assumptions. It does not claim the original report
was independently reviewed here or that every possible runtime defect is excluded.
All four delivered runtime module bytes remain unchanged from the prior package.
No app installation, live service, workflow, tier, ledger, lease or deployment
was changed by this package authoring.

## Regression Guard delivery map

| Recurrence | Test location and case | Detecting assertions |
|---|---|---|
| Legitimate startup budget expiry mistaken for post-dispatch timeout | `tests/hardening.test.mjs`: expiry before dispatch | Private fixture guarantees expiry at the pre-worker boundary; exact exit 4, actual one-hour wall-clock reversal, no workload marker or watchdog registration; unfinalized recovery-required lease remains with no owned group/descendants |
| Clock change extends the execution deadline or cleanup is falsely claimed | Same file: confirmed dispatched work | Mandatory workload identity marker before assessment; reversal triggered only after dispatch; exact exit 1, execution-budget failure and stopped-work evidence; exact workload incarnation no longer live; lease removed after verified quiescence; finite monotonic duration |
| Execution-case failure hides queue coverage or clock change extends queue wait | Same file: queue expiry | Independent fixture reverses after enqueue; exact exit 3, no dispatch or acquisition, live owner's lease bytes unchanged and finite monotonic duration |
| A short startup budget is mistaken for an execution-timeout test | `tests/hardening.test.mjs` and `tests/core.test.mjs`: execution-budget, direct dispatcher, async/sync test-runner, descendant-stop, late-zero and core expiry cases | Finite five-second stage window where startup precedes timeout; a workload/callback marker proves dispatch; exact expected timeout status, confirmed owned-work cleanup and correct lease release are then asserted. Deliberate late-zero delay is 5.5 seconds after marker, so the raw child result exists before the bounded deadline observation finishes. |

Private injections affect only disposable test runtime copies. They do not change
the canonical runtime, monotonic clocks, runtime limits or host authorization.
The startup case explicitly waits out its declared 200 ms window before the
pre-worker check. The post-dispatch case declares a five-second finite window
and requires proof of dispatch: exit 4 cannot satisfy it. This is not merely a
larger timeout or accepting either code. Queue expiry uses its own 500 ms window.
All three cases must observe the actual one-hour wall-clock reversal.

Required invariants remain: no unadmitted workload, finite execution/queueing,
exact owned-process cleanup, retained uncertain exclusion and truthful outcomes.
Fixture teardown is confined to known private fixture work.

## Evidence scope

Focused checks use:

```sh
node .agents/skills/port-authority/tests/hardening.test.mjs \
  --supervised '--test-name-pattern=^wall-clock reversal:'
```

Supply the whole `--test-name-pattern=^wall-clock reversal:` argument as one shell
argument. The focused run passed **3/3** cases. Its independent outer fixture
reported `FINISHED`, raw exit 0 and `workloadStopped: true`.
Raw output: `validation/clock-stage-focused.log`.

The clock-only repair's first full-run pair exposed additional short-budget
fixtures elsewhere in the same test suite. That intermediate evidence remains in
`validation/budget-startup-repair-full-run-1.log` and `-2.log`: run 1 was 77/78
(the core test assumed release after its 250 ms case reached an early exit 4);
run 2 was 78/78. The core test and related hardening fixtures were corrected to
require positive evidence of actual dispatch before asserting post-dispatch
timeout and lease release. `validation/budget-startup-repair-focused.log`
(5/5), `validation/core-budget-fixture-focused.log` (1/1), and
`validation/late-race-and-reentry-focused.log` (2/2) record focused checks on
those repairs. The deep-reentry test now also reports private descriptor path,
size, link count and mode if its existing fail-closed file check rejects a
fixture, without changing that runtime check.

Two final full supervised runs, after those test revisions, used the same
runtime/test revision:

```sh
node .agents/skills/port-authority/tests/hardening.test.mjs --supervised
```

| Evidence | Run 1 | Run 2 |
|---|---|---|
| Passed / total | 78 / 78 | 78 / 78 |
| Failed | 0 | 0 |
| Cancelled / skipped / todo | 0 / 0 / 0 | 0 / 0 / 0 |
| All three repaired clock cases | Passed | Passed |
| Reported suite duration | 132.735 seconds | 132.477 seconds |
| Outer result | FINISHED, raw exit 0, workloadStopped true | FAILED, raw exit 1, workloadStopped true |

Raw logs: `validation/clock-budget-final-run-1.log` and
`validation/clock-budget-final-run-2.log`. Both runs used identical files; no
manual port/process/lease intervention or changes to expectations occurred
between them. Earlier intermediate failures remain preserved in their own logs,
not overwritten or treated as passes.

All four runtime modules and both test modules passed `node --check`.
Runtime hashes were checked against the preceding package manifest and matched.
Earlier failing logs remain unchanged; passing repaired tests do not turn the
original failure into an ignored baseline or prove pre-existing provenance.

These are complete, repeated package-suite passes for the supplied isolated
fixtures—not host control activation, a Unified task tier PASS,
independent review or proof that an application installed this package.
Separate review is not selected for this authoring; no new approval loop is added.
