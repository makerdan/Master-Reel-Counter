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

---

# Remaining Application-Surface UX Audit

**Mode:** Report-only
**Scope:** Dashboard, session organization, settings/preferences, owner panels, statistics, help/Ask AI, invitation joining, and logout/offline cross-context behavior
**Audit date:** 2026-09-15
**Validation ceiling:** `test-heavy`
**Product behavior changed:** No
**Finding ID continuity:** F-001 belongs to the core-session audit; F-002 through F-006 belong to the Clerk approval audit. This section continues with F-007.

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 5 |
| Low | 2 |

The remaining application surfaces have working primary routes, loading states, and several live browser journeys. The audit found one high-impact cross-context privacy failure, five medium-severity failures, and two low-severity failures in search, statistics, invitations, and settings recovery. Existing core-session and Clerk findings were used as seed context and were not reported again.

The report remains report-only. The consolidation groups below are recommendations only; no implementation task was created, no product behavior was changed, and no fix loop was entered.

## Phase 0 — Discovery, scope, and app map

### Detected stack and gates

- **Frontend:** React + TypeScript with Vite.
- **Routing:** Wouter routes for `/`, `/settings`, `/stats`, `/help`, `/join/:token`, and `/session/:id`.
- **Client state/data:** TanStack Query, React state, identity-scoped local/session storage, IndexedDB offline queues, and module state for the help chat.
- **Backend:** Express with PostgreSQL-backed session, settings, statistics, invitation, feedback, catalog, and support endpoints.
- **Authentication/admission:** Clerk plus the local approved-user boundary. Clerk widget internals, admission provisioning, approval transitions, and protected-route internals are seed context from the preceding section and are not re-audited here.
- **Interactions:** Dialogs, dropdowns, tabs, accordion help content, streaming Ask AI, file uploads, bulk actions, pagination, offline logout guard, and responsive layouts.

### Route and control inventory

| Surface | Relevant controls and state |
|---|---|
| Dashboard | New/rename/duplicate/reset session, folders and nested folders, move/reorder, trash restore/permanent delete, bulk actions, search-inside, filters, recent searches, sort, load-more, export, help, stats, settings, logout |
| Settings | Profile/photo, theme, text size, larger touch targets, timezone, units, encoding, photo/export preferences, feedback, help replay, wire catalogs, storage, owner/admin panels |
| Statistics | Overview, averages, streaks, weekly activity, catalog/vendor/wire breakdowns, quality, scanner, photo insights, shared performance, back navigation |
| Help | Search, accordion sections, feedback, Ask AI streaming, clear chat, suggested prompts |
| Invitation | Loading, invalid/expired/already-member/success branches, dashboard/session navigation |
| Cross-context | Identity-scoped dashboard storage, help-chat module state, offline queue count, logout guard, reload/deep navigation |

### Selected journeys

1. **Dashboard and session organization:** Load the dashboard, create and rename a session, duplicate it, reset or mark it complete, move it between root/nested folders, reorder folders, and navigate to the session.
2. **Search/filter/sort persistence:** Search by name/location and entry fields, apply status/collaborator/wire/date/footage filters, select recent searches, change sort field/direction, load more results, navigate away, and reload.
3. **Folders and trash:** Create/rename/nest a folder, move a session, open Trash, restore a session, permanently delete a session, and verify empty/list states.
4. **Settings and preferences:** Change theme, text size, touch targets, timezone, units, photo/export preferences, profile photo/name, encoding, feedback, catalog entries, and storage display; reload and compare visible behavior.
5. **Owner panels:** Open the owner tab, inspect account management, approval counts, storage, integrity, crash, AI, page-view, PDF-job, and feedback panels; distinguish loading, denial, retryable failure, and empty states.
6. **Statistics:** Open populated and no-data statistics, inspect summaries/breakdowns/heatmap/shared performance, change display preferences, reload, use back navigation, and inspect error recovery.
7. **Help and Ask AI:** Open the full guide, search an article, expand/navigate accordion sections, submit feedback, send a streamed Ask AI prompt, handle an error, clear the chat, and revisit help after account-context changes.
8. **Invitation joining:** Open a valid invite, already-member invite, invalid/expired invite, and transient-failure branch; inspect loading, success/error copy, retry, back navigation, and session/dashboard actions.
9. **Logout/offline cross-context:** Create pending offline work, invoke logout, inspect the guard and cancel/confirm paths, reload or switch application identity, and verify protected hints and help state are not carried across contexts.

