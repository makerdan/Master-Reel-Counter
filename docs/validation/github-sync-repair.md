# Original-workspace Git sync repair

## Scope and admission

Owner authorized direct execution of the attached Restore GitHub Repository Sync
scope in the original workspace, rather than creating another native task.
Local sealed plan: `.local/tasks/9bd0f3b0-17d6-4a93-b4d9-47f0365fc20c.md`,
revision 1, full contract
`5ea3dd706f5b8ab94ab7d9a2ce95365ed678d8acccb7f64cc7b78e178bd0323b`.
Pre-implementation guard: ADMITTED. Assigned tier: `test-fast`.
Regression classification: excluded internal workspace maintenance; no executable
application behavior or automated synchronization tooling changed.
Independent review: not selected.

## Delivery and evidence (2026-10-25)

| Requirement | Observed result |
| --- | --- |
| Preserve local history | Original local tip `2788888275c2df05a82e323f6438d791e15a808c` is an ancestor of the merge and retained at `backup/github-sync-20261025`. |
| Preserve remote history | Original GitHub tip `110e17071b32620f5e9555332f6020ef75188514`, including all four remote-only commits, is an ancestor of merge `3b2530d1eb0b4c47d511ec4af269157487281706`. |
| Resolve documentation conflicts | Current README and current CI guidance retained. Exact incoming documents preserved under `archive/github-sync-20261025/`, explicitly historical. No application code, tests or workflows changed. |
| Restore intended tracking | Configured origin as `https://github.com/makerdan/Master-Reel-Counter`; main now tracks origin/main. Existing internal remotes retained. Replit's existing URL rewrite uses its secure GitHub proxy. |
| Commit mechanics | Normal main commits passed existing hooks. Detached temporary-worktree empty commit also passed with hooks enabled after linking the existing node_modules; first probe failed because the fresh worktree lacked better-sqlite3. Probe was never added to main, and temporary worktree/link were removed. |
| Pull | `git pull --ff-only` succeeded: Already up to date. |
| Push | Normal `git push` rejected by GitHub OAuth workflow-scope permission. No force push, hook bypass, workflow removal or credential replacement attempted. |
| Application preservation | `git diff --exit-code` against original local tip passed for client, server, shared, tests, scripts, .github, package.json and package-lock.json. |

Bound command:

```sh
TASK_ID=9bd0f3b0-17d6-4a93-b4d9-47f0365fc20c \
TASK_PLAN_FILE=.local/tasks/9bd0f3b0-17d6-4a93-b4d9-47f0365fc20c.md \
npm run gate:run -- --tier test-fast
```

Result: **PASS**, all three steps, 48.892 seconds. Typechecking, storage lint and
16 storage-contract tests passed. Run ID `d8963a97-00cc-47e4-8fe8-22064e72a246`;
target `3b2530d1eb0b4c47d511ec4af269157487281706`. Subsequent changes record
validation and this report only; checked application inputs remain unchanged.
The gate registry preserves the run. Local detailed evidence:
`.local/failure-gate-unified/runs/d8963a97-00cc-47e4-8fe8-22064e72a246.jsonl`.
Gate merge/history preservation checks passed on commits.

## Remaining blocker

Overall task outcome: **BLOCKED**, not full task PASS. Exact sanitized rejection:

```text
! [remote rejected] main -> main (refusing to allow an OAuth App to create or update workflow `.github/workflows/managed-clerk-release.yml` without `workflow` scope)
```

The workflow change already exists in the local history being synchronized; this
repair did not edit it. The authorized GitHub connection needs workflow scope
before the normal push can succeed. Do not remove the workflow or rewrite history
to evade the permission requirement. After authorization is corrected, retry the
normal push and compare advertised GitHub main with local HEAD.

No Git-panel error was supplied or reproduced; shell rejection is the observed
blocker. No native task status was changed.

## Safe recovery

No published history was rewritten. GitHub rejected the ref update. The local
backup branch retains the original code snapshot, and both histories remain
reachable from the merge. Inspect that branch in a separate worktree if recovery
is needed; do not hard-reset or force-push. The original tracking configuration
was `subrepl-004mc1xg/main`; it can be restored explicitly if the owner requests
configuration rollback, without deleting internal remotes or commits.
`.git/config.before-github-sync-20261025` is a local configuration snapshot taken
after adding origin but before changing main's upstream.
