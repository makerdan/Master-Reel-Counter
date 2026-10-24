# Project instructions

Port Authority's complete capability-scoped package is staged at
`.agents/skills/port-authority/`, pinned in
`docs/validation/port-authority-adoption.json`. Current production denial and
legacy caller/lease compatibility block live cutover; see
`docs/validation/port-authority-migration.md`. Do not strip production indicators,
automatically enable advanced controls, signal pre-existing processes, restart
services or delete uncertain leases to finish installation. Existing active
cleanup and serial-lock callers remain unchanged until coordinated authorization.
Package fixture passes are not two positive host activation runs.

The current Failure Gate authority is `.agents/skills/failure-gate-unified/SKILL.md`
and both normative references in that package. Read the applicable references;
verify the full-contract pin, not only the core hash, before gate operations.

Publish complete `UNADMITTED_NATIVE_DRAFT` proposals without ledger writes.
Read-only preparation uses `npm run gate:draft -- --spec <spec.json>`.
Before implementation, execution admission uses `npm run gate:new -- --spec <spec.json>`:
one provisioned UUID, one bound tier, complete declarations, and a sealed plan.
Never manufacture an ID or implement an unprovisioned task. Legacy tasks keep
their original IDs and records and are not rebound to Unified.

Before implementation, run the admitted plan's Agent-first preflight using
`TASK_ID` and `TASK_PLAN_FILE` with `npm run gate:guard -- --tier <bound-tier>`.
Native Start and ordinary editor writes are not intercepted by this local gate.
Ordinary approval, cancellation and scope are the Agent's responsibility.
Local notes are not independent native approval evidence. Never add custom
native-host admission, receipts, callbacks or indirect native authorization checks.
Use a stable local `claim` to reconcile interrupted/uncertain admission; it is
not a native task ID. Historical specs retain their original declaration syntax.

Regression Guard now uses structured `regression` input for new specifications:
`form`, `material`, `rationale`, plus the form's fields documented in
`docs/validation/regression-guard-migration.md`. The canonical core and BOTH
references are pinned in `docs/validation/regression-guard-pin.json`.
Do not supply a caller-selected contract to bypass current rules. The provisioner
records the selected contract inside the existing seal; historical plans retain
their recorded policy. Code checks structure, while the Agent must assess actual
scope, every material boundary, scenario and assertion adequacy before publication,
implementation and delivery. Deferral is explicitly unsupported here.
Emit the skill's classification announcement and retain a revision-bound delivery
handoff outside sealed plans. No independent verifier is required.

If admission or a plan guard fails, follow the canonical skill's
"Installing, updating and repairing the gate" section. Do not work around it.
Gate work requires authentic owner direction and is checked as setup/maintenance,
not a tier PASS. Run `npm run gate:merge-guard` before merges and publication.

See `docs/validation/unified-installation.md` for supported commands and boundaries.
See `docs/validation/modular-migration.md` for current readiness and rollback.
New modular admission stays blocked until the documented ordinary task-environment
and normal workspace-restart acceptance is actually observed. Do not fake evidence
or use an override. Historical single-file records retain their original handlers.

Follow-ups may be complete unadmitted drafts. Preserve the host's dedicated route,
parent linkage, categories, payload limits, duplicate checks and one-shot limits.
Never fall back to ordinary task creation or repeat an uncertain batch; reconcile
each item through available host tools. No independent verification task is required.
Platform-refreshed default instructions do not supersede this compatibility rule.