### Persistent state inventoried

- Identity-scoped dashboard search, filter, sort, folder-open, last-session, and recent-search state.
- Global theme and PDF quality preferences.
- Server-backed settings including units, timezone, accessibility, photo/export, encoding, and help-guide completion.
- Server-backed sessions, folders, trash state, wire catalogs, feedback, invitations, and statistics.
- IndexedDB offline photo/entry queues and pending-count indicators.
- `AskAIChat` module-level message state.

### Seed reconciliation

- F-001 was not re-audited; entry editing inside `/session/:id` remains core-session scope.
- F-002 through F-006 were not re-reported; those findings own missing admission records, revocation, pending transitions, protected deep links, and auth-service lookup failures.
- Existing task coverage for Clerk release access, persisted roles, tester paths, and owner account-management policy was treated as out of scope. This section reports only remaining application behavior not represented by those seeds.

## Evidence and validation baseline

### Browser evidence

The available authenticated Playwright environment and existing suite were used where fixtures support the journey:

- `tests/help-guide.spec.ts` supplied live browser evidence for help search, streamed Ask AI success, and Ask AI route-error recovery.
- `tests/folder-expand.spec.ts` supplied live dashboard folder/create-and-move evidence.
- `tests/settings-admin-account-management.spec.ts` supplied live owner loading, retry, and non-owner denial evidence.
- `tests/mobile-layout.spec.ts` and `tests/offline-queue.spec.ts` supplied live responsive, reconnect, pending-count, and logout-guard evidence.

The newly confirmed findings below are primarily supported by current route/component inspection because the existing fixtures do not safely seed every required combination of 50+ sessions, saved non-default unit/timezone preferences, a transient invitation failure, or two distinct authenticated identities in one browser context. Those limitations are recorded as manual-QA or code-inspection boundaries rather than claimed browser passes.

### Required validation result

The mandated command was invoked exactly as specified:

```text
npm run test-heavy
```

The run waited for the shared `validation` serial lock, then completed the non-browser steps successfully through collision smoke. The browser step failed before the application journeys ran because the authenticated Playwright setup could not create its disposable Clerk user:

```text
ClerkAPIResponseError: Unprocessable Entity
tests/global-setup.ts:69 — clerk.users.createUser(...)
[validation] FAIL: browser-tests exited 1 after 9294ms.
```

This is recorded as an environment-limited validation result, not a passing application UX result and not an authorized pre-existing failure: the task-local baseline was empty, the task changed only this report, and the separate release-access work was blocked waiting for input. The tier was not escalated, weakened, or retried with a different command.

The task-local `docs/validation/failure-baseline.json` contained no active records before the run, so no failure was authorized to be ignored at plan time.

### Code and route evidence

- `client/src/pages/dashboard.tsx` loads owned sessions in pages of 50, filters only the accumulated client list against the all-match ID set returned by `/api/search/sessions`, and shows a no-results state before the user can load another page.
- `client/src/pages/dashboard.tsx` returns `emptySearch` for every non-OK search response, so a 500/network/auth failure is represented as a successful zero-match result.
- `client/src/pages/stats.tsx` renders every footage value with a literal `ft` suffix and formats weekly dates with the browser's `toLocaleDateString`, without reading the saved `defaultUnit` or `timezone` settings.
- `client/src/pages/stats.tsx` renders a Back to Dashboard action for `isError` but no retry/refetch action.
- `client/src/pages/join.tsx` maps all mutation errors to one error card with a Dashboard escape; it has no retry action and does not distinguish transient 5xx/network failures from invalid or expired tokens.
- `client/src/pages/settings.tsx` has a storage refresh button but no `isError` branch for `/api/storage/usage`; after loading ends with no data, the storage card has no user-visible failure explanation.
- `client/src/components/HelpMenu.tsx` stores `AskAIChat` messages in the module-level `helpChatState` object. The state is not keyed by `identityId` and is not cleared by logout or an identity transition.

## Phase results

### Phase 1 — Happy-path application sweep

