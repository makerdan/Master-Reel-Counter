# Assigned dependency security remediation

## Governing scope and preflight

This delivery addresses the 35 assigned package/advisory findings, including
independently locked copies in the mockup sandbox. It does not claim the repository
has no other vulnerabilities.

- Admitted plan: `b2d99b11-c81f-4bb6-8b52-74737e18a5a7`, revision 1.
- Failure Gate contract:
  `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Regression Guard contract:
  `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- Classification: material security/compatibility repair, normal guard form.
- Approval: the user's assigned dependency remediation, without product changes,
  publishing, gate maintenance, or unrelated vulnerability upgrades.
- Pre-implementation `gate:guard -- --tier test-standard`: ADMITTED.
- Baseline catalog: valid, empty; no ignored failures or waivers introduced.
- Separate independent verification: not selected.

## Findings and disposition

The 35 package/version findings reference 30 unique GitHub advisories.
All 29 active advisories were compared to **every** matching package copy in both
lockfiles using their upstream affected-version ranges. None match after repair.
The remaining advisory was withdrawn upstream.

The table groups all assigned findings by package. Floors cover the combined
assigned advisories for each package, not only the first advisory in the group.

| Package | Assigned advisory suffixes (all `GHSA-`) | Delivered disposition |
|---|---|---|
| picomatch | c2c7-rcm5-vvqj, 3v7f-55p6-f55p | Root 2.3.2 / 4.0.4; sandbox 2.3.2 / 4.0.7; preserve consumers' major lines |
| browserslist | c83g-rgw3-j3cx | Root 4.28.9; sandbox 4.29.4 |
| vite | fx2h-pf6j-xcff, p9ff-h696-f583, v2wj-q39q-566r, 4w7w-66w2-5vf9, 698v-4r3x-3vcv, r825-w8mm-5pxw, v6wh-96g9-6wx3 | Both lockfiles and actual consumers use 7.3.7 |
| follow-redirects | q3jh-wrc6-jgq8 | Root 1.16.1; absent from sandbox |
| brace-expansion | qhr7-859c-m2p7, q2hr-2g5m-vwhr | Root 5.0.12; absent from sandbox |
| postcss | r28c-9q8g-f849, fxqj-rqcc-2cmp, qx2v-qp2m-jg93 | Both trees 8.5.31 |
| lodash | r5fr-rjxr-66jc, f23m-r3pf-42rh | Both trees 4.18.1 |
| braces | vfj7-8cjw-p6xm | Withdrawn on 2026-10-23; 3.0.3 retained; no patched release exists |
| sharp | wq5f-xc86-pv6w | Root 0.35.5; absent from sandbox |
| nanoid | xwg4-73v4-xw9w, 28wg-ghj8-5hjv, 2v37-7h3g-55p8 | Root 3.3.20 / 5.1.16; sandbox 3.3.20 |
| multer | 3pph-fpjx-jg34 | Root 2.4.0; absent from sandbox |
| ip-address | h3mg-xc3c-68pw, j6r3-76f7-8jcv | Root 10.7.4; absent from sandbox |
| postcss-selector-parser | rj75-hqrm-r3gf | All three root consumers resolve 7.1.7; absent from sandbox |
| baseline-browser-mapping | w5vr-8v7q-w6rv | Root 2.11.21; sandbox 2.11.32 |
| @babel/core | 4x5r-pxfx-6jf8 | Both trees 7.29.7 |
| esbuild | g7r4-m6w7-qqqr | Sandbox 0.28.2; root 0.25.12 / 0.27.2 are outside affected range [0.27.3, 0.28.1) |

The authoritative withdrawal is
<https://github.com/advisories/GHSA-vfj7-8cjw-p6xm>: upstream states this is not a
practically exploitable vulnerability. This is an upstream disposition, **not**
a local audit suppression, ignored baseline, claimed patched braces release, or
permission to accept a future active advisory.

Selector-parser's upstream affected range includes the legacy 6.x line. The root
override therefore selects 7.1.7, rather than 6.1.5, which would not satisfy the
published advisory. Tailwind, typography and postcss-nested still use their
existing APIs; consumer-relative parser fixtures and the production build check
compatibility. Sandbox Vite 7.3.7 supports esbuild `^0.27.0 || ^0.28.0`, so the
scoped 0.28.2 override stays within its supported dependency range.

