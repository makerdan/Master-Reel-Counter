# Abandoned multipart upload repair

## Admission and scope

Task 1006 is admitted as `f75f44d9-dbb9-4f54-9fed-33eecb9c439e`, revision 1,
plan hash `909ddbe73ef26c91f74b9304d60b3f847c0fadb9932a82828eef162df0e5b69c`.
Canonical Failure Gate Unified and Regression Guard apply; their exact package
pins and sealed specification are retained in `unified-registry.json`.
`gate:guard -- --tier test-heavy` returned ADMITTED before implementation.
`failure-baseline.json` contained zero records; no failures are waived.
Independent verification: **not selected**. No deployment or production data changes.

## Discovery and upload decisions

1. **Architecture:** retain Express multipart uploads with Multer memory storage.
   A new chunk protocol or storage redesign is outside scope and unnecessary
   for the upstream parser correction.
2. **Constraints:** browser HTTP uploads, existing authenticated/approved identity
   and route rate limiting, synchronous JPEG/PNG/WebP MIME filter, 50 MiB default.
   Current synchronous production filters are not directly exposed to the
   asynchronous-filter crash described by upstream; vulnerable dependency
   resolution and future asynchronous use still require correction.
3. **Contract:** retain original multipart names and metadata, existing direct
   upload registration and generated storage keys. No resumable-session protocol,
   durable upload manifest, new retries or idempotency semantics are introduced.
4. **Validation:** direct upload preserves its existing MIME policy (not a new
   signature gate); avatar conversion decodes through Sharp. Existing malformed,
   corrupt-image, boundary-size, unexpected-field and MIME tests remain.
5. **Security:** production authorization, protected object serving, object paths,
   and local fallback behavior are untouched. Direct upload persists to object
   storage with existing disk fallback; avatar/logo handling and cleanup remain
   route-owned. The isolated test identity is not a substitute for Clerk tests.
6. **Recovery:** unchanged user retry and upload UI. Tests require a subsequent
   accepted authenticated fixture upload after abort, not merely a responsive
   error endpoint.
7. **Cleanup:** production parser owns temporary memory and file streams; route
   storage side effects happen only after successful parsing. Tests measure
   parser/file closure and empty placeholders/no late persistence. No bucket or
   database is touched by these fixtures.
8. **Adversarial matrix:** stalled asynchronous filter plus rejection/truncation;
   real client disconnect while filter is pending; late callback after cleanup;
   unauthenticated upload; unsupported MIME; malformed parts; oversize and exact
   limits; subsequent valid upload. Unhandled stream errors intentionally remain
   unhandled in the reproduction, so the vulnerable version cannot be masked by
   a test-installed error listener.
9. **Decision:** use upstream Multer 2.5.0, a compatible major-2 update, rather
   than local middleware patches. Broader upload operations are not redesigned.

## Upstream and graph evidence

- Advisory: https://github.com/advisories/GHSA-q7qp-rjg7-q26m
- Upstream reports affected `>=2.0.0, <2.5.0`, first patched `2.5.0`.
- Fix: https://github.com/expressjs/multer/commit/80a2d9df1dfd63b5fab631b8b9966164ed647adf
  retains an error listener after parser teardown. The reproduction follows
  upstream's two-file parked-write ordering, with additional closure and
  no-storage assertions.
- Before: root actual consumer `multer@2.4.0`. After: `multer@2.5.0`;
  package requirement `^2.5.0`, integrity-locked public npm tarball.
- The prior tracked dependency-security delivery addressed the older
  `GHSA-3pph-fpjx-jg34`; this task owns the new advisory. No local archive for
  Security scan 1004 was available; no claim of inspecting its unavailable
  native detail is made.

## Requirement-to-delivery map

| Label | Delivered guard | Evidence / disposition |
|---|---|---|
| R1 patched graphs | `server/__tests__/dependency-media-security.test.ts`: stable minimum 2.5.0, all lock entries, nested installed copies, actual server consumer, sandbox graph, negative affected versions, disposable `npm ci` | Final guarded diagnostic passed all 17 cases, including clean install. The clean install disables lifecycle scripts to test graph portability; native compatibility is tested in the real workspace. |
| R2 teardown | Same file: upstream pending-filter reproduction and real HTTP disconnect while a filter is parked; two-second resource deadlines, one completion, destroyed streams, no late storage, empty temporary placeholders | Initial guarded diagnostic executed and passed both new scenarios; no error-listener masking. |
| R3 compatibility | Existing image parser tests retained; fixture now checks unauthorized rejection and a valid authenticated upload after disconnect. Existing production browser cases unchanged | Final upload diagnostic: 17 passed. Browser diagnostic: 71 passed, 1 failed, 1 skipped. Existing photo/avatar/logo cases passed; mobile handoff failed on generated filename expectation. |
| R4 full validation | Bound `test-heavy`, 900000 ms, unchanged manifest/workloads/baselines | FAIL at security-audit for body-parser and Zod, not Multer. No full-tier PASS or completion claim. |

## Execution

All validation uses:

```sh
TASK_ID=f75f44d9-dbb9-4f54-9fed-33eecb9c439e \
TASK_PLAN_FILE=.local/tasks/f75f44d9-dbb9-4f54-9fed-33eecb9c439e.md \
npm run gate:run -- --tier test-heavy
```

Guarded diagnostics add `--step` and, where supported, `--file`; they never
replace the full run. Exact run IDs, target fingerprints, step logs, timing and
results are retained by the gate. This handoff was prepared before final
validation so document edits do not change its in-flight source fingerprint.

## Final observed results and blockers

- Initial diagnostic `c33d0a17-8d19-47a8-bee4-4c56753a149e`: 16/16 cases passed.
- Full bound run `6ca56067-6527-4202-bfe8-a96ecafeba99`: **FAIL**.
  Startup smoke and startup boundary tests passed; `security-audit` failed.
  The remaining full-tier steps were not reached.
- Diagnostic `1e957eb4-133b-41cf-935b-ebaed1ed28fe`: 15 passed, 2 failed.
  The new directory scanner incorrectly treated `@types/multer` as Multer.
  Corrected it to check package metadata identity, not directory basename.
- Final upload diagnostic `6bad46b2-fb2d-46ec-bfb0-d7d88d99c000`: **17/17 passed**,
  zero skipped/cancelled. Includes successful disposable locked installation,
  version checks, async-filter teardown and authenticated recovery.
- Browser diagnostic `320e3b96-9517-4d9c-98fd-0fc1910872aa`: 71 passed,
  1 failed, 1 skipped. The failed mobile handoff expected `handoff.jpg` but
  received the server-generated `S95_P0026.jpg`; upload, registration, dimensions
  and object path matched. Later image reload assertions were not reached.
- Isolated browser retry `900dd34f-88ee-45f1-924d-85bfe32cbcd5`: same selected
  mobile handoff case failed. The wrapper successfully ran `npm run typecheck`
  before Playwright, including the corrected dependency test. Local projects:
  Chromium and mobile Chromium, not CI-only WebKit.
- Standalone `--step typecheck` and `--step security-audit` diagnostic attempts
  were rejected: this gate permits only registered **test** steps as diagnostics.
  No bypass was used. Typecheck subsequently ran through the supported browser
  wrapper. The audit is evidenced by the full bound run, not a diagnostic retry.
- A screenshot of the isolated running app showed the public landing page;
  this is not signed-in screenshot verification. Authenticated browser fixtures
  exercised the upload routes as reported above.

### Remaining findings (no waivers)

`npm audit --audit-level=high` reports three high-severity package findings:
body-parser 2.3.0 / GHSA-27r3-jxmh-p828, Zod 3.25.76 /
GHSA-mrhx-c7xc-m3w5, and its zod-validation-error 3.5.4 dependency chain.
The exact target Multer advisory is absent. Both root and sandbox graph guards
passed; no Multer copy exists in the sandbox graph.

[SELF-CLASSIFIED PRE-EXISTING] security-audit — evidence: the before-change and
after-change lock entries for body-parser, Zod and zod-validation-error are
identical; `dependency-security-remediation.md` already documents these exact
advisories and the before-change failing audit. They remain acceptance blockers,
not ignored baselines. Audit diagnostic retry was unsupported as noted above.

[SELF-CLASSIFIED PRE-EXISTING] mobile-photo-upload generated filename assertion —
evidence: the unchanged test expects the original name while unchanged
`atomicCreatePhoto` generates a display name; the exact conflict and intended
fix are already specified in `photo-assertion-repair.spec.json`. Upload parsing
does not own that registration-generated filename. The isolated retry failed;
classification relies on the existing contract and documented mismatch, not
retry outcome. It remains a failing browser case.

No duplicate follow-up suggestions: existing compressed-request repair, oversized
validation-input repair and photo-assertion repair already cover these next steps.
No audit threshold, baseline, architecture or production policy was changed.

**Task outcome: FAIL / not complete.** The targeted repair and regression guards
are delivered, but required aggregate validation is not passing. Complete the
existing dependency and photo-assertion repairs, then rerun the same bound
`test-heavy`. This final report update follows finished runs; it changes no code
or dependencies measured by those runs.

## Owner-requested retry

Reused revision 1 and the existing identity; `gate:guard` again returned ADMITTED.
The baseline catalog remains empty. Multer still resolves to 2.5.0.

- Run `89832442-8bb2-45e4-9aef-1b2d7d23f81a`: startup checks passed and
  security-audit failed with the same three findings. Overall INCOMPLETE because
  Replit added `exposeLocalhost = true` to the existing port-5001 mapping during
  validation. No application or dependency repair was made in this retry.
- Settled-target run `a2dbaac5-c57c-4837-bc93-cfe9448cd71a`: **FAIL**.
  Startup smoke and boundaries passed; security-audit again failed for
  body-parser, Zod and the zod-validation-error chain. The Multer advisory is
  absent. Later checks were not reached; prior diagnostic results remain
  separately identified above, not substituted for full-tier acceptance.

