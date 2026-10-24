# Local validation summaries

Guarded `gate:run` execution now saves a compact, derived report **after** its
terminal observation is committed to the existing registry. This requires no
additional validation, service, dashboard or baseline entry. The registry,
bounded evidence logs, seals and workload definitions remain authoritative.

## Use

```sh
# Ordinary admitted execution: existing context and exact bound tier still apply.
npm run gate:run -- --tier <bound-tier>

# Read-only reports; no task admission or workload dispatch.
npm run gate:history
npm run gate:history -- --limit 100
npm run gate:history -- --run <run-uuid> --limit 20

# Direct CLI is useful for consumers wanting JSON without npm's command banner.
node scripts/unified-gate.mjs history --limit 10
```

History accepts only `--run <UUID>` and `--limit <1-100>` (default 10). It returns
the latest retained records and a comparison for the requested run, or the latest
record if none is requested. A requested missing/expired UUID has no comparison.
All existing pin checks still apply. History does not create directories, acquire
the writer/retention lock, prune files, repair reports or modify admission/evidence.
The limit bounds returned records, not comparison selection within retained history.

The ordinary runner's existing stdout result JSON and exit meanings are unchanged.
Automatic presentation is on **stderr**, including reporting warnings. Existing
diagnostic notices on stdout remain as before. For example:

```text
[validation summary] <current-run> FAIL; 142ms; evidence: .local/failure-gate-unified/runs/<current-run>.jsonl
Observed step comparison: <prior-run> -> <current-run>
unit-tests: newly observed failed step (PASS -> FAIL)
later-check: unknown/not reached (PASS -> NOT_REACHED)
Observed timing deltas: unit-tests +13ms
Prior evidence: .local/failure-gate-unified/runs/<prior-run>.jsonl
Informational step observations only; not identical-test, causal, pre-existing-failure or failure-ignore evidence.
```

## Meaning and equivalence

Version 1 reports include run/task UUIDs, plan revision/hash, applicable gate pin,
tier/workload identity, source Git revision and bytes fingerprint, source dirtiness
at start and observed changes, safe runtime profile, observed step outcomes and
durations, not-reached steps, timeout/interruption/recovery flags, and the local
evidence reference. Steps are identified by ordered name/kind fingerprints;
bounded identifier labels are displayed, with generic labels for unsafe names.
No test identities or counts are parsed from stdout. Commands, selectors, arbitrary
reasons/errors, output excerpts and environment values are never copied.

The most recent earlier **eligible** retained run is selected, not necessarily
the most recent run. Schema/comparison versions, tier, workload fingerprint,
gate contract, ordered step identities and runtime profile must match. Task UUID,
plan revision/hash, dirty status and tested source revision/fingerprint are
provenance, not equality requirements: before/after work can legitimately differ.
The earlier run must have finished by the current run's start.

The safe runtime/environment profile consists of Node version, OS platform,
architecture, a hash of OS release, the package-lock bytes hash (explicit `null`
means the file was observed absent), and an implementation hash covering the
reporting/execution/retry modules. It deliberately reads **no environment values**,
credentials, hostnames, account IDs or machine identifiers. Equivalent profile
evidence is not proof that arbitrary ambient configuration, external services,
credentials, installed dependency contents or network conditions were identical.
Comparisons are informational, never causal attribution or permission to ignore
a failure. They are not a performance benchmark or threshold.

Only stable-source, trustworthy terminal full-workload `PASS`/`FAIL` observations
are references. A fail-fast `FAIL` is eligible when its recorded prefix passes,
the failing step is observed, and the remaining steps are explicitly not reached.
Those later steps remain unknown in comparisons. Missing or unsupported
applicability fields, untrustworthy/truncated observations, missing durations,
diagnostics/filters, classification records, running/blocked/incomplete runs,
source changes, timeouts, interruptions and recovered runs cannot be references.
Diagnostics can have local summaries, but never count as clean full validation;
classification operations do not produce validation summaries.

Transitions distinguish newly observed failed steps, previously failing steps
now passing, repeated step failures and unchanged passing steps. A repeated step
failure is **not** evidence of the same failing test or pre-existing provenance.
Timing deltas are calculated only for matching, actually executed steps in both
runs. `NOT_REACHED` is not “skipped,” “passed” or “fixed.” There is no inferred
outcome for an unobserved test. With no equivalent history, output says
`No comparable prior run` and gives the relevant incompatibility or absence.

## Storage, retention and failure behavior

Reports live only under the already ignored gate-local directory:

```text
.local/failure-gate-unified/summaries/<run-uuid>.json
.local/failure-gate-unified/summaries/retention.sqlite
```

The directory is private (`0700`), records and the retention mutex are `0600`.
Writes are size-checked, temporary-file-plus-rename atomic and serialized with a
local SQLite mutex used only for derived retention. Reads use no-follow bounded
file descriptors and strict allowlisted shapes. Symlinks/path traversal are refused.
Enumeration stops at 512 directory entries; each record is at most 64 KiB.
At most 100 step details are retained, with `omittedSteps` explicitly marking
overflow and excluding that run from comparison. Each saved record is limited
to 64 KiB. Reporting warns instead of saving an invalid/oversize record.

Successful writes retain at most the latest **100 summaries**, none older than
**30 days**, pruning only valid owned UUID-named derived records. Slots are
reserved before publication so a failing write cannot exceed the count bound.
History filters expired records read-only; physical expiry is performed on the
next successful write, not by a background service. Unrelated filenames are not
deleted. Corrupt, oversized, future-dated or unsafe owned records produce generic
warnings and conservatively prevent a new write rather than deleting uncertain
data. Operators may inspect/remove damaged **derived** reports; never remove
registry history, baselines, seals, evidence or reservations to fix reporting.
Interrupted atomic writes can leave a private `.tmp` file; it is not read as a
record or silently promoted, and excessive directory entries warn/fail reporting.

Reporting warnings never change, erase or replace the committed validation
outcome/exit code. A real failure remains a failure even if storage is unavailable.
Reporting is best effort, not a tamper-proof store against a same-user process
replacing directory ancestors concurrently. It provides no acceptance/exemption
mechanism, automatic rerun, baseline classification or catalog edits.

Abrupt termination can leave the authoritative run visibly `RUNNING` with **no
terminal summary**. The existing `--recover` route waits for its bounded cleanup
deadline and commits `INCOMPLETE`; only then is a recovered summary attempted.
Uncommitted step observations remain unknown/not reached even if raw logs exist.
Older historical records without applicability metadata are not reconstructed:
recovery may warn that their summary is unavailable. No historical logs are
imported and no old outcomes rewritten.

Local history is disposable and is not synchronized with Git, other workspaces,
CI or task environments. An isolated environment starts without history unless
it is already present there. This is expected, not failed validation or a reason
to run an extra “before” check.

## Maintenance coverage

```sh
timeout 150s node --test \
  scripts/__tests__/unified-gate.test.mjs \
  scripts/__tests__/unified-gate-summaries.test.mjs \
  scripts/__tests__/unified-gate-retry.test.mjs
npm run gate:merge-guard
```

These are disposable gate maintenance checks, not a live task-tier PASS. No
workload or tier registration was changed to add reporting.
