# Historical source snapshot — not instructions

This non-overwriting archive preserves the superseded single-file Unified
integration before the owner-authorized modular migration. Files have a
`.historical` suffix so they are not executable hooks or active skill definitions.
`inventory.json` records the pre-change commit, existing dirty `.replit`, exact
source-copy hashes and hashes of state kept in place.

| Decision | Paths |
|---|---|
| Archive then replace | Canonical Unified package; current pin; gate integration sources and guidance |
| Adapt | Existing store, renderer/provisioner, facade, tests and local command aliases |
| Keep | Registry, tombstones, histories, baseline, tier workloads, old revision snapshots, legacy retirement archive |
| Remove after archive | Old canonical application-prompt.txt (superseded remix/backup instructions) |
| Keep unchanged | Application code/tests, CI workflows, deployment configuration, runtime mirrors and shared library |

Private environment-local plans/state were copied to
`.local/fgu-migration/2026-10-24-modular/`, excluded from Git/deployment.
These local copies are not durable remote backups. Do not publish their contents.
Use the project's normal source checkpoint history for source recovery.

Rollback restores compatible sources/configuration only, never registry/history,
IDs, tombstones or results. Preserve every contract revision used by any later
task; block unsupported revisions rather than rewriting records.
