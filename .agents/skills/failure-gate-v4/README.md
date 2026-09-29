# Failure Gate v4

An operational skill and implementation contract for project-local, ID-based
validation-tier workflows across project types, including Replit projects. It is language-,
framework-, operating-system-, storage-, and provider-neutral.

## Package contents

- `SKILL.md`: core operating instructions; read this first.
- `reference/implementation.md`: registry, approvals, execution, storage, and lifecycle contract.
- `reference/acceptance.md`: host implementation test matrix and paired skill confirmation.

The package contains instructions and specifications, not an executable registry
or runner. No existing project's enforcement has been changed by authoring it.

## Adopt safely

For Replit and other `.agents`-compatible hosts, place this directory at
`.agents/skills/failure-gate-v4/`. On other hosts use the supported canonical skill
location and map its interfaces explicitly. Do not edit disposable mirrors or save
deliverables beneath `.local/`.

When adopting v4 in an existing project, explicitly migrate the old Failure Gate
contract and its invocation/session guidance. Do not leave old and new versions
simultaneously governing the same task. Merely adding this directory does not
disable an existing workspace skill or implement the host controls.

Begin with the core skill's capability discovery. Implement missing host tooling
only under a separately authorized installation task. Use the acceptance matrix
to verify it before claiming checked project-local task-ID locks.

Example paths, tier names, task formats, and commands are not prerequisites.
The adapter can use existing local plans and task records, any appropriate runtime
and transactional storage, and the project's real checks. No backend, package
manager, Git repository, CI provider, or named companion skill is assumed.
Dropping in the skill makes its instructions available; it does not automatically
build or activate the project-specific enforcement adapters.

The scope is a cooperative project-local workflow: one local task ID, one
authorized tier, checked execution, recorded approvals, and a local completion
checker. An agent with write/shell access can bypass or alter local tooling.
This package does not restrict arbitrary commands, authenticate local records
against deliberate tampering, or control Replit Agent's Task Board transitions.
It does not supply human review or baseline catalog-governance services. Missing
required local approval blocks the affected change, not ordinary unrelated work.
Do not modify platform-owned dispatch or introduce an unlocked fallback in an
attempt to claim otherwise.

## Authoring verification

This package received a document-level review for the project-local scope,
frontmatter structure, version consistency, Markdown fences, reference links,
example JSON, and core length. Failed runs do not automatically terminate tasks,
expired ignores cannot erase owned repairs, and local acceptance coordinates
with edits.

No host repository, baseline catalog, validation tiers, or enforcement implementation
was available for runtime verification. Runtime installation and all executable
acceptance tests therefore remain unperformed. The document test matrix is not
a test-results report.