# Core Session UX Audit Report

**Mode:** Report-only  
**Scope:** Core session workflow only  
**Audit date:** 2026-09-08  
**Validation ceiling:** `test-heavy`  
**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 0 |

The core session workspace loads and its primary navigation, persistence, undo/redo, and export paths are covered by live browser evidence and the existing heavy validation tier. One reproducible edit failure blocks a common entry-editing path and is documented below. This report stops before any fix loop.

## Phase 0 — Discovery, scope, and app map

### Detected stack and gates

- **Frontend:** React + TypeScript with Vite.
- **Routing:** Wouter routes, including `/session/:id`.
- **Client state/data:** TanStack Query, React state, localStorage, sessionStorage where applicable, IndexedDB for offline entry/photo queues.
- **Backend:** Express API backed by PostgreSQL (`backend: true`).
- **Authentication:** Clerk plus development-only owner login used by the existing Playwright setup (`auth: true`).
- **Realtime:** WebSocket session synchronization, reconnect state, presence, and cache invalidation.
- **Multiple modes:** Photos Reel, Reel IDs, Flagged, Review, and Final Results (`multi-tool: true`).
- **Interactions:** Keyboard undo/redo, modal/dialog controls, file/photo upload, and responsive/mobile capture (`interactions: true`).

### Route/view inventory

The detected application routes are `/`, `/tester-login`, `/session/:id`, `/settings`, `/stats`, `/join/:token`, `/help`, sign-in/sign-up, and the not-found route. This audit selected only `/session/:id`; authentication and the dashboard are used only to enter or exit that journey.

### Selected core journeys

Each journey is intentionally 5–15 steps and is limited to session work:

1. **Open and orient in a session**
   1. Enter a seeded owner session URL.
   2. Wait for session name, progress state, and workspace controls.
   3. Confirm the initial mode and entry/photo content.
   4. Switch through Photos Reel, Reel IDs, Flagged, Review, and Final Results.
   5. Confirm each mode exposes an informative empty, loading, or populated state.
   6. Return to the primary entry view.

2. **Create and edit an entry**
   1. Open a clean session.
   2. Open the entry form.
   3. Enter aisle, section, catalog, footage, and manufacturer values.
   4. Save the entry and observe completion feedback.
   5. Expand the relevant entry section.
   6. Open the entry editor.
   7. Change a field and save.
   8. Confirm the updated value is visible and server-persisted.

3. **Persist session state**
   1. Open a session with an entry.
   2. Select a non-default mode.
   3. Reload the page.
   4. Confirm the selected mode remains active.
   5. Navigate away and return to the session.
   6. Open the same session in a second tab.
   7. Compare the visible mode and entry data.

4. **Recover from failure and offline state**
   1. Start an entry/photo operation.
   2. Exercise validation boundaries.
   3. Inspect API mutation error paths.
   4. Inspect offline queue behavior and visible pending indicators.
   5. Inspect WebSocket reconnect and retry feedback.
   6. Confirm retry, cancel, and dismissal paths are present where applicable.

5. **Delete, undo, and redo**
   1. Open a session containing an entry or pin.
   2. Delete the item.
   3. Confirm immediate removal and the undo affordance.
   4. Undo the deletion.
   5. Confirm the restored item is visible and persisted.
   6. Exercise redo/keyboard undo paths in the existing coverage.

6. **Export session results**
   1. Open a session with session data.
   2. Open the Export menu.
   3. Start an Excel export.
   4. Confirm a non-empty workbook download.
   5. Start a PDF export.
   6. Confirm a non-empty PDF download and inspect the in-app error/offline branches.

### Persistent state inventoried for this scope

- Last opened session.
- Active session tab/mode.
- PDF export quality.
- Undo and redo stacks per session.
- Review position/state.
- Incomplete-entry and photo-note dismissal state.
- IndexedDB offline entry/photo queues.
- Server-backed session, entry, photo, pin, review-response, and settings data.

### Prior audit reports

No prior tracked UX or bug audit report was found in the repository root or `docs/` before this report was created. The `.local/tasks/` planning files are task instructions, not prior audit findings.

## Evidence and validation baseline

