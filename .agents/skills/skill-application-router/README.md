# Skill Application Router — single-skill upload package

## Current revision: Failure Gate Unified

The gate-specific profile and command now target canonical Failure Gate Unified.
Ordinary governed work uses exactly one adequate bound tier; gate installation,
update and repair use Unified's owner-directed maintenance exception rather than
self-admission or a mandatory separate reviewer. No platform final-writer race
is imposed. Other Router orchestration remains as supplied in this attachment.

This is a targeted revision of the attached October 4 package, not a merge of
every later Router change. Packaging does not repair any project's admission code.

Upload this ZIP as one workspace skill. Its root `SKILL.md` is the only skill
entry point; retain the bundled `references/` files. There is no enclosing
folder and no second `SKILL.md` inside the archive.

## Layout

```text
SKILL.md
README.md
CHANGELOG.md
references/
  installation-verification-plan.md
  handoff-binding-and-recovery.md
  delivery-reconciliation.md
  router-task-handoff-acceptance.md
  custom-skill-commands.md
  custom-skill-command-manifest.json
```

The root skill handles application wording and Invoke/Install/Apply/Audit
routing. Independent verification planning is now an internal reference
module, loaded during Install/Apply or an explicit verification
request. It does not require a separately installed
`skill-install-verification-plan` skill.

Normal Install/Apply routing either writes and finalizes a new primary task
or verifies an existing primary surfaced by Replit Agent. It reads the real
committed plan and matching identity/scope, then creates a separate verification
task with a dependency on the primary task. Both tasks may be pending together,
but substantive verification requires actual delivered inputs, not just a
platform dependency label. The bundled binding/recovery protocol requires
release-semantic discovery and explicit readiness/resume checks. Missing
task-creation or dependency capabilities are reported as blocked, never as
successful task creation.
An existing task does not need a new create response or replacement task.
Its finalized authoritative record is the equivalent evidence; a title/card,
status, or uncommitted proposal is insufficient. Repeated surfacing reuses the
same persisted Project/target/primary ID/primary-plan digest/scope key and checks
for an already-linked verifier. Source digests remain evidence, not changing
keys when a planned skill file first becomes available.

The protocol also requires full persisted-plan comparison, lifecycle-aware
reuse, complete immutable specification/reference baselines, uncertain-write
recovery, normalized key representations, and primary-revision checks at
linkage and execution. Cancelled, failed, blocked, or stale verifiers do not
satisfy required follow-ups merely because a record exists.

Verification now has two phases: the pending dependent task pins authorized
obligations and explicitly defers unresolved methods; after delivery it checks
readiness, independently discovers actual wiring, classifies differences,
resolves methods through the permitted route, and then verifies. Obligation,
pre-install Project, and delivered implementation baselines are distinct.
Expected implementation changes do not automatically count as contract drift.
New primary plans include a tracked installer handoff; its claims are checked
independently and cannot authorize weaker acceptance criteria.

Method-only resolution/correction preserves the task key when primary plan and
semantic scope stay unchanged, while revised executable instructions require
authorized handling, revision records, and readback. Material changes require
renewed binding and linked history; missing amendment routes block affected
execution rather than silently changing tasks. The D-series acceptance cases
cover this workflow; their presence is not evidence of live host execution.

See `CHANGELOG.md` for the scope of this package update.

The verification module preserves source/runtime, project implementation,
and platform lifecycle as separate evidence tracks, along with read-only
boundaries, safety approvals, requirement-by-requirement evidence, and honest
blocked reporting. A created verification task is not a passing verification.

## Source and installation boundary

Canonical files in this conversation live at
`.agents/skills/skill-application-router/`. For project-local installation,
use that supported canonical location and preserve relative references.
Do not promote a runtime mirror to canonical authority.
An authorized first installation may use its original specification/package
before the destination exists; Invoke/Apply/Audit still require canonical
target sources. Install the whole authorized resource package, not SKILL.md
alone. Resolve applicable required companions canonically and preserve
report-only operation boundaries.

Most bundled command-catalog manifest entries retain historical uploaded
fingerprints. The Unified entry alone records the canonical `.agents` source
used for this revision, explicitly identified by `canonicalOverrides`; it is
not proof of any destination project's current parity. The recorded runtime
source for other entries is provenance only, not permission to read mirrors.
Always resolve the current target contract under `.agents`; do not refresh
unavailable target definitions from the historical catalog.

Packaging the skill does not install it into workspace settings, implement a
host task API, create a project verification task, or change platform lifecycle
behavior. Those actions require the actual selected project's verified
capabilities and applicable authorization.