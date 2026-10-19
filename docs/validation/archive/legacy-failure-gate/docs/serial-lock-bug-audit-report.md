# Serial-Lock Validation Tool Bug Audit Report

**Scope:** `scripts/serial-lock.mjs`, its focused real-process contract tests,
the validation tier runners, lock-file and waiter-directory configuration, and
the nested validation path.
**Mode:** Report-only
**Audit date:** 2026-09-16
**Validation ceiling:** `test-standard`
**Implementation, test, runner, and process-management code changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 5 |
| Medium | 1 |
| Low | 0 |

| ID | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Lifecycle & timeout | `scripts/serial-lock.mjs:156-198,300-350` | A malformed or partially-created lock is retried forever without applying `MAX_WAIT_MS` |
| F-002 | High | Concurrency & ownership | `scripts/serial-lock.mjs:301-327` | Stale-lock reclamation can unlink a replacement holder's lock after the ownership changed |
| F-003 | High | Signal handling & cleanup | `scripts/serial-lock.mjs:365-410` | A wrapper receiving `SIGTERM` can keep a healthy heartbeat and lock indefinitely when its child ignores the signal |
| F-004 | High | Process management | `scripts/serial-lock.mjs:383-407` | Timeout cleanup kills only the direct child and releases the lock while detached descendants continue running |
| F-005 | High | Runner integration | `docs/validation/manifest.json:44-62`, `package.json:32-33`, `scripts/run-tier.mjs:102-115` | The non-smoke heavy tier recursively invokes itself without the inherited reentrancy marker |
| F-006 | Medium | Waiter isolation | `scripts/serial-lock.mjs:224-276` | A shared waiter directory lets a higher-priority waiter for another resource block this resource |

The findings are ordered by severity and then operational impact. No finding
was fixed during this audit.

## Validation and evidence

### Required validation

The exact required command, `npm run test-standard`, passed. It completed
typecheck, storage lint, the registered unit tests, Clerk contract tests, Vite
HMR tests, and validation-manifest parity. During acquisition it reported and
reclaimed a dead `validation` lock from PID 430 that had been held for about
248 seconds; this was harness state, not a suite failure.

The standard tier does not include the dedicated serial-lock contract test.
That test is registered in `test-standard-plus` and `test-heavy`. To inspect
the requested focused coverage without escalating the task validation tier, it
was run directly:

```text
npx tsx server/__tests__/ci-serial-lock.test.ts
Results: 14 passed, 0 failed
```

The focused tests cover normal acquisition/release, heartbeat updates,
ordinary queueing, stale/dead/max-hold recovery, same-resource reentrancy,
resource striping, priority ordering, SIGTERM with a cooperative `sleep`
child, and exit-code forwarding. They do not cover malformed lock contents,
ownership-change races, an uncooperative child, detached descendants, shared
waiter directories, or the real heavy-tier nested path.

### Deterministic audit probes

- A zero-byte lock with `SERIAL_LOCK_MAX_WAIT_MS=500` and a 100 ms poll
  interval remained in place after a 2-second external timeout. The wrapper
  produced no timeout diagnostic and did not exit at 500 ms.
- A live higher-priority waiter manifest for resource `alpha` in a shared
  waiter directory prevented a `beta` invocation from acquiring an otherwise
  absent `beta` lock. The `beta` process timed out externally after 2 seconds
  despite `MAX_WAIT_MS=500`; both waiter files remained.
- A child that records its PID and ignores `SIGTERM` left the wrapper alive
  after the wrapper received `SIGTERM`. After one second, both PIDs and the
  lock file were still alive/present.
- A child that detached `sleep 30` and wrote its PID to a temporary file was
  run with a 100 ms post-acquisition timeout. The wrapper logged the timeout,
  released its lock, and exited while the detached sleep PID was still alive.
- The stale-reclamation ownership race and the heavy-tier recursion were
  verified by control-flow tracing against the source and configuration. The
  full heavy tier was not run because the task plan explicitly forbids
  escalating beyond `test-standard`.

## Findings

### F-001 — Malformed or partially-created lock bypasses the wait timeout

- **Severity:** High
- **Category:** Lifecycle & timeout
- **Location:** `scripts/serial-lock.mjs:156-198,300-350`
- **Failure scenario:** A process creates the lock with `openSync(..., "wx")`
  and crashes before `writeLock()` runs, leaving a zero-byte file. The same
  behavior occurs for a truncated or otherwise invalid lock file. Every
  contender receives `null` from `readLock()`, attempts `openSync("wx")`,
  receives `EEXIST`, sleeps, and repeats. Because the `MAX_WAIT_MS` check is
  only in the `else` branch for a parsed lock, the contender never reports a
  timeout or writes a waiter manifest.
