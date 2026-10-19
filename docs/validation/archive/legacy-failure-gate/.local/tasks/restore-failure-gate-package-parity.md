# Restore Failure Gate Parity

## What & Why
Regenerate the tracked downloadable Failure Gate package from canonical skill sources so its validation-tier registry matches the repository contract. The current parity check fails because the archive’s `tiers.json` differs from `.agents/skills/validation-tiers/tiers.json`.

## Done looks like
- The downloadable Failure Gate archive contains the current canonical validation tiers
- Failure Gate package parity and focused package tests pass from a clean checkout
- Regeneration remains deterministic and changes only package content derived from canonical tracked sources

## Out of scope
- Changing validation-tier definitions or Failure Gate behavior
- Editing generated runtime skill mirrors
- Relaxing archive parity checks

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
- `npm run check-failure-gate-parity` failed during discovery with `published tiers.json differs from its canonical source`.
- `docs/validation/failure-baseline.json` has no active records.

## Validation
**Command:** `test-standard`
**Why:** This tier includes the Failure Gate package parity and focused contract coverage needed for a tracked package regeneration.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** A downloadable Failure Gate package cannot drift from the canonical tier registry while repository validation appears healthy.
**Test location:** `scripts/__tests__/failure-gate.test.mjs`
**What it checks:** Package regeneration uses canonical inputs and parity fails for any archive tier-registry difference.

## Steps
1. **Confirm the exact package drift** — Compare the archive manifest and tier registry with canonical tracked sources, and stop if differences extend beyond generated package content.
2. **Regenerate from canonical sources** — Run the repository publisher to update the tracked archive without editing canonical tiers or generated runtime mirrors.
3. **Verify deterministic parity** — Run focused parity and package tests, confirm a second regeneration produces no additional diff, and classify any unrelated failure under the empty baseline.

## Relevant files
- `.agents/skills/validation-tiers/tiers.json`
- `artifacts/bathyscan/public/failure-gate-skill.zip`
- `scripts/publish-failure-gate.mjs`
- `scripts/check-failure-gate-parity.mjs`
- `scripts/__tests__/failure-gate.test.mjs`
- `package.json:39-43`
