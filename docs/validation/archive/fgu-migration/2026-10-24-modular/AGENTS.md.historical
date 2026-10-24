# Project instructions

The only Failure Gate source is `.agents/skills/failure-gate-unified/SKILL.md`.
Read and verify its current SHA-256 pin before gate operations.

New implementation plans use `npm run gate:new -- --spec <spec.json>`:
one provisioned UUID, one bound tier, complete declarations, and a sealed plan.
Never manufacture an ID or implement an unprovisioned task. Legacy tasks keep
their original IDs and records and are not rebound to Unified.

Before implementation, run the admitted plan's Agent-first preflight using
`TASK_ID` and `TASK_PLAN_FILE` with `npm run gate:guard -- --tier <bound-tier>`.
Native Start and ordinary editor writes are not intercepted by this local gate.
Approval evidence must identify the owner's actual direction and its
applicability to the sealed revision; do not invent reviewer clicks or receipts.

If admission or a plan guard fails, follow the canonical skill's
"Installing, updating and repairing the gate" section. Do not work around it.
Gate work requires authentic owner direction and is checked as setup/maintenance,
not a tier PASS. Run `npm run gate:merge-guard` before merges and publication.

See `docs/validation/unified-installation.md` for supported commands and boundaries.
