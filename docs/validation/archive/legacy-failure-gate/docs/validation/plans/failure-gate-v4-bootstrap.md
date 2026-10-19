# Failure Gate v4 bootstrap implementation

## Task identity
**Task ID:** platform association `907`.
**Purpose:** bootstrap/maintenance, not active v4 authorization.

The platform-approved task description and its September 27, 2026 amendment
remain the approval evidence. This durable implementation record is not a new
approval or replacement policy. The user subsequently approved continuing
implementation despite the legacy mirror obstruction, preserving the raw
pre-edit result and deferring activation.

## Implementation contract

Extend the existing runner, guards, baseline and resource locks. Implement a
single-workspace transactional coordinator, independent control/assignment
interface, versioned approved plans, leases, isolated run snapshots, complete
results, bounded failure classification and local completion. Keep platform
dispatch unavailable until cross-boundary evidence is supplied.

Preserve existing coverage and audit thresholds. Never use product PostgreSQL
or product tasks for validation authorization. Store live coordinator data
outside `.local`, exclude database binaries from version control, and retain
terminal identities. Use the supplied v4 archive and its implementation and
acceptance references as specification; adapt the existing canonical skill,
not a second installed definition.

Candidate enforcement stays inactive. No agent-written approval flag, caller
task ID, guessed environment value, copied result, or fixture test constitutes
owner approval or platform-origin dispatch.

## Pre-existing failures to ignore
None authorized. The catalog remains empty.

The pre-edit run observed eight release-contract failures at a missing legacy
platform mirror prerequisite; see `../task-907-bootstrap-observation.md`.
This is recorded evidence, not ignore authority.

**Flaky-test rule:** Exactly three supported authorized isolation retries;
a passing retry establishes intermittency only. Direct earlier unaffected
snapshot evidence plus independent corroboration is required for provenance.

## Validation
**Command:** `test-standard`
**Why:** The registered runtime tier covers tooling contracts, compiler and storage checks, backend/unit tests and parity.
**Do not escalate:** Use the existing checked bootstrap entry point and prior-policy tier coverage only. Do not sweep all tiers or invoke managed completion without its required handoff.

## Regression Guard
**Covers:** Task substitution, stale authorization, policy self-approval, races, incomplete evidence, erased repair ownership and false platform verification.
**Test location:** `scripts/__tests__/failure-gate.test.mjs` and focused v4 modules imported by it.
**What it checks:** Positive local fixture execution and negative approval, path, task, override, lease, snapshot, report, baseline and completion cases; denied launches execute no commands.

## Scope limits

No product API, authentication, database, UI, deployment or remote CI changes.
No platform workflow edits or mirror writes. Independent approval remains
required for operational policy acceptance; local candidate tests cannot
stand in for platform dispatch acceptance.