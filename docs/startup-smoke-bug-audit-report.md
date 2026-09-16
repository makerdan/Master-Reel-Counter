# Startup Smoke Validation Bug Audit Report

**Scope:** `scripts/startup-smoke.sh`, the PostgreSQL compatibility helper,
the `test-heavy` manifest integration, and the GitHub Actions workflow
assumptions that supply the startup-smoke environment.
**Mode:** Report-only
**Date:** 2026-09-16
**Stack:** Bash, Node.js/ECMAScript modules, Express, PostgreSQL, and
GitHub Actions. Type-safety and backend startup boundaries were inspected;
React-specific lifecycle checks do not apply to this validation tool.
**Validation ceiling:** `test-heavy`
**Product or validation code changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 2 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | Medium | Async & timing | `scripts/startup-smoke.sh:98-99` | Cleanup targets the `npx` wrapper PID and can leave the server descendant running |
| F-002 | Medium | State & data integrity | `scripts/startup-smoke.sh:38-43` | The preflight verifies PostgreSQL version but not the identity of the target database |
| F-003 | Medium | Async & timing | `scripts/startup-smoke.sh:38-44` | The database preflight has no connection or query timeout |
| F-004 | Low | Error handling | `scripts/startup-smoke.sh:126-130` | A missing `curl` is reported as a server-readiness failure instead of an environment failure |
| F-005 | Low | Error handling | `scripts/startup-smoke.sh:11,101-105` | Invalid timeout input reaches Bash arithmetic and produces an opaque failure |

## Inventory and validation path

The startup-smoke path is:

1. `scripts/run-tier.mjs` acquires the `validation` serial lock and executes
   the `test-heavy` steps from `docs/validation/manifest.json`.
2. The first heavy step runs `bash scripts/startup-smoke.sh`.
3. The script requires `DATABASE_URL`, requires `psql`, queries
   `server_version` and `server_version_num`, and compares the detected major
   version with `postgresMajorVersion()` and
   `SUPPORTED_POSTGRES_MAJOR_VERSION` from
   `scripts/lib/github-actions-validation-contract.mjs`.
4. It clears the configured smoke port, launches `npx tsx server/index.ts`,
   polls `/api/healthz`, scans captured output for
   `ERR_ERL_KEY_GEN_IPV6`, and exits after its cleanup trap.
5. In GitHub Actions, the workflow supplies PostgreSQL 16 at
   `master_reel_counter_test`; the job separately waits for PostgreSQL,
   checks the workflow contract, pushes the schema, seeds an owner, and
   invokes `npm run ci`, which routes back to `test-heavy`.

The version contract is internally aligned: the helper exports PostgreSQL 16,
the workflow service uses `postgres:16`, and the manifest runs startup smoke
before the remaining heavy checks. The workflow's separate empty-database
test also constrains its disposable database URL to the expected local
service and database name. Those protections do not change the local
startup-smoke behavior described in F-002.

## Evidence and validation baseline

The working tree was clean before this report was written. No database,
workflow, application, dependency, or validation source was changed.
`docs/validation/failure-baseline.json` contained no active records.

The required command was run once under the task plan:

```text
TASK_PLAN_FILE=.local/tasks/bug-audit-startup-smoke.md npm run test-heavy
```

The following steps passed before the command reached collision-smoke:

- startup smoke, including PostgreSQL 16.10 compatibility and the health
  probe;
- high-severity dependency audit with zero vulnerabilities;
- exported-schema and migration validation;
- workspace-skill contract;
- application and Playwright typechecks;
- storage lint;
- unit tests (108 passing tests);
- Vite HMR tests;
- serial-lock tests (14 passing tests);
- port-authority tests; and
- validation-manifest parity.

Collision-smoke printed that both concurrent commands had spawned and then
waited for both to complete. The task command wrapper timed out after 300
seconds before collision-smoke produced a result. No startup-smoke failure was
observed, and the run was not escalated or retried. This is recorded as an
incomplete validation-harness result, not as evidence that any finding is
pre-existing.

Additional safe local probes verified the findings below:

- A temporary `npx`-style supervisor running a local HTTP fixture retained a
  serving descendant after the PID recorded by the shell launch was
  terminated.
- A temporary `psql` fixture that slept indefinitely remained in the
  preflight until an external `timeout` command terminated the script.
- A temporary `curl` fixture that returned command-not-found produced the
  generic “server did not bind” message.
- `SMOKE_TIMEOUT=nope` reached line 104 and failed with Bash's
  `unbound variable` diagnostic rather than a startup-smoke validation
  message.

## Audit category passes

1. **Null / undefined safety:** No startup-smoke pass-through or missing
   metadata path was verified as an unsafe success. The contract helper
   rejects nonnumeric and non-integer version values.
2. **Async & timing:** F-001 and F-003 were verified. Health polling is
   bounded per request, but process and database cleanup/readiness boundaries
   are not fully bounded.
3. **Error handling:** F-004 and F-005 were verified. The explicit
   `DATABASE_URL`, `psql`, query, version metadata, and server-output failures
   otherwise fail closed.
4. **Type safety:** The helper is JavaScript and uses runtime numeric
   validation; the application and Playwright typechecks passed in the heavy
   run. No additional helper defect was verified.
5. **State & data integrity:** F-002 was verified: version identity is checked
   without checking target database identity.
6. **Security:** No credential is printed by the startup-smoke messages, and
   the database URL is passed as a quoted argument. No new credential
   disclosure or command-injection finding was verified.
