# Image dependency security delivery

## Scope, authorization and outcome

Assigned work: repair sharp and multer advisories without changing the photo
contract or upload architecture. Governing Unified plan:
`9f6ba563-0544-401f-8c22-74e8ba1e26bc`, sealed revision 1, pinned skill
`2025d914d570b364dea2e7b8bd9dda35881a9b60ccaca67d9d904060b37f6c22`.
The supported provisioner generated the identity and complete plan; Agent-first
`gate:guard -- --tier test-heavy` returned **ADMITTED before implementation**.
The active assignment authorized this dependency-only scope and its tests.
Classification: material security and compatibility; normal Regression Guard.
Separate independent verification: **not selected**.

**Implementation delivered; validation outcome: FAIL, not full-tier PASS.**
The targeted installed versions and advisories are removed. The required
`test-heavy` run stopped at the remaining dependency audit. A subsequent browser
diagnostic failed one pre-upload mobile navigation assertion. No baseline,
exclusion, skip flag, tier change or audit waiver was introduced.

## Architecture and compatibility decisions

- Retain authenticated HTTP multipart, multer memory storage, the configured
  **50 MiB** file limit and JPEG/PNG/WebP MIME allowlist. No disk staging,
  resumability, manifest, protocol or persistence migration was added.
- `server/lib/imageUpload.ts` exposes the existing parser policy so isolated
  fixtures use the production middleware with a small configurable byte limit.
  `server/routes.ts` calls its unchanged production default. Authorization,
  route handlers, object-storage/local fallback, registration and saved-name
  generation remain unchanged.
- sharp is now **0.35.5**, multer **2.4.0**. Required sharp native packages and
  libvips packages are updated; multer no longer needs concat-stream and its
  two obsolete dependencies. Other dependency chains were not upgraded.
- Package metadata and lockfile agree. Lockfile tarball URLs retain portable
  public npm locations and integrity hashes; installation used the configured
  package service without disabling its checks.
- Multer 2.4.0 accepts a file exactly at `fileSize` and rejects larger files.
  Tests explicitly exercise just below, exactly at, and above the configured
  limit. The application still configures 50 MiB; no lower compensating limit
  or changed public error mapping was introduced.
- Direct upload intentionally stores allowed-MIME bytes without sharp decoding.
  Corrupt-image rejection before persistence is tested at the avatar-style
  decoding boundary, not falsely attributed to direct upload.

## Requirement-to-delivery map

| Requirement / recurrence | Delivered guard and assertion | Evidence and limits |
|---|---|---|
| Reintroducing affected installed versions | `server/__tests__/dependency-media-security.test.ts`: resolve relative to the route consumer; inspect every lockfile copy and installed metadata; require sharp >=0.35.5 within compatible 0.35, multer >=2.4.0 within major 2; package/lock constraints agree. | Passed in the unit workload and disposable clean install. Negative controls reject version strings 0.35.4 and 2.3.0 without installing vulnerable packages; prereleases are rejected. |
| Native startup / image compatibility | Same test: actual native sharp/libvips load; JPEG/PNG/WebP dimensions, rotation, decodable JPEG crops, thumbnails, avatar-size conversion; EXIF auto-rotation and orientation stripping; tiny trusted SVG decoding used only as a native fixture. | All assertions passed. Production does not permit SVG MIME uploads. SVG exploitation through a permitted production input has not been demonstrated. |
| Valid multipart inputs preserve metadata | Same test: production parser accepts all three formats, preserving exact original name, MIME and byte count before fixture persistence. | Passed for JPEG/PNG/WebP. Real-browser avatar, logo, direct upload, registration and retry cases also passed, with existing assertions unchanged. |
| Malformed / unexpected multipart input cannot persist | Bounded loopback HTTP requests use the production parser and API error handler. Malformed/truncated payload, missing boundary and unexpected field produce errors without reaching the route callback or fixture row/blob writes. | Passed. Disposable in-memory sinks only; no application database or user bucket is used by these fixtures. Generic malformed parser errors preserve the existing sanitized error mapping, rather than inventing a new status contract. |
| Disallowed MIME / byte-limit rejection | SVG, GIF and arbitrary MIME yield route-owned rejection; over-limit requests return 413, never reach persistence, and invoke memory-file cleanup. Valid PNGs padded just below and at the fixture limit succeed. | Passed. Production default is asserted as memory storage and exactly 50 MiB. No 50 MiB live allocation is needed. |
| Aborted upload does not hang or persist | Wait until the memory engine actually receives a file stream, abort the client, observe server-side file-stream closure under a two-second deadline, assert no route callback / row / blob, and prove the server still responds. | Passed. This is the actual memory path, not a claim that this app had the advisory's diskStorage orphan-write defect. |
| Corrupt allowed image cannot persist after decoding fails | Corrupt bytes make `cropPhoto` reject; the avatar-equivalent rotate/resize/JPEG pipeline fails before fixture row/blob writes. | Passed. The production parser is shared; conversion fixtures mirror the avatar pipeline. They do not replace the passing real-browser avatar integration check. |
| Exact existing saved names, dimensions and protected reload | Existing `tests/photo-upload.spec.ts` and `tests/mobile-photo-upload.spec.ts` were not edited. Browser queue conversion retains the exact existing originalFilename/dimension assertions; all six oriented-image cases passed. | **Partial evidence only:** the phone handoff case failed before image creation/file selection. Its later `handoff.jpg`, protected decoded-image and reload assertions were **not reached**. The separate mobile handoff repair and naming-coverage work were not duplicated or overwritten. |

