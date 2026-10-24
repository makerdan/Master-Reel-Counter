# Mobile Flow readiness repair

## Scope, admission and outcome

**Readiness repair delivered; aggregate validation remains FAIL, not PASS.**
Production capture defaults, upload/registration APIs, image preparation,
authentication, WebSockets, reconnect indicators and browser project selection
are unchanged. No deployment or independent review was selected or performed.

The supported provisioner admitted identity
`c0f0b40a-2791-4143-af29-28c643f18da2`, sealed revision **1**, bound to
**test-heavy**. Agent-first `gate:guard -- --tier test-heavy` returned
**ADMITTED before implementation or validation**.

Full normative contracts were verified before admission:

- Unified: `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`
- Regression Guard: `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`
- Plan hash: `1ebdac7d5c4662bfa808570f1b7c148eb2db373da80c22eba5f5e502754f3f3d`
- Bound workload hash: `b97e7282b502b201b5dbce053c829127ef14266c924b0389eaf253ecbcd358a5`

The inspected baseline catalog is valid schemaVersion 1 with an empty records
array. No baseline, waiver, exclusion, retry increase or tier change was added.
The phone-header failure is owned repair scope, not an ignored baseline.
The current Regression Guard self-satisfying form is appropriate because the
entire implementation repairs/adds browser tests for unchanged application
behavior; it still delivers the concrete R1–R3 coverage planned in the draft.
No material production change requiring amendment proved necessary.

## Delivered snapshot and deterministic ordering

Only `tests/mobile-photo-upload.spec.ts` changes executable behavior.
Its tested SHA-256 is
`295f6d394ad4863a39da30693015777a578502cbdd89e4dd1451ea01422f761a`.
The original real-photo handoff body and every existing metadata, upload,
registration, image and reload assertion remain unchanged.

`enterMobileFlow` waits for the visible, enabled session toggle and its explicit
mode label. The label is present in the DOM even when hidden visually on phones.
Only the full-mode label `Mobile Flow` permits one click; the active-capture
label `Reel IDs` permits none. Capture header and resulting toggle label are
asserted after entry. This behavior is shared by first navigation, reload and
the two readiness cases.

Both new cases hold only the exact session GET request, leaving its real response
and all other requests intact. After navigation and request observation, they
prove both header and toggle are absent, start entry, perform another browser
round-trip while the response is held, and release readiness. The old helper
issued its immediate header visibility probe during this interval, selected the
click branch, then waited for the toggle; on a phone that later click disabled
the default capture view. The new helper waits instead. No arbitrary sleep,
upload interception, repeated toggle attempt or changed production default is
used. A document capture-phase listener records actual toggle clicks and their
pre-click labels.

The full-mode case uses a fresh session mount at width 1024 in the existing
touch/mobile project; the unchanged production width default initializes full
mode. Both cases also call entry again after capture is active and require the
click history to remain unchanged.

## Revision-bound requirement map

| Label | Actual case/assertions | Observed result and remaining gap |
|---|---|---|
| R1: delayed phone readiness preserves active capture | `waits for delayed session readiness from phone capture @mobile-image-orientation`: absent controls while held; final capture header, `Reel IDs` toggle label, matching session name and aisle input; click history exactly `[]`, including idempotent re-entry. | **PASS**, mobile-chromium, attempt 0 in file diagnostic `490a9e1b-ef2b-47ea-accc-6fbd0a2a22a9`. |
| R2: delayed full-mode readiness activates capture exactly once | `waits for delayed session readiness from full mode @mobile-image-orientation`: same readiness barrier and capture assertions; click history exactly `["Mobile Flow"]`, unchanged by re-entry. | **PASS**, mobile-chromium, attempt 0 in the same diagnostic. |
| R3: preserve the real server-backed photo handoff | Existing `hands a captured photo to Photos Reel and reloads its protected image`: offline queueing with zero uploads while offline; online single direct upload and registration; successful responses, identical object path, one persisted photo and drained queue. All later metadata and protected decoded-image/reload assertions remain intact. | **PARTIAL / FAIL**: mode entry, upload, registration, queue drain and photo API read passed. Metadata comparison failed only on the exact persisted filename, before Photos Reel navigation. Reel decoded-image, successful protected GET counts, reload and final readback assertions were **NOT REACHED**, not passed. The isolated retry reproduced this same failure. |

## Commands and actual results — 2026-10-24

All three runs used the same delivered source target:
HEAD `24573fcb03c2602749d35f778b3a61848d027d8a`,
filesHash `b0106e88765cd19bed93146985224e6b6cfd6a9c17d83b8afdfd6742f9a543ce`.
Their before/after targets agree. This handoff was added afterward; no executable
source has changed since those runs. Portable observations, hashes, counts,
classification evidence and bounded output excerpts are in
`docs/validation/unified-registry.json`. Raw local run and Playwright artifacts
are environment-local evidence, not committed deliverables.

Common context:

