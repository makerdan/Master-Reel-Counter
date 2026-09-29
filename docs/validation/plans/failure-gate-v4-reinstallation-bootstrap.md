# Failure Gate v4 reinstallation bootstrap

## Task identity
**Task ID:** `bootstrap:failure-gate-v4-reinstallation` (provisional installation reference, not an allocated ordinary local task ID or authorization).

## Purpose and authority

Implement the approved design in
`docs/superpowers/specs/2026-09-28-failure-gate-v4-local-reinstallation-design.md`.
This is a bounded installation of project-local tooling, not authority over
Replit task completion. Obtain an explicit decision for this bootstrap plan
and selected validation tier before using the prior checked bootstrap route.
The historical bootstrap approval for another task does not transfer here.
Do not treat this plan file or its provisional reference alone as approval.

## Pre-existing failures to ignore
None authorized. Preserve any pre-edit observations with raw status and
investigate new failures as potential regressions.

**Flaky-test rule:** A passing retry proves intermittency, not pre-existing provenance.

## Task-local environment observations
The existing v4 coordinator and checked execution are candidate code, not
an active ordinary-task authority. The prior checked launcher uses a plan
path. The runtime registry has four tiers. The publisher, parity checker,
tests, and current instructions still refer to the older skill source.
The package ZIP has exactly four files under the new canonical path.

## Validation
**Command:** `test-standard`
**Why:** The registered `failure-gate-contract` and `failure-gate-parity` steps exercise the changed gate and package contract; `typecheck`, unit tests, storage checks, and manifest parity cover its project integration.
**Do not escalate:** Run only this selected bootstrap tier through the checked route after explicit bootstrap authorization; do not sweep `test-fast`, `test-standard-plus`, or `test-heavy`. Focused diagnostic tests do not replace this result.

## Regression Guard
**Covers:** A wrong local ID or plan launching a tier, a task being allowed at more than one tier, a tier amendment leaving stale permissions, an unauthorized policy change, incomplete evidence reaching local completion, and an accidental platform-managed completion operation.
**Test location:** `scripts/__tests__/failure-gate-v4-coordinator.test.mjs`, `scripts/__tests__/failure-gate-v4-execution.test.mjs`, and `scripts/__tests__/failure-gate.test.mjs`.
**What it checks:** Positive one-tier activation and local completion, an audited ALLOWED/NOT ALLOWED status for every registered tier, atomic status changes, negative ID/plan/policy/report cases before command launch, and absence of a callable managed-completion operation.

## Implementation sequence

1. Check the archive entry list and bytes, current source paths, registered
   tier definitions, current repository status, and available baseline
   evidence. Run the two plan guards as planning checks.
2. Install all four ZIP files verbatim at
   `.agents/skills/failure-gate-v4/`; retire the old active skill source.
   Update publisher, parity checker, package contract tests, `replit.md`,
   and current host adaptation/acceptance docs. Leave historical records,
   generated `.local` mirrors, `.replit`, runtime tier definitions, CI, and
   unrelated app behavior untouched.
3. Connect the existing local SQLite coordinator to a project-local
   reviewer-decision/plan adapter and checked runner. Store one authoritative
   task-to-tier mapping, append an audited per-tier status at activation
   and amendment, and expose a status report derived from that mapping.
   Missing review or a mismatched plan blocks activation. No deterministic
   rule is activated as part of this installation.
4. Route ordinary project-local checked validation to the selected tier,
   retaining the existing resource, snapshot, report, and failure-ownership
   contracts. Remove legacy ordinary-task fallback and the
   `managed-completion` CLI operation. Use the local checker for terminal
   state; never dispatch or rely on platform completion.
5. Add negative and positive regression tests for approval, tier status,
   amendments, task/plan substitution, policy changes, reports, snapshot
   integrity, and local completion. Regenerate the published Failure Gate
   archive, verify its exact four-file parity, run focused checks as
   diagnostics, and run only the authorized `test-standard` bootstrap tier.
   Confirm the application workflow still starts after the change.

## Cutover and stopping rule

During installation, ordinary task validation remains fail-closed; the
previous route is only for the separately approved bootstrap operation.
Do not mark v4 live because files were copied or fixture tests passed.
Before announcing a local cutover, verify an actual local-ID checked
run and terminal decision with a valid project-local reviewer route and
writer coordination. If either is unavailable, leave ordinary activation
blocked and report the missing capability and unexecuted checks explicitly.
No previous task is retroactively authorized.