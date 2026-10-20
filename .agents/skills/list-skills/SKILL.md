---
name: List Skills
title: List Skills
description: >-
  Inventory runtime-visible private/custom skills, determine which are
  project-installed or workspace-integrated, and separately check for
  project implementation evidence. Use when someone asks which custom skills
  are applied, available, implemented, or when they ask for a broader Agent
  skill catalog.
---

# List Skills

Produce a read-only, auditable Markdown report about private/custom skills
visible to the current Agent runtime and their application to the current
project. Keep skill application and project implementation as separate
dimensions. When requested, also summarize platform-provided and secondary
runtime skills in a separate section.

This skill inventories and inspects; it never installs, invokes, repairs,
copies, refreshes, synchronizes, or modifies skills, project files, runtime
state, generated outputs, or caches.

## Choose the report scope

- **Focused report:** When the user names one or more skills, report only those
  candidates and their application and implementation evidence. Treat names
  and display titles as search clues; preserve the exact directory ID when
  reporting and use exact IDs for application matching.
- **Full comparison:** When the user asks for a full inventory, all available
  custom skills, or a comparison of applied and unapplied skills, report every
  runtime-visible private/custom candidate in the two-column comparison.
- **Applied summary:** When the user asks only which skills are applied, report
  the applied entries and the count of available-but-not-applied candidates.
  Do not list every unapplied candidate unless they requested the full
  comparison.
- **Other local skills:** Include platform-provided and secondary runtime
  skills only when the user asks for all skills available to the Agent, or
  explicitly requests those catalogs. Keep them separate from private/custom
  application results.

If scope is unclear, prefer the full private/custom comparison. Do not turn the
report into a runtime inventory command, dashboard, API, or project UI.

## Definitions and independent dimensions

The runtime-visible private/custom candidate set is the immediate directory
entries under `.local/custom_skills/`. A candidate's exact, case-sensitive
immediate directory name is its skill ID. Do not substitute `.local/skills/`,
`.local/secondary_skills/`, another catalog, a mirror, or a generated listing
for this candidate set.

Application is determined only by exact ID comparison:

| Candidate match | Application classification |
|---|---|
| Direct project entry | `Project-Installed` |
| Projection entry | `Workspace-integrated` |
| Both direct and projection entries | Applied, with a duplicate application finding |
| No confirmed project entry | `Available, Not Applied`, unless required scope is unknown |

Implementation evidence is a separate dimension. Inspect project-owned source,
scripts, configuration, documentation, tests, and workflow wiring for behavior
corresponding to a candidate's stated purpose. Similar behavior without an
exact applied-skill match is implementation evidence, not application.
Implementation evidence must never promote, demote, or otherwise change
application classification.

Use these implementation-status values exactly:

- `Applied and implemented`
- `Applied, implementation not evidenced`
- `Not applied, implementation evidenced`
- `Not applied and implementation not evidenced`
- `Implementation status unknown`

Use `Partial implementation` when only part of the relevant skill contract is
evidenced. Use `Complete` only when sufficient project-owned evidence supports
the relevant behavior. Use `Not evidenced` when the inspected scope found no
corresponding evidence. Use `Unknown` when required scope could not be
inspected read-only. Do not infer implementation from the skill definition, a
filename alone, or a documentation claim alone.

## Read-only boundaries

- Do not install, execute, repair, copy, refresh, synchronize, or modify a
  skill, project file, runtime state, projection, mirror, manifest, metadata,
  lockfile, cache, or generated output.
- Do not follow symlinks, recurse into unrelated locations, inspect nested
  repositories, execute discovered skills or imported source, or run
  validation to manufacture evidence.
- Do not edit `.local/custom_skills/`. It is a runtime identity catalog, not
  an authoritative source for skill contents or provenance.
- Read only the minimum frontmatter needed to identify purpose and render
  labels. Do not reproduce skill bodies, private workspace instructions,
  secrets, credentials, environment values, or canonical workspace paths.
- If evidence is unavailable without mutation, report `Unknown` and explain
  the specific bounded limit.

