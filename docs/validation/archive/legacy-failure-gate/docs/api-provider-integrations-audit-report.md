# API Provider Integrations Bug Audit Report

**Scope:** Server-side AI provider adapters and provider-facing API paths:
Poe model discovery, help chat, label scanning, AI health, chat/audio
integration modules, audio conversion/transcription/voice streaming, image
helpers, batch helpers, provider telemetry, and their persistence boundaries.
General application routes and database behavior unrelated to provider
persistence were excluded.
**Mode:** Report-only
**Audit date:** 2026-09-16
**Validation ceiling:** `test-standard`
**Product behavior changed:** No

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 4 |
| Medium | 4 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Dead / unreachable code | `server/routes.ts:748-755` | Chat, audio, and image integration route modules are not mounted |
| F-002 | High | Security | `server/providers/poe.ts:174-216` | Every live Poe model is marked approved and may receive private provider inputs |
| F-003 | High | Performance | `server/replit_integrations/audio/routes.ts:6-86` | Audio requests allow expensive unbounded decode, conversion, and paid provider work |
| F-004 | High | Async & timing | `server/replit_integrations/audio/routes.ts:98-134` | Audio disconnects do not cancel the provider stream and still persist partial output |
| F-005 | Medium | Error handling | `server/routes.ts:368-375` | Reachable help-chat provider failures are flattened into HTTP 500 |
| F-006 | Medium | Performance | `server/providers/poe.ts:382-405` | Poe retry backoff is not cancellation-aware |
| F-007 | Medium | State & data integrity | `server/providers/poe.ts:477-494` | Streaming telemetry records a cache hit even when model discovery missed |
| F-008 | Medium | Performance | `server/replit_integrations/batch/utils.ts:80-180` | Generic provider batch helpers can multiply calls and report partial failure as completion |

## Phase 0 — Discovery and provider map

### Detected stack

- **Backend:** TypeScript, Express, PostgreSQL through Drizzle ORM.
- **Provider clients:** OpenAI-compatible SDK for Poe and the configured
  Replit OpenAI-compatible integration.
- **Provider surfaces:** `server/providers/poe.ts`,
  `server/replit_integrations/audio/client.ts`,
  `server/replit_integrations/image/client.ts`, and the generic batch helpers.
- **Reachable provider routes:** `/api/help-chat`, per-photo and session-wide
  label scanning, and owner-protected `/api/admin/ai-health`.
- **Unreachable integration modules:** The chat, audio, and image route
  registration functions exist, but no application route registration imports
  or calls them. The Poe help and scanner paths are registered directly from
  `server/routes.ts`.
- **Persistence:** Poe usage is written best-effort to `ai_usage_logs`.
  Chat/audio messages, where their route modules would be mounted, are stored
  through the chat storage adapter.

### Audit gates

All ten Bug Audit categories were considered. Provider-specific checks for
request validation, authorization, ordering, persistence, cancellation,
streaming, retry/cost amplification, error normalization, telemetry, and
secret handling were applicable. Image and generic batch route behavior was
inspected, but its API reachability is covered by F-001; unreachable-only
candidates are deferred rather than counted as independent production
findings.

## Evidence and validation baseline

`docs/validation/failure-baseline.json` contained no active records before the
validation run. The working tree was clean before this report was written.
No provider call requiring an external mutation was made, and no application
source, test, prompt, dependency, configuration, secret, database, or
external-service data was changed.

The required command was run exactly:

```text
npm run test-standard
```

The standard tier passed. Its signals included:

- TypeScript and Playwright type checks passed.
- Backend/provider/unit tests passed, including the Poe provider and route
  contract tests.
- Dependency audit passed with no reported high-severity advisories.
- Startup/schema, validation-manifest, Failure Gate parity, Clerk contract,
  and Vite HMR checks passed.
- The validation process briefly waited for the shared validation lock held by
  another process, then acquired and released it normally; no validation
  failure resulted.