**Completed.** Existing browser coverage verified dashboard folder organization, searchable help, Ask AI success/error rendering, owner account-management loading/retry, mobile layout, pending offline indicators, and logout guard behavior. The remaining dashboard, settings, statistics, and invite routes have explicit primary success/error branches. F-007 through F-014 describe defects in those branches or their cross-context state.

### Phase 2 — State and persistence

**Completed.** Identity-scoped dashboard keys, settings query hydration, help-guide dismissal, offline queue state, and route-local tab state were traced. The search pagination boundary and statistics preference mismatch were confirmed by code. The module-global help chat state is not identity-scoped and is F-007.

### Phase 3 — Silent failure hunt

**Completed; backend checks applicable.** Dashboard mutations generally have success/error toasts, and the help chat has a visible generic recovery message. The search query deliberately converts non-OK responses to an empty result, storage usage has no failed-query branch, and stats/invite failure cards omit retry. These are F-011 through F-014, not duplicates of the Clerk auth-service findings.

### Phase 4 — Error and edge cases

**Completed by code inspection and existing browser error fixtures.** Invalid/expired/already-member invite outcomes, empty/no-data stats, help no-match, Ask AI error, owner denial, dashboard empty states, offline logout guarding, and pagination controls were inspected. Transient invite/network failures, large-session search beyond the first page, and storage-query failure require dedicated seeded browser coverage and are reported with the current code evidence.

### Phase 5 — Navigation and dead ends

**Completed.** Dashboard, settings, stats, help, invite success, invite error, and logout escape routes all have navigation controls. The invitation error branch dead-ends at Dashboard instead of offering a retry, and the stats error branch also exits to Dashboard without retry; see F-012 and F-014.

### Phase 6 — Keyboard, shortcuts, and interaction

**Completed for applicable controls; manual visual gates remain open.** Search Enter behavior, dropdowns, tabs, accordions, dialog controls, Ask AI Enter/send behavior, and disabled mutation states were inspected. Physical rapid clicks, screen-reader focus/announcement, clipboard behavior outside existing session coverage, and drag behavior are not claimed as verified.

### Phase 7 — Tool and mode switching

**Gated out for this scope.** The core session's five tool modes are owned by the preceding core-session report. Remaining surfaces use pages, tabs, accordions, and dashboard controls rather than a second session tool-switch audit.

### Phase 8 — Settings and preferences

**Completed.** Preference controls and save mutations were traced through `/api/settings`; theme, text size, touch target, timezone, and unit controls are present. The statistics page does not consume unit/timezone preferences (F-009 and F-010). Storage usage has no visible failed-query state (F-013). Owner/admin health-panel failures were not duplicated from the existing owner-health task coverage.

### Phase 9 — Auth and session

**Gated to application boundaries only.** Approved protected navigation and admission semantics belong to F-002 through F-006. This phase checked only logout guard and application state cleanup at the boundary. Clerk widget behavior, token expiry, identity provisioning, approval transitions, and protected-route internals remain excluded.

### Phase 10 — UI feedback and polish

**Completed.** Loading, success, empty, toast, error, disabled, and retry affordances were inspected. Missing retry or misleading empty/blank states are counted as F-011 through F-014. Zoom, screen-reader output, focus return, and physical clipping remain manual QA.

### Phase 11 — Data lifecycle

**Completed for selected application data.** Session/folder/trash mutations, settings saves, wire catalogs, feedback, invite joining, stats reads, and offline queue boundaries were traced. The core session entry/photo lifecycle and export/import round trip were not re-audited. No data-loss finding was confirmed in the remaining surfaces.

### Phase 12 — Cross-context

**Completed with manual visual and provider boundaries.** Dashboard browser state cleanup and offline logout guard are covered by existing evidence. The help chat's module-level state is not identity-scoped and is F-007. Two-user same-browser confirmation, browser restart persistence, DevTools offline transitions, zoom, screen-reader semantics, and physical multi-device behavior are **[MANUAL QA NEEDED]**.

### Phase 13 — Triage and stop point

**Completed; report-only.** Findings were de-duplicated against F-001 through F-006 and the known task coverage, assigned sequential IDs, and grouped only where a shared remediation boundary is plausible. No fix loop, product-code edit, test edit, migration, configuration change, secret access, or follow-up task creation was performed during the audit.

## Findings

### F-007

