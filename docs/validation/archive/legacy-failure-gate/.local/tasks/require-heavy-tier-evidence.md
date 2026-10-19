# Require Evidence for Heavy Tiers

## What & Why
Require every plan selecting `test-heavy` to explain which heavy-only validation coverage the task needs. A specific coverage reason supports appropriate tier selection; generic requests for confidence do not explain why lighter registered tiers are insufficient.

## Done looks like
- `test-heavy` plans name at least one validation step present in the runtime heavy tier but absent from `test-standard-plus` and explain why that coverage applies.
- The plan guard rejects generic or missing heavy-tier rationales while continuing to accept concrete heavy-only coverage reasons.
- Other registered tiers continue to require a meaningful explanation without being subject to the heavy-only rule.

## Out of scope
- Changing tier step composition, commands, timeouts, priorities, or audit thresholds.
- Prohibiting `test-heavy` when its broader coverage is relevant.
- Changing platform-managed completion validation.

## Steps
1. **Define heavy-only coverage** — Derive the validation step names exclusive to `test-heavy` from the canonical runtime manifest, comparing it with `test-standard-plus` rather than duplicating tier membership in a second source.
2. **Enforce a concrete plan rationale** — Extend the Failure Gate plan guard so a `test-heavy` plan must identify a relevant heavy-only step in its `Why` explanation; preserve existing checks for all other plans.
3. **Add focused regression cases** — Verify vague heavy-tier rationales fail, specific heavy-only coverage reasons pass, and non-heavy plans remain unaffected.
4. **Update and verify guidance** — Document the rationale requirement in canonical Failure Gate instructions and repository guidance, then run the registered contract and parity checks.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Task-local environment observations
None recorded.

## Validation
**Command:** `test-standard`
**Why:** This tier runs the Failure Gate plan-guard contract tests and parity checks needed to verify the new rationale rule without running browser, startup, audit, and collision suites.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** A plan selects `test-heavy` with only a generic rationale such as “full confidence,” without naming a heavy-only validation step.
**Test location:** `scripts/__tests__/failure-gate.test.mjs`
**What it checks:** The plan guard rejects the generic rationale, accepts a rationale naming applicable heavy-only coverage, and leaves valid plans for other tiers unchanged.

## Relevant files
- `scripts/check-failure-gate.mjs`
- `scripts/lib/tiers.mjs`
- `docs/validation/manifest.json`
- `scripts/__tests__/failure-gate.test.mjs`
- `.agents/skills/failure-gate/SKILL.md`
- `replit.md`
