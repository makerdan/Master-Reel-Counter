# API Runtime Reliability Audit Report

**Scope:** API-server startup and listen lifecycle, graceful shutdown and drain,
WebSocket ownership, Clerk proxying, Vite integration, streaming helpers,
background work, and shared runtime state in `server/`.
**Mode:** report-only
**Date:** 2026-09-16
**Stack:** TypeScript, Node.js, Express, `ws`, Vite, HTTP proxying, PostgreSQL,
and object storage. Type-safety, async/timing, error handling, state,
concurrency, security, performance, dead-code, and dependency categories were
applicable. React-only effect checks were not applicable to this server scope.

No runtime code, tests, configuration, processes, ports, or external systems
were changed.

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 4 |
| Medium | 4 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Async & timing | `server/index.ts:175-205`, `server/routes.ts:300-378,828-843` | Shutdown exits as soon as the narrow task counter reaches zero, abandoning active requests and WebSockets |
| F-002 | High | Error handling | `server/index.ts:208-231,252-281` | Bootstrap rejection can occur before crash/rejection handlers are installed |
| F-003 | Medium | Performance | `server/middlewares/clerkProxyMiddleware.ts:298-307` | Chunked proxy responses are buffered without a size limit, bypassing backpressure |
| F-004 | Medium | Async & timing | `server/routes.ts:771-810,828-843` | The signed object-storage PUT has no timeout or request-disconnect cancellation |
| F-005 | Medium | Error handling | `server/vite.ts:19-27` | Vite logger failures call `process.exit` directly and bypass the server shutdown path |
| F-006 | High | Security | `server/routes.ts:6588,6604-6647,6754-6765` | Authenticated WebSocket messages have no application-level size, rate, or queue bound |
| F-007 | High | Performance | `server/websocket-upgrade.ts:11-15` | Unknown HTTP upgrade paths are left open without an explicit reject or close |
| F-008 | Medium | Async & timing | `server/realtime-authorization.ts:8-19`, `server/routes.ts:6618-6621` | A realtime join can retry authorization indefinitely and cannot be cancelled on disconnect |

## Evidence and validation baseline

The required command was run exactly once:

```text
npm run test-standard
```

It passed:

- Typecheck, including the Playwright project.
- Strict storage-key lint.
- Unit tests: 108 passed, 0 failed.
- Managed Clerk/release contract tests: 41 passed and 9 passed in their two
  registered subgroups, 0 failed.
- Vite-HMR tests: 3 passed, 0 failed.
- Failure-gate parity and validation-manifest parity.

The failure baseline catalog was empty. The working tree was clean before the
report was added.

Prior reports were reconciled as follows:

- `docs/startup-smoke-bug-audit-report.md` covers the validation script's
  process cleanup, database preflight, and probe limitations, not application
  shutdown or bootstrap.
- `docs/serial-lock-bug-audit-report.md` covers the validation lock wrapper,
  not the API server's process lifecycle.
- `docs/bug-audit-vite-hmr-report.md` correctly identifies that the HMR tests
  do not start Vite or observe a live update. F-005 below is distinct: it is
  an application fatal-exit path, not another HMR test-coverage finding.
- `docs/clerk-admin-realtime-audit-report.md` covers authorization/session
  behavior. No prior finding was duplicated for process shutdown or proxy
  buffering.
- The completed pre-auth WebSocket bounds work in
  `.local/tasks/clerk-websocket-auth-bounds.md` is confirmed as a pass; F-006
  applies only after authentication, when frames are no longer buffered by
  `PreAuthWebSocketBuffer`.
- The existing graceful-shutdown task introduced the narrow PDF/Excel/scan
  counter. F-001 extends that evidence to untracked HTTP streams, uploads, and
  upgraded sockets; it does not repeat the original health-endpoint work.
- The existing WebSocket reconnect/room-cleanup task covers client reconnect
  lifecycle and dead-map pruning. F-006 through F-008 cover transport abuse,
  upgrade ownership, and authorization cancellation, which are separate
  server boundaries.
- The completed Clerk proxy timeout work covers connect/response deadlines and
  downstream aborts. F-003 is the remaining unbounded chunked-body buffering
  path, not a duplicate timeout finding.
- The known PDF access issue (completed jobs surviving access revocation) is
  already represented by the existing PDF-export task and is not repeated
  here.

## Findings

### Finding F-001 — Shutdown can abandon active requests and realtime sockets

- **File and line:** `server/index.ts:175-205`;
  `server/routes.ts:300-378,828-843,6650-6773`
