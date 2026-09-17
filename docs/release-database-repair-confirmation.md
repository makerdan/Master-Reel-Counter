# Release database repair confirmation

**Date:** 2026-09-17  
**Conclusion:** **NOT CONFIRMED**

The automatic release-database lifecycle is working and preserved the
publishing database during the observed failed release. The canonical Replit
release build did not pass candidate smoke validation, however, so the release
database repair cannot be confirmed against the complete acceptance contract.

## Scope and method

This confirmation exercised the Replit deployment build entry point from
`.replit` (`npm run release:build`) with `RELEASE_SMOKE_DATABASE_URL` removed.
It recorded the publishing target as a one-way identity fingerprint and
compared schema and smoke-fixture state before and after execution. Database
URLs, credentials, Clerk secrets, cookies, and complete temporary target names
were not retained.

Redacted identities:

- Publishing target: `db-cabd0223aab2`
- Automatic smoke target: `release_smoke_<pid>_<unique-id>`

The publishing schema signature is a SHA-256 hash over ordered
`information_schema.columns` metadata. Smoke-row checks count `users` rows
whose local ID or email matches the release-smoke fixture prefixes. Temporary
target checks query `pg_database` for the `release_smoke_%` ownership prefix.

## Commands and observed results

### Required heavy validation

```sh
TASK_PLAN_FILE=.local/tasks/task-761.md npm run test-heavy
```

**Result:** Harness-limited. The command did not begin validation steps within
the 300-second execution window because another process continuously held and
reacquired the shared `validation` lock. The output contains only lock-wait
messages; it is not product pass or failure evidence.

### Publishing database before-state

A secret-safe Node/`pg` probe connected through `DATABASE_URL`, hashed the
physical target identity and ordered public-schema columns, counted
release-smoke users, and listed run-owned temporary databases.

**Observed before-state:**

| Evidence | Value |
|---|---|
| Publishing target | `db-cabd0223aab2` |
| Public schema columns | `224` |
| Schema hash | `b51f44155209549079f86b9e14b46430c2283f68cede36e7969fb06c86d181bb` |
| Release-smoke users | `0` |
| `release_smoke_%` databases | none |

### Canonical automatic-target release

```sh
env -u RELEASE_SMOKE_DATABASE_URL npm run release:build
```

**Mode:** Automatic run-owned PostgreSQL target; managed-Clerk and Google-backed
candidate checks enabled by the canonical Playwright release configuration.

**Observed result:** Failed.

Observable stage evidence:

1. A unique `release_smoke_<pid>_<unique-id>` database appeared in
   `pg_database` while the command was running.
2. The production build completed.
3. The isolated release schema preparation completed before candidate startup.
4. The candidate application and canonical HTTPS proxy started.
5. Playwright reported `Running 3 tests using 1 worker`: two Google-backed role
   checks and one managed-Clerk check.
6. All three checks reached browser execution but could not find
   `button-login`.
7. Secret-redacted diagnostics showed Clerk proxy requests to
   `/api/__clerk/v1/environment` and `/api/__clerk/v1/client` returning `401`.
8. The command exited `1`; it did not print
   `Managed Clerk production-candidate release gate passed.`

This proves candidate smoke was reached rather than skipped or downgraded, but
it did not pass.

### Publishing database after-state

The same secret-safe probe was repeated after the release command exited.

| Evidence | Before | After |
|---|---:|---:|
| Publishing target | `db-cabd0223aab2` | `db-cabd0223aab2` |
| Public schema columns | `224` | `224` |
| Schema hash | `b51f44155209549079f86b9e14b46430c2283f68cede36e7969fb06c86d181bb` | `b51f44155209549079f86b9e14b46430c2283f68cede36e7969fb06c86d181bb` |
| Release-smoke users | `0` | `0` |
| `release_smoke_%` databases | none | none |

The failed run therefore left no observed smoke identity, user row, public
schema change, stale-fixture cleanup effect, or owned temporary database in the
publishing target. This before/after comparison, rather than cleanup success
alone, is the evidence for the publishing boundary.

### Focused release contract

```sh
npm run test:managed-clerk-release-contract
```

**Result:** Passed: `50/50` release lifecycle/schema tests and `9/9`
Clerk transport/bootstrap tests.

The passing cases include:

- missing explicit target selection before build and cleanup on success;
- preservation of an explicit isolated target after candidate failure;
- secret-safe create/drop capability failures;
- selection timeout cleanup;
- `SIGINT` and `SIGTERM` cleanup;
- real PostgreSQL create, URL selection, and verified removal;
- two consecutive automatic lifecycle runs without inherited residue;
- equivalent physical targets with different credentials, PostgreSQL protocol
  aliases, default-port variants, URL encoding, and query differences;
- schema rejection before fixture provisioning;
- managed-Clerk and Google-backed candidate discovery in the isolated release
  project;
- published workflow input and target validation contracts; and
- deterministic Clerk proxy and testing-token transport behavior.

These tests provide direct lifecycle and fail-closed harness evidence, including
a real PostgreSQL create/drop case. They do not override the canonical
candidate failure above.

## Acceptance result

| Acceptance criterion | Result | Evidence |
|---|---|---|
| Canonical build succeeds without an operator smoke URL | **Fail** | Automatic provisioning succeeded, but the build exited `1` after all candidate browser checks failed. |
| Candidate smoke is reached and passes | **Fail** | Three real candidate tests ran; all failed after Clerk proxy `401` responses. |
| Automatic target is distinct, run-owned, used, and removed | **Pass for observed failed run** | Unique target existed during schema/candidate activity and was absent afterward. |
| Publishing database remains unchanged | **Pass for observed failed run** | Target fingerprint, 224-column schema hash, zero smoke users, and temporary-database inventory were identical before and after. |
| Unsafe targets and missing lifecycle capability fail before mutation | **Pass in focused executable contract** | Equivalent-target, create/drop failure, timeout, and pre-fixture schema cases passed with secret-safe diagnostics. |
| Managed and Google candidate modes preserve the mutation boundary | **Pass for target selection; smoke incomplete** | Both modes ran against the isolated candidate setup; neither completed sign-in because Clerk bootstrap returned `401`. |
| Published verification is read-only | **Contract evidence only** | Focused checks passed; no production publish or republish was performed, and no mutating live published check was run. |
| Repeated successful run is clean | **Blocked** | No successful canonical first run exists to repeat. The two-run lifecycle harness passed, but that is not a substitute for two successful canonical release builds. |

## Blocking limitation

The release candidate's Clerk proxy returned `401` for environment and client
bootstrap requests. This prevented both Google-backed tests and the
managed-Clerk test from reaching sign-in. Fixing that behavior is outside this
confirmation task. After it is repaired, repeat the canonical command twice
with the same before/during/after database observations before changing this
conclusion to confirmed.