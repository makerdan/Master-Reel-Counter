# Storage-Key Lint Bug Remediation Report

**Scope:** `scripts/lint-storage.mjs`, its strict npm command, the browser
storage-key registry and lifecycle annotations, and validation-tier integration.
**Mode:** Remediated
**Date:** 2026-09-17
**Stack:** Node.js ESM validation script; TypeScript/TSX React client; Vite;
JSON-backed validation tiers. TypeScript and client-specific checks applied.
Backend, React lifecycle, authentication, database, payment, and browser-UI
categories were not relevant to the static scanner itself.
**Validation ceiling:** `test-standard`
**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

## Remediation

The scanner now parses TypeScript/TSX ASTs and analyzes complete storage call
expressions. It follows same-file storage-object aliases and registry constant
or factory aliases, rejects unresolved key expressions, removes the broad
`dash:` exemption, and ignores comments and string contents safely. Focused
contract tests cover accepted and rejected syntax plus report-only and strict
CLI exit behavior.

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | Medium | State & data integrity | `scripts/lint-storage.mjs:38-39,86-90` | Line-based scanning misses valid multiline storage calls |
| F-002 | Medium | State & data integrity | `scripts/lint-storage.mjs:51` | Indirect raw keys can bypass both scanner passes |
| F-003 | Medium | State & data integrity | `scripts/lint-storage.mjs:62-64` | The `dash:` exemption permits arbitrary unregistered keys |
| F-004 | Low | Error handling | `scripts/lint-storage.mjs:38-39,86-90` | Comments containing example calls fail strict validation |

## Inventory and contract tracing

### Registry and lifecycle

`client/src/lib/storageKeys.ts` documents the rule that every
`localStorage`/`sessionStorage` key is registered and associates keys with
global, user, session, or photo scope and cleanup behavior. It contains the
typed constants and factories plus `clearIdentityScopedBrowserState`,
`clearSessionKeys`, and `clearSessionResetKeys`. The current client call sites
use those constants/factories or pass dynamic keys through the registry's
helpers. A complete scan of the current `client/src` call sites found no
current raw-key violation.

### Scanner

The linter recursively scans only `.ts` and `.tsx` files below `client/src`.
It excludes only `client/src/lib/storageKeys.ts`. TypeScript AST traversal
identifies complete storage call expressions, follows supported same-file
storage and registry aliases, and reports the call's starting line.

### Command and tier wiring

- `package.json:15` defines `lint:storage` as
  `node scripts/lint-storage.mjs --strict`, so violations produce exit code 1.
- `docs/validation/manifest.json` includes the strict command in
  `test-fast`, `test-standard`, `test-standard-plus`, and `test-heavy`.
- `scripts/run-tier.mjs:26-38` prefers the manifest entry and
  `scripts/run-tier.mjs:107-121` stops the tier when a step exits nonzero.
- The declarative tier registry also includes the storage lint step in its
  light, standard, and heavy definitions.

## Tooling signals

The remediation validation commands were run with the assigned plan:

```text
TASK_PLAN_FILE=.local/tasks/task-771.md npm run test-standard
```

It passed all registered steps:

- Typecheck: passed.
- Strict storage lint: passed with
  `No unregistered storage key literals found.`
- Unit tests: passed.
- Managed Clerk release contract: passed.
- Vite HMR tests: passed.
- Validation-manifest parity: passed.

The serial-lock harness reclaimed a dead stale holder before executing the
standard tier. It did not prevent that tier from running, and no test failure
occurred there.

## Verification probes

The findings were reproduced with temporary fixture files outside the
repository; no fixture was added to `client/src`. The direct one-line control
case was rejected with strict exit code 1. The following realistic TypeScript
forms incorrectly exited 0:

| Probe | Result |
|---|---|
| `localStorage.setItem(` followed by the raw key on the next line | Missed |
| `const browserKey = "unsafe-const"; localStorage.setItem(browserKey, ...)` | Missed |
| `const browserStorage = localStorage; browserStorage.setItem("unsafe-alias", ...)` | Missed |
| `const storageKey = \`unsafe-${id}\`; localStorage.setItem(storageKey, ...)` | Missed |
| `const storageKey = "unsafe-" + id; localStorage.setItem(storageKey, ...)` | Missed |
| `sessionStorage.setItem("dash:unregistered", ...)` | Exempted |
| `// localStorage.setItem("not-a-runtime-call", ...)` | Incorrectly reported |

The existing `client/src` code was traced after each candidate search. No
current production call uses these bypass forms, and the dashboard's current
state calls use the registered `dashboardStateKey` factory rather than relying
on the broad exemption.

## Findings

### Finding F-001 — Multiline storage calls pass the strict guard

- **File and line:** `scripts/lint-storage.mjs:38-39,86-90`
- **Category:** State & data integrity
- **Severity:** Medium
- **Risk:** The primary regex is applied independently to each physical line.
  A valid call such as
  `localStorage.setItem(\n  "session-specific-unregistered-key",\n  value\n)`
  contains neither the method and opening quote nor the first argument on one
  line, so the linter reports no violation and exits 0 in strict mode. If a
  developer formats a new session-scoped key this way, it can remain absent
  from the registry and from `clearSessionKeys`; deleting or restoring a
  session can then leave stale browser state behind.