Existing provider-focused tests verify live-model parsing and capability
filtering, provider error redaction, structured label cardinality, health
response shape, help-chat request validation, SSE disconnect abort for the
reachable help-chat handler, and scan output ordering. They do not prove
privacy approval provenance, audio cancellation, audio byte/duration limits,
retry cancellation, telemetry cache accuracy, or generic batch failure
semantics.

## Findings

### Finding F-001 — Provider integration route modules are not mounted

- **File and line:** `server/routes.ts:748-755`;
  `server/replit_integrations/chat/routes.ts:6-132`;
  `server/replit_integrations/audio/routes.ts:9-144`;
  `server/replit_integrations/image/routes.ts:4-29`
- **Category:** Dead / unreachable code
- **Severity:** High
- **Risk:** The application registers the admin AI-health route, auth routes,
  and object-storage routes, but there is no import or call to
  `registerChatRoutes`, `registerAudioRoutes`, or `registerImageRoutes` in the
  application route setup. The repository search found those symbols only in
  their own integration modules and exports. Consequently, the
  `/api/conversations*`, audio message, and `/api/generate-image` provider
  APIs are absent from the running Express application. A client or future
  UI depending on these documented integration modules receives the
  application's unmatched-route response and never reaches authentication,
  persistence, or the provider call. This also makes the safety controls
  inside those modules non-operative.
- **Recommended fix:** Decide whether these modules are supported product
  APIs or obsolete scaffolding. If supported, mount exactly one intended
  route group with explicit middleware ordering, test route reachability and
  ownership, and avoid registering duplicate conversation paths. If obsolete,
  remove or clearly quarantine the dead modules so they cannot be mistaken
  for supported provider surfaces.
- **Evidence:** `server/routes.ts:747-755` is the route-registration boundary
  and contains no chat/audio/image registration. The three modules export
  registration functions but have no application call site. This finding is
  distinct from provider behavior inside the unreachable modules and is
  reported as an integration availability defect.

### Finding F-002 — Live Poe models bypass the application privacy approval gate

- **File and line:** `server/providers/poe.ts:174-216`
- **Category:** Security
- **Severity:** High
- **Risk:** `parsePoeModelsResponse` turns every syntactically valid row from
  the live Poe catalogue into a `PoeLiveModel` with
  `privacyClass: "approved"`. `selectPoeModel` then selects any such row with
  the requested capability, sorting by ID. A newly listed, unreviewed, or
  otherwise disallowed model can therefore become the model used for help-chat
  text or warehouse label images without an application approval decision.
  This defeats the privacy boundary described in `docs/ai/poe-routing.md` and
  can send customer-provided content to a model that has not been approved for
  that use case.
- **Recommended fix:** Keep live catalogue presence as availability evidence,
  but derive privacy approval from an explicit server-side allowlist or
  reviewed metadata that fails closed for unknown IDs. Keep capability
  declarations separate from privacy approval, and add negative coverage for a
  live capable but unapproved model.
- **Evidence:** Lines 191-197 assign the approval class unconditionally;
  lines 214-216 treat that generated class as the selection gate. Existing
  tests at `server/__tests__/poe-provider.test.ts:45-80` cover malformed rows
  and capability selection but do not assert that an unapproved live model is
  rejected. No provider secret or external catalogue call was made during
  this audit.

### Finding F-003 — Audio input can amplify local and paid provider work

- **File and line:** `server/replit_integrations/audio/routes.ts:6-86`;
  `server/replit_integrations/audio/client.ts:54-105,240-248`