The configured `test-heavy` validation tier completed successfully:

- startup smoke, security audit, schema check, workspace skill contract, typecheck, storage lint, unit tests, serial-lock tests, port-authority tests, manifest parity, and collision smoke all passed;
- Playwright ran 21 tests using one worker: **17 passed, 4 skipped**;
- no active records were present in `docs/validation/failure-baseline.json`, so no failure was classified as pre-existing.

The existing Playwright suite supplied live coverage for:

- entry and pin undo;
- Excel and PDF export downloads;
- review-position reload persistence;
- mobile offline pending-count and WebSocket reconnect indicators;
- session state cleanup;
- scan and session navigation behavior.

An additional authenticated owner browser sweep verified:

- all five session tabs were present and selectable;
- Flagged and Final Results rendered informative empty states;
- Review rendered its heading and session content;
- the selected Final Results tab persisted after reload;
- the same selected mode and session data were available in a second tab;
- the mobile 390px viewport had no document-level horizontal overflow and retained the tab controls;
- the relevant table exposed an overflow container for narrow layouts.

The live edit sweep reproduced the finding below with a real API response and unchanged server data.

## Phase results

### Phase 1 — Happy-path sweep

**Completed.** Session loading, mode navigation, clean/empty states, export controls, undo affordances, and mobile indicators were exercised through the existing browser suite and focused owner sweep. Entry creation was covered by existing fixtures and browser journeys. The edit branch exposed F-001.

### Phase 2 — State and persistence

**Completed.** The active mode survived reload and was observed in a second tab. Session data was fetched on deep load. Local storage reads are applied to the active mode, PDF quality, and undo/redo state. WebSocket/session-query refresh paths were inspected for concurrent updates.

### Phase 3 — Silent failure hunt

**Completed; backend checks applicable.** Mutation handlers were inspected for user-facing error paths, offline queue handling, reconnect feedback, and optimistic undo rollback. F-001 is the confirmed mutation failure. API calls that fail in the inspected review, export, and entry paths generally surface destructive toasts; the edit payload/validator mismatch is the exception.

### Phase 4 — Error and edge cases

**Completed.** Required aisle/section validation, positive-footage validation, unreadable-field confirmation, empty/filter states, file input gates, disabled pending-submit controls, offline queue branches, and high-level long-string/truncation behavior were inspected. Rapid-repeat coverage is code-inspected through mutation pending guards; visual confirmation of physical rapid clicking remains manual QA.

### Phase 5 — Navigation and dead ends

**Completed.** Session tabs and back-to-dashboard controls resolve to existing handlers/routes. Deep-link loading fetches session data on mount. Dialogs use the shared dialog primitives plus explicit cancel/close actions; Escape/backdrop behavior and post-close focus should receive manual visual confirmation rather than being treated as a verified pass.

### Phase 6 — Keyboard, shortcuts, and interaction

**Completed; interaction gate open.** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z registration, input focus guards, and undo/redo handlers were code-inspected. Drag-and-drop is **gated out for this scope because no session drag-and-drop journey was detected**. Clipboard copy/paste is **gated out because no clipboard interaction is used by the selected session workflow**.

### Phase 7 — Tool and mode switching

**Completed; multi-mode gate open.** All five session modes were switched live. Active tab state is conveyed through the selected tab styling and persisted per session. Cross-mode entry/photo navigation and mode-specific empty states were inspected. No drag-gesture tool-switch path applies.

### Phase 8 — Settings and preferences

**Completed for session-affecting preferences.** Active session mode, PDF export quality, unit display, review state, and session-local dismissal state were traced from storage read through UI application. The standalone settings/admin surface is out of scope except where its values affect this session workspace.

### Phase 9 — Auth and session

**Completed for session entry/exit gates.** The authenticated owner setup loaded the protected session route and API calls. Protected session data was not exposed without the authenticated cookie in the focused sweep. Clerk internals, provider behavior, and the separate authentication journey are out of scope; token-expiry and reauthentication visual confirmation is **[MANUAL QA NEEDED]**.

### Phase 10 — UI feedback and polish

