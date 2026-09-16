# TypeScript Typecheck Bug Audit Report

**Scope:** The `npm run typecheck` command, its application and Playwright
compiler projects, and direct integration into the canonical validation tiers.
The audit does not assess application behavior except where an uncovered
TypeScript source file demonstrates a validation false negative.

**Mode:** Report-only

**Audit date:** 2026-09-16

**Validation ceiling:** `test-standard`

**Product or validation code changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Type safety | `tsconfig.playwright.json:3` | Executed default and preview Playwright configurations are outside the Playwright compiler project |
| F-002 | Medium | Type safety | `tsconfig.json:2-3` | TypeScript unit tests run in standard validation but are explicitly excluded from every typecheck invocation |

## Phase 0 — Inventory and validation evidence

### Typecheck path

- `package.json:13` defines `typecheck` as
  `tsc --noEmit && tsc --project tsconfig.playwright.json --noEmit`.
  The first compiler invocation resolves `tsconfig.json`.
- `tsconfig.json:2-3` includes `client/src/**/*`, `shared/**/*`, and
  `server/**/*`, while excluding `node_modules`, build output, and every
  `**/*.test.ts` file.
- `tsconfig.playwright.json:2-8` extends the base project but replaces its
  include set with `tests/**/*` and `playwright.release.config.ts`. It keeps
  strict checking, disables incremental state, and relaxes unused-symbol
  diagnostics for browser test code.
- `docs/validation/manifest.json:11`, `:21`, `:35`, and `:54` invoke
  `npm run typecheck` in every advertised validation tier.
- `scripts/run-tier.mjs:107-121` executes the manifest step and propagates a
  non-zero child status, so a failure from either `tsc` process is surfaced.
  The runner does not alter the compiler's file set.

### Resolved source sets

Read-only `tsc --listFilesOnly` inspection showed:

- The base project contains application source under `client`, `shared`, and
  `server`, but no repository `*.test.ts` files.
- The Playwright project contains the `tests` tree and
  `playwright.release.config.ts`.
- `playwright.config.ts` and `playwright.clerk-preview.config.ts` are not in
  the Playwright project.
- `playwright.config.ts` is the default configuration used by
  `npm run test:e2e` and by the heavy-tier browser runner. The preview script
  explicitly invokes `playwright.clerk-preview.config.ts` at
  `package.json:28`.

### Required validation result

The mandated command was run exactly as a task-locked standard tier:

```text
TASK_PLAN_FILE=.local/tasks/task-706.md npm run test-standard
```

All six registered standard steps passed:

- application and Playwright typecheck;
- storage-key lint;
- unit tests;
- managed Clerk release contract;
- Vite HMR tests; and
- validation-manifest parity.

Before the tier started, the serial lock reclaimed a dead holder for the
`validation` resource. This was harness cleanup evidence, not a typecheck
failure, and no validation step was skipped.

The failure-baseline catalog contained no active records. No application,
test, compiler, tier, or dependency file was changed while gathering
evidence.

## Phase 1 — Bug Audit category passes

1. **Null / undefined safety:** Applicable to the TypeScript compiler
   boundary. No compiler configuration or typecheck harness defect in this
   category was verified.
2. **Async & timing:** The typecheck script chains the two compiler processes
   with `&&`; a failed first compiler prevents the second from being reported
   as a pass. No unhandled typecheck promise or timing defect was found.
3. **Error handling:** `run-tier.mjs` checks each child status and exits
   non-zero on failure. No failure-reporting defect was verified.
4. **Type safety:** Two false-negative source-set gaps were verified and are
   reported as F-001 and F-002. `strict` remains enabled for both included
   projects. `skipLibCheck` was not reported because it affects dependency
   declarations rather than the repository source set under audit.
5. **State & data integrity:** Not applicable to the static compiler
   harness; no state mutation is performed by the typecheck command.
6. **Security:** No secret, command-injection, or user-data handling defect
   was found in the typecheck command or its tier invocation.
7. **Performance:** The base project uses incremental compiler state and the
   Playwright project deliberately disables incremental state. No
   typecheck-specific performance failure was verified.
8. **Concurrency & shared state:** The tier runner serializes the standard
   validation resource and strips lock-holder variables before steps run. The
   stale-lock recovery observed during validation is covered by the serial
   lock boundary, not a typecheck defect.
9. **Dead / unreachable code:** The compiler passes and the source-set
   omissions are covered under type safety. No additional dead-code defect
   was verified.
10. **Dependency hygiene:** The standard tier completed its dependency-backed
    checks without a typecheck-specific version or declaration mismatch.
    Dependency auditing was outside this task's validation ceiling.

## Findings

### Finding F-001 — Default and preview Playwright configurations are not typechecked

- **Severity:** High
- **Category:** Type safety
- **File and line:** `tsconfig.playwright.json:3`;
  `playwright.config.ts:1-77`; `playwright.clerk-preview.config.ts:1-32`
- **Risk:** The Playwright compiler project includes only `tests/**/*` and
  `playwright.release.config.ts`. A TypeScript error introduced into the
  default browser configuration or the Clerk preview configuration will still
  make the typecheck step pass. The failure is deferred until Playwright
  loads the configuration, where it can stop browser validation before any
  test runs. This is a realistic gap because the default config is used by
  `npm run test:e2e` and the heavy browser runner, while the preview config is
  an independently executable package script.