## Bounded discovery

Perform only these read-only inspections:

1. Confirm the project root by checking expected relative roots from the
   current working directory, without printing or reporting an
   absolute/canonical workspace path. Use a safe project label such as the
   repository directory name or `Current project`; never derive the label from
   a secret or expose the canonical path.
2. Enumerate immediate directories under `.local/custom_skills/`.
3. For each candidate, inspect only enough of its `SKILL.md` frontmatter to
   identify its purpose. Parse the bounded frontmatter between the first `---`
   delimiter and the next `---` delimiter. The candidate is valid only when
   `SKILL.md` is a regular, readable, non-symlinked file, the frontmatter
   parses, and it has a non-empty `name` and `description`; otherwise record a
   malformed/invalid finding without reading the skill body.
4. Enumerate immediate directories under `.agents/skills/`, excluding the
   literal `.workspace-projections` entry.
5. Enumerate immediate directories under
   `.agents/skills/.workspace-projections/` separately.
6. For project entries, require a regular, readable, non-symlinked
   `SKILL.md`; use the immediate directory name as the project skill ID. A
   project entry is valid only when its bounded frontmatter parses and has a
   non-empty `name` and `description`; otherwise preserve it as an invalid
   project-entry finding.
7. Compare IDs byte-for-byte and case-sensitively. Do not normalize case,
   punctuation, separators, aliases, display names, or hyphens.
8. Inspect project-owned implementation scope read-only. The reproducible
   boundary is root-level regular files named `package.json`,
   `pnpm-workspace.yaml`, `tsconfig.json`, `vite.config.js`,
   `vite.config.ts`, `vite.config.mjs`, `vite.config.cjs`, `.replit`,
   `replit.md`, `artifact.toml`, or whose names match `*.config.js`,
   `*.config.ts`, `*.config.mjs`, `*.config.cjs`, `*.json`, `*.yaml`,
   `*.yml`, or `*.toml`, plus regular, non-symlinked files at depth 3 or
   less beneath these project-owned roots when they exist: `src/`, `client/`,
   `server/`, `scripts/`, `tests/`, `test/`, `docs/`, and
   `.github/workflows/`. Enumerate each directory and file in bytewise
   relative-path order, and apply a separate limit of 200 entries per
   allowlisted root (including its root-level file set) and 1 MiB per file.
   Record any omitted entries. A directory or file that cannot be read makes
   that subtree `Unknown`; it is not evidence of absence.
9. If the user requested the **Other Local Skills** catalog, enumerate
   immediate regular, readable, non-symlinked `SKILL.md` files under
   `.local/skills/` and `.local/secondary_skills/`, excluding
   `.local/custom_skills/`. Read only bounded `name`, optional `title`, and
   `description` frontmatter. These are local runtime skills, not evidence of
   private/custom project application.

Do not silently drop entries. Record unreadable roots, malformed entries,
omitted scope, duplicate identities, or identity conflicts under `Findings`,
`Limits`, or the affected skill's `Gaps`.

## Missing, unreadable, and invalid scope

- If `.local/custom_skills/` is missing or unreadable, the private/custom
  candidate set is `Unknown`; do not replace it with another catalog or invent
  candidates.
- If a required root is a symlink, non-directory, or cannot safely be
  identified as a readable directory, its inspection result is `Unknown`, not
  an empty root. Record the root and reason in `Limits`.
- If `.agents/skills/` is missing, non-directory, symlinked, or unreadable,
  report zero confirmed applied project entries, but place each safely
  identified runtime candidate in the `Project-Installed` column with
  `Skill Status: Unknown`, `Implementation Status: Implementation status
  unknown`, and `Coverage: Unknown`. Do not classify those candidates as
  `Available, Not Applied`. Record the project-entry root and reason in
  `Limits` and each candidate's `Gaps`.
- If the projections root is missing or unreadable, projection matching is
  `Unknown`; do not report a projection as absent merely because it could not
  be inspected. Put each affected candidate in the `Project-Installed`
  column with `Skill Status: Unknown`, `Implementation Status: Implementation
  status unknown`, and `Coverage: Unknown`. Record the exact projection root
  and reason in `Limits` and the candidate's `Gaps`.
