# Resolve Clerk Release Contract

## What & Why
Align the managed Clerk release workflow with the server startup contract, which requires both `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY`. The release must stop before candidate validation when either variable is absent, malformed, or selects a different Clerk tenant.

## Done looks like
- The production release workflow supplies both server and client Clerk publishable-key variables to credential preflight and the exact candidate build.
- Missing server or client publishable-key configuration blocks the release with a safe field-level diagnostic.
- Malformed or tenant-mismatched publishable keys block candidate startup or preflight rather than falling back or continuing.
- Automated contract coverage proves that the workflow inputs and server startup requirements stay aligned.

## Out of scope
- Creating, rotating, copying, or displaying Clerk credentials.
- Changing Clerk tenants, Google provider settings, or the application's authentication model.
- Publishing a release or performing live Google sign-in verification.
- Broad changes to the release database, browser fixture, or unrelated CI validation.

## Pre-existing failures to ignore
None known at plan time. `docs/validation/failure-baseline.json` contains no records, so treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** This registered tier runs the managed Clerk release contract tests together with application type checking and backend checks, covering the workflow-to-startup configuration boundary without escalating to live browser validation.
**Do not escalate:** Run exactly this command. Pre-existing or environment-limited failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** The release workflow and production server disagreeing about required Clerk publishable-key variables, including missing, malformed, and cross-tenant server/client key pairs.
**Test location:** `scripts/__tests__/managed-clerk-release.test.mjs`
**What it checks:** Asserts that release credential preflight and candidate execution provide both named publishable-key variables, and that the shared startup contract rejects either missing key and tenant-mismatched pairs without exposing credential values.

## Task-local environment observations
- The current server startup path calls the shared environment resolver with `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY`.
- The current managed release workflow provides only `VITE_CLERK_PUBLISHABLE_KEY` during credential preflight and candidate execution.
- The failure baseline catalog is empty.
- Task #646 is merging broader Clerk review work; re-read the merged workflow, startup resolver, and contract tests before editing so this task applies only any remaining contract gap.

## Steps
1. **Reconcile after the Clerk review merge** — Inspect the post-merge release workflow, shared Clerk environment resolver, production startup path, and existing contract assertions to confirm the remaining mismatch before changing anything.
2. **Align release environment inputs** — Supply the server and client publishable-key variables from the production environment to both release preflight and exact candidate execution, preserving the existing secret-handling and redaction boundaries.
3. **Keep validation fail-closed** — Ensure release preflight and startup reject either absent or malformed variable and reject server/client keys that resolve to different tenants, without deriving one variable from the other or logging key contents.
4. **Lock workflow and startup parity** — Extend the deterministic release contract tests to assert both workflow variables, both missing-key cases, and tenant mismatch behavior against the shared startup resolver so either side cannot drift independently.
5. **Validate within the registered ceiling** — Run the focused contract checks while diagnosing task-local failures, then run the plan-locked `test-standard` tier and classify every failure under the empty baseline catalog.

## Relevant files
- `.github/workflows/managed-clerk-release.yml`
- `scripts/build-and-verify-release.sh`
- `scripts/__tests__/managed-clerk-release.test.mjs`
- `shared/clerk-config.ts`
- `server/index.ts`
- `server/replit_integrations/auth/replitAuth.ts`
- `docs/validation/failure-baseline.json`
- `.agents/skills/validation-tiers/tiers.json`
