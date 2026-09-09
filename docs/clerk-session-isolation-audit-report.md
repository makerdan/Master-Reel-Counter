# Clerk Session and Identity Isolation UX Audit Report

**Mode:** Report-only  
**Scope:** Clerk logout, session/token expiry, reauthentication, identity
switching, protected client-state cleanup, offline queues, browser storage,
second-tab behavior, and realtime lifecycle  
**Audit date:** 2026-09-09  
**Validation ceiling:** `test-heavy`  
**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 3 |
| High | 2 |
| Medium | 0 |
| Low | 0 |

The audit found three identity-boundary exposures that can allow state from a
previous browser identity to remain visible or become associated with the next
identity. It also found two expiry/re-authentication failures: realtime
expiry does not perform the same cleanup as logout, and an HTTP identity
failure is presented as an authorization rejection rather than a recoverable
reauthentication state.

No product or test fixes were applied. This report stops before the fix loop.

## Phase 0 — Discovery, scope, and app map

### Prior reports and seed context

`docs/ux-audit-report.md` is a prior report for the core session workflow. Its
Clerk internals, token-expiry behavior, and reauthentication checks were
explicitly outside its scope or marked manual QA. Its session-workflow finding
is not duplicated here.

The other Clerk audit workstreams are separate:

- Clerk entry and identity bridge: sign-in, sign-up, callback, proxy, and
  local-user provisioning.
- Clerk approval and protected routes: pending, rejected, and admission
  routing.
- Clerk admin and realtime authorization: owner/admin boundaries and
  permission changes.

This report covers only the identity lifecycle and state-isolation boundary.

### Detected stack and gates

- **Frontend:** React + TypeScript with Vite.
- **Routing:** Wouter, with Clerk path routing for `/sign-in` and `/sign-up`.
- **Client state/data:** TanStack Query, React state, Context, localStorage,
  sessionStorage, IndexedDB, service-worker caches, and WebSocket state.
- **Backend:** Express API backed by PostgreSQL (`backend: true`).
- **Authentication:** Clerk plus a separate development/tester session
  fallback (`auth: true`).
- **Realtime:** WebSocket session synchronization, reconnect state, presence,
  and server-side identity revalidation.
- **Multiple modes:** Session tabs and dashboard/session tools
  (`multi-tool: true`), although unrelated inventory-mode correctness is out
  of scope.
- **Interactions:** Logout guard, offline queue, uploads, dialogs, and
  realtime reconnect controls (`interactions: true`).

### Focused lifecycle journeys

1. **Clerk logout with clean client state**
   1. Start as Clerk user A on the dashboard or a protected session.
   2. Trigger sign out.
   3. Clear query state and protected service-worker data.
   4. Complete Clerk sign out and return to the app root.
   5. Reload the root route.
   6. Confirm the browser is signed out and no user-A state is visible.

2. **Logout with data-bearing protected state**
   1. Start as user A with active TanStack Query data.
   2. Open a session with a live WebSocket.
   3. Seed or create protected API/cache state and an offline queue item.
   4. Sign out, including the “Sign out anyway” branch.
   5. Confirm query, service-worker, browser storage, IndexedDB, and socket
      state are isolated before another identity is used.

3. **Token/session expiry and reauthentication**
   1. Start with a loaded protected session as user A.
   2. Let the Clerk/API credential expire or become invalid.
   3. Observe protected API responses and the WebSocket expiry message.
   4. Confirm the user receives an understandable expiry/re-authentication
      state rather than an authorization error or stale screen.
   5. Reauthenticate as A or a different user B.
   6. Confirm no user-A query, browser, offline, or realtime state is reused.

4. **Two-user switching in one tab**
   1. Load protected data as user A.
   2. Sign out or switch away from A.
   3. Sign in as user B in the same tab.
   4. Confirm the auth query, dashboard state, session state, and offline
      queue are bound to B.
   5. Open a session available to B and verify its data is fetched afresh.

5. **Two-user switching with a concurrent tester session**
   1. Keep a valid tester cookie in the browser.
   2. Sign in as Clerk user A.
   3. Sign out or invalidate A.
   4. Observe whether the browser is signed out or silently falls back to the
      tester identity.
   5. Confirm the resulting dashboard and session data belong to the
      explicitly selected identity.

6. **Second-tab logout and identity change**
   1. Open user A's protected session in tabs 1 and 2.
   2. Sign out or switch identities in tab 1.
   3. Observe tab 2's Clerk state, query cache, WebSocket, service-worker
      cache, and visible protected content.
   4. Reauthenticate as B in one tab.
   5. Confirm tab 2 cannot repopulate or display user-A state.

