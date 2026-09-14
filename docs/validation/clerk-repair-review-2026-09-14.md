# Complete Clerk repair review

Date: 2026-09-14

## Review boundary

- Reviewed source revision: `42d3ae284a0b425d76b546884e2800ff67da846e` plus the current review corrections in the working tree
- Combined repair range: `fa37c7d..42d3ae284a0b425d76b546884e2800ff67da846e`
- Review included client bootstrap and recovery, production proxy configuration, local identity and role mapping, schema preparation, service-worker cache behavior, realtime authorization, browser fixtures, and release gates.
- The workspace Clerk configuration was identified as externally managed. No credential values were read or recorded.

## Independent review result

Two independent architect reviews found unresolved high-severity integration defects. The combined repair cannot be approved yet.

| Severity | Finding | Evidence | Ownership/status |
| --- | --- | --- | --- |
| High | Production and release startup require both server and client publishable-key variables, but the configured release workflow passes only the client variable. The exact candidate can fail before opening its port. | `shared/clerk-config.ts`, `server/index.ts`, `server/replit_integrations/auth/replitAuth.ts`, `.github/workflows/managed-clerk-release.yml`, `scripts/build-and-verify-release.sh` | Unresolved; published sign-in repair tasks own the release prerequisite. |
| High | A just-in-time-created external-ID account can be passed to the initial-owner promotion check as if it existed before sign-in. On a database with no Admin, an owner-matching username can be promoted. | `server/replit_integrations/auth/replitAuth.ts`, `server/replit_integrations/auth/storage.ts` | Unresolved; simultaneous first-sign-in safety tasks own this race/trust-boundary correction. |
| High | The canonical heavy browser fixture currently stores its Admin row under the native Clerk ID while the bridge resolves the supplied external ID first, so the intended approved Admin session is not established. | `tests/global-setup.ts`, `server/replit_integrations/auth/replitAuth.ts` | Unresolved; the active heavy-browser Admin/User schema task owns this fixture. |
| High | Production database is missing the reviewed role and durable Clerk identity schema. | Read-only production query reported no `users.role`, no `users.clerk_user_id`, and no `account_role` values. Development was updated through the authorized development schema path and now has the required schema. | Production requires a new user-triggered Publish and subsequent read-only verification. |

No additional critical/high defect was found in the reviewed service-worker cache admission and cleanup logic, additive Clerk identity migration, release diagnostic redaction, or bounded pre-authentication realtime buffering.

## Corrections made during this review

- Removed a duplicate `scripts` object from `package.json`, preserved all previously effective commands, and restored three commands that the duplicate key had shadowed, including Clerk bootstrap contract coverage.
- Strengthened recovery coverage to require a loaded Clerk instance and visible sign-in UI after retry.
- Strengthened the exact-candidate smoke to require one successful Clerk browser script response from the candidate origin and canonical proxy path with a JavaScript content type.
- Made the development server use the client publishable key when the separate server publishable key is absent, while keeping production and release validation strict.

Focused deterministic release-contract result: **passed**, 41 tests total across both command phases.

Focused recovery browser result: **passed**, 1 test against the development preview with a fresh signed-out browser context before the later key-mismatch runtime was observed.

## Canonical heavy-tier result

Command:

```text
TASK_PLAN_FILE=.local/tasks/task-646.md npm run test-heavy
```

The initial run failed at `browser-tests` because the development database had not yet received the auth schema. After applying the authorized development schema, the canonical tier was rerun on the same reviewed checkout.

The post-schema run passed every step through browser setup and then failed at disposable Clerk-user provisioning with:

```text
ClerkAPIResponseError: Forbidden
at tests/global-setup.ts:69
```

This is a provider-permission blocker, not a schema-preflight failure. The Clerk API secret available to the test does not have the permissions required to create the disposable browser user.

Passed before the failure:

- startup smoke
- dependency security audit
- schema source check
- workspace skill contract
- TypeScript checks
- storage-key lint
- backend unit tests
- Vite/HMR tests
- serial-lock tests
- port-authority tests
- validation manifest parity
- collision smoke

Superseded initial failure:

```text
Release schema preflight failed before fixture provisioning:
missing users.clerk_user_id, users.role, account_role=Admin,
account_role=User in the development database.
```

