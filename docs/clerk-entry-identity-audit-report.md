# Clerk Entry and Identity Bridge UX Audit Report

**Mode:** Report-only  
**Scope:** Clerk entry journey and the browser-to-local identity bridge  
**Audit date:** 2026-09-09  
**Validation ceiling:** `test-heavy`  
**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 2 |
| Medium | 0 |
| Low | 0 |

The signed-out landing and route wiring are present, the application shows a
loading state while Clerk and the local user query settle, and the server
normalizes the Clerk claim into the local user record before returning
`/api/auth/user`. The code and release contract provide a clear approved-user
path through the managed proxy.

Two entry failures were confirmed by code inspection:

1. A non-401 failure in the local identity bridge is presented as an account
   rejection instead of a retryable service/identity error.
2. An unauthenticated protected deep link renders the public landing page but
   does not carry the original destination into sign-in or sign-up.

The local browser preview supplied signed-out landing evidence. Live Clerk
provider completion was not available in this run: the mandated heavy tier
stopped at its pre-existing dependency audit failure, and the development
preview logged a Clerk key-mismatch redirect-loop warning. Provider-dependent
checks are explicitly marked `[MANUAL QA NEEDED]` below.

## Phase 0 — Discovery, scope, and app map

### Detected stack and gates

- **Frontend:** React + TypeScript with Vite.
- **Routing:** Wouter with a base path, plus Clerk path routing for
  `/sign-in/*?` and `/sign-up/*?`.
- **Client state/data:** TanStack Query, React state, and Clerk browser session
  state.
- **Backend:** Express API backed by PostgreSQL (`backend: true`).
- **Authentication:** Clerk browser session plus a server-side local-user
  bridge (`auth: true`).
- **Managed proxy:** Production Clerk Frontend API proxy at
  `/api/__clerk`; the readiness endpoint is `/api/__clerk/healthz`.
- **Multiple modes:** The application has multiple session modes, but tool
  switching is outside this entry audit (`multi-tool: true`, gated out for
  this scope).
- **Interactions:** The app has broader keyboard, upload, and realtime
  interactions, but the Clerk widgets are third-party components; their
  internals are not audited.

### Route and identity map

1. `/` — signed-out landing or approved-user dashboard.
2. `/sign-in/*?` — Clerk path-routed sign-in widget.
3. `/sign-up/*?` — Clerk path-routed sign-up widget.
4. `/session/:id` — protected session deep link.
5. `/settings`, `/stats`, `/join/:token`, and `/help` — protected application
   routes used to confirm post-bridge arrival.
6. `/api/__clerk/*` — production-only managed Clerk Frontend API proxy.
7. `/api/__clerk/healthz` — proxy readiness response.
8. `/api/auth/user` — authenticated local-user response.

The server obtains Clerk claims through `getAuth(req)`, uses the normalized
`userId` claim as the local database key, creates a missing local user with
`createUserIfMissing`, and returns the local record from `/api/auth/user`.
Clerk's native user ID is not substituted for the migration/bridge identifier.

### Selected entry journeys

Each journey is intentionally focused and contains 5–15 steps.

1. **Signed-out landing to sign-in**
   1. Open `/` with no Clerk session.
   2. Confirm the landing title, sign-in CTA, and public content render.
   3. Select **Sign In**.
   4. Confirm the browser enters `/sign-in`.
   5. Complete the provider form.
   6. Observe client-trust or callback route states.
   7. Wait for `/api/auth/user` and the approved application view.

2. **Signed-out landing to sign-up**
   1. Open `/` with no Clerk session.
   2. Select **Get Started**.
   3. Confirm the browser enters `/sign-up`.
   4. Complete the provider sign-up and verification steps.
   5. Observe callback completion.
   6. Wait for local-user provisioning.
   7. Confirm the resulting pending or approved application state.

3. **Callback completion to the local identity bridge**
   1. Start from a clean signed-out browser.
   2. Complete Clerk sign-in or sign-up.
   3. Observe `/sign-in/client-trust` when Clerk uses that state.
   4. Confirm the browser leaves the Clerk route rather than looping.
   5. Request `/api/auth/user` with same-origin credentials.
   6. Confirm the returned ID is the intended local ID.
   7. Confirm email and approval fields belong to that same local record.