```sh
export TASK_ID=c0f0b40a-2791-4143-af29-28c643f18da2
export TASK_PLAN_FILE=.local/tasks/$TASK_ID.md
```

| Command | Run | Actual outcome |
|---|---|---|
| `npm run gate:run -- --tier test-heavy` | `70b14bb6-39ad-4ef2-915f-dfae31badd3a` | **FAIL**, exit 1, about 30 seconds. Startup smoke passed; startup-boundary workload passed with 27 passed / 1 CI-only skipped; `security-audit` exited 1 with 9 vulnerabilities: 4 high, 5 moderate. |
| `npm run gate:run -- --tier test-heavy --step browser-tests --file tests/mobile-photo-upload.spec.ts` | `490a9e1b-ef2b-47ea-accc-6fbd0a2a22a9` | **FAIL**, exit 1, about 104 seconds. Compiler/config checks passed first. **17 executed: 16 passed, 1 failed, zero skipped/cancelled**. Both new readiness cases, all six orientation cases and all eight desktop queue cases passed. The real phone handoff failed at its filename expectation. |
| Same diagnostic with `--pattern 'hands a captured photo'` | `c34225b6-b4e6-4254-9d59-aace07e8d7ca` | **FAIL**, exit 1, about 34 seconds. Compiler/config checks passed; one phone case selected/executed/failed with the same filename mismatch. This is not a passing retry or evidence of intermittency. |

Each diagnostic retains the existing default project grep/grep-invert policy and
isolated database lifecycle. Chromium and mobile Chromium were enabled; local
WebKit was not selected by the existing Nix host policy. **No WebKit pass or full
remote browser-matrix coverage is claimed.** File diagnostics do not certify the
other browser files or replace the required full-tier result.

After the audit failure the full run did **not reach**: schema-check,
release-schema-contract, workspace-skill-contract, typecheck, storage-lint,
port-reference-scan, storage-lint-contract, unit-tests, vite-hmr-tests,
vite-hmr-recovery-tests, serial-lock-tests, port-authority-tests, manifest-parity,
nested-tier-regression, collision-smoke or browser-tests.
The diagnostics separately establish compiler success and the selected browser
outcomes; they do not convert these aggregate not-reached steps into passes.
Pre-existing automatically started workspace workflows are not used as this
task's admitted validation evidence.

## Failure classification and reconnect observations

Supported `gate:classify` records retain both unlisted failures as
**SELF_CLASSIFIED_PRE_EXISTING**, without changing either raw FAIL:

- Audit: the package manifest/lockfile and dependency consumers are identical to
  HEAD. The test-only readiness change cannot introduce the audited installed
  versions. Current roots include body-parser, multer, postcss-selector-parser
  and zod, plus their dependent chains. `security-audit` is an audit step, not a
  selectable test-step diagnostic; no isolated audit retry is claimed.
  Classification record: `6c3daa76-7de1-4e6c-b8b3-77a6a5c89fa8`.
- Filename: the handoff still expects `handoff.jpg`, but unchanged atomic
  registration in `server/storage.ts` generates
  `S${sessionId}_P${String(photoId).padStart(4, "0")}.jpg`.
  The file diagnostic returned `S10_P0011.jpg`; the isolated retry returned
  `S1_P0001.jpg`. Both failures retained the correct dimensions 37×23, aisle B,
  section 007, registered ID and object path. The expectation and production
  naming code are both unchanged from HEAD, and the existing
  `.local/tasks/prepare-photo-assertion-repair.md` already describes this exact
  mismatch and its separate repair scope.
  Classification record: `71ea3e9f-3ed2-44e2-9746-d47991b490cb`.

The phone failure snapshots show **Mobile Flow active and reconnecting banners
visible**, after successful real upload and registration. This is not proof of
an upload failure or of successful image reload. The new cases also attach a
separate reconnect observation rather than asserting connectivity as mode or
upload success. No banners are suppressed and no WebSocket or rate-limit work
was performed.

The managed preview was started after browser diagnostics and serves port 5000.
The anonymous public landing-page screenshot is healthy; it is **not signed-in
capture UI verification**. Signed-in readiness evidence comes from the browser
cases above. Existing development-key, anonymous 401 and PostCSS warnings remain.

## Remaining disposition

The readiness recurrence is covered and observed passing. Full-tier validation
and the real-photo handoff as a whole still fail for the disclosed reasons.
Later image/reload evidence remains unavailable until the existing separate
photo-assertion repair is executed; do not loosen these assertions or alter
production naming to make this task green.

Existing photo assertion/naming, downstream dependency and browser-lifecycle
work are not duplicated. Two test-only follow-ups were proposed for distinct
boundaries not covered by the delivered initial-mount cases: controlled delayed
reload and explicit session-load failure/Retry recovery. They are unadmitted
drafts, not deferred requirements of this repair. No separate review task was
created.

Final `npm run gate:merge-guard` returned **READY** (task/tombstone and
committed-history preservation); `git diff --check` was clean. No deployment was
performed.
