# Integrate App Support Operations

## What & Why
Integrate the approved Combined App Support Ops design into Master Reel Counter by extending its existing Help, owner analytics, and Port Authority foundations. Keep the three modes independently gated while sharing only native authorization, persistence, UI, telemetry, and runtime adapters, so advanced support capabilities are maintainable, private, accessible, and production-safe.

## Done looks like
- New and returning users receive concise first-run guidance for the app’s core workflows, can dismiss and revisit it, and can use structured searchable help, grounded app-only AI answers, and the configured feedback path across keyboard, touch, small-screen, and assistive-technology interactions.
- Every support and analytics API uses a shared server-authoritative owner policy with deny-by-default behavior; unauthorized clients cannot infer protected data, admin identifiers, role lists, credentials, private prompts, or raw telemetry.
- The existing admin surface presents bounded summary, AI-usage, feedback, and page-view operations using native tables/charts, with privacy-minimized non-blocking event collection, duplicate suppression, retention/time-range limits, and failure isolation.
- The single-service runtime remains environment-port driven, hardcoded-port scanning rejects synthetic bad fixtures, tests use canonical allocation and cleanup, and relevant validation succeeds twice without manual process killing.
- A development outage/recovery control is delivered only if the real client, server wrapper, authorization, CSRF-equivalent protection, rate limits, readiness, and build/server production-exclusion gates can all be proven; otherwise the executor reports the exact unavailable gate and leaves production/runtime behavior unchanged.
- Delivery reports the capability matrix, selected Combined modes, skipped or unavailable gates, changed adapters, safety decisions, negative-path coverage, configuration gaps, and specialist handoffs without overstating unverified protection or publication.

## Out of scope
- Replacing Clerk/auth migration work already owned by another active task or introducing a new role provider.
- Adding a new AI provider, analytics vendor, support destination, chart library, database, deployment mechanism, or invented environment variable.
- Building multi-service orchestration, public analytics, production restart controls, raw user tracking, or unrestricted exports.
- Redesigning unrelated application pages or the standalone Mockup Sandbox artifact.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- The primary backend baseline passed 59 of 59 tests before planning.
- Help, feedback, AI chat, owner analytics, page views, health probes, shutdown, port cleanup, and validation locks are present; first-run structured guidance and a safely gated development outage control are not evident.
- Existing help conversations lack an explicit user ownership column, and several admin routes repeat owner checks instead of sharing one authoritative boundary.

## Validation
**Command:** `test-heavy`
**Why:** This cross-layer Combined integration changes authenticated server boundaries, persistence and telemetry behavior, accessible browser flows, development lifecycle controls, and production exclusion, requiring the complete registered validation tier.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** Existing Help, feedback, admin analytics, telemetry, authentication, port cleanup, shutdown, and production behavior must remain usable while unauthorized data access, cross-user AI history, duplicate/blocking telemetry, unsafe process takeover, or production restart controls remain impossible.
**Test location:** `server/__tests__/support-ops.test.ts`
**What it checks:** Exercises shared owner authorization and denial semantics, user-scoped help data, bounded grounded Q&A and feedback validation, privacy-safe non-blocking/deduplicated analytics, retention/range limits, development control authorization and idempotence, and server-side production exclusion; paired browser/runtime tests cover accessible revisit and real recovery behavior.

## Steps
1. **Finalize the capability matrix** — Reconfirm Client/UI, server, identity, data, support, analytics, AI, and runtime capabilities against the post-Clerk code state; record each as present, absent, unclear, or not applicable and stop individual advanced features whose prerequisites remain unproven.
2. **Unify narrow server boundaries** — Introduce native shared authorization and validation adapters for support/admin operations, scope persisted AI/help data to its authenticated user, preserve the project’s typed-request convention, and retain contract-appropriate API denial semantics.
3. **Structure the Help system** — Move reusable product guidance into versioned structured records, add searchable contextual and full-guide presentation, and implement first-run dismissal/completion plus an explicit revisit/reset path through the existing settings mechanism.
4. **Harden grounded Q&A and feedback** — Ground AI responses only in approved current help sources and user context, bound input/output, timeouts, rate limits, telemetry, and unavailable answers, and consolidate feedback submission around the existing configured local persistence path without inventing an external destination.
5. **Complete accessible Help interactions** — Ensure all support surfaces preserve focus and place, provide semantic state announcements and intentional close/minimize behavior where overlays exist, and work without hover across keyboard, touch, zoom, reduced motion, and responsive layouts.
6. **Harden Admin Analytics** — Apply the shared owner policy to every analytics read/export, minimize and aggregate collected events, add bounded retention/time filters and pagination/export restrictions where applicable, and isolate telemetry failures and rerender/reload duplicates from user-visible operations.
7. **Adapt Runtime Safety** — Audit all service, test, workflow, configuration, and executable-documentation port references; preserve the canonical cleanup/lock utilities; add representative failing and passing scanner fixtures; and prove readiness, cleanup, stale-holder, timeout, and repeat-run behavior without inventing multi-service machinery.
8. **Gate development outage and recovery** — If every prerequisite is proven, add an explicit development-authorized client control backed by the real process failure/restart path, CSRF-equivalent protection, bounded restart requests, idempotence, health/readiness, and reconnect recovery; prove both build-time and server-time production exclusion.
9. **Add focused negative-path coverage** — Cover new/returning/revisit Help states, escaping and no-AI fallback, anonymous/unauthorized/stale-session analytics access, non-disclosure and retention limits, telemetry failure, hardcoded-port rejection, concurrent restart requests, cleanup, readiness, and production absence at the layer where each contract is enforced.
10. **Validate and report by mode** — Run the plan-locked heavy tier, repeat runtime-sensitive checks without manual cleanup, classify any failures under Failure Gate, and report Help, Admin Analytics, and Runtime Safety outcomes separately with skipped gates and remaining configuration decisions.

## Relevant files
- `client/src/pages/help.tsx`
- `client/src/components/HelpMenu.tsx`
- `client/src/pages/settings.tsx`
- `client/src/hooks/use-auth.ts`
- `client/src/lib/storageKeys.ts`
- `server/index.ts`
- `server/routes.ts`
- `server/storage.ts`
- `server/__tests__/routes.test.ts`
- `shared/schema.ts`
- `shared/models/auth.ts`
- `scripts/free-ports.mjs`
- `scripts/port-authority-test.mjs`
- `scripts/serial-lock.mjs`
- `playwright.config.ts`
- `docs/port-authority.md`
- `docs/testing.md`