7. **Stale-session recovery**
   1. Start with stale Clerk or application-managed session material.
   2. Reload a protected route.
   3. Observe `/api/auth/user`, protected API, and WebSocket outcomes.
   4. Recover by signing in again or signing out.
   5. Confirm the recovery path is explicit and does not inherit the stale
      identity or its client state.

### Routes and lifecycle-relevant UI

The relevant route inventory is `/`, `/sign-in`, `/sign-up`,
`/session/:id`, `/settings`, `/stats`, `/help`, `/join/:token`,
`/tester-login`, and the not-found route. Protected routes are selected in
`AuthRouter`; Clerk widgets are mounted separately in
`ClerkProviderWithRoutes`.

Lifecycle-relevant controls include dashboard sign out, the logout guard,
pending/rejected-state sign out, the tester login form, offline pending and
failure panels, session WebSocket reconnect controls, and the Clerk
reauthentication screen.

### Client state inventory

- TanStack Query cache, including `/api/auth/user` and protected session
  queries.
- Service-worker cache `reel-counter-v1`.
- Legacy service-worker API caches prefixed `reel-counter-api-`.
- IndexedDB database `reel-counter-offline`, with `photo-queue` and
  `entry-queue`.
- Identity-bearing offline queue fields: optional `userId` values.
- User-sensitive dashboard state in sessionStorage, including search query,
  filters, sort state, and open folders.
- Global localStorage recent searches and last-session hint.
- Session-keyed localStorage/sessionStorage for session tabs, scanner state,
  undo/redo, review state, and dismissals.
- User-keyed help-guide state.
- In-memory WebSocket/reconnect state and `wsUserMap` server state.
- Clerk cookies/session state and the separate Express tester session cookie.

## Evidence and validation baseline

The repository was clean before the report-only audit and no application or
test files were edited. `docs/validation/failure-baseline.json` contains no
active records.

The plan-locked `test-heavy` command was run exactly once. Startup smoke
passed, including clean server startup on the validation port. The tier then
stopped at `security-audit`:

```text
multer <=2.2.0 — 4 high advisories
sharp <0.35.4 — 2 high advisories
2 high severity vulnerabilities
```

The remaining heavy-tier steps, including the Playwright run, did not execute.
This is recorded as a validation blocker, not as an identity-isolation
finding. The plan forbids escalation, and no dependency changes were made.
The failure is not authorized by an active baseline record; it remains
unresolved validation evidence for the project rather than being silently
waived.

The identity findings below are supported by code inspection. Existing
browser coverage in `tests/offline-queue.spec.ts` verifies protected
service-worker cache cleanup and network-only offline fallback, but it does
not switch between two Clerk users or verify IndexedDB queue ownership.
`tests/release/managed-clerk-auth.spec.ts` covers one managed Clerk user,
protected navigation, and logout, but not two-user switching, expiry, or
second-tab isolation.

## Phase results

### Phase 1 — Happy-path lifecycle sweep

**Completed by code inspection; live browser validation was blocked after the
security-audit step.** Clean Clerk logout clears the TanStack Query client and
requests service-worker protected-cache cleanup before calling Clerk
`signOut`. The normal managed-Clerk release test covers return to `/` and a
401 from `/api/auth/user` after logout. The clean path does not establish
IndexedDB or identity-sensitive browser-storage cleanup.

### Phase 2 — State and persistence

**Completed.** Query state is cleared when the observed Clerk/tester identity
changes, and the service worker is asked to remove protected API/object
responses. However, dashboard search/filter state and recent searches are not
identity-scoped. IndexedDB is retained across logout, and legacy queue records
without `userId` are accepted by the next identity. These confirmed failures
are F-001 and F-002.

There is no application-level `storage` event or `BroadcastChannel` listener
to clear a second tab's in-memory QueryClient or WebSocket state. Clerk's
provider may supply cross-tab session propagation, but that provider timing
cannot be established deterministically from this repository.

### Phase 3 — Silent failure hunt

**Completed; backend checks applicable.** Protected HTTP requests use
credentials and the server applies authentication middleware to `/api`
routes. Offline queue 401 responses invalidate the auth query, but ordinary
protected query failures have no global 401 handler that clears all protected
client state. The WebSocket `auth_expired` branch redirects directly to
`/sign-in` without clearing the QueryClient, protected service-worker data, or
realtime context and without passing an expiry reason. This is F-004.

### Phase 4 — Error and edge cases

