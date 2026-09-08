# GitHub Actions validation contract

This repository contains a GitHub Actions workflow at
`.github/workflows/validation.yml`. It is a repository configuration artifact,
not evidence that GitHub has run it or that any branch policy requires it.
Activation, first-run verification, and branch-policy changes remain manual
GitHub administration steps.

## Events and result contract

The workflow runs for:

- pull requests;
- pushes to `main`;
- merge-queue `merge_group` events; and
- manual `workflow_dispatch` runs.

It has repository read permission only. The concurrency group does not cancel
an in-flight run, so a result considered by a future branch policy cannot be
silently replaced by a newer run. The `validation-result` job is the stable
aggregate check. It runs with `always()` and fails unless the required
validation job result is exactly `success`; `failure`, `cancelled`, and
`skipped` are not accepted.

The workflow uses Node.js 20, matching the repository's `.replit` declaration,
and runs `npm ci` before validation. Third-party actions are pinned to full
commit SHAs. No production credentials, GitHub write token, authenticated
Replit API, object-storage credential, or AI credential is used. The
environment values in the workflow are test-only values: AI requests are
mocked by the browser tests and object storage is not authenticated in GitHub
Actions. Current application startup does perform public Replit OIDC metadata
discovery. The workflow supplies a non-secret test client identifier for that
discovery, not a Replit credential.

## Local-to-remote coverage

The remote job invokes the same `npm run ci` entrypoint used locally. That
command owns the registered `test-heavy` tier in
`docs/validation/manifest.json`; the tier runner remains responsible for its
lock, plan behavior, ordering, and exit status.

| Canonical surface | Remote coverage | Classification and notes |
| --- | --- | --- |
| `startup-smoke` | `npm run ci` → `test-heavy` | **Indirect**; runs against the test PostgreSQL service with the workflow's test-only `SESSION_SECRET`. |
| `security-audit` | `npm run ci` → `test-heavy` | **Indirect**; `npm audit --audit-level=high` remains unchanged. |
| `schema-check` | `npm run ci` → `test-heavy` | **Indirect**; reads the checked-in migrations and schema. |
| `workspace-skill-contract` | `npm run ci` → `test-heavy` | **Indirect**; uses only checked-in canonical skill sources. |
| `typecheck` | `npm run ci` → `test-heavy` | **Indirect**; Node.js 20 is installed explicitly. |
| `storage-lint` | `npm run ci` → `test-heavy` | **Indirect**; no external storage access is needed. |
| `unit-tests` | `npm run ci` → `test-heavy` | **Indirect**; test-only values are supplied by the job environment. |
| `serial-lock-tests` | `npm run ci` → `test-heavy` | **Indirect**; uses local filesystem locks on the runner. |
| `port-authority-tests` | `npm run ci` → `test-heavy` | **Indirect**; owns only ephemeral runner ports. |
| `manifest-parity` | `npm run ci` → `test-heavy` | **Indirect**; verifies the tracked validation manifest. |
| `collision-smoke` | `npm run ci` → `test-heavy` | **Indirect**; nested commands use isolated temporary lock paths. |
| `empty-database-startup` | `node --test scripts/__tests__/github-actions-empty-database.test.mjs` | **Direct** preflight; creates a local disposable PostgreSQL database, applies the same forced Drizzle schema push, inserts the synthetic owner, starts the app with the workflow's non-secret test values, verifies health/password seeding/owner login, and terminates connections before dropping the database. |
| `browser-tests` | `npm run ci` → `test-heavy` | **Indirect**; the isolated service receives a schema push and a synthetic non-tester owner, then Chromium is installed with Playwright and launched before the suite as a readiness check. |
| GitHub workflow contract | `node --test scripts/__tests__/github-actions-workflow.test.mjs` | **Direct** preflight; it inspects triggers, permissions, pins, routing, prerequisites, aggregation, and artifact safety before the canonical run. |
| Replit Auth owner session | Synthetic test owner row | **Intentional test substitute**; the isolated database receives a non-production owner row so the existing test-only owner-login endpoint can create a full-permission test session without Replit Auth. |
| Replit OIDC metadata discovery | Public metadata endpoint | **External prerequisite**; current startup discovers public provider metadata with a non-secret test client ID. Availability on GitHub runners is unknown until a revision-aware run succeeds. |
| Replit object storage | Not authenticated remotely | **Intentional gap**; tests that need photo storage must skip or mock according to their existing test contract. No production bucket is used. |
| OpenAI/Replit AI integrations | Not authenticated remotely | **Intentional gap**; browser AI calls are mocked. Real provider reachability is not a CI requirement. |
| Replit-managed secrets and environment values | Not available remotely | **Intentional gap**; only non-sensitive test values are declared in the workflow. |
| Hosted runner, service, or action outage | N/A | **Unknown until a real GitHub run**; local success cannot establish remote availability. |

## Diagnostics and artifact safety

