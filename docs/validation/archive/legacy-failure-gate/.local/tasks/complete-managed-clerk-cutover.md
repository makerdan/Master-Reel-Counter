# Complete Managed Clerk Cutover

## What & Why
Finish the live transition from the external Clerk tenant to Replit-managed Clerk. Retain only the primary owner Admin and that account’s application data; every other existing identity, including any additional Admin, must be removed and must sign up again through the managed tenant.

The current branch already contains the managed Clerk bootstrap, proxy, release checks, authorization model, and a reset utility from merged Task #677. Reuse that work and change code only where current behavior cannot complete this approved retention policy.

## Done looks like
- Development and production authenticate exclusively through a Replit-managed Clerk tenant, with no runtime fallback to the previous external tenant
- The primary owner can sign in through the managed tenant and retains the existing Admin role, capabilities, and owned application data
- Every other previous account and its account-owned data is removed, including any additional Admin account, without deleting or orphaning the retained owner’s data
- Former users cannot authenticate through old sessions or identity mappings and can only return by signing up again
- New signups begin pending and cannot access protected API, WebSocket, offline, or cached data until the retained Admin approves them
- Managed Clerk configuration fails closed when credentials are absent, malformed, or select different tenants, without exposing credential values
- Direct sign-in, callbacks, logout, active-session revocation, production proxying, and the release gate work against the managed tenant
- The cutover produces redacted verification evidence showing the retained owner, account cleanup, tenant alignment, and successful validation without recording credentials or authenticated browser state

## Out of scope
- Migrating or preserving any non-primary account, including additional Admin accounts
- Matching returning signups to deleted accounts by email, username, or other mutable profile data
- Transferring deleted users’ sessions, folders, photos, entries, settings, or other owned data to the retained owner
- Redesigning roles, approval rules, per-User capabilities, or Clerk sign-in screens
- Adding Clerk dashboard features such as MFA, enterprise SSO, or organization management

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- The pre-plan `npm run test:unit` baseline passed all 107 tests.
- The current `main` branch already contains managed Clerk bootstrap, proxy, release validation, and a reset script from merged Task #677; verify and complete only the remaining live cutover work.
- The current reset utility requires exactly one Admin before it starts, while the approved policy retains one selected primary owner and removes every other account. It must either prove that the database already has exactly one Admin or safely support the broader cleanup policy.
- `docs/validation/failure-baseline.json` contains no records.

## Validation
**Command:** `test-heavy`
**Why:** The cutover changes the live identity provider and destructive account lifecycle across database ownership, HTTP and WebSocket authorization, protected browser state, production proxying, and release authentication; the complete registered browser and server tier is required.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** The cutover retains only the selected primary owner, removes every other account atomically, rejects old identities and sessions, keeps new users pending, and preserves managed Clerk sign-in and release behavior.
**Test location:** `server/__tests__/routes.test.ts`, `scripts/__tests__/managed-clerk-release.test.mjs`, and `tests/release/managed-clerk-auth.spec.ts`
**What it checks:** The reset rolls back on ambiguous or conflicting owner identity, succeeds when other Admins exist by deleting every non-retained account and owned graph, leaves exactly one approved Admin bound to the managed Clerk identity, denies old or pending identities across HTTP and WebSocket boundaries, clears protected browser state, and exercises the canonical managed production proxy and release contract.

## Steps
1. **Reconcile the existing implementation and live boundary** — Confirm whether the Replit-managed Clerk tenant is already provisioned and whether development and production configuration select it using non-sensitive metadata only. Identify the stable local primary-owner record and its new managed Clerk identity, and stop before any mutation if either side is ambiguous or mismatched.
2. **Close the retention-policy gap** — Review the merged reset workflow against the approved rule that only the selected primary owner survives. If additional Admins are possible, make the destructive operation select the retained owner explicitly, treat every other account as a cleanup candidate, preserve the owner’s complete data graph, and roll back on any ownership, identity, or final-state invariant failure.
3. **Activate Replit-managed credentials** — Use Replit’s supported managed-Clerk provisioning and secret flow for development and production; do not print, commit, hand-copy, or derive credentials. Remove or reject any remaining external-tenant override and require matching server and client tenant configuration before startup or release.
4. **Execute the controlled cutover** — Apply required schema state, bind the managed Clerk identity to the retained owner, invalidate legacy bindings and sessions, and transactionally remove all other accounts and their owned data behind explicit destructive confirmation. Verify the final database state and managed identity binding before committing or publishing.
5. **Prove post-cutover authorization** — Confirm the retained owner’s Admin access, denial of prior identities and sessions, pending behavior for a fresh signup, active HTTP and WebSocket revocation, and protected browser-cache clearing. Keep all diagnostics redacted and clean up disposable provider, database, and browser fixtures on every exit.
6. **Validate and release without widening scope** — Add or update focused regression coverage only for demonstrated cutover gaps, run the task-locked `test-heavy` tier, classify every failure under the empty baseline, and publish only after the managed development and production contracts pass.

## Relevant files
- `scripts/reset-managed-clerk.mjs`
- `shared/clerk-config.ts`
- `server/index.ts`
- `server/middlewares/clerkProxyMiddleware.ts`
- `server/replit_integrations/auth/replitAuth.ts`
- `server/replit_integrations/auth/storage.ts`
- `server/replit_integrations/auth/routes.ts`
- `client/src/App.tsx`
- `server/__tests__/routes.test.ts`
- `scripts/__tests__/managed-clerk-release.test.mjs`
- `tests/release/managed-clerk-auth.spec.ts`
- `.github/workflows/managed-clerk-release.yml`
- `docs/validation/failure-baseline.json`
- `.agents/skills/validation-tiers/tiers.json`
