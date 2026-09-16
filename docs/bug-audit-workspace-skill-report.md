# Workspace Skill Validation Bug Audit Report

**Scope:** Workspace-managed skill projection and mirror validation:
`scripts/workspace-skill-sync.mjs`, its contract test,
`package.json` workspace-skill commands, `docs/skill-mirror-sync.md`, and the
`test-heavy` manifest entry.
**Mode:** report-only
**Date:** 2026-09-16
**Product/test behavior changed:** No. Only this report was added; no skill
definitions, projections, mirrors, metadata, locks, or synchronization
behavior were changed.

## Inventory and execution evidence

- `scripts/workspace-skill-sync.mjs:28-220` selects the explicit
  `WORKSPACE_SKILLS_SOURCE`, rejects source symlinks, inventories lowercase
  skill directories recursively, requires `SKILL.md`, and hashes every regular
  file.
- `scripts/workspace-skill-sync.mjs:239-395` parses and validates the
  projection manifest, rejects unsafe projection entries, and compares
  source, manifest, and projection fingerprints and file lists.
- `scripts/workspace-skill-sync.mjs:401-610` owns atomic file writes, the
  refresh lock, interrupted-artifact cleanup, staging, source-change checks,
  rollback, projection installation, and selected-skill loading.
- `scripts/workspace-skill-sync.mjs:627-659` reads source metadata and the
  platform-owned mirror sidecar and maps outcomes to the documented status
  exit codes.
- `scripts/workspace-skill-sync.mjs:661-729` dispatches `refresh`, `validate`,
  `audit`, `load`, and `status`, including JSON success output and bounded
  human-readable failures.
- `scripts/workspace-skill-sync.test.mjs:108-432` contains 15 contract tests
  covering recursive discovery, unsafe entries, manifest parity, rollback,
  concurrent refreshes, abandoned/live locks, source changes, status outcomes,
  redaction, CLI exit behavior, read-only npm commands, and retired aliases.
  The read-only `validate` and `audit` commands share the dispatch path at
  `scripts/workspace-skill-sync.mjs:704-712`; the contract exercises both.
- `package.json:18-24` exposes the contract and workspace-skill commands.
  `docs/validation/manifest.json:44-63` registers the contract as the
  `workspace-skill-contract` step in `test-heavy`.
- `docs/skill-mirror-sync.md:21-71` documents explicit source selection,
  recursive projection checks, read-only validation/audit, status outcomes,
  redaction, and ownership boundaries.

The mandated `npm run test-heavy` run reached these passing steps:
startup smoke, dependency audit, schema check, the workspace-skill contract
(15/15), typecheck, storage lint, Vite HMR tests, serial-lock tests,
port-authority tests, manifest parity, and collision smoke. The shell's
five-minute execution ceiling ended the command while the browser-test step
was running (it had reached test 59/59); no final heavy-tier result was
reported. No workspace-skill contract failure was observed, and no retry or
heavier tier was run.

The isolated read-only probes also confirmed:

- `mirrorStatus("safe-skill")` returned `{"outcome":"pass","code":0}` when
  `mirror/safe-skill` was a symlink to an external directory containing an
  otherwise exact sidecar.
- `refreshProjection()` returned `busy` for a fresh structured lock containing
  `pid: 0`, because `process.kill(0, 0)` reports the caller's process group as
  alive.

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 3 |
| Medium | 1 |
| Low | 1 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Concurrency & state integrity | `scripts/workspace-skill-sync.mjs:444-463` | Lock reclamation can remove a newly acquired live lock, allowing concurrent refreshes |
| F-002 | High | State & data integrity | `scripts/workspace-skill-sync.mjs:551-567` | Refresh can install and report success for a source snapshot invalidated after its final check |
| F-003 | High | Path safety & data integrity | `scripts/workspace-skill-sync.mjs:284-323,330-395,597-610` | Load consumes projection paths after validation, leaving a swap window |
| F-004 | Medium | Path safety & observability | `scripts/workspace-skill-sync.mjs:643-649` | Status follows a symlinked mirror skill directory and can report an external sidecar as published |
| F-005 | Low | Concurrency & recovery | `scripts/workspace-skill-sync.mjs:411-435,451-453` | PID-zero lock records are treated as live forever |

## Findings

### Finding F-001 — Lock reclamation can remove a newly acquired live lock

- **File and line:** `scripts/workspace-skill-sync.mjs:444-463`;
  `scripts/workspace-skill-sync.mjs:467-493`