4. **Approved-user arrival**
   1. Complete the callback for a pre-approved local user.
   2. Wait for the application loading spinner to end.
   3. Confirm the dashboard is visible.
   4. Navigate to Settings.
   5. Navigate to Stats.
   6. Return to the dashboard.
   7. Confirm no signed-out landing or account-mismatch state appears.

5. **Protected deep-link entry**
   1. Open `/session/:id` while signed out.
   2. Confirm the application does not expose protected session content.
   3. Select the landing sign-in CTA.
   4. Complete sign-in.
   5. Observe callback completion.
   6. Confirm the original session destination is restored.
   7. Confirm the target session loads only after the local bridge succeeds.

6. **Bridge and provider failure recovery**
   1. Start sign-in from a clean browser.
   2. Refresh during a Clerk route transition.
   3. Exercise a provider/network failure.
   4. Exercise a non-401 `/api/auth/user` response.
   5. Inspect the visible error and retry path.
   6. Use browser back navigation.
   7. Confirm duplicate callback completion does not expose an incorrect
      application identity.

### Persistent state inventoried for this scope

- Clerk browser session and Clerk user ID.
- TanStack Query cache keyed by `/api/auth/user` plus Clerk identity state.
- The local user record in PostgreSQL.
- Same-origin session cookies used by Express and Clerk.
- The current Wouter route and any provider callback route state.

## Evidence and validation baseline

### Mandated validation

The plan-locked command was run exactly as required:

```text
TASK_PLAN_FILE=.local/tasks/task-557.md npm run test-heavy
```

Results:

- `startup-smoke`: passed.
- `security-audit`: failed before later heavy-tier steps.
- Failure: `multer@2.2.0` has high-severity advisories and `sharp@0.35.3`
  is below the patched `0.35.4` threshold.
- Three isolated `npm audit --audit-level=high` retries reproduced the same
  failure.
- No active baseline records existed. The failure is
  **[SELF-CLASSIFIED PRE-EXISTING]** because the Clerk-relevant working tree
  was unchanged, the exact failure reproduced three times, and the existing
  dependency-update task documents the same vulnerable packages. This is
  unrelated to the entry/identity audit and was not modified here.
- The heavy tier therefore did not reach its browser-tests step. No heavier or
  substitute validation tier was run.

### Available browser evidence

The local application workflow was restarted for the browser sweep. At
1280×720:

- the signed-out landing rendered its testing banner, brand/header, hero image,
  title, and descriptive copy;
- the sign-in and sign-up entry links are present in the source;
- the signed-out `/api/auth/user` request returned HTTP 401, which is the
  expected unauthenticated response;
- the local preview logged a Clerk development-key
  “session token ... infinite redirect loop” warning. This is provider
  configuration evidence, not a confirmed application defect, and is listed
  as `[MANUAL QA NEEDED]`.

The existing release contract in
`tests/release/managed-clerk-auth.spec.ts` records route states, proxy request
paths, request failures, local identity fields, approved navigation, and
signed-out cleanup. It is the available browser contract for the intended
production candidate, but it could not execute in this run because the heavy
tier stopped before browser tests.

## Phase results

### Phase 1 — Happy-path entry sweep

**Partially completed.** The signed-out landing was observed in the local
browser. Sign-in and sign-up route components, CTAs, and Clerk path routing
were confirmed by code. Live provider completion, sign-up verification, and
approved-user arrival are **[MANUAL QA NEEDED]** because the provider smoke
could not run in this validation attempt.

### Phase 2 — State and persistence

**Completed by code inspection.** The `/api/auth/user` query key includes the
Clerk identity state, uses `refetchOnMount: "always"`, and does not retry
failed bridge requests automatically. The Clerk listener clears the query
cache when the Clerk user ID changes. The final route after callback and
refresh behavior remain **[MANUAL QA NEEDED]**.

### Phase 3 — Silent failure hunt

**Completed; backend checks applicable.** The server returns a clear 401 for
missing authentication and a 500 for an exception while reading the local
user. The client correctly treats 401 as signed out, but it does not expose
the query error separately from a signed-in user with no local record.
F-001 is the confirmed user-visible failure.

