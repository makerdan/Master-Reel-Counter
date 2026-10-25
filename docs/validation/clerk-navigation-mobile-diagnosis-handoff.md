# Clerk navigation and mobile readiness diagnosis

## Current outcome: diagnostic stage delivered; aggregate validation FAIL

The full required bound invocation was attempted, not replaced by filtered
results. It failed at `security-audit`; no aggregate PASS, cause-specific Clerk
repair or current photo-handoff verdict is claimed. The current application
sign-in and Mobile Flow code and both browser test files remain unchanged.

### Full bound workload and remaining limits

```sh
TASK_ID=ff5f011e-7a04-45c8-a9f4-3792cf7e471f \
TASK_PLAN_FILE=.local/tasks/ff5f011e-7a04-45c8-a9f4-3792cf7e471f.md \
node scripts/serial-lock.mjs --resource validation --priority 3 --timeout-ms 900000 -- \
  npm run gate:run -- --tier test-heavy
```

Run `7c859643-5a59-4212-a875-db9834b14394`: **FAIL**, exit 1, completed
2026-10-25 00:27:54 UTC. Target and targetAfter agree:
HEAD `5ee558bfc8220782cb086d2f0af66bb3f5a7e50d`,
filesHash `bc14972a9528f105ae2d478cc477600e8b54472e42cdba7cdf757dd3053cd9b8`.
The different aggregate fingerprint includes the added candidate/delivery
documentation; executable browser source remains unchanged.

- `startup-smoke`: PASS, PostgreSQL 16.10 and test-owned server startup.
- `startup-smoke-boundaries`: PASS, 27 passed and one existing CI-only skipped.
- `security-audit`: FAIL, `npm audit --audit-level=high` exit 1:
  **9 vulnerabilities (5 moderate, 4 high)**. High findings include body-parser
  `GHSA-27r3-jxmh-p828`, multer `GHSA-q7qp-rjg7-q26m` and zod
  `GHSA-mrhx-c7xc-m3w5` (plus a dependent high entry); the moderate
  selector-parser chain reports `GHSA-rj75-hqrm-r3gf`.
- Not reached in this full run: schema-check, release-schema-contract,
  workspace-skill-contract, typecheck, storage-lint, port-reference-scan,
  storage-lint-contract, unit-tests, vite-hmr-tests, vite-hmr-recovery-tests,
  serial-lock-tests, port-authority-tests, manifest-parity,
  nested-tier-regression, collision-smoke and browser-tests.

The registered audit step is kind `audit`, not a selectable kind `test`, so
there is no supported isolated per-test retry for that audit. No direct audit
retry, baseline exclusion, dependency change or assertion suppression was used.
This unlisted failure remains visible, not waived or reclassified by a passing
browser retry. The independent automatic heavy workflow also failed at audit;
its result is not substituted for this admitted run.

Public preview sanity check: the managed development workflow started cleanly
and the signed-out landing page rendered. The expected signed-out local-user
request returned 401; this is not a failed authenticated authorization verdict.
The screenshot did not verify signed-in UI. The real-form passing retry above
did verify protected Settings and local-user HTTP 200. Stop the development
workflow again before any further isolated browser run so Playwright cannot
reuse a server connected to the development database.

The runtime-generated 5001 `exposeLocalhost` setting is restored to the original
configuration after validation; no persistent port/workflow policy change is
part of delivery. This cleanup and final evidence notes occur after the recorded
run and do not convert its failure into a pass.

### Current requirement map and reproduced stage