- **Evidence:** The temporary multiline fixture passed with exit code 0,
  while the otherwise identical one-line direct call exited 1. The scanner
  splits the file at line 86 and tests only `line` at lines 89-90.
- **Recommended fix:** Scan a tokenized or parsed source representation rather
  than individual lines. At minimum, support whitespace/comments across the
  complete call span and report the call's starting line. Add a regression
  fixture for multiline `getItem`, `setItem`, and `removeItem` calls.

### Finding F-002 — Indirect raw keys bypass the scanner

- **File and line:** `scripts/lint-storage.mjs:42-52`
- **Category:** State & data integrity
- **Severity:** Medium
- **Risk:** The primary pass only checks a literal immediately after the
  storage method, while the secondary pass only recognizes a key-named
  variable assigned a multi-segment hyphenated template literal. A raw
  constant, one-segment template, concatenation, or storage-object alias can
  therefore reach a storage method without being checked. For example,
  `const browserKey = "unsafe-const"; localStorage.setItem(browserKey, value)`
  passes strict validation. The unregistered key can miss the registry's
  scope and lifecycle cleanup rules, and the validation tier gives a false
  pass.
- **Evidence:** Temporary fixtures for a raw constant, `unsafe-${id}`, string
  concatenation, and `const browserStorage = localStorage` all exited 0.
  Current application call sites were inspected and use registry exports or
  dynamic non-storage keys; no current production bypass was reported.
- **Recommended fix:** Replace the heuristic secondary pass with AST-based
  call analysis that resolves local constant/factory declarations and storage
  aliases, or enforce a narrower, explicit storage-helper API and test every
  allowed form. Do not claim complete registry enforcement while only
  matching a particular variable name and template shape.

### Finding F-003 — Broad `dash:` exemption accepts unregistered keys

- **File and line:** `scripts/lint-storage.mjs:55-64`
- **Category:** State & data integrity
- **Severity:** Medium
- **Risk:** Any literal beginning with `dash:` is exempted, regardless of
  whether it is a registered dashboard field, has the required user suffix,
  or has a documented lifecycle. A future call such as
  `sessionStorage.setItem("dash:debugPanel", value)` or an unscoped
  `dash:searchQuery` can pass strict validation without a registry entry.
  The registry describes dashboard keys as identity-scoped
  `dash:{field}:{uid}` values and clears the `dash:` namespace on identity
  transitions; a malformed or session-specific key can consequently evade
  the intended convention and retain or show the wrong user's UI state.
- **Evidence:** The temporary `dash:unregistered` fixture exited 0. The
  current dashboard code uses `dashboardStateKey` and the lifecycle helper
  intentionally clears the `dash:` prefix, so this is a guard weakness rather
  than a confirmed current application leak.
- **Recommended fix:** Remove the pattern-wide exemption and migrate any
  remaining legitimate dashboard call sites to `dashboardStateKey`. If a
  legacy compatibility case must remain, allow only an exact, documented
  shape and test its identity suffix and cleanup behavior.

### Finding F-004 — Comments are treated as executable storage calls

- **File and line:** `scripts/lint-storage.mjs:38-39,86-90`
- **Category:** Error handling
- **Severity:** Low
- **Risk:** The regex does not distinguish code from comments or string
  contents. A documentation example or explanatory comment containing
  `localStorage.setItem("example-key", value)` causes strict validation to
  exit 1 even though no browser storage operation exists. This can block an
  otherwise valid validation tier when a client file documents the forbidden
  pattern, encouraging removal of useful guidance or an unjustified
  exemption.
- **Evidence:** A temporary fixture containing only
  `// localStorage.setItem("not-a-runtime-call", "1");` was reported as one
  violation and exited 1. The current client source has no matching comment,
  so no current false-positive failure is counted against the application.
- **Recommended fix:** Use a TypeScript parser/tokenizer and inspect only
  executable call expressions. Add comment, block-comment, string-content,
  and template-content fixtures to the scanner contract tests.

## Confirmed passes and deferred candidates

- The strict command fails on a direct one-line raw literal, and the
  non-strict script reports rather than failing the process as documented.
- The current `client/src` production call sites use registry constants,
  factories, or dynamic keys supplied by registry-managed hooks. No current
  unsafe application storage use was verified.
- The scanner's `.ts`/`.tsx` scope covers all current client source files;
  no `.js` or `.jsx` client source exists today.
- `window.localStorage` is still caught because the regex matches the
  `localStorage.method` suffix; it is not a missed path in the current
  implementation.
- No malformed-source crash was reproduced. The scanner is text-based and
  does not validate TypeScript syntax; malformed or incomplete source can
  still produce false negatives covered by F-001/F-002.
- React hook, backend, database, dependency, and browser categories were
  outside the linter's implementation scope. The standard tier's typecheck,
  unit, contract, Vite, and manifest checks were used as surrounding
  confidence only.

## Remediation checklist

1. AST-based call analysis: complete.
2. Narrowed registry boundary: complete; arbitrary `dash:` literals are no
   longer exempt.
3. Focused contract coverage: complete for strict exit status, multiline
   calls, aliases/indirection, comments, and registry acceptance.

## Completion

All four findings are remediated within the assigned scope. The typed storage
key registry remains the source of truth; no broad client storage migration was
performed.