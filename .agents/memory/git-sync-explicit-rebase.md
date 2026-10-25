---
name: Explicit rebase during Git synchronization
description: A Git sync action can replay already-merged history despite safe local pull defaults.
---

The workspace reflog has shown a sync action executing `pull --quiet --no-edit --rebase origin main` after a non-destructive merge already incorporated origin/main.

**Why:** Explicit rebasing replayed old documentation commits and produced conflicts even though the remote tip was already an ancestor of local HEAD. A later abort restored the intact local branch.

**How to apply:** Inspect current status and reflog before resolving a reported conflict. Do not assume an error means a rebase is still active. Prefer an explicit `git pull --ff-only` for the already-reconciled history; local pull defaults cannot override a caller's explicit `--rebase`. Diagnose push permissions separately.
