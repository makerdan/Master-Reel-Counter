# Clerk Admin and Realtime Authorization UX Audit Report

**Mode:** Report-only  
**Scope:** Owner/admin account management and protected session realtime access  
**Audit date:** 2026-09-09  
**Validation ceiling:** `test-heavy`  
**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 1 |
| High | 4 |
| Medium | 1 |
| Low | 0 |

The server enforces the owner boundary consistently for administrative HTTP
operations: normalized `isOwner` is authoritative, username claims are not
trusted, self-target approval/rejection changes are blocked, and the global
`/api/admin` middleware is deny-by-default. Approved status is also checked
when a WebSocket is opened and during periodic revalidation.

The audit found one bounded protected-data exposure and four user-visible
authorization/realtime failures. The most serious issue is that account
rejection or approval removal changes the database but does not evict active
WebSocket connections. A rejected user can therefore continue receiving
session broadcasts until the ten-minute revalidation interval closes the
socket. Other findings concern controls shown to session non-owners, ignored
WebSocket denial messages, stale cached per-session roles, and silent admin
query failures.

No owner bypass was confirmed. No fix loop was run and no application code,
test code, or account data was changed.

## Phase 0 — Discovery, scope, and app map

### Detected stack and gates

- **Frontend:** React + TypeScript with TanStack Query.
- **Routing:** Wouter routes, with a hash fragment used for the Settings/Admin
  tab.
- **Backend:** Express APIs backed by PostgreSQL (`backend: true`).
- **Authentication:** Clerk identity bridged to the local user record, plus a
  deliberately separate development/tester session (`auth: true`).
- **Realtime:** `ws` WebSockets at `/ws`, session rooms, presence, broadcast
  updates, heartbeat, reconnect, and server-side identity revalidation.
- **Role layers:** application owner/admin authorization, approval/rejection
  admission, tester compatibility, and per-session owner/editor/viewer roles.
- **Interactions:** tabs, dialogs, mutation buttons, invite links, clipboard
  actions, and reconnect controls (`interactions: true`).

### Selected journeys

1. **Owner opens account management**
   1. Open Settings or deep-link to `#admin`.
   2. Load `/api/admin/users`.
   3. Observe the Admin tab and user list.
   4. Load owner-only summary, feedback, storage, integrity, crash, and usage
      surfaces.
   5. Reload and return to the tab.

2. **Ordinary user is denied account management**
   1. Sign in as an approved non-owner.
   2. Open Settings or deep-link to `#admin`.
   3. Observe that the Admin tab is not offered and the hash is removed.
   4. Attempt the owner-only HTTP endpoint directly.
   5. Observe the server's 403 response.

3. **Owner approves or rejects a user**
   1. Open Manage Users.
   2. Inspect pending, approved, tester, and owner rows.
   3. Approve a pending user or reject a pending/approved user.
   4. Observe the mutation toast and refreshed list.
   5. Open Clear Block List and inspect the count and confirmation copy.

4. **User opens a protected WebSocket session**
   1. Load a session as owner, editor, viewer, tester, pending, rejected, or
      non-member.
   2. Establish the same-origin `/ws` connection.
   3. Authenticate from the Clerk/tester cookies.
   4. Send a session join request.
   5. Observe joined, denied, presence, sync, and reconnect outcomes.

5. **Active session authorization changes**
   1. Keep an owner/editor/viewer socket open.
   2. Remove the collaborator, change their session role, transfer ownership,
      or delete the session.
   3. Observe authorization-change messaging, close behavior, cleanup, and
      reconnect.
   4. Confirm the client refreshes both data and permission-sensitive controls.

6. **Periodic identity and approval revalidation**
   1. Keep a socket open after its initial admission.
   2. Change approval/rejection or the Clerk/tester identity.
   3. Wait for the server's periodic revalidation.
   4. Observe close code/reason, client navigation, and stale cached data.

### Authority and identity map

| Boundary | Server authority | Client representation |
|---|---|---|
| App owner/admin | Normalized `req.user.isOwner === true`; global `ownerOnly` middleware protects `/api/admin` | Admin tab is inferred from a successful `/api/admin/users` array; owner row is identified by local `identityId` |
| Admission | Owner and tester are admitted; ordinary users require persisted `approved && !rejected` | `useAuth` treats a signed-in Clerk identity without a local user as terminal `accessDenied` |
| HTTP identity | Clerk bridge uses the local legacy subject in `claims.sub`; Clerk wins over tester cookies | `identityId` is the local user ID, Clerk external ID, or Clerk ID fallback |
| WebSocket identity | Cookies are parsed again at upgrade and every ten minutes; connected identity must retain the same subject and tester status | `/ws` URL is same-origin; client sends a display `userId`/`username`, but the server uses the authenticated socket identity |
| Tester compatibility | Tester is admitted and uses `testerOwnerUserId` for session access as an editor | Tester Link is owner-only; tester is excluded from the Admin tab |
| Session permissions | `verifySessionAccess` returns owner/editor/viewer; mutating routes enforce `canEdit`/`isOwner` | Session UI uses `session.role`; Team Dialog shows role badges and owner-only role controls |

