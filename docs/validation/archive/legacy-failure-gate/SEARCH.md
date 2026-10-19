# Retirement verification and search

The maintenance checks passed: retirement invariants, the existing GitHub
workflow and managed-release contracts, collision smoke, and non-smoke nested
execution. These are maintenance results, not a task-tier PASS. No remote
workflow was dispatched. No task was created or marked PASS.

`moves.json` contains every relocation with its original/destination path and
SHA-256 checksum. All relocated bytes were verified. Task-board snapshots are
in `task-records/platform-tasks.json`; the local SQLite ledger remains an
unchanged historical file. The baseline catalogs and both CI workflow files
match the hashes in `preserved-files.json`.

The full final search outputs are:

- `generated-artifacts/legacy-gate-retirement/remaining-matches.csv`
  — every matching token, file/member, line or filename position, byte
  offset, and status.
- `generated-artifacts/legacy-gate-retirement/search-summary.html`
  — diff summary, method, counts, and every matched file/member with status.

The generated outputs are excluded from Git/deployment and from their own
scan to avoid infinite self-matches. The scan otherwise includes hidden and
ignored folders, dependency files, binary stored bytes, Git metadata, and
platform runtime/cache history. Git objects are not expanded into every
historical revision, and external symlink targets are not followed.

`archived` includes relocated history and historical pointers, plus Git,
Library metadata, platform logs/snapshots and caches retained **in place**:
moving live platform runtime state would corrupt the current environment.
`adapt-candidate` includes retained shared application checks and independent
skill integration wording, even where those application tools remain runnable.
`still active` means active **legacy gate enforcement**, not ordinary app CI.

The shared resource-lock implementation retains PID/start-time and file
ownership checks to prevent unsafe cleanup or concurrent app test runs.
Those checks protect running processes; they are not workspace receipts,
machine identity admission, task identity, or plan authorization. The retired
task admission and its host-bound execute checks are no longer active.
