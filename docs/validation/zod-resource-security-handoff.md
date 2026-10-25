# Zod constrained-collection security repair

## Admission and scope

- Assigned task: 1007.
- Admitted identity: `2b06284f-d4e4-46a0-a304-63af64ee980c`, revision 1.
- Plan hash: `dde9221d4183f1b0da997593a0a0c3338ae53a3a917261f9cee9b363653325d3`.
- Failure Gate pin: `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Regression Guard pin: `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- Normal/material security and compatibility repair. Guard passed before implementation.
- Exactly one bound tier: `test-heavy`, 900000 ms, `docs/validation/manifest.json`.
- Baseline catalog schema 1 contained zero records. No ignored failures or audit waivers.
- Independent verification not selected. No deployment or production-data changes.

The draft's referenced multi-reel delivery and local Security scan 1004 archive
were unavailable in this checkout. Current graphs and the existing
`dependency-security-remediation.md` were inspected instead; the latter explicitly
leaves Zod outside its completed remediation. No claim is made to have read
the unavailable scan.

## Upstream and implementation

GitHub's reviewed advisory API for GHSA-mrhx-c7xc-m3w5 reports the affected range
as below 4.6.6, first fixed 4.6.6 (observed 2026-10-25).
Both graphs now use Zod 4.6.7. Root adapters are drizzle-zod 0.8.3,
@hookform/resolvers 5.9.2 and zod-validation-error 5.0.0. Sandbox uses the same
resolver version. Consumer-relative resolution includes OpenAI.
zod-validation-error is the advisory's dependency chain, not a separate defect.

The migration updates Zod's removed `errors` alias to `issues` and the enum
error customization to the v4 API. Entry PATCH accepts the database's nullable
text fields and string conductors; malformed entry POST validation now returns
safe field errors with HTTP 400 instead of reaching the generic 500 path.
Database defaults and schema nullability remain intact.

New tarball URLs were normalized to public HTTPS npm URLs while retaining
package integrity hashes. Both full lockfiles were installed in disposable
directories with `npm ci --ignore-scripts --no-audit --no-fund`; actual adapter
resolutions were checked there. Existing workspace build tests exercise the
installed tooling separately; clean-install checks do not claim lifecycle-script
execution in the disposable copies.

## Requirement-to-delivery map

| Label | Requirement | Delivery and evidence | Disposition |
|---|---|---|---|
| R1 | Fixed root/sandbox graphs and compatible adapters | `scripts/__tests__/dependency-tooling-security.test.mjs`: version floors for all locked/installed Zod copies; consumer-relative adapters; negative checks for 3.25.76 and 4.6.5; public HTTPS lockfiles; both disposable locked installs | Passed in unit diagnostic |
| R2 | Bounded rejection without changing ordinary collections | Same test: each installed graph parses an ordinary array, then rejects one million invalid items against max(10), exactly one `too_big` issue, in a child capped at 64 MB heap, 10 seconds and 16 KB output | Passed in unit diagnostic |
| R3 | API, schema, forms and AI compatibility | `server/__tests__/routes.test.ts`: real create/edit, nullable fields, string conductors, default reelCount, malformed POST/PATCH 400; existing provider and schema suites. `tests/entry-footage.spec.ts`: authenticated API roundtrip and rendered expanded row. Existing root/sandbox builds and compiler gates | Passed in diagnostics; full browser suite not reached by heavy tier |
| R4 | Full heavy validation without waivers | Supported bound invocation below | FAIL: separate body-parser and Multer audit findings block remaining steps |

## Observed runs

All evidence is associated with revision 1 in `docs/validation/unified-registry.json`.
Diagnostic runs are not full-tier acceptance.

- `19768651-b5ea-4cde-be89-13bd80f26c06`: full heavy run, startup checks passed,
  security-audit failed with two high findings; later steps not reached.
- Initial unit diagnostics found a test harness mistake (Buffer stdout used as
  text) and nonportable newly installed tarball URLs. Both were repaired, not
  classified as pre-existing.
- `82f0c2c0-a37e-4a04-a7bc-bcc4778fff9c`: all 264 unit tests passed, including
  clean installs and root/sandbox builds. Overall INCOMPLETE is the expected
  diagnostic-only disposition.
- `4f3953c7-ab4e-4d9b-a644-d9aa081b7f77`: browser API assertions succeeded but
  row assertion failed because the aisle group was collapsed. The test now
  dismisses onboarding and expands the group.
- `64dabec3-51ee-45b7-b9ed-e11139d627a6`: browser diagnostic succeeded (one
  Chromium test), including the compiler gate. This does not certify the full
  browser matrix or other tests.

Final rerun records, including target fingerprints, are appended by the gate
after this handoff is saved. Use its run history for the latest terminal result.

```
TASK_ID=2b06284f-d4e4-46a0-a304-63af64ee980c \
TASK_PLAN_FILE=.local/tasks/2b06284f-d4e4-46a0-a304-63af64ee980c.md \
npm run gate:run -- --tier test-heavy
```

## Remaining failures and next step

### Synced-main retry

The completion sync brought in the separate remediations and preserved the
complete durable gate histories and tombstones. A fresh locked installation
now resolves Express 5.3.0, body-parser 2.4.0, Multer 2.5.0, and Zod 4.6.7.
The prior audit failures below describe the older task checkout, not these
synced dependencies. Revision 1 still passes its admission guard. Full heavy
validation is being repeated against the combined tree; its terminal record
in the gate history supersedes the earlier acceptance failures if it passes.

Synced run `48008241-47d1-4793-a3e8-9dbbf0383e98` passed all 18 non-browser
steps, including security-audit, clean-install dependency guards and typechecks.
Browser results: 74 passed, 2 skipped, one Settings form-sign-in session-activation
timeout. Run `2426c693-7a78-4d30-95e5-90a172dafd51` retried that browser file
through the guarded route; both tests passed. This establishes intermittency,
not pre-existing provenance, and does not replace a full-tier PASS. No
authentication behavior or timeout was changed. A full-tier retry follows;
consult the latest terminal run for acceptance. Local coverage includes Chromium
and mobile Chromium; WebKit remains CI-only per the configured workload.

Final synced retry `d0a4108e-68c1-49ff-9c1e-cf93536accf8` again passed every
non-browser step and returned 74 browser passes, 2 skips and the same Settings
form-sign-in failure. Therefore the full bound tier remains FAIL, despite the
isolated sign-in retry passing. The Zod and dependency advisory guards pass;
body-parser and Multer no longer block validation. No authentication fix,
baseline exception, timeout extension or audit waiver was introduced.
The remaining browser failure is not classified as pre-existing. Investigating
the form's session activation under the full suite is the concrete next step;
existing browser-auth recovery work already covers this area, so no duplicate
follow-ups are proposed.

Retry on 2026-10-25: admitted revision 1 passed `gate:guard`; full bound run
`34723180-1643-47f8-9e34-80ab5b6b72af` ended FAIL at `security-audit` after
both startup steps passed. Installed versions remain body-parser 2.3.0 and
Multer 2.4.0; Zod remains 4.6.7. Later heavy steps were not reached. The retry
does not establish full acceptance or waive the remaining findings.

- body-parser: GHSA-27r3-jxmh-p828, high.
- Multer: GHSA-q7qp-rjg7-q26m, high.

These are not waived and are not folded into this Zod migration. The assigned
draft already identifies separate remediation work; compressed-request work is
also active as task 1005. No duplicate follow-up is proposed. Clear those
findings through their authorized remediation, then rerun the full bound tier.
This task is not accepted as PASS while that required check fails.
