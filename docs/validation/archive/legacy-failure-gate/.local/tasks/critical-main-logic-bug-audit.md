# Critical Main Logic Bug Audit

## What & Why
Run the Bug Audit skill in report-only mode against the application’s critical end-to-end logic across authentication/admission, session lifecycle, photo and entry persistence, scan workflows, offline synchronization, realtime collaboration, and export boundaries. The codebase is large, so this focuses on paths whose failure can expose data, lose a user write, create inconsistent shared state, or leave the user unable to complete a core workflow. No product code or behavior is changed; the result is a verified findings report for a later fix decision.

## Done looks like
- `docs/bug-audit-report.md` contains a report-only audit with the scope, detected stack, applicable/skipped gates, Phase 0 tooling signals, and findings sorted by severity.
- The audited journeys cover sign-in and local identity resolution, approval/access enforcement, dashboard session creation and lifecycle, photo upload and entry/pin persistence, scan result persistence, offline queue reconciliation, realtime session updates, and PDF/Excel export initiation and completion.
- Every reported finding includes a file and line, one Bug Audit category, a realistic failure scenario, a concrete recommended fix, and a Critical/High/Medium/Low severity.
- Findings are supported by surrounding code/data-flow evidence or a reproducible existing test/manual trace; grep hits and speculative candidates are recorded only as deferred items.
- The report records typecheck, storage lint, tests, startup/schema checks, browser coverage, and dependency-audit outcomes without treating validation-tool output as a product finding by itself.
- No application source, tests, migrations, configuration, secrets, or external service data are changed.

## Out of scope
- Fixing, hardening, or adding tests for any finding discovered by the audit.
- A whole-repository audit beyond the selected critical end-to-end paths, including UX-only polish, visual/accessibility review, and non-critical admin/reporting surfaces unless they directly affect a critical journey.
- Re-auditing already documented Clerk/session-isolation, admin/realtime, or prior seven-edge-case findings as new defects; use those reports and merged task work as prior evidence and report only regressions or distinct root causes.
- Changing authentication providers, roles, approval semantics, schema, API contracts, deployment/runtime controls, dependencies, secrets, or artifact content.

## Pre-existing failures to ignore
None known at plan time. The active baseline catalog is empty, so every failure observed during task validation must be treated as a potential task failure until the Failure Gate evidence rules establish otherwise.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- Baseline `npm run typecheck` passed before this plan.
- Baseline `npm run lint:storage` passed before this plan.
- The primary backend route/photo-delete baseline passed with 94 tests and 0 failures.
- Baseline `npm audit --audit-level=high` reported 0 vulnerabilities.
- `docs/validation/failure-baseline.json` currently contains no records; these observations do not authorize ignoring later failures.
- Existing UX and Clerk-focused audit reports, plus merged prior bug-audit work, are seed context only. Do not duplicate their confirmed findings without new regression evidence.

## Validation
**Command:** `test-heavy`
**Why:** The selected scope crosses protected browser journeys, API/data writes, offline and realtime behavior, and release-critical boundaries; the heavy registered tier is the lightest tier that supplies startup, dependency, schema, static, backend, collision, and Playwright coverage for an end-to-end audit.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Steps
1. **Establish audit scope and prior evidence** — Confirm the React/Vite, Express, PostgreSQL/Drizzle, Clerk, WebSocket, object-storage, offline-PWA, and export surfaces in scope. Read the existing Clerk, UX, and prior bug-audit reports and nearby merged-task plans so confirmed issues are not relabeled as fresh findings.
2. **Collect Phase 0 signals** — Run the locked validation tier and record typecheck, storage lint, unit/backend tests, startup and schema checks, dependency audit, collision checks, and browser-suite outcomes. Separate harness/environment limitations from product behavior and preserve exact failure evidence.
3. **Trace critical authentication and authorization journeys** — Follow sign-in bootstrap, local identity mapping, approval/rejection, protected routing, session access checks, resource ownership, and WebSocket authorization across server middleware, client auth state, and browser transitions. Prioritize security findings and verify each candidate against both sides of the boundary.
4. **Trace critical data-write journeys** — Follow dashboard session creation/lifecycle, photo upload and serving, pin/entry saves, scan persistence, optimistic updates, retries, transactions, locking, and error responses through the client mutations, API routes, storage layer, and schema. Check for data loss, duplication, stale state, silent failures, and mismatched response contracts.
5. **Trace offline, realtime, and export completion paths** — Inspect IndexedDB queue identity/reconciliation, reconnect and WebSocket room state, cross-tab/session transitions, and PDF/Excel job polling/download behavior. Use existing focused browser tests and manual code/data-flow traces to verify races, cleanup, retries, and terminal failure handling rather than reporting heuristics.
6. **Run the ten Bug Audit category passes** — Apply null/undefined, async/timing, error handling, type safety, state/data integrity, security, performance, concurrency/shared state, dead/unreachable code, and dependency-hygiene checks to the scoped surfaces. Read surrounding context for every candidate, record only verified issues, and list unverified candidates under deferred scope.
7. **Write the report-only findings** — Create or update `docs/bug-audit-report.md` from the bundled template with a severity summary, one complete five-field block per finding, tooling signals, prior-evidence references, skipped gates, manual-QA limitations, and explicit recommended remediation order. Do not modify product code, tests, configuration, migrations, or dependencies.
8. **Complete the handoff** — Confirm the report is internally consistent, findings are sorted by severity, line references resolve, no code changes were made, and the final response asks which findings should be addressed in a separate approved fix task.

## Relevant files
- `server/routes.ts`
- `server/storage.ts`
- `server/realtime-authorization.ts`
- `server/websocket-upgrade.ts`
- `server/index.ts`
- `shared/schema.ts`
- `shared/auth-routing.ts`
- `shared/clerk-config.ts`
- `client/src/App.tsx`
- `client/src/hooks/use-auth.ts`
- `client/src/hooks/use-websocket.ts`
- `client/src/lib/queryClient.ts`
- `client/src/lib/offlineQueue.ts`
- `client/src/lib/offlineEntryCreate.ts`
- `client/src/hooks/use-upload.ts`
- `client/src/pages/dashboard.tsx`
- `client/src/pages/session.tsx`
- `client/src/pages/session/PhotoMode.tsx`
- `client/src/pages/session/LabelScannerTab.tsx`
- `client/src/pages/session/EntryTable.tsx`
- `client/src/pages/session/FinalResultsTab.tsx`
- `tests/fixtures.ts`
- `tests/global-setup.ts`
- `tests/photo-upload.spec.ts`
- `tests/scan-parity.spec.ts`
- `tests/offline-queue.spec.ts`
- `tests/export.spec.ts`
- `tests/session-cleanup.spec.ts`
- `docs/ux-audit-report.md`
- `docs/clerk-entry-identity-audit-report.md`
- `docs/clerk-session-isolation-audit-report.md`
- `docs/clerk-admin-realtime-audit-report.md`
- `.local/custom_skills/bug-audit/report-template.md`

## Regression Guard
**N/A**
**Why N/A:** This report-only audit changes no product behavior, error path, data flow, lifecycle, or existing contract, so there is no regression surface to guard in this task.
