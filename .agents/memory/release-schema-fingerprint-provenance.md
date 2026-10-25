---
name: Release schema fingerprint provenance
description: Why a reviewed production schema fingerprint must be derived through the same canonicalizer used during Publish builds.
---

When pinning a reviewed production schema version, pass its read-only metadata through the exact application fingerprint implementation. Do not hash SQL-ordered metadata or independently reproduce its sorting in a different environment.

**Why:** PostgreSQL's index-name collation can place uppercase names differently from JavaScript's locale-aware sort. A fingerprint generated from the otherwise unchanged production schema was pinned with the wrong ordering, so a Publish build correctly refused the transition even though the live schema had not drifted.

**How to apply:** Compare the read-only target's result and the isolated candidate using the release code's own fingerprint function, then verify the accepted transition with those captured metadata objects before asking the user to Publish. Keep schema data and credentials out of logs and committed fixtures unless the metadata fixture is intentionally reviewed.

A production metadata read must not require publishing the pending repair first.
An authenticated read-only database query can establish the legacy endpoint before
the candidate is published. If the query reports missing authentication, distinguish
that access failure from a need to deploy; retry when the user resumes the session
before imposing publication as a prerequisite.

**Why:** A refused production query succeeded in the resumed session without any
publish, and the read-only canonical digest confirmed the existing legacy pin.
Requiring a publish first would make a pre-publication schema repair circular.

**How to apply:** Use the supported production read-only query route, preserve
the exact-pair runtime check, and report actual access failures without claiming
that publication is needed to resolve them.