- **Evidence:** `npx tsc --project tsconfig.playwright.json --listFilesOnly`
  lists `playwright.release.config.ts` but not the other two executable
  TypeScript configs. `package.json:25` invokes Playwright without an explicit
  config, selecting `playwright.config.ts`; `package.json:28` explicitly
  selects `playwright.clerk-preview.config.ts`; and
  `scripts/run-browser-tests.mjs:95-103` forwards the heavy-tier browser
  invocation without selecting a different config. The current configs
  themselves compile when loaded, so this finding is about the confirmed
  coverage gap, not a claim that either file currently has a compiler error.
- **Recommended fix:** Make the Playwright compiler project include every
  TypeScript Playwright configuration that is executable in this repository,
  or create a dedicated compiler project for those configs. Add a contract
  check that enumerates all package-script and tier-invoked TypeScript
  Playwright configs so a new config cannot silently fall outside typecheck.
  Keep the release config included and preserve its production-target
  validation behavior.
- **Deferred action:** Do not change the compiler include list or validation
  scripts in this report-only task. Fix the coverage gap in a separately
  approved validation-tooling task, then run the same standard tier.

### Finding F-002 — Executed TypeScript unit tests are excluded from typecheck

- **Severity:** Medium
- **Category:** Type safety
- **File and line:** `tsconfig.json:2-3`;
  `package.json:16-17,27`;
  `docs/validation/manifest.json:23-25`
- **Risk:** The application compiler includes `server/**/*` and
  `scripts/**/*` only through the base include set, but its
  `**/*.test.ts` exclusion removes all repository TypeScript unit tests.
  The Playwright project does not restore them because its include set is
  limited to `tests/**/*` and the release config. Standard validation then
  runs those files through `tsx`/Node without a compiler gate. Test code can
  carry invalid mocks, callback signatures, or request assumptions while the
  typecheck step remains green; the resulting test failure may be delayed
  until a particular branch executes or may make the test give misleading
  evidence.
- **Evidence:** A temporary, deleted compiler project with the repository
  compiler options and an include set for `server/__tests__/**/*.test.ts`
  and `scripts/__tests__/**/*.test.ts` produced real errors in currently
  executed test sources, including:
  `server/__tests__/routes.test.ts:269` (an invalid
  `PromiseFulfilledResult<unknown>` predicate),
  `:527` (a mocked `getUser` return incompatible with the storage return
  type), `:756` (a constructor limit literal outside the declared type),
  `:782`, `:797`, and `:816` (callbacks returning `number` where `void` is
  required), and `:1691` and `:1733` (assignments to an undeclared
  `Request.user`). `server/__tests__/support-ops.test.ts:5` also imports an
  `.mjs` helper without a declaration, and its article callback is inferred
  unsafely at `:11`. The normal `npm run test-standard` run passed because
  these files are not in either compiler project; its `unit-tests` step
  executes only after the typecheck step and uses runtime transpilation.
- **Recommended fix:** Decide and document whether standard-tier TypeScript
  unit tests are part of the typecheck contract. If they are, add a
  Node-oriented unit-test compiler project (with the appropriate module and
  top-level-await target) to `npm run typecheck` or to the standard tier,
  remove the broad exclusion from that project, and repair the errors it
  exposes. If they are intentionally excluded, split the test-only compiler
  boundary explicitly and add a separate strict typecheck step rather than
  implying that all repository TypeScript is covered.
- **Deferred action:** The discovered test errors and any compiler-project
  design change remain deferred. No test, application, or compiler setting
  was modified by this audit.

## Validation integration observations

The tracked validation surfaces are not fully identical: the manifest uses
`test-fast` and `test-standard-plus`, while
`.agents/skills/validation-tiers/tiers.json` describes `test-light` and has
different standard-step detail. `scripts/run-tier.mjs` prefers the manifest
when a manifest entry exists, and `scripts/lib/tier-lock-check.mjs` accepts
either source. This is configuration drift worth a separate validation-tier
audit, but it is not counted as an additional typecheck finding here:
`test-standard` invokes `npm run typecheck` in both sources, and the required
standard run executed the manifest's typecheck step successfully.

## Deferred / not findings

- The current application project passed with `strict: true`; no application
  type error was observed.
- The current Playwright test files and release configuration passed the
  active compiler project. Missing default and preview config coverage is
  reported as F-001; no current compiler error is asserted for those files.
- `noUnusedLocals` and `noUnusedParameters` are disabled in the Playwright
  project by design for test fixtures. This can reduce hygiene diagnostics,
  but no concrete unsafe behavior was verified from that setting alone.
- `skipLibCheck` is inherited by both projects. No broken dependency
  declaration affecting this repository was demonstrated, so it is not
  reported as a bug.
- The inherited `**/*.test.ts` pattern would also exclude a future
  Playwright file named with that suffix, but no current Playwright file uses
  that naming pattern; it is covered by the broader F-002 design gap only if
  such files are intended to be typechecked.

## Recommended remediation order

1. Close F-001 so every executable Playwright TypeScript configuration fails
   before browser validation when its types drift.
2. Decide the contract for unit-test typechecking and address F-002, beginning
   with the currently reproduced errors in `routes.test.ts` and
   `support-ops.test.ts`.
3. Reconcile the manifest and tier-registry source as a separate validation
   tooling change, preserving the direct `npm run typecheck` step in every
   canonical tier.

## Report-only stop

This audit stops at the report phase. No production code, tests, compiler
configuration, package script, validation manifest, tier registry, dependency,
secret, account data, or external service data was changed. The two findings
are verified and ready for separately approved remediation.