**Completed.** Loading/disabled states, save/export/reconnect indicators, destructive toasts, empty states, visible active tabs, and error copy were inspected. The generic edit failure toast is part of F-001 because it accompanies a blocked save; it is not a separate duplicate finding.

### Phase 11 — Data lifecycle

**Completed; backend, undo, and export gates open.** Create/read/update/delete paths were inspected and live create/read, delete/undo, Excel export, PDF export, and review persistence were covered by the browser evidence. The edit update path fails for the normal blank-optional-field case as F-001. Session export has no matching session-import operation, so exact export/import round-trip verification is **gated out: no supported session import exists**. Inventory comparison upload is a separate results feature, not a session export round trip.

### Phase 12 — Cross-context

**Completed with manual visual boundaries.** First-run/empty states, mobile width, second-tab loading, WebSocket refresh behavior, long session-name truncation, and unbounded entry rendering were inspected. Browser zoom at 75%/150%, physical visual clipping at tablet width, screen-reader semantics, and rapid input are **[MANUAL QA NEEDED]** because the available automated evidence does not establish visual fidelity for those checks. The focused 390px DOM check found no document-level horizontal overflow.

### Phase 13 — Triage and stop point

**Report-only triage completed.** Findings were de-duplicated, assigned sequential IDs, sorted by severity, and given concrete fix locations. No fix loop, product-code edit, test edit, or behavior change was performed.

## Findings

### F-001

- **ID:** F-001
- **Journey:** 2 — Create and edit an entry
- **Phase:** Phase 3 — Silent failure hunt; also confirmed in Phase 11 — Data lifecycle
- **Severity:** High
- **Failure:** When a user opens a normal entry whose optional Reel Tag, Wire Type, and Gauge fields are blank, changes a value such as Notes, and presses **Update**, the save fails with HTTP 400. The edit dialog remains open, the server keeps the old value, and the user receives only a generic “Failed to save entry” toast. A user cannot complete a common entry-editing journey without first entering unrelated optional values. The same root cause is not reported again as a separate finding in Phase 11.
- **Fix:** Align the edit payload and PATCH contract. In `client/src/pages/session/SingleEntryMode.tsx` (`saveEntry`), omit blank optional string properties or send values accepted by the contract; alternatively, update `server/routes.ts` (`patchEntrySchema`) to accept nullable optional string fields consistently with the edit form. Add an actionable validation/error description and keep the dialog state explicit after a rejected save. Verify that editing only Notes on an entry with blank optional fields persists after reload.
- **Evidence:** Authenticated owner browser sweep on 2026-09-08 created entry `UX-EDIT`, opened its editor, changed Notes, and observed `PATCH /api/entries/:id` → `400` with `{"reelTag":["Expected string, received null"],"wireType":["Expected string, received null"],"gauge":["Expected string, received null"]}`. The subsequent GET returned the original empty Notes value. This is reproducible against the local app; the IDs are ephemeral and intentionally not part of the tracked report.

## Blocked and manual-QA checks

These are not counted as confirmed product findings:

- **[MANUAL QA NEEDED]** Verify dialog focus returns to its trigger after Escape, backdrop dismissal, and explicit close on desktop and mobile.
- **[MANUAL QA NEEDED]** Verify browser zoom at 75% and 150% does not clip tab labels, entry controls, dialogs, or export menus.
- **[MANUAL QA NEEDED]** Visually inspect 375px, 768px, and 1280px layouts for clipping/overlap beyond the automated 390px no-overflow check.
- **[MANUAL QA NEEDED]** Verify rapid double-clicks and rapid touch submissions with physical input; code inspection found pending guards on the primary save/delete/review mutations.
- **[MANUAL QA NEEDED]** Verify browser offline/online transitions with DevTools network controls, including queued entry/photo replay and reconnect messaging.
- **[MANUAL QA NEEDED]** Verify auth expiry and reauthentication messaging; managed Clerk behavior is out of scope.
- **Gated out:** session drag-and-drop, clipboard copy/paste, and session export/import round trip are not supported journeys in the selected scope.

## Report-only stop