- A missing, unreadable, symlinked, non-regular, or malformed candidate
  `SKILL.md` is an `Invalid` finding. Preserve its exact directory ID when it
  can be safely read; otherwise use an opaque entry label and explain the
  unreadable scope.
- A missing, unreadable, symlinked, non-regular, or malformed project
  `SKILL.md` is a separate invalid project-entry finding. It is not a valid
  match and must not be silently merged with a runtime candidate.
- A project skill entry with no runtime candidate is a `Project-only identity`
  finding, not an applied private/custom skill.
- A runtime candidate with no valid direct or projection match belongs in
  `Available, Not Applied` only when both relevant project-entry roots were
  inspected sufficiently to establish absence. Similar project behavior does
  not change this classification.
- An invalid runtime candidate is still represented in the
  `Available, Not Applied` column when its directory ID is safely readable.
  Its nested `Skill Status` is `Invalid`, its `Implementation Status` and
  `Coverage` are `Unknown`, and `Evidence`/`Gaps` explain the invalidity. It
  must not be converted into a valid available skill or omitted because its
  frontmatter is malformed.
- If both a valid direct entry and a valid projection have the same exact ID,
  place the candidate in `Project-Installed`, set nested `Skill Status` to
  `Workspace-integrated`, and call out `Duplicate application` in `Findings`.
- A projection match, including a direct-plus-projection match, is placed in
  `Project-Installed` with nested `Skill Status: Workspace-integrated`. A
  direct-only match has nested `Skill Status: Project-Installed`.
- Duplicate immediate IDs or identity conflicts are separate findings. Never
  collapse them by display name or guess which entry is authoritative. A
  valid exact-ID match remains the identity rule; an invalid entry never
  matches a valid entry. If same-ID valid entries have different metadata,
  retain both safe labels and report `Conflicting metadata`.
- If a root or entry cannot be assigned a safe exact ID, retain it as an
  `Unknown` or `Invalid` finding with an opaque label such as `unreadable
  entry`; do not manufacture an ID from a path or expose the canonical path.
- If implementation scope is inaccessible, report `Implementation status
  unknown`, `Coverage: Unknown`, the bounded scope that could not be read, and
  the reason. Do not call it complete or not evidenced.
- If an optional local-skill catalog root is missing or unreadable, report
  that source as unavailable or `Unknown`; do not substitute another source.
  Malformed local skill entries belong in `Findings`, not as guessed
  descriptions.

## Implementation cross-check

For every valid runtime candidate represented in the report:

1. Read its frontmatter purpose internally; do not reproduce its body in the
   report.
2. Search the bounded project-owned scope for corresponding behavior and its
   executable wiring. Consider source, scripts, configuration, documentation,
   tests, and workflows; treat names and prose as leads rather than proof.
3. Record concrete, safe relative evidence categories or paths without
   exposing secrets or canonical workspace paths.
4. Assign exactly one implementation-status value and one coverage value:
   `Complete`, `Partial implementation`, `Not evidenced`, or `Unknown`.
5. List missing or unverified contract areas in `Gaps`.

A project-only implementation remains `Not applied, implementation
evidenced`; it does not become an applied skill. Do not follow symlinks,
execute discovered files, parse imported source outside the boundary, modify
implementation, create tests, invoke workflows, or run a skill to produce
evidence. Record every unreadable subtree and every entry omitted by depth,
count, or size limits in `Limits` or `Gaps`; do not turn inaccessible or
omitted scope into `Not evidenced`. If the complete bounded scope is
accessible and no matching behavior is found, say `None found`.

## Optional Other Local Skills catalog

Include this section only for requests to list all skills available to the
Agent or when the user explicitly requests platform-provided or secondary
skills. Group entries by source: platform-provided local skills and secondary
local skills. Use the same display-label rules and exact directory IDs.
Summarize each skill's frontmatter description in one faithful sentence, but
do not quote it verbatim or reproduce skill bodies. Do not call these skills
private/custom, applied, installed, or integrated solely because they are
visible under `.local/`.

