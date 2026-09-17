# Managed Clerk Contract Bug Audit Report

**Scope:** The managed Clerk release contract command
(`verify:managed-clerk-release`), its deterministic contract suite, the
published-release workflow, the release candidate build/proxy path, schema
preflight, disposable Clerk/database fixtures, permission checks, and bounded
diagnostics.
**Mode:** Report-only
**Audit date:** 2026-09-16
**Validation ceiling:** `test-standard`
**Product, release, fixture, credential, and test code changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 4 |
| Medium | 0 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Security | `tests/release/managed-clerk-auth.spec.ts:305-313` | Published verification has no expected candidate/build identity |
| F-002 | High | State & data integrity | `tests/release/managed-clerk-auth.spec.ts:198-205,273-287` | Published smoke writes disposable fixtures into the publishing database |
| F-003 | High | Security | `scripts/release-schema-preflight.mjs:32-35,53-58` | Database isolation compares credentials, not physical target identity |
| F-004 | High | Error handling | `tests/release/google-clerk-auth.spec.ts:191-209,251-253` | Google release tests create fixtures before schema preflight |

## Phase 0 — Discovery and scope

### Contract path

The package command in `package.json:27` runs:

1. `scripts/__tests__/managed-clerk-release.test.mjs`
2. `scripts/__tests__/release-schema-preflight.test.mjs`
3. `scripts/__tests__/secret-safe-actions.test.ts`
4. `scripts/__tests__/clerk-candidate-testing.test.ts`
5. `scripts/__tests__/clerk-bootstrap.test.ts`

The release Playwright configuration discovers `tests/release`, which contains
one managed-Clerk test and two Google-backed tests. The local discovery probe
reported all three tests under the `managed-clerk-production` project. The
release candidate build invokes the same configuration after starting the
candidate and its HTTPS proxy. The manual published workflow instead invokes
`verify:managed-clerk-published` against the configured public URL.

### Detected stack

- Node.js and TypeScript
- Playwright release tests
- Express application and Clerk backend/testing SDKs
- PostgreSQL through `pg`
- Bash release orchestration and GitHub Actions

The ten Bug Audit categories were considered. React lifecycle checks are not
applicable to this release-harness scope. Dependency hygiene was limited to
the registered validation tier; no separate dependency-audit command was run.

## Findings

### Finding F-001 — Published verification does not prove the deployment identity

- **File and line:** `.github/workflows/managed-clerk-release.yml:71-78`,
  `scripts/verify-published-release.mjs:10-35`,
  `tests/release/managed-clerk-auth.spec.ts:305-313`
- **Category:** Security
- **Severity:** High
- **Risk:** The candidate build path supplies `RELEASE_SMOKE_CANDIDATE_ID`
  and checks `/api/healthz.candidateId`, but the published workflow supplies no
  expected release or build identity. The smoke therefore validates only
  whatever responds at `PRODUCTION_BASE_URL`. If a stale deployment, a
  misrouted proxy, or the wrong deployment remains behind that URL, the check
  can pass while reporting that the intended release was verified. This is a
  false-success path for the release contract.
- **Evidence:** `verify-published-release.mjs` forwards the environment into
  Playwright but does not set or compare a candidate/build identifier.
  `validate-production-base-url.mjs:3-30` checks URL syntax and public HTTPS
  properties only. The managed smoke’s identity assertion is conditional on
  `RELEASE_SMOKE_CANDIDATE_ID`, which is absent from the published workflow.
- **Recommended fix:** Publish an immutable deployment identifier, such as the
  intended commit SHA or release ID, and require the published workflow to
  obtain and compare it with an application-owned health response. Fail closed
  when the expected identity is absent or mismatched. Keep the existing
  candidate-ID check for the internal candidate path.

### Finding F-002 — Published smoke mutates the publishing database

**Status:** Resolved. Published verification now runs a dedicated read-only
browser spec without database or Clerk secret credentials. Disposable identity,
role, navigation, and logout mutation coverage remains candidate-only.

- **File and line:** `tests/release/managed-clerk-auth.spec.ts:198-205`,
  `tests/release/managed-clerk-auth.spec.ts:273-287`,
  `tests/release/managed-clerk-auth.spec.ts:480-517`,
  `.github/workflows/managed-clerk-release.yml:71-78`
- **Category:** State & data integrity
- **Severity:** High
- **Risk:** In published mode, `internalCandidate` is false, so the smoke
  selects `DATABASE_URL` as `smokeDatabaseUrl`. It then creates a Clerk user
  and inserts an approved Admin row into that database before testing. Cleanup
  is best effort within the test’s `finally` path. An interrupted process,
  database outage, cleanup error, or concurrent application activity can leave
  release-test identities or rows in the publishing database. A wrong or stale
  published target also receives these writes before the test can establish
  that it is the intended deployment. This violates the release tool’s
  isolation boundary and can affect real authorization data.
- **Evidence:** The workflow provides `DATABASE_URL` but no
  `RELEASE_SMOKE_DATABASE_URL`. The published branch therefore bypasses
  `assertIsolatedReleaseDatabase` and writes the fixture through the
  publication connection. The internal candidate branch is isolated, but that
  protection does not apply to the published path.
