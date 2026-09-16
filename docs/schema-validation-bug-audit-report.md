# Schema Validation Tool Bug Audit Report

**Scope:** `scripts/validate-schema.mjs`, the Drizzle schema and migration
inputs, release-schema preflight and disposable release-database setup, the
heavy validation manifest, and the focused migration/preflight contract tests.
  
**Mode:** Report-only  
**Audit date:** 2026-09-16  
**Validation ceiling:** `test-heavy`  
**Schema, migration, database, validation, and release code changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 4 |
| Medium | 1 |
| Low | 0 |

| ID | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Validation false-success / data integrity | `scripts/validate-schema.mjs:20-42` | The checker accepts a non-schema source file and arbitrary non-empty text as a valid schema and migration set |
| F-002 | High | Destructive-change detection | `scripts/validate-schema.mjs:25-39`, `migrations/0007_add_foreign_keys_indexes.sql:3-50`, `migrations/0023_remove_tester_auth_add_account_roles.sql:7-14`, `migrations/0025_reconcile_legacy_tester_accounts.sql:27-73` | Destructive migration statements are not classified, reviewed, or executed by the check |
| F-003 | High | Release-database drift / environment isolation | `scripts/release-schema-preflight.mjs:117-196`, `scripts/prepare-release-test-database.mjs:24-84`, `scripts/build-and-verify-release.sh:114-120` | Release validation bootstraps an isolated database from the current TypeScript schema and does not establish that the publishing database has the migration state required by the release |
| F-004 | High | Migration contract coverage | `docs/validation/manifest.json:44-62`, `package.json:27`, `scripts/__tests__/release-schema-preflight.test.mjs:1-6` | The heavy tier does not run the focused release-schema preflight and migration contract tests |
| F-005 | Medium | Migration ordering / version drift | `scripts/validate-schema.mjs:25-39`, `migrations/0001_add_custom_vendor_codes.sql`, `migrations/0001_past_marvel_boy.sql`, `migrations/0007_add_foreign_keys_indexes.sql`, `migrations/0007_add_session_deleted_at.sql`, `migrations/0023_photo_quality_default_95.sql`, `migrations/0023_remove_tester_auth_add_account_roles.sql` | Duplicate numeric migration prefixes are accepted and reported as ordered without checking the actual migration identity or journal |

The findings are ordered by severity and then by the point at which they can
allow an invalid release to proceed. No finding was fixed during this audit.

## Validation and evidence

The required command was run exactly with the task plan:

```text
TASK_PLAN_FILE=.local/tasks/task-716.md npm run test-heavy
```

The working tree was clean before the report was written. The checker itself
passed:

```text
[schema-check] PASS: exported schema and 30 ordered SQL migrations verified.
```

The heavy tier also passed the startup, dependency audit, workspace-skill,
typecheck, storage lint, unit, Vite HMR, serial-lock, port-authority,
manifest-parity, and collision-smoke steps before browser validation. The
browser step initialized a disposable database through
`prepare-release-test-database.mjs` and invoked the release-schema preflight
against the schema exported from `shared/schema.ts`; the full
`test-heavy` tier completed with exit code 0.

### Deterministic checker probes

Two disposable directory fixtures were used without modifying the repository:

1. A `shared/schema.ts` containing only a comment with the word `export` and a
   migration containing `this is not SQL` returned exit code 0 and printed the
   normal PASS message.
2. A valid-looking exported schema with three migrations, including two files
   with the same numeric prefix, returned exit code 0 and printed the normal
   PASS message.

These probes verify that the findings are not inferred only from source
inspection. The current repository also contains duplicate numeric prefixes
(`0001`, `0007`, and `0023`), so the duplicate-version path is live rather than
hypothetical.

## Phase 1 — Bug Audit category passes

1. **Null / undefined safety:** No null dereference was found in the
   filesystem reads. Missing paths fail explicitly, but invalid file contents
   can still pass (F-001).
2. **Async and timing:** The checker is synchronous and has no race-sensitive
   database operation. Release setup is sequential, but its isolated bootstrap
   does not validate publication state (F-003).
3. **Error handling:** Missing directories, empty migrations, and malformed
   filenames fail. SQL parse, migration-application, and schema-import errors
   are not observed because they are never attempted (F-001, F-002).
