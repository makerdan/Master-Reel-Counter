# Failure Gate Unified — modular replacement definition

This package contains a reusable skill definition, not a gate runtime or an
automatic installer. It was prepared from the reviewed A2 wording with permission
to separate the core from supporting references. ConduitCount was not changed.

## Contents

- `SKILL.md`: core safeguards, adaptation, authorization, preflight, execution,
  failure classification and completion.
- `references/gate-maintenance.md`: required for installation, updates and repair;
  includes maintenance boundaries and full-contract revision pinning.
- `references/planning-and-publication.md`: required for drafting, publication,
  admission and follow-ups; includes the exact plan declaration formats.
- `REVISION-NOTES.md`: changes, provenance and validation scope.
- `PACKAGE-MANIFEST.json`: payload hashes and the normative-contract fingerprint.

The two references are binding instructions, not optional background material.
Keep them with the core; distributing `SKILL.md` alone is incomplete.

## Applying this package later

Placement in a project or publication to a shared skill library is a separate
operation. This delivery does neither.

For an authorized project update, use the existing canonical
`.agents/skills/failure-gate-unified/` destination and the maintenance procedure.
Preserve the previous full contract and its historical mappings before replacing
the definition. Do not combine old references with the new contract or silently
rebind historical tasks.

The adopting gate must identify and preserve the entire normative contract.
If its runner only pins `SKILL.md`, use supported owner-authorized maintenance to
make revision checks and snapshots cover the references before admitting new
work under this modular revision. Merely copying files or matching the core
hash does not establish enforcement. No implementation patch is included.

Discover the target project's actual commands, workloads, storage and tool
capabilities. Do not copy ConduitCount's runtime, unconditional companion-skill
dependencies or native-reference format into another project by default.

## Manifest interpretation

`canonicalSkillSha256` identifies the core file for inspection; it is not the
complete contract identity. `normativeContractSha256` covers the core and both
normative references.

For each normative path in lexicographic order, concatenate:

`relative-path + NUL + lowercase-SHA256-of-file-bytes + LF`

Encode the resulting string as UTF-8 and SHA-256 hash it. This is the
normative-contract fingerprint. An adopting implementation may use an equivalent
supported mechanism that covers the same complete contract.

The `files` list records hashes of all payload files except the manifest itself.
These are content-integrity metadata, not signatures, approval receipts or proof
of runtime enforcement. README and revision notes are explanatory, not additional
normative rules.
