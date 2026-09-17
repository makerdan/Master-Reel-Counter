# Dependency Security-Audit Bug Audit Report

**Scope:** The dependency security-audit validation tool only: the npm audit
command and threshold, package metadata and lockfile contract, package
overrides, the registered heavy tier, canonical GitHub Actions routing, and
audit-result visibility.
**Mode:** Report-only
**Audit date:** 2026-09-16
**Validation ceiling:** `test-heavy`
**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | Medium | Dependency hygiene | `scripts/validate-validation-manifest.mjs:25-39`, `docs/validation/manifest.json:51` | Manifest parity does not protect the security-audit command or severity threshold from removal or weakening |

The current configured audit is not bypassing known material dependency risk:
the live audit returned zero vulnerabilities, and an isolated known-vulnerable
fixture failed at the configured `high` threshold. F-001 is a regression
protection gap, not evidence of a currently misclassified advisory.

## Findings

### F-001 — Manifest parity does not guard the security-audit contract

- **File and line:** `scripts/validate-validation-manifest.mjs:25-39`,
  `docs/validation/manifest.json:51`
- **Category:** Dependency hygiene
- **Severity:** Medium
- **Risk:** The manifest-parity validator checks that every tier has at least
  one well-shaped step, but it does not assert that `test-heavy` contains a
  `security-audit` step or that its command remains exactly
  `npm audit --audit-level=high`. A future edit could remove the step or
  change the threshold to `critical` (or another weaker command), while
  `node scripts/validate-validation-manifest.mjs` and the other structural
  checks still pass. If the remaining heavy steps pass, the canonical
  `npm run ci` check could then report success without rejecting high-severity
  dependency vulnerabilities.
- **Evidence:** The current manifest contains the intended command at
  `docs/validation/manifest.json:51`. The validator only checks tier
  existence, package-script routing, timing/priority fields, and generic
  non-empty step shapes at `scripts/validate-validation-manifest.mjs:25-39`;
  it has no security-audit command or threshold assertion. The configured
  command itself was independently exercised: the repository audit returned
  `found 0 vulnerabilities`, while an isolated lockfile fixture containing
  `lodash@4.17.20` exited `1` with `--audit-level=high` and exited `0` with
  `--audit-level=critical`, confirming npm's threshold behavior. This finding
  is therefore about the missing durable guard, not about npm misreporting the
  current dependency tree.
- **Recommended fix:** Add a manifest contract assertion (and a focused test)
  requiring the `test-heavy` step named `security-audit` to use the exact
  command `["npm", "audit", "--audit-level=high"]`. Fail closed if the step is
  missing, duplicated, reordered before install assumptions, or weakened.
  Keep the assertion alongside the manifest-parity contract so changes to the
  threshold receive an explicit review failure.

## Verified controls and audit evidence

### Command and threshold

- `docs/validation/manifest.json:51` registers the exact command
  `npm audit --audit-level=high`.
- `package.json:32-33` routes `npm run test-heavy` through the canonical tier
  runner and routes `npm run ci` to that same heavy tier.
- A live repository run on 2026-09-16 returned `found 0 vulnerabilities`.
  The JSON report contained zero info, low, moderate, high, and critical
  vulnerabilities across 923 dependency records.
- The isolated threshold probe demonstrated fail-closed behavior for a known
  high advisory: `--audit-level=high` exited 1, while
  `--audit-level=critical` exited 0 for the same high-only advisory. This
  confirms that the configured threshold is meaningful and is not silently
  treated as a report filter.
- An isolated `node_modules` drift probe left a vulnerable version in the
  lockfile but installed a patched version in `node_modules`; both default
  `npm audit` and `npm audit --package-lock-only` reported the lockfile
  vulnerability. The command is not relying only on a mutable local install.

### Package metadata, lockfile, and overrides

- `package.json:11-125` and `package-lock.json:7-125` contain matching
  declared dependency sets; no declared package is absent from the lockfile
  root and no extra root dependency is present.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund` exited 0, confirming
  the checked-in package metadata and lockfile are currently installable under
  the CI install flags.
- The active overrides at `package.json:158-165` resolve in the installed tree:
  `minimatch` is `10.2.5`, `@tootallnate/once` is `3.0.1`, and `uuid` is
  `11.1.1`; `npm ls` marked the intended overridden paths and did not report
  invalid or missing dependencies.
- The overrides do not suppress the audit: the current audit report includes
  production, development, optional, and peer dependency counts.

### Heavy-tier and CI integration

- `docs/validation/manifest.json:44-63` places the audit in `test-heavy`
  before the remaining heavy checks. The tier runner stops on a non-zero audit
  exit, so a high or critical advisory cannot be converted into a pass.
- `.github/workflows/validation.yml:64-76` intentionally installs with
  `npm ci --ignore-scripts --no-audit --no-fund`, then
  `.github/workflows/validation.yml:172-177` runs `npm run ci` with
  `pipefail`. The install-time `--no-audit` is not a bypass because the
  canonical heavy tier runs the explicit audit after installation.
- `docs/validation/github-actions.md:55-66` documents the indirect
  `npm run ci` → `test-heavy` → `security-audit` route and preserves the
  configured high threshold.
- `.github/workflows/validation.yml:179-190` always attempts to upload the
  canonical log. A failing audit remains a failed pipeline step; diagnostic
  upload is allowed to fail without replacing that result.

## Required validation

The exact required command was run:

```text
TASK_PLAN_FILE=.local/tasks/task-715.md npm run test-heavy
```

Results:

- Passed: startup smoke.
- Passed: dependency security audit (`npm audit --audit-level=high`).
- Passed: schema check, workspace-skill contract, typecheck, storage lint,
  unit tests, Vite HMR tests, serial-lock tests, port-authority tests, and
  manifest parity.
- The run timed out in the later `collision-smoke` step while its two
  concurrent child commands were waiting to complete. No audit failure or
  vulnerability was observed, but the complete heavy tier did not reach its
  final pass or browser-test step. The timed-out run left a dead validation
  lock holder, which is harness state and not a dependency-audit result.

## Deferred / not audited

- No dependency versions, lockfile entries, overrides, thresholds, workflow
  files, or package scripts were changed.
- No advisory was treated as a tooling bug without reproducing the configured
  gate behavior.
- Broad application security, runtime package behavior, and provider-side
  advisory correctness were outside this task.
- Remote GitHub execution was not used as evidence; the local workflow
  contract and checked-in routing were inspected only.
- The managed published-Clerk workflow was not treated as a replacement for
  canonical dependency validation because this task targets the registered
  `test-heavy` security-audit step.

This report-only audit stops here. F-001 is recommended for a separate
hardening task; no implementation fix was applied in this task.