# Port Authority capability-scoped migration

## Outcome

**Definition installed and pinned; runtime replacement STAGED / BLOCKED.**
The exact complete package includes core, three references, four runtime modules,
two test modules, manifest, revision notes and usage material. Its selected
safety-package identity covers instructions, engines and tests:
`eed2f79de206ef073f333ad26d541d1096919d3bd445a8fd7b672723f245bc2e`.

Archive: `docs/validation/archive/port-authority/2026-10-24/`.
Immutable staged snapshot: `docs/validation/port-authority-revisions/` under the
selected digest. Adoption/actual result metadata:
`docs/validation/port-authority-adoption.json`.

Final preservation checks: all 44 archived-source hashes and all 525 kept-state
hashes match. Both installed package and revision snapshot pass the selected
safety-package verifier. Protected caller/app/CI/config/pin/registry/workload
diffs are empty; `git diff --check` is clean.

This is owner-authorized definition replacement and non-disruptive preparation,
not permission to reclaim listeners, restart services, clear leases or enable
advanced controls. No new gate, tier, native approval service or reviewer was added.

## Discovery and preserved scope

Listed the uploaded ZIP before extraction, rejected unsafe paths/symlinks and
bounded sizes, then extracted into a fresh temporary directory. Read START-HERE,
the project plan, full core and applicable references. Read current actual callers
rather than assuming earlier kit installation. Unified and Regression Guard are
present; Unified ordinary runtime acceptance remains unobserved.

Read merged #442/#488/#452 and audit #713. Those describe the older reclaim and
named-resource/reentry behavior; merged state is not current activation proof.
#948 was cancelled, not revived. Initially no active task was returned. During
checks, #973 began restoring preserved plans and became WAITING_FOR_INPUT; this
migration did not touch that task, its plans, registry or recovery scope.

The four bundled runtime modules match the previous canonical package byte for
byte. The packaged hardening tests differ; the supplied revised bytes were used.
The complete canonical package replaced stale authoring documents/old verification
logs only after archival. No active app script imports the canonical runtime path
in the inspected scripts/package/CI/workflow callers. Active adapted scripts are
separate and were NOT overwritten.

Read-only workflow inventory: main app not_started; component preview running;
validation workflows finished/failed. None was started, stopped or restarted.
`ss` is unavailable. Separate read-only `/proc/net/tcp` observation showed
23636 among listening ports, but `/proc/net/tcp6` was unavailable. This is
incomplete discovery, not ownership proof, FREE, or a template PASS.

## Caller/resource mapping and selection

| Control/caller | Actual behavior/resource | Selected revision outcome / blocker |
|---|---|---|
| `dev-supervisor.mjs` → active `free-ports.mjs` | Before startup, cleanup can TERM/KILL occupied app port; caller passes NODE_ENV=development and retries failed cleanup | Basic managed lifecycle retained, replacement STAGED. Replacing reclaim with inventory changes startup semantics; no live cutover or signals performed |
| `startup-smoke.sh` → active `free-ports.mjs` | Explicit smoke port, normally 5001 | Same reclaim dependency; caller unchanged. No smoke run or live outage |
| `port-authority-test.mjs` | Tests the active legacy cleanup script | Existing product coverage retained, not run as new-package acceptance |
| `run-tier.mjs` → `serial-lock.mjs` | Validation resource with priorities and inherited resource-specific reentry | Serialization STAGED. Needs coordinated transitive caller redesign or separately approved advanced migration; no core drop-in substitution |
| npm `test:e2e` | e2e-port, priority 3, 900000ms timeout | Retain caller/resource identity and budgets |
| npm release verifier / `verify-published-release.mjs` | managed-clerk-release named resource | Retain; no release/deployment run |
| `ci-collision-test.mjs` and nested tier routes | Assert named resource/reentry behavior; exercise shared validation outputs | Retain tests and actual contract; new core denies inherited reentry |
| Independent type/storage checks | No newly demonstrated shared conflict requiring a new global lease | No additional serialization introduced |

Resource defaults come from `serial-lock.mjs`: `.local/validation-lock-${RESOURCE}.lock`,
`.local/validation-waiters-${RESOURCE}`; supported overrides and inherited markers
remain unchanged. Existing historical conflict evidence concerns shared test ports,
database state and outputs; no conflict was deliberately created on live resources.
Legacy recovery checks differ from the new lease-v2 finalized/healthy transition.
This audit does not certify safety equivalence, rewrite records or age-delete leases.

