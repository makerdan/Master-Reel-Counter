# Review And Package Candidate

## What & Why
After the compressed candidate is explicitly approved, apply that exact candidate, review it for any remaining clarity, fulfillment, loophole, and edge-case gaps, and publish verified downloadable Failure Gate archives for manual installation in other projects.

## Done looks like
- Work stops unless the user has explicitly approved the named candidate produced by the dependency task.
- The canonical source still matches the candidate’s recorded baseline before application; otherwise a new preview is required.
- Any added clarification is supported by the approved contract and does not silently expand scope, weaken safeguards, or alter protected metadata.
- The tracked portable ZIP contains the approved canonical skill and companion tier files with deterministic contents.
- Package inspection, parity, focused contract tests, and a second deterministic publication pass succeed.
- The final ZIP file or files are surfaced to the user as direct downloads, with manual distribution and host-adaptation requirements stated.

## Out of scope
- Applying an unapproved or stale candidate.
- Editing `.local/custom_skills/` or treating a runtime mirror as authoritative.
- Publishing to a workspace-wide registry or installing the skill into unrelated projects.
- Changing project tier composition unless separately justified and approved by the portable-contract work.
- Fixing unrelated product, dependency, or validation failures.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** The standard tier covers source/package parity, deterministic publishing, and focused Failure Gate contract checks for the approved text and release archive.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** The downloadable Failure Gate release exactly represents the approved canonical contract and cannot omit required rules, include stale content, or pass parity with altered package entries.
**Test location:** `scripts/__tests__/failure-gate.test.mjs`
**What it checks:** Publication uses canonical tracked inputs, archive entries match them exactly, required contract anchors and edge-case rules remain present, and repeated publication is deterministic.

## Steps
1. **Enforce approval and baseline gates** — Verify explicit approval identifies the exact compression candidate and confirm the canonical source still matches its recorded baseline; stop and regenerate the preview on any mismatch.
2. **Apply the approved candidate** — Write only the approved instructional-text scope to the canonical Failure Gate source while preserving protected metadata and unrelated resources.
3. **Close evidenced clarity gaps** — Review the applied text for missing fulfillment conditions, ambiguous precedence, loopholes, unavailable-input behavior, incomplete validation, audit ownership, adaptation boundaries, and other edge cases; make only changes supported by the approved invariant ledger, documenting any material departure for renewed approval.
4. **Publish deterministic archives** — Regenerate the tracked portable release from canonical sources using isolated, safe staging and ensure archive names and contents are suitable for manual installation.
5. **Verify release integrity** — Inspect archive entries, run focused contract and parity checks plus the locked standard tier, then publish a second time and require no content drift.
6. **Deliver direct downloads** — Surface the verified final ZIP file or files to the user with concise installation scope, version/candidate identity, and the host-project adaptations still required.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `.agents/skills/validation-tiers/SKILL.md`
- `.agents/skills/validation-tiers/tiers.json`
- `docs/validation/failure-gate-capabilities.md`
- `scripts/publish-failure-gate.mjs`
- `scripts/check-failure-gate-parity.mjs`
- `scripts/__tests__/failure-gate.test.mjs`
- `artifacts/bathyscan/public/failure-gate-skill.zip`