## Requirement-to-delivery map

| Label | Recurrence / expected result | Delivered guard and evidence |
|---|---|---|
| R1 | An active assigned vulnerable package returns in a nested root or sandbox dependency | `scripts/__tests__/dependency-tooling-security.test.mjs`: both lockfile/installed-copy guards check all active package families, including release-line-specific picomatch/nanoid and esbuild's actual affected interval |
| R2 | Version guard accidentally accepts the original affected releases | Same file: negative controls cover every original active package/version pair; patched release-line boundaries have positive controls |
| R3 | Glob/parser upgrades hang or alter normal build matching | Same file: bounded child-process fixtures exercise extglob rejection, inherited POSIX names, ordinary glob matches, 100,000 flat selector nodes, and selector serialization through actual consumers |
| R4 | Toolchain/export compatibility breaks | Same file: real root client/server build, sandbox typecheck/build, ExcelJS serialization and existing source-map safety cases |
| R5 | Existing media/network remediation regresses | `server/__tests__/dependency-media-security.test.ts` and `server/__tests__/dependency-network-security.test.ts`: version guards and real crop/upload/network behavior, retained in `unit-tests` |
| R6 | Local install success hides ineffective transitive overrides or nonportable lock URLs | Both locks assert HTTPS public npm tarballs; disposable root/sandbox clean installs verified actual consumer-relative versions |

An initial guarded file diagnostic executed **18 cases, all passing**, including
both builds. Two portable-tarball checks were subsequently added before final
full-tier dispatch. Diagnostics do not replace the required complete tier.

Clean-install evidence: `npm ci --ignore-scripts --no-audit` in disposable
`generated-artifacts/dependency-clean/{root,sandbox}` trees succeeded. All 795
installed root packages and 260 sandbox packages matched their locked versions;
the three selector consumers and the sandbox Vite/glob/Babel/lodash consumers
resolved the patched versions. Lifecycle scripts were deliberately disabled for
this resolution-only check; real installed runtime packages are tested by the
build and application tests. Tarball URL normalization changes locations, not
versions or integrity hashes, and preserves public-CI portability.

The read-only advisory comparison and audit snapshots are reproducible from the
committed lockfiles and upstream advisory URLs; local diagnostic artifacts are
kept under ignored `generated-artifacts/` or `/tmp`, not committed as dependencies.

## Required validation and result records

The single assigned workload is `test-standard` in
`docs/validation/manifest.json`. Supported full dispatch:

```sh
TASK_ID=b2d99b11-c81f-4bb6-8b52-74737e18a5a7 \
TASK_PLAN_FILE=.local/tasks/b2d99b11-c81f-4bb6-8b52-74737e18a5a7.md \
npm run gate:run -- --tier test-standard
```

Final unfiltered same-target execution, actual step outcomes and source
fingerprints are recorded by the runner in the admitted task's append-only
`docs/validation/unified-registry.json` history. Read that result rather than
treat this handoff, an isolated diagnostic, or a command line as a full-tier PASS.
This handoff is prepared before dispatch to avoid changing the tested source
while checks run.

The first complete dispatch executed all eight steps successfully but correctly
recorded `INCOMPLETE`: automatic preview metadata removed
`exposeLocalhost = true` from the port-5001 mapping during execution. Recomputing
the source fingerprint with just that single line restored reproduced the
before-run fingerprint exactly; no application/test/dependency source drifted.
Its passing step observations are retained, not relabelled as a full-tier PASS.
A subsequent unfiltered run against stable configuration is the final acceptance
record. The public app landing page also rendered successfully after restart;
signed-in UI was not visually verified.

## Remaining audit findings outside the assigned list

The root audit still exits nonzero for newer, unrelated high-severity advisory
families:

- `body-parser`: GHSA-27r3-jxmh-p828.
- `multer` 2.4.0: GHSA-q7qp-rjg7-q26m (different from the assigned multer advisory).
- `zod` and its `zod-validation-error` audit chain: GHSA-mrhx-c7xc-m3w5.

Sandbox audit still reports the same Zod advisory. No audit exemption or security
threshold reduction was added. These findings existed in the before-change
audit as well; they are not represented as resolved by this scoped delivery.
In particular, neither a clean overall audit nor a passing heavy tier is claimed.