The initial empty failure baseline authorized no ignore. The post-schema `403 Forbidden` is the current blocking result. No browser scenarios ran after fixture provisioning was denied.

## Scenario evidence matrix

| Scenario | Environment | Status | Evidence |
| --- | --- | --- | --- |
| Signed-out Clerk script and sign-in UI | Real development preview | Passed | After the development-only key fallback, `/sign-in` rendered the branded Clerk form with Google available and no redirect-loop error. Screenshot: `screenshots/task-646-preview-sign-in-final.jpg`. |
| Clerk script HTTPS host, status, path, MIME and bounded CSP | Development preview suite | Not exercised in the task-locked heavy run | Dedicated behavioral test exists in `tests/clerk-preview-bootstrap.spec.ts`; heavy stopped in global setup before browser specs. |
| Script outage and successful retry | Development browser | Passed | Focused recovery spec passed again after the key fallback: it aborted the Clerk script, showed the safe recovery view, retried from a fresh signed-out context, preserved the return path, reached `Clerk.loaded`, and rendered the sign-in UI. |
| Approved Admin session and local identity | Development browser | Blocked | Development schema preflight now passes, but Clerk disposable-user creation returns `403 Forbidden` before fixture creation. The source fixture still uses the reviewed external-ID path and cannot be revalidated until provider permissions are available. |
| Approved User role | Exact release candidate | Blocked | Google Admin/User release spec exists, but matched production prerequisites and current schema are unavailable. |
| Pending and rejected accounts | Deterministic server coverage | Passed | Unit tests passed for distinct pending/rejected authorization outcomes and WebSocket denial. |
| Pending and rejected browser states | Exact release candidate | Not exercised | Current release specs create approved users only. No success is inferred from server-only tests. |
| Protected settings, stats and dashboard navigation | Exact release candidate | Blocked | Behavioral smoke exists, but exact-candidate execution is blocked by release key and schema prerequisites. |
| Logout, signed-out API status and protected cache clearing | Exact release candidate | Blocked | Behavioral assertions exist, but exact-candidate execution did not run. |
| Account transition query-cache clearing | Deterministic client/source coverage | Passed | Clerk listener clears the query client when the native Clerk user ID changes; TypeScript and contract checks passed. Authenticated browser execution was blocked. |
| Worker upgrade and invalid-script/protected-cache cleanup | Browser coverage | Not exercised in this run | Behavioral service-worker tests exist; heavy stopped before browser specs. Source and unit review found no high-severity defect. |
| Bounded pre-auth realtime messages | Deterministic unit coverage | Passed | Count, byte, timeout, disconnect, late-authentication and ordered-drain tests passed in the heavy unit step. |
| Socket-level authorization after role/access changes | Browser/realtime integration | Not exercised | Deterministic authorization and eviction tests passed; no socket-level candidate execution occurred. Existing project tasks cover related stale-access and collaborator cases. |
| Exact candidate Clerk script delivery | Exact release candidate | Blocked | Smoke now requires the candidate origin, canonical proxy script path, status 200 and JavaScript MIME. It cannot run until matched production keys and isolated schema prerequisites are available. |
| Real Google OAuth completion | Published production | Blocked | A testing-token email sign-in is not real Google OAuth. A new user-triggered Publish and provider-capable test account are required. |
| Development schema prerequisite | Development read-only query | Passed | Development now has `users.role`, `users.clerk_user_id`, and `account_role`; the obsolete `sessions` table is absent. Five legacy tester accounts were removed by the authorized migration. |
| Production schema prerequisite | Production read-only query | Failed | Production lacks `users.role`, `users.clerk_user_id`, and the `Admin`/`User` enum values. No production write was attempted. |
| New published revision | Production | Not exercised | No publish was triggered during this task. Existing live URLs or older builds are not evidence for this revision. |

## Publish-readiness conclusion

**Not ready to publish.**

The review cannot certify the combined Clerk repair while high-severity release-key, provider-permission, initial-owner, browser-fixture, and production-schema blockers remain. Production schema changes and live-key substitution must be exercised only by a new user-triggered Publish. After the provider permissions and remaining owners are resolved, rerun the canonical heavy tier, the exact-candidate release gate, the real preview authenticated Admin/User flows, and the newly published Google flow before changing this conclusion.