## Evidence and validation baseline

- The plan specifies no known pre-existing failures and has no active matching
  baseline record.
- Relevant owner/approval/realtime regression tests are present in
  `server/__tests__/routes.test.ts`, including:
  - owner identity is not inferred from a username claim;
  - pending and rejected identities fail WebSocket authorization;
  - a connected collaborator fails revalidation after rejection;
  - active session collaborator sockets are evicted and receive
    `authorization_changed`;
  - session-wide socket cleanup and authorization-check invalidation are tested.
- The required command was run exactly as specified:
  `TASK_PLAN_FILE=.local/tasks/clerk-admin-realtime-audit.md npm run test-heavy`.
- `startup-smoke` passed.
- Validation stopped at `security-audit` because `npm audit --audit-level=high`
  reported two high-severity dependency findings in `multer` and `sharp`.
  Those dependency findings were not changed by this audit and were not
  silently treated as a baseline or fixed out of scope. The later light,
  backend, serial-lock, and Playwright steps did not run in this invocation.

## Phase results

### Phase 1 — Happy-path sweep

**Partial pass by code inspection.** Owner account-management controls,
approval/rejection mutations, initial WebSocket authentication, successful
session joins, presence, and ordinary sync messages have visible success or
loading states. Findings F-002 through F-005 identify reachable unhappy paths
where the corresponding authorization outcome is not represented clearly.

### Phase 2 — State and persistence

**Findings.** Admin approval state is refetched after approval/rejection, but
the rejected-count query is not invalidated after rejection and masks request
failure as zero (F-006). A role change evicts the socket but the client
reconnect path refreshes data collections without refreshing the session
metadata that supplies `session.role` (F-004).

### Phase 3 — Silent failure hunt

**Findings.** Admin-user loading converts every non-OK response to `null`,
which makes a transient owner-side failure look like a non-admin and redirects
away from the Admin tab without an explanation (F-005). A denied WebSocket
join sends an error that the client ignores while retaining a connected-looking
socket (F-003). Rejection/removal changes are also not propagated immediately
to active account sockets (F-001).

### Phase 4 — Error and edge cases

**Findings.** Owner-only session invite controls are available to editors and
viewers even though every corresponding mutation is server-denied (F-002).
Account rejection does not trigger the same socket eviction path already used
for session collaborator removal (F-001). Self-target protections and
malformed approval-body handling pass by inspection.

### Phase 5 — Navigation and dead ends

**Finding.** A non-owner deep-link to `#admin` is removed and returns to the
Settings tab, which is an appropriate denial outcome. An owner experiencing a
failed admin-user query follows the same redirect with no distinction or retry
path (F-005). Dialogs use the shared AlertDialog/Dialog primitives, so Escape
and backdrop dismissal are supplied by the component; focus-return behavior
and true browser navigation require manual confirmation.

### Phase 6 — Keyboard, shortcuts, and interaction

**Gated pass.** Clipboard and dialog interactions are present, but this
focused audit found no authorization-specific keyboard shortcut defect.
Manual clipboard and focus checks are listed below.

### Phase 7 — Tool and mode switching

**Skipped for this scope.** The session has multiple modes, but mode-specific
editing is outside the admin/realtime authorization surface except for the
permission-sensitive controls covered by F-004.

### Phase 8 — Settings and preferences

**Finding.** Owner-only Settings/Admin tab enablement is derived from the
admin-users request rather than a direct explicit permission state. It hides
controls correctly for ordinary users, but it also hides them silently for
owner-side request failures (F-005). The settings itself is not an
authorization boundary; server middleware remains authoritative.

### Phase 9 — Auth and session

**Findings.** Initial WebSocket admission checks identity and approval, and
periodic revalidation compares the fresh identity to the connected identity.
However, approval removal is not connected to immediate socket eviction (F-001),
and the client does not present session authorization denial or
authorization-change messages (F-003). The client does handle `auth_expired` by
navigating to sign-in.

