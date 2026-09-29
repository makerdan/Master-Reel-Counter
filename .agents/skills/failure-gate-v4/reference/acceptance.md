# Failure Gate v4 — acceptance and confirmation

These are required executable test cases for a host implementation. This document
is not evidence that the implementation or tests already exist.

## Before changing a host

Record existing commands, observed failures, and unavailable checks. Use the approved
bootstrap validation contract during initial installation; do not require the
uninstalled gate to validate itself. Preserve canonical local and CI coverage.
Do not trigger or modify remote CI without appropriate authorization.

Material implementation changes require regression protection describing the bug
or contract risk, the proving check, and post-change verification. Use the host's
existing format; no named companion skill is mandatory. Do not fix unrelated
baseline failures. Record raw failures and ownership separately.

## Required host tests

| Area | Prove |
|---|---|
| Portability | No example path, Node command, package manager, OS, framework, database, tier name, or companion skill is required implicitly. |
| Project adapters | Verify actual local mappings for task/plan, execution, storage, evidence, recorded approvals, and local completion. Do not claim Agent platform task identity. |
| Missing optional features | Absent memory/history/catalog does not block otherwise valid execution or create invented ignore authority. |
| Missing governance | No human review or catalog-maintenance service is assumed; absent required local approval blocks the change, and absent catalog governance blocks promotion. |
| No existing tiers/tests | Installation registers only approved real checks; manual-only evidence is labeled honestly and missing required checks remain blocked. |
| Safe discovery/retries | Pre-edit observations and repeated checks respect host-specific side effects, hardware, production, and external-service authorization. |
| Allocation | Concurrent local reservations are unique; committed IDs survive restart and are never reused after cancellation or deletion attempts. |
| Namespace | Independent workspaces do not claim shared sequential allocation; mismatched local project identities are denied. |
| Bootstrap | Draft plan guards and registered baseline discovery work before activation; neither route can launch arbitrary tiers or satisfy completion. |
| Activation | Only valid plans with recorded approval or approved activation-policy decisions activate. |
| Tier lock | Correct tier runs; lighter/heavier/unknown tiers, missing IDs, wrong plans, escaping paths, and stale digests fail before command launch. |
| Defaults | A task has exactly one authoritative tier; no redundant deny-list migration is required when another tier is added. |
| Overrides | Arguments, environment, config, package-script routes, and diagnostic selectors cannot reduce accepted required coverage. |
| Boundary | Checked local execution and completion reject unsupported records; tests do not claim to prevent shell runs, local edits, or Replit Agent task completion. |
| Task substitution | Another valid local task ID and plan cannot validate or complete this local task; no claim of independent Agent platform identity. |
| Result checks | Missing or inconsistent run records, manually supplied `PASS` labels, and copied run IDs fail local checker consistency checks; no forgery-resistance claim. |
| Policy edit | Changed tier registry, wrapper, runner, or checker requires separate approval in the checked workflow; deliberate local tampering remains possible. |
| Completion | A project-local task is not marked complete by the checked workflow without its local decision; platform task routes remain outside this claim. |
| Ad-hoc route | An ad-hoc run, even with passing output, cannot be attached as required-tier evidence by the local checker. |
| Approvals | A caller-written actor/approved flag is not enough for the checked workflow; recorded local approval is not authenticated identity. |
| Transitions | Approval updates plan/tier/authorization versions and audit atomically; stale/double approvals and a second pending request are rejected. |
| Rejection | Rejecting a change preserves the old tier and cannot clear independent suspension. |
| Crash safety | Simulated failure before/during commit or plan projection leaves no runnable partial state; audit failure rolls back mutation. |
| Races | Launch versus tier move, amendment, cancellation, and release cannot execute against inconsistent versions. |
| Snapshots | Ordinary in-scope edits permit a new run but invalidate prior relevant results; dirty/untracked/generated/dependency inputs are represented. |
| Output exclusions | Writing approved logs/reports does not itself invalidate evidence; modifying executable inputs does. |
| Isolation | Concurrent code edits and uncoordinated worktrees cannot yield accepted snapshot evidence. |
| Provenance | A “pre-task” run contaminated by task changes or mismatched relevant environment is rejected. |
| Retries | Three distinct permitted retries are bounded; a passing retry proves only intermittency; crashes/skips/zero-test results are not passes. |
| Alternate diagnostics | Unsupported isolation blocks classification unless an approved equivalent diagnostic policy is present. |
| Independence | Memory plus untouched files without direct provenance fails; duplicate references to one observation count once. |
| Matching | Different assertions, variants, environments, signatures, ambiguous matches, and unknown matching rules cannot inherit an ignore. |
| Lifecycle | Expired, revoked, non-active, or newly broadened baselines cannot waive a task failure without approved policy. |
| Ownership | An owned repair cannot be discharged by reclassification, expiry, skipped/deleted/renamed tests, or unapproved plan amendments. |
| Completeness | Ignored failures followed by missing required steps, reports, discovery, or runner crashes remain incomplete/unacceptable. |
| Results | Raw nonzero statuses are preserved under acceptable-with-ignored-failures; diagnostic results cannot stand in for full-tier runs. |
| Evidence acceptance | Unknown/stale snapshots, invalidated plans, and missing required external checks prevent local success. |
| Capability boundary | Missing required external checks remain blocked; a local check cannot impersonate an unavailable service. |
| Local dispatch | The checked project entry point resolves one authorized tier from the supplied local task and plan; it does not sweep all tiers. |
| Plan identity | Missing, stale, malformed, wrong-local-task, or unresolvable plans are rejected; no newest-plan/default-plan inference occurs. |
| Recovery | Poll timeout does not launch a duplicate; orphan reconciliation requires confirmed stop or documented quarantine. |
| Terminal states | Completion requires acceptance; failed/cancelled cleanup remains possible after safe run handling; released IDs cannot run or reopen. |
| Security | Checked entry points reject shell injection and path escape; logs exclude secrets and report reads are bounded. No identity-attestation claim. |
| Migration | Legacy tasks retain honest provenance; canonical sources and approved generated outputs agree; competing authorities are not active together. |