### Phase 4 — Error and edge cases

**Completed by code inspection with live-provider boundaries.** Loading and
unauthenticated states are present. Non-401 bridge errors, malformed/stale
provider claims, refresh during a provider transition, duplicate callback
completion, and provider/network failure are **[MANUAL QA NEEDED]** where
actual Clerk behavior is required.

### Phase 5 — Navigation and dead ends

**Completed by code inspection.** Wouter routes exist for the landing,
provider, dashboard, and protected views. A signed-out protected route falls
back to the landing component, but the sign-in/sign-up links do not preserve
the original protected destination. F-002 is the confirmed deep-link
navigation failure.

### Phase 6 — Keyboard, shortcuts, and interaction

**Gated out for this scope.** Clerk widget keyboard and focus behavior belongs
to the third-party provider. Application-level keyboard shortcuts, drag and
drop, and clipboard interactions are not part of entry routing.

### Phase 7 — Tool and mode switching

**Gated out for this scope.** Session modes are present elsewhere in the
application, but switching them is not required to enter or bridge a Clerk
identity.

### Phase 8 — Settings and preferences

**Gated out for this scope.** Settings are only used as a post-arrival
navigation check; their controls are covered by the separate application
workflow audit.

### Phase 9 — Auth and session

**Completed for entry guards; provider lifecycle is manual.** Signed-out
protected views do not render protected content, and signed-in users wait for
both Clerk and the local user query. Approval and rejection decisions are
out of scope. Token expiry and reauthentication are out of scope.

### Phase 10 — UI feedback and polish

**Partially completed.** The initial bridge wait has a visible full-screen
spinner. The rejected and pending screens have explanatory copy and sign-out
actions. A bridge exception is incorrectly presented as “Access Denied” in
F-001. Clerk widget loading, provider errors, focus return, and responsive
widget layout are **[MANUAL QA NEEDED]**.

### Phase 11 — Data lifecycle

**Completed by code inspection for local provisioning.** The existing-user
lookup is performed before provisioning; missing users are inserted with
`createUserIfMissing`, which uses conflict-safe creation and verifies the
record exists before returning. The `/api/auth/user` response is based on the
same normalized local ID. Live sign-up creation and post-callback database
verification are **[MANUAL QA NEEDED]**.

### Phase 12 — Cross-context

**Completed with manual visual boundaries.** The landing has a usable empty
signed-out state and the local preview had no visible initial blank screen.
Mobile widths, browser zoom, provider iframe/widget layout, back navigation
through client trust, and refresh during callback are **[MANUAL QA NEEDED]**.

### Phase 13 — Triage and stop point

**Report-only triage completed.** Findings are sequential, de-duplicated, and
sorted by severity. No application code, test code, Clerk configuration,
secret, deployment, or dependency behavior was changed.

## Findings

### F-001

- **ID:** F-001
- **Journey:** 3 — Callback completion to the local identity bridge; also
  affects Journey 4 — Approved-user arrival
- **Phase:** Phase 3 — Silent failure hunt; also confirmed in Phase 10 —
  UI feedback and polish
- **Severity:** High
- **Failure:** If a signed-in Clerk user reaches a non-401 failure while
  `/api/auth/user` is being resolved, the query has no local user data and
  `useAuth` sets `accessDenied` to true once loading ends. `AuthRouter` then
  renders the rejected-account screen with “Access Denied.” The user cannot
  tell that the identity bridge or server failed, has no retry action, and may
  wrongly contact the owner even when the account is approved.
- **Fix:** In `client/src/hooks/use-auth.ts`, expose the local-user query error
  and refetch action separately from `localUser === null`. In
  `client/src/App.tsx`, reserve `accessDenied` for a successful bridge result
  that explicitly returns no local user; render a retryable bridge/service
  error for 5xx, network, or malformed-response failures. Keep the response
  generic enough not to expose provider or database details, and verify the
  signed-in user can retry without being treated as rejected.
