# Failure Gate workflow coordinator storage

## Boundary and provisioning

`scripts/lib/failure-gate/coordinator.mjs` implements a single-workspace SQLite
coordinator using `better-sqlite3`. Construct it with an explicit dedicated
`directory`, project `root`, and stable `namespace`. It does not discover active
tasks from environment variables or plan filenames. There is no production
activation or approval adapter by default.

Store the directory on a persistent **local filesystem**, outside `.local` and
outside version control. Do not share this database over a network filesystem,
copy it into parallel agent clones, or merge database binaries between branches.
Independent workspaces do not share allocation or authority. The metadata table
binds the database to the exact namespace and canonical project root; a mismatch
fails closed. Moving a project root requires separately reviewed migration,
not changing metadata to bypass the check.

New storage directories are created with mode `0700`; the database is set to
`0600`. For an existing directory, the operator must verify owner-only access
before provisioning it and retain equivalent protections for WAL, shared-memory,
backup and report files. The coordinator rejects symlinked storage paths and
existing database/WAL/shared-memory symlinks or special files. These checks are
workflow safeguards, not protection against an unrestricted local process.

## What persists

The database file is `coordinator.sqlite`, with SQLite-managed `-wal` and `-shm`
companions. SQLite uses WAL journaling, `synchronous=FULL`, foreign keys, and a
five-second busy timeout. Mutations use immediate transactions.

- `metadata`: namespace, root, schema marker.
- `tasks`: UUID-based local IDs, external task associations, lifecycle state,
  approved plan content and digests, tier/policy/parameter bindings, versions,
  suspension and pending changes.
- `assignment`: one independently approved active task association.
- `runs`: purpose, authorization and lease versions, coordinator/process
  identities, heartbeats, raw-evidence references and digests.
- `approvals`: exact review reference/action/subject digest and reviewer, resolved
  by the configured independent control route.
- `audit`: ordered bounded transition/denial events.
- `requests`: idempotency keys, input fingerprints and committed responses.
- `diagnostics`: at most three retry slots per initial full-tier run/failure.
- `comparisons`: policy-bound provenance-comparison attempt counts and limits.

State and successful audit events commit together; an audit failure rolls back
the state mutation. Denials are recorded separately after rollback without raw
caller input or exception messages. Do not submit credentials in plans, reference
identifiers, reviewer identities, or evidence metadata. The database necessarily
contains approved plan content and is not a public report.

## Restart and recovery

Committed task IDs survive restarts and are never reopened after terminal
release. Database triggers reject deleting task rows and audit history. There is
no ordinary pruning or reset command. Failed validation leaves a task active;
explicit failure/cancellation can release authorization without a passing tier
after active leases are handled safely.

Every coordinator process has a fresh UUID. Restart does not transfer heartbeat
or finish authority for a previous process's lease. A missing heartbeat or a
polling timeout does not establish process death. Recovery requires approval
binding the exact run and lease version, then a host adapter which verifies the
recorded process-start identity has stopped. Otherwise the run is quarantined
and continues to block replacement and terminal transitions. The coordinator
does not kill processes or clear unrelated resource locks.

Plan projections remain checked against approved stored content before launch,
resume and completion. A partial amendment or interrupted file replacement cannot
authorize mismatched bytes. The prior record remains authoritative after a
failed transaction; restore its exact projection or obtain a newly approved
amendment.

## Backup and restore

Use SQLite's online backup mechanism exposed by `better-sqlite3` (the
coordinator's database connection provides `db.backup(destination)`) to a new
owner-only file in a separately protected backup directory. Await backup
completion, verify the backup using SQLite `PRAGMA integrity_check`, and record
the namespace, root, latest audit sequence, and backup time outside the database.
This is an operator procedure, not an automated retention or restore command.
Do not copy only the live main database file while WAL writes are possible.
Keep the referenced evidence reports and approved source/plan snapshots with
their digests in the same backup set.

Before restore, pause all coordinator writers and validation launches. Preserve
the damaged/current database and WAL for investigation; do not overwrite live
files. Restore to a new private directory, verify integrity and metadata, and
reconcile all allocations, approvals, audit events and evidence committed after
the backup. A stale backup is not permission to forget IDs, revive terminal tasks
or accept old validation. If full reconciliation is unavailable, keep operational
authorization blocked and obtain an explicit recovery decision. Quarantine
unresolved restored leases until their original processes are verified stopped.
Never manufacture a successful run or a missing approval during restore.

Retain tombstones, approval history, audit events and idempotency history
indefinitely unless a separately reviewed migration preserves their invariants.
Backup retention frequency and off-host storage are deployment-owner decisions;
the implementation does not promise off-host durability or cross-workspace
coordination.

## Completion integration

The completion adapter is called inside the final SQLite transaction. It must
hold actual source-writer/snapshot coordination until that transaction finishes,
recompute applicable evidence, and return its decision. SQLite serializes
authorization changes, not arbitrary filesystem writes. A claimed `PASS` or
before/after worktree hash cannot substitute for the adapter's responsibilities.
Local records and approvals remain editable in workflow mode; they are not
cryptographic attestations. No project command may dispatch or rely on
platform-managed completion; the only terminal decision in this workflow is
the project-local one.