- **Category:** Performance
- **Severity:** High
- **Risk:** The route accepts a JSON body up to 50 MB, checks only truthiness
  of `audio`, and passes the value to permissive `Buffer.from(audio,
  "base64")`. It does not require a string, validate base64, cap decoded
  bytes, cap duration, apply a per-user audio limiter, or bound concurrent
  ffmpeg work. `ensureCompatibleFormat` sends unknown and malformed buffers
  through ffmpeg, while `convertToWav` launches a child process without a
  timeout or resource limit. A repeated authenticated request containing
  near-limit or malformed payloads can consume memory, temporary disk, ffmpeg
  CPU, and paid transcription/provider capacity. The same request can also
  continue after the browser has gone away because the provider calls accept no
  request signal.
- **Recommended fix:** Validate the input type and base64 syntax before
  decoding, enforce a decoded byte and duration budget, reject unsupported
  formats instead of converting arbitrary bytes, add per-user/concurrency
  limits, and terminate ffmpeg on a bounded deadline. Pass a request-derived
  abort signal into each provider operation and return a stable 4xx response
  for invalid audio rather than invoking conversion.
- **Evidence:** The 50 MB parser is at lines 6-7; unchecked decode and
  conversion begin at lines 72-86. The conversion child process and its
  cleanup are at `audio/client.ts:54-89`, and transcription starts at
  `:240-248` with no signal. No route-level audio rate limiter or decoded
  payload guard was found.

### Finding F-004 — Audio disconnects leave provider work and persist a partial reply

- **File and line:** `server/replit_integrations/audio/routes.ts:98-134`
- **Category:** Async & timing
- **Severity:** High
- **Risk:** After setting up SSE, the audio route starts the streaming
  `gpt-audio` request without listening for `req.aborted`, `req.close`, or
  `res.close`, and without an `AbortSignal`. If the browser disconnects, the
  handler continues consuming upstream chunks and attempts to write them to a
  closed response. It then persists `assistantTranscript` unconditionally at
  lines 130-131, including an empty or partial transcript that the client
  never received. Repeated abandoned requests can continue consuming provider
  work and create misleading conversation history.
- **Recommended fix:** Register one idempotent disconnect handler before
  provider work, pass its signal to the OpenAI-compatible request, stop
  iterating and avoid persistence after disconnect, and normalize the
  cancellation path separately from provider failure. Add a route-level
  regression test that disconnects after a partial chunk and asserts provider
  abort and no assistant-row write.
- **Evidence:** SSE headers and the provider request are at lines 98-112;
  the stream loop and unconditional persistence are at lines 116-131.
  The reachable Poe help route has explicit disconnect handling in
  `server/routes.ts:340-367`, so this is not a duplicate of the existing
  help-chat cancellation control.

### Finding F-005 — Reachable help-chat provider errors lose their normalized contract

- **File and line:** `server/routes.ts:368-375`
- **Category:** Error handling
- **Severity:** Medium
- **Risk:** `PoeProviderError` carries a normalized status and error code for
  configuration, quota, rate-limit, timeout, capability, and upstream
  failures. The reachable `/api/help-chat` handler logs only the code and
  returns HTTP 500 for every pre-stream provider failure. After SSE headers
  are sent it emits only the generic `"Failed to get response"` event. A
  transient 503/504 or rate-limit condition is therefore indistinguishable
  from an application crash, causing clients and monitoring to apply the
  wrong retry and user messaging behavior. This is separate from the scan
  routes, which use the normalized status code.
- **Recommended fix:** Map safe provider codes to the documented HTTP
  contract before headers are sent, while keeping upstream messages and
  secrets redacted. For an already-started stream, emit a stable safe error
  code and cancellation/retryability field, then close the stream. Keep
  configuration and authorization failures distinct from transient upstream
  failures.
- **Evidence:** `normalizePoeError` defines the safe status contract at
  `server/providers/poe.ts:241-256`; the help handler catches it at
  `server/routes.ts:368-375` but always sends 500 or a generic SSE error.
  The existing tests verify provider error redaction, not this reachable
  status mapping.

### Finding F-006 — Poe retry backoff ignores a caller cancellation