**Completed.** The key edge states are stale Clerk credentials, a valid tester
cookie alongside an invalid Clerk identity, missing queue ownership, logout
while queued work exists, and service-worker cleanup timing out after two
seconds. The tester fallback can become the active identity after Clerk
logout/expiry, which is F-003. Queue ownership and cache cleanup failures have
no user-facing recovery message.

### Phase 5 — Navigation and dead ends

**Completed.** Clerk path routes, protected route selection, and the tester
logout redirect have defined targets. WebSocket expiry navigates to
`/sign-in`, but the route does not receive an expiry reason or return
destination. A user who reaches the `accessDenied` branch is shown the
rejected/access-denied page, which is not a reauthentication affordance.
The latter is recorded as F-005 rather than as a duplicate of the approval
route workstream.

### Phase 6 — Keyboard, shortcuts, and interaction

**Gated in for the focused interactions.** Logout dialogs, offline pending
state, and reconnect controls are present. Session editing shortcuts and
unrelated clipboard or drag-and-drop behavior are gated out of this
identity-only scope. Physical rapid double-click and touch behavior remains
manual QA.

### Phase 7 — Tool and mode switching

**Gated but narrowed to lifecycle effects.** The session has multiple modes,
but their inventory correctness is out of scope. The audit checked that
WebSocket reconnection invalidates session queries; identity-specific cleanup
after expiry is F-004. Mode-specific persistence is not re-audited here.

### Phase 8 — Settings and preferences

**Completed for identity-relevant preferences.** Theme and export quality are
global preferences and are not protected records. Dashboard search/filter
state and recent searches can contain user-entered session terms and are
not scoped or cleared consistently. This is part of F-002.

### Phase 9 — Auth and session

**Completed; auth gate open.** Clerk identity changes trigger query and
service-worker cleanup through `useAuth`, but logout does not clear the
offline IndexedDB stores or all user-sensitive browser state. A separate
valid tester cookie can be selected after Clerk identity resolution returns
undefined. The WebSocket has a ten-minute server revalidation interval and
redirects on `auth_expired`, but the client does not perform the full cleanup
contract. Findings F-001 through F-005 cover these lifecycle failures.

### Phase 10 — UI feedback and polish

**Completed.** Normal logout navigates to the public root, and offline queue
state has visible pending/failure controls. Expiry feedback is incomplete:
the WebSocket path silently sends the user to sign-in, while a failed
`/api/auth/user` lookup can render “Access Denied” with no indication that
reauthentication may solve the problem. These are included in F-004 and
F-005, not reported again as duplicate feedback findings.

### Phase 11 — Data lifecycle

**Completed for identity lifecycle only.** Query and service-worker cleanup
are attempted, but IndexedDB queue records survive logout by design and
unscoped legacy records can be claimed by the next identity. Browser search
state also survives. General session create/edit/delete and export/import
behavior is out of scope.

### Phase 12 — Cross-context

**Completed with manual boundaries.** The server tracks each WebSocket's
identity and revalidates it; client teardown guards prevent an intentionally
closed socket from reconnecting after the session component unmounts. The
client handles `auth_expired`, but not with full state cleanup. Second-tab
Clerk propagation, service-worker timing across tabs, true multi-device
revocation, and provider refresh timing require `[MANUAL QA NEEDED]`.

### Phase 13 — Triage and stop point

**Report-only triage completed.** Findings are de-duplicated, sorted by
severity, assigned sequential IDs, and given concrete fix locations. No fix
loop, product-code edit, test edit, dependency edit, or behavior change was
performed.

## Findings

Findings are ordered Critical → High. Any previous-user exposure is treated
as Critical under this audit's scope.

### F-001

- **ID:** F-001
- **Journey:** 2 — Logout with data-bearing protected state; 4 — Two-user
  switching in one tab
- **Phase:** Phase 2 — State and persistence; Phase 9 — Auth and session;
  Phase 11 — Data lifecycle
- **Severity:** Critical
- **Failure:** When user A signs out with offline entry or photo data still in
  IndexedDB, the logout path clears TanStack Query and asks the service worker
  to clear protected caches, but leaves the offline stores in place. Queue
  filtering treats records with no `userId` as belonging to whichever user is
  currently active. During a later user-B session, a legacy A record can
  appear in B's pending/failure UI or be uploaded under B's credentials and
  session context. The same race is possible when the legacy migration is
  still running during the first drain after identity change.
- **Fix:** Establish an explicit queue ownership boundary in
  `client/src/lib/offlineQueue.ts` and `client/src/hooks/use-network-status.ts`.
  Never treat a missing `userId` as the current user. On logout, either clear
  the current user's queued records or quarantine them behind an explicit
  “resume as previous account” flow; otherwise make migration complete under
  the original identity before any new identity can drain. Coordinate this
  with `clearClientState` in `client/src/hooks/use-auth.ts`. Add a browser
  contract that queues data as A, signs out, signs in as B, and asserts that B
  cannot count, display, drain, or retry A's queue.