The new 14-case guard is included in `npm run test:unit`. No production
image-processing, filename, authorization or protected-serving code was changed.

## Observed execution — 2026-10-21

Run identities, target content hashes, output hashes, bounded excerpts and exact
outcomes are retained in `docs/validation/unified-registry.json`. Raw reports
under `generated-artifacts/media-security/` and `test-results/` are ignored,
environment-local supporting evidence, not portable artifacts.

| Execution | Observed result |
|---|---|
| Disposable clean `npm ci --no-audit --no-fund` | **PASS**: fresh temporary directory, package metadata/lockfile plus only the new test and required local modules; lifecycle scripts enabled, 180-second outer deadline, 796 packages installed in 12 seconds. All 14 image/upload tests passed, zero skipped/cancelled. Temporary installation removed. |
| Audit before / clean-install audit after | Both exit **1**. Before: **15** findings (10 high, 5 moderate). After: **13** (9 high, 4 moderate), zero critical. Only sharp and multer disappeared; all remaining advisory sets match the captured pre-change audit, with no added finding. |
| Full bound `test-heavy`, run `71432403-a88f-4b9b-b080-02948b9ce43b` | **FAIL**: startup-smoke passed; startup-smoke-boundaries process passed (13 cases passed, one CI-only case skipped); security-audit exited 1 with the 13 remaining findings. |
| Supervised unit diagnostic, run `b57e61bb-2f00-471e-af24-88ba9c09127a` | Step **PASS**, exit 0: **184 tests passed**, zero failed/skipped/cancelled, about 8.3 seconds. Diagnostic overall **INCOMPLETE**, not full-tier PASS. |
| Supervised browser diagnostic, run `00748711-7489-4fff-a313-a611bcaae3ff` | **FAIL**, exit 1: **69 passed, 1 failed**, zero skipped/flaky, about 5.7 minutes. Isolated test database, Chromium and mobile Chromium; local WebKit coverage was not selected by the existing host policy. |
| Supported diagnostics | No language-server errors in the changed route, helper or new test, nor in the final all-files diagnostic snapshot. `git diff --check` passed. Gate merge preservation guard returned READY. |
| Development preview | Managed Start application workflow restarted and served port 5000. Public landing page screenshot was healthy. The capture browser is anonymous; that screenshot is not signed-in UI verification. Existing Clerk development-key, anonymous 401 and PostCSS warnings remain. |

### Failures and unexecuted checks

Remaining audited packages: `@tailwindcss/typography`, `brace-expansion`,
`braces`, `chokidar`, `fast-glob`, `http-proxy-middleware`, `micromatch`,
`postcss-nested`, `postcss-selector-parser`, `source-map-js`, `tailwindcss`,
`tailwindcss-animate`, `vite`. Their identical pre-change advisory sets support
the recorded pre-existing classification; this does not waive the failed audit.
The related downstream dependency remediation owns the fresh all-green run.

The mobile failure is
`tests/mobile-photo-upload.spec.ts:235`, mobile-chromium:
`enterMobileFlow` could not find `header-mobile-flow` at line 231, called at
line 260 **before** selecting, uploading or decoding an image. The page snapshot
shows Photos Reel. The helper and client capture-mode initialization/toggle are
untouched by this dependency task. A supported classification records that
contextual pre-existing assessment, not a baseline or a passing test.

The supported diagnostic route selects an entire registered test step, not an
individual Playwright case or audit subfinding. No isolated-case retry is claimed;
no unguarded filter or alternate tier was used. Mobile handoff/reload remains
unverified and requires its separately assigned repair.

After the audit, the full tier did not reach schema-check,
release-schema-contract, workspace-skill-contract, typecheck, storage-lint,
port-reference-scan, storage-lint-contract, unit-tests, vite-hmr-tests,
vite-hmr-recovery-tests, serial-lock-tests, port-authority-tests, manifest-parity,
nested-tier-regression, collision-smoke or browser-tests. Separate unit/browser
diagnostics do not change the full run's failure or certify the unexecuted steps.
Full compiler validation remains unobserved in the bound run; language-server
diagnostics are narrower evidence, not a substitute for that step.

The valid baseline catalog remains empty. No independent reviewer task or
duplicate follow-up was created: downstream dependency work and the existing
mobile handoff/naming tasks already own the remaining next steps. Nothing was
deployed.
