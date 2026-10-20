# Earlier Failure Gate Unified compatibility verification

This report describes the preceding compatibility snapshot. Its results and logs
are retained as history, not verification of the latest text revision. See
`PREFLIGHT-REVIEW-VERIFICATION.md` for current evidence.

## Authorized scope

Update the existing canonical `port-authority` package, explicitly recognize Failure
Gate Unified, remove references to previous Failure Gate variants, and deliver the
complete ZIP with `SKILL.md` at its root. This is package authoring, not installation
into any application, workspace publication, service restart or live recovery.

## Changes and preserved boundaries

- Unified governs applicable task IDs, sealed approved plans, assigned tiers,
  diagnostics and completion; Port Authority adds no second approval system.
- Two consecutive authorized host runs establish affected control activation, through
  the assigned-tier route when Unified applies. They do not add approvals or block
  unrelated plan publication.
- Process/boot/socket/lease identity protects runtime ownership and exclusion, not
  ordinary Unified task authorization. Runtime safety checks remain intact.
- Gate maintenance does not authorize uncertain-lease deletion, pre-existing-process
  reclaim or service disruption. Actual supported recovery and applicable authorization
  remain necessary, without a universal extra reviewer or recovery-specification step.
- Missing optional reclaim providers block only dependent work.
- Supporting instructions and contract tests follow these boundaries. The host-adapter
  comment now identifies the actual reclaim provider rather than attributing that
  capability to Unified. Existing error identifiers remain for adapter compatibility.
- Runtime executable behavior is unchanged; runtime-module changes are comments only.

## Evidence scope

The older `VERIFICATION-REPORT.md` and `validation/run-1.log` / `run-2.log` are
historical evidence for the earlier package, not the current revision.
No application integration, genuine provider, actual workspace restart, independent
host acceptance, assigned-tier PASS or deployment is asserted by package checks.

## Current checks

Both planned complete runs used:

```sh
node .agents/skills/port-authority/tests/hardening.test.mjs --supervised
```

| Evidence | Run 1 | Run 2 |
|---|---|---|
| Passed / total | 74 / 75 | 75 / 75 |
| Failed | 1 | 0 |
| Cancelled / skipped / todo | 0 / 0 / 0 | 0 / 0 / 0 |
| Test duration | 88.077 seconds | 89.263 seconds |
| Outer result | FAILED, raw exit 1, workloadStopped true | FINISHED, raw exit 0, workloadStopped true |

Raw logs: `validation/unified-compatibility-run-1.log` and
`validation/unified-compatibility-run-2.log`. No source edits or manual process/lease
cleanup occurred between runs. All contract checks, including the new Unified
boundaries, passed in both runs. All four runtime modules and both test modules
passed `node --check`.

Run 1 failed the existing "wall-clock reversal cannot extend queue or execution
elapsed limits" case. Its 200 ms execution fixture expected exit 1 but observed
exit 4: dispatch reported cancellation/watchdog unavailability/budget expiry,
the workload was confirmed stopped and the lease retained. The assertion prevented
that case's later queue subcheck from running in run 1. Run 2 passed the complete
case without changes.

This is an observed intermittent test outcome, not proof of pre-existing provenance,
an ignored baseline, a confirmed root cause or a corrected defect. No expectation
was weakened and no runtime behavior was changed to make it pass. That tested
package did NOT have two consecutive complete passing runs. Any affected control
activation still needs its actual required acceptance evidence; compatibility
authoring must not be reported as certified runtime readiness.
