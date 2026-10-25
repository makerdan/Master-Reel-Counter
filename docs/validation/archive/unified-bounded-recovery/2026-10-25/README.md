# Historical only — bounded-recovery update

These are preservation records, not current instructions or approval receipts.
The only current Failure Gate Unified authority is the canonical
`.agents/skills/failure-gate-unified/` package selected by
`docs/validation/unified-pin.json`.

Before replacement, the complete prior six-file package was verified byte-for-byte
against its existing immutable snapshot:

`docs/validation/unified-revisions/1c473ac807c45b104d7ca36fd94163ae3d0d4d4e97dbb5dd71bc8a81b98a6736/`

That snapshot is retained unchanged rather than copied into another source.
The archived pin retains all exact pre-update revision descriptors, the adopted
Regression Guard identity, and unchanged acceptance metadata. Archived AGENTS.md,
replit.md and the changed gate test retain their exact before bytes.
`preservation.json` records hashes, not a copy or reconstruction of a live ledger.

Never restore a ledger, local task state, consumed IDs, reservations, tombstones,
seals or results from this archive. Source rollback must retain mappings for
every subsequently bound contract. See the update handoff for rollback limits.
