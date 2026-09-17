# CI Collision Smoke Bug Audit Report

**Scope:** `scripts/ci-collision-test.mjs`, its direct `serial-lock.mjs` and
`run-tier.mjs` dependencies, the heavy-tier manifest, CI invocation, and the
port-authority lock-isolation contract.
**Mode:** Report-only
**Audit date:** 2026-09-16
**Validation ceiling:** `test-heavy`
**Collision harness, lock, CI, and process-management code changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 3 |
| Medium | 2 |
| Low | 0 |

| ID | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Concurrency & shared state | `scripts/ci-collision-test.mjs:153-175` | The smoke can pass when only one child acquired the lock |
| F-002 | High | Async & timing | `scripts/ci-collision-test.mjs:132-138` | Waiting for natural completion has no harness-level deadline |
| F-003 | High | Process management | `scripts/ci-collision-test.mjs:132-138` | Interrupted runs skip cleanup and orphan the two child processes |
| F-004 | Medium | Concurrency & shared state | `scripts/ci-collision-test.mjs:76-91`, `scripts/serial-lock.mjs:138-145` | One temporary lock path conflates distinct logical resources and leaves waiter state shared |
| F-005 | Medium | State & data integrity | `scripts/ci-collision-test.mjs:49-63` | Substring route checks can accept scripts that do not actually invoke the required command |

The findings are ordered by severity and then operational impact. No finding
was fixed during this audit.

## Validation and evidence

The required plan-locked command was run as `TASK_PLAN_FILE=.local/tasks/bug-audit-collision-smoke.md npm run test-heavy`.
The first run completed every step through `collision-smoke` successfully:

- startup smoke, security audit, schema check, workspace-skill contract,
  typecheck, storage lint, unit tests, Vite HMR tests, serial-lock tests,
  port-authority tests, manifest parity, and collision smoke passed;
- the collision smoke step passed in 7.8 seconds, with both child exit codes
  equal to zero, a waiting message observed, and an acquisition message
  observed;
- the shell execution limit interrupted the later browser step while 59
  browser tests were still running. This was a validation-harness timeout, not
  a reported browser test failure. No validation or browser processes remained
  afterward; the dead outer lock was removed as local harness cleanup.

A second background run of the same plan-locked command completed with exit
code 0. The browser step passed in 285,429 ms, followed by
`[validation] PASS: test-heavy completed`. This confirms the required heavy
tier passed end to end; the first foreground shell timeout was only an
interactive execution limit.

The platform-managed completion validation was a separate harness run that
started `test-fast`, `test-standard`, `test-standard-plus`, and `test-heavy`
concurrently. The heavy invocation acquired the shared `validation` lock;
all four managed commands then returned exit 1 after the queued commands
reached the 600-second lock-wait deadline. Their logs contain only lock
waiting and timeout messages, not suite failures. This is recorded as a
completion-harness concurrency limitation, not as a regression from this
report-only task.

Focused deterministic probes verified the collision-harness findings without
starting competing project workflows:

1. A temporary `npm` shim returned code 0, printed `"[serial-lock] acquired
   lock"` only for the `ci` child, and printed `"[serial-lock] waiting"` only
   for the `test:e2e` child. The real collision script exited 0 and printed
   “All assertions passed,” even though neither child acquired a real lock.
   This directly demonstrates the one-sided positive assertion.
2. A temporary `npm` shim ran both children for 30 seconds. Wrapping the
   collision script in an external three-second timeout produced exit 124
   after the script printed “Waiting for both to complete”; the script has no
   internal deadline or failure diagnostic.
3. A temporary `npm` shim recorded the lock path, wrote a holder record, and
   ran two sleeping children. Terminating the collision script before either
   child closed left the temporary lock file present and both child PIDs alive.
   The probe then killed only those isolated PIDs and removed its temporary
   lock.
4. Source tracing confirms that both real nested commands receive the same
   `VALIDATION_LOCK_FILE`, while their package scripts identify different
   logical resources (`validation` and `e2e-port`). The smoke does not override
   `VALIDATION_LOCK_WAITERS_DIR`, so waiter manifests remain in the normal
   resource directories. The attempted live-waiter probe exceeded the
   interactive shell ceiling before producing evidence and is not used as
   proof of a separate runtime failure.

## Findings

### F-001 — One-sided lock evidence can report a false pass

- **Severity:** High
- **File and line:** `scripts/ci-collision-test.mjs:153-175`
- **Category:** Concurrency & shared state
- **Risk:** The intended contract says both invocations acquire the lock and at
  least one queues. The implementation checks that at least one output contains
  `acquired lock`, not that each result does, and it checks waiting
  independently. If one entrypoint stops using `serial-lock.mjs`, exits 0, and
  the other prints the expected waiting/acquisition messages, the smoke still
  passes and reports that collision prevention works. A fake-`npm` probe
  reproduced this exact exit-0 false pass.
- **Recommended fix:** Require each result to contain an acquisition record,
  require the expected resource and process identity in those records, and
  retain the separate assertion that one process waited. Treat missing lock
  evidence from either child as a failure and print both captured streams.

### F-002 — A hung child can hold the collision step indefinitely

- **Severity:** High
- **File and line:** `scripts/ci-collision-test.mjs:132-138`
- **Category:** Async & timing
- **Risk:** After spawning both children, the harness awaits `Promise.all` with
  no deadline, race, or progress watchdog. If `npm run ci` or `npm run
  test:e2e` hangs, the smoke never reaches its assertions or cleanup. The
  heavy tier then waits until its much larger outer budget or an external CI
  cancellation. A deterministic shim that kept both children alive caused the
  harness to remain at “Waiting for both to complete” until an external
  three-second timeout terminated it.