4. **Type safety:** The checker is plain JavaScript and passed the registered
   validation run. No type-only finding was verified.
5. **State and data integrity:** Destructive statements and schema drift are
   outside the checker’s assertions (F-002, F-003).
6. **Security and environment isolation:** The release smoke target is checked
   for isolation before writes, but that protects the disposable target; it
   does not prove that the publishing target is migrated (F-003).
7. **Performance:** The filesystem scan is bounded by the checked-in migration
   set. No performance defect was verified.
8. **Concurrency and shared state:** The checker itself has no shared mutable
   state. Migration identity and release-target state can nevertheless drift
   between the checked source and the database being published (F-003, F-005).
9. **Dead or unreachable code:** The monotonic-order failure branch is
   effectively unreachable for ordinary numeric filenames because the list is
   sorted by that same numeric ordering before the loop. This contributes to
   the false sense of ordering coverage reported in F-005.
10. **Dependency hygiene:** The high-severity dependency audit passed. No
    dependency finding is reported.

## Findings

### Finding F-001 — Invalid schema and migration contents can pass

- **Severity:** High
- **Category:** Validation false-success / data integrity
- **Location:** `scripts/validate-schema.mjs:20-42`
- **Failure scenario:** A broken merge leaves `shared/schema.ts` unparsable,
  exports no Drizzle table, or replaces a migration with malformed SQL. The
  checker only searches for the substring `export`, checks that the migration
  directory contains at least one `.sql` file, validates a filename pattern,
  and checks that the file is non-empty. It then prints PASS without importing
  the schema or parsing/executing SQL.
- **Evidence:** A disposable fixture with only
  `// export is only a comment; no Drizzle table exists` and a migration
  containing `this is not SQL` exited 0 and printed:
  `[schema-check] PASS: exported schema and 1 ordered SQL migrations verified.`
- **Impact:** Heavy validation can report a healthy schema boundary while the
  release schema cannot be loaded or a migration cannot be applied. The failure
  is deferred to a later release or database operation.
- **Recommended fix:** Load the configured Drizzle schema through the same
  toolchain used for schema generation and validate migration SQL against a
  disposable PostgreSQL target. If execution is intentionally separated, add
  an explicit SQL parser/fixture step and make the checker’s output state
  exactly what it verified.

### Finding F-002 — Destructive migrations are invisible to the schema check

- **Severity:** High
- **Category:** Destructive-change detection
- **Location:** `scripts/validate-schema.mjs:25-39`;
  `migrations/0007_add_foreign_keys_indexes.sql:3-50`;
  `migrations/0023_remove_tester_auth_add_account_roles.sql:7-14`;
  `migrations/0025_reconcile_legacy_tester_accounts.sql:27-73`
- **Failure scenario:** A new migration, or an edit to an existing migration,
  adds `DELETE`, `DROP`, data-nullifying `UPDATE`, or another destructive
  operation. As long as the file is non-empty and its name matches the prefix
  pattern, the checker passes. The current migration set already contains
  broad orphan cleanup and account/session data deletion, demonstrating that
  destructive SQL is part of this boundary.
- **Evidence:** The checker has no SQL-token, diff, approval, fixture, or
  execution branch beyond the non-empty test at lines 36-38. The heavy
  manifest invokes this checker directly at
  `docs/validation/manifest.json:52`; it does not add a destructive-change
  review step.
- **Impact:** A destructive migration can reach release validation without a
  warning or proof that its guard conditions preserve required data. On a
  real database, the migration may permanently remove inventory, accounts, or
  related records before a later statement fails.
- **Recommended fix:** Require a reviewed migration contract for destructive
  statements, including explicit data-loss classification and fixture
  assertions. For release-critical migrations, apply the complete migration
  history to a disposable database and verify row-count and invariant
  expectations before allowing the heavy tier to pass.

### Finding F-003 — Isolated release bootstrap does not detect publishing-database drift

- **Severity:** High
- **Category:** Release-database drift / environment isolation
- **Location:** `scripts/release-schema-preflight.mjs:117-196`;
  `scripts/prepare-release-test-database.mjs:24-84`;
  `scripts/build-and-verify-release.sh:114-120`