- **ID:** F-007
- **Journey:** 9 — Logout/offline cross-context; 7 — Help and Ask AI
- **Phase:** Phase 2 — State and persistence; Phase 12 — Cross-context
- **Severity:** High
- **Failure:** Ask AI conversation messages are kept in a module-level `helpChatState` object rather than being scoped to the authenticated identity. When one user leaves Help and another user later uses the same loaded application, `AskAIChat` initializes from the previous messages. The second user can see the previous user's questions and answers until the chat is cleared or the page bundle is replaced. This is an application-state isolation failure, not a Clerk or protected-route finding.
- **Fix:** Scope help-chat state by `identityId` or clear it as part of the existing identity-transition/logout cleanup. Do not use one process-wide message array for all authenticated identities. Add a two-identity browser journey that logs out, signs in as another approved user, opens Help, and asserts that no prior chat messages appear.
- **Evidence:** `client/src/components/HelpMenu.tsx` declares `const helpChatState: { messages: ChatMessage[] } = { messages: [] }` at module scope. `AskAIChat` initializes from `helpChatState.messages` and writes every conversation update back to the same object. The component does not read `identityId`, subscribe to identity changes, or clear this state on unmount/logout. Existing logout cleanup clears identity-scoped browser keys and protected offline caches, but it cannot clear this module object.

### F-008

- **ID:** F-008
- **Journey:** 2 — Search/filter/sort persistence
- **Phase:** Phase 1 — Happy-path application sweep; Phase 4 — Error and edge cases
- **Severity:** Medium
- **Failure:** Search can report no sessions even when a matching owned session exists beyond the first 50 dashboard rows. The server search endpoint returns all matching IDs, but the dashboard filters only `allLoadedSessions`; it does not fetch the matching session records or automatically advance pagination when the match set is outside the loaded page. A user with a large session list can therefore search for a known session and receive the no-results card.
- **Fix:** Make search and structured filters server-paginated over matching session records, or automatically load/merge all matching owned rows before rendering. Keep the result count and load-more control consistent with the filtered result set; do not show “No sessions found” while `ownedIds` contains unloaded matches.
- **Evidence:** `client/src/pages/dashboard.tsx` requests `/api/sessions` with `limit=50` and `offset`, stores pages in `allLoadedSessions`, then computes `filteredSessions` by checking each loaded row against `ownedMatchSet`. `server/routes.ts` and `server/storage.ts` return an unpaginated `ownedIds` array from `/api/search/sessions`. The no-results branch runs when `filteredSessions` is empty, regardless of whether `searchResults.ownedIds` contains IDs that were not loaded.

### F-009

- **ID:** F-009
- **Journey:** 4 — Settings and preferences; 6 — Statistics
- **Phase:** Phase 8 — Settings and preferences; Phase 10 — UI feedback and polish
- **Severity:** Medium
- **Failure:** The saved default-unit preference is not honored on Summary Stats. After a user selects meters in Settings, the statistics page continues to label total, average, weekly, catalog, wire, gauge, and shared-performance footage values as `ft`, with no indication that the displayed unit differs from the preference used elsewhere in the application.
- **Fix:** Load the user's settings in `client/src/pages/stats.tsx`, convert base-foot values with the shared unit-conversion helpers, and derive labels from the saved unit. Cover populated and no-data stats plus reload after changing the unit.
- **Evidence:** `client/src/pages/settings.tsx` saves `defaultUnit` and the dashboard reads it for display. `client/src/pages/stats.tsx` contains literal `ft` suffixes for every footage value and imports neither `useQuery` for settings nor the shared conversion helpers. The stats API returns numeric footage values without a display-unit contract.

### F-010

- **ID:** F-010
- **Journey:** 4 — Settings and preferences; 6 — Statistics
- **Phase:** Phase 8 — Settings and preferences; Phase 12 — Cross-context
- **Severity:** Low
- **Failure:** Statistics date labels use the browser's locale/timezone rather than the saved application timezone. Weekly activity constructs a JavaScript `Date` from a date-only API value and calls `toLocaleDateString("en-US")`; daily activity is rendered from API dates without an application-timezone formatter. Users who configure a non-browser timezone can see an activity day or week label shifted or formatted differently from dashboard timestamps.
- **Fix:** Treat API date-only values as calendar dates in the saved timezone, use the existing timezone utilities, and make the stats date-label contract explicit. Verify a timezone west/east of the browser timezone and a date near UTC midnight.
- **Evidence:** `client/src/pages/stats.tsx` formats `weeklyStats` with `new Date(w.week).toLocaleDateString("en-US", ...)` and does not import `useTimezone` or `formatTimestamp`. `client/src/pages/settings.tsx` persists a `timezone` preference, while dashboard timestamp rendering already uses shared timezone utilities.