- **Evidence:** `clearClientState` only calls `queryClient.clear()` and
  service-worker cleanup. `getQueuedPhotos` and `getQueuedEntries` include
  `!r.userId` records for any supplied user. `migrateQueueUserIds` stamps
  every missing owner with the current user, while `useNetworkStatus` starts
  migration without awaiting it before the initial queue drain. The existing
  offline browser test clears IndexedDB manually for its logout-guard case and
  does not cover an A→B identity transition.

### F-002

- **ID:** F-002
- **Journey:** 1 — Clerk logout with clean client state; 4 — Two-user
  switching in one tab; 6 — Second-tab logout and identity change
- **Phase:** Phase 2 — State and persistence; Phase 8 — Settings and
  preferences; Phase 9 — Auth and session
- **Severity:** Critical
- **Failure:** User-sensitive browser state survives identity changes. Recent
  search terms are stored in global localStorage and are loaded directly into
  the dashboard for the next identity. Dashboard search text, filters,
  sorting, and open-folder state are stored in tab-wide sessionStorage and
  are cleared only by the dashboard's logout-confirmation branch. Logout from
  another lifecycle path, token expiry, pending/rejected sign out, or a
  second-tab transition can leave the previous user's terms visible to the
  next user. A last-session hint is also global and can point at the previous
  user's most recently visited session.
- **Fix:** In `client/src/lib/storageKeys.ts` and
  `client/src/pages/dashboard.tsx`, scope user-sensitive dashboard keys by the
  authenticated application identity, including recent searches, last-session
  hints, search text, filters, sort state, and open folders. Centralize
  identity-transition cleanup in `clearClientState` in
  `client/src/hooks/use-auth.ts` so it runs for logout, Clerk identity
  changes, and expiry recovery rather than only from one dashboard dialog.
  Add a same-tab A→B browser test and a reload-after-logout assertion for
  every user-sensitive key.
- **Evidence:** `RECENT_SEARCHES_KEY` is read and written without an identity
  suffix in `dashboard.tsx`. Dashboard sessionStorage values are initialized
  directly from fixed `dash:*` keys. `LAST_SESSION_KEY` is global by the
  registry and is consumed to render a “Continue” card. The logout dialog
  clears only a list of dashboard session keys; `useAuth.clearClientState`
  does not clear or rotate these values.

### F-003

- **ID:** F-003
- **Journey:** 5 — Two-user switching with a concurrent tester session;
  7 — Stale-session recovery
- **Phase:** Phase 4 — Error and edge cases; Phase 9 — Auth and session
- **Severity:** Critical
- **Failure:** If a browser has a valid tester session cookie and the Clerk
  credential is logged out, expired, or otherwise cannot be resolved, the
  application silently falls back to the tester identity instead of reaching
  a signed-out state. A Clerk user can therefore press sign out and land in a
  different identity's dashboard and session data, with no identity-switch
  explanation. The same fallback can occur during stale-session recovery.
- **Fix:** Make identity transitions explicit in
  `server/replit_integrations/auth/replitAuth.ts`. Do not fall through to a
  tester identity after a browser presented a Clerk session that became
  invalid; require an explicit tester-login action to establish that identity.
  Update `client/src/hooks/use-auth.ts` so Clerk logout/expiry destroys or
  blocks the separate tester session before navigating to the public or
  reauthentication state. Preserve the deliberate compatibility path only
  when the browser is already in an explicitly established tester session.
  Add a contract test with both cookies present, followed by Clerk logout and
  expiry, asserting the resulting identity and protected data.
- **Evidence:** `resolveIdentity` returns `clerkIdentity(req) ?? testerIdentity(req)`.
  `logout` calls Clerk `signOut` when the resolved local user is not a tester,
  but does not destroy the tester session in that branch. The server comment
  says Clerk wins when both cookies are supplied, which is true only while
  the Clerk cookie is valid; an invalid Clerk resolution activates the
  fallback instead.

### F-004

- **ID:** F-004
- **Journey:** 3 — Token/session expiry and reauthentication;
  6 — Second-tab logout and identity change
- **Phase:** Phase 3 — Silent failure hunt; Phase 9 — Auth and session;
  Phase 10 — UI feedback and polish; Phase 12 — Cross-context
