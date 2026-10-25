# Mobile Flow navigation: current-checkout reproduction

## Disposition

**Reported header failure is stale; no new entry defect reproduced.**
All 17 cases in `tests/mobile-photo-upload.spec.ts` passed on attempt 0 in
the actual full heavy run, including both controlled delayed-entry cases and
the real photo handoff through protected-image reload.

**Aggregate validation remains FAIL**, due to a separate Settings sign-in
timeout. Its isolated diagnostic passed; that establishes intermittency, not
pre-existing provenance or a full-tier pass.

No executable source, browser assertion, production capture default, auth,
upload/registration, queue, WebSocket, dependency or project selection changed.
The assignment explicitly allows a stale-report finding rather than a speculative
repair. No new delayed-reload or failed-session-load cases were added; those
already have separate proposals. Separate review was not selected.

## Admission and target

- Local identity: `9fd93339-e86d-4fe6-98b8-91f4c2ed24d9`, revision **1**,
  stable claim `mobile-flow-navigation-header-recurrence`, bound **test-heavy**.
- `gate:new` reused the existing draft specification and stable claim; no
  existing reservation for that claim was present. `gate:guard` returned
  **ADMITTED before any implementation or workload**.
- Unified full contract:
  `5ea3dd706f5b8ab94ab7d9a2ce95365ed678d8acccb7f64cc7b78e178bd0323b`.
