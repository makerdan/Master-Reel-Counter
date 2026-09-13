# Task #640: Tier 1: Repair Clerk environment and script loading

# Tier 1: Repair Clerk environment and script loading

## What & Why
The client derives a Clerk hostname that fails TLS verification, while browser setup rejects the current configuration. These are real entry failures, not compilation failures.

## Evidence
On 2026-09-11 the reported clerk-prefixed picard.replit.dev script URL failed curl certificate hostname verification (exit 60), and fresh browser logs repeated failed_to_load_clerk_js. The management callback returned external, conflicting with earlier managed reports. App.tsx still includes VITE_CLERK_PUBLIC_HOST/buildPublishableKey despite earlier claims it was removed. Heavy browser setup failed with: Clerk browser setup requires CLERK_SECRET_KEY, DATABASE_URL, and a valid Clerk publishable key or frontend host. Which individual credential/config field is invalid is not yet established.

## Done looks like
- Preview loads actual Clerk JavaScript over certificate-valid HTTPS and reaches sign-in without an unhandled load failure.
- Client, server, and browser fixtures select the same intended tenant/environment; production proxy behavior remains intact.
- Missing or inconsistent configuration is diagnosed by field names and safe categories, never secret values.

## Out of scope
No auth-provider migration, key disclosure, TLS bypass, wildcard CSP expansion, or disabling the release gate. Do not duplicate the active Google Admin/User login task.

## Pre-existing failures to ignore
None known at plan time. No authoritative baseline entries exist; observed failures are not authorized ignores.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.

## Validation
**Command:** `test-heavy`
**Why:** Browser, release and lifecycle coverage requires the heavy registered tier.
**Do not escalate:** Run exactly this command. Unrelated failures do not authorize broader work.

## Task-local environment observations
Read-only evidence on 2026-09-11: fast, standard, standard-plus passed; heavy failed before browser execution with incomplete Clerk browser configuration; both newest publishes failed at missing users.role. No approved ignored baseline. Recheck prerequisites before implementation.

## Regression Guard
**Covers:** The client derives a Clerk hostname that fails TLS verification, while browser setup rejects the current configuration. These are real entry failures, not compilation failures.
**Test location:** New focused bootstrap configuration and browser tests; existing tests/global-setup.ts and scripts/__tests__/managed-clerk-release.test.mjs
**What it checks:** Exercise managed and external configurations, absent/malformed overrides, real preview host, and production proxy selection; the current bad-host scenario must fail before the fix. Real provider verification remains blocked if the intended configuration cannot be established.

## Steps
1. Recheck management status and reconcile intended ownership before changing tenant configuration; do not migrate, delete, or reprovision Clerk based solely on the discrepancy. Use supported secret/configuration tooling.
2. Define and implement one explicit environment-aware bootstrap contract for key, frontend host and proxy selection. Preserve canonical managed behavior when managed is confirmed and use the configured external tenant when external is confirmed; reject unsupported overrides rather than deriving a fake tenant from an arbitrary preview hostname.
3. Align browser fixture configuration with that contract and validate missing/malformed cases independently. Do not manufacture keys to satisfy tests or skip browser setup.
4. Add a real preview-origin browser regression and production-candidate contract asserting exact script request host/path, TLS, status, JavaScript content type, loaded session state, and bounded CSP allowances.

## Relevant files
- `client/src/App.tsx`
- `tests/global-setup.ts`
- `shared/clerk-config.ts`
- `server/contentSecurityPolicy.ts`
- `scripts/__tests__/managed-clerk-release.test.mjs`

## Durable plan copy
At implementation start, preserve this full task description under docs/plans using its task slug. The user authorized .local/tasks solely as task-submission transport, not as the durable deliverable location.