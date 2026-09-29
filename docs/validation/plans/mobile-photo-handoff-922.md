# Prove Mobile Flow Photo Handoff

## What & Why
Existing browser coverage exercises Mobile Flow photo queueing, server upload, photo registration, and the session photo API. It does not assert that the normal session interface can retrieve and render the uploaded image in Photos Reel. Add one authenticated, mobile-emulated end-to-end check spanning the capture controls, server-backed upload and registration, and the main application read/display path so this integration has observable proof.

## Task identity
**Task ID:** `master-reel-counter:dbb04932-e28e-463c-837c-8c7a87bcf4fb`
**External task association:** #922; this association does not establish platform task identity or authorization.
**Plan version:** 1
**Authorized tier:** Not yet established; the validation tier below requires an exact independent review decision.

## Done looks like
- A Playwright mobile-device context opens a real session and can enter Mobile Flow, set its capture fields, and use the visible Upload Photo control to select a valid test image.
- The selected image passes through the real client queue, authenticated upload endpoint, and session photo registration endpoint without mocked success responses or seeded photo records.
- The visible and IndexedDB upload queue clear after success, and the server photo list returns the same session-scoped record, including its object key and image dimensions.
- Returning to the normal session interface shows that exact photo in Photos Reel; the browser successfully loads the stored image through the application’s authenticated photo-serving path, and the card/image remain available after reload.
- If the end-to-end check exposes a broken link in this exact journey, retain the failing evidence and report a focused repair need; do not weaken assertions or fake the upload/readback path.

## Out of scope
- Publishing or validating a production deployment, or claiming this local E2E run verifies production credentials or external storage configuration.
- Physical camera hardware and permissions, native iOS/Android applications, or redesigning Mobile Flow.
- Unrelated photo workflows or fixes to unrelated server, storage, or session behavior.
- Replacing real upload, registration, or image-read requests with mocked responses to obtain a passing result.

## Task-local environment observations
- `tests/mobile-photo-upload.spec.ts` already checks queue recovery, real upload and registration requests, server photo metadata, queue clearance, and the mobile tab count.
- That flow does not verify the resulting Photos Reel card or that its protected image URL returns decodable bytes after leaving Mobile Flow; `PhotoStrip` renders images through the application’s `/uploads/:filename` route.
- This plan has not run validation. Treat any observed failure as an unclassified potential regression until its provenance is established.

## Pre-existing failures to ignore
None known at plan time. Treat new failures as potential regressions.

**Flaky-test rule:** A passing retry proves intermittency, not pre-existing provenance.

## Validation
**Command:** `test-heavy`
**Why:** The runtime `test-heavy` manifest includes `browser-tests`, which is absent from `test-standard-plus`. This task must exercise a mobile-emulated browser from user-facing capture controls through authenticated upload, persistent registration, and image retrieval/rendering in the main session UI; unit and static checks cannot establish that cross-layer journey.
**Do not escalate:** Run only `test-heavy` if this exact plan is independently approved and activated for the local task ID. Do not substitute another tier or count an ad-hoc run as checked evidence.

## Regression Guard
**Covers:** The same uploaded session photo must survive the mobile-to-main-interface handoff.
**Test location:** `tests/mobile-photo-upload.spec.ts`
**What it checks:** The end-to-end check asserts that the photo record and loaded image appear in Photos Reel after Mobile Flow upload and remain available after reload.

## Steps
1. **Exercise the mobile capture interface** — Add a focused browser scenario using a phone-sized touch/device profile and an isolated authenticated session. Verify the Mobile Flow controls are visible and usable, fill the aisle/section fields, and select a generated valid image through the visible Upload Photo control.
2. **Verify the server handoff** — Observe the actual upload and registration requests, assert successful responses and the returned object key, then query the session photo API and verify exactly one matching record with the expected image dimensions and metadata. Confirm successful queue cleanup without bypassing the normal queue lifecycle.
3. **Verify main-application readback** — Exit Mobile Flow, open the normal Photos Reel view, and assert the card for the returned photo ID appears and its image loads with non-zero natural dimensions via the application’s normal protected image route. Reload the session and verify the same photo remains available without duplication.
4. **Keep the evidence honest** — Use real E2E server routes and the configured test storage path; avoid stubbing upload, registration, or image retrieval. If any step fails, preserve the failing assertion/result and report the concrete blocker instead of converting the check into a mocked pass.

## Relevant files
- `tests/mobile-photo-upload.spec.ts`
- `tests/fixtures.ts`
- `client/src/pages/session/MobileCaptureView.tsx`
- `client/src/pages/session.tsx`
- `client/src/pages/session/PhotoStrip.tsx`
- `server/routes.ts`
- `playwright.config.ts`