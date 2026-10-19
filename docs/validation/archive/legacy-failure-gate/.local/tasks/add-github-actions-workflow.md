# Add Complete GitHub Actions

## What & Why
Integrate GitHub Actions as the repository's remote validation processor while preserving the existing canonical local validation contract. The repository is private and has no current GitHub workflow, so the new repository files must provide secure, fail-closed coverage without claiming that checks are active, passing, or merge-required before remote evidence exists.

## Done looks like
- Pull requests, pushes to `main`, merge-queue events, and manual dispatches invoke a stable GitHub Actions validation workflow that executes the repository's canonical `npm run ci` contract.
- The workflow uses immutable third-party action pins, read-only repository permissions, a frozen `npm ci` install, the declared Node runtime, finite timeouts, safe concurrency, and no production credentials or write-capable tokens.
- PostgreSQL and Chromium prerequisites are explicitly provisioned with readiness checks, and test-only environment values are separated from unavailable secrets; every canonical validation surface is mapped as direct, indirect, local-only, an intentional gap, or unknown.
- Required validation fails on command failure, cancellation, missing required work, or unexpected skips; a stable aggregate result is available for future branch policy rather than relying on ephemeral leg names.
- Playwright reports, traces, screenshots, and useful logs are uploaded diagnostically with bounded retention and `always()` semantics without overriding the validation result or exposing sensitive data.
- A repository-level workflow contract test fails if triggers, permissions, immutable pins, canonical command routing, service readiness, timeout, aggregation, or artifact safety regress.
- Documentation records the local-to-remote coverage table, private-repository limitation, fork behavior, local-only dependencies, intentional gaps, manual GitHub settings, verification requirements, and rollback steps.

## Out of scope
- Changing repository visibility, GitHub billing or plan, secrets, variables, environments, branch protection, rulesets, required-check settings, or runner configuration.
- Dispatching, approving, rerunning, or otherwise mutating remote workflow runs.
- Claiming the workflow is active, passing, or required without revision-aware run evidence and separate branch-policy evidence.
- Weakening the local Failure Gate, dependency-audit threshold, tier lock, tests, or security boundaries to make CI green.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-heavy`
**Why:** This task changes the repository's complete remote-validation and security contract, so the full registered tier is required to exercise startup, audit, schema, skill, static, unit, harness, and browser surfaces represented in CI.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** GitHub workflow changes must not silently lose event coverage, weaken pull-request permissions, use mutable action references, bypass the canonical heavy tier, skip required results, or let artifact reporting mask validation failures.
**Test location:** `scripts/__tests__/github-actions-workflow.test.mjs`
**What it checks:** Parse and inspect the workflow contract so the test fails when required triggers, least-privilege permissions, immutable pins, canonical command routing, PostgreSQL readiness, timeout, stable aggregation, or safe diagnostic upload behavior is removed or weakened.

## Steps
1. **Finalize the portable validation inventory** — Reconcile every canonical tier step, suite, prerequisite, environment input, generated or parity check, and Replit-only dependency into an evidence-backed local-to-remote coverage table before writing workflow configuration.
2. **Build the secure workflow** — Add one stable workflow covering pull requests, `main` pushes, merge groups, and manual dispatch with least privilege, immutable action pins, frozen dependency installation, explicit runtime setup, bounded timeouts, and concurrency that cannot create false-green protected results.
3. **Provision test prerequisites** — Configure an isolated PostgreSQL service, readiness checks, Chromium, and clearly non-sensitive test values; fail or document explicit local-only/gap decisions rather than silently skipping unavailable storage, AI, or Replit-bound coverage.
4. **Preserve canonical validation ownership** — Route remote validation through `npm run ci` and its registered heavy tier, keep matrix or job results fail-closed, and expose a stable aggregate check suitable for later manual branch-policy configuration.
5. **Add diagnostics and recurrence protection** — Upload bounded, redacted failure artifacts without affecting the required result, and add a focused workflow contract test that detects weakened triggers, permissions, pins, routing, services, aggregation, or artifact semantics.
6. **Document activation boundaries** — Record exact event scopes, coverage decisions, exclusions, private-repository limitations, unknown remote state, remaining manual GitHub settings, evidence needed after the first run, and a safe rollback procedure.
7. **Validate without remote mutation** — Run syntax and contract checks plus the plan-locked heavy tier locally; report dependency-audit or environment failures under Failure Gate rules and do not trigger GitHub or overstate remote status.

## Relevant files
- `package.json`
- `package-lock.json`
- `docs/validation/manifest.json`
- `.agents/skills/validation-tiers/tiers.json`
- `scripts/run-tier.mjs`
- `scripts/validation-steps.mjs`
- `scripts/validate-validation-manifest.mjs`
- `scripts/startup-smoke.sh`
- `scripts/ci.sh`
- `scripts/ci-collision-test.mjs`
- `playwright.config.ts`
- `tests/global-setup.ts`
- `docs/testing.md`
- `docs/validation/failure-baseline.json`
