# Confirm Complete Failure Gate

## What & Why
Independently confirm that the installed canonical Failure Gate skill file faithfully implements the attached specification. List every gap before patching the skill file so the installation cannot be accepted with omitted, vague, contradictory, or deferred capabilities.

## Done looks like
- A canonical `.agents/skills/failure-gate/SKILL.md` exists and preserves every core, optional, advanced, maintenance, archive, ad-hoc, and fail-closed behavior documented by the attached specification.
- Light, standard, and heavy registered validation tiers run project-appropriate npm, backend, Playwright, and CI checks without bypassing the existing serial-lock and port-safety controls.
- Plan creation, plan linting, regression linting, task-plan tier locking, locked-tier execution, baseline lookup, exact signature matching, scoped stub repair, archive inspection, and explicit ad-hoc no-plan operation are executable and covered by automated tests.
- A durable baseline catalog and lifecycle guide support active, expired, resolved, intermittent, environment-limited, unknown, and needs-review records, ownership declarations, review deadlines, stale-verification warnings, and fail-closed reference resolution.
- Project guidance and package commands document plan-time discovery, execute-time evidence classification, task-versus-completion validation, maintenance reporting, catalog promotion boundaries, and safe extension for future suites and tiers.
- A tracked distributable snapshot is generated from the canonical skill source and automated parity verification prevents the published package or generated runtime mirror contract from silently diverging.
- A tracked capability checklist enumerates every behavior in the attached specification and marks each implemented and verified, or unsupported with a concrete technical explanation; no capability is silently omitted or deferred.
- Automated verification exercises success paths and malformed, missing, mismatched, stale, expired, intermittent, unauthorized-ignore, tier-escalation, archive, maintenance, and compatibility failure paths.
- No section is vague, self-referential, or deferred to future work.
- A future Planner reading the skill file cold could follow it without ambiguity.

## Out of scope
- Changing validation scripts, catalogs, documentation, package commands, tests, application code, adjacent skills, or published assets.
- Expanding Failure Gate beyond the attached specification.
- Revalidating product behavior unrelated to the installed skill-file contract.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** Confirmation is restricted to the canonical skill file, and the standard registered tier is sufficient to run skill-contract and plan-guard checks without repeating the installation task’s complete heavy validation.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Must NOT do
- Make any changes outside `.agents/skills/failure-gate/SKILL.md`.
- Refactor or modify adjacent skills.
- Add speculative content beyond what the original specification called for.
- Expand scope to include feature-code changes inspired by the skill’s topic.
- Silently fix gaps without first listing them.
- Rewrite more than half the skill file; if that threshold would be crossed, stop, document findings in a comment block at the top of the file, and surface a new replacement task.

## Steps
1. **Read the shipped skill cold** — Inspect the canonical installed skill and compare it with the attached workspace specification and the installation task’s falsifiable outcomes.
2. **Enumerate gaps before editing** — Produce an explicit gap list covering omissions, contradictions, ambiguous instructions, deferred behavior, broken references, and incomplete optional or advanced modes before making any patch.
3. **Patch only the skill file** — Correct the listed gaps within the canonical skill file without touching implementation scripts, tests, adjacent skills, documentation, configuration, or artifacts.
4. **Check completeness and usability** — Confirm every installation outcome is represented unambiguously, every referenced mode has actionable instructions, and a future Planner or build agent can follow the contract without outside assumptions.
5. **Respect the rewrite threshold** — If correction would replace more than half the file, stop and record the findings at its top rather than turning confirmation into an unplanned rewrite.
6. **Run the locked confirmation ceiling** — Execute the standard registered tier with this task plan locked and report the skill-file comparison, patches, unsupported items, and validation result.

## Relevant files
- `.local/custom_skills/failure-gate/SKILL.md`
- `.local/custom_skills/skill-install-confirmation/SKILL.md`
- `.local/tasks/install-complete-failure-gate.md`
- `.agents/memory/MEMORY.md`