This audit intentionally stops here. No findings were fixed, no product behavior was modified, and no new automated regression test was added. F-001 is the recommended first follow-up because it blocks ordinary entry editing; the manual-QA items should be verified before any fix is released.

---

# Clerk Approval and Protected-Route UX Audit

**Mode:** Report-only
**Scope:** Admission status and protected-route behavior after Clerk identity exists
**Audit date:** 2026-09-09
**Validation ceiling:** `test-heavy`
**Product behavior changed:** No
**Finding ID continuity:** The earlier core-session audit above owns F-001. This approval audit continues with F-002.

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 0 |

The server has a consistent approval boundary for `/api/*` requests, plus explicit approval checks on the private upload/object boundary. Pending and rejected local users receive an explanatory, sign-out-capable screen. The audit found two high-impact admission-transition/identity-state UX failures and three medium-impact stale or lost-navigation states. No confirmed fresh-data API bypass was found: unauthenticated requests are rejected with 401, and pending, rejected, or revoked identities are rejected with 403 `pending_approval` on the protected API path.

The audit remains report-only. No approval state, route, test, or product behavior was changed.

## Phase 0 — Discovery, scope, and app map

### Detected stack and gates

- **Frontend:** React + TypeScript with Wouter routing.
- **Backend:** Express API backed by PostgreSQL (`backend: true`).
- **Authentication:** Clerk identity resolution with a separate development tester session (`auth: true`).
- **Admission:** Local `users.approved` and `users.rejected` status, independent of session collaboration roles (`owner`, `editor`, `viewer`).
- **Protected API boundary:** Global `/api` middleware runs `isAuthenticated` and then `isApproved`, except for an explicit public skip list.
- **Private file boundary:** `/uploads/:filename` and `/objects/{*objectPath}` have explicit authentication/approval and resource-scope checks.
- **Multiple application routes:** Dashboard, session, settings, stats, join, and help are all selected by the client auth router.
- **Interaction scope:** No approval-specific drag-and-drop, clipboard, or keyboard journey was detected; those gates are skipped for this audit.

### Client route inventory

| Route | Signed out | Signed in, missing local user | Pending | Rejected | Approved/tester |
|---|---|---|---|---|---|
| `/` | `Landing` | denial/pending branch | `PendingApproval` | rejected `PendingApproval` | `Dashboard` |
| `/session/:id` | `Landing` | denial/pending branch | `PendingApproval` | rejected `PendingApproval` | `SessionPage` |
| `/settings` | `Landing` | denial/pending branch | `PendingApproval` | rejected `PendingApproval` | `SettingsPage` |
| `/stats` | `Landing` | denial/pending branch | `PendingApproval` | rejected `PendingApproval` | `StatsPage` |
| `/join/:token` | `Landing` | denial/pending branch | `PendingApproval` | rejected `PendingApproval` | `JoinPage` |
| `/help` | `Landing` | denial/pending branch | `PendingApproval` | rejected `PendingApproval` | `HelpPage` |
| `/sign-in/*?`, `/sign-up/*?` | Clerk widget | Clerk widget | Clerk widget | Clerk widget | Clerk widget |
| `/tester-login` | tester login | tester login | tester login | tester login | tester login |

The protected-route guard is in `client/src/App.tsx`. The local admission request is `GET /api/auth/user` in `client/src/hooks/use-auth.ts`; its response is cached by TanStack Query and is used to select the route outcome.

### Selected admission and protected-route journeys

1. **First pending arrival:** Sign in with a Clerk identity that has a local row with `approved=false, rejected=false`; load `/` or a protected deep link; read the waiting explanation; sign out.
2. **Pending to approved:** Remain on the waiting screen while an owner changes approval; observe whether the client transitions to the protected route without an unannounced reload or focus change.
3. **Rejection:** Load as a local rejected identity; confirm the rejection explanation, sign-out escape, and protected API denial.
4. **Revocation during an active session:** Load protected content as approved; revoke approval in another context; continue reading, navigating, and making requests from the original tab.
5. **Unauthenticated protected deep link:** Open `/session/:id`, `/settings`, `/stats`, `/join/:token`, or `/help` without a session; sign in from the resulting public page; check whether the original destination is retained.
6. **Approved protected access:** Load dashboard/session/settings/stats/help and representative reads/writes as an approved owner, approved collaborator, or tester-compatible identity; separately verify session collaboration roles do not replace account admission.

