---
name: Release schema fingerprint provenance
description: Why a reviewed production schema fingerprint must be derived through the same canonicalizer used during Publish builds.
---

When pinning a reviewed production schema version, pass its read-only metadata through the exact application fingerprint implementation. Do not hash SQL-ordered metadata or independently reproduce its sorting in a different environment.

**Why:** PostgreSQL's index-name collation can place uppercase names differently from JavaScript's locale-aware sort. A fingerprint generated from the otherwise unchanged production schema was pinned with the wrong ordering, so a Publish build correctly refused the transition even though the live schema had not drifted.

**How to apply:** Compare the read-only target's result and the isolated candidate using the release code's own fingerprint function, then verify the accepted transition with those captured metadata objects before asking the user to Publish. Keep schema data and credentials out of logs and committed fixtures unless the metadata fixture is intentionally reviewed.