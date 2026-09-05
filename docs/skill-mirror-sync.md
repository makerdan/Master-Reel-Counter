# Skill Mirror Sync operator guide

Skill Mirror Sync keeps workspace-managed skills usable without making private
workspace content part of the repository. The data flow is one way:

`WORKSPACE_SKILLS_SOURCE` → generated project projection → platform runtime mirror

The workspace source is authoritative. `.agents/skills/` remains the home for
workspace-authored skills, while generated source content is confined to
`.agents/skills/.workspace-projections/`. The disposable `.local/custom_skills`
tree is platform-owned and is never repaired by repository commands.

## Setup

Set `WORKSPACE_SKILLS_SOURCE` explicitly in the invoking environment. It must be
a readable directory containing a non-empty `.workspace-revision` and one or
more lowercase hyphenated skill directories. Every skill directory must
contain `SKILL.md`; all nested files must be regular files. Symlinks, special
files, unexpected source entries, and unsafe paths are rejected.

Do not commit the source, generated projection, mirror contents, sidecars, or
private workspace instructions. The projection directory and its refresh lock
are ignored by git.

## Commands

```sh
npm run workspace-skill:refresh
npm run workspace-skill:validate
npm run workspace-skill:audit -- --json
npm run workspace-skill:load -- --skill example-skill
npm run workspace-skill:status -- --skill example-skill
```

Refresh discovers every source skill, computes a deterministic SHA-256
manifest, validates a complete staging tree, checks that the source did not
change, and atomically installs the projection. It uses an ownership-aware
lock and cleans only its own staging/backup names. A live lock is reported as
busy; a structured dead owner or an unstructured lock older than the bounded
stale timeout may be reclaimed atomically.

Validate and audit are read-only projection checks. Load validates both the
current source and projection before returning supported projection content;
it never falls back to an older projection when the source is unavailable.
Use `--skill` more than once to load or validate a selected set, or omit it
for all currently discovered skills.

Status reads the canonical source and the platform-owned
`.workspace-skill-metadata.json` sidecar without writing anything. Exit codes:

| Code | Outcome | Meaning |
| ---: | --- | --- |
| 0 | `pass` | Exact identity, revision, and fingerprint match |
| 1 | `mismatch` | Sidecar is invalid or differs |
| 2 | `unavailable-source` | Source or workspace revision is unavailable |
| 3 | `missing-mirror` | Platform sidecar is absent |

Status does not print source paths, sidecar values, skill bodies, secrets, or
private instructions.

## Diagnostics and ownership

Reports should identify the skill, environment, validation surface, and
bounded outcome. Opaque revisions and SHA-256 fingerprints may be included
when an external reporting system requires them, but never fabricate them.

* Wrong workspace content, revision, or publication: workspace skill owner.
* Missing or stale runtime mirror after a supported refresh:
  workspace provisioning or sync owner.
* Missing canonical source or validation metadata: workspace owner.
* Projection code, boundary, or contract failure: repository maintainer.

Hand-editing `.local/custom_skills`, reverse-promoting mirror files, writing a
sidecar, copying directly from source to runtime, comparing timestamps, or
using MD5 is not remediation.

## Growth and recovery

The manifest is a complete recursive inventory, so adding skills or nested
support files needs no code change. An interrupted refresh leaves only
ownership-named artifacts; the next supported refresh cleans those artifacts
under the lock. Do not merge staging contents or manually rescue a partial
projection. If source validation is unavailable, preserve the fail-closed
state and escalate to the workspace owner.