## Evidence and validation baseline

### Code and route evidence

- `client/src/App.tsx` waits for `useAuth()` loading, sends signed-out users to `Landing` on protected routes, sends `user.approved || user.isTester` users to the requested page, and sends pending users to `PendingApproval`.
- `client/src/App.tsx` checks `user?.rejected` before route selection and uses the rejected variant of `PendingApproval`.
- `client/src/hooks/use-auth.ts` treats a signed-in Clerk identity with no truthy local response as `accessDenied`, but `server/replit_integrations/auth/routes.ts` currently serializes an absent database user as a successful empty JSON object. The resulting truthy client object follows the pending branch instead of the intended denial branch.
- `client/src/pages/pending-approval.tsx` provides explanatory pending/rejected copy and a Sign Out button, but no status-check action or polling interval.
- `server/routes.ts` installs the global approval middleware before application API route registration. The skip list is limited to `/api/auth/user`, tester login/logout, test-only setup endpoints, pageview tracking, and health checks. Non-skipped `/api/*` traffic runs authentication and then approval.
- `server/replit_integrations/auth/routes.ts` returns 401 when the request has no normalized subject and 403 `{ "message": "pending_approval" }` when the local admission lookup is absent, pending, or rejected. Owners and testers are explicitly admitted.
- `server/routes.ts` separately protects `/uploads/:filename`; `server/replit_integrations/object_storage/routes.ts` protects `/objects/{*objectPath}` and redirects only the authorized uploads namespace to the scoped file route.
- `shared/models/auth.ts` confirms admission (`approved`, `rejected`) is stored independently from collaboration membership and role data.
- `tests/release/managed-clerk-auth.spec.ts` supplies approved managed-Clerk navigation evidence for `/`, `/settings`, and `/stats`, and verifies the local approved record after sign-in. It does not exercise pending, rejected, revoked, missing-local-user, or protected-deep-link return journeys.
- `server/__tests__/routes.test.ts` verifies owner/tester admission, pending/rejected WebSocket denial, pending/rejected protected middleware denial, approved collaborator admission, and the approval middleware order on the object route. It does not verify client route rendering or live browser transitions.

### Required validation result

`test-heavy` was invoked exactly through the task plan lock. It stopped at the first step, `security-audit`, before typecheck, backend tests, or Playwright:

```text
npm audit --audit-level=high
2 high severity vulnerabilities
multer <=2.2.0
sharp <0.35.4
```

The same audit command failed with the same two advisories on three isolated retries. The task changed no dependency manifest or lockfile. This is classified as **pre-existing for this task** using two-factor evidence: the task-relevant dependency inputs were untouched, and `.agents/memory/failure-gate-validation.md` documents unchanged dependency-audit failures as a validation stop condition. The failure is not counted as an approval UX finding, and the validation tier was not weakened or escalated.

## Phase results

### Phase 1 — Happy-path admission and protected navigation

**Completed by code inspection and existing evidence.** Approved owner/tester-compatible route selection and representative approved navigation are covered. Pending and rejected screens have explanatory copy and an explicit sign-out escape. The managed-Clerk release test does not cover non-approved outcomes. F-002, F-003, and F-004 describe reachable transition/deep-link failures found in the route and state flow.

### Phase 2 — State and persistence

**Completed by code inspection.** The admission decision comes from the `/api/auth/user` query keyed by Clerk identity and is refetched on mount; normal query settings refetch on window focus. There is no approval-status polling, event subscription, or explicit status-check control on the waiting screen. Existing page query data is not centrally cleared when approval changes from approved to revoked. F-004 covers the pending-transition gap and F-003 covers stale active-session state.

### Phase 3 — Silent failure hunt

**Completed; backend checks applicable.** The global middleware prevents protected API reads and writes from bypassing admission. A protected request from a pending, rejected, or revoked identity receives 403, while no normalized identity receives 401. The client has no global handling for a later 403 approval response, so mounted pages can remain visible while individual requests fail; this is F-003, not a separate finding per endpoint. Missing-local-user and local-user-fetch errors are represented ambiguously in the client as F-002 and F-005.