- **Recommended fix:** Add a bounded collision-test deadline shorter than the
  heavy-tier budget. On expiry, terminate both child process groups, collect
  their exit/signal state and output, run cleanup, and fail with an explicit
  timeout diagnostic.

### F-003 — Termination before normal completion skips child and lock cleanup

- **Severity:** High
- **File and line:** `scripts/ci-collision-test.mjs:132-138`
- **Category:** Process management
- **Risk:** The temporary lock is removed only after `Promise.all` resolves.
  There is no `finally` block and no signal handler around the two spawned
  processes. If the collision script is cancelled, killed by an outer
  validation timeout, or otherwise exits before both `close` events, both
  nested commands can remain alive and the temporary lock can remain in `/tmp`.
  Those children can continue using the validation resource after the outer
  lock has moved on, and later diagnostics can be contaminated by orphaned
  work. The isolated termination probe left both child PIDs alive and the
  recorded temporary lock present after the harness exited with signal status.
- **Recommended fix:** Put cleanup in an idempotent `finally` path, install
  signal handlers that stop both children, launch them in killable process
  groups, and verify child termination before deleting the temporary lock.
  Preserve a non-zero signal-derived result.

### F-004 — The smoke does not test resource isolation and shares waiter state

- **Severity:** Medium
- **File and line:** `scripts/ci-collision-test.mjs:76-91`;
  `scripts/serial-lock.mjs:138-145`
- **Category:** Concurrency & shared state
- **Risk:** The harness assigns the same temporary path to both
  `VALIDATION_LOCK_FILE` and `SERIAL_LOCK_PATH`. The `ci` route enters the
  `validation` resource, while `test:e2e` enters `e2e-port`; because
  `VALIDATION_LOCK_FILE` takes precedence, the probe turns those distinct
  resources into one physical lock. It therefore proves only that two
  commands contend on one pathname, not that named resources remain isolated
  or that the lock rejects a resource/path mismatch. The harness also leaves
  `VALIDATION_LOCK_WAITERS_DIR` unset, so its waiter files use the normal
  project directories and can be influenced by other same-resource validation
  activity. This can make the smoke delay or fail for unrelated queue state
  while claiming to be isolated.
- **Recommended fix:** Keep this as an explicitly shared-path collision test,
  but add a separate isolated-resource assertion using distinct lock and
  waiter directories and assert that different resources overlap. For the
  shared collision case, use a dedicated temporary waiter directory and
  assert the lock records/resource names so the test documents exactly which
  invariant it covers.

### F-005 — Route integration checks accept substring lookalikes

- **Severity:** Medium
- **File and line:** `scripts/ci-collision-test.mjs:49-63`
- **Category:** State & data integrity
- **Risk:** The Part 1 contract uses `script.includes(expected)` rather than
  parsing or comparing the command route. A package script such as `echo
  test-heavy && npm run test-standard` or `node serial-lock.mjs.backup` would
  satisfy the check without routing through the canonical heavy runner or
  lock wrapper. The concurrent portion would then be the only remaining guard,
  but it can still pass on the one-sided evidence described in F-001.
- **Recommended fix:** Parse the package script into the expected command
  structure or compare against an exact normalized route contract. Add
  negative fixtures for substring lookalikes and require the integration
  check to fail when the canonical executable/script is absent.

## Category pass results

1. **Null / undefined safety:** No verified null-access defect in the
   collision path. `spawn` streams are optional in the helper but are created
   with piped stdio by both callers.
2. **Async & timing:** F-002 was verified. The two completion promises have no
   internal timeout, and a failing child does not cause the other to be
   cancelled.
3. **Error handling:** The child exit assertions do catch non-zero exits, but
   timeout and signal paths do not produce a controlled collision-test result;
   those lifecycle issues are captured in F-002 and F-003.
4. **Type safety:** This JavaScript tool has no static type gate. Runtime
   result objects are simple local records, but their contract is not
   validated beyond the current assertions.
5. **State & data integrity:** F-005 was verified by tracing the substring
   route contract. The captured output is also unbounded, though no practical
   output-flood failure was recorded and it is deferred.
6. **Security:** No credential or user-input sink was found in the audited
   collision path. The temporary path is random and does not expose secrets.
7. **Performance:** Normal collision execution completed quickly. The
   unbounded output buffer and unbounded wait are reliability risks, with the
   latter reported as F-002.
8. **Concurrency & shared state:** F-001 and F-004 were verified. The smoke
   intentionally creates a collision but does not prove every child acquired
   the lock or that independent named resources remain independent.
9. **Dead / unreachable code:** No verified dead branch was found in the
   audited files.
10. **Dependency hygiene:** The heavy-tier `npm audit --audit-level=high`
    step passed with zero vulnerabilities during the completed run.

## Deferred / not audited

- No changes were made to the collision harness, serial lock, tier runner,
  CI workflow, process-management code, or port-authority implementation.
- No competing live workflows were started. All behavioral probes used
  temporary local shims and isolated `/tmp` state.
- The live waiter-directory probe exceeded the interactive shell ceiling
  before producing output and is not treated as a verified runtime finding.
- The first foreground shell invocation was interrupted by its five-minute
  interactive limit while browser tests were running, but the second
  background `test-heavy` run completed the full browser phase successfully.
- The platform-managed completion run could not validate the four tiers
  concurrently because they share one serial validation resource; its
  lock-wait expirations are documented above and are not attributed to this
  task.
- General serial-lock behavior outside assumptions directly used by this
  collision tool was not re-audited. Existing serial-lock audit findings are
  not repeated here.

## Report-only stop

This audit stops at the report-only boundary. The findings are
recommendations for separate remediation and regression-test work. No
implementation, test, validation-tier, configuration, process, or lock-file
behavior was changed; only this audit report was added.