# Review Merged Clerk Repair

## What & Why
Refresh Task #646 so its review starts from the current checkout rather than the obsolete 1cfbb96 evidence matrix. The current checkout is `aa57da5`, which contains the merged sign-in routing revision from Task #654 (`51e01e9`), the isolated Admin/User schema and browser-runner revision from Task #655 (`016524d`), and the later Clerk identity-race repair (`aa57da5`). Reconcile those changes before trusting any earlier pass, failure, or publish-readiness claim.

The key fixture question is still open: the ordinary heavy path runs `scripts/run-browser-tests.mjs` with `playwright.config.ts`, whose `globalSetup` currently provisions one approved Admin account, while the Admin/User pair is defined in the separately configured `tests/release/google-clerk-auth.spec.ts`, which the ordinary heavy config excludes. The refreshed review must prove which fixture owns each role and must not claim that heavy validation created both identities until both are actually provisioned, authenticated, and role-checked.

## Done looks like
- The review names the exact checked-out revision and verifies that the merged 654/655 changes, plus any later merged Clerk changes included in that checkout, are the code under review.
- The old 1cfbb96 evidence matrix is explicitly superseded; every scenario is marked passed, failed, blocked, or not exercised using new evidence from the reconciled revision.
- The heavy browser path is traced end to end: isolated database creation or selection, schema preparation and preflight, fixture provisioning, Playwright discovery, authentication, cleanup, and database teardown.
- The intended approved Admin and User identities are each created in the fixture that claims to cover them, authenticated through the supported Clerk test path, and verified through `/api/auth/user` plus persisted `users.role`. If the ordinary heavy tier intentionally remains Admin-only, the report says so and treats the separate release Admin/User spec as distinct evidence rather than conflating the two.
- Focused release/schema contract checks and the locked `test-heavy` result are recorded for the current revision. Harness limitations, missing provider configuration, unavailable publishing, and live Google prerequisites remain explicit blockers rather than inferred passes.
- Any integration defect caused by the merged repair is fixed only within this task, with a focused regression assertion and a redacted final report under `docs/validation`. No secrets, cookies, OAuth material, identity-bearing response bodies, or unverified publish claims are recorded.

## Pre-existing failures to ignore
None known at plan time. `docs/validation/failure-baseline.json` has no active records, so every product or test failure must be treated as a potential regression until the Failure Gate evidence rules establish otherwise.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.

## Validation
**Command:** `test-heavy`
**Why:** This is the registered integration tier that covers the isolated browser database lifecycle, schema preflight, Clerk browser fixture, application authentication, release-related contracts, and the broader lifecycle checks required by this review.
**Do not escalate:** Run exactly this command. A dependency, provider, database, or harness failure is evidence to classify and report; it is not permission to run a broader tier or bypass the release boundary.

## Task-local environment observations
- Current checkout is `aa57da57ebea4ce8d5afd22a9458c0ddd27eda46`; `51e01e9` and `016524d` are ancestors, and the checkout also contains the later `aa57da5` identity-race changes.
- The focused current-revision contract checks passed: `scripts/__tests__/managed-clerk-release.test.mjs` passed 27 tests and `scripts/__tests__/release-schema-preflight.test.mjs` passed 5 tests.
- A plan-locked `test-heavy` attempt was blocked before validation by the read-only Plan-mode workspace because it could not create `.local/validation-lock-validation.lock`. This is a harness limitation, not a pre-existing failure or a product pass.
- Static inspection shows `tests/global-setup.ts` creates one approved Admin identity. `tests/release/google-clerk-auth.spec.ts` contains separate Admin and User role cases, but `playwright.config.ts` excludes `release/**`, so those cases are not evidence that the ordinary `test-heavy` browser fixture created both identities.