- **Severity:** High
- **Failure:** When the server detects that a long-lived WebSocket no longer
  has the connected identity, it sends `auth_expired`. The client redirects
  to `/sign-in` but does not clear the TanStack Query cache, ask the service
  worker to clear protected data, stop or reset global realtime state, or
  explain why the user was redirected. If the Clerk provider's identity
  update is delayed, protected data can remain in the query cache through
  reauthentication and the user receives no actionable expiry message.
- **Fix:** Route WebSocket expiry through the same centralized lifecycle
  cleanup used by `useAuth.logout` and identity changes. In
  `client/src/hooks/use-websocket.ts`, clear protected query/cache state,
  stop pending reconnect work, and publish an explicit session-expired
  reason before navigating. Add a safe return destination after successful
  reauthentication and show whether queued work was preserved. Cover the
  message path with a browser test that injects `auth_expired`, verifies
  cleanup, and reauthenticates as both the same and a different user.
- **Evidence:** The `auth_expired` branch in `use-websocket.ts` only sets
  `shouldReconnectRef.current = false` and assigns the sign-in URL. Query
  invalidation occurs for reconnect/sync messages, but no query clear or
  service-worker cleanup occurs in that branch. The server checks identity
  again only every ten minutes after the socket is established.

### F-005

- **ID:** F-005
- **Journey:** 3 — Token/session expiry and reauthentication;
  7 — Stale-session recovery
- **Phase:** Phase 5 — Navigation and dead ends; Phase 9 — Auth and session;
  Phase 10 — UI feedback and polish
- **Severity:** High
- **Failure:** A protected `/api/auth/user` request that returns 401 is
  converted to `null`, while the Clerk identity can remain present. The
  client then sets `accessDenied` and renders the rejection-style “Access
  Denied” page. The user is told the account is unauthorized rather than
  being told that the session expired and needs reauthentication. The
  Clerk identity key has not changed, so the identity-transition cleanup
  effect is not guaranteed to run; the user has no direct reauthenticate
  action and must use Sign Out.
- **Fix:** Distinguish an expired/unauthenticated bridge response from a
  permanently rejected local account in `client/src/hooks/use-auth.ts` and
  `client/src/App.tsx`. On a 401 while Clerk still reports a session, clear
  protected client state, stop realtime work, and render an explicit
  “Your session expired — sign in again” recovery state that preserves only a
  safe return path. Keep 403/rejected handling separate. Add browser coverage
  for a 401 bridge response followed by same-user and different-user
  reauthentication.
- **Evidence:** `fetchUser` maps every 401 to `null`; `accessDenied` is
  `!!isSignedIn && !localUser && !isLoading`; `AuthRouter` maps
  `accessDenied` to `<PendingApproval status="rejected" />`; and the
  rejected page offers only “Sign Out”. `authIdentity` remains the Clerk user
  ID while the local bridge is null, so the identity-change cleanup condition
  does not by itself cover this state.

## Manual-QA and unavailable evidence boundaries

These checks are required before remediation or release closure but are not
counted as additional findings because the repository cannot deterministically
prove provider and browser behavior:

- **[MANUAL QA NEEDED]** Verify Clerk's cross-tab session propagation when tab 1
  logs out and tab 2 has loaded protected QueryClient data and a live socket.
- **[MANUAL QA NEEDED]** Use DevTools to expire or revoke a Clerk session while
  a protected page is open; record whether the provider changes identity before
  the first 401 and whether stale content remains visible.
- **[MANUAL QA NEEDED]** Exercise same-tab A→B and A→tester switching with
  both Clerk and tester cookies present; inspect IndexedDB, Cache Storage,
  localStorage, sessionStorage, QueryClient-visible data, and WebSocket close
  reasons.
- **[MANUAL QA NEEDED]** Verify provider timing around the ten-minute
  WebSocket revalidation interval and a concurrent logout in another tab.
- **[MANUAL QA NEEDED]** Verify a true multi-device revocation: device 1
  remains open while device 2 revokes or signs out the account. This cannot be
  established by the local browser harness.
- **[MANUAL QA NEEDED]** Verify physical rapid logout/re-authentication clicks,
  mobile touch behavior, and focus restoration for the logout guard and
  expiry recovery state.
- **Gated out:** initial sign-in/sign-up and local provisioning, pending/
  rejected approval UX as a standalone journey, owner/admin controls,
  collaboration-role semantics, general offline inventory correctness, and
  unrelated session editing/export behavior.

## Report-only stop

This audit intentionally stops here. No findings were fixed, no product or
test behavior was modified, no dependency was upgraded, and no new regression
test was added. The recommended remediation order is F-001, F-002, and F-003
first because they cross an identity boundary; F-004 and F-005 should follow
to make expiry and reauthentication use the same safe cleanup contract.