### Phase 4 — Error and edge cases

**Completed by inspection.** The combinations `approved=false/rejected=false` (pending), `approved=false/rejected=true` (rejected), and `approved=true/rejected=true` (client rejection branch; server rejection) are separated in the intended path. An absent local row is not separated reliably because `/api/auth/user` returns an empty successful object. A server error from that same request also falls into the signed-in denial path when no prior local data exists. These are F-002 and F-005.

### Phase 5 — Navigation and deep links

**Completed by inspection.** Every listed protected route has an explicit client branch and every representative API has a server route. Signed-out protected deep links fall back to `Landing`; the sign-in link points only to `/sign-in` and does not preserve the original pathname/query/token. This is F-005. Pending/rejected users can escape only through Sign Out, and approved session errors have page-local retry/back controls.

### Phase 6 — Keyboard, shortcuts, and interaction

**Skipped by gate.** No approval-specific shortcut, drag-and-drop, or clipboard journey applies. General application interaction coverage belongs to the separate core-session audit.

### Phase 7 — Tool and mode switching

**Skipped by gate.** The routes under audit are pages, not an approval-specific multi-tool surface. Session modes are covered by the separate core-session audit.

### Phase 8 — Settings and preferences

**Gated to route admission only.** The `/settings` page is confirmed as a protected route. Its preference controls are outside this approval/status audit and are not re-audited here.

### Phase 9 — Auth and session

**Completed for admission and protected-route boundaries; Clerk widget internals and logout are out of scope.** The route guard does not render protected content while its local-user query is loading. Server approval is checked independently of client route selection. Active revocation does not centrally invalidate already mounted protected UI; see F-003. Token refresh, logout, identity switching, and Clerk proxy behavior are intentionally excluded.

### Phase 10 — UI feedback and denial polish

**Completed by inspection.** Loading has a visible spinner, pending and rejected states have headings, explanatory copy, and Sign Out. The missing-local-user and fetch-error paths do not give a specific recovery explanation because they are conflated with pending/denied state (F-002 and F-005). No blank protected page was confirmed in the normal loading/error branches.

### Phase 11 — Data lifecycle

**Gated to authorization boundaries.** No admission record is created or mutated by the client route audit. Protected read/write representatives and the private object route use the global/explicit approval gate. Fresh API data exposure through the tested middleware path was not found. In-memory data already displayed before revocation is the stale-state concern in F-003.

### Phase 12 — Cross-context

**Completed with manual visual boundaries.** Direct navigation, back/refresh implications, local query cache behavior, and server/client status combinations were inspected. Browser accessibility announcements, multi-tab timing, live approval changes, and exact sign-in return behavior require manual QA listed below.

### Phase 13 — Triage and stop point

**Report-only triage completed.** Findings are de-duplicated, sorted by severity, assigned concrete fix locations, and separated from manual-QA items. No fix loop, route edit, test edit, approval-state change, or product behavior change was performed.

## Findings

### F-002

- **ID:** F-002
- **Journey:** 6 — Approved protected access / missing local admission record
- **Phase:** Phase 1 — Happy-path admission and protected navigation; Phase 4 — Error and edge cases
- **Severity:** High
- **Failure:** A signed-in Clerk identity with no local `users` row is not reliably shown an access-denied state. `GET /api/auth/user` returns a successful empty object when the database lookup is absent; the client treats that object as a user, routes to the pending screen, and tells the person their account is awaiting approval. The protected API boundary correctly returns 403 `pending_approval`, so the visible explanation does not match the server decision and provides no clear path to have the missing account provisioned or to retry.
- **Fix:** In `server/replit_integrations/auth/routes.ts` (`GET /api/auth/user`), return a distinct not-provisioned response for an absent local user, or return a complete explicit admission state that the client can distinguish from pending. In `client/src/hooks/use-auth.ts` and `client/src/App.tsx`, map that state to a specific, escapable “account is not provisioned/authorized” view rather than `PendingApproval`; preserve the pending branch only for an existing row with `approved=false, rejected=false`.
- **Evidence:** `registerAuthRoutes` spreads `dbUser` into a 200 JSON response without an absent-user branch. `useAuth` therefore receives a truthy object, while `isIdentityApproved` and `isApproved` look up the same subject and deny it. The route guard's intended `accessDenied` branch only runs when `localUser` is falsy, which this response shape prevents.

