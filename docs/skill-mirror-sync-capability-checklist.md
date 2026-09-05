# Skill Mirror Sync capability checklist

Evidence uses the focused contract suite
`npm run test:account-skill` unless another command is shown.

| Requirement | Status | Evidence or boundary |
|---|---|---|
| Canonical tracked skill contract | implemented | `.agents/skills/skill-mirror-sync/SKILL.md` |
| Explicit source only; no fallback | verified | Source-resolution contract tests |
| Opaque non-empty account revision | verified | Source and revision failure tests |
| Deterministic immediate skill discovery | verified | Multi-skill and ordering tests |
| Lowercase slug and `SKILL.md` checks | verified | Invalid slug/entry tests |
| Recursive regular-file inventory | verified | Nested support-file parity tests |
| Symlink and special-file rejection | verified | Unsafe entry tests |
| Deterministic SHA-256 fingerprint | verified | Manifest and mutation tests |
| Exact projection manifest and byte parity | verified | Missing/extra/changed byte tests |
| Serialized ownership-aware refresh lock | verified | Live, dead, race, and busy lock tests |
| Safe abandoned-lock recovery | verified | Structured dead and stale unstructured lock tests |
| Owned staging/backup cleanup | verified | Interrupted-refresh cleanup tests |
| Complete staged validation | verified | Malformed staging and manifest tests |
| Source-change detection | verified | Source mutation during refresh test |
| Guarded atomic install and rollback | implemented | Rename/rollback implementation; environment-safe rollback path |
| Post-install validation and fail-closed load | verified | Stale projection and load tests |
| Single- and multi-skill command growth | verified | Multi-skill command tests |
| Read-only mirror status | verified | Snapshot comparison before/after status tests |
| Status `pass` exit 0 | verified | Status exit-code tests |
| Status `mismatch` exit 1 | verified | Status exit-code tests |
| Status `unavailable-source` exit 2 | verified | Status exit-code tests |
| Status `missing-mirror` exit 3 | verified | Status exit-code tests |
| Bounded redacted reporting | verified | CLI output redaction tests |
| Platform mirror/sidecar provisioning | unsupported | Platform-owned and explicitly out of repository scope |
| Account source publication | unsupported | Account/platform-owned and explicitly out of repository scope |
| Private account content in tracked files | verified | Ignore rules and repository-boundary tests |
| Editing or promoting `.local/custom_skills` | unsupported | Prohibited platform boundary; helper has no write path |
| Direct source-to-runtime copy | unsupported | Prohibited shortcut; projection is mandatory |
| Timestamp/MD5 authority | verified | SHA-256 and opaque revision implementation |