- **Category:** Async & timing
- **Severity:** High
- **Risk:** `beginShutdown()` calls `httpServer.close()` and then exits
  immediately when `taskTracker.count()` is zero. That counter tracks selected
  PDF, Excel, and scan work, but not ordinary in-flight requests, the
  long-lived help-chat SSE stream, object-storage uploads, or WebSocket
  connections. During a deployment rollover or uncaught exception, a connected
  WebSocket can continue to receive/process messages until the forced exit,
  while an active SSE response or upload can be terminated immediately even
  though `httpServer.close()` is intended to drain existing work. The 30-second
  timeout does not help when the narrow task count is already zero.
- **Evidence:** The only drain predicate is `taskTracker.count()` at
  `server/index.ts:188-205`. Help chat owns a streaming response at
  `server/routes.ts:336-367` without registering a task, uploads await a
  potentially long storage operation at `server/routes.ts:828-843`, and the
  WebSocket server installs independent connection/message handlers at
  `server/routes.ts:6650-6773`. No shutdown hook closes `wss` or prevents
  post-SIGTERM WebSocket messages.
- **Recommended fix:** Track all drain-relevant work (or use an HTTP
  connection/stream drain registry), close/reject WebSocket activity during
  shutdown, and wait for the registry plus the existing task tracker before
  exiting. Keep a hard deadline that reports any remaining resource class.

### Finding F-002 — Bootstrap failures can escape crash reporting

- **File and line:** `server/index.ts:208-231,250-281`
- **Category:** Error handling
- **Severity:** High
- **Risk:** The top-level async IIFE awaits `registerRoutes()` and development
  `setupVite()` before installing `uncaughtException` and
  `unhandledRejection` listeners. If route registration, Clerk production
  configuration, static setup, Vite startup, or a dynamic import rejects, the
  rejection occurs before the crash persistence and shutdown handlers exist.
  Node may terminate with only the default unhandled-rejection behavior; no
  `.crash_log.json` record or controlled drain is guaranteed, and readiness
  never becomes available.
- **Evidence:** The awaited bootstrap begins at line 208 and the listeners are
  not attached until after `httpServer.listen()` at lines 250-281. The Vite
  setup call at lines 230-231 is inside that unguarded bootstrap sequence.
  `test-standard` typechecks and unit-tests helpers but does not exercise a
  rejected `registerRoutes()`/`setupVite()` startup.
- **Recommended fix:** Install a single process-level startup failure handler
  before entering asynchronous bootstrap, or wrap the bootstrap in an awaited
  `try/catch` that records the crash and exits with an actionable diagnostic.
  Add a focused fixture that rejects each startup phase and asserts the
  persisted record and exit status.

### Finding F-003 — Chunked proxy responses are buffered without a bound

- **File and line:** `server/middlewares/clerkProxyMiddleware.ts:283-307`
- **Category:** Performance
- **Severity:** Medium
- **Risk:** When Clerk omits `content-length`, the proxy collects every response
  chunk in memory before writing any response bytes. A large or unexpectedly
  long chunked upstream response can grow one request's memory use without a
  configured limit and can cause process-wide memory pressure under concurrent
  requests. This path also forfeits downstream backpressure until the complete
  body arrives. The inactivity timer bounds silence, not total body size or
  duration while data keeps arriving.
- **Evidence:** The `content-length`/bodyless branch is selected at lines
  290-296; all other responses append to `chunks` at lines 298-300 and only
  call `res.end()` after `Buffer.concat(chunks)` at lines 301-306. No maximum
  body size or streaming threshold is present.
- **Recommended fix:** Stream responses through a bounded transform or enforce
  a documented maximum byte count while preserving response framing. On
  overflow, destroy both upstream and downstream and return a normalized
  failure. Add tests for a large chunked body and downstream backpressure.

### Finding F-004 — Object-storage PUT can hang after signing succeeds

- **File and line:** `server/routes.ts:771-810,828-843`
- **Category:** Async & timing
- **Severity:** Medium
- **Risk:** The sidecar signing request has a five-second abort deadline, but
  the subsequent signed-URL `PUT` has no `AbortSignal`, timeout, or
  request-disconnect propagation. If the storage endpoint accepts the
  connection and then blackholes or stalls, the upload request can remain
  pending indefinitely and retain the in-memory 50 MB multer buffer. A client
  that disconnects does not cancel this fetch. With concurrent stalled uploads,
  memory and request capacity can be exhausted.
- **Evidence:** The first fetch receives `signController.signal` and clears
  its timer at lines 779-795. The second fetch at lines 799-803 has no signal
  or deadline, and the route awaits it at line 843. The route only catches
  eventual errors at lines 869-872; it has no `req`/`res` disconnect handler.