### F-003

- **ID:** F-003
- **Journey:** 4 — Revocation during an active session
- **Phase:** Phase 2 — State and persistence; Phase 3 — Silent failure hunt; Phase 9 — Auth and session
- **Severity:** High
- **Failure:** When an approved user's admission is revoked while a protected page is already open, the client continues rendering the mounted dashboard/session/settings/stats/help content from the approved local-user state and existing query cache. New protected API requests are rejected with 403 `pending_approval`, but there is no global 403-to-admission transition that clears protected query data or replaces the route with a rejection explanation. The user can therefore see stale protected content while controls and refreshes fail, and the audit cannot claim a clean revocation experience. The server gate prevents newly fetched protected data; this finding is a stale active-session exposure/UX failure, not a confirmed API bypass.
- **Fix:** Add one centralized client response/auth-status boundary that, on a protected 403 `pending_approval`, invalidates or clears protected query state, refetches `/api/auth/user`, and moves the app to the correct pending/rejected/not-provisioned screen. Ensure mounted page data is not rendered after the admission transition and provide an explanatory, sign-out-capable message. Cover both query and mutation requests rather than adding endpoint-specific checks.
- **Evidence:** `AuthRouter` selects protected pages from the cached `localUser`; `useAuth` has no polling or server push for approval changes; `queryClient.ts` throws on all non-OK responses without a central admission-status handler. The global middleware returns 403 for the revoked status, while route components remain mounted until a separate navigation or query error changes them.

### F-004

- **ID:** F-004
- **Journey:** 2 — Pending to approved
- **Phase:** Phase 2 — State and persistence; Phase 12 — Cross-context
- **Severity:** Medium
- **Failure:** A pending user who remains on the waiting screen has no explicit “Check approval status” action and no polling interval. If an owner approves or rejects the account while that page remains focused, the user continues seeing the old waiting message until a reload or a refetch-triggering focus/navigation event occurs. The only visible action on the screen is Sign Out, so the approval transition is not timely or discoverable.
- **Fix:** In `client/src/pages/pending-approval.tsx` and `client/src/hooks/use-auth.ts`, add an explicit status refresh affordance with pending/loading feedback, or introduce a bounded approval-status refetch interval while the waiting screen is mounted. Stop the refresh when the route leaves the admission state and render the resulting approved/rejected outcome without requiring a full reload.
- **Evidence:** The pending component renders only its explanatory content and Sign Out button. The auth query has `refetchOnMount: "always"` and the shared default `refetchOnWindowFocus: true`, but `refetchInterval: false`; there is no pending-screen refetch button or timer.

### F-005

- **ID:** F-005
- **Journey:** 5 — Unauthenticated protected deep link
- **Phase:** Phase 5 — Navigation and deep links
- **Severity:** Medium
- **Failure:** Opening `/session/:id`, `/settings`, `/stats`, `/join/:token`, or `/help` while signed out renders the public landing page rather than an authentication prompt tied to the requested destination. The Sign In button links only to `/sign-in`, so after sign-in the original session ID, invite token, or page intent is lost and the user must reconstruct the destination manually.
- **Fix:** In `client/src/App.tsx`, preserve the attempted pathname/query in a safe return parameter when a signed-out user hits a protected route, or render a route-aware sign-in action that stores and validates the intended destination after authentication. Restore only internal application paths and retain the existing pending/rejected behavior for identities that are already signed in.
- **Evidence:** Each protected route branch uses `: Landing` when `user` is absent. `client/src/pages/landing.tsx` hardcodes the primary action to `${basePath}/sign-in`; no return URL is derived from `useLocation`, and no post-sign-in protected-route restoration is present in the inspected auth router.

### F-006