## Regression Guard
**Covers:** The compatibility and data-integrity boundary between the isolated heavy browser database, Clerk external identities, local `users` rows, and persisted `Admin`/`User` roles after the 654/655 merge.
**Test location:** `tests/global-setup.ts`, `tests/release/google-clerk-auth.spec.ts`, and `scripts/__tests__/managed-clerk-release.test.mjs`.
**What it checks:** The selected heavy/release fixture path creates owned Admin and User identities only in the isolated target, binds each Clerk identity to the intended local row, returns the matching role from `/api/auth/user`, preserves the role in PostgreSQL, and cleans up both provider and local fixtures; the contract fails if the runner silently uses the publishing database, provisions only Admin while claiming Admin/User coverage, or loses the role mapping.

## Steps
1. **Reconcile the reviewed revision** — Preserve this refreshed plan as the durable Task #646 plan under `docs/plans` during execution, then review the merge ancestry and combined diffs for Tasks #654 and #655 together with later Clerk changes in `aa57da5`. Replace stale 1cfbb96 conclusions in the evidence matrix rather than carrying them forward.
2. **Trace the heavy and release fixture boundaries** — Follow the registered heavy tier through `scripts/run-browser-tests.mjs`, `playwright.config.ts`, `tests/global-setup.ts`, and `tests/fixtures.ts`; separately trace `playwright.release.config.ts` and the Google Admin/User spec. Record exactly which path creates each identity, which database it uses, and which tests actually execute under each configuration.
3. **Make Admin/User fixture coverage explicit and safe** — Ensure the fixture path that claims Admin/User coverage provisions both approved roles against the isolated schema, authenticates each through the supported Clerk testing flow, verifies the local identity and persisted role, and cleans up only owned rows and Clerk users. Keep the ordinary single-session fixture Admin-only if its shared storage model requires that, but add a deterministic role-pair fixture or contract assertion instead of implying that the existing Admin-only setup covers User behavior.
4. **Rebuild the scenario evidence matrix** — Recheck sign-in route delivery, Clerk script loading and recovery, schema preflight, identity mapping, Admin/User role visibility, protected navigation, logout, service-worker and WebSocket lifecycle, cleanup, and release-candidate boundaries on the reconciled revision. Mark provider-dependent Google checks and any unavailable exact publish as blocked unless new user-triggered evidence exists.
5. **Run focused checks and the locked heavy tier** — Use the current plan as the tier lock, run the focused fixture/schema contracts while diagnosing any failure, then run exactly `test-heavy`. Classify failures using the empty baseline catalog and do not fix unrelated dependency, environment, or harness failures merely because they prevent later steps.
6. **Review and report** — Re-review any task-local correction, confirm cleanup and redaction paths, and write a redacted report under `docs/validation` naming the reviewed revision, commands, Admin/User fixture evidence, scenario outcomes, remaining blockers, and publish-readiness conclusion. Do not publish, change provider settings, mutate production data, or trigger remote workflows.

## Out of scope
- Auth-provider migration, production credential copying, or changes to Clerk/Google provider settings.
- Treating an isolated smoke database as proof that the publishing database has the reviewed migrations.
- Publishing or claiming live Google verification without a new user-triggered publish and matching approved accounts.
- Broad dependency remediation, unrelated backlog cleanup, or replacement of the existing full-suite/dependency task.
- Destructive schema changes or cleanup outside owned disposable fixtures.

## Relevant files
- `tests/global-setup.ts`
- `tests/fixtures.ts`
- `tests/release/google-clerk-auth.spec.ts`
- `playwright.config.ts`
- `playwright.release.config.ts`
- `scripts/run-browser-tests.mjs`
- `scripts/prepare-release-test-database.mjs`
- `scripts/release-schema-preflight.mjs`
- `scripts/__tests__/managed-clerk-release.test.mjs`
- `scripts/__tests__/release-schema-preflight.test.mjs`
- `client/src/App.tsx`
- `docs/release/google-clerk-live-check.md`
- `docs/validation/manifest.json`
- `docs/validation/failure-baseline.json`
