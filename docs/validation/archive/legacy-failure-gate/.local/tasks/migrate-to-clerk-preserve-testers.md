# Clerk Migration With Tester Access

## What & Why
Replace Replit OIDC authentication with fully configured Replit-managed Clerk while preserving the existing owner-managed tester login and Dan’s owner authorization. This gives normal users Clerk authentication without weakening the application’s local approval, rejection, tester, or owner permission contracts.

## Done looks like
- Replit-managed Clerk is provisioned through the platform workflow, and all managed secrets and production proxy configuration are created without secret values being printed, committed, or manually edited.
- Dan’s migrated Clerk identity resolves to the existing local owner account and retains every owner-only administration capability; no other Clerk or tester identity can acquire owner privileges.
- Existing approved, pending, and rejected users retain their local authorization status after migration, with terminal pending/denied states instead of authentication redirect loops.
- The existing owner-scoped tester URL, access code, password login, deterministic tester identity, restricted permissions, expiration, and logout behavior continue to work without requiring Clerk accounts.
- The public landing page remains available while signed out, while branded sign-in and sign-up pages work at the canonical base-prefixed routes and OAuth callback subpaths.
- Web API authentication uses Clerk session cookies only, the production Clerk proxy is wired in canonical order, and authenticated identity changes clear user-scoped client cache data.
- Automated regression coverage proves owner retention, local-user reconciliation, tester isolation, protected-route rejection, and authenticated user-data access before the migration is considered complete.

## Out of scope
- Replacing tester credentials with Clerk accounts.
- Redesigning the users table, approval workflow, tester permission model, or owner administration features.
- Adding new Clerk dashboard-only features such as MFA, enterprise SSO, or session-policy customization.
- Removing preserved database tables or foreign keys merely because Clerk becomes the identity provider.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- The pre-task backend spot run completed 57 of 59 tests successfully. Two tester-login integration assertions returned HTTP 200 where the tests expected 400 and 401. The baseline catalog has no active record for either signature, so these observations do not authorize ignoring them; establish provenance or repair them as part of preserving the tester contract.

## Validation
**Command:** `test-heavy`
**Why:** Authentication changes span server startup and middleware, security-sensitive route authorization, database identity reconciliation, tester sessions, and browser flows; the complete registered tier is required to cover unit, integration, audit, and Playwright checks.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** Migrated and newly provisioned Clerk users resolve to the correct local authorization record, Dan alone retains owner authority, and a tester session cannot bypass tester restrictions or inherit a concurrent Clerk owner identity.
**Test location:** `server/__tests__/routes.test.ts` and `tests/global-setup.ts`
**What it checks:** Server integration tests exercise owner, approved, pending, rejected, signed-out, and tester identities; browser setup and authenticated journeys prove cookie-only access to user-scoped data, canonical sign-in/sign-out navigation, and cache-safe identity changes.

## Steps
1. **Provision and migrate identity data** — Use the authorized Replit-managed Clerk provisioning and migration operations, poll to a successful terminal migration state, and stop before code changes if provisioning or data migration fails. Never reveal or hand-edit managed Clerk values.
2. **Separate preserved tester auth from legacy OIDC** — Retain the tester credential, owner-scope, deterministic identity, expiration, logout, and restriction contract while removing only the obsolete Replit OIDC and Passport login machinery. Normalize Clerk and tester requests into an unambiguous server identity model with fail-closed precedence when both session types are present.
3. **Install canonical server integration** — Add the canonical Clerk proxy before body parsers, Clerk middleware with host-aware key resolution, cookie-based request authentication, and just-in-time local-user reconciliation. Preserve existing users/session schemas, foreign keys, approval/rejection state, global API authorization, object-storage protection, and the inline typed-request convention.
4. **Preserve owner and application authorization** — Map Dan’s migrated identity to the existing owner record using the canonical legacy-ID bridge, keep owner checks server-side, and ensure new or mismatched Clerk identities cannot claim the owner account. Retain terminal pending, rejected, and missing-local-user behavior without redirect loops.
5. **Install canonical branded web experience** — Replace Replit OIDC client hooks and routes with the canonical Clerk provider, host-aware publishable key, unconditional proxy URL, exact Wouter callback routes, public signed-out homepage, authenticated app redirect, Clerk logout, identity-change cache invalidation, and styling/localization matched to the existing application.
6. **Update contracts and regression coverage** — Update project auth documentation and adapt existing server and browser tests to cover the Clerk/local-user bridge, owner retention, tester isolation, cookie-only protected APIs, branded sign-in/sign-up callback paths, authenticated stateful pages, and sign-out. Resolve the observed tester-login failures unless execution evidence independently satisfies Failure Gate provenance requirements.
7. **Restart and verify end to end** — Restart the application workflows, run the locked validation tier, and exercise owner, ordinary-user, pending/rejected, signed-out, and tester journeys. Confirm at least two authenticated pages render user-scoped server data and that development versus production proxy behavior follows the managed Clerk contract.

## Relevant files
- `server/index.ts`
- `server/routes.ts`
- `server/replit_integrations/auth/replitAuth.ts`
- `server/replit_integrations/auth/routes.ts`
- `server/replit_integrations/auth/storage.ts`
- `server/replit_integrations/auth/index.ts`
- `server/replit_integrations/object_storage/routes.ts`
- `shared/models/auth.ts`
- `shared/schema.ts`
- `client/src/App.tsx`
- `client/src/hooks/use-auth.ts`
- `client/src/lib/auth-utils.ts`
- `client/src/lib/queryClient.ts`
- `client/src/pages/tester-login.tsx`
- `client/src/pages/pending-approval.tsx`
- `client/src/pages/join.tsx`
- `client/src/index.css`
- `vite.config.ts`
- `server/__tests__/routes.test.ts`
- `tests/global-setup.ts`
- `tests/fixtures.ts`
- `replit.md`
- `.local/skills/clerk-auth/references/setup-and-customization.md`
- `.local/skills/clerk-auth/references/web-migration.md`
- `.local/skills/clerk-auth/references/task/migrate.md`
