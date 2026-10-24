# Pageview throttle investigation

## Outcome

**F-001: unresolved original observation; provisional Medium severity retained.**
The missing-throttle candidate is **disconfirmed for the tested local source**:
fresh fixed-client bursts produced exactly **60 HTTP 200s and 5 HTTP 429s**.
This held for both the existing authenticated browser-context request fixture and
an explicitly anonymous request context against the same isolated server.

The reported all-200 run cannot be explained from the available artifacts.
There is no evidence supporting a production limiter repair. No application,
dependency, limiter, proxy, deployment, store or baseline change was made.

**Required validation: INCOMPLETE, not PASS.** The full admitted heavy run passed
startup checks, failed `security-audit`, and stopped before the other workloads.
A port mapping appeared in `.replit` during the smoke run, so the gate additionally
recorded a source-change result. That mapping has been removed; its recorded
failure and the unexecuted workloads have not been waived.

## Governing context and admission

- Native assignment: 987, investigation only; no speculative application fixes.
- Local provisioned identity: `36eaaf32-3ce7-4eb0-a940-f4a5fa31b01f`, sealed revision 1.
- Sealed plan SHA-256:
  `a5cf435905b0b8fc9b1ddff284f28c2351901172231933b50b8bd7a3a3ccffbf`.
- Unified full-contract pin:
  `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Regression Guard full-contract pin:
  `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- Exactly one bound tier: `test-heavy`; workload SHA-256:
  `b97e7282b502b201b5dbce053c829127ef14266c924b0389eaf253ecbcd358a5`.
- Coverage: `docs/validation/manifest.json` registers `browser-tests` only in
  heavy; it runs `scripts/run-browser-tests.mjs`.
- Baseline catalog inspected: schemaVersion 1, empty records; nothing ignored
  or added. The reported all-200 result was not adopted as a baseline.
- `gate:new` admitted the specification; Agent-first `gate:guard --tier
  test-heavy` returned ADMITTED before diagnostic edits or execution.
- Source HEAD for the original investigation runs:
  `24573fcb03c2602749d35f778b3a61848d027d8a`.
  Per-run target fingerprints are retained in `unified-registry.json`.
  Request evidence additionally hashes the actual application, test, fixture,
  configuration and browser-wrapper files.
- Regression form: self-satisfying investigation/test evidence, not an
  application repair. Separate independent review: **not selected**.
- The global setup-status report also lists unrelated missing historical local
  plans and unobserved installation acceptance. Neither was bypassed or repaired;
  current admission and preflight succeeded through the supported routes.

## R1 — Original evidence recovery

The supplied assignment reports 65 successful responses without 429. No saved
request-level artifact for that failing run was located in the saved browser
report, test results, retained gate excerpts, local task/audit records or docs.
Missing artifacts do not establish the cause.

The available `playwright-report/index.html` instead contains an **older passing**
Chromium run from September 30, 2026:

- Report: 69 expected, zero unexpected/flaky/skipped.
- Pageview case: passed, retry 0, started `2026-09-30T02:22:36.114Z`,
  total duration 1,964 ms.
- A collapsed POST step records 65 calls. Its summed concurrent duration
  (26,068 ms) is **not** a wall-clock limiter-window measurement.
- It retains neither individual response statuses/headers/body shapes nor the
  server URL, process, database binding or source fingerprint needed here.
- Report SHA-256:
  `dc53be6801ab3a5b9dad7c453d3a94ebd74926cdf0b94850d92450376d7362c1`.

Only whitelisted metadata was retained in
[`original-report-summary.json`](pageview-throttle-evidence/original-report-summary.json).
The raw report includes provider request data and is not a safe evidence export.
The passing report neither proves nor refutes what happened in the missing later
all-200 run.

## R2 — Controlled reproduction

### Isolation and transport