- **Evidence:** The implementation closes the exclusive descriptor at line
  192 and performs the non-transactional initialization at line 193. The
  malformed-lock probe left the empty lock present and returned external
  timeout status 124 after more than four times the configured 500 ms maximum,
  with no stderr output.
- **Impact:** A crash at the lock-creation boundary can deadlock every later
  validation run for that resource until a person removes the lock file.
  This defeats the documented timeout and makes the failure look like silent
  queue delay.
- **Recommended fix:** Treat a malformed lock as a recoverable stale state
  with an atomic ownership-safe replacement/removal protocol, or make lock
  creation write the complete record while holding an exclusive descriptor.
  Apply the acquisition deadline on every retry path, including malformed and
  empty records, and emit an incident diagnostic before recovery.

### F-002 — Stale-lock reclaim can delete a replacement holder's lock

- **Severity:** High
- **Category:** Concurrency & ownership
- **Location:** `scripts/serial-lock.mjs:301-327`
- **Failure scenario:** Contender A reads a lock whose heartbeat is stale.
  Before A executes `clearLock()`, the original holder exits and contender B
  observes the missing file, creates a new lock, and starts work. A then
  unconditionally calls `unlinkSync(LOCK_PATH)` and removes B's live lock.
  A may acquire the path again, leaving two holders running without a lock
  record that either can safely release.
- **Evidence:** The stale decision is based on one `readLock()` snapshot at
  lines 302-319. `clearLock()` at lines 201-207 unlinks by path only and does
  not compare the file's PID, acquisition token, or contents immediately
  before deletion. The subsequent `tryCreateLock()` cannot restore the
  ownership guarantee after an intervening holder has created the path.
- **Impact:** Concurrent validation jobs can overlap despite the serial lock,
  producing port collisions, conflicting schema/test state, or misleading
  pass results. This is a safety failure rather than normal queue delay.
- **Recommended fix:** Give each lock record a unique ownership token and use
  an atomic compare-and-remove or rename-to-quarantine operation that proves
  the record being removed is still the observed record. Re-check ownership
  before acquisition and make release use the same token.

### F-003 — SIGTERM can leave the wrapper and lock alive indefinitely

- **Severity:** High
- **Category:** Signal handling & cleanup
- **Location:** `scripts/serial-lock.mjs:365-410`
- **Failure scenario:** The wrapper receives `SIGTERM` while its child ignores
  `SIGTERM` or is stuck in a shutdown path. The handler at line 410 forwards
  the signal but does not set an exit state, release the lock, or force the
  child to stop. The wrapper continues its heartbeat while waiting for the
  child's `close` event.
- **Evidence:** The deterministic probe used a child that recorded its PID,
  installed a no-op `SIGTERM` handler, and had a five-second timer. After
  sending `SIGTERM` to the wrapper and waiting one second, the wrapper and
  child were both alive and the lock file was still present. The focused test
  only exercises cooperative `sleep` termination at
  `server/__tests__/ci-serial-lock.test.ts:434-448`.
- **Impact:** A cancelled validation can continue holding the resource for
  the entire child lifetime, and because the wrapper heartbeat remains fresh,
  other contenders cannot reclaim it as stale. With a long-lived or stuck
  child, the lock remains until the maximum hold safety valve is reached.
- **Recommended fix:** Make signal handling idempotently mark shutdown,
  terminate the child process group, enforce the existing grace period, and
  release/exit even when the child does not close cooperatively. Preserve a
  non-zero signal-derived exit status.

### F-004 — Timeout releases the lock while detached descendants continue

- **Severity:** High
- **Category:** Process management
- **Location:** `scripts/serial-lock.mjs:383-407`
- **Failure scenario:** A timed command starts a detached or background
  descendant and then receives the wrapper's timeout signal. The timeout
  handler kills only `child`; it does not address the descendant process
  group. The direct child closes, `release()` removes the lock, and the
  descendant continues using ports, files, databases, or other shared
  resources outside the serialized section.
- **Evidence:** The probe started a detached `sleep 30`, configured a 100 ms
  timeout, and recorded the descendant PID. The wrapper emitted its timeout
  incident and released the lock, while the recorded descendant was still
  alive.
- **Impact:** A later validation can run concurrently with work from the
  timed-out validation. This can create exactly the collision and cleanup
  failures the lock is intended to prevent.
- **Recommended fix:** Launch lock-held commands in a dedicated process group
  or otherwise enumerate and terminate their descendants on timeout and
  signal. Verify group cleanup before releasing the lock, and report an
  incident if descendants remain.

### F-005 — Real heavy validation recursively queues behind itself

- **Severity:** High
- **Category:** Runner integration
- **Location:** `docs/validation/manifest.json:44-62`,
  `package.json:32-33`, `scripts/run-tier.mjs:102-115`