- **Evidence:** `fetchUser` returns `null` only for HTTP 401 and throws for
  every other non-OK response (`client/src/hooks/use-auth.ts:6-20`).
  `useAuth` returns only `localUser`, `isLoading`, and `accessDenied`; it does
  not return the query error (`client/src/hooks/use-auth.ts:70-124`).
  `AuthRouter` maps `accessDenied` directly to
  `<PendingApproval status="rejected" />` (`client/src/App.tsx:156-170`).
  The rejected screen says the account is unauthorized and offers only sign
  out (`client/src/pages/pending-approval.tsx:8-55`). This path is
  code-confirmed; live provider/network reproduction is
  **[MANUAL QA NEEDED]**.

### F-002

- **ID:** F-002
- **Journey:** 5 — Protected deep-link entry
- **Phase:** Phase 5 — Navigation and dead ends
- **Severity:** High
- **Failure:** A signed-out user who opens a protected route such as
  `/session/:id` is shown the public landing page at that route. The landing
  sign-in and sign-up links navigate to `/sign-in` or `/sign-up` without
  carrying the original path, and the Clerk widgets are not given an
  application-level fallback destination. After a successful callback, the
  user can arrive at the default application destination instead of the
  session they originally opened. The user must rediscover or re-open the
  deep link.
- **Fix:** In `client/src/App.tsx`, capture the current protected pathname and
  query/hash before rendering the signed-out entry surface. Pass a validated,
  same-origin return destination through the sign-in and sign-up links and
  into Clerk's fallback/force redirect configuration. Restore the destination
  only after the local identity bridge succeeds; reject external redirect
  URLs. Add a browser contract for `/session/:id` and at least one other
  protected deep link.
- **Evidence:** The protected route renders `<Landing />` whenever `user` is
  absent (`client/src/App.tsx:180-182`). The landing CTAs are plain links to
  `${basePath}/sign-in` and `${basePath}/sign-up` with no return parameter
  (`client/src/pages/landing.tsx:315-327` and `420-425`). The Clerk
  components configure path routing and reciprocal sign-in/sign-up URLs but
  no explicit return destination (`client/src/App.tsx:200-212`); the provider
  only receives the top-level path URLs (`client/src/App.tsx:250-269`).
  The final provider callback destination is **[MANUAL QA NEEDED]** because
  the live Clerk provider was not available in this validation run.

## Blocked and manual-QA checks

These are not counted as confirmed product findings:

- **[MANUAL QA NEEDED]** Complete a real Clerk sign-in through
  `/api/__clerk`, including `/sign-in/client-trust` when present, and record
  the final route and proxy request paths.
- **[MANUAL QA NEEDED]** Complete a real sign-up, verification, callback, and
  first local-user provisioning flow, then verify the returned local ID and
  approval state.
- **[MANUAL QA NEEDED]** Confirm a signed-in user whose `/api/auth/user`
  request returns 500, times out, or loses connectivity receives retryable
  bridge feedback rather than the rejection screen.
- **[MANUAL QA NEEDED]** Open `/session/:id` and another protected deep link
  signed out, complete sign-in and sign-up separately, and confirm each
  original destination is restored.
- **[MANUAL QA NEEDED]** Refresh during sign-in, client trust, and callback;
  use browser back; and repeat callback completion to check for loops,
  duplicate provisioning, and lost return destinations.
- **[MANUAL QA NEEDED]** Test malformed or stale Clerk sessions and confirm
  they fail closed without exposing a different local account.
- **[MANUAL QA NEEDED]** Verify provider error copy, keyboard focus, mobile
  layout, browser zoom, and visual loading transitions in the embedded Clerk
  widgets.
- **Gated out:** pending/rejected approval controls, logout, token expiry,
  identity switching, offline-cache cleanup, WebSocket revalidation,
  admin-only authorization, per-session roles, tester removal, and
  application mode switching.

## Report-only stop

This audit intentionally stops here. No findings were fixed, no application
or test behavior was modified, no Clerk or secret configuration was changed,
and no deployment behavior was changed. F-001 is the first recommended fix
because it converts a service/bridge failure into a misleading authorization
decision. F-002 should follow so shared or bookmarked protected routes return
users to the content they intended to open. The provider-dependent checks
should be completed against the managed release candidate before either fix is
released.