# Build/export dependency repair

## Admission and scope

Assigned work: repair the three Vite, brace-expansion and source-map-js findings,
without a Vite major migration or the separate glob/CSS repair.
Unified identity `92db6839-28d1-4983-8040-9330c75e530a`, sealed revision 1,
bound to **test-heavy**. Canonical skill pin:
`2025d914d570b364dea2e7b8bd9dda35881a9b60ccaca67d9d904060b37f6c22`.
The active assignment authorized this revision. `gate:guard` returned ADMITTED
before dependency edits. The baseline catalog was valid and empty; nothing was
added, waived or ignored.

Classification: material security, reliability and compatibility repair, covered
by the normal Regression Guard declaration and R1–R4 assertions in the sealed
plan. Separate read-only verification was not selected.

## Delivered changes

- Vite **7.3.6 → 7.3.7**, with the manifest minimum raised to `^7.3.7`.
- ExcelJS → archiver → readdir-glob → minimatch resolves brace-expansion
  **5.0.9 → 5.0.12**. The existing minimatch constraint is retained using the
  override's `"."` form; its brace-expansion override stays on major 5.
- PostCSS and Tailwind node resolve source-map-js **1.2.1 → 1.2.2** through
  immediate-consumer overrides. All other overrides are unchanged.
- Lockfile tarballs use public HTTPS npm URLs, with integrity values confirmed
  against npm metadata, rather than workspace-internal registry URLs.
- New tooling regression tests run through the existing `test:unit` command.
  The existing Excel browser test now reopens its download and checks data and
  formatting. No export UI or format was changed.

No editors, command-execution payloads, Windows environment, remote workflow,
production deployment, database migration or distinct braces/Tailwind repair
was introduced.

## Requirement-to-assertion/results

| Requirement | Actual guard and assertion | Observed result / limits |
|---|---|---|
| R1: Vulnerable copies must not return | `scripts/__tests__/dependency-tooling-security.test.mjs` resolves Vite from the root and React/Tailwind plugins, brace-expansion from the actual export chain, and source-map-js from PostCSS/Tailwind node. It checks every lockfile copy and corresponding installed metadata, preserves compatible majors and rejects the three old versions in negative controls. | PASS in the final unit diagnostic. Both disposable clean installations resolve 7.3.7 / 5.0.12 / 1.2.2; `npm ls --all` exits 0 without dependency/peer conflicts. |
| R2: Parser resource exhaustion must not return | Child fixtures have 128 MiB V8 heap limits, 10-second deadlines, 64 KiB output limits and forced termination on timeout. Brace fixtures exercise 4,000 nested braces, 1,500 chained groups and 20,000 trailing braces, asserting bounded output or explicit limit rejection without stack exhaustion. Indexed-map fixtures reject negative/fractional/string/nonfinite/unsafe offsets, a line above the patched cap, and nested offsets whose sum exceeds it. Valid patterns, mappings and generator output are also asserted. | PASS for both source-map consumers and the export-resolved brace parser. Initial source-map positive fixtures failed on existing indexed-consumer helper quirks; the final fixtures consume public mappings explicitly and use a basic consumer for `fromSourceMap`. Failed attempts remain recorded; invalid-offset assertions were not relaxed. |
| R3: HMR, production builds and workbook contents/styles remain valid | Existing `server/__tests__/vite.test.ts` asserts real browser module updates, preview-origin sockets, cleanup and same-browser recovery after supervised restart. The new tooling test runs the actual `npm run build` with an owned process tree and 120-second deadline and checks client/server outputs. ExcelJS round-trip checks cells, font, fill and width. `tests/export.spec.ts` reopens the actual UI download and checks session name, catalog, notes, reel count, footage, title/header styling and width. | Final unit diagnostic: **191/191 passed**, including all seven new tooling tests and the production build. HMR: 9 passed with the recovery-only case skipped by design; recovery diagnostic: **10/10 passed**. Release contract diagnostic passed. Excel and PDF UI exports passed in **both** browser diagnostics. Whole browser suite: **69 passed, 1 failed** on each attempt; see the unresolved mobile failure below. |
| R4: Preserve failed aggregate evidence and disclose gaps | The bound full tier runs before supervised diagnostics; every run retains plan/workload/source hashes and observations in the portable registry. No audit threshold, baseline, tier or supported platform contract was weakened. | **test-heavy remains FAIL**, not PASS. The remaining audit findings are unwaived. Filtered diagnostics are recorded INCOMPLETE overall by design, even when their registered step passes. |

## Run evidence

Supported full invocation:

