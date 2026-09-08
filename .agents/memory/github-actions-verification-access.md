---
name: GitHub Actions verification access
description: Distinguishes an authenticated GitHub connection from repository-scoped access needed to verify Actions runs.
---

An installed GitHub connection is not evidence that it can inspect or dispatch
workflows in the current private repository. Verify repository metadata access
before attempting to claim run IDs, event delivery, job conclusions, artifacts,
or branch-policy state.

**Why:** A healthy connection can authenticate as the expected user while
repository-scoped GitHub endpoints return HTTP 403 because the repository is
not granted to that connection.

**How to apply:** Record the exact repository, revision, endpoint result, and
unverified evidence categories. Do not treat `/user` success, workflow files,
or local contract tests as proof of remote activation or merge protection.