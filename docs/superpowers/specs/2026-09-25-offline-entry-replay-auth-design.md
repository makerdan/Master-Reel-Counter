# Offline entry replay authentication in the browser test

## Scope and evidence

The offline-entry lost-response browser test gets a `401 Unauthorized` from its first intercepted `route.fetch()` call. The same failure occurs on the pre-task revision. Authenticated API fixture requests and the browser's `/api/auth/user` request work; the app's API helper already sends credentials. No user-visible 401 has been reported. Keep the server's authentication and approval boundaries unchanged.

## Design

Keep the browser test's two-attempt lost-response scenario. On the first intercepted entry POST, copy its exact serialized body and idempotency key into a POST made by the test's already-authenticated API request fixture. Assert that this request commits successfully and capture the entry ID, then abort the intercepted browser response to simulate a connection reset after commit. On the retry, let the browser request continue without interception and capture its response status. Assert that the retry returns 200, both browser attempts carry the same nonempty operation ID, there is exactly one entry, and the intended photo pin points to that entry.

The fixture must not inject authentication cookies or bypass the API's authorization middleware. If the unmodified browser retry receives a 401, stop and investigate the browser request rather than disguising that failure with a fulfilled mock response.

## Verification

Run the focused browser replay test to establish that the test-side repair works and retains the duplicate/pin assertions. Run the task plan's locked `test-standard-plus` tier for the timezone statistics work. Do not escalate the task validation ceiling; completion validation is managed separately.