- **Failure scenario:** The publishing `DATABASE_URL` is missing a non-auth
  table, column, constraint, enum, or migration-side data transformation.
  Release setup exports the current `shared/schema.ts` into the dedicated
  `RELEASE_SMOKE_DATABASE_URL` target and checks only the selected auth
  columns, `account_role` values, and legacy tester objects. The candidate
  then runs against that newly bootstrapped target, so the smoke can pass
  while the database that will serve the published application remains stale.
- **Evidence:** `prepare-release-test-database.mjs:24-36` invokes
  `drizzle-kit export` from `./shared/schema.ts`, not the tracked SQL history.
  `assertReleaseSchema` returns only the auth/legacy checks at lines 155-196.
  The release build starts the candidate against the isolated target at
  `build-and-verify-release.sh:118-120`. The project’s own
  `docs/release-database-migration.md:9-22` explicitly states that this smoke
  does not prove the publishing database is current.
- **Impact:** A green release-oriented validation result can be followed by
  runtime failures when the published app queries a table or column absent
  from the publication database. Migration ordering and data backfill
  failures are not exercised against the actual target.
- **Recommended fix:** Add a read-only publication-target schema-state check
  that compares the expected reviewed migration/schema identity and required
  structural invariants without writing to that target. Keep the disposable
  bootstrap for application smoke, but do not treat it as evidence that the
  publication database is migrated.

### Finding F-004 — Heavy validation omits the focused migration/preflight contracts

- **Severity:** High
- **Category:** Migration contract coverage
- **Location:** `docs/validation/manifest.json:44-62`;
  `package.json:27`; `scripts/__tests__/release-schema-preflight.test.mjs:1-6`
- **Failure scenario:** A change breaks `assertIsolatedReleaseDatabase`,
  `verifyReviewedMigrations`, `readReleaseSchema`, or one of the negative
  preflight paths. The focused tests are registered in
  `test:managed-clerk-release-contract`, which is a `test-standard` step
  (`docs/validation/manifest.json:15-27`), but the heavy tier has no
  `clerk-release-contract` step. Its `unit-tests` command is the narrower
  `test:unit` script and does not include `release-schema-preflight.test.mjs`.
- **Evidence:** The heavy step list contains startup, audit, schema-check,
  workspace, typecheck, storage, unit, HMR, lock, port, manifest, collision,
  and browser steps at lines 49-62, but no focused release-schema contract
  command. The browser path exercises the happy preflight during disposable
  setup, not the full mocked negative contract suite.
- **Impact:** The required heavy boundary can pass while migration/release
  preflight regressions remain undetected. Browser setup may also stop before
  product tests for unrelated Clerk or provider reasons, leaving no reliable
  negative coverage for the preflight.
- **Recommended fix:** Include the focused release-schema and migration
  contract tests in the heavy tier, or add a dedicated schema-contract step
  that runs before browser validation and asserts both success and fail-closed
  cases.

### Finding F-005 — Duplicate migration prefixes pass as “ordered”

- **Severity:** Medium
- **Category:** Migration ordering / version drift
- **Location:** `scripts/validate-schema.mjs:25-39`;
  the duplicate-prefix migration files listed in the summary
- **Failure scenario:** Two contributors assign the same numeric migration
  prefix. The checker sorts the files by that prefix and only rejects a number
  lower than the previous number; equality is accepted. A migration consumer
  that uses numeric version identity, a journal, or a different ordering
  policy can skip, overwrite, or apply one of the files unexpectedly.
- **Evidence:** A disposable fixture containing `0001`, `0002`, and two
  `0002` files exited 0. The repository currently has duplicate prefixes
  `0001`, `0007`, and `0023`. The migration journal also records only a
  partial historical sequence (`migrations/meta/_journal.json:5-80`), so the
  checker does not establish parity with that identity source.
- **Impact:** The PASS message overstates ordering safety and allows version
  drift to accumulate. A later migration or release tool may observe a
  different sequence from the checker.
- **Recommended fix:** Define one canonical migration identity source and
  validate exact uniqueness and parity against it. If same-prefix files are
  intentionally supported, validate their explicit dependency order and make
  the consuming applicator use the same stable identity and ordering.

## Report-only stop

This audit stops at the requested report-only boundary. The findings are
recommendations for separate remediation and regression-test work. No schema,
migration, database, validation-tier, release, or application behavior was
changed.