- **File and line:** `server/providers/poe.ts:382-405`
- **Category:** Async & timing
- **Severity:** Medium
- **Risk:** After a retryable Poe failure, `withRetry` checks the caller signal
  at line 396 but then waits on an ordinary uncancellable timer at line 398.
  A disconnected help-chat request can therefore remain in the provider's
  `MAX_IN_FLIGHT` accounting and keep its retry lifecycle alive during the
  backoff even though no client can receive the result. The current delays
  are short, but they are part of a shared capacity limit and can grow if the
  retry policy changes.
- **Recommended fix:** Make retry delay signal-aware, resolve immediately on
  caller abort, and ensure cleanup releases the in-flight slot without
  starting another provider attempt. Add a focused abort-during-backoff test.
- **Evidence:** `acquire()` runs before the retry loop at lines 386-387,
  the abort check is before the delay at lines 395-397, and the delay itself
  has no signal listener at line 398. The caller cancellation path is wired
  from the help route, so this is a provider lifecycle defect rather than a
  missing route listener.

### Finding F-007 — Streaming Poe telemetry reports a false model-cache hit

- **File and line:** `server/providers/poe.ts:421-422,477-494`
- **Category:** State & data integrity
- **Severity:** Medium
- **Risk:** `streamText` captures the actual cache state at line 422, but both
  its success and error/cancellation telemetry writes use the literal
  `cacheState: "hit"` at lines 479 and 492. The first help-chat request after
  cache expiry is therefore recorded as a hit even when `listModels()` made a
  live catalogue request. Owner usage reporting and any cache-based capacity
  analysis can show incorrect provider behavior, and cancellation/error
  records disagree with the same provider's model-discovery telemetry.
- **Recommended fix:** Carry the captured cache-state value through every
  stream terminal path, and define whether an expired cache is a miss before
  the provider request. Add success, error, and cancellation assertions for
  both hit and miss states.
- **Evidence:** The captured value is `modelCacheState()` at line 422;
  the success and error records hard-code `"hit"` at lines 479 and 492.
  `recordUsage` suppresses database failures by design, so this is a
  telemetry integrity defect, not a provider-result failure.

### Finding F-008 — Generic batch provider helpers can multiply paid work and misreport completion

- **File and line:** `server/replit_integrations/batch/utils.ts:80-120,132-180`
- **Category:** Performance
- **Severity:** Medium
- **Risk:** `batchProcess` defaults to seven retries, allowing up to eight
  processor invocations per item. Its rate-limit detector uses message
  substrings such as `"quota"`, `"429"`, and `"rate limit"`, so a permanent
  application error containing one of those words can be retried as if it
  were transient. For N items this can multiply provider calls and cost by
  as much as 8N, while exponential waits reach the configured 128-second
  cap. The helper has no abort signal for queued or retrying work. The SSE
  helper catches item failures, inserts `undefined as R`, emits an ordinary
  progress event, and always emits a normal `complete` event, allowing a
  consumer to treat a partial result as a successful full result.
- **Recommended fix:** Use structured provider status/code classification,
  an explicit total retry/deadline budget, jitter, and signal propagation.
  Return a discriminated per-item result or explicit partial terminal status
  instead of casting failed items to `R` and reporting unconditional
  completion.
- **Evidence:** Retry defaults and concurrency are at lines 85-115; SSE
  retry and failed-item handling are at lines 138-180. Repository search found
  no application route that currently invokes these generic helpers, so the
  finding is a provider-adapter hardening issue and not evidence of current
  production traffic. It remains listed because the helpers are tracked
  server-side provider code and can amplify work when adopted.

## Confirmed controls and reconciled prior work

- `/api/help-chat` is authenticated and has a per-user rate limiter. Its
  handler caps the request to 12 messages and 8,000 trimmed characters,
  injects server-owned help content, bounds output to 512 tokens, and aborts
  Poe work on request/response disconnect. The earlier task concerning adding
  the help-chat rate limiter is therefore not a new finding.