- Regression Guard full contract:
  `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- Sealed plan hash:
  `150079382bdd94c41502c8eb85155c6e531f0493369fadaaa26f132ad4449e2c`.
- Workload hash:
  `b97e7282b502b201b5dbce053c829127ef14266c924b0389eaf253ecbcd358a5`.
- Executing HEAD: `033e35240cf803c6744a8ef3447b70fdae79d50e`.
- Both runs' before/after filesHash:
  `d09c179f5521e1ecbf6a928f1a104921fbb5d703b1899d589c888f6473541927`.
- Tested mobile spec SHA-256:
  `19a59576e53b7acb8387a85d7174a17df14428b15f8d272dae311c5e9cf6d4b3`.

The valid baseline catalog was empty. No failure was ignored, waived or added
to it. Other historical tasks lack local plan files in this checkout; the
read-only status command explicitly scopes those blockers to their listed
identities. Current operational dependency probes and this task's admission
succeeded; historical tasks were neither rebound nor modified.

## R1 — report provenance and navigation state

The dependency report refers to mobile-chromium's
`hands a captured photo to Photos Reel and reloads its protected image
@mobile-image-orientation`, not to a currently failing delayed-entry case.
Its two retained runs are:

| Run | Date (UTC) | Executing HEAD | Observed failure |
|---|---|---|---|
| `a04ea245-d052-4d80-9001-e9966ba6160b` | 2026-10-21 20:16 | `50aa30f8519409287e0b837e0c481b6c8fc2964b` | Initial navigation, caller line 260; missing header at helper line 231 after 5 seconds. |
| `718f62a0-69b5-4904-9424-4a9d563159c6` | 2026-10-21 20:25 | Same HEAD | Same case, project and initial-navigation failure. |

`git show` of that exact HEAD confirms its helper probes `header.isVisible()`
immediately, then clicks the toggle if the loading page has no header.
Its complete mobile spec hashes to
`1fddaa134400464e49a1b389dfac670053b70763d7b7d22bbecf4e3b6733d4c5`.
This is not the helper executing now.

The readiness correction was committed on 2026-10-24 as `ce273344`.
The current helper is identical to that correction: await a visible, enabled
toggle with a recognized label; click only `Mobile Flow`; require visible header
and resulting `Reel IDs` label. The only later changes in this spec independently
derive the persisted photo filename and assert final single upload/registration
counts. No current helper repair is warranted by the evidence.

The old reports do **not** retain the actual URL, session GET outcome or pre-click
toggle label. Those values cannot be reconstructed from a line number, and are
not invented here. The known old caller navigates to `/session/${session.id}`;
the retained error establishes the absent header, not a proven auth or upload
failure. The previously delivered controlled test explains the old ordering.

In the current run no header failure occurred. Both delayed cases held only the
exact session GET, asserted absent controls while held, then continued the real
authenticated response and asserted the matching session name, visible header,
aisle input and `Reel IDs` label. This is rendered successful-session evidence,
not a separately captured numerical GET status. No credentials or response bodies
were added to the handoff.

## R2 / R3 — requirement-to-result map

All results below come from full run
`1166e25b-a188-4a14-9713-58962f7ef958`, mobile-chromium, attempt 0.
Existing normal-form guard declarations were reused, not weakened or deferred.

| Requirement | Existing case and detecting assertions | Actual outcome |
|---|---|---|
| R2: phone capture stays active after delayed readiness | `waits for delayed session readiness from phone capture`: absent controls while GET held; visible capture header and aisle after release; exact toggle click history `[]`; second entry leaves history unchanged. | **PASS** |
| R2: full mode switches exactly once | `waits for delayed session readiness from full mode`: fresh width-1024 mount; same readiness barrier and final controls; click history exactly `["Mobile Flow"]`, unchanged on re-entry. | **PASS** |
| R3: preserve real photo handoff | `hands a captured photo to Photos Reel and reloads its protected image`: real file preparation and durable offline queue, zero offline requests, one successful direct upload and registration, identical object paths, exact generated filename and 37×23/B/007 metadata, drained queue, single reel card, decoded protected image and successful GET counts before and after reload, unchanged API readback and final single response counts. | **PASS; every downstream assertion reached** |

All six phone orientation cases and all eight desktop queue cases also passed.
No arbitrary sleep, blind retry, skip, fake photo registration or auth bypass was
introduced. The controlled tests already detect the old race: its early absent-
header probe queues a disabling click after phone readiness, violating both
header visibility and zero-click history. No redundant guard was added.

## Commands and actual results — 2026-10-25

All workload commands used:

```sh
export TASK_ID=9fd93339-e86d-4fe6-98b8-91f4c2ed24d9
export TASK_PLAN_FILE=.local/tasks/$TASK_ID.md
```

| Command | Run / result |
|---|---|
| `npm run gate:run -- --tier test-heavy` | `1166e25b-a188-4a14-9713-58962f7ef958`: **FAIL**, exit 1, 704.5 seconds. All 19 registered steps reached; first 18 passed. Browser step: **74 passed, 1 failed, 2 skipped, 0 flaky**. |
| `npm run gate:run -- --tier test-heavy --step browser-tests --file tests/clerk-sign-in-navigation.spec.ts --pattern 'signed-out Settings entry returns'` | `ecf9428c-12ad-4516-9f2c-1f38c5b94982`: compiler-first diagnostic **SUCCEEDED**, one selected/executed/passed, zero failed/skipped, attempt 0. The gate correctly records **INCOMPLETE / exit 1**, not full-tier PASS. |

The isolated run's shell wrapper printed a tail after the command, so its outer
shell exit 0 is not the gate exit or aggregate result.

The two browser skips are existing opt-in pageview diagnostics:
`POST /api/track/pageview returns 429 after threshold` and
`isolated anonymous pageview diagnostic @security`. They are not Mobile Flow
assertions or task-added exclusions. All workload steps were reached; no Mobile
Flow/photo check was skipped or left not reached. Local policy enabled Chromium
and mobile Chromium; WebKit is CI-only here. No iPhone/WebKit or remote-matrix
pass is claimed.

## Separate sign-in failure and disposition

The failing full-run case is chromium's
`tests/clerk-sign-in-navigation.spec.ts:53`,
`signed-out Settings entry returns to protected Settings after form sign-in`.
It timed out in `page.waitForFunction` after 30 seconds. Its passing isolated
diagnostic establishes intermittency only; no external-service root cause or
production auth defect was established.

The supported classification uses **untouched-diff** evidence: this task made
no executable changes whatsoever before either run, and both targets remained
identical. The failure therefore exists on the incoming checkout rather than
being introduced by this task. This inference is independent of the diagnostic
pass and does not erase the full-tier FAIL. Authentication repair is outside
this assignment and already has separate diagnosis/recovery work; no duplicate
follow-up was proposed.

Classification record: `2eb8c57f-651d-432f-8279-abf6febd805d`.
`gate:merge-guard` returned **READY** and `git diff --check` was clean.
The managed preview started successfully on port 5000, and its anonymous landing
page screenshot is healthy. That screenshot is not signed-in UI verification;
signed-in evidence comes from the completed browser cases above. Existing
development-key, anonymous 401 and PostCSS warnings remain. Automatically started
independent validation workflows are not part of this task's admitted evidence.
An automatically added port-exposure setting was removed to preserve the incoming
runtime configuration.

Portable run targets, commands, bounded output and diagnostic case outcomes are
retained in `docs/validation/unified-registry.json`. Raw Playwright reports are
environment-local, not durable deliverables. This handoff was added after the
runs; executable inputs remain unchanged. Delivery is a stale-report diagnosis
with current passing Mobile Flow evidence, **not an all-checks-passed claim**.