The visible native task list reports the compressed-request repair merged,
but this fork still resolves body-parser 2.3.0 and Zod 3.25.76. Native merge
status does not prove those dependency fixes are present here. No duplicate
follow-ups are proposed: the existing dependency repair and photo-assertion
work covers the next steps. Completion is being submitted as requested without
skipping validation or claiming a passing heavy tier.

### After synchronization with main

Completion synchronized this task with main. The only ledger conflict was the
append-only tombstone list: preserved the union of main's IDs and this task's ID;
`gate:merge-guard` returned READY. No history was discarded.

The first completion typecheck failed because the installed workspace still
loaded Zod 3.25.76 while the rebased lockfile and sources required Zod 4.6.7.
Synchronized installed dependencies to the merged package files; kept the public
registry URL and integrity unchanged. No source workaround or downgrade was made.

- Rebased full heavy run `4386f342-e8be-4553-a832-fefd1d064150`: **FAIL**.
  Startup smoke, startup boundaries, **security-audit**, and schema-check passed.
  `release-schema-contract` failed in `release-critical migration SQL executes
  against an isolated PostgreSQL target`: reviewed candidate fingerprint
  `ab7c906a008a22f19d2c976cab07f15b57180009ec564e0bc73b007c4d74063c`
  differs from actual
  `a71e8c45bff0a02298b691e89f8968d03a5105afb8259f6e8b8fd0affd22373f`.
  Remaining steps were not reached. No schema-review fingerprint was overwritten.
- Isolated guarded schema retry `f57dde13-71e5-4a57-bddf-caa8869da2d9`:
  one selected case executed and failed. This remains a blocker, not a waiver
  or assertion of pre-existing provenance.
- Rebased upload diagnostic `6e25ede8-3021-4f98-b5f7-7a71012760f0`:
  **17/17 passed**, including clean locked installation and async teardown.
  Diagnostic overall INCOMPLETE is expected and does not replace the full tier.

The earlier body-parser/Zod audit blockers are resolved in the synchronized
graph. Current aggregate blocker is the release-schema contract above.
Review the merged authorization/schema changes against the reviewed transition
pair, then rerun the same bound heavy tier; do not merely replace the fingerprint
to make the test pass.

### Latest-main synchronization requested by owner

Synced main again after the release-schema repair and newer security/
authorization work landed. Preserved incoming bounded-child Multer coverage and
this task's HTTP teardown/clean-install coverage. Ledger task histories and
tombstones were unioned without discarding records; merge guard passed.
The admitted upload task remains revision 1 and bound to unchanged test-heavy.

Root installed packages matched their merged lockfile. The independent sandbox
installation was still stale, including Babel, Vite, picomatch and Zod; ran
`npm ci --prefix artifacts/mockup-sandbox --no-audit --no-fund` to synchronize
that existing lockfile too, without changing package declarations or lockfiles.
This is synchronization to main's reviewed versions, not an unbounded update.

Observed runs:

- `ba71aa25-357c-4c09-8fe6-cdbe970fa01b`: startup failed after the smoke server
  received SIGTERM. A separate automatic heavy workflow was running; stopped
  that duplicate before retrying. This observation alone does not prove why
  the signal arrived.
- `328ee69b-ee57-4f99-b207-63019dc95fb5`: first ten steps passed, including
  audit, release-schema contract and typecheck; unit-tests failed six sandbox
  dependency checks. Guarded tooling diagnostic
  `3e4ac6ce-eb65-4afb-aa97-b37581618486` reproduced those six failures.
- Guarded media diagnostic `e5cc5a50-1929-472b-a8f3-f5b095f4eb9f` passed
  **18/18** merged upload checks.
- After sandbox synchronization,
  `0813a1a6-e0de-411f-ae2b-3282d73c11f8`: **18 steps passed**; browser-tests
  failed with **73 passed, 1 failed, 2 skipped**. Failed case:
  `tests/clerk-sign-in-navigation.spec.ts:53`, signed-out Settings entry returns
  to protected Settings after form sign-in. Upload/avatar/logo/mobile-photo
  browser cases passed, including the previously failing generated-name case.
- Isolated sign-in retry `506904eb-2b9e-44c1-b995-e773283c86a8`: one executed,
  one passed. This establishes intermittency only, not pre-existing provenance.
- Final complete retry `08317fbd-ea28-41e3-ba74-ab561c5689b2`: **FAIL**, with
  all 18 non-browser steps passing and the same browser counts and failed
  Settings sign-in case. No step was omitted to obtain a pass.

Current R1/R2 upload guards pass, R3 upload browser compatibility passes, but R4
full-tier acceptance remains **FAIL** because of the sign-in journey. The audit,
reviewed schema fingerprint and stale package installations no longer block.
Local browser projects remain Chromium and mobile Chromium; two skipped cases
are not reported as executed, and CI-only WebKit was not run here.

No new duplicate suggestions: existing sign-in activation/navigation work and
browser outage recovery already cover the remaining next steps. The latest
landing-page screenshot rendered normally; it does not verify signed-in UI.
Completion is submitted with the current failure disclosed and no waiver.