- Label scan routes enforce authenticated session access, cap scan batches,
  crop images server-side, validate structured label output, preserve crop
  order, and return a retryable persistence error. The existing
  caller-supplied pin ownership defect remains the previously reported
  F-002 in `docs/bug-audit-report.md`; it is not duplicated here.
- Poe provider calls use a server-only key, set a 15-second request deadline,
  limit Poe in-flight work to four, retry only normalized transient failures,
  and redact upstream error bodies. Model parsing rejects malformed rows and
  unknown capability names.
- AI usage telemetry is best-effort and does not store prompts, images,
  provider response bodies, or secrets. That control does not prevent the
  cache-state accuracy defect in F-007.
- Admin AI health is protected by the owner/admin route boundary and reports
  API health separately from the two supported health-model chips. No new
  authorization finding was verified there.
- The current Poe provider tests and route tests were inspected as supporting
  evidence. Passing happy-path tests do not cover hostile audio payloads,
  provider model privacy provenance, cancellation during backoff, or the
  telemetry and generic-batch contracts above.

## Deferred / not audited

- The chat, audio, and image route modules are not mounted. Their reachable
  behavior should be re-audited after a deliberate mount decision; the
  unbounded audio and disconnect defects are still recorded because the
  modules contain complete provider-facing handlers and would become active
  immediately if mounted.
- The unmounted audio/chat history path loads every stored message without a
  bounded provider context window (`server/replit_integrations/chat/storage.ts:36-38`,
  chat route `:75-105`, audio route `:91-112`). This was not counted separately
  from F-001 because the current application has no route entry point.
- The unmounted image route accepts arbitrary `size` values and returns HTTP
  200 with missing image fields; the image client also returns an empty
  buffer when the provider omits base64 output
  (`server/replit_integrations/image/routes.ts:7-24`,
  `server/replit_integrations/image/client.ts:18-57`). These are deferred
  until the route is either mounted or removed.
- The unmounted image editing helper accepts arbitrary file paths, opens all
  files concurrently, and writes an arbitrary caller-supplied output path
  (`server/replit_integrations/image/client.ts:31-55`). No caller path was
  shown to be untrusted in the current application, so this was not promoted
  to a confirmed security finding.
- Poe provider argument bounds are not independently validated inside the
  provider interface (`server/providers/poe.ts:408-525`), but all current
  reachable callers pass fixed token limits and route-level scan/help bounds.
  A future public provider caller should add a boundary schema before this
  interface is reused.
- Model-list retries after timeout, retries after an already-established
  stream, OpenAI SDK default retry behavior in the legacy clients, ffmpeg
  stderr handling, and provider model-output quality were not promoted without
  a current reachable failure contract.
- No live Poe, OpenAI-compatible, image, audio, database-production, object
  storage, Clerk, or other external mutation was performed. Browser/provider
  reachability was outside the standard report-only validation run.

## Recommended remediation order

1. Resolve F-001 first: either mount the intended provider routes with tested
   middleware or remove the dead integration modules and their misleading
   contract.
2. Fix F-002 before routing any additional data to Poe; model availability
   must not imply privacy approval.
3. Fix F-003 and F-004 together so audio input budgets, child-process cleanup,
   provider cancellation, and persistence behavior share one request lifecycle.
4. Fix F-005 and F-006 so transient provider failures have an actionable
   contract and abandoned requests release capacity promptly.
5. Fix F-007 and F-008 to make usage reporting and reusable batch helpers
   trustworthy before they drive cost or operational decisions.
6. Add focused negative and cancellation coverage for each selected fix,
   including unapproved live models, audio near-limit/malformed payloads,
   disconnect during STT and audio streaming, abort during Poe backoff,
   telemetry cache misses, and partial batch completion.

## Report-only stop

This audit stops at the report phase. No application behavior, source code,
tests, migrations, configuration, dependencies, secrets, account data, or
external service data was changed. The eight findings above are ready for
separate approved fix tasks.