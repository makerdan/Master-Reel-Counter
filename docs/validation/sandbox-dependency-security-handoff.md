# Sandbox dependency security repair

## Scope and admission

Assigned repair covers the seven specified advisory/version records, including
both Vite versions. Existing root lockfile resolutions were already patched;
the sandbox lockfile still contained affected Vite, PostCSS, source-map-js and
Browserslist releases.

Unified identity: `8c2b0797-9aba-44b4-84da-8e199e66fa4c`, sealed revision 1,
bound to `test-heavy`. The canonical full-contract pin is
`cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
`gate:guard` returned ADMITTED before dependency edits. The baseline catalog
was valid and empty; no failure is waived. Separate read-only verification
was not selected.

## Delivery map

| Requirement | Delivered guard / change | Evidence and limits |
| --- | --- | --- |
| R1: exclude the seven assigned vulnerable version records | `scripts/__tests__/dependency-tooling-security.test.mjs` checks both complete lockfiles and installed metadata, plus consumer-relative resolution from sandbox Vite, React/Tailwind plugins, PostCSS, Tailwind node and Babel. Negative controls reject all seven affected version records. | Root remains Vite 7.3.7, PostCSS 8.5.28, source-map-js 1.2.2, brace-expansion 5.0.12, Browserslist 4.28.9 and follow-redirects 1.16.1. Sandbox resolves Vite 7.3.7, PostCSS 8.5.31, source-map-js 1.2.2 and Browserslist 4.29.4. `npm ls` confirms consumer resolution in both projects. |
| R2: retain compatible tooling | Sandbox Vite minimum is raised within major 7. Immediate-consumer overrides keep source-map-js on major 1; PostCSS and Browserslist remain on their existing majors. Existing parser, source-map, workbook and application production-build fixtures remain, with an additional bounded sandbox typecheck/build fixture. | All checks run through the bound tier or its supported unit diagnostic. Final observations are recorded below after execution; registry run records retain source/plan/workload identities. |

The sandbox audit no longer reports any assigned advisory. It separately reports
five package findings in Babel, esbuild, lodash, picomatch and Zod. These are
outside the requested seven records; no force upgrade, audit threshold change,
waiver or unrelated package repair is included. This is not an all-dependencies
security clearance.

## Validation route

```sh
TASK_ID=8c2b0797-9aba-44b4-84da-8e199e66fa4c \
TASK_PLAN_FILE=.local/tasks/8c2b0797-9aba-44b4-84da-8e199e66fa4c.md \
npm run gate:run -- --tier test-heavy
```

Supported diagnostics use this same context and `--step unit-tests`, optionally
`--file scripts/__tests__/dependency-tooling-security.test.mjs`.
No changes to sealed plans, tier workloads, baseline records or admission policy
are part of this repair.

## Execution notes

- Disposable `npm ci --ignore-scripts --no-audit` of the sandbox manifest and
  lockfile reproduced all four patched package versions with installed/lock
  equality. Both projects' consumer-relative `npm ls` commands exited zero.
- Restarted the managed sandbox workflow once after the dependency changes.
  Logs confirm Vite 7.3.7; a browser snapshot of `/__mockup/` renders the component
  preview landing page without console errors.
- Both lockfile guards always run, including in clean root-only CI installations.
  Sandbox installed-consumer and build fixtures explicitly skip only when that
  independent artifact's `node_modules` directory is absent. When present but
  incomplete, mismatched or vulnerable they fail rather than fall back to root
  dependencies. The sandbox is installed in this validation environment, so
  its consumer, typecheck and build fixtures are required here.
- An already-running independent workflow exercised the new guard and exposed
  a fixture setup omission: standalone sandbox builds require `BASE_PATH`.
  The new sandbox build fixture now explicitly supplies its existing required
  `PORT` and `BASE_PATH` configuration. No application configuration was changed.
- The initial assigned full run was interrupted, not passed. Its recorder
  remains unresolved until the existing cleanup deadline, after which the
  supported `--recover` route must record INCOMPLETE before a fresh full run.
  No registry state or deadline is manually changed to bypass that protection.

## Full-tier result and failure classification

The supported recovery route recorded the interrupted run INCOMPLETE. The fresh
full run `705229f7-5a99-46a1-ba35-38af9b86c22c` completed with **FAIL**, not PASS,
at `security-audit` (`npm audit --audit-level=high`); startup smoke and startup
boundary tests passed. Its source fingerprint was stable during execution.
Later steps were not reached, including browser checks.

The audit reports nine findings (five moderate, four high): body-parser,
multer, Zod and its dependent zod-validation-error, plus the
postcss-selector-parser/Tailwind dependency chain. None is one of the assigned
seven advisory/version records. Root `package.json` and `package-lock.json`
are byte-identical to pre-task HEAD; the sandbox has its own separate npm graph.
This provides direct provenance for the unrelated root audit failures, rather
than inferring it from a successful retry. The independent pre-existing workflow
also reported the same audit result before the fresh assigned run.

[SELF-CLASSIFIED PRE-EXISTING] security-audit / npm audit --audit-level=high —
evidence: untouched root manifest and lockfile, separate artifact dependency
graph, and matching independent audit observation. No new baseline entry or
waiver is introduced. Audit-only retries are not supported by the gate's
test-step diagnostic interface; no unguarded substitute is used.

The runtime automatically sets a preview-only `.replit` port exposure flag.
It was restored to HEAD before unit diagnostics, then was automatically added
again by the diagnostic's runtime fixtures. This does not alter installed
versions, builds or guard assertions. The full-tier result remains FAIL.
Targeted diagnostic results do not replace it.

## Delivered unit/build verification

Supported unit diagnostic `6243e007-0c81-4a97-a143-4daff811c27a` ran all
**251 tests: 251 passed, zero failed, zero skipped**. That includes both
lockfile guards, sandbox consumer resolution, all seven vulnerable-version
negative controls, sandbox typecheck/build and the application production build.
Its supervised `unit-tests` step exited zero and cleaned up all owned processes.

The diagnostic recorder nevertheless reports **INCOMPLETE**, because the platform
regenerated the unrelated `.replit` preview-port exposure metadata during the
run. This is a source-fingerprint mismatch, not a failed or skipped test.
The generated metadata is restored outside validation rather than shipped as
an unrelated configuration change. No dependency or test implementation changed
after these passing assertions. Documentation-only result updates do not claim
a new full-tier PASS.

Final scoped delivery: all seven assigned vulnerable version records are
excluded, compatible dependency resolutions reproduce cleanly, all delivered
regression assertions and both builds pass, and the sandbox preview works.
Overall required-tier status remains **FAIL** on unrelated pre-existing root
audit findings; later full-tier/browser checks remain unverified.
