---
name: ux-confirmation-audit
description: >-
  End-to-end UX confirmation audit playbook for any app. Walks every major user
  journey to find and fix broken flows, silent failures, and rough edges before
  shipping. Two modes: task-proposal (DEFAULT — audit and present an actionable
  task tree, change nothing) and audit-and-fix (fix in severity order with verification and
  regression hardening). Stack-agnostic; gated checks activate only when the
  relevant stack feature is present. Focused on user-journey correctness, not
  code style — every finding must be a real user-visible failure with a
  concrete fix attached.
---

# UX Confirmation Audit

A phased, repeatable playbook for confirming that every major user journey in an app works correctly, persists properly, and handles failures gracefully. Works on any stack; stack-specific checks are gated and explicitly skipped when they don't apply.

---

## Invocation Modes — decide first

- **task-proposal** (DEFAULT): audit all phases, turn confirmed findings into a user-visible proposed task tree, and change NOTHING. Stop before Phase 13's fix loop and ask the user which tasks they want implemented.
- **audit-and-fix**: only when the user explicitly asks for fixes ("fix what you find", "repair these issues"). Runs all phases including the fix loop.

If the user's intent is ambiguous, **default to task-proposal**. Never modify code in task-proposal mode — not even "trivial" fixes. Present proposed tasks in a project-native task surface when available; otherwise show the task tree in the response. Do not claim tasks were persisted unless they were actually created. Do not create tasks in an external tracker unless the user explicitly requests that.

---

## Phase Overview

| Phase | Gate | Purpose |
|---|---|---|
| 0 | ALWAYS | Discovery, scoping, app map |
| 1 | ALWAYS | Happy path sweep |
| 2 | ALWAYS | State & persistence |
| 3 | ALWAYS (backend checks gated) | Silent failure hunt |
| 4 | ALWAYS | Error & edge case |
| 5 | ALWAYS | Navigation & dead-ends |
| 6 | Gated: shortcuts / DnD / clipboard present | Keyboard, shortcuts & interaction |
| 7 | Gated: multiple tools / modes present | Tool & mode switching |
| 8 | ALWAYS | Settings & preferences |
| 9 | Gated: auth present | Auth & session |
| 10 | ALWAYS | UI feedback & polish |
| 11 | ALWAYS (backend / undo / export checks gated per check) | Data lifecycle |
| 12 | ALWAYS (some checks MANUAL QA) | Cross-context |
| 13 | ALWAYS | Triage, fix & regression hardening |

Conditional phases whose gate fails are **skipped entirely** — note the skip reason in the output. Never apply a gated phase speculatively.

---

## Severity Rubric

Classify every finding using one of these four levels. When in doubt, classify **higher**. Downgrade only when you can state a concrete reason why the failure is unlikely to be reached.

| Level | Criteria |
|---|---|
| **Critical** | Confirmed data loss, unauthorized data exposure, security compromise, irreversible harm, or a total feature failure that prevents completion of a critical journey |
| **High** | A user-visible malfunction that blocks or misleads the user, or another materially harmful failure that does not meet the Critical criteria; a workaround may exist |
| **Medium** | Latent failure that occurs under reachable but non-obvious conditions (specific input, specific sequence, second tab, low memory, etc.) |
| **Low** | Polish, hygiene, or accessibility gap that degrades experience but does not block any journey |

Do not promote an unverified suspicion to a confirmed finding. When evidence is incomplete, state what is known and what remains unverified; choose severity from the demonstrated impact, not the most alarming hypothetical.

---

## Global Ground Rules

State these rules once here; individual phases do not repeat them.

### Code-Inspection Fallback
Code inspection can identify a likely behavior or defect, but it does not prove runtime behavior. For checks requiring live interaction, test only in a safe isolated environment. If that environment or required access is unavailable, record the code path inspected, mark the behavior **not runtime-verified**, and add `[MANUAL QA NEEDED]`. Never describe static inspection as an end-to-end test.