### F-011

- **ID:** F-011
- **Journey:** 2 — Search/filter/sort persistence
- **Phase:** Phase 3 — Silent failure hunt; Phase 10 — UI feedback and polish
- **Severity:** Medium
- **Failure:** A failed dashboard search is presented as a legitimate empty result. The search query function returns `emptySearch` for every non-OK response, including server errors, network failures, and protected-response failures. The dashboard then renders “No sessions found” or “No sessions match the active filters” with no error or retry affordance, leading the user to believe their data does not match.
- **Fix:** Throw a typed query error for non-OK search responses, render a search-specific failure state with Retry and Clear controls, and keep genuine zero-match responses separate from failed requests. Preserve the existing encryption/filter notices.
- **Evidence:** In `client/src/pages/dashboard.tsx`, the `/api/search/sessions` query function executes `if (!res.ok) return emptySearch;`. The component does not expose `searchResults` query error state and routes the empty result into the normal no-search-results card.

### F-012

- **ID:** F-012
- **Journey:** 8 — Invitation joining
- **Phase:** Phase 3 — Silent failure hunt; Phase 5 — Navigation and dead ends
- **Severity:** Medium
- **Failure:** A transient invite-join failure gives the user only a generic error and a one-way Dashboard escape. The client does not distinguish a network/5xx failure from an invalid or expired token and offers no Retry action. A temporary outage therefore looks like a bad invite and forces the user to reopen the link manually or abandon the join flow.
- **Fix:** Preserve the response status/error category in the join mutation, keep invalid/expired/already-member outcomes distinct, and render Retry for network/5xx failures while retaining Dashboard for permanent token failures. Ensure retry does not double-submit after a successful response.
- **Evidence:** `client/src/pages/join.tsx` catches all mutation errors, defaults to “This invite link may be invalid or expired,” and renders only `button-back-dashboard`. The server has distinct 404, 410, and 500 responses in `server/routes.ts`, but the client does not expose a retryable branch for the 500/network cases.

### F-013

- **ID:** F-013
- **Journey:** 4 — Settings and preferences; 5 — Owner panels
- **Phase:** Phase 3 — Silent failure hunt; Phase 10 — UI feedback and polish
- **Severity:** Low
- **Failure:** If `/api/storage/usage` fails after the initial loading state, the Storage Usage card renders neither an error message nor a retry explanation. The header refresh icon remains available, but the blank card content does not tell the user why their usage data is missing or that refresh is the recovery action.
- **Fix:** Add an `isError` state with concise copy and a labeled Retry/Refresh action, while preserving the existing loading, populated, and zero-usage states. Do not merge this into the owner-health panel failure task; this is the regular user's storage panel.
- **Evidence:** `client/src/pages/settings.tsx` reads `storageUsage` and `storageLoading` but not a storage-query `isError`. Its conditional content covers loading and truthy data only; an undefined result after failure leaves `CardContent` without a status message.

### F-014

- **ID:** F-014
- **Journey:** 6 — Statistics
- **Phase:** Phase 3 — Silent failure hunt; Phase 5 — Navigation and dead ends
- **Severity:** Medium
- **Failure:** A transient `/api/stats` failure ends on an error card with only “Back to Dashboard.” There is no Retry/refetch action, so the user must leave and re-enter the page to attempt recovery, and the page provides no path to tell a temporary outage from a persistent data problem.
- **Fix:** Expose the query refetch action in the error branch, provide a disabled/loading state while retrying, and retain Back to Dashboard as a separate escape. Verify retry after a single injected 5xx/network failure.
- **Evidence:** `client/src/pages/stats.tsx` destructures `isLoading` and `isError` from the stats query but not `refetch`; the `isError` branch renders only `button-back-stats-error` and `button-back-to-dashboard`.