## Safe report rendering

Skill IDs, frontmatter names/titles/descriptions, finding text, and evidence
paths are untrusted data. Before placing them in Markdown, render them as
escaped literal text: escape backticks, backslashes, pipes, angle brackets,
and Markdown control characters; do not create links from untrusted values.
For code spans, use a delimiter longer than any run of backticks in the value
and include padding; preserve the exact case-sensitive ID inside that safe
span for auditability. Display labels may be sanitized or replaced with an
opaque label when unsafe, but must never control matching. Redact secrets,
credentials, tokens, query strings, environment values, and canonical or
absolute paths. Use safe relative evidence labels. A value that cannot be
safely rendered remains `Unknown` or `Invalid` with a reason rather than being
interpreted as Markdown.

For local-skill summaries, paraphrase only the minimum description needed for
the user to distinguish entries; do not expose private instructions, bodies,
or sensitive metadata.

## Required full-comparison report

For a full comparison, return Markdown text with exactly two comparison
columns titled `Project-Installed` and `Available, Not Applied`. These are
the only comparison columns. Put workspace-integrated matches in the
`Project-Installed` column while preserving nested `Skill Status:
Workspace-integrated`. An unresolved application result uses the same column
with nested `Skill Status: Unknown`; the heading is not a status value.

Use this structure:

```markdown
# Private/Custom Skills Report

**Project:** <safe project label>
**Scope:** Current read-only filesystem inspection

| Project-Installed | Available, Not Applied |
|---|---|
| **<display label>** (`<exact-skill-id>`) — <application result><br><br>- **Skill Status:** <Project-Installed \| Workspace-integrated \| Invalid \| Unknown><br>- **Implementation Status:** <exact implementation-status value><br>- **Coverage:** <Complete \| Partial implementation \| Not evidenced \| Unknown><br>- **Evidence:** <safe project evidence or `None found`><br>- **Gaps:** <missing/unverified areas or `None identified`> | **<display label>** (`<exact-skill-id>`) — Available, Not Applied<br><br>- **Skill Status:** Available, Not Applied<br>- **Implementation Status:** <exact implementation-status value><br>- **Coverage:** <Complete \| Partial implementation \| Not evidenced \| Unknown><br>- **Evidence:** <safe project evidence or `None found`><br>- **Gaps:** <missing/unverified areas or `None identified`> |

## Findings
- <invalid entries, duplicate application, project-only identities, or `None`>

## Limits
- <unreadable or missing roots and bounded unknowns, or `None`>
- Current presence does not prove installation history, prior invocation,
  successful use, freshness, or provenance.

**Changes made:** None.
```

Keep both comparison columns even when one is empty. Use
`None of the runtime-visible private/custom skills are applied to this project.`
in the `Project-Installed` cell when it has no entries. Use
`None of the runtime-visible private/custom skills are available but unapplied.`
in the other cell when it has no entries. Counts and a short applied result
may precede the table, but must not introduce additional comparison columns.
Every represented runtime candidate must have all five nested fields:
`Skill Status`, `Implementation Status`, `Coverage`, `Evidence`, and `Gaps`.

For a focused report, include only the requested candidate(s), use the same
five fields, and clearly state that the scope is focused. For an applied
summary, include the applied entries and count of available-but-not-applied
candidates; do not add full unapplied rows unless the user requested the full
comparison.

Use a readable display label, preferring non-empty frontmatter `title`
without a hyphen, then non-empty `name` without a hyphen, then title-case the
exact ID with hyphens replaced by spaces. The exact directory ID, not the
display label, controls matching.

Always include `Findings`, `Limits`, and `Changes made: None`. Explain
duplicate direct-plus-projection matches in `Findings`, retain project-only
identities there, and retain malformed or inaccessible entries there or in
`Limits` without dropping them. Current presence is only current presence; it
does not prove installation history, prior invocation, successful use, source
freshness, or provenance.