### Test Isolation & Side Effects
Use a disposable local or staging environment, synthetic data, and designated test accounts for state-changing checks. Do not clear, overwrite, or delete real user data; upload sensitive files; send messages; make purchases; publish; invite users; reset real credentials; or trigger other external side effects. Clear only test-owned state, and preserve a way to restore it.

An audit-and-fix request authorizes code changes within the requested scope; it does not authorize production deployment, live account or data mutations, external communications, or other irreversible actions. Before any such action, obtain explicit approval for that specific action. If a safe test target is unavailable, skip the mutating check, preserve existing state, and report it as blocked with `[MANUAL QA NEEDED]`.

### Finding IDs
Number every finding sequentially across all phases as **F-001, F-002, …** Never reuse an ID within a run. The ID stays with the finding even if it is later deferred or resolved.

### De-Duplication
If the same root cause surfaces in two different phases, **keep the higher-severity instance** and add a cross-reference note (`see also: F-0XX`) to both. Do not report the same bug twice.

### Critical Mid-Audit Policy
A Critical finding does **not** automatically stop safe, read-only audit work. Mark it prominently (e.g., **⚠ CRITICAL**) and continue only with checks that cannot expose more data, cause additional loss or corruption, or trigger external side effects. Stop risky interactions, preserve evidence, and report the blocker. Do not attempt to reproduce or expand a security exposure against real users or data. Resume the affected checks only after the risk is contained and a safe test target is available.

### Third-Party Widgets / iFrames
Note their presence in the app map but do not audit their internals — they are out of scope. Verify only that the embedding integration (load, error handling, sizing) works correctly.

### Prior Audit Reports
Before starting Phase 0, **check the repo** for existing bug-audit or UX-audit reports (`bug-audit-report.md`, `ux-audit-report.md`, or similar files in the root and docs). Treat their open findings as candidates, prefix them `[SEED]`, and verify against the current code or safe runtime evidence before presenting them as current. If status cannot be verified, label them **unverified seed**; do not count them as confirmed findings or assume they remain open.

---

## Phase 0 — Discovery, Scoping & App Map (ALWAYS)

**This phase is required before any other phase begins.**

### What is a "Journey"
A user journey is a **goal-oriented sequence of actions** a user performs to accomplish one thing (e.g., "Create and save a new document", "Change the active brush tool", "Update account email"). A single feature interaction (click one button) is too granular. A full product walkthrough is too broad. Aim for **5–15 steps per journey**.

### Steps

1. **Check for prior reports.** Look for `bug-audit-report.md`, `ux-audit-report.md`, or similar in the repo root and docs. Treat prior findings as candidates, prefix them `[SEED]`, and verify their current status before including them as confirmed findings or proposed implementation tasks. If they cannot be verified, make a separate investigation task rather than carrying them forward as confirmed.

2. **Stack detection.** Identify:
   - Languages and frameworks (React, Vue, Svelte, native mobile, etc.)
   - Routing library and routing strategy (file-based, hash, history)
   - State management (Redux, Zustand, Context, MobX, signals, etc.)
   - Storage mechanisms (localStorage, sessionStorage, cookies, IndexedDB, server DB)
   - Whether a backend API exists → set flag **`backend: true/false`** (gates Phase 3 and Phase 11 backend checks)
   - Whether auth exists → set flag **`auth: true/false`** (gates Phase 9)
   - Whether multiple tools or modes exist → set flag **`multi-tool: true/false`** (gates Phase 7)
   - Whether keyboard shortcuts, DnD, or clipboard interactions exist → set flag **`interactions: true/false`** (gates Phase 6)

3. **Enumerate all routes / views / screens.** Read the router config, file-based routes, or navigation components. List every screen.

4. **Enumerate all tools / modes** (if any), settings panels, and persistent state keys:
   - Every `localStorage.setItem` / `sessionStorage.setItem` key
   - Every DB table or column storing user-facing state
   - Every URL param that affects UI

5. **Enumerate all user-facing interactions:** every form, every button, every drag target, every keyboard shortcut, every modal/dialog trigger.

6. **Build the app map.** Output a numbered list of every user journey before proceeding. If the app has more than 20 distinct journeys, **ask the user to prioritize or scope to one feature area** — do not attempt to audit all 20+ in a single run.