The canonical command is recorded in `ci-artifacts/canonical-validation.log`
with `pipefail`, so a failing command remains a failing step. The workflow
always attempts to upload that log plus Playwright reports, traces, and
screenshots with seven-day retention. The upload has `continue-on-error: true`
and therefore cannot replace the validation result. Hidden files are excluded,
and no environment dump, `.env` file, auth-state file, or secret-bearing path
is included in the artifact list.

## Private repository and fork behavior

This repository is private. Pull-request workflow behavior, merge queues,
artifact availability, and hosted-runner minutes still depend on the
repository's GitHub plan and settings; this file does not change them. Fork
pull requests must not receive repository secrets, and this workflow does not
request any. A fork can run the read-only source validation only if GitHub
permits the workflow for that fork/event; that event behavior is not claimed
until a revision-aware run is observed.

## Verification evidence

The first repository verification attempt was made against the merged `main`
revision `7823fdffae6126c897f05d4c32fe8a0c60a23e3f`.

| Evidence item | Result |
| --- | --- |
| GitHub identity | **Observed**: the repository-authorized GitHub CLI session authenticated as `makerdan`. The Replit OAuth connector still returned HTTP 403 for this repository after one reauthorization attempt, so the CLI session was used for repository administration. |
| Repository access | **Observed**: the authorized session read the private `makerdan/Master-Reel-Counter` repository and reported admin, maintain, pull, push, and triage permissions. |
| Manual dispatch for `7823fdffae6126c897f05d4c32fe8a0c60a23e3f` | **Observed**: run [`34277195405`](https://github.com/makerdan/Master-Reel-Counter/actions/runs/34277195405) used event `workflow_dispatch`, attempt `1`, and exact `head_sha` `7823fdffae6126c897f05d4c32fe8a0c60a23e3f`. It completed with conclusion `failure`. A temporary branch pointing at the exact revision was required because GitHub's dispatch API accepts a branch or tag ref rather than a raw SHA; the branch was deleted after the run completed. |
| Manual-run failure | **Observed**: `Validate canonical contract` failed in `Create test database schema` because `npx drizzle-kit push --force` reported `drizzle-kit: not found` and exited `127`; subsequent validation steps were skipped. |
| Manual-run diagnostic artifact | **Observed**: the upload step completed successfully with `continue-on-error`, but warned that none of `ci-artifacts/`, `playwright-report/`, or `test-results/` existed. The run artifacts API returned `total_count: 0`, so no diagnostic artifact was available. |
| Pull-request event | **Unknown**: no revision-aware run, job conclusion, or diagnostic-artifact result was available. |
| `main` push event | **Observed**: run [`34277159329`](https://github.com/makerdan/Master-Reel-Counter/actions/runs/34277159329) used event `push` at merged `main` revision `56bbb4dd29a4bb4788dbb4a9b798d8f66eb26a54` and completed with conclusion `failure`. Its stable aggregate job failed and its artifacts API also returned `total_count: 0`. |
| `merge_group` event | **Unknown**: merge-queue enablement and a merge-group run could not be inspected. |
| Stable `Validation result` fail-closed behavior | **Observed for an upstream failure**: manual run `34277195405` passed `failure` from `Validate canonical contract` into the stable `Validation result` job, whose `Require the validation job to succeed` step failed as designed. Deliberately cancelled and skipped upstream jobs were not remotely exercised. |
| Branch policy | **Observed and unchanged**: GitHub reported `main` as unprotected. Repository rulesets are unavailable for this private repository on its current GitHub plan. `Validation result` must not be made merge-required from this failing evidence. |

This verification establishes that the workflow is active, manual dispatch
reaches the exact target revision, a `main` push creates a run, and the stable
`Validation result` job fails closed when its required job fails. It does not
establish a successful canonical validation run, diagnostic artifact creation,
pull-request delivery, merge-queue delivery, or cancelled/skipped upstream-job
behavior. Those gaps must be resolved and observed before changing merge
requirements.

## Manual activation and verification

After merging these files, an administrator must verify the following in
GitHub without treating this commit alone as proof:

1. Confirm the workflow appears under **Actions** and is enabled.
2. Run it manually for the exact revision under review.
3. Check a pull request, a direct `main` push, and (if enabled) a merge queue
   entry. Record the run IDs, revision, event, job conclusions, and artifact
   upload result.
4. Confirm the stable `Validation result` check is present and fails when the
   required job is cancelled or skipped.
5. Only then decide whether to add that stable check to branch protection or a
   ruleset. This task does not change those settings.

## Rollback

If the workflow causes an operational problem, disable or revert the workflow
file in GitHub using the repository's normal administrator process. A code
rollback should remove `.github/workflows/validation.yml`,
`scripts/__tests__/github-actions-workflow.test.mjs`, and this documentation
together. Do not weaken `npm run ci`, the heavy tier, the dependency-audit
threshold, or the local Failure Gate to make a remote run green.