```sh
TASK_ID=92db6839-28d1-4983-8040-9330c75e530a \
TASK_PLAN_FILE=.local/tasks/92db6839-28d1-4983-8040-9330c75e530a.md \
npm run gate:run -- --tier test-heavy
```

For supported diagnostics, append `--step` with the registered test step.
References below are retained under this identity in
`docs/validation/unified-registry.json`, including output excerpts and hashes.

| Run | Purpose | Result |
|---|---|---|
| `cdf6fefc-45ab-4031-a829-e2f380f7b445` | Initial full bound tier | FAIL at audit after startup checks passed |
| `278091e5-8f6b-4cc4-8e7d-0309ae9f992c` | Final full bound tier after all code/lock changes | Same audit FAIL; stable source target throughout |
| `53b54dcb-0ba8-4ab3-afee-3a00c2700b0c` | Final unit diagnostic | Step PASS, 191 tests, no failures/skips |
| `d3d638a3-d7ff-4a19-9fb8-9e6b9fcb1bba` | Live Vite HMR diagnostic | Step PASS; 9 passed, 1 intentional recovery-only skip |
| `5c5a7758-bf84-4d0d-8b2f-56733093348d` | Live HMR recovery diagnostic | Step PASS; 10 passed, no skips |
| `7890075c-90f2-4efd-ada2-7d90170690dd` | Release contract diagnostic | Step PASS |
| `a04ea245-d052-4d80-9001-e9966ba6160b` | First full browser diagnostic | FAIL; 69 passed, 1 mobile failure; both exports passed |
| `718f62a0-69b5-4904-9424-4a9d563159c6` | Final full browser diagnostic retry | Same failure; 69 passed, both exports passed |

The final unit and browser diagnostic use the same source target as the final
full run. HMR/release checks preceded only fixture corrections, lock URL
normalization, a type-safe Excel test row lookup and the recorded lesson; their
application configuration and dependency versions are unchanged. This handoff is
documentation added afterward, not a claim that a new full tier passed.

Disposable compatibility preparation: copy the final package manifest/lock to a
temporary directory, run `npm ci --no-audit --no-fund` with a 180-second bound,
then `npm ls --all` and `npm ls vite brace-expansion source-map-js --all`.
Both installs succeeded, including the final public-registry lock. Temporary
directories were removed. No peer conflicts were suppressed with legacy-peer
flags or force options.

## Remaining failures and checks not reached

Both full runs passed startup smoke. Startup-boundary tests reported 17 passes
and one expected CI-only isolated-database skip. Audit returned 1 with **10
vulnerabilities: 6 high, 4 moderate**. The Vite, brace-expansion and source-map-js
findings disappeared. The remaining roots are:

- `braces`: GHSA-vfj7-8cjw-p6xm, with unchanged chokidar/micromatch/fast-glob,
  http-proxy-middleware and Tailwind consumers.
- `postcss-selector-parser`: GHSA-rj75-hqrm-r3gf, with unchanged Tailwind,
  typography, animate and postcss-nested chains.

The task explicitly identified this pre-existing shared parser chain as
downstream work, and its lock entries are untouched. That is classification
evidence, not a waiver of the aggregate failure.

The aggregate run did **not reach** schema-check, release-schema-contract,
workspace-skill-contract, typecheck, storage-lint, port-reference-scan,
storage-lint-contract, unit-tests, vite-hmr-tests, vite-hmr-recovery-tests,
serial-lock-tests, port-authority-tests, manifest-parity, nested-tier-regression,
collision-smoke or browser-tests. The supervised diagnostics above supply
limited compatibility evidence, not a full-tier or compiler-check pass.

The separate browser failure is **not waived or classified as pre-existing**:
`tests/mobile-photo-upload.spec.ts:231`, mobile-chromium, expects
`header-mobile-flow` to appear after entering Mobile Flow; it remains absent
after 5 seconds on both attempts. This is retained as a potential regression,
not evidence of intermittency or a successful suite. The supported diagnostic
route filters registered steps, not individual Playwright cases, so the retry
reran the entire browser step. No mobile UI, fixture, or application behavior
was changed to conceal it.

## Handoff limitations

- Windows-specific editor-launch execution was not reproduced on NixOS.
  Remediation is based on patched versions and the audit result.
- Local browser coverage excludes Ubuntu WebKit on NixOS; no full remote
  browser-matrix claim is made.
- The existing downstream glob/CSS dependency task must rerun the complete
  heavy tier against the combined repaired tree.
- The repeated mobile-flow failure needs diagnosis before claiming all browser
  checks pass. The code repair is delivered, but validation remains **FAIL**.