- **Recommended fix:** Use a bounded upload timeout and an abort controller
  linked to `req.aborted`/`res.close`, destroy or cancel the upload on either
  event, and return a clear retryable error when the deadline expires. Add a
  stalled-PUT fixture and a client-disconnect cleanup test.

### Finding F-005 — Vite fatal logger bypasses graceful shutdown

- **File and line:** `server/vite.ts:19-31`; shutdown ownership:
  `server/index.ts:175-205`
- **Category:** Error handling
- **Severity:** Medium
- **Risk:** The custom Vite logger calls `process.exit(1)` directly on a Vite
  error. This bypasses `beginShutdown()`, crash-history persistence, active
  task draining, and any future cleanup registered on the shared server. If a
  Vite transform or middleware error is classified by Vite as fatal after the
  HTTP server and background resources exist, the process terminates abruptly
  and can leave in-flight work or external storage operations incomplete.
- **Evidence:** `server/vite.ts:24-27` exits directly; the only centralized
  shutdown path is the function in `server/index.ts:175-205`, reached by
  signal/uncaught handlers at lines 252-281. The Vite tests exercise only
  option construction and synthetic upgrade routing, not the custom logger or
  a real Vite startup failure.
- **Recommended fix:** Propagate the Vite failure into the bootstrap error
  path or invoke a shared shutdown callback that records the failure and
  drains resources before exiting. Add a logger-failure fixture asserting
  cleanup and nonzero exit behavior.

### Finding F-006 — Authenticated WebSocket traffic is unbounded

- **File and line:** `server/routes.ts:6588,6604-6647,6754-6765`
- **Category:** Security
- **Severity:** High
- **Risk:** The WebSocket server uses the `ws` default maximum frame size
  (100 MiB in the installed version), and the authenticated message handler
  has no per-socket rate limit, queue bound, or application payload limit.
  Every frame is converted to a string and passed to `JSON.parse`; recognized
  messages can also perform database authorization work. An authenticated
  client can therefore send repeated large or malformed frames and keep
  parsing/authorization work on the event loop, consuming memory and CPU
  across concurrent sockets and degrading API availability. The existing
  pre-auth limits do not protect this path.
- **Evidence:** `new WebSocketServer({ noServer: true })` does not set
  `maxPayload`. The post-auth `message` listener calls
  `processWsMessage(ws, raw)` without awaiting, rate limiting, or queue
  control. `processWsMessage` converts the complete raw frame to a string,
  parses it, and may call `verifySessionAccess` before returning.
- **Recommended fix:** Set an explicit conservative `maxPayload`, reject
  malformed or oversized application messages, and add per-socket message
  rate/queue limits with a clear close/error policy. Serialize or coalesce
  join work so a flood cannot create unbounded concurrent authorization calls.
  Add a controlled sustained-flood regression test without live abuse traffic.

### Finding F-007 — Unclaimed HTTP upgrades can retain sockets indefinitely

- **File and line:** `server/websocket-upgrade.ts:6-20`
- **Category:** Performance
- **Severity:** High
- **Risk:** The path-scoped upgrade listener returns silently for every path
  other than its configured path. With an upgrade listener installed, an
  unknown path has no application response or socket destruction path. A
  client can send repeated upgrade requests to arbitrary paths and keep those
  connections open, consuming file descriptors and connection capacity without
  authentication or normal HTTP request limits. The same helper is
  intentionally used alongside Vite HMR, so an unconditional close in this
  helper would be unsafe; ownership must be coordinated across all upgrade
  listeners.
- **Evidence:** `attachWebSocketServerAtPath` checks the normalized path and
  immediately returns when it does not match. It does not mark the upgrade as
  handled, write a rejection, or destroy the `Duplex` socket. The focused Vite
  test proves only that `/vite-hmr` is not claimed by the application WebSocket
  server; it does not prove that unknown paths are rejected by a later shared
  dispatcher.
- **Recommended fix:** Introduce one upgrade dispatcher that lets Vite and the
  application claim their documented paths, then explicitly rejects and
  destroys every remaining upgrade. Add a controlled unknown-path test that
  asserts the socket closes while `/vite-hmr` and `/ws` remain functional.

### Finding F-008 — Realtime authorization joins have no retry or cancellation bound

- **File and line:** `server/realtime-authorization.ts:8-19`;
  `server/routes.ts:6618-6621,6754-6765`