## Paired skill confirmation

When creating project tasks to install this skill definition, create a dependent
confirmation task scoped to `SKILL.md`, after the authoring task. Its acceptance
items must match the authoring task's items, including:

- Valid frontmatter names `failure-gate-v4`; title and identifiers consistently use v4.
- Core skill remains below 500 lines with resolvable local reference links.
- One authoritative task-to-tier mapping replaces redundant live allow/deny lists.
- Planning authorization avoids a pre-activation guard deadlock.
- Task authorization and run snapshots are distinct.
- Project-local workflow limitations are explicit, without a protected-mode claim.
- The local completion checker is implemented and does not pretend to control the platform task lifecycle.
- Local validation uses the supplied local task and plan to run one authorized tier.
- A project-level launcher test is not represented as proof of Replit Agent platform routing.
- Another valid local task plan cannot be substituted for the local task being checked.
- Local result consistency checks are not described as forgery resistance.
- Paths, commands, formats, runtimes, tier names, and companion skills are host-adapted rather than mandatory examples.
- Essential ownership, provenance, and fail-closed rules remain in the core skill.
- No section is vague, self-referential, or deferred to future work.
- A future Planner reading the skill file cold could follow it without ambiguity.

List gaps before patching. Do not use skill confirmation as permission to implement
project feature code, alter unrelated skills, or repair the broader repository.
If correcting the skill requires rewriting more than half, surface a replacement
task instead of silently expanding scope. Review companion documents separately.

## Reporting

Report actual checks run, raw outcomes, known baseline failures, and project-local
workflow limitations. A document-format review is not runtime
verification, and installed instructions are not an installed validation system.