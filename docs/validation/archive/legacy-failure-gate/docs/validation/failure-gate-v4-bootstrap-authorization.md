# Failure Gate v4 reinstallation bootstrap authorization

The user explicitly authorized running **only `test-standard`** for the exact
plan at `docs/validation/plans/failure-gate-v4-reinstallation-bootstrap.md`
in this project's September 28, 2026 conversation, before the bootstrap
validation was launched. This authorization does not apply to any ordinary
local task, to any other tier, or to a changed plan.

- Plan SHA-256 at the decision and first run:
  `bd93f85b1a542cf12a1a1b8800f0d9ae94a26a7684946acbe51e99040702c76e`.
- Selected tier: `test-standard`. Its registered constituent steps run as one
  tier; `test-fast`, `test-standard-plus`, and `test-heavy` are not authorized
  extra tiers.
- Source of decision: the user's explicit approval in this conversation.
  No external decision ID was exported into the repository; this file is a
  faithful procedural record, **not** an identity attestation. It was written
  after the first attempted run and must not be presented as a prior
  machine-verified approval record.
- First attempt: `test-standard` stopped at `failure-gate-contract` with two
  package drift fixture failures; later steps were not reached.
- Second attempt: the same tier stopped at `failure-gate-contract` because two
  legacy Regression Guard test fixtures still assumed the removed
  self-satisfying/N/A shortcuts. Those fixtures were corrected and the entire
  focused contract test passed before another tier attempt. The earlier
  partial results are not passing validation evidence.

The bootstrap launcher additionally pins the plan path, bytes, and selected
tier. Neither this record nor that pin activates the new local-ID coordinator.