- **Category:** Async & timing
- **Severity:** Medium
- **Risk:** `authorizeConsistently` repeats authorization until the session
  version stops changing, with no maximum attempts, deadline, or cancellation
  signal. A socket that starts a join during continuous role/access changes
  can trigger unbounded database reads and never complete. If the socket closes
  while the authorization read is pending, the caller has no cancellation
  path; the promise can continue doing work after the client is gone. Since
  post-auth message handling is fire-and-forget, repeated join frames can
  accumulate these operations per socket.
- **Evidence:** The helper's `while (true)` loop only exits when the version
  remains equal across an awaited authorization call. `processWsMessage`
  invokes it without a timeout or socket-liveness signal, and the `message`
  handler does not serialize post-auth calls. No close handler cancels an
  authorization operation already in progress.
- **Recommended fix:** Add a bounded retry/deadline result and an abort signal
  tied to socket close, then return a safe retryable authorization error when
  consistency cannot be established. Serialize or coalesce joins per socket
  and test repeated invalidation plus disconnect cleanup.

## Confirmed passes

- `server/websocket-upgrade.ts` path matching ignores `/vite-hmr` and routes
  only the exact `/ws` path; query strings are handled without parsing hazards.
- Pre-authentication WebSocket buffering is bounded by message count,
  aggregate bytes, per-message bytes, and a timeout. Authentication completion
  drains only while the socket remains open, and close/error handlers clear
  timers and maps.
- WebSocket heartbeat and ghost-pruner timers are `unref()`'d and are cleared
  when the WebSocket server closes. Revalidation timers are cleared on socket
  close or authorization failure.
- Clerk proxy connect/response timers are cleared on completion, upstream
  failure, and downstream abort. Upstream response errors destroy the relevant
  resources, and response headers remove hop-by-hop framing fields.
- The proxy preserves `HEAD`, 204, and 304 bodyless semantics and computes a
  content length for buffered responses. The focused route tests cover healthy
  streaming, upstream errors, bounded health counters, and sensitive-log
  redaction.
- Help-chat SSE propagates disconnect cancellation to both an
  `AbortController` and the provider stream, avoids writing a completion frame
  after abort, and normalizes post-header failures.
- PDF/Excel/scan task accounting uses `finally` cleanup in the audited
  handlers, preventing normal provider/storage failures from permanently
  inflating the tracked task count.
- The authenticated WebSocket path does catch malformed-message errors and
  closes authorization-failed sockets; the finding is the missing resource
  bounds and cancellation around otherwise valid or repeated traffic.
- `attachWebSocketServerAtPath` correctly leaves `/vite-hmr` available to
  Vite, and its exact `/ws` matching avoids accidentally routing HMR requests
  into the application protocol. The unknown-path issue is the absence of a
  final owner, not a path-matching collision.

## Test-harness and environment limitations

- `test-standard` does not start the real `server/index.ts`, inject startup
  rejection failures, send SIGTERM while requests/WebSockets are active, or
  observe process exit/drain behavior.
- The Vite suite remains the previously reported helper/routing unit suite; it
  does not run `setupVite`, open a browser HMR connection, or trigger the
  custom logger error path.
- Proxy tests use controlled local upstream fixtures and do not exercise a
  very large chunked body, sustained data stream, downstream backpressure, or
  real Clerk network behavior.
- No standard-tier test starts a real WebSocket client/server pair to send
  authenticated floods, race concurrent joins, close a socket during
  authorization, or issue an unknown upgrade path. F-006 through F-008 are
  source-verified availability/lifecycle risks, not observed live outages.
- No live object-storage stall or client-disconnect fixture is present in the
  standard tier. The upload timeout finding is source-verified, not an
  observed production outage.
- Dependency-audit and browser/release tiers were not run because the task
  explicitly required exactly `test-standard`; no dependency result is used
  to classify these runtime findings.

## Recommended remediation order

1. **F-001 and F-002 — High:** establish one startup/shutdown ownership path
   that records bootstrap failures and drains all relevant request, stream, and
   socket work before exit.
2. **F-006 and F-007 — High:** bound authenticated realtime work and make
   upgrade ownership explicit to reduce unauthenticated and authenticated
   availability risk.
3. **F-003 and F-004 — Medium:** bound proxy memory and storage-upload lifetime
   while preserving successful streaming/upload behavior.
4. **F-005 and F-008 — Medium:** route Vite failures through shared cleanup and
   bound/cancel realtime authorization retries.

## Deferred / not audited

No implementation or test fixes were made. The PDF completed-job access
boundary, validation serial-lock defects, and client identity/cache recovery
remain owned by their existing reports/tasks and were intentionally not
duplicated here. Report-only triage is complete.