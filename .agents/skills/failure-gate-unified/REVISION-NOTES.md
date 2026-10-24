# Revision notes — modular Failure Gate Unified

## Scope

Packaged the approved A2 preview into a compact core plus two required references.
This is the reusable replacement definition, not a claim that any project has
installed, adopted or validated it. No shared library or runtime mirror was updated.

## Source lineage

- Canonical baseline: ConduitCount's
  `.agents/skills/failure-gate-unified/SKILL.md`, inspected at project commit
  `3b0feeeb3f409d77254e7a9d409abe4c02024312`.
- Baseline SHA-256:
  `97685ec9ff0d9767436b850244e4c6cc2bfcaf07f9c1459a429acc65aca349dd`.
- A2 preview SHA-256:
  `a801266bfe3f0bd5db2762340224a4f731208720c68d67adadd5850077addb98`.
- The previously delivered review preserves the baseline, reviewed candidates,
  diffs, all 65 merged-task summaries and 14 relevant complete task plans.

The supplied native-admission-prohibited archive informed the explicit prohibition
on optional, dormant and indirect native-host admission. Its older requirement
to seal before publication was superseded by the deliberate draft/execution split
in merged Task #146. The attachment's older migration reference is not mixed into
this package as a second authority.

## What changed from A2

- Moved the complete maintenance section into `references/gate-maintenance.md`.
- Moved the complete planning/publication/follow-up section into
  `references/planning-and-publication.md`.
- Replaced those sections in the core with mandatory, trigger-specific reading
  instructions and corrected cross-file links.
- Added explicit handling for missing or unreadable required references.
- Made revision identity cover all normative files. Otherwise an unchanged core
  hash could conceal changes to binding reference instructions.
- Preserved the skill name, description and frontmatter exactly.

Apart from the disclosed reference-loading and full-contract pinning requirements,
the A2 instructions were relocated without changing or omitting their rules.
The new core is 389 lines; maintenance is 89 and planning/publication is 108.

## Decisions retained from merged history

- Installation is distinct from enforcement and observed acceptance (#5, #22).
- Native approval remains the Agent's responsibility; custom native-host
  admission is not part of the local gate (#127).
- Complete unadmitted drafts may be published. Implementation, mutation and
  validation still require admission first (#146).
- Actual workload coverage matters, not tier names or build success alone (#133).
- Local storage does not imply cross-environment retention or solve planner
  write restrictions by itself (#135, #146).
- Adopted companion requirements and real follow-up constraints compose with
  the gate; they are not universal infrastructure prerequisites (#124, #130).

Transactional identity, one adequate bound tier, baseline declarations, supported
amendments, historical preservation, finite supervision, cleanup, failure
classification and honest completion states remain in force.

## Packaging checks and limits

Checked source identity, frontmatter preservation, lossless relocation of A2
sections, required-reference links, core length, payload hashes, normative-contract
fingerprint and ZIP read-back.

These are authoring/package checks only. No application or gate runtime tests ran.
No project pin, runner, ledger, historical seal, library or mirror changed.
An adopting project still needs its supported maintenance and acceptance steps;
this package does not certify any host or runtime implementation.
