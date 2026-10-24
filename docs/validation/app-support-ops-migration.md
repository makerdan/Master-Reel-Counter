# App Support Ops definition/instruction migration

## Installed revision and scope

Selected package:
`8781ba01304581db0ec981ea5964762edf07b087ba82298513edf4e16d972b29`.
Installed all seven supplied files: core, normative integration reference,
application prompt, evaluation scenarios, manifest, README and revision notes.
The selected identity covers core, reference, prompt and evaluation scenarios.
The current core exactly matched the supplied B0 baseline; there were no newer
local core obligations to merge. Project-specific obligations are retained in
AGENTS.md, not inserted into and misrepresented as the selected package.

The archive is `docs/validation/archive/app-support-ops/2026-10-24/`.
The exact revision snapshot and selected pin live alongside this report.
Archived ten before-source files, including the old authoring snapshots and
prompt, before retirement. Recorded 789 preservation hashes. No live state copy
or Remix is claimed. Safe ZIP extraction rejected traversal/absolute/symlink
members and bounded total/member sizes.

## Existing scope and discovery

Read the actual merged #513 description and current source. No active task was
returned during this migration. Merged history establishes selected Combined
scope, not delivered behavior or test success. Restored historical plans remain
untouched. No new task identity, amendment, tier or native approval was created.

| Mode/capability | Evidence and boundary | Status for this delivery |
|---|---|---|
| Help/onboarding | `client/src/components/HelpMenu.tsx`: identity-specific versioned dismissal and replay event; `client/src/pages/help.tsx` | Present, preserved; account-switch/storage-denial/browser behavior not exercised |
| Help AI | `server/routes.ts`: authenticated, rate-limited `/api/help-chat`, `createHelpChatHandler(getPoeProvider(), HELP_SYSTEM_PROMPT)` | Existing provider preserved; no provider request, spend or substitute |
| Feedback | Authenticated `/api/feedback` submission and native storage; owner-only bounded listing | Present, preserved; no invented external contact or delivery claim |
| Admin analytics | `app.use("/api/admin", ownerOnly)` plus protected feedback listing, bounded responses and page-view queries | Server boundary present; no new role policy; real DB query isolation/retention not tested |
| Telemetry | `/api/track/pageview` validation, short-window dedupe and failure catch | Present, unchanged; concrete privacy gap below |
| Runtime | Existing startup/serial-lock scripts; staged canonical Port Authority and prior migration handoff | Unchanged legacy callers; newer runtime activation BLOCKED, not made ready by this install |
| Dev outage/restart surface | No complete safe client/server controller demonstrated by inspected support/runtime surfaces | Not verified or activated; no new control inferred from historical plan |

Existing `server/__tests__/support-ops.test.ts` and help-chat tests are coverage
sources, not executed evidence here. The historical heavy-tier assignment belongs
to its original task; it is not authorization to execute that task now.

## Actual instruction integration

AGENTS.md now routes support work to the complete canonical package, preserves
existing product choices and routes bare runtime work to Port Authority. Neither
missing runtime capability nor the staged runtime migration blocks independent
Help/Analytics. Replaced the old prompt's universal Remix and pre-granted workload
assumptions with the supplied prompt/reference. No automatic tier change, reviewer,
telemetry/provider or Combined feature scope remains implied.

Historical `docs/validation/skill-bundle-installation.json` and prior gate records
retain their identities/evidence; the new pin does not rewrite them. Runtime mirror
generator and output are unchanged: updating the canonical source makes future
projection possible but this delivery neither performs nor claims mirror refresh.
No competing source-management or approval service was introduced.

## Checks and scenario review

Owner-authorized bounded definition maintenance commands, not a tier PASS:

```
python3 scripts/check-app-support-ops-package.py .agents/skills/app-support-ops
timeout 30s python3 /tmp/aso-kit-pvhah2cm/app-support-ops-migration-kit/tools/test_verify_package.py
```

The first verifies all manifest members against the independently selected full
package fingerprint: CONTENT_VERIFIED_ONLY. The supplied verifier tests passed
5/5 in 0.008s, including reference tampering and a self-updated manifest that must
not replace the selected identity. No service, browser, database or provider runs.
Final checks: the installed source and revision snapshot both verify; all 10
archived hashes and 789 preserved hashes match. Protected application, workload,
registry, CI and configuration diffs are empty. `git diff --check` is clean.

Reviewed all 19 supplied mode scenarios as instruction-boundary assessments:
Help, analytics and runtime remain independently selected; CLI/API-only projects
do not gain UI requirements; missing providers/contacts are not invented;
Combined outcomes are separate; existing owner policy and native Help remain;
unrelated CI requests do not automatically trigger runtime work; existing runner
discovery is reused; missing safe restart capabilities remain unavailable.
This is a rubric review, not 19 executed model/application tests.

Requirement → check → route → outcome:
- Complete selected identity → exact source/snapshot verifier → Python maintenance
  command → content verified, no runtime/admission authority.
- Tamper rejection → supplied verifier fixtures → bounded unittest entry point
  → 5 passed.
- Historical continuity → before/archive and kept-file SHA-256 comparison →
  read-only maintenance check → recorded separately from tier outcomes.
- Mode independence and no inferred feature/backup authorization → manual core,
  reference, prompt and scenario review → instruction assessment only.
- Auth/privacy/storage/revisit/runtime acceptance → existing real application
  tests and governing assigned-tier route when separately authorized → NOT RUN.

No workloads, budgets, discovery, app tests, application code, data, deployments,
production flags, other skills, shared library or runtime mirrors were changed.
No signals/restarts or lease recovery performed. Signed-in UI and production
exclusion were not newly verified.

## Exact uncovered application scope (not implemented)

`server/routes.ts`, `/api/track/pageview`, accepts arbitrary path strings and
persists a truncated value without stripping query/fragment data. Its visitor
identifier uses `SHA256(ip + salt)` with a constant fallback when SESSION_SECRET
is missing, rather than a fail-closed server-keyed identifier. This does not meet
the package's minimum-data/keyed-pseudonym requirement in all configurations.
No secret values were read and no production configuration was inferred.

A separately authorized fix would normalize/allowlist coarse page paths, discard
query/fragment data, use the existing server-held secret in a keyed construction
with no fixed fallback, and preserve non-blocking failure and deduplication
semantics. It needs regression cases for missing secret, sensitive URLs and
telemetry failure. Existing data cleanup/retention changes are separate decisions;
this migration neither queries nor rewrites stored records. Do not claim current
data is exposed solely from this source finding.

This gap does not invalidate the definition installation or authorize a product
patch. Runtime readiness remains separately blocked as documented in
`port-authority-migration.md`; two private fixture passes are not host activation.

## Safe rollback

Restore only the former canonical package and instruction source from the exact
archive/checkpoint; restore its compatible revision metadata if reverting the
selected definition. Preserve newer history, IDs, seals, baselines, lease identities
and recovery state. No app behavior/data change needs reversal in this delivery.
A definition rollback neither repairs nor proves the existing product boundaries.