New core would require explicit finite queue/MAX_HOLD budgets, independent outer
supervision, complete command-tree containment and all conflicting callers mapped
to the same lease. The existing named/priority/reentry tree is not that core model.
No inherited budget was reset or silently widened. Advanced reclaim, attested
exceptions, resource/priority/reentry activation were not selected or enabled.

## Checks and actual outcomes

Content verifier installed as a read-only command:

```
python3 scripts/check-port-authority-package.py .agents/skills/port-authority
```

It checks the independently selected full safety-package digest, not just a
self-edited manifest. Result: CONTENT_VERIFIED_ONLY, exact selected digest.
It grants no runtime capability or task authorization.

Two consecutive non-signaling template observations:

```
timeout --signal=TERM --kill-after=3s 12s node \
  .agents/skills/port-authority/scripts/free-ports.mjs --dry-run 5000 5001 23636
```

Both returned **exit 2 / PROHIBITED**:
`core has no development-workspace exception; production indicator blocks`.
Real flags were not stripped, spoofed or changed. No advanced exception was used.
These are observed denials, not two positive host activation runs.

Two sequential private package fixture runs at the same final package snapshot:

```
timeout --signal=TERM --kill-after=10s 210s node \
  .agents/skills/port-authority/tests/hardening.test.mjs --supervised
```

| Run | Result | Runtime | Supervisor |
|---|---|---|---|
| 1 | 79 passed, 0 failed/skipped/cancelled | 120.003s | raw exit 0, workloadStopped true |
| 2 | 79 passed, 0 failed/skipped/cancelled | 120.934s | raw exit 0, workloadStopped true |

The package supervisor uses a private 180000ms fixture execution limit and
independent watchdog; the outer finite command boundary leaves teardown time.
This does not change host tier budgets. The private simulated providers and
environments are test-only, not installed authority. No manual port/process/lease
cleanup occurred between runs. Uncertain fixture state retained by the test
harness was not deleted. No raw logs or tokens were committed as new evidence.

Fixtures cover default inventory denials, owned-child lifecycle, finite limits,
same-resource exclusion, stale/uncertain leases and advanced regression cases.
They are package tests, not positive acceptance of existing app callers.
No application tier PASS, CORE_VERIFIED, ADVANCED_VERIFIED or LIVE_RECLAIM_ENABLED
claim is made.

## Per-control handoff and remaining action

| Control | Readiness | Exact blocker / next prerequisite |
|---|---|---|
| Revised read-only inventory | STAGED; host BLOCKED | Production indicator denies template; do not alter it. Need a genuinely supported permitted host equivalent or separately authorized available exception, not a local fake receipt |
| Managed startup integration | STAGED; unchanged legacy caller | Select safe core redesign and authorize affected lifecycle change, or retain legacy until supported cutover; restart consent is not inferred |
| Conflict serialization | STAGED; unchanged legacy caller | Reconcile named resources, priority, reentry, shared outputs and lease formats; establish containment and quiescence before changing callers |
| Advanced recovery/reclaim | NOT_SELECTED / NOT_ENABLED | Explicit scope plus genuine host capabilities required; default adapter is deliberately unavailable |
| Positive host acceptance | NOT_RUN / BLOCKED | Requires supported actual callers and two consecutive authorized runs at final snapshot; package tests/production denials do not substitute |

Separate review: not selected, not a blocker. No reviewer task is needed.
No newly activated runtime control exists in this delivery. Independent permitted
planning and unrelated work remain possible; blocked optional authority is not a
new planning prerequisite.

## Preservation and rollback

All task IDs, reservations, sealed plans, event history, baseline records, workload
definitions, application behavior/data, real production guards and uncertain
recovery state are preserved. No database/deployment/remote CI operations,
runtime-mirror edits, shared-library publication, backups or remixes occurred.
Historical logs/snapshots remain historical, not new instructions.

Rollback definition/guidance/checker source from the exact archived bytes or the
normal source checkpoint. Active caller wiring was not changed. Never restore an
old lease over current state, remove uncertain records or rewind task IDs/results.
If a later cutover occurs, reconcile its actual live state and retained versions
before any source rollback. The archive is local source recovery, not a remote
backup of live resources.