- **Category:** Concurrency & state integrity
- **Severity:** High
- **Risk:** `tryReclaim` performs `lstatSync(lock)`, reads and parses the
  lock, decides that it is reclaimable, and only then renames the path to a
  reclaim name. There is no identity check between the read and the rename.
  If process A decides an abandoned lock is reclaimable, process B can remove
  or lose that lock and create a new live lock at the same pathname before
  A's `renameSync`. A then renames and deletes B's live lock, acquires a new
  lock, and both refreshes proceed concurrently. Their staging and
  destination renames can interleave, defeating the lock's serialization and
  potentially leaving one refresh's projection while the other reports
  success.
- **Realistic failure scenario:** A refresh process is delayed between the
  stale-owner read and `renameSync`, while another worker completes a
  release/reacquire cycle on the same lock path. The stale worker removes the
  replacement lock and continues as if it had safely reclaimed the old
  owner.
- **Recommended fix:** Reclaim by an atomic ownership primitive that cannot
  target a replacement inode (for example, an exclusive lock directory with
  owner metadata and an atomic rename/remove protocol that verifies the
  expected entry), or re-read and verify the same lock identity immediately
  before reclamation while treating any replacement as contention. Add a
  deterministic race test that pauses a reclaimer between inspection and
  takeover and starts a competing refresh.
- **Evidence:** The existing concurrency test at
  `scripts/workspace-skill-sync.test.mjs:242-262` covers two fresh
  acquisitions, and the abandoned/live lock test at
  `scripts/workspace-skill-sync.test.mjs:264-288` covers non-racing states.
  Neither exercises replacement between inspection and rename.

### Finding F-002 — Refresh can install a source snapshot invalidated after its final check

- **File and line:** `scripts/workspace-skill-sync.mjs:534-567`
- **Category:** State & data integrity
- **Severity:** High
- **Risk:** Refresh takes a source snapshot, stages and validates it, and
  performs a second snapshot comparison at `551-556`. After that comparison,
  it renames the staged tree into the projection and validates it against the
  already-captured snapshot. A source writer can change a skill after the
  second snapshot but before or during the install. Refresh then returns
  success at `568` even though the installed projection is already stale
  relative to the canonical source. A later `validate` or `load` catches the
  mismatch, but the refresh result and any consumer that acts on it claim
  current content.
- **Realistic failure scenario:** A workspace sync updates a skill immediately
  after `readSourceSnapshot()` at `551` returns. The refresh atomically
  installs the old staging tree, reports the old revision/fingerprint as
  successful, and a subsequent process observes drift.
- **Recommended fix:** Use a source-owner lock or immutable/versioned source
  generation so the snapshot cannot change during staging and install. At
  minimum, take a post-install source snapshot and roll back/retry when it
  differs, while documenting that only an immutable source can provide a
  strict guarantee. Add a deterministic test for mutation in the
  post-comparison/pre-install interval.
- **Evidence:** The implementation has a pre-install comparison and the
  contract test at `scripts/workspace-skill-sync.test.mjs:224-240` verifies
  changes during staging, but there is no check after the comparison or
  after installation.

### Finding F-003 — Load consumes projection paths after validation, leaving a swap window

- **File and line:** `scripts/workspace-skill-sync.mjs:284-323,330-395`;
  `scripts/workspace-skill-sync.mjs:597-610`
- **Category:** Path safety & data integrity
- **Severity:** High
- **Risk:** Projection validation uses `lstatSync` and then
  `readFileSync` while building hashes. After validation returns,
  `loadSkills` reads each selected file again by pathname. A local actor
  able to modify the generated projection can replace a validated file with
  a symlink before that second read, causing `loadSkills` to read outside the
  projection, or can change the bytes so the returned content no longer
  matches the validated fingerprint. The command therefore does not
  guarantee that the content it returns is the content it validated.
- **Realistic failure scenario:** A watcher or concurrent refresh swaps
  `skill/SKILL.md` between `validateProjectionContents` and the
  `readFileSync` in `loadSkills`. A symlink swap is followed by the read;
  an ordinary replacement returns changed content without a second hash
  check.
- **Recommended fix:** Open files with no-follow and descriptor-relative
  operations, hash and return bytes from the same opened descriptors, or
  consume an immutable projection generation. Add a deterministic load test
  that replaces a validated file before consumption and asserts fail-closed
  behavior.
- **Evidence:** Source and projection symlinks are rejected during each
  walk (`154-155`, `305-306`), and the contract catches static symlinks at
  `177-202`. The missing coverage is the validation-to-consumption race,
  not static unsafe-entry detection.

