# Failure Gate v4 bootstrap observation

## Scope and status

Task association: platform task **907**. This is not a locally allocated v4 ID.
Assessment: **BLOCKED** at pre-edit baseline validation. The user subsequently
approved proceeding with candidate v4 implementation despite this failed
baseline. That approval did not make the baseline pass or authorize operational
cutover. No coordinator authorization, approval event, or successful v4 run is
claimed here.

## Supplied source

The user supplied `attached_assets/Failure_Gate_v4_(09.27.2026)_1790563203831.zip`
after the originally referenced Markdown attachment was unavailable.

Archive SHA-256:
`52a9064a3629357acb22217587a5ba1de6bc91fd4a7ac6765ee96fd04bbd2ada`.

The archive contains four files, totaling 54,933 uncompressed bytes:
`SKILL.md`, `README.md`, `reference/implementation.md`, and
`reference/acceptance.md`. All four were read directly without extracting over
project files. The skill identifies itself as `failure-gate-v4`; its references
describe installation requirements and acceptance cases, not implemented controls.
This upload supplies the requested specification; it does not establish workspace
source publication, mirror synchronization, or acceptance of changed enforcement.

## Actual bootstrap run

Pre-edit revision: `d7f278e44bb734f139a0f81d054bb29950fbd66a`.
Runtime: Node `v20.20.0`.

Actual command:

```sh
node scripts/run-locked-tier.mjs .local/tasks/task-907.md
```

The existing checked entry point selected **test-standard**. Both plan guards
passed. The existing resource lock waited for its current holder, then acquired
and released the validation resource normally. No lock was removed manually.
The raw process exit was **1**.

| Required step | Observed result |
|---|---|
| typecheck | passed |
| storage-lint | passed |
| port-reference-scan | passed |
| storage-lint-contract | passed |
| unit-tests | passed |
| clerk-release-contract | failed |
| vite-hmr-tests | not reached |
| failure-gate-contract | not reached |
| failure-gate-parity | not reached |
| manifest-parity | not reached |

The failing test invocation reported 63 tests: 55 passed and 8 failed.
This does not describe all commands in the composite release-contract step:
subsequent commands behind its `&&` were not executed.

Observed failing test names:

- missing release smoke target is provisioned before build and cleaned on success
- explicit release smoke target is preserved and cleanup runs after candidate failure
- database creation and cleanup failures block release without leaking credentials
- selection timeout still invokes state-based cleanup
- SIGINT after database selection cleans the owned target
- SIGTERM after database selection cleans the owned target
- consecutive automatic release runs each clean their owned database
- failed EXIT cleanup keeps the release status and removes its fixtures

The third failure included this raw stderr:

```text
Failure Gate parity: canonical source or generated mirror is missing.
```

The release script invokes `scripts/check-failure-gate-parity.mjs` before its
fixture lifecycle. That check requires both the existing canonical skill and
`.local/custom_skills/failure-gate/SKILL.md`. The canonical file exists; the
legacy mirror directory was absent when inspected. Consequently these harness
results do not establish failures in the intended database lifecycle behavior.

The full original console output was retained by the execution tool at
`/tmp/shell-exec-output/DGVC1SSJCBP782LHKVI50.txt`. This is session-local raw
evidence, not a durable complete report or v4 completion artifact. This document
preserves the bounded observation only; no secret-bearing environment values
were collected.

## Ownership and limits

The catalog remains empty. No failure has been promoted, ignored, repaired, or
classified as proven pre-existing. The failure occurred before implementation,
but that alone does not meet the v4 independent-corroboration requirement.
No isolation retries or comparison runs were launched: the observed obstruction
is a missing platform-provisioned prerequisite, and no approved v4 diagnostic
capability has been established.

The supplied specification does not grant permission to write disposable
platform-owned mirrors. Restoring that prerequisite belongs to workspace
provisioning. The user approved continuing implementation and adapting obsolete
mirror parity; this does not retroactively make the old parity requirement pass
or independently accept new enforcement policy.

## Resume requirements

1. Continue candidate implementation under prior-policy bootstrap authority;
   adapt candidate parity to tracked canonical and published sources without
   editing platform-owned mirrors. Keep the original failed baseline on record.
2. Rerun the same checked **test-standard** bootstrap tier post-change; do not
   sweep other tiers. Preserve raw status and any newly observed failures.
3. Independently accept the governing policy before operational cutover. The
   uploaded source alone does not satisfy any runtime implementation requirement.

Platform-managed completion independently remains **BLOCKED** until authoritative
platform context supplies the active task identity and exact approved plan
reference to one checked invocation. No workflow configuration was changed,
and no local test is offered as proof of that platform handoff.