# Portable Failure Gate Contract

## What & Why
Refine the repository’s canonical Failure Gate source and portable release contract so unrelated projects can adopt its validation rules without inheriting Bathyscan-specific commands, paths, baselines, or operational assumptions.

## Done looks like
- The reusable skill clearly distinguishes portable requirements from host-project adaptation points.
- Task validation, completion validation, fail-closed tier locks, validation ceilings, evidence-based ownership, intermittency, incomplete runs, audit integrity, and not-reached reporting are explicit and testable.
- Project-specific tier composition, baseline records, memory, and application paths are not presented as universal requirements.
- Contract documentation, enforcement surfaces, and focused tests agree with the revised skill.

## Out of scope
- Workspace-wide skill publication or automatic installation into unrelated projects.
- Editing generated runtime mirrors under `.local/custom_skills/`.
- Changing Bathyscan product behavior or repairing unrelated validation failures.
- Compressing the final prose; that is handled by the dependent Skill Compression task.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** The standard tier covers the Failure Gate contract, package, plan-guard, and validation-runner tests needed for this documentation and enforcement change.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Task-local environment observations
- `docs/validation/failure-baseline.json` contains no baseline records.
- Plan scaffolding through `scripts/new-plan.mjs` was unavailable because Plan mode made workspace files read-only; the required sections were created directly in the task plan instead.

## Regression Guard
**Covers:** Projects adopting the portable Failure Gate contract receive the intended validation semantics without silently inheriting repository-specific assumptions or losing existing safety rules.
**Test location:** `scripts/__tests__/failure-gate.test.mjs`
**What it checks:** Contract and package assertions fail if required portable rules disappear, project adaptation boundaries become ambiguous, or published inputs diverge from canonical tracked sources.

## Steps
1. **Map portable and project-specific rules** — Audit the canonical skill, tier specification, capability checklist, enforcement scripts, and tests; classify each requirement as reusable contract, required host adaptation, or Bathyscan-only implementation detail.
2. **Refine the canonical contract** — Update the tracked Failure Gate and companion validation-tier guidance so portable obligations and adaptation points are explicit while all current safety and failure-ownership guarantees remain intact.
3. **Align enforcement and documentation** — Adjust only the tracked checks, capability map, and supporting guidance needed to make the revised contract executable and internally consistent.
4. **Strengthen contract coverage** — Add focused assertions for task versus completion validation, fail-closed tier locking, retry provenance, incomplete-run classification, audit integrity, not-reached reporting, and separation of portable versus host-specific configuration.
5. **Validate without publishing broadly** — Run focused contract checks and the locked standard tier, recording unrelated failures without weakening thresholds or expanding into product repairs.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `.agents/skills/validation-tiers/SKILL.md`
- `.agents/skills/validation-tiers/tiers.json`
- `docs/validation/failure-gate-capabilities.md`
- `scripts/check-failure-gate.mjs`
- `scripts/run-tier.mjs`
- `scripts/validation-steps.mjs`
- `scripts/__tests__/failure-gate.test.mjs`
