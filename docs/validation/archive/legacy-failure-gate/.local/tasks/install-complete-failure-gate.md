# Install Complete Failure Gate

## What & Why
Install the attached Failure Gate specification as a canonical, tracked, project-adapted validation contract. The project currently has only a generated workspace mirror and lacks the tracked skill, baseline catalog, tier registry, enforcement scripts, tests, documentation, and published package needed to make failure ownership explicit at plan and execution time.

## Done looks like
- A canonical `.agents/skills/failure-gate/SKILL.md` exists and preserves every core, optional, advanced, maintenance, archive, ad-hoc, and fail-closed behavior documented by the attached specification.
- Light, standard, and heavy registered validation tiers run project-appropriate npm, backend, Playwright, and CI checks without bypassing the existing serial-lock and port-safety controls.
- Plan creation, plan linting, regression linting, task-plan tier locking, locked-tier execution, baseline lookup, exact signature matching, scoped stub repair, archive inspection, and explicit ad-hoc no-plan operation are executable and covered by automated tests.
- A durable baseline catalog and lifecycle guide support active, expired, resolved, intermittent, environment-limited, unknown, and needs-review records, ownership declarations, review deadlines, stale-verification warnings, and fail-closed reference resolution.
- Project guidance and package commands document plan-time discovery, execute-time evidence classification, task-versus-completion validation, maintenance reporting, catalog promotion boundaries, and safe extension for future suites and tiers.
- A tracked distributable snapshot is generated from the canonical skill source and automated parity verification prevents the published package or generated runtime mirror contract from silently diverging.
- A tracked capability checklist enumerates every behavior in the attached specification and marks each implemented and verified, or unsupported with a concrete technical explanation; no capability is silently omitted or deferred.
- Automated verification exercises success paths and malformed, missing, mismatched, stale, expired, intermittent, unauthorized-ignore, tier-escalation, archive, maintenance, and compatibility failure paths.

## Out of scope
- Repairing unrelated product or test failures discovered while establishing the baseline.
- Changing application features, UI behavior, API contracts, database schema, or production deployment behavior.
- Editing generated `.local/custom_skills/` mirrors or treating `.local/tasks/` archive repairs as tracked deliverables.
- Adding or replacing a remote CI provider.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-heavy`
**Why:** This installs the validation contract itself across planning, tier execution, catalog maintenance, package commands, and existing test infrastructure, so the complete registered tier is required.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Steps
1. **Inventory and baseline the validation surface** — Capture the current behavior of package checks, backend tests, Playwright tests, CI sequencing, serial locking, startup smoke checks, and documented test prerequisites. Record only authoritative exact failures in the initial catalog and preserve environment limitations as non-referenceable observations.
2. **Install the canonical skill contract** — Add the tracked Failure Gate skill from the attached specification, retaining all plan-time, execute-time, evidence, maintenance, archive, completion-validation, and ad-hoc rules while translating examples to this project’s package manager and test topology.
3. **Define extensible validation tiers** — Create a declarative light/standard/heavy registry and execution pipeline that composes existing checks, supports future suites without hardcoded branching, honors serial execution for heavy work, and clearly distinguishes test failures from typecheck failures and harness limitations.
4. **Build plan creation and lint enforcement** — Add safe plan scaffolding plus strict Failure Gate and Regression Guard checks for required sections, real tier names, filled rationale, ownership declarations, catalog eligibility, exact baseline resolution, scoped stub repair, and explicit archive mode.
5. **Enforce task-plan tier locking** — Implement fail-closed plan parsing, requested-tier matching, ceiling enforcement, locked-tier execution, and the explicit ad-hoc-only no-plan escape hatch. Ensure missing, unreadable, malformed, unregistered, or mismatched plans stop before validation begins.
6. **Implement baseline lifecycle tooling** — Add the catalog format, schema validation, exact suite/test/signature matching, statuses, dates, owners, review deadlines, promotion requirements, warning-window maintenance reports, and documented exit codes without allowing stale or non-active records to authorize ignores.
7. **Integrate project commands and guidance** — Wire package commands and collaborator guidance to the canonical contract, preserving current CI, Port Authority, and test authentication constraints while documenting plan-time discovery, execution classification, completion validation, and future extension points.
8. **Add comprehensive contract verification** — Create isolated fixtures and automated tests for all successful and fail-closed paths, including retry interpretation, two-factor provenance rules, owned versus ignored records, catalog mismatches, stale records, archive boundaries, maintenance findings, serial heavy execution, and task/completion validation separation.
9. **Publish and verify the distributable** — Generate a tracked installable snapshot from canonical sources, test installation or inspection in an isolated fixture, and add parity checks so canonical source, documentation, scripts, tests, and the published asset remain synchronized.
10. **Produce the capability checklist** — Map every documented sentence-level capability to its implementation and verification evidence, mark unsupported items only when technically impossible with a specific reason, and fail the task if any capability is missing, vague, or merely deferred.

## Relevant files
- `.local/custom_skills/failure-gate/SKILL.md`
- `.local/custom_skills/regression-guard/SKILL.md`
- `package.json`
- `replit.md`
- `docs/testing.md`
- `scripts/ci.sh`
- `scripts/serial-lock.mjs`
- `scripts/ci-collision-test.mjs`
- `scripts/free-ports.mjs`
- `scripts/startup-smoke.sh`
- `playwright.config.ts`
- `tests/global-setup.ts`
- `server/__tests__/routes.test.ts`
- `.agents/memory/MEMORY.md`