- **Failure scenario:** A normal `test-heavy` run acquires the `validation`
  resource and begins its manifest steps. The first step is `npm run ci`
  (manifest line 61), and `ci` is `npm run test-heavy` (package line 33).
  The nested run therefore attempts the same `validation` resource. Before
  spawning steps, the outer runner removes
  `VALIDATION_LOCK_HELD_PID_*` and `SERIAL_LOCK_HOLDER_PID` from `stepEnv`,
  so the nested invocation cannot take the documented reentrant path. It
  queues behind the outer process until its wait budget expires; the outer
  `spawnSync` cannot continue until that child exits.
- **Evidence:** This is a deterministic control-flow trace through the
  manifest, package scripts, and environment-clearing loop. The collision
  smoke mode cannot expose it because `CI_SMOKE_TEST=1` exits before running
  any manifest step. The full heavy tier was intentionally not run under the
  task's `test-standard` validation ceiling.
- **Impact:** The canonical non-smoke heavy validation path can wait for its
  own lock and fail after the lock timeout rather than execute the intended
  CI checks. The collision smoke check gives a false sense of coverage because
  its smoke flag skips the recursive step.
- **Recommended fix:** Remove the recursive `npm run ci` indirection from the
  `test-heavy` manifest and invoke the intended heavy steps once, or make the
  runner's nested-tier contract explicit and preserve a verified reentrancy
  marker only for the same resource and lock identity. Add a non-smoke
  regression test that reaches the manifest step.

### F-006 — Shared waiter directories are not resource-scoped

- **Severity:** Medium
- **Category:** Waiter isolation
- **Location:** `scripts/serial-lock.mjs:224-276`
- **Failure scenario:** Two resources use the same
  `VALIDATION_LOCK_WAITERS_DIR`, as can happen when a harness shares a
  project-level directory while assigning separate lock resources. A live,
  higher-priority waiter manifest for `alpha` is read by a `beta` contender.
  `readWaiters()` parses the manifest's `resource` field but
  `higherPriorityWaiterIsDue()` never filters it against `RESOURCE`, so
  `beta` remains queued even though no `beta` lock exists.
- **Evidence:** A live Node process and a due priority-1 `alpha` manifest were
  placed in a shared temporary waiter directory. A priority-5 `beta`
  invocation with no beta lock remained blocked for two seconds and produced
  its own waiter file; a correctly resource-isolated run would acquire
  immediately. The focused resource-striping test uses separate lock paths
  and does not exercise a shared waiter directory.
- **Impact:** Unrelated validation resources can block one another or appear
  to deadlock. The default directory is resource-specific, so this is
  configuration-dependent rather than a failure in the default path.
- **Recommended fix:** Filter manifests by `waiter.resource === RESOURCE`
  before applying priority or deleting stale entries, and preferably include
  the resource in the waiter filename/namespace. Keep the isolated-directory
  guidance for independent harness runs.

## Category pass results

1. **Lock ownership and atomicity:** F-002 was verified from the
   stale-reclaim sequence. Normal creation uses `wx`, but replacement and
   release do not carry an ownership token.
2. **Queueing, priority, and waiter isolation:** Normal same-resource
   priority ordering passed in the focused test. F-006 was reproduced with a
   shared waiter directory. The resource field is recorded but not enforced.
3. **Timeout behavior:** F-001 shows the acquisition timeout is bypassed for
   malformed locks. The post-acquisition timeout is present but only covers
   the direct child, as reported in F-004.
4. **Heartbeat and stale recovery:** Normal heartbeat, stale, dead, and
   max-hold cases passed. F-002 identifies the missing compare-and-delete
   boundary in stale recovery.
5. **Signal handling:** Cooperative SIGTERM cleanup passed in the focused
   test. F-003 shows the uncooperative-child path does not terminate or
   release the wrapper.
6. **Process cleanup:** F-004 was reproduced with a detached descendant.
   Direct-child cleanup is not equivalent to process-tree cleanup.
7. **Nested invocation:** Same-resource environment-based reentrancy passed
   in the focused test. F-005 is a separate runner integration path where
   the marker is intentionally stripped before a recursive tier command.
8. **Failure classification and exit propagation:** Cooperative child exit
   status forwarding passed. Timeout, malformed-lock, and signal-stuck paths
   can report a misleading operational result or fail to return at the
   configured deadline.
9. **Runner coverage:** `test-standard` passed but does not run the dedicated
   serial-lock contract test; that focused step is in `test-standard-plus`
   and `test-heavy`. This is recorded as a coverage limitation, not a new
   implementation finding.
10. **Scope control:** No browser, production release, or unrelated heavy
    suite was run. No lock, runner, focused test, or process-management code
    was changed.

## Report-only stop

This audit stops at the report-only boundary. The findings are recommendations
for separate remediation and regression-test work. No implementation, test,
validation-tier, configuration, process, or lock-file behavior was changed.