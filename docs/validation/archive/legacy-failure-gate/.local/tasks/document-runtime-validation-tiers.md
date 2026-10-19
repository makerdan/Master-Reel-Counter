# Document Runtime Validation Tiers

## What & Why
Update the Failure Gate tier guidance so planners can choose validation based on the checks the runtime manifest actually runs. Current published summaries underdescribe `test-standard` and can make appropriate tier selection unclear.

## Done looks like
- Tier guidance accurately describes the runtime checks, distinguishing runtime manifest coverage from the packaged host registry where they differ.
- A focused contract check catches stale or misleading tier descriptions.
- Changes to packaged Failure Gate sources are reflected in the published snapshot when required.

## Out of scope
- Changing the runtime validation tier composition, priorities, timeouts, or audit thresholds.
- Removing validation checks or reducing coverage.

## Steps
1. **Compare canonical tier definitions** — Reconcile the validation manifest, packaged registry, and tier guidance; identify differences that must remain intentional versus stale prose.
2. **Correct tier guidance** — Document the actual runtime coverage and clarify which source controls execution without changing tier behavior.
3. **Guard the description contract** — Add or update a focused contract test that detects the known tier-description mismatch and preserves the distinction between runtime and packaged tier definitions.
4. **Verify the published contract** — Regenerate the published Failure Gate package if its canonical source changed, then verify parity.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
None recorded.

## Validation
**Command:** `test-standard`
**Why:** This tier includes the Failure Gate contract and parity checks needed to verify the updated guidance and published snapshot.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**N/A**
**Why N/A:** This changes tier descriptions only; it does not change validation execution, plan acceptance, or other existing behavior.

## Relevant files
- `.agents/skills/validation-tiers/SKILL.md`
- `.agents/skills/validation-tiers/tiers.json`
- `docs/validation/manifest.json`
- `scripts/__tests__/failure-gate.test.mjs`
- `artifacts/bathyscan/public/failure-gate-skill.zip`