7. **Escalation.** If journeys cannot be determined from code alone, list what was found and ask the user to confirm or add missing journeys before continuing.

---

## Phase 1 — Happy Path Sweep (ALWAYS)

For **each journey** on the app map, walk it from a **defined clean state**:
- Use a disposable local/staging environment and synthetic fixtures; do not run clean-state setup against production or a user's existing account.
- Clear only the test-owned localStorage/sessionStorage keys needed for the journey; never clear broad storage, credentials, or user data.
- Use a designated test/demo account if auth exists. If one is unavailable, do not substitute a real user account; mark affected checks blocked.
- Start without pre-existing test data unless the journey specifically requires it, and restore or discard only the disposable test state when finished.

For each step in each journey, verify:

**(a) End-to-end completion.** The journey completes without crashes, white screens, or error boundaries triggering.

**(b) Visible, timely feedback.** Every action produces a visible, timely result — loading indicator, success message, or on-screen state change. An action that silently does nothing is at minimum a **High** finding.

**(c) Persistence after reload.** The final result of the journey persists and is still correct after a page refresh. If state silently resets to a default, it is a **High** finding.

**Heuristic — console errors:** After each step, check the browser console or inspect the relevant code path for `console.error`, `console.warn`, `Uncaught`, or `Failed to fetch`. A message is a finding only when it is attributable to the audited action and indicates a real user-visible or reliability impact. Do not flag benign, expected, development-only, or unrelated third-party messages by presence alone; record uncertain attribution as unverified rather than assigning severity.

---

## Phase 2 — State & Persistence Audit (ALWAYS)

Check every piece of state that is supposed to survive navigation or reload.

**(a) Reload persistence.** Reload the app and verify the UI reflects persisted state exactly — no flicker to a hardcoded default then correction, no missing values.

**(b) Navigate away and back.** State must be correct after round-trip navigation within the app.

**(c) Tool / mode / tab switching.** Switch between tools, modes, or tabs and verify no state is lost or corrupted.

