# Photo assertion repair preparation

## Result

**PASS — plan preparation only.** No application workload was run. This is not
a browser-test or `test-heavy` PASS, and does not deliver the test correction.

The supported `npm run gate:new -- --spec
docs/validation/photo-assertion-repair.spec.json` provisioner allocated and sealed:

- ID: `02401352-2967-439c-afc2-0456d418271a`
- Revision: `1`
- Bound tier: `test-heavy` only
- Plan: `.local/tasks/02401352-2967-439c-afc2-0456d418271a.md`
- Plan hash: `f3fd63ec1d4567dcbb763258bc91b57341d60e6988e046032d9e79dec2c42534`
- Canonical skill pin verified against `docs/validation/unified-pin.json`:
  `2025d914d570b364dea2e7b8bd9dda35881a9b60ccaca67d9d904060b37f6c22`

The portable registry preserves the sealed contents and stubs. In a fresh task
environment, use `npm run gate:restore-plan -- --id
02401352-2967-439c-afc2-0456d418271a` if the ignored local files are absent.
Never edit the sealed plan directly or allocate a replacement ID for this work.

## Contract evidence

- `tests/mobile-photo-upload.spec.ts` supplies source filename `handoff.jpg`
  and currently incorrectly expects that same persisted `originalFilename`.
- `server/routes.ts` extracts `.jpg` from the registration's source filename.
- `server/storage.ts` `atomicCreatePhoto` persists
  `S${inserted.sessionId}_P${String(inserted.id).padStart(4, "0")}${ext}`.
- Therefore the exact independent expectation for this fixture is
  `S${session.id}_P${String(registered.id).padStart(4, "0")}.jpg`.
- The direct-upload physical `upload.objectPath` is a distinct identity. Keep
  the registration key and thumbnail URL equal to that returned path.

Do not change production naming to satisfy the test. The source filename,
generated display filename and physical object path serve different purposes.

## Requirement-to-delivery handoff

Classification: pure test correction, self-satisfying Regression Guard.
The declaration and all requirements are sealed into the plan's specification.
The current renderer preserves the explicit Regression Guard section within
the supplied scope; no renderer or policy change was necessary.

| Label | Planned assertion in the mobile handoff case | Preparation evidence | Implementation status |
|---|---|---|---|
| R1 | Exact generated filename derived from created session and returned photo IDs, preserving `.jpg` | Compared route extension handling, atomic registration and failing test expectation; sealed exact formula | Planned, not changed or executed |
| R2 | Same physical path; one photo with matching ID, 37x23 dimensions, aisle B and section 007; empty queue; still one upload and registration after reload | Sealed metadata, persistence and no-duplicate-response requirements | Planned, not changed or executed |
| R3 | Active Photos Reel, one visible card, exact thumbnail URL, successful protected reads and decoded natural dimensions 37x23 before and after reload | Sealed both calls to existing image assertion and required increased successful read count after reload | Previously unreached assertions remain unverified |
| R4 | Complete heavy workload and honest supported mobile coverage | Read authoritative manifest, browser runner, Playwright projects and coverage helper; bound heavy only | No application validation run in preparation |

`docs/validation/failure-baseline.json` was inspected and validated by normal
provisioning and admission: schema version 1, empty records. No ignored or owned
catalog entries were invented. The filename mismatch is owned repair scope,
not a waived failure. Passing retries establish intermittency, not provenance.

## Observed plan checks

1. Provisioning completed with `status: sealed`, revision 1 and no runs.
2. `TASK_ID=02401352-2967-439c-afc2-0456d418271a
   TASK_PLAN_FILE=.local/tasks/02401352-2967-439c-afc2-0456d418271a.md
   npm run gate:guard -- --tier test-heavy` returned `ADMITTED`, revision 1.
3. `npm run gate:merge-guard` returned `READY`.
4. `git diff --check` succeeded.

These are plan checks, not application validation. Application source, tests,
fixtures, workload definitions, baseline catalog, gate code and policy were
left unchanged. The unrelated pre-existing uploaded ZIP was left untouched.

## Execution handoff and remaining gaps

Before implementation, verify the owner's applicable authorization for this
exact sealed revision and repeat the Agent-first guard in its task environment.
The preparation assignment itself did not authorize executing the repair here.
Use the plan's full bound-tier `gate:run` invocation after the narrow test edit.
Do not split the filename correction from its required validation.

The heavy manifest retains all 19 steps and its 900000 ms budget.
`mobile-chromium` is enabled locally; `mobile-webkit` is enabled in CI or by the
existing explicit environment option. A local Chromium-only heavy result is
partial browser-matrix coverage, not proof of iPhone decoding. No browser,
database or provider availability was probed during this preparation.
Do not change the matrix or use filtered results as a full-tier PASS.
Report auth or environment blockers without repairing sign-in in this plan.

No admission blocker remains. Actual filename repair, protected-image decoding,
reload persistence and application validation remain work for the subsequent
implementation task. Separate independent verification: **not selected**.