### Finding F-004 — Status follows a symlinked mirror skill directory

- **File and line:** `scripts/workspace-skill-sync.mjs:643-649`
- **Category:** Path safety & observability
- **Severity:** Medium
- **Risk:** `mirrorStatus` checks only the final sidecar with
  `assertRegular`. It does not verify that `mirrorRoot()` or
  `mirrorRoot()/skillId` is a real, non-symlink directory. A symlinked skill
  directory can redirect status to a sidecar outside the configured
  platform-owned mirror, causing a false `pass` for content that is not
  located in the mirror boundary the operator asked to inspect.
- **Realistic failure scenario:** A stale or redirected mirror entry is
  replaced with a symlink to an external directory containing a matching
  `.workspace-skill-metadata.json`. The status command reports `pass` and
  exit code 0 even though the configured mirror tree does not contain that
  sidecar.
- **Recommended fix:** Require the mirror root and the selected skill
  directory to pass `assertDirectory` before resolving the sidecar, and
  reject symlinked ancestors as well. Add a contract test for a symlinked
  mirror skill directory and assert `mismatch`, without deleting or repairing
  the mirror.
- **Evidence:** The isolated probe created exactly this symlinked directory
  and an otherwise exact sidecar; `mirrorStatus("safe-skill")` returned
  `{"outcome":"pass","code":0}`. Existing status tests at
  `scripts/workspace-skill-sync.test.mjs:299-343` cover missing and
  malformed sidecars and source unavailability, but not parent-directory
  symlinks.

### Finding F-005 — PID-zero lock records are treated as live forever

- **File and line:** `scripts/workspace-skill-sync.mjs:411-435,451-453`
- **Category:** Concurrency & recovery
- **Severity:** Low
- **Risk:** `lockOwner` accepts any integer PID, including zero.
  `pidAlive(0)` calls `process.kill(0, 0)`, which tests the caller's process
  group and normally succeeds. A malformed or interrupted lock containing
  `pid: 0` is therefore considered live regardless of age, so every refresh
  waits and eventually returns `busy` instead of applying the stale-lock
  recovery policy. This is an availability issue, not a content escape.
- **Realistic failure scenario:** An external lock writer, old implementation,
  or interrupted write leaves a syntactically parseable owner record with
  PID zero. After the configured stale interval, refresh still cannot reclaim
  it.
- **Recommended fix:** Accept only positive process IDs (and validate the
  lock format/version) in `lockOwner`; treat invalid owner records as
  unstructured locks subject to the existing stale timeout. Add a stale
  PID-zero regression test.
- **Evidence:** The isolated probe used a fresh structured lock with
  `pid: 0`; `refreshProjection()` returned `busy` with the configured
  short wait. The existing lock tests cover a dead large PID, the current
  PID, and a legacy stale lock, but not PID zero.

## Confirmed passes and boundary clarifications

- Source selection is explicit and fail-closed. Missing source, source
  symlinks, unexpected top-level entries, invalid skill IDs, nested symlinks,
  special files, missing revisions, empty skill sets, and missing `SKILL.md`
  are rejected by the paths at `179-220`.
- Projection validation is recursive and compares source, manifest, and
  installed content. Missing, extra, changed, reordered, and symlinked
  projection entries are covered by the contract test.
- Refresh writes only generated staging/backup names and uses rollback on
  install validation failure. The tests verify prior projection restoration
  and cleanup of owned interrupted artifacts.
- `validate` and `audit` take the same read-only path and do not call refresh
  or mutate the source, projection, or mirror. The contract exercises both
  commands through isolated fixtures and checks bounded output.
- Status maps exact metadata matches, mismatch, unavailable source, and
  missing sidecar to the documented outcomes and does not print revisions,
  fingerprints, paths, or skill bodies.
- No finding is reported for the source `lstatSync`/`readFileSync` interval
  alone: a stable changed source is detected by the post-copy snapshot
  comparison. The verified refresh race is the later interval after that
  comparison, and the verified load race is the separate
  validation-to-consumption interval.

## Deferred / not audited

- The browser-test step of `test-heavy` did not report a final result before
  the shell timeout. This audit does not attribute any browser failure to the
  workspace-skill findings.
- No skill content, generated projection, platform mirror, metadata sidecar,
  lock, or synchronization behavior was changed.
- No repair, refresh, installation, or cleanup operation was run against the
  project's real workspace or mirror paths; all mutation probes used temporary
  directories.