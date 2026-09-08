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