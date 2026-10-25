# Pageview legitimate allowance delivery

## Governing context

- Assignment: 995, test-only strengthening; no application defect claimed.
- Local identity: `e5723d04-c01b-47c4-8fcc-aa09dfb9e154`, sealed revision 1.
- Sealed plan hash: `b618ba5b9730009bca366e753a52b707eda233e5d612babe0dfec76d65b45bab`.
- Unified full contract: `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Regression Guard full contract: `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- Classification: self-satisfying, non-material, pure test-only allowance oracle.
  No application, limiter, store, proxy, deployment, common auth fixture or
  validation workload changes.
- Separate read-only verification: **not selected**.
- Baseline catalog: schemaVersion 1, zero records; nothing ignored or owned.
- Bound tier: **test-heavy**, `docs/validation/manifest.json`, `browser-tests`
  invokes `scripts/run-browser-tests.mjs` with disposable database preparation.
  Supported file selection is diagnostic only, not full-tier PASS.
- Ordinary authorization: current assignment; guard returned **ADMITTED** for
  revision 1 before pageview implementation.

## Separately authorized gate maintenance

Admission initially failed at `git prerequisite failed: show`. The committed
registry was 4,701,851 bytes; the gate's 4,000,000-byte subprocess stdout buffer
returned `ENOBUFS`. No identity was consumed in that failed admission.

The owner explicitly authorized the narrow history-reading repair and resumption.
The gate now spools only registry JSON from Git to a private temporary file,
checks Git success, parses complete JSON, and removes the file. Existing timeout,
history comparison, seals and append-only rules remain. Both HEAD and staged
reads use this path. No records, baselines, pins or tier definitions were changed
by maintenance.

Setup check: `node --test scripts/__tests__/unified-gate.test.mjs` — **31/31 PASS**.
The new large-history fixture exceeds the old buffer, checks HEAD and index
reads, and still rejects a missing identity and a corrupted staged event chain.
Two earlier runs failed solely because the new assertion expected a different
error string; those were corrected to the existing `changed event chain`
contract. This is maintenance evidence, not an ordinary task-tier PASS.

## Requirement map

| Requirement | Planned detecting coverage | Actual delivery | Evidence / disposition |
|---|---|---|---|
| R1 — preserve original weak-assertion evidence | Keep parent report and safe artifacts; distinguish missing original all-200 report from local findings | `pageview-throttle-investigation.md` and its original evidence files unchanged. Ordinary former `some(429)` could accept 65 rejections; opt-in historical diagnostics preserved. | Parent evidence remains historical, not this revision's validation. |
| R2 — normal registered legitimate allowance | Explicit anonymous fixed client, owned application/database, quiet window, 65 requests in one minute, exactly 60 JSON 200s then five documented 429s | `tests/pageview-rate-limit.spec.ts` normal anonymous case; `support/pageview-owned-server.ts` starts a dedicated app on a vacant loopback port using only the wrapper's disposable database and marker/PID/start-tick checks. `support/pageview-allowance.ts` asserts counts, order, endpoint, safe JSON shape, allowance/remaining/reset/policy/retry headers. | Execution evidence to be recorded after guarded diagnostics/full tier. |
| R3 — prove detecting assertion and honest delivery | Wrong-allowance local negative control must fail the same oracle; preserve all full-tier failures and gaps | Local HTTP controls permit 59 or zero requests while advertising 60. Both must be rejected by the exact count assertion. Neither changes the application's limiter/store. Safe timing/status/header/body-shape attachments exclude credentials, IPs, visitor/account IDs and arbitrary response bodies. | Execution evidence and merge guard to be recorded after runs. |

## Validation observations

First guarded file diagnostic: `0c441993-1244-4b57-bfda-2ba59f3b32a9`.
The compiler stopped execution on missing test-local types (the negative-control
array and untyped shared JavaScript supervisor). No HTTP burst ran. These errors
were corrected in the test-only code; a fresh diagnostic is required.