- **ID:** F-006
- **Journey:** 1 — First pending arrival / local admission lookup
- **Phase:** Phase 3 — Silent failure hunt; Phase 10 — UI feedback and denial polish
- **Severity:** Medium
- **Failure:** If the signed-in Clerk identity's `/api/auth/user` request fails with a transient 5xx or network error before a local user object exists, the client has no retry or service-error state. `useAuth` finishes loading with no `localUser`, `accessDenied` becomes true, and `AuthRouter` renders the same “Access Denied” rejection screen used for a genuine unauthorized identity. A temporary backend problem is therefore presented as a terminal admission decision with only Sign Out available.
- **Fix:** Expose the local-user query error from `client/src/hooks/use-auth.ts` and give `client/src/App.tsx` a distinct retryable authentication-service error state. Keep a missing local record separate from a failed lookup, provide a Retry action with loading feedback, and do not label an unavailable authorization lookup as rejected.
- **Evidence:** `fetchUser` throws for every non-401 response; `useAuth` derives `accessDenied` from signed-in Clerk state plus falsy `localUser` after loading, without checking the query error. `AuthRouter` maps `accessDenied` to `<PendingApproval status="rejected" />`, whose only action is Sign Out.

## Protected API coverage matrix

| Boundary | Unauthenticated | Pending | Rejected | Revoked (`approved=false`) | Approved owner/collaborator |
|---|---|---|---|---|---|
| Non-skipped `/api/*` read/write | 401 `Unauthorized` from `isAuthenticated` | 403 `pending_approval` | 403 `pending_approval` | 403 `pending_approval` | Global approval passes; route/resource authorization applies |
| `GET /api/auth/user` | Explicit auth handler returns 401 | 200 local user with pending fields | 200 local user with rejected fields | 200 local user with revoked fields | 200 approved local user |
| `GET /uploads/:filename` | 401 | 403 before resource lookup | 403 before resource lookup | 403 before resource lookup | Approval plus session/avatar/logo scope checks |
| `GET /objects/{*objectPath}` | 401 | 403 | 403 | 403 | Approval, namespace validation, then redirect to scoped upload route |
| `/api/admin/*` | 401 | 403 before owner boundary | 403 before owner boundary | 403 before owner boundary | Approval then `ownerOnly`; owner identity is separate from collaboration role |

The matrix shows consistent server denial for the sampled protected boundaries. It also shows why the client must interpret admission changes centrally: the same 403 payload is used for pending, rejected, and revoked statuses, while the client’s visible copy depends on local state.

## Blocked and manual-QA checks

These are not counted as confirmed product findings:

- **[MANUAL QA NEEDED]** Create a pending local user, leave the waiting page focused, approve and reject that user from a separate owner context, and observe whether the UI changes without reload or focus change.
- **[MANUAL QA NEEDED]** Load protected content as approved, revoke approval in another context, and verify whether old dashboard/session data remains visible, whether mutations show a useful denial, and whether the page transitions to the correct rejection state.
- **[MANUAL QA NEEDED]** Exercise a signed-out `/session/:id` and `/join/:token` deep link through the real Clerk sign-in flow and verify whether a destination can be restored safely.
- **[MANUAL QA NEEDED]** Simulate a transient 500/network failure for `/api/auth/user` and compare the visible result with a genuinely unprovisioned Clerk identity; the code paths currently converge on a denial-like outcome when no prior local data exists.
- **[MANUAL QA NEEDED]** Verify screen-reader announcements for the loading spinner, pending heading, rejection heading, and API-denial transition.
- **Gated out:** Clerk sign-in/sign-up widget and proxy internals, logout, session expiry, identity switching, offline caches, realtime socket lifecycle, role migration, tester removal, approval-state mutation UI, and general session tools are covered by other tasks or audits.

## Report-only stop

This approval/route audit intentionally stops before fixes. No findings were fixed, no approval state was changed, no product route or API behavior was modified, and no new automated regression test was added. Recommended priority is F-003 first because revocation needs a single consistent client boundary, followed by F-002 for missing-account clarity, F-004 for timely approval transitions, F-006 for retryable auth-service failures, and F-005 for protected deep-link completion.