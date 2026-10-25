# Zod security repair — owner-authorized main execution

## Admission and execution ownership

Owner explicitly directed that native #1007's prior executor remain idle and
that the same approved Zod repair execute here. No native task was duplicated
or status changed. Accessible main records contained no prior Zod admission;
inaccessible isolated reservations are not claimed inspected or absent.
No ledger was copied/reset. Destination uses stable claim
`native-1007-owner-authorized-main-zod-handoff`.

Local ID `296b16b7-4440-4cb1-b1e2-90035c680f17`, sealed revision 1,
current full Unified contract, bound `test-heavy`, 900000ms.
Pre-implementation guard: ADMITTED.
Normal/material Regression Guard: dependency security, resource use and validation
compatibility. Independent reviewer: not selected. No baseline exceptions.

## Upstream evidence and intended changes

GitHub advisory API GHSA-mrhx-c7xc-m3w5 identifies affected Zod `<4.6.6`,
patched version `4.6.6`. Retrieved on 2026-10-25 UTC. Selected Zod `4.6.7`.
This requires a major migration, not an unsafe v3 override.

Root: Zod 4.6.7, Drizzle-Zod 0.8.3, compatible form resolver 5.2.2 and
Zod-validation-error 5.0.0. Sandbox: Zod 4.6.7 and compatible v5 form resolver
(lock resolves 5.9.2 within its declared range). The only new transitive version
is the resolver's standard-schema utility. Other lockfile package versions
remain unchanged. Existing OpenAI 6.18.0 supports the selected Zod peer.

The package tool handles root installation. Its subdirectory flag is unsupported;
the default mockup-sandbox skill's explicit Adding Packages procedure permits
editing that independent package manifest and running npm install there.
Sandbox scripts were not run during dependency installation.

Body-parser 2.4.0 from merged native #1005 remains untouched; no duplicate repair.
No production data, schema migration, deployment, audit waiver or unrelated update.

## Requirement-to-delivery map

| Requirement | Delivered guard / compatibility change | Validation |
| --- | --- | --- |
| R1 patched actual/locked consumers | Root/sandbox lock guard and actual Zod version assertions in dependency-tooling-security.test.mjs | Final all-unit diagnostic PASS |
| R2 bounded oversized collection | Heap-limited 128MiB, 8-second child for each installed root; 250000 invalid members under max(8), bounded issue count, valid control input; child execution marker required | Final all-unit diagnostic PASS |
| R2 actual untrusted array consumer | Enforce the existing exact label-count contract before per-element Zod validation in validateVisionLabels. Root bounded child exercises this actual boundary with a hostile array and valid null-to-empty-label control. Public schema pipeline checks collection size before element validation in the direct collection control. No internal parse-context option, provider call or model selection change | Final all-unit diagnostic PASS |
| R3 null/type/schema contracts | routes.test.ts checks real Drizzle insert schema preserves nullable footage/text and string conductors; strict numeric fields, null patches and issue structure retained | Final all-unit diagnostic PASS |
| R3 real HTTP error contract | Session PATCH now uses Zod 4's `issues` instead of removed `errors`; tests/zod-validation.spec.ts requires actual HTTP 400 with field issue array | Chromium API browser diagnostic PASS |
| R3 form and API compatibility | Compatible adapters; existing compiler/build/unit/browser workload retained; enum customization migrated to `error` with original message | Compiler preflight, unit suite, production build, sandbox typecheck/build PASS |

## Validation observations

Attempting the bound diagnostic `--step typecheck` was rejected before execution:
the supported diagnostic route accepts registered **test** steps only, not the
typecheck step. No guard bypass or gate change was used. Compiler validation
remains part of the full bound tier and compiler-first browser route.

Full bound-tier results and any further supported diagnostics will be recorded
after execution. Presence of updated packages/assertions is not an audit,
application, browser or tier PASS.

- Full bound tier run `cdd1ae3a-496e-4afd-a2de-83fe43877c35`: startup smoke
  PASS; startup boundary tests PASS (35 passed, 1 skipped). Security audit FAIL
  solely on existing Multer GHSA-q7qp-rjg7-q26m. Body-parser and Zod were absent
  from the advisory output. Later steps were not reached.
- Selected dependency test diagnostic `c2bfe224-db78-47ce-b4d3-2d931f8cd779`:
  20 passed / 2 failed. Both new Zod tests passed, including the real resource
  boundary. Root production client/server build and sandbox typecheck/build
  passed. The two failures were existing lockfile-portability guards detecting
  internal HTTP registry URLs newly emitted by installation. Corrected those
  eight URLs to corresponding public npm URLs without changing integrity/version;
  kept the guards and added a child-execution marker before the next run.
- All-unit diagnostic `a979b396-6ab1-472f-8743-55af43904ec7`: 268 passed,
  0 failed/skipped. This preceded the compiler-driven adjustments below.
- Browser diagnostic `c36af248-e536-4fa4-a522-50957730734f`: compiler preflight
  correctly blocked launch. Fixed the remaining enum `errorMap` → `error`
  compatibility point while preserving its message. Zod's early-abort field
  belongs to its internal context, not its public parse API: removed that
  attempted dependency instead of casting around the compiler. The actual
  vision boundary now rejects the already-invalid label count before item
  parsing; the memory regression exercises that public-API defense.

## Final observed results

- Final all-unit diagnostic `083f3c1e-11ff-4184-b301-6c2cc674446f`: **268
  passed, 0 failed, 0 skipped**, including root/sandbox portability, both Zod
  guards, the actual vision-label memory probe, Drizzle compatibility, existing
  provider/network tests, production client/server build and sandbox
  typecheck/build.
- A browser launch attempted before the preceding CLI released its writer was
  BLOCKED single-flight; it executed no tests. Nothing was unlocked or bypassed.
  Retried only after that CLI exited.
- Actual API diagnostic `116e67c2-15b6-40e4-a673-26928c5d537c`: compiler-first
  preflight PASS, one Chromium test executed and passed on attempt 0. It uses
  authenticated fixtures against a fresh isolated release-schema database and
  requires actual session PATCH HTTP 400 plus the structured issue array.
- Photo diagnostic under its original identity:
  `e843c349-fe89-493a-83c5-96140b4a48e0`, mobile-chromium handoff test executed
  and passed; see `mobile-photo-filename-delivery.md`.
- Tested implementation target before this reporting-only update:
  HEAD `a3d013a104782092dd8c90d2a10081a446e6a2a6`, files hash
  `263115767c99c036a86b2f4ef42e99ab3a2487b88731281f38d8e04edc224806`.
  No application/test/dependency source changed after those final observations.

**Acceptance remains incomplete:** diagnostic PASS observations are not a full
bound-tier PASS. The full tier stopped on unchanged Multer
GHSA-q7qp-rjg7-q26m; no baseline exemption or formal pre-existing classification
was adopted. The local runner explicitly excludes CI-only mobile-webkit.
No full browser-matrix, deployment, independent review or native completion
is claimed. Historical interrupted/failed runs are retained, not rewritten.