### Phase 10 — UI feedback and polish

**Findings.** Admin mutation failures use generic destructive toasts, while
non-owner invite mutations expose controls and produce generic failure toasts
(F-002). Realtime denial is not surfaced at all (F-003). Loading indicators
exist for the primary admin list and mutations.

### Phase 11 — Data lifecycle

**Pass with authorization caveat.** Approval/rejection actions persist through
the server storage layer and refresh the user list. The server prevents
self-target changes and filters rejected users from the normal list. F-006
covers inaccurate confirmation scope; F-001 covers realtime data remaining
available after the persisted decision.

### Phase 12 — Cross-context

**Findings and manual boundary.** The socket room and presence cleanup paths
remove explicitly evicted or closed sockets, but account-level rejection does
not call that path (F-001). Role changes can leave another browser's
permission-sensitive UI stale after reconnect (F-004). Responsive layout,
browser zoom, multi-device timing, and real Clerk-cookie transition behavior
remain manual-QA items.

## Findings

Findings are de-duplicated and sorted by severity. Each finding is a distinct
root cause; no fix was applied.

### F-001

- **Journey:** 3 — Owner approves or rejects a user; 6 — Periodic identity and approval revalidation
- **Phase:** Phase 3 — Silent failure hunt; Phase 9 — Auth and session; Phase 12 — Cross-context
- **Severity:** Critical
- **Failure:** When an owner rejects an approved user or changes that user's approval to false, the database decision succeeds but active WebSocket connections for that user are not evicted. The socket remains in its session room and can continue receiving protected session broadcasts for up to the ten-minute revalidation interval. HTTP access is revoked sooner, but realtime access is not. This is a bounded authorization/data-exposure window.
- **Fix:** Connect the account-management mutation paths in `server/replit_integrations/auth/routes.ts` to the same session-wide socket eviction mechanism used by `server/routes.ts`, evicting every active socket for the target user after a successful rejection or approval removal and sending a clear authorization-change event before close. Add integration coverage for rejection and approval removal while a socket is receiving broadcasts.

### F-002

- **Journey:** 5 — Active session authorization changes; ordinary editor/viewer use of Team Management
- **Phase:** Phase 4 — Error and edge cases; Phase 10 — UI feedback and polish
- **Severity:** High
- **Failure:** Editors and viewers see the Username, Share Link, and Email invite controls in `TeamDialog`, even though the server allows only the session owner to add collaborators or create/revoke invite links. Clicking those controls produces a generic failure toast instead of explaining that the session owner must perform the action. The Tester Link is correctly owner-gated, so the boundary is inconsistent within the same dialog.
- **Fix:** In `client/src/pages/session/TeamDialog.tsx`, gate add-collaborator, invite-link generation/revocation, and email-invite affordances with `isOwner`; render a read-only explanation for editors/viewers. Keep server checks in `server/routes.ts` as the authority and add browser coverage for all three non-owner invite methods.

### F-003

- **Journey:** 4 — User opens a protected WebSocket session; 5 — Active session authorization changes
- **Phase:** Phase 3 — Silent failure hunt; Phase 9 — Auth and session
- **Severity:** High
- **Failure:** When a valid authenticated socket sends a join for a session it cannot access, the server sends `{ type: "error", message: "Access denied" }` but leaves the socket open. `use-websocket.ts` ignores generic `error` and `authorization_changed` messages, so the session header can continue to show the connection as healthy while no room was joined and cached session data remains visible. After an eviction-triggered close, the client can reconnect into the same silent denied-join state.
- **Fix:** Add an explicit authorization-denied state to `client/src/hooks/use-websocket.ts` and its session consumer. Handle denied joins and authorization-change events by stopping reconnect attempts for that session, invalidating protected session queries, and showing a clear access-revoked outcome or returning to the dashboard. The server should also close a socket that cannot join a requested room if the client cannot usefully remain connected.

### F-004

- **Journey:** 5 — Active session authorization changes
- **Phase:** Phase 2 — State and persistence; Phase 12 — Cross-context
- **Severity:** High
- **Failure:** When an owner changes a collaborator from editor to viewer or vice versa, the server evicts the socket and the client reconnects. The reconnect path invalidates entries, photos, pins, and incomplete pins, but not the session metadata query that supplies `session.role`. The affected user can therefore retain stale owner/editor/viewer controls until a full reload: a promoted viewer may not see newly available controls, while a demoted editor can still see controls that the server will reject.
- **Fix:** In `client/src/hooks/use-websocket.ts` or the session workspace reconnect handler, invalidate `/api/sessions/:id` after authorization-change/reconnect events and make permission-sensitive controls derive from the refreshed role. Add coverage for both editor-to-viewer and viewer-to-editor changes, including the visible control state before and after reconnect.