- **Recommended fix:** Require a dedicated disposable database target for every
  smoke invocation, including published verification, and assert that it is
  distinct from the publication target before any fixture or provider write.
  If the deployed app cannot be pointed at that target, split the published
  check into a read-only health/authentication check and keep fixture mutation
  only in the isolated candidate environment.

### Finding F-003 — Database isolation can accept the same physical target

**Status:** Resolved. Isolation now compares credential-free normalized host,
effective port, and database name, ignores schema/search-path differences for
physical-database safety, and fails closed for unprovable host aliases.

- **File and line:** `scripts/release-schema-preflight.mjs:20-35,38-61`,
  `scripts/prepare-release-test-database.mjs:77-84`
- **Category:** Security
- **Severity:** High
- **Risk:** `databaseTarget` removes only the password before comparing URLs.
  Two connection strings for the same host, port, and database but different
  usernames normalize differently and are accepted as distinct. For example,
  the local probe showed that
  `postgresql://alice:one@db.example:5432/app` and
  `postgresql://bob:two@db.example:5432/app` are accepted by
  `assertIsolatedReleaseDatabase`. If CI supplies a least-privileged smoke
  user for the same physical database used by the publishing user, the
  release schema bootstrap and fixture writes can mutate the publication
  database despite the isolation guard.
- **Evidence:** The guard rejects only equality of the normalized strings.
  The normalized string retains `username`, while passwords are removed.
  The preflight then executes the generated schema against the accepted
  release URL, so this is not only a naming check; it authorizes writes.
  Existing tests cover equal URLs and different database names, but not
  different users targeting the same database.
- **Recommended fix:** Compare physical target identity using host, effective
  port, database name, and schema/search path while ignoring credentials.
  Prefer connecting to both targets and comparing `current_database()` plus
  server identity where aliases or connection parameters can obscure the
  endpoint. Add a regression case with different usernames and passwords for
  the same physical database.

### Finding F-004 — Google release tests can provision fixtures before schema preflight

- **File and line:** `tests/release/google-clerk-auth.spec.ts:191-209`,
  `tests/release/google-clerk-auth.spec.ts:117-145,251-253`
- **Category:** Error handling
- **Severity:** High
- **Risk:** The Google-backed tests are directly discovered by
  `playwright.release.config.ts` and therefore run as part of the managed
  release command. After connecting to the selected database, they do not call
  `assertReleaseSchema`. They can run stale-user cleanup, create a Clerk user,
  and insert a local fixture before a missing role/identity column or legacy
  tester object is detected elsewhere. A schema mismatch then produces a late
  failure and can leave a provider user or partial local fixture behind,
  defeating the contract’s “preflight before fixture provisioning” guarantee.
- **Evidence:** `managed-clerk-auth.spec.ts:265-271` calls
  `assertReleaseSchema(database)` before stale cleanup and fixture creation.
  The Google test connects at `google-clerk-auth.spec.ts:204-209` and proceeds
  to `removeStaleSmokeUsers` and `createDisposableAccount` without the same
  preflight. The release list probe confirmed that both Google tests are in the
  managed release project.
- **Recommended fix:** Call `assertReleaseSchema(database)` immediately after
  connecting in each Google release test, before stale cleanup, Clerk user
  creation, or local inserts. Preserve the isolated-database assertion for
  internal candidates and add a negative test proving schema failure prevents
  provider fixture creation.

## Tooling signals

- **Typecheck:** Pass — `npm run typecheck` completed in the standard tier.
- **Storage lint:** Pass — strict storage-key lint reported no unregistered
  literals.
- **Unit tests:** Pass — the standard unit-test step completed successfully.
- **Managed Clerk contract:** Pass — 41 JavaScript contract tests and 9
  TypeScript contract tests passed.
- **Vite HMR tests:** Pass — 3 tests passed.
- **Validation manifest parity:** Pass.
- **Required validation command:** `npm run test-standard` passed.
- **Harness note:** The serial-lock wrapper reclaimed a dead prior holder before
  running the tier. No validation step failed, and this was not classified as a
  suite regression.
- **Dependency audit:** Not run separately because the task’s validation
  ceiling is the registered `test-standard` tier.

## Deferred observations

These were inspected but are not reported as verified findings:

- The permission preflight creates a testing token and discards it
  (`tests/support/clerk-test-permissions.ts:78-82`). The provider’s token
  lifetime/revocation behavior was not available without contacting Clerk, so
  token residue is a follow-up question rather than a confirmed defect.
- The workflow checks that Clerk credentials are present and the two
  publishable keys select the same tenant, but the smoke does not independently
  prove that the secret-key tenant is the tenant serving the published app.
  Establishing that provider-side identity requires live Clerk metadata and
  was not attempted.
- No confirmed leak was found in the reviewed diagnostic redaction and
  bounded-tail paths. The build script redacts before tail selection, and the
  published runner propagates the child exit status.

## Handoff

This was a report-only audit. No release scripts, fixtures, credentials,
authentication configuration, or test code were changed. The four findings
remain deferred for separate fixes, in severity order.