| Requirement | Current observed evidence | Disposition |
|---|---|---|
| R1: distinguish activation, automatic Settings navigation, protected rendering and local-user HTTP 200 | Original real email/password case failed on Chromium at line 71, the `Clerk.loaded && Clerk.session.id` wait. Exact redacted signature: `TimeoutError: page.waitForFunction: Timeout 30000ms exceeded.` The later URL, Settings-title and HTTP 200 checks were not reached. Isolated retry passed the entire unchanged case, including all four assertions. | Intermittent activation-stage failure reproduced. No production routing or local-authorization cause established. No snapshot of Clerk's separate loaded/session booleans, challenge visibility or challenge timing was collected, so the failed predicate's specific component and root cause remain unknown. |
| R2: preserve default capture without disabling clicks and enter capture from full mode once | Both controlled delayed cases executed and passed in `mobile-chromium`, attempt 0: capture header, `Reel IDs`, matching session name, aisle input, histories exactly `[]` and `["Mobile Flow"]`, and unchanged histories on re-entry. | Current readiness success, not a photo-handoff or WebKit verdict. |
| R3: evidence-scoped amendment preparation and honest full-tier outcome | `docs/plans/clerk-activation-diagnostic-amendment.spec.json` prepares the next SAME-task diagnostic amendment. `gate:draft` accepted it as `UNADMITTED_NATIVE_DRAFT` without ledger writes. It specifies bounded allow-listed instrumentation and detecting privacy/deadline tests before collecting further provider evidence; a challenge/session coordinator requires decisive evidence and a further amendment. | Candidate prepared, not applied or implemented. Current admitted diagnostic revision remains 1. No cause-specific repair is claimed or justified solely by a timeout. Full bound run failed at audit as recorded above. |

The candidate is not a second task or a new sealed identity. To apply it later,
use `gate:amend -- --id ff5f011e-7a04-45c8-a9f4-3792cf7e471f --spec
docs/plans/clerk-activation-diagnostic-amendment.spec.json --reason ...`, with
accurate authorization applicability, then re-guard before instrumentation.
The draft renderer's generic new-task preflight is not the resume route for
this existing identity. No instrumentation or challenge coordinator was delivered.

### Actual diagnostic commands and targets — 2026-10-25 UTC

All use the common admitted context and existing resource wrapper documented
below. No assertions, defaults, project selections, credentials or authentication
methods were changed between attempts.

| Command after `npm run gate:run -- --tier test-heavy` | Run / observation |
|---|---|
| `--step browser-tests --file tests/clerk-sign-in-navigation.spec.ts --pattern 'signed-out Settings entry returns to protected Settings after form sign-in$'` | `cf4c9bae-77ad-479f-bd97-36c3c7c33315`: **FAIL**, one Chromium case executed/failed, zero skipped. Exact activation timeout above recovered by allow-list extraction from the retained error context. Compiler/config checks passed; isolated database preparation and disposable provider/local fixture cleanup completed. |
| `--step browser-tests --file tests/mobile-photo-upload.spec.ts --pattern 'waits for delayed session readiness'` | `6bba59ef-8785-49f3-8303-829714250144`: diagnostic **SUCCEEDED**, two phone cases executed/passed, zero failed/skipped/cancelled. Overall run **INCOMPLETE**, as required for a filter. |
| Original sign-in command, isolated retry | `ffc16f16-7481-4158-be65-87b8000622cc`: diagnostic **SUCCEEDED**, one Chromium case executed/passed, zero failed/skipped/cancelled. Overall run **INCOMPLETE**, not full-tier PASS and not proof that the failure predates this task. |

HEAD for all three: `5ee558bfc8220782cb086d2f0af66bb3f5a7e50d`.
Original sign-in filesHash:
`012d9dded3f62c10162fa08144430afec7685c9b88b286dd05836b0a336a4e3f`.
Phone and retry filesHash:
`fbdbec8ab67313a90900e89096e9a001b97efd2b295c5445d9bad6393fbb27b4`.
Each run's target and targetAfter match. Between the first and second run,
the runtime added `exposeLocalhost = true` to the existing 5001 port mapping
while an independent smoke workload ran. No application/test source changed.
The report does not silently treat these different aggregate fingerprints as
identical. The current diagnostic tests are unchanged in both.

The existing browser wrapper prepared a distinct temporary database for each
run, passed the isolated URL to the test-owned server, and cleaned fixtures.
Port 5000 had no pre-existing server. The preserved project policy enabled only
Chromium and mobile Chromium; no local WebKit execution or full remote-matrix
coverage is claimed.

Retained HTML report decoded read-only before diagnostics: total 69, expected 69,
unexpected/flaky/skipped 0, duration approximately 345 seconds. Both retained
last-run markers said passed. This does not recover the separately reported
68/70 run's signature; the current timeout above is new observed evidence, not
a fabricated attribution to that older report.

### Authorized gate maintenance outcome