7. **Performance:** The normal health loop is bounded, but the unbounded
   `psql` call is reported under async/timing rather than duplicating F-003.
8. **Concurrency & shared state:** F-001 covers the leaked process boundary.
   The heavy tier and workflow use the intended validation serial resource;
   the collision-smoke result was a separate harness timeout.
9. **Dead / unreachable code:** No startup-smoke branch was verified as dead
   or unreachable.
10. **Dependency hygiene:** The required dependency audit passed with zero
    high-severity advisories. No dependency finding is reported.

## Findings

### Finding F-001 — Smoke cleanup can leave the launched server running

- **File and line:** `scripts/startup-smoke.sh:98-99,15-20`
- **Category:** Async & timing
- **Severity:** Medium
- **Risk:** The launch uses `PORT="$SMOKE_PORT" npx tsx server/index.ts &` but
  stores only `$!`. In the observed local process shape, Bash held a wrapper
  PID while `npx`/`npm exec` remained a child. The cleanup trap sent `SIGTERM`
  to the recorded wrapper and waited for it, while the descendant continued
  serving the health endpoint. A passing smoke run can therefore leave a
  server on the smoke port, leak resources, and contaminate a later
  validation run or another local process. The next run may incidentally
  remove it through `free-ports`, masking the cleanup defect.
- **Recommended fix:** Launch the server in a clearly owned process group
  (preferably without the extra `npx` supervisor) and terminate and wait for
  the entire group. After cleanup, assert that the smoke port has no listener
  before deleting the log and returning success.

### Finding F-002 — Database identity is not part of the startup contract

- **File and line:** `scripts/startup-smoke.sh:38-43`
- **Category:** State & data integrity
- **Severity:** Medium
- **Risk:** The preflight asks PostgreSQL only for `server_version` and
  `server_version_num`. A `DATABASE_URL` pointing at a different database on
  the same PostgreSQL major version passes the preflight and `/api/healthz`
  check. For example, a local validation run can accidentally boot against a
  similarly versioned development or shared database while reporting that the
  target is compatible. The GitHub Actions workflow reduces this risk with its
  fixed URL and separate empty-database guard, but the reusable startup-smoke
  command itself does not enforce that identity.
- **Recommended fix:** Define the expected validation target for contexts that
  require one, then query and compare `current_database()` and the relevant
  host/port or a controlled validation marker. Keep the generic external
  database mode explicit rather than treating any same-major PostgreSQL
  database as the canonical target.

### Finding F-003 — PostgreSQL preflight can block without a deadline

- **File and line:** `scripts/startup-smoke.sh:38-44`
- **Category:** Async & timing
- **Severity:** Medium
- **Risk:** The `psql` compatibility query has no connection timeout and no
  statement timeout. A firewall silently dropping connections, a blackholed
  external host, or a PostgreSQL endpoint that accepts but does not complete
  the query can hold the first heavy step indefinitely until an outer runner
  timeout intervenes. A local fixture that slept in place of `psql` confirmed
  that startup-smoke itself did not stop; only an external `timeout` killed it.
  This makes the documented smoke timeout ineffective for the database
  preflight and delays actionable failure output.
- **Recommended fix:** Apply a bounded `psql` connection timeout and a
  bounded server-side statement timeout, or wrap the preflight in an explicit
  timeout whose failure message identifies the database readiness deadline.

### Finding F-004 — Missing `curl` is misclassified as a readiness failure

- **File and line:** `scripts/startup-smoke.sh:126-130`
- **Category:** Error handling
- **Severity:** Low
- **Risk:** The script never checks that `curl` exists. If it is absent or
  unusable, the command in the `if` condition fails repeatedly and the script
  eventually reports that the server did not bind. This consumes the full
  smoke window and points an operator toward the server instead of the missing
  validation dependency. A fixture `curl` returning command-not-found
  reproduced the generic bind failure.
- **Recommended fix:** Validate `curl` alongside `psql` before launching the
  application and emit a dedicated dependency failure with installation or
  environment guidance.

### Finding F-005 — Invalid smoke timeout values fail opaquely

- **File and line:** `scripts/startup-smoke.sh:11,101-105`
- **Category:** Error handling
- **Severity:** Low
- **Risk:** `SMOKE_TIMEOUT` is accepted as arbitrary text and is later
  evaluated by Bash arithmetic under `set -u`. With `SMOKE_TIMEOUT=nope`,
  the script failed at the loop with `nope: unbound variable`, rather than
  identifying invalid configuration. Other arithmetic expressions can be
  interpreted rather than rejected as a duration. The script still fails
  closed, but invalid CI or local environment input produces an opaque
  diagnostic and an unreviewed timeout value.
- **Recommended fix:** Validate `SMOKE_TIMEOUT` as a positive decimal integer
  immediately after reading it, reject invalid values with a dedicated
  message, and use the same explicit validation style already applied by
  `free-ports.mjs` to `SMOKE_PORT`.

## Deferred / not audited

- No startup, database, workflow, or validation code was fixed, per the
  report-only task scope.
- Runtime behavior after the smoke gate succeeds was not audited.
- The collision-smoke timeout was not investigated as a separate task because
  it is outside the startup-smoke scope and the task forbids escalation.
- The report does not treat the passing heavy-tier startup step as proof that
  the cleanup, identity, or timeout edge cases are safe; those cases require
  focused regression tests or fixture-based checks when a fix is authorized.