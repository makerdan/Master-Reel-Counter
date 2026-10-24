# Admission/readiness separation — owner-directed gate maintenance

The owner authorized removing the installation-readiness prerequisite from
otherwise-valid task admission before continuing the separately approved
page-view privacy fix. Contract pins, unique claims/IDs, seals, guards, single-tier
binding, historical compatibility and bounded execution are unchanged.

The original failure was `admissionReady()` requiring acceptance.state=OBSERVED.
It now verifies pinned contracts; the callers retain all admission/guard checks.
The pin's acceptance.state remains NOT_OBSERVED and the status command continues
to report unverified installation readiness. No host evidence was invented.
AGENTS.md and the reporting reason now distinguish these two boundaries.

Before-source archive:
`docs/validation/archive/admission-readiness-repair/2026-10-24/`.
Its registry hash records the maintenance starting point. This phase does not
admit a maintenance task, rebind historical tasks or alter their ledger entries.
The separately authorized application task will use normal provisioning.

Maintenance check:
`timeout --signal=TERM --kill-after=3s 80s node --test --test-timeout=40000 scripts/__tests__/unified-gate.test.mjs`

Result: 29 passed, 0 failed/skipped/cancelled, 18.090 seconds. The added fixture
admits/retries/runs a bounded task with NOT_OBSERVED, rejects all wrong tiers and
plan tampering, retains identical acceptance metadata, and confirms status still
reports the installation prerequisite unverified. Missing approval still consumes
no ID. Existing fixtures exercise timeouts, cleanup, pin integrity and concurrency.
This is maintenance evidence, not application-tier PASS or host acceptance.

Rollback only compatible source/configuration from the archive; never rewind
registry history, IDs or later application-task records. No separate reviewer.