## Proposed consolidation groups

These are recommendations only. No follow-up implementation tasks are created until the user reviews and chooses which groups, if any, to promote.

### Group A — Dashboard search correctness and failure recovery

- **Shared problem:** Search owns a server-wide match set but renders only loaded page rows, and it masks failed requests as zero matches.
- **Member findings:** F-008, F-011.
- **Recommended single task:** “Make dashboard search paginated and failure-aware.”
- **Suggested nested subtasks:** (1) define a server-paginated search/filter response and merge it with dashboard rows; (2) separate zero-match from failed-query UI; (3) cover unloaded matches, retry, filters, recent searches, and reload persistence.
- **Why they may remain separate:** F-008 is a data/pagination correctness defect; F-011 is an error-state contract defect. They share the dashboard search response/remediation boundary but should remain separately verifiable.

### Group B — Preference-aware statistics display

- **Shared problem:** Summary Stats does not consume the same display preferences used by the rest of the application.
- **Member findings:** F-009, F-010.
- **Recommended parent task with nested subtasks:** “Make Summary Stats honor saved display preferences.” Subtasks: (1) unit conversion and labels; (2) timezone-safe calendar labels; (3) populated, empty, reload, and cross-timezone browser coverage.
- **Why they may remain separate:** Units change numeric meaning; timezone changes calendar interpretation. A task can coordinate them, but each needs an independent acceptance check.

### Group C — Retryable read failures on remaining application pages

- **Shared problem:** Read failures on invitation, storage, and statistics surfaces are not consistently distinguished from permanent/empty states or given an in-place retry.
- **Member findings:** F-012, F-013, F-014.
- **Recommended parent task with nested subtasks:** “Standardize retryable recovery for application read flows.” Subtasks: (1) invite status classification and retry; (2) storage usage error/retry state; (3) stats refetch state; (4) verify no duplicate submissions and preserve permanent-error copy.
- **Why they may remain separate:** Invite joining is a mutation with token semantics; storage and stats are independent reads with different ownership and data lifecycles.

### Group D — Identity-scoped help conversation state

- **Shared problem:** Help chat state survives component/account transitions without an identity boundary.
- **Member finding:** F-007.
- **Recommended single task:** “Scope Ask AI help history to the active identity.”
- **Suggested nested subtasks:** (1) key or clear chat state on identity transition; (2) verify logout/login with two approved identities; (3) preserve same-user navigation behavior.
- **Why it remains separate:** F-007 is high severity and a cross-context privacy boundary; it should not be bundled into generic retry or settings work.

## Blocked and manual-QA checks

These are not counted as additional confirmed findings:

- **[MANUAL QA NEEDED]** Use two real approved identities in one browser context, log out/in, open Help, and verify the previous Ask AI transcript is absent; code evidence already confirms the unscoped state risk.
- **[MANUAL QA NEEDED]** Seed more than 50 owned sessions with a match beyond the first page, then search, filter, sort, navigate away, reload, and compare displayed rows with the result count.
- **[MANUAL QA NEEDED]** Inject a 500/network failure into dashboard search and storage usage, and verify that the proposed failure states do not look like empty data. Current code evidence confirms the present masking/blank behavior.
- **[MANUAL QA NEEDED]** Change the unit and timezone preferences, reload, and compare populated stats against dashboard/session values across browser timezones.
- **[MANUAL QA NEEDED]** Exercise a valid invite during a transient network/5xx failure, then retry without reopening the link; provider/network timing is not established by current fixtures.
- **[MANUAL QA NEEDED]** Verify dialog focus return, keyboard-only operation, screen-reader announcements, 75%/150% zoom, 375px/768px/1280px clipping, long strings, high-volume list performance, physical rapid taps, and clipboard/drag gates where applicable.
- **Gated out:** Clerk widget/provider internals, approval/provisioning/revocation mechanics, token expiry, core session modes, and unsupported session export/import round trips remain owned by the preceding audits or other task plans.

## Report-only stop

This remaining-surface audit stops at the report-only boundary. No application code, tests, migrations, configuration, secrets, deployments, external services, or artifact content were changed. No finding was fixed and no regression-test loop was entered. The recommended next actions are to review the consolidation groups, promote only the groups the user selects, and separately verify the high-severity identity-scoped help state before release.