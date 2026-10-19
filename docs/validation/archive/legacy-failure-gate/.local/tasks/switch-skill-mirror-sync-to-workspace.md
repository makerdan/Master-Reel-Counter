# Workspace Skill Mirror Sync

## What & Why
Replace the current account-managed Skill Mirror Sync installation with the selected workspace-managed authority model. The repository should consistently implement the one-way workspace source → generated project projection → disposable runtime mirror contract across its canonical instructions, helper, commands, tests, documentation, ignore rules, and validation registration.

## Done looks like
- Skill Mirror Sync uses only an explicit `WORKSPACE_SKILLS_SOURCE`, opaque `.workspace-revision`, and `.agents/skills/.workspace-projections/`; account-managed names and paths are no longer part of this integration.
- Refresh, validate, audit, load, and status commands preserve deterministic recursive SHA-256 manifests, fail-closed source/projection validation, ownership-aware locking, safe interrupted-refresh cleanup, guarded installation with rollback, and post-install validation.
- Runtime mirror parity remains read-only and checks the platform-owned `.workspace-skill-metadata.json` sidecar with the documented pass, mismatch, unavailable-source, and missing-mirror outcomes.
- Package commands, canonical skill instructions, operator guidance, capability checklist, ignore rules, and validation registration all describe and invoke the workspace-managed implementation consistently.
- Focused tests cover the complete workspace contract, including malformed inputs, unsafe files, stale or partial projections, source changes, lock races and recovery, rollback, redaction, future skill growth, and every status outcome.
- No repository code writes, reconstructs, reverse-promotes, or treats `.local/custom_skills` as authoritative.

## Out of scope
- Supporting the account-managed and workspace-managed authority models simultaneously.
- Publishing or repairing the authoritative workspace source.
- Mutating or synthesizing the platform-owned runtime mirror or its metadata sidecar.
- Changes to the application product or Mockup Sandbox artifact.

## Pre-existing failures to ignore
None known at plan time. The focused account-skill contract baseline passed all 11 tests before planning; treat every later failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-heavy`
**Why:** This is the lightest registered tier that executes the Skill Mirror Sync contract suite and also verifies manifest registration, repository checks, and integration compatibility.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** The workspace-managed authority, projection-integrity, lock/recovery, rollback, fail-closed loading, redaction, and read-only runtime-mirror contracts after replacing the account-managed integration.
**Test location:** `scripts/workspace-skill-sync.test.mjs`
**What it checks:** Exercises successful and adversarial workspace source flows and fails if account identifiers remain active, stale or mixed projections load, unsafe files pass, concurrent refresh ownership breaks, rollback loses the prior projection, private values leak, or status mutates platform-owned state or returns incorrect outcomes.

## Steps
1. **Replace the authority vocabulary and filesystem contract** — Migrate the projection helper from account-managed names to the workspace-managed source, revision, manifest, lock, staging, backup, projection, and metadata contracts while preserving all existing safety and fail-closed behavior. Remove the obsolete account entry point rather than retaining a second authority mode.
2. **Re-integrate commands and validation** — Replace account-specific package commands and validation registration with discoverable workspace-skill refresh, validate, audit, load, status, and focused-test commands, ensuring every registered command resolves to the migrated implementation.
3. **Rebuild complete contract coverage** — Migrate and expand the focused suite under workspace terminology so it verifies recursive deterministic projections, malformed and unsafe sources, exact byte parity, stale-projection refusal, source-change detection, serialized refreshes, abandoned-lock recovery, interrupted cleanup, atomic rollback, multi-skill growth, bounded output, and all mirror-status exit codes.
4. **Align every tracked instruction surface** — Update the canonical Skill Mirror Sync skill, operator guide, capability checklist, project guidance, and ignore rules to describe only the workspace-managed flow, including ownership boundaries and prohibited shortcuts. Remove stale account-managed instructions without copying private workspace content or runtime-mirror files into tracked sources.
5. **Verify migration completeness** — Run focused searches for retired account identifiers, execute the migrated contract test directly, then run the locked `test-heavy` tier and classify any failures under Failure Gate without weakening the contract or escalating validation.

## Relevant files
- `.agents/skills/skill-mirror-sync/SKILL.md`
- `scripts/account-skill.mjs`
- `scripts/account-skill-sync.test.mjs`
- `package.json`
- `docs/skill-mirror-sync.md`
- `docs/skill-mirror-sync-capability-checklist.md`
- `docs/validation/manifest.json`
- `replit.md`
- `.gitignore`