**(d) Second-tab behavior** — GATE: use only the isolated test environment and test account. Open the app in a second tab. Watch for:
- Duplicate records appearing
- Last-write-wins data loss (Tab A saves, Tab B saves, Tab A's save is gone)
- UI showing stale data from before Tab B's change
- Console errors about storage conflicts

**Heuristics:**
- Grep for all `localStorage.setItem` / `sessionStorage.setItem` / cookie writes and verify each has a matching read that is actually **applied to UI on load**.
- Check that initial-state values in reducers/stores **read from storage first** rather than hardcoding defaults that would overwrite persisted values on initialization.

---

## Phase 3 — Silent Failure Hunt (ALWAYS; backend checks gated)

Targets operations that appear to work but don't, or that fail without telling the user.

**(a) API error handling** — GATE: `backend: true`. For every write/save/submit action, check the code's error-handling path — if the API call fails (4xx/5xx), does the UI show an error, or does it silently appear to succeed? `[MANUAL QA NEEDED: confirm in network tab when possible]`

**(b) Offline behavior** — GATE: `backend: true`. Grep for `navigator.onLine` checks, service workers, or offline handlers. If none exist, flag as **Medium** (no offline handling). `[MANUAL QA NEEDED: verify behavior when network is disconnected]`

**(c) Log-only catch blocks.** Grep for `catch` blocks that only `console.error` without setting any user-facing error state. When the caught failure is confirmed and leaves a user-facing operation silently failed, it is at minimum **High** under the global rule. If the catch does not represent a confirmed silent failure, classify it by its demonstrated user impact; do not assign severity from the presence of logging alone.

**(d) Fire-and-forget async calls.** Grep for async function calls without `await` or `.catch` inside event handlers (pattern: `asyncFn()` in a sync handler, or `.then(...)` without `.catch(...)`). Each unhandled rejection path is a finding.

**(e) Optimistic UI rollback.** For every optimistic UI update, find and verify the rollback code path — if no rollback on failure exists, it is a **High** finding.

**Rule:** Every confirmed silent failure is at minimum **High**.

---

## Phase 4 — Error & Edge Case Pass (ALWAYS)

Stress inputs and states:

**(a) Form validation.** By code inspection, verify required fields are enforced, max-length constraints exist where needed, and special characters (`<script>`, emoji, RTL text, zero-width spaces) are handled without crashing or rendering broken HTML.

**(b) Double-submit / rapid repeat.** By code inspection, look for debounce, throttle, or disabled-during-submit guards on every form submit and destructive action. Absence of any guard is a **Medium** finding. `[MANUAL QA NEEDED: verify in browser when possible]`

**(c) Extreme numeric values.** Grep for numeric inputs and sliders. Verify min/max constraints are enforced in the UI for clear feedback and at the authoritative server/API boundary when a backend exists. Client-side and UI-handler checks alone can be bypassed.

**(d) File uploads** — GATE: if file uploads exist. Use synthetic, non-sensitive files in the isolated test environment. Verify client-side type/size checks provide timely feedback **and** the server independently validates type, size, and content before processing; never trust the filename or client-supplied MIME type as authoritative. If no backend exists, identify the actual trusted processing boundary and do not claim server-side validation.

**(e) Empty and high-volume states.** For every list, grid, or canvas, verify:
- The empty state renders something informative (not a blank box)
- Large datasets don't cause a visible freeze or layout overflow
- Check for virtualization or pagination if the list is unbounded

---

## Phase 5 — Navigation & Dead-End Pass (ALWAYS)

Walk every navigation path:

**(a) Link and button targets.** For every link, button, and tab in the app, verify by code inspection that the target route/handler exists and does not lead to a 404 or unhandled route.

**(b) Back-button behavior.** For every major action that changes a route, verify the previous route is valid to return to. No action should leave the back-stack pointing at a broken or empty state.

**(c) Deep-linking.** For every route, verify it can be loaded from a fresh page load with no dependency on prior navigation — required data must be fetched on mount, not assumed to be in memory from a previous visit.

**(d) Modal / dialog dismissal.** For every modal and dialog, verify by code inspection that **all three** close mechanisms work: close button, Escape key, and clicking the backdrop. If any of the three is missing, it is a **Medium** finding.

**(e) Focus management after modal close.** Verify that when a modal closes, focus returns to the element that triggered it. Grep for `focus()` calls near modal close handlers; absence is a **Low** finding.

**(f) Trapped states.** Verify there is no UI state where the user's only escape is a full page reload.

---

## Phase 6 — Keyboard, Shortcuts & Interaction Pass (Gated)

**GATE: Skip entirely and note it if `interactions: false` (no shortcuts, no DnD, no clipboard interactions).**

**(a) Shortcut registration.** Verify each documented shortcut actually fires its handler — grep for the key binding registration and confirm it maps to the correct action.

**(b) Input focus guard.** Verify shortcuts do not fire when focus is inside a text input or textarea. Check for `event.target.tagName === 'INPUT'` guards, `isContentEditable` checks, or equivalent. Absence is a **High** finding.

**(c) Shortcut conflicts.** Verify no two shortcuts share the same key combination — grep for all key bindings and look for duplicates. Any duplicate is a **Medium** finding.

**(d) Drag-and-drop** — GATE: skip if no DnD. Verify:
- Escape cancels an in-progress drag
- Dropping on an invalid target is handled gracefully (no crash, no orphaned drag state)
- Dropping outside the app window does not lock the UI

**(e) Clipboard interactions** — GATE: skip if no copy/paste. Verify:
- Copy produces the correct content
- Paste inserts at the correct location
- Cut removes the source correctly

**Rule:** Any documented shortcut that silently does nothing is at minimum a **High** finding.

---

## Phase 7 — Tool & Mode Switching Pass (Gated)

**GATE: Skip entirely and note it if `multi-tool: false`.**

**(a) Tool indicator and options.** Switch to each tool and verify the correct cursor, panel, and options are shown. If the active tool indicator is ambiguous (only a subtle color change with no other signal), it is a **Low** finding.

**(b) Tool settings persistence.** Switch away from a tool and back — verify the tool's own settings (size, opacity, color, hardness, etc.) are exactly as left, not reset to defaults.

**(c) Cross-tool result integrity.** Perform an action in Tool A, switch to Tool B, switch back — verify Tool A's last visible result is still correct and unmodified.

**(d) Mid-gesture tool switch.** Grep for `mousedown` / `mousemove` / `mouseup` / `pointerdown` / `pointermove` / `pointerup` listeners and verify they are cleaned up when the active tool changes. Any listener not removed on tool change is a **Medium** finding.

**(e) Active tool affordance.** Verify the currently active tool is unambiguously indicated in the UI — highlighted, checked, bold, or some affordance beyond a color shift alone. If only a color shift differentiates active from inactive, it is a **Low** finding.

---

## Phase 8 — Settings & Preferences Pass (ALWAYS)

For every control in every settings panel:

**(a) Handler wiring.** Verify by code inspection that changing the control's value actually updates the relevant state and produces a visible change in the app. If the handler is a no-op or the value is written but never read, it is a **High** finding.

**(b) Persistence after reload.** Verify the storage write exists **and** the read is applied on initialization — not just written once and never re-applied.

**(c) Reset to defaults** — GATE: if a reset button exists. Verify by code inspection that **every** setting controlled by that panel is actually reset, not just a subset. A partial reset is a **Medium** finding.

**(d) Shared state interference.** Grep for shared storage keys or state that two distinct settings both write to. Conflicts are at minimum a **Medium** finding.

**(e) Concurrent operation safety.** Verify that changing a setting during an active operation (mid-stroke, mid-upload, mid-animation) does not crash. If the setting write is not guarded against concurrent operations, flag as **Medium**.

---

## Phase 9 — Auth & Session Pass (Gated)

**GATE: Skip entirely and note it if `auth: false`.**

**(a) Session expiry.** Find the session timeout / token refresh behavior, including the identity provider and server configuration where applicable. Absence of timeout logic in the app repository alone does **not** prove sessions never expire. Confirm the effective behavior before reporting a finding; if provider/runtime configuration is unavailable, mark it unverified and `[MANUAL QA NEEDED]`. If a timeout exists, verify the expiry handler refreshes safely or redirects to login with a clear message — not a crash or silent save failure.

**(b) Protected route guards.** For every route that requires auth, verify by code inspection that an auth guard exists and unauthenticated access redirects cleanly rather than rendering a broken page or exposing data.

**(c) Permission-gated features.** For every feature gated behind a role or plan, verify the UI for unauthorized users shows a clear "not available" state rather than a crash, a blank area, or a misleadingly disabled button with no explanation. Absence of explanation is a **Low** finding; a crash or data exposure is **Critical**.

**(d) Login/logout cycle.** Verify logging out clears all sensitive cached data — tokens, user-specific localStorage keys, in-memory state — and that re-logging in as a different user does not show the previous user's data. Any previous-user data leak is **Critical**.

---

## Phase 10 — UI Feedback & Polish Pass (ALWAYS)

Every interactive element must meet these standards:

**(a) Async loading indication.** Async operations (saves, loads, API calls) must show a loading indicator OR disable the trigger button for their duration. Absence of either is a **Medium** finding.

**(b) Disabled state clarity.** Buttons/inputs in a disabled state must be visually unmistakably inactive — check for `cursor: not-allowed`, muted color, and `aria-disabled`. An opacity-only difference is a **Low** finding.

**(c) Hover and focus styles.** Every interactive element must have a visible `:hover` and `:focus` style. Grep for elements with click/keyboard handlers and check their CSS. Missing `:focus` style is a **Low** finding; missing both is a **Medium**.

**(d) Error message quality.** Error messages must name what went wrong and what the user can do. "Something went wrong" alone is a **Low** finding; a silent failure is **High**.

**(e) Toast duration.** Grep for `setTimeout` on toast dismissal and flag values outside the **2–8 second** range. Too short (< 2 s): **Low**; auto-dismissing in under 1 s: **Medium**. Never auto-dismissing: **Low**.

**(f) Toast deduplication.** If the same error can fire multiple times in rapid succession, verify duplicate toasts are suppressed (only one instance shown at a time). Absence of deduplication is a **Low** finding.

---

## Phase 11 — Data Lifecycle Pass (ALWAYS; backend / undo / export gated per check)

For every object the user can create, read, update, and delete:

**(a) Create** — GATE: applies to all apps; backend persistence check requires `backend: true`. Verify the item appears immediately in the UI and persists after reload.

**(b) Edit** — GATE: applies to all apps; server persistence check requires `backend: true`. Verify the edit is saved and displayed correctly — not reverted, not doubled, not partially applied.

**(c) Delete** — GATE: perform only on synthetic objects in the isolated test environment; server + cache checks require `backend: true`. Never delete a real user record to test this flow. Verify the test item:
- Disappears from the UI immediately
- Is removed from storage/DB
- Cannot be accessed via direct URL
- Is cleared from any in-memory caches or stores (grep for store update after delete call)

Stale in-memory data after delete is a **High** finding.

**(d) Undo/redo** — GATE: if undo/redo exists. Verify it works for every destructive action and does not desync the UI from the underlying data. The visual state after undo must match the stored state. A desync is a **High** finding.

**(e) Import/export** — GATE: if import/export exists. Export data, reload (or use a fresh session), import — verify exact round-trip fidelity with no data loss, no duplicates, and no format errors. Any data loss or corruption is **Critical**.

---

## Phase 12 — Cross-Context Pass (ALWAYS; some checks MANUAL QA)

**(a) First-run / empty state** — GATE: clear only test-owned storage in the isolated environment; do not clear a user's existing browser or account state. Verify:
- Empty states are shown with informative placeholders (not blank white boxes)
- Defaults are sensible
- There is some guidance for new users

**(b) Responsive layout** — GATE: if the app targets multiple screen sizes. Resize to mobile (375 px), tablet (768 px), and desktop (1280 px) widths. Verify no overflow, no clipped controls, no overlapping elements. `[MANUAL QA NEEDED: verify visually in browser]` For code inspection fallback, grep for hardcoded `px` widths in layout components and check for media queries.

**(c) Browser zoom** — GATE: web apps. Check layout at 75% and 150% zoom. Verify no text overflow, no broken grid, no clipped buttons. `[MANUAL QA NEEDED: verify visually in browser]` For code inspection fallback, grep for `overflow: hidden` on containers that display user text.

**(d) Long strings.** Grep for display of user-provided text (names, titles, descriptions) and verify each has truncation (`text-overflow: ellipsis`, `overflow: hidden`, `white-space: nowrap`) or wrapping. An unbounded string that overflows its container is a **Low** finding.

**(e) High data volume.** For any list, canvas, or grid, assess whether it paginates or virtualizes. An unbounded render of user data with no pagination or virtualization is a **Medium** finding.

**(f) Multiple sessions / second-tab heuristics.** Look for:
- Shared localStorage keys written by concurrent tabs — check for `storage` event listeners to sync changes; absence is a **Low** finding for any app where multi-tab use is plausible
- Polling or WebSocket handlers — verify they don't produce duplicate updates when two tabs are open

---

## Phase 13 — Triage, Fix & Regression Hardening (ALWAYS)

### Findings Format

Every finding **must** include all of these fields:

```
ID:       F-001
Journey:  [which user journey from the app map, by number or name]
Phase:    [which audit phase found it]
Severity: Critical | High | Medium | Low
Failure:  [exact user-visible description of what breaks, written from the user's perspective]
Fix:      [concrete, actionable code change — name the file, function, and what to change]
Evidence: [code path, test steps/results, or other evidence supporting the finding]
Verification: [runtime-tested | code-inspected, not runtime-verified | unverified seed | blocked / manual QA needed]
```

### Task-Proposal Mode

Present a proposed task tree as the primary deliverable, ordered by severity (Critical → High → Medium → Low) and dependencies. Do not deliver only a flat findings report. A brief audit summary may show finding counts, but every confirmed finding must map to a proposed task or be explicitly excluded with a reason.

#### Shape the Task Tree

- **Consolidate** findings when they share the same root cause and can be addressed by one coherent change. Preserve every source finding ID and severity on the task; use the highest applicable severity for task ordering.
- **Subdivide** work when findings need independently actionable implementation, test, or rollout work. Use nested child tasks under a parent outcome when that makes ownership, dependencies, or completion clearer.
- **Do not combine** unrelated fixes merely to shorten the task list. Keep a single small fix as one task; do not add artificial parent tasks.
- **Unverified or seeded findings** become investigation/verification tasks, not confirmed implementation tasks. **Blocked or manual-only checks** become verification tasks with the missing access, environment, or evidence stated.
- Every task includes: title, linked finding ID(s), severity/priority, user impact, concrete scope, acceptance criteria, and verification method. Include dependencies or parent/child relationships when relevant.
- Keep the task list actionable and bounded. Order dependencies before dependent implementation or verification tasks.

**STOP HERE in task-proposal mode.** Present the task tree to the user and ask which tasks they want implemented. Do not modify code or begin the fix loop without explicit approval.
---

### Audit-and-Fix Mode

Use the same task-tree rules to plan the work, then fix in severity order: **Critical → High → Medium → Low**. Keep finding IDs traceable through parent and child tasks and through the final delivery.

For each finding:

1. **Apply the minimal fix.** Resist drive-by refactors — one finding, one fix.
2. **Re-walk the affected journey** step-by-step to confirm it now passes.
3. **Run the project's existing test/typecheck suite** to confirm no regression.

#### Fix-Loop Escape Hatch

If a fix introduces a new finding, add it to the list with a new ID and continue.

**If three consecutive fixes each introduce a new finding: stop.** Deliver the current findings list and ask the user for guidance before continuing. Do not keep iterating into an expanding problem without sign-off.

#### Regression Hardening

After all fixes, add regression hardening for every **failure class that produced 2 or more findings**. Choose the strongest applicable guard:

1. A **lint rule** that catches the pattern mechanically
2. A **shared utility** (e.g., a wrapper that always surfaces network errors to the UI)
3. A **new automated test** covering the fixed behavior
4. A **stricter compiler / schema check** at an API boundary
5. A **`replit.md` convention note** if mechanical enforcement is not possible

Prefer guards over documentation. A lint rule outlives everyone's recollection of the bug.

#### Final Delivery

Deliver a final summary covering:
- Counts by severity (fixed vs. deferred)
- Tasks completed, deferred, or blocked, including parent/child structure where used and the finding IDs each task addressed
- What was fixed
- What was deferred and why
- What hardening was added
- **Explicit next-step instructions for every deferred item** (what to do, why it matters, suggested priority)

---

## Verification Checklist (run after writing this skill, or after any update)

Before using or delivering this skill, confirm:

- [ ] Every phase has an explicit **skip gate** or **ALWAYS** designation
- [ ] State-changing checks use an isolated test target, synthetic data, and designated test accounts; blocked checks do not touch real data
- [ ] Risky checks stop after a Critical finding unless the remaining work is safe and read-only
- [ ] Runtime-tested behavior is distinguished from code-inspected behavior and unverified seed findings
- [ ] The findings format includes all required fields: ID, Journey, Phase, Severity, Failure, Fix, Evidence, Verification
- [ ] The **fix-loop escape hatch** (3 consecutive new findings → stop) is present
- [ ] The **regression hardening threshold** (2+ findings in same class) is stated
- [ ] The **Critical mid-audit policy** (don't stop, flag prominently, continue) is in Global Ground Rules
- [ ] The **de-duplication rule** (higher-severity instance wins, cross-reference the other) is in Global Ground Rules
- [ ] The **third-party iframe policy** (note presence, audit only embedding integration) is in Global Ground Rules
- [ ] The **prior audit reports check** is the first step in Phase 0
- [ ] The **task-proposal mode stop point** is clearly marked before the fix loop in Phase 13
- [ ] Confirmed findings map to proposed tasks; task consolidation, subdivision, nesting, and unverified-work rules are stated