Corrected guarded diagnostic: `cd620e51-7adb-47c5-8222-80d4ac80027a` —
**SUCCEEDED**, one selected/executed/passed Chromium case, no failed or skipped
cases. The compiler prerequisite passed. Full source fingerprint remained
`79000c1b7a4896441c54d5a0a646a06e5f93e6043f8a8471aa6c2afad68cbd53`
before/after, HEAD `14b90ccc7f5261131b5aac3bd02b4e28b0d5c7ac`.
Heavy workload hash:
`b97e7282b502b201b5dbce053c829127ef14266c924b0389eaf253ecbcd358a5`.

Safe request-level evidence:
[`legitimate-allowance.json`](pageview-throttle-evidence/legitimate-allowance.json).
The evidence includes actual source hashes, marker and unchanged listener
PID/start ticks, 401 anonymous check, the 61-second quiet window, and every
request's relative timing, status, safe headers and allowlisted body shape.

- Real application: **60 JSON 200s then five documented 429s**, 361.810 ms.
- Wrong-allowance fixture: **59 / 6**, exact success-count assertion rejected it.
- Entirely blocked fixture: **0 / 65**, the same assertion rejected it.
- Owned server process-group and disposable database cleanup completed.
- These are real local HTTP exchanges, not browser route interception or an
  application/limiter mutation. No preview/production burst was sent.
- The diagnostic gate remains **INCOMPLETE**, because filtering cannot satisfy
  the entire tier. No full browser-matrix claim is made; local WebKit is CI-only.

Full-tier invocation:

```sh
TASK_ID=e5723d04-c01b-47c4-8fcc-aa09dfb9e154 \
TASK_PLAN_FILE=.local/tasks/e5723d04-c01b-47c4-8fcc-aa09dfb9e154.md \
npm run gate:run -- --tier test-heavy
```

The parent heavy run failed its dependency audit with nine vulnerabilities and
did not reach browser/mobile workloads. That is historical evidence only:
no failure is ignored, and current results must be recorded independently.

### Full-tier result: FAIL, not PASS

Run `1078fb4a-5e73-441d-940f-cecf29c5f437` executed the bound `test-heavy`
workload against an independently owned, prepared disposable outer database.
The browser wrapper would create its own nested disposable target if reached.
The tested source fingerprint stayed
`131b7a3b193676fcca0ff1a10d1694911805cdedb809f30c89f510c131c680e4`
before/after; HEAD and workload hash are unchanged from the context above.

- `startup-smoke`: PASS; owned process cleanup completed.
- `startup-smoke-boundaries`: PASS; 27 tests passed and the existing CI-only
  empty-database activation case skipped locally.
- `security-audit` (`npm audit --audit-level=high`): FAIL, exit 1; nine
  vulnerabilities (five moderate, four high), cleanup completed. High advisories
  include body-parser `GHSA-27r3-jxmh-p828`, multer `GHSA-q7qp-rjg7-q26m`,
  zod `GHSA-mrhx-c7xc-m3w5` and its dependent zod-validation-error path;
  moderate findings include postcss-selector-parser and dependents.
- Not reached: schema-check, release-schema-contract, workspace-skill-contract,
  typecheck, storage-lint, port-reference-scan, storage-lint-contract, unit-tests,
  vite-hmr-tests, vite-hmr-recovery-tests, serial-lock-tests, port-authority-tests,
  manifest-parity, nested-tier-regression, collision-smoke, browser-tests.
- The focused diagnostic's compiler and browser result remain valid for the
  unchanged test/application code; they do not certify the unreached full-tier
  workloads or mobile matrix. Earlier compiler/setup evidence is retained, not
  replaced with a full-pass claim. The parent's mobile/setup observations remain
  historical and unresolved by this task.
- No dependency or lockfile changes were made. `git diff --exit-code HEAD --
  package.json package-lock.json` succeeded. Same package/advisory/count evidence
  in the parent report supports **self-classified pre-existing**, not a newly
  ignored baseline. The raw audit result stays failed. The supported per-test
  selector cannot retry an `audit` step; that limitation was not bypassed.
- Owned outer database removal completed, and the owned smoke/browser process
  groups stopped. No production or preview burst, migration, dependency repair,
  workload amendment, baseline addition or deployment occurred.

Only evidence/documentation/memory additions follow the measured runs; application,
test and gate-maintenance executable bytes retain the measured snapshot. Gate
merge-preservation checking is required before completion/publication.

## Delivery checks

