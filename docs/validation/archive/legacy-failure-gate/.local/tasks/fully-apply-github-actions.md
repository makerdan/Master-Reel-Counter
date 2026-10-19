# Fully Apply GitHub Actions

## What & Why
Complete the existing GitHub Actions installation now that the repository is public. Repair the failing pull-request validation path, ensure tracked automation policy reaches GitHub’s default branch, collect revision-aware remote evidence, and require the stable validation result only after the workflow succeeds.

## Done looks like
- Pull requests and pushes to `main` reach the canonical `npm run ci` command instead of stopping in the blank-database preflight.
- The stable `Validation result` check fails closed when required validation fails, is cancelled, or is skipped, and succeeds only when every required validation leg succeeds.
- The tracked Dependabot policy is present on GitHub’s default branch and remains covered by the repository contract test.
- A successful GitHub Actions run records the exact revision, event, jobs, canonical command result, and diagnostic artifact outcome.
- After successful revision-aware evidence exists, the public repository’s `main` branch policy requires the exact stable `Validation result` check without granting workflows write access or production secrets.
- Documentation distinguishes observed remote evidence from local configuration and records any remaining unknown, local-only, or intentional-gap coverage.

## Out of scope
- Changing repository visibility again, billing, environments, deployment workflows, production credentials, or application release behavior.
- Weakening the canonical local validation command, dependency-audit threshold, Failure Gate, Regression Guard, or test suites to obtain a green workflow.
- Giving pull-request code write permissions, secrets, deployment access, or privileged `pull_request_target` execution.
- Treating workflow-file presence as evidence that a run passed or a branch rule is active.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- The required plan scaffold command could not write under `.local/tasks/` because the Planner workspace is read-only; this plan was created through the task-plan write interface instead.
- Read-only GitHub evidence confirmed the repository is public, its default branch is `main`, `main` is currently unprotected, and no repository rulesets exist.
- The latest observed canonical pull-request runs fail in the blank-database startup/authentication preflight before `npm run ci`; this is task-owned behavior, not an ignored baseline.
- The local `.github/dependabot.yml` is absent from the current GitHub `main` tree.

## Validation
**Command:** `test-heavy`
**Why:** This task changes the remote execution path for the complete canonical validation contract and its merge-blocking result, so the registered heavy tier is the lightest tier covering startup, database, backend, harness, security, and browser behavior.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** Pull-request validation must bootstrap an isolated PostgreSQL database and authenticated synthetic owner, reach the canonical command, preserve least privilege, and produce one fail-closed stable aggregate before branch protection can require it.
**Test location:** `scripts/__tests__/github-actions-empty-database.test.mjs`; `scripts/__tests__/github-actions-workflow.test.mjs`
**What it checks:** The isolated startup preflight succeeds with the supported PostgreSQL contract, workflow events and prerequisites remain complete, actions stay immutably pinned and read-only, Dependabot PRs route to `npm run ci`, and `Validation result` rejects failed, cancelled, or skipped required work.

## Steps
1. **Reconcile the portable validation contract** — Re-inventory the canonical local tiers, workflow events, services, browser matrix, generated or schema prerequisites, credentials, artifacts, and intentional gaps. Update the documented local-to-remote table so every applicable validation surface has one explicit owner and evidence classification.
2. **Repair the failing PR preflight** — Correct the isolated blank-database schema and synthetic-owner setup so it matches the current application authentication and schema contracts and allows pull-request jobs, including Dependabot PRs, to reach `npm run ci` without production credentials.
3. **Harden workflow regression coverage** — Extend the focused CI contract tests to reproduce the observed preflight failure and enforce safe events, immutable action pins, frozen installation, finite timeouts, complete browser prerequisites, diagnostic uploads, and the fail-closed stable aggregate.
4. **Synchronize tracked automation policy** — Ensure the existing Dependabot configuration and repaired workflow are merged through the normal repository path so GitHub’s default branch contains the reviewed files; do not mutate remote workflow files directly or claim grouping behavior before GitHub demonstrates it.
5. **Validate locally at the declared ceiling** — Run the focused workflow and blank-database guards, then the task-locked `test-heavy` tier. Classify every failure under Failure Gate without weakening checks or escalating beyond the plan ceiling.
6. **Collect revision-aware GitHub evidence** — Using the separately authorized remote-run scope, verify the exact merged revision on applicable pull-request and `main` events, recording each required job, canonical command, matrix or browser leg, artifact result, skip, cancellation, retry, and conclusion. Keep merge protection disabled unless the stable result succeeds.
7. **Enable and verify branch protection** — Only after successful evidence, use the separately authorized GitHub administration scope to protect `main` with the exact `Validation result` check, then read the policy back and verify it references the observed stable check. Preserve safe fork behavior, read-only workflow permissions, and no PR secrets.
8. **Publish the completion record** — Update the GitHub Actions installation report with changed files, exact commands, coverage decisions, security/event scopes, validation evidence, remaining gaps, manual settings, and a rollback path that checks policy references before disabling or removing the workflow.

## Relevant files
- `.github/workflows/validation.yml`
- `.github/dependabot.yml`
- `docs/validation/github-actions.md`
- `docs/validation/manifest.json`
- `package.json`
- `package-lock.json`
- `.replit`
- `scripts/__tests__/github-actions-empty-database.test.mjs`
- `scripts/__tests__/github-actions-workflow.test.mjs`
- `scripts/lib/github-actions-validation-contract.mjs`
- `scripts/validation-steps.mjs`
- `.agents/skills/install-github-actions/SKILL.md`
- `.agents/skills/validation-tiers/tiers.json`
