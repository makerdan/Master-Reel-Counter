# Failure Gate v4 project-local reinstallation

## Goal and boundary

Replace the active Failure Gate instructions with all four files from
`attached_assets/Failure_Gate_v4_(09.28.2026)_1790645624189.zip`, and apply
their project-local contract to this repository's existing validation tooling.
This is a cooperative project workflow: checked project commands and the local
completion checker reject unsupported task validation, but people with shell
and write access can run commands directly or change local state. Do not
describe it as tamper-proof or as control over Replit's task lifecycle.

No project code or CLI may invoke, request, depend on, or present a result from
platform-managed completion. Remove the current `managed-completion` CLI
operation. Local task completion is only a decision in the project coordinator.

## Canonical source and host adaptation

Install the archive's `README.md`, `SKILL.md`,
`reference/acceptance.md`, and `reference/implementation.md` unchanged at
`.agents/skills/failure-gate-v4/`. Retire
`.agents/skills/failure-gate/` as an active skill, and update current references
in project instructions, publisher/parity tooling, tests, and validation
documentation. Preserve host-specific adaptation, registered commands,
resource locks, tests, baseline catalog, and historical evidence under their
existing tracked locations; do not rewrite historical task records or edit
generated `.local` mirrors. Reconcile the project's capability/acceptance
documents to the new, local-only contract. Do not alter `.replit`, remote CI,
product authentication, or unrelated task work.

The runtime tier registry remains `docs/validation/manifest.json`. Its four
registered tiers, steps, arguments, timeouts, and audit threshold remain
unchanged. Existing direct `npm run test-*` routes remain diagnostic; they
cannot become task completion evidence.

## Local records and plans

The **project coordinator** is the existing project-side SQLite coordinator,
not Replit's task system. It issues stable IDs in a verified project-local
namespace, tracks one active assignment, and transactionally stores task,
plan, authorization, run, audit, and terminal records. IDs are never reused;
a supplied Replit task number is not authority.

For ordinary local tasks, a tracked Markdown plan under
`docs/validation/plans/` names the allocated local ID and contains the
pre-existing-failures section and a `## Validation` section. `**Command:**`
must name exactly one tier from the runtime registry, `**Why:**` states why
that tier covers the change, and `**Do not escalate:**` forbids substitution.
For example, selecting `test-standard` runs its required constituent steps,
not `test-fast`, `test-standard-plus`, or `test-heavy` as extra tiers.
Plans for material changes also include the Regression Guard section with
the named regression test, its location, and its assertion. Both plan guards
run before activation. Planning checks are not completion evidence.

## Approval and tier eligibility

The default activation route is a decision by a **designated project-local
human reviewer**, who need not be the project owner but must not be the task
agent authorizing its own change. Record a real review reference and the
exact local ID, plan version/digest, tier definition, permitted parameters,
and policy/authorization versions. A self-declared actor name, CLI
`approved` flag, or invented reference cannot stand in for a review. This
is a procedural rule with local consistency checks, not identity attestation;
if no valid review is available, activation is blocked.

A previously approved deterministic activation policy can later cover
specific tasks, but none is created or presumed by this migration. Such a
policy must have a separately recorded approval, precise matching conditions,
a fixed tier-selection rule, and versioned decision evidence. An unmatched
or uncertain plan uses the designated reviewer route instead; a task cannot
change the policy to authorize itself.

Store **one authoritative local task ID to tier mapping**. On each activation
or permitted change, append an audit snapshot labeling that ID `ALLOWED` at
the selected tier and `NOT ALLOWED` at every other currently registered tier.
Expose current per-tier status derived from the authoritative record and
registry, never from independently editable allow/deny lists. The checked
runner uses that same mapping. New tiers default to `NOT ALLOWED`.
Suspended or terminal tasks are `NOT ALLOWED` everywhere. A pending change
does not permit the proposed tier: if existing coverage is still adequate
the old tier remains allowed; if coverage is inadequate, suspend validation
until review.

An approved scope/tier amendment updates the plan, authorization version,
one-tier mapping, and audit atomically. A rejected amendment leaves the old
tier unchanged and does not clear unrelated suspension. A test failure or
passing retry never changes authorization. Changed governing policy or tier
definitions require separate review before they can validate the same task.

## Checked execution, failures, and local completion

Route ordinary checked task validation through the existing coordinator,
snapshot/report adapters, registered runner, and resource lock. The checked
entry point takes the local task ID and exact approved plan reference, resolves
the single authorized tier, and rejects missing/stale/substituted IDs or plans,
policy mismatches, forbidden arguments, and unsupported report adapters
before launching a tier. It records run identity, actual snapshot and
environment, raw statuses, complete per-step reports, and named not-reached
steps. A diagnostic run has a distinct purpose and cannot substitute for a
complete run of the authorized tier.

Use the archive's failure ownership order: owned repairs, exact eligible
catalog ignores, exactly three supported isolation retries for unlisted test
failures, verified earlier unaffected evidence plus independent
corroboration, then unresolved potential regression. A passing retry proves
intermittency only. Missing catalog governance prevents promotion, not
ordinary validation. Preserve raw failure results even when a complete run
qualifies as acceptable with an ignored failure.

The project-local terminal checker compares complete evidence for **that
same authorized tier** with the final inputs and authorization, under the
required writer coordination. Incomplete reports, stale snapshots, changed
policy, unknown environment, or unavailable coordination block local
completion. Failed/cancelled task cleanup remains possible without a
passing run. This local decision neither calls nor relies on any
platform-managed completion route.

## Verification and safe cutover

Record a separate, explicit bootstrap authorization for this reinstall using
the prior checked validation route before running its selected tier. An
earlier task's bootstrap approval does not transfer. Do not require an
uninstalled gate to validate itself or mistake bootstrap results for an
ordinary local task run. The proposed bootstrap tier is `test-standard`,
which includes the Failure Gate contract tests and project checks. Do not
sweep all four tiers. Focused tests are diagnostic only and cannot replace
the selected tier's result.

Verify the four installed files against the ZIP, single canonical source,
updated publisher/parity output, plan guards, and a real local-ID checked
command. Regression tests must cover per-tier status and audit, authorized
and rejected tier changes, no self-approval, wrong task/plan, stale digests,
policy edits, incomplete reports, snapshot changes, and local completion.
Check that no project command dispatches platform-managed completion.

During installation, the prior route is available only for the separately
authorized bootstrap operation; ordinary task validation is blocked rather
than governed by two versions at once. After the new route passes its
acceptance checks, remove the prior ordinary-task route in one cutover. If
reviewer designation, writer coordination, or another required capability
is unavailable, leave activation blocked and name the gap. Fixture-only
tests are not evidence of a live cutover. Do not change or retroactively
approve historical tasks.