The initial admission blocker below is retained as historical evidence. The
owner explicitly authorized repairing the registry-reading limit and continuing.
That narrow maintenance now resolves a Git blob once, sizes its bounded output
read from the immutable object's length, and preserves all comparisons. It covers
committed HEAD, merge-parent and staged-index registry reads; generic Git command
limits and timeouts remain unchanged. No historical registry event was edited.

Maintenance regression coverage is normal, not diagnostic self-satisfaction:
`scripts/__tests__/unified-gate.test.mjs`, “large committed and staged registries
preserve admission and history checks”, exercises valid JSON exceeding 4 MB,
staged and committed preservation checks, rejection of removed/rewritten history,
and subsequent supported provisioning/guarding. The first full maintenance run
had 30 passes and one new-test fixture error (attempted access to the reservation
event's absent spec). After correcting the test to inspect the sealed event, the
focused run passed (1 executed, 30 filtered). A subsequent full run's observation
was interrupted after case 26; it is not claimed as a complete pass. The final
bounded full maintenance run passed **31/31**, zero skipped/cancelled, in
approximately 19.5 seconds:

```sh
timeout --signal=TERM --kill-after=3s 100s node --test --test-timeout=80000 \
  scripts/__tests__/unified-gate.test.mjs
```

These are gate-maintenance checks, not application-tier PASS evidence. The
material maintenance boundary has normal regression coverage even though the
separately admitted unchanged-browser diagnostic stage is self-satisfying.

Supported admission now allocated `ff5f011e-7a04-45c8-a9f4-3792cf7e471f`,
revision **1**, bound exclusively to **test-heavy**. Agent-first
`gate:guard -- --tier test-heavy` returned **ADMITTED** before diagnostic execution.
Plan hash: `19cd7b0645a170f22ecc2762e0980246b9af598a7469783d711770b5da163bb0`.
Workload hash: `b97e7282b502b201b5dbce053c829127ef14266c924b0389eaf253ecbcd358a5`.

Existing automatically running validation workflows were observed on this fork.
They are not this task's admitted evidence and are not stopped or claimed as such.
Diagnostic dispatch will coordinate through the existing validation resource
lock rather than overlap their shared outputs. Port 5000 was idle at inspection;
the separate mockup server on 23636 is unrelated. The browser wrapper creates a
distinct temporary database, validates isolation, and gives its URL to the
test-owned server; no existing development app is to be reused.

Common diagnostic context:

```sh
export TASK_ID=ff5f011e-7a04-45c8-a9f4-3792cf7e471f
export TASK_PLAN_FILE=.local/tasks/$TASK_ID.md
```

Planned commands (results must be added after observation):

```sh
npm run gate:run -- --tier test-heavy --step browser-tests \
  --file tests/clerk-sign-in-navigation.spec.ts \
  --pattern 'signed-out Settings entry returns to protected Settings after form sign-in$'
npm run gate:run -- --tier test-heavy --step browser-tests \
  --file tests/mobile-photo-upload.spec.ts \
  --pattern 'waits for delayed session readiness'
npm run gate:run -- --tier test-heavy
```

When another workflow owns validation, wrap dispatch in the existing
`node scripts/serial-lock.mjs --resource validation --priority 3 --timeout-ms 900000 --`
command. This coordinates existing resources without changing gate admission or
selection policy. Filtered runs remain supplemental and cannot establish full PASS.

## Initial outcome: BLOCKED before execution admission (historical)

No current Clerk or Mobile Flow verdict is established. No application code,
test helper, provider configuration, baseline or validation policy was changed.
No browser diagnostic or full `test-heavy` workload ran. Independent verification
is not selected. This document is a prerequisite-failure record, not a sealed plan,
admission, repair delivery or validation PASS.

## Inspected context

- Checkout HEAD: `14b90ccc` (current branch `main`).
- Candidate input: `docs/plans/clerk-navigation-mobile-diagnosis.spec.json`,
  stable retry claim `clerk-navigation-mobile-diagnosis-997`.
- No existing registry identity matches that claim. The older sealed sign-in
  repair identity is preserved; its repair scope is not reused as authorization
  for this diagnostic stage.
- Canonical full-package Unified identity verified by the current pin loader:
  `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Adopted Regression Guard full-package identity:
  `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
  Candidate parsing reached the writer/history check after its declaration checks.
- Baseline catalog inspected: schemaVersion 1, empty records array. Nothing is
  authorized to be ignored.
- Intended tier: `test-heavy`, not bound. Current manifest retains its 900000 ms
  budget, real browser journey, compiler, unit and Clerk contract checks.
- Clerk management lookup reported managed. No tenant or secret was changed.
- Production/test source inspection confirms the real form's separate activation,
  automatic Settings URL, protected title and local-user HTTP 200 assertions.
  Both existing controlled delayed readiness cases retain exact zero/one click
  assertions and idempotent re-entry.
- The saved readiness handoff reports both readiness cases passing historically
  and a separate downstream filename mismatch. Those are historical results,
  not current execution evidence or active ignored baselines.
- Existing browser project policy enables Chromium and mobile Chromium locally;
  WebKit remains conditional on the existing CI/explicit-enable policy. Actual
  provider permissions, database isolation, browser availability and server
  ownership have not been established by an admitted workload.

## Exact admission failure

Command:

```sh
npm run gate:new -- --spec docs/plans/clerk-navigation-mobile-diagnosis.spec.json
```

Observed exit **2**:

```json
{"state":"BLOCKED","check":"new","reason":"git prerequisite failed: show"}
```

Read-only diagnosis of the same Git operation and unchanged limit:

```js
spawnSync("git", ["show", "HEAD:docs/validation/unified-registry.json"], {
  encoding: "utf8", timeout: 3000, maxBuffer: 4_000_000
});
```

Observed: status `null`, signal `SIGTERM`, error code `ENOBUFS`, message
`spawnSync git ENOBUFS`, stdout bytes `4014080`, empty stderr.
The current registry is **4701851 bytes**. A direct shell Git read succeeds,
distinguishing this from missing Git history. The gate's generic Git wrapper
uses the smaller buffer when merge preservation reads the committed registry.
The failure occurs in `withWriter`'s history-preservation precheck before the
provisioning callback can allocate an identity. Working-tree status after the
attempt showed only the new candidate specification; no registry change or new
sealed plan is claimed.

The smallest prerequisite repair is capacity-safe reading of retained committed
registry history while preserving comparison checks, seals, identities, bindings
and history. No registry truncation, history deletion, direct workload bypass,
buffer override or gate edit was attempted. Gate maintenance requires explicit
owner direction under the canonical maintenance exception; it is excluded by
the current diagnostic assignment.

## Initial requirement map (superseded by current observations above)

| Requirement | Existing detecting checks | Current result / gap |
|---|---|---|
| R1: Real form activates Clerk, automatically arrives at Settings, renders protected Settings and receives local-user HTTP 200 | `tests/clerk-sign-in-navigation.spec.ts`, signed-out Settings entry returns to protected Settings after form sign-in | **BLOCKED / NOT RUN**. No current project/case failure signature or root cause established. The 12-second challenge observation remains a candidate, not a verified defect. |
| R2: Delayed phone capture preserves zero clicks; full-mode entry uses exactly one click | `tests/mobile-photo-upload.spec.ts`, both waits for delayed session readiness cases | **BLOCKED / NOT RUN**. Historical passes do not establish this checkout's result. No readiness or downstream photo assertion was reached. |
| R3: Evidence-supported repair amendment or explicit limitation, with full bound outcome | Supported `gate:new`, `gate:guard`, diagnostic `gate:run`, amendment only after decisive evidence, then full `gate:run -- --tier test-heavy` | **BLOCKED** at admission. No ID, sealed revision, plan hash, bound workload hash, run target fingerprint or successful guard exists for this candidate. No product repair amendment is justified. |

## Initial resume boundary (resolved by owner authorization above)

Obtain owner direction for the narrow gate prerequisite repair before editing
the gate. After it is repaired through the maintenance route, reconcile the
stable claim and use the same candidate with supported admission; do not invent
an identity or alter the older sealed repair in place. Run Agent-first preflight,
establish actual server/database isolation and project availability, then perform
the requested existing diagnostics and complete bound workload. Preserve every
failed attempt and report stage/project/signature separately from any retry.
This diagnostic task is **not complete**.

No follow-up batch was published: the assignment already names separate downstream
readiness reload/error and photo-assertion work. Required current-scope checks
remain here rather than being relabeled as completed follow-ups.
