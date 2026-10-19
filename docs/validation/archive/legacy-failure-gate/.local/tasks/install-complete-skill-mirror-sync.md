# Complete Skill Mirror Sync

## What & Why
Install Skill Mirror Sync as a canonical, tracked project capability rather than relying on its disposable workspace mirror. Deliver the full attached contract—source authority, secure projection, validated loading, read-only mirror parity, diagnostics, recovery, and growth-safe tooling—without copying private account content into the repository or letting repository automation mutate platform-owned mirrors.

## Done looks like
- A canonical `.agents/skills/skill-mirror-sync/SKILL.md` preserves every authority boundary, fail-closed rule, status outcome, ownership rule, and prohibited shortcut in the attached specification.
- Project commands can refresh, validate, audit, and safely load one or many account-managed skills using only an explicit `ACCOUNT_SKILLS_SOURCE`, with deterministic recursive SHA-256 manifests and exact opaque revision matching.
- Refreshes use serialized ownership-aware locking, safe abandoned-lock recovery, owned staging/backup cleanup, complete staging validation, source-change detection, guarded atomic installation, rollback, and post-install validation.
- A read-only status command checks canonical account metadata against a platform-owned mirror sidecar and returns the documented `pass`, `mismatch`, `unavailable-source`, and `missing-mirror` exit codes without exposing private values or changing any source, projection, or mirror.
- Focused automated tests verify success plus malformed sources/manifests, invalid slugs and entries, symlink/special-file rejection, missing/extra/changed bytes, live and abandoned locks, interrupted refresh cleanup, races, source changes, failed installs with rollback, stale projection refusal, redaction, multi-skill growth, and all status exit codes.
- Tracked configuration and operator documentation explain setup, invocation, audit/repair boundaries, environment ownership, diagnostics, future skill growth, and why `.local/custom_skills` must never be edited or promoted.
- A tracked capability checklist enumerates every documented core, optional, advanced, recovery, reporting, and prohibited-shortcut requirement and marks each `implemented`, `verified`, or `unsupported`, with test/command evidence or a concrete platform-boundary explanation; no item is silently omitted or deferred.
- Existing workspace-authored skills remain untouched, generated files stay confined to `.agents/skills/.account-projections/`, private account instructions are not persisted in tracked outputs, and platform mirror sidecars are never synthesized.

## Out of scope
- Creating or changing the external account/platform skill source or its revision publication process.
- Provisioning, repairing, or writing the platform-owned `.local/custom_skills` runtime mirror or metadata sidecar.
- Declaring mirror parity when authoritative account metadata or platform metadata is unavailable.
- Installing unrelated validation, CI, or runtime-hygiene systems beyond integrating this capability with the project’s resulting validation contract.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `npm run ci`
**Why:** The complete installation changes tracked Node tooling, package commands, skill guidance, and CI-covered contracts, so the project’s registered comprehensive command must exercise type safety, focused contract tests, and existing regression checks together.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Steps
1. **Reconcile the post–Port Authority baseline** — After the active runtime-hygiene task merges, inspect the resulting package commands, validation tiers, locking utilities, and session guidance; preserve those contracts and reuse compatible primitives instead of introducing competing lock or runner behavior.
2. **Install the canonical skill contract** — Add the tracked canonical skill from the attached specification with explicit triggers, authority boundaries, source/fingerprint rules, safe refresh/loading behavior, read-only status semantics, bounded reporting, repair ownership, and prohibited shortcuts.
3. **Build secure source and manifest primitives** — Implement explicit source resolution, opaque revision validation, deterministic immediate-skill discovery, recursive regular-file enumeration, slug and entry checks, stable SHA-256 fingerprinting, manifest generation, and exact projection validation for arbitrary future skill counts and support-file trees.
4. **Build transactional projection and loading commands** — Provide supported refresh, validation, audit, and load surfaces with ownership-aware serialization, race-safe abandoned-lock recovery, narrowly owned cleanup, validated staging, source-change detection, guarded rename/backup/rollback, final cleanup, and fail-closed post-install loading.
5. **Build read-only mirror status and diagnostics** — Add the documented per-skill status command and bounded machine-readable/human-readable outcomes, exact metadata comparison, stable exit codes, redaction, and ownership guidance without writing the source, projection, mirror, or platform sidecar.
6. **Integrate configuration and project commands** — Register discoverable package commands and tracked non-secret configuration/documentation that make the explicit environment requirement clear, coexist with the project’s validation/runtime tooling, and support single-skill, multi-skill, audit, invocation, recovery, and CI-safe validation use cases.
7. **Add adversarial contract tests** — Test every normal and failure path with isolated temporary fixtures, including malformed and changing sources, unsafe filesystem entries, recursive parity, stale data, lock ownership and races, interrupted operations, rollback, redaction, status codes, and preservation of workspace-authored skills.
8. **Publish the capability checklist** — Produce a tracked checklist mapping every attached requirement to implementation and verification evidence; mark genuinely platform-controlled capabilities unsupported only when repository code cannot safely provide them, and explain the boundary and expected owner.
9. **Run scoped and project validation** — Exercise all focused commands against synthetic sources, verify status remains non-mutating, confirm no private fixture data or generated projection is tracked, and run the plan-locked project validation command without exceeding its ceiling.

## Relevant files
- `package.json`
- `replit.md`
- `.gitignore`
- `skills-lock.json`
- `scripts/ci.sh`
- `scripts/serial-lock.mjs`
- `.agents/skills/brainstorming/SKILL.md`
- `.local/custom_skills/skill-mirror-sync/SKILL.md`