### F-005

- **Journey:** 1 — Owner opens account management; 2 — Ordinary user is denied account management
- **Phase:** Phase 3 — Silent failure hunt; Phase 5 — Navigation and dead ends; Phase 8 — Settings and preferences
- **Severity:** High
- **Failure:** The Admin user-list query returns `null` for every non-OK response. The UI uses the presence of an array as `isAdmin`, and redirects away from `#admin` whenever the value is not an array. A transient owner-side 401/403/5xx/network failure therefore looks identical to an intentional non-owner denial: the Admin tab disappears and the owner receives no error, retry action, or explanation.
- **Fix:** In `client/src/pages/settings.tsx`, preserve the response status/error state for `/api/admin/users`, distinguish intentional 403 owner denial from load failure, and render a retryable admin-load error for an authenticated owner instead of silently redirecting. Keep the server-side `ownerOnly` and per-route checks unchanged.

### F-006

- **Journey:** 3 — Owner approves or rejects a user
- **Phase:** Phase 2 — State and persistence; Phase 10 — UI feedback and polish
- **Severity:** Medium
- **Failure:** The rejected-user count query converts all failures into `{ count: 0 }`, and rejecting a user invalidates `/api/admin/users` but not `/api/admin/rejected-users/count`. The Clear Block List dialog can therefore show “Clear Block List” or an outdated blocked-user count while the actual server action still affects every rejected record. The confirmation does not reliably communicate the scope of a destructive action.
- **Fix:** In `client/src/pages/settings.tsx`, surface rejected-count query errors instead of treating them as zero, disable or qualify the destructive confirmation when the count is unavailable, and invalidate the count query after both rejection and clear-list mutations. Add a UI contract test for a rejected-count request failure and for rejection followed by opening the confirmation dialog.

## Confirmed passes and boundary clarifications

- **No owner bypass confirmed.** `isOwnerIdentity` checks only normalized
  `isOwner`; a username claim matching `REPL_OWNER` is insufficient by itself.
- **Admin HTTP boundary is server-enforced.** The `/api/admin` middleware calls
  `ownerOnly`, and the user approval routes also check owner identity. Hidden
  tabs are not treated as authorization.
- **Self-target protections pass.** The owner cannot reject or change their own
  approval through the account-management routes.
- **Admission states are distinct on the server.** Owner/tester identities are
  admitted directly; ordinary users require `approved && !rejected`; pending
  and rejected identities fail the shared approval middleware and initial
  WebSocket authorization.
- **Tester compatibility is distinct from admin authority.** Tester sockets are
  admitted and use `testerOwnerUserId` for session access as an editor, while
  tester identities are excluded from the Admin tab.
- **Per-session role enforcement is server-authoritative.** `verifySessionAccess`
  returns owner/editor/viewer, and session mutation routes enforce those roles.
  The stale UI role in F-004 is a control/feedback defect, not a confirmed
  server-side bypass.
- **Session collaborator revocation is stronger than account rejection today.**
  Removing a collaborator, changing a session role, transferring ownership, or
  deleting a session calls the socket eviction helpers. Account approval
  mutations do not.

## Manual QA needed

The following checks could not be conclusively verified through static
inspection and are not counted as findings:

- `[MANUAL QA NEEDED]` Use a real owner and non-owner Clerk browser session to
  verify the Admin tab, deep-link redirect, and direct 403 response together.
- `[MANUAL QA NEEDED]` With two browser contexts in one session, reject the
  connected user and observe whether any realtime data arrives before the
  ten-minute revalidation deadline.
- `[MANUAL QA NEEDED]` Remove a collaborator and change editor/viewer roles
  while the affected browser remains open; capture the close event, reconnect
  label, cached controls, and dashboard/session navigation.
- `[MANUAL QA NEEDED]` Exercise invite controls as editor and viewer at
  desktop and mobile widths; verify the unavailable-action explanation is
  understandable once F-002 is addressed.
- `[MANUAL QA NEEDED]` Verify AlertDialog Escape/backdrop focus return and
  clipboard behavior in the owner approval and Team Management journeys.

## Report-only stop

Report-only triage is complete. Findings are de-duplicated, assigned
sequential IDs, sorted by severity, and given concrete fix locations. No fix
loop, product-code edit, test edit, dependency change, or account-data change
was performed. Stop here and obtain explicit approval for any selected finding
before making changes.