All 65-request bursts targeted a dedicated local port, **25187**, not preview or
production. Read-only port discovery found it free before the owned server
started. The registered heavy browser wrapper created a disposable database,
initialized its reviewed schema, and passed its connection only to the owned
Playwright server and fixtures. It cleaned up the database after its supervised
process group stopped.

Each executed diagnostic:

- required a marked loopback target and checked the expected candidate marker
  in `/api/healthz`;
- checked exactly one listening process and its `/proc` start time before/after;
- confirmed `/api/auth/user` was 401 for explicit empty anonymous storage and
  200 for the authenticated fixture where that comparison ran;
- used `APIRequestContext` HTTP requests, not page fetches or browser route
  interception; redirects were disabled;
- retained one record per request: relative send/receive timing, status, endpoint
  equality, content type, standard limiter headers and allowlisted body shape;
- captured no cookies, authorization headers, client IPs, visitor hashes, account
  identities or arbitrary response bodies.

The configured IP key is fixed in this direct local transport; neither client
supplied forwarded identity headers. Single listener/process, one target marker,
sub-second bursts and consistent limit/reset headers establish the observed
same-process/window boundary. No multi-instance or proxy hypothesis is needed
to explain these local results.

### Observed attempts

| Gate run | Target / selector | Observed result |
|---|---|---|
| `7038ceba-fa78-4c74-8a21-eff6768f3f47` | IPv4 loopback, existing fixture case | FAIL; NO_EXECUTION. Owner sign-in fixture failed before the test body with “You're already signed in.” No 65-request burst occurred. |
| `b1087e07-64a8-439e-8f27-98af6ce67da9` | Fresh IPv4 loopback target, same case | Same setup failure; NO_EXECUTION, not an endpoint result. |
| `75e6689a-688c-41da-b727-bb1848f94a86` | IPv4 loopback, independent anonymous diagnostic | Diagnostic SUCCEEDED, one executed/passed Chromium case; gate state INCOMPLETE because filtered. |
| `466e4502-a627-4ff8-8e12-a24e3fcc7cdb` | Usual `localhost` target, existing authenticated fixture case | Diagnostic SUCCEEDED, one executed/passed Chromium case; both authenticated and anonymous bursts observed; filtered gate state INCOMPLETE. |

The first two failures do not establish a limiter problem, and the later pass
does not establish pre-existing provenance. Hostname-dependent setup behavior was
observed, but its underlying authentication cause was not investigated or fixed.
It cannot explain the reported all-200 burst, which would require body execution.

### Request-level results

| Evidence | Request source | Start (UTC, 2026-10-24) | Burst duration | HTTP 200 / 429 | Same process |
|---|---|---|---:|---:|---|
| [`anonymous.json`](pageview-throttle-evidence/anonymous.json) | Explicitly anonymous, IPv4 loopback | See retained request evidence | 346.792 ms | 60 / 5 | PID 1948, unchanged start ticks |
| [`localhost-comparison.json`](pageview-throttle-evidence/localhost-comparison.json) | Existing authenticated browser-context fixture | 23:03:11.795 | 579.590 ms | 60 / 5 | PID 2441, unchanged start ticks |
| Same file, next window | Explicitly anonymous, same server | 23:04:13.800 | 583.210 ms | 60 / 5 | Same PID/start ticks |

The independent anonymous run waited a quiet 61 seconds after setup so setup
navigation could not consume the measured allowance. The combined run waited
the observed reset interval plus one second between its two identities. No
limiter reset, altered key, fake clock or application store mutation was used.

All three bursts:

- `Content-Type: application/json; charset=utf-8`;
- `RateLimit-Limit: 60`, `RateLimit-Policy: 60;w=60`,
  `RateLimit-Reset: 60`;
- remaining allowance descended from 59 to zero; rejected requests had
  `Retry-After: 60`;
- one `{ok:true}` success, 59 `{ok:true,deduplicated:true}` successes, five
  `{ok:false,message:string}` throttles;
- 65 final URLs matched the pageview endpoint, with no followed redirects.

This directly demonstrates that deduplicated successes still consume limiter
allowance.

## R3 — Trace, classification and recommendation

`server/routes.ts` installs a pageview-specific limiter with a 60,000 ms window,
maximum 60, standard headers, and `ipKeyGenerator(req.ip ?? "")`.
`app.post("/api/track/pageview", pageviewRateLimiter, createPageViewHandler(...))`
places it **before** the handler. The public approval exemption does not omit
this route-level middleware. The E2E-header skip belongs to the separate
`resourceRateLimiter`, not the pageview limiter.

Installed `express-rate-limit` 8.5.1 increments its default memory store before
calling the next handler, emits limiter headers and sends the configured 429
when total hits exceed the limit. Successful requests are not skipped.

`server/pageview-tracking.ts` normalizes the path and deduplicates by short-lived
visitor/path state only **after** that middleware. Its immediate successful
dedupe response cannot undo a limiter increment or bypass middleware already run.
The retained 59 deduplicated responses followed by five 429s verify that trace.

### Disposition

- **Application defect:** not demonstrated; expected limiter behavior reproduced.
- **Original test/harness defect or target mismatch:** neither established from
  the missing failing artifact.
- **New setup observation:** the fixture failed on two IPv4-loopback attempts
  and completed on the usual localhost target; this is a prerequisite/context
  observation, not the cause of an all-200 response set.
- **Overall original discrepancy:** **unresolved**, not promoted to a verified
  security finding. The broad missing-throttle candidate is disconfirmed under
  the controlled local conditions.

**No production fix is recommended.** Do not change thresholds, trust proxy,
keys, stores, deployment settings or deduplication to address an unverified cause.

The exact evidence still missing is the original failing run's tested source
fingerprint, server/base URL and process/database binding, browser project,
per-request send/receive timing, final status/URL, JSON/body shape and limiter
headers, plus whether requests shared a limiter key/window/process and followed
redirects. A future recurrence should retain those safe fields before assigning
application, harness or target-mismatch ownership. Do not request old receipts
from the user or flood a deployed/preview target.

The current detecting assertion is retained in the opt-in diagnostic: a fixed
client should cross the 60-request allowance within one minute and receive 429.
The ordinary security case remains unchanged outside diagnostic mode.
Separate test-only suggestions can strengthen its exact legitimate allowance
and combined anonymous/authenticated IP-budget assertions; neither implies a
confirmed application bug.

## Required full-tier validation and limits

Full run: `15932c87-8d0b-4769-835f-e80581da741e`, invoked through admitted
`gate:run --tier test-heavy`, with a separate owned disposable outer database
created/initialized using the project's existing release database helpers.
The browser wrapper would create its own nested disposable database if reached.
All setup, smoke and browser targets were local; the original database's user
records were not used.

- `startup-smoke`: PASS, cleanup complete.
- `startup-smoke-boundaries`: PASS, cleanup complete.
- `security-audit` (`npm audit --audit-level=high`): FAIL, cleanup complete;
  9 vulnerabilities (5 moderate, 4 high). High findings included body-parser,
  multer, zod and its dependent zod-validation-error advisory path.
- No dependency/lockfile changes were made or automatic audit fixes attempted.
  Package files were untouched relative to the starting HEAD; these failures
  are outside investigation scope and are not new ignored baselines.
  Their pre-task provenance is self-classified using that untouched dependency
  evidence through `gate:classify`, not a retry. The raw failure remains failed.
  A filtered audit retry is unsupported: `security-audit` is kind `audit`,
  whereas the supported diagnostic selector requires a registered test step.
- The 16 following workloads were not reached: schema-check,
  release-schema-contract, workspace-skill-contract, typecheck, storage-lint,
  port-reference-scan, storage-lint-contract, unit-tests, vite-hmr-tests,
  vite-hmr-recovery-tests, serial-lock-tests, port-authority-tests,
  manifest-parity, nested-tier-regression, collision-smoke, browser-tests.
- A new smoke-port mapping for 25188 appeared in `.replit` during execution,
  changing the gate's all-source fingerprint. It was removed after the run;
  the gate correctly retained **INCOMPLETE: tested source changed during execution**,
  rather than reporting full-tier PASS.
- The independently owned outer database was removed. Owned diagnostic and
  smoke ports were free after cleanup; unrelated workspace workflows were not
  stopped or repurposed.
- Focused diagnostics did run the compiler prerequisite successfully before
  executing their selected browser cases. They are not substitutes for the
  stopped full workload.
- Local browser coverage was Chromium; mobile WebKit remains CI-only under
  existing project policy. No full browser-matrix claim is made.
- No aggregate mobile-header verdict was obtained because heavy stopped at
  security-audit. The separately reported mobile-header failure is not repaired,
  ignored, erased or explained by this investigation.

## Requirement-to-delivery handoff

| Requirement | Planned form | Actual delivery | Gaps / disposition |
|---|---|---|---|
| R1 — map all-200 report to original evidence | Self-satisfying investigation | Safe saved-report extraction with report hash, project, outcome and missing fields | Original failing artifact unavailable; exact missing evidence listed; no invented cause |
| R2 — fixed-client anonymous/authenticated comparison | Existing threshold assertion plus diagnostic evidence | Anonymous standalone and same-server authenticated/anonymous next-window 60/5 results; per-request timings, safe shapes/headers, source hashes and process checks | Two setup-only failures retained; localhost comparison executed successfully; local behavior disconfirms bypass |
| R3 — supported cause/fix or precise unresolved blocker | Trace actual middleware and handler; no speculative repair | Middleware/store/handler trace and evidence-linked unresolved classification; no application change recommended | Original discrepancy unresolved; required full tier INCOMPLETE with audit failure and source-change evidence retained |

Delivered changes are diagnostic-only tests, this report and safe evidence, plus
supported admission/run records. Application/production behavior is unchanged.
The sealed plan was not rewritten, no tier was changed, no baseline was added,
and no independent reviewer or deployment was requested.

## Post-sync evidence

Completion initially encountered a conflict with concurrent main-project
validation history. The registry was regenerated as the compatible union of
both authoritative JSON records: all 15 identities and tombstones, including
every history event, were retained without changes. Registry validation and the
merge-preservation guard passed; the supported continuation completed the rebase.

Agent-first guard still admitted revision 1 under the unchanged heavy workload.
The focused same-server comparison was then renewed on the synced source,
HEAD `8e841bb58e404778c59ccae58c296c44187a7141`:

- Run `af03dccc-15fc-4dc3-81db-20e5c553b399`: diagnostic **SUCCEEDED**, one
  selected/executed/passed Chromium case, no failed/skipped cases.
- Source fingerprint stayed unchanged during execution:
  `9e8ed441cf8983ab2485ed988cd3f2e6a58c12a2b0074162f53769975a7f1c68`.
- Authenticated existing fixture: 60 HTTP 200s, 5 HTTP 429s, 542.719 ms.
- Anonymous next window on the same server: 60 HTTP 200s, 5 HTTP 429s,
  573.467 ms.
- Safe per-request evidence and actual source hashes:
  [`rebased-comparison.json`](pageview-throttle-evidence/rebased-comparison.json).
- Supervised cleanup completed. This remains a filtered **INCOMPLETE** gate
  record, not a full heavy-tier PASS. It does not erase earlier setup failures,
  restore missing original-run provenance or certify unreached heavy workloads.

The report/evidence additions following that run do not change the measured
application, fixture or diagnostic code. The original discrepancy therefore
remains unresolved while the local missing-throttle candidate remains
disconfirmed on both the original and synced tested sources.
