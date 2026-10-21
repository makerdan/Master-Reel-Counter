# Sign-in session activation repair — preparation handoff

## Outcome

**PASS — plan preparation only.** No application/test behavior was changed and
no application workload ran. This is not a successful repair or browser-suite
result. The preparation record itself has no Unified execution binding.

The supported provisioner allocated implementation plan
`a9a1db88-8e4c-4ce7-b4f3-6cbf42db21d0`, sealed revision **1**, bound exclusively to
`test-heavy`. Its generated local plan is
`.local/tasks/a9a1db88-8e4c-4ce7-b4f3-6cbf42db21d0.md`; its portable sealed contents,
approval evidence, stubs' assertions, binding and history are in
`docs/validation/unified-registry.json`.
The complete provisioner input is
`docs/plans/sign-in-session-activation-repair.spec.json`.

- Plan SHA-256:
  `9fb4214a032baf17b4394348a18d4aae0ee88206dc6db31a04997fd71b7c725e`
- Workload SHA-256:
  `b97e7282b502b201b5dbce053c829127ef14266c924b0389eaf253ecbcd358a5`
- Canonical Failure Gate skill SHA-256 matched
  `docs/validation/unified-pin.json`:
  `2025d914d570b364dea2e7b8bd9dda35881a9b60ccaca67d9d904060b37f6c22`.

## Evidence and limits

The owner-reported **68/70** result is not the available report.
Read-only decoding of `playwright-report/index.html`'s embedded ZIP found
`report.json` with total 69, expected 69, unexpected 0, flaky 0, skipped 0,
and both cases from `tests/clerk-sign-in-navigation.spec.ts` passed.
The two available last-run markers also say passed but contain no failure
signature. Neither source proves the reported timeout is repaired or supplies
its project, exact stack or error. Recover/reproduce those in the admitted repair;
do not fabricate an exact signature during preparation.

The named real-form case is
**signed-out Settings entry returns to protected Settings after form sign-in**.
Its local helper fills email/password, observes an optional verification textbox
for 12 seconds, and enters the test code when seen. The case then waits up to
30 seconds for an active Clerk session, separately checks Settings navigation,
and finally requires HTTP 200 from `/api/auth/user`.
Late challenge appearance and disappearance of automatically submitted controls
are plausible challenge/session-lifecycle races, not established root causes.
An inactive session cannot establish a redirect or approval defect.

The real-form case deliberately imports base Playwright, creates an empty context,
installs testing-token routing, and closes that context in `finally`. It must not
inherit or fall back to the saved owner's session. `tests/fixtures.ts` refreshes
other tests with programmatic ticket sign-in, which is not proof of this form
journey. `tests/global-setup.ts` creates the disposable approved Admin identity;
`client/src/App.tsx` already supplies the allow-listed form fallback destination.
No provider settings or credentials were changed.

The baseline loader used by provisioning successfully validated
`docs/validation/failure-baseline.json`; the catalog has zero records.
Both baseline arrays are empty. No failures may be ignored. The reported timeout
is owned repair scope despite not having a catalog entry.

## Chosen repair boundary

Prefer evidence-supported, test-local coordination of challenge progress and
session activation under one finite deadline, not an unconditional longer wait,
whole-suite retry, reload or password resubmission. A blind timeout increase would
hide a missed challenge; ticket sign-in would bypass the form behavior being
tested. Production lifecycle changes require evidence and a supported plan
amendment before editing that expanded boundary.

The sealed specification includes a normal `## Regression Guard` declaration
in its supported multiline planned-assertion text. It does not modify the gate
renderer, skill, policy, workload or historical plans. The current gate's seal
and structural guard do not prove the semantic adequacy or future delivery of
regression coverage.

| Requirement | Planned guard | Preparation delivery / remaining gap |
| --- | --- | --- |
| R1 | Real email/password/challenge form yields `Clerk.loaded` and nonempty active session | Named existing browser case preserved in sealed plan; actual failing signature and repair execution remain future work |
| R2 | Same journey automatically reaches exact Settings URL and title; authenticated user endpoint returns HTTP 200 | Separate assertions required, not conflated with activation or programmatic navigation |
| R3 | Changed helper handles delayed challenge and auto-disappearing controls; persistent failure terminates within deadline without duplicate submission or work after closure | Deterministic boundary cases required in the browser-selected spec; not implemented or executed here |
| R4 | Changed diagnostics omit sensitive sentinels, cap output at 2 KiB and collection at 2 seconds, and preserve original failure | Explicit boundary assertions planned; no raw provider payloads, submitted credentials or session storage allowed in diagnostic output |
| R5 | Delivery maps admitted revision and target to actual cases and full-tier results | Executor must update a separate delivery record without changing the sealed revision in place |

Preparation is non-runtime planning work; no new guard implementation or
test-of-a-test is claimed. The later material repair is not self-satisfying.
Independent verification is **not selected**.

## Observed plan checks

These checks ran after provisioning; none dispatches an application workload:

```sh
npm run gate:new -- --spec docs/plans/sign-in-session-activation-repair.spec.json
# sealed, revision 1, test-heavy

TASK_ID=a9a1db88-8e4c-4ce7-b4f3-6cbf42db21d0 \
TASK_PLAN_FILE=.local/tasks/a9a1db88-8e4c-4ce7-b4f3-6cbf42db21d0.md \
npm run gate:guard -- --tier test-heavy
# ADMITTED, revision 1

npm run gate:merge-guard
# READY: task/tombstone and committed-history preservation

git diff --check
# exit 0
```

The executable workload definition is `docs/validation/manifest.json`,
`tiers.test-heavy`: its `browser-tests` step runs
`node scripts/run-browser-tests.mjs`, with supporting `typecheck`, `unit-tests`
and `release-schema-contract` steps. The complete tier budget remains 900000 ms.
Coverage registration was inspected; current browser/provider/database execution
availability was not tested and no full-tier PASS is claimed.

## Future executor

Registration is not implementation permission during the preparation assignment.
Confirm applicable owner direction for this exact split scope and revision;
do not invent original receipts or reviewer actions. In a fresh environment,
use `gate:restore-plan -- --id a9a1db88-8e4c-4ce7-b4f3-6cbf42db21d0` when needed.
Set the generated `TASK_ID` and `TASK_PLAN_FILE`, then run
`npm run gate:guard -- --tier test-heavy` before any implementation.
Use `npm run gate:run -- --tier test-heavy --step browser-tests` only as a
supervised diagnostic if needed; it ends INCOMPLETE, not full-tier PASS.
After the coherent repair, run the complete
`npm run gate:run -- --tier test-heavy` under that same context. No other tier
is authorized. Classify any unlisted failure honestly; a passing retry establishes
intermittency, not pre-existing provenance.

The photo assertion repair and broad provisioning-outage task remain separate.
No gate maintenance, provider configuration, deployment, application validation
or independent verification is authorized by this preparation handoff.