- `gate:classify` recorded the audit evidence in
  `d9dc6e92-d521-4169-8f0c-ae5fda9a0bb9` as
  `SELF_CLASSIFIED_PRE_EXISTING`. That classification is **INCOMPLETE**, not
  validation or baseline waiver; full run `1078fb4a-5e73-441d-940f-cecf29c5f437`
  remains **FAIL**.
- `npm run gate:merge-guard` returned **READY**, preserving every committed
  identity, tombstone and history event before follow-up publication.
- The first proposed follow-up payload exceeded the host's description limit
  and was rejected during schema validation before any publication. The wording
  was compacted without omitting requirements; both drafts were revalidated and
  checked below 4,000 characters before the single successful two-item batch.
  Reviewable, unadmitted test-gap drafts: **1008** (same-client window recovery)
  and **1009** (real HTTP/database persistence). They do not authorize execution
  and do not overlap the cancelled sign-in-budget proposal.
- Preview workflow started cleanly; the unauthenticated landing page rendered
  normally. Its unauthenticated `/api/auth/user` 401 and development-key notice
  are expected. Signed-in UI was not verified or modified. The preview received
  no burst traffic; its normal landing page recorded one ordinary pageview.
- Final delivery status: **test implementation delivered; required full-tier
  validation FAIL due to unchanged dependency audit findings**, not full PASS.

## Main-project synchronization

Initial completion synchronized onto main and encountered concurrent memory,
registry and gate-reader edits. Both memory pointers were retained. The registry
was regenerated from the two authoritative Git-stage JSON inputs, using only
compatible prefix histories and a union of permanent identities/tombstones.
All **22 identities and tombstones** and both complete histories passed
`validateRegistry`, both `compareRegistry` checks and `gate:merge-guard`.
No historical event was edited or dropped.

The gate combines main's immutable Git-object resolution/size validation and
generic output allowance with the private registry spool. Both sets of setup
tests were retained: **33/33 PASS** after reconciliation. Rebase completed at
HEAD `f6337433f00c5d634484875c11293028d4eabdaa`; revision 1 preflight again
returned **ADMITTED**, with the same bound heavy workload.

Main additionally brought PostCSS dependency updates and bounded browser-database
lifecycle changes. Installed packages were synchronized with that incoming
dependency choice; the install-only registry URL rewrite was removed, preserving
the incoming package/lock bytes. Those incoming changes are not this task's
dependency repair. Earlier validation remains historical; focused/full results
on the synchronized snapshot will be recorded separately.

### Renewed results on synchronized source

- Guarded diagnostic `6d9d269f-9a52-4bc7-bd0d-f4debb34e73b`:
  **SUCCEEDED**, one Chromium case executed/passed, no failed/skipped cases.
  Compiler prerequisite passed; source fingerprint stayed
  `f20cf52a3ac5434edb9fb1b14602056b2eac2aebeda75bd883b2a740218d75ec`.
  Real endpoint returned **60 JSON 200s then five documented 429s** in
  **390.317 ms**. The 59-allowance and entirely blocked controls both failed
  the same exact count assertion. Safe full request/process evidence:
  [`synced-legitimate-allowance.json`](pageview-throttle-evidence/synced-legitimate-allowance.json).
- Bound full `test-heavy` run `72a666b9-a585-494b-936c-21ab58e47e63`:
  **FAIL**, not PASS. Same revision/workload and unchanged source fingerprint.
  Both startup workloads passed; `security-audit` failed with **four high**
  advisories (body-parser, multer, zod and dependent zod-validation-error).
  Main's incoming PostCSS changes removed the earlier five moderate findings;
  the earlier nine-finding result is retained as historical, not rewritten.
  The same 16 later workloads listed above were not reached, including full
  browser/mobile validation. All observed process cleanup and outer disposable
  database removal completed.
- The renewed audit matches the original run's four high advisories and the
  parent evidence. Package and lock bytes remain identical to the synced HEAD.
  It is self-classified pre-existing with that concrete provenance, not ignored.
  No unsupported audit-only retry, dependency repair or tier switch occurred.
- The successful two-follow-up batch was not repeated after synchronization.
  Both proposed test gaps remain separate from current scope.
- These observations supersede only the current-snapshot verdict, not any
  earlier failure evidence. **Current full-tier status remains FAIL.**
