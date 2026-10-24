# Detail-shot session isolation — delivery handoff

## Scope and admitted context

Security/data-integrity repair only: scope entry photo references and photo
parent references to the authorized session, and make parent-pin resolution
enforce the complete same-session relationship in its database update.
No new feature, UI, schema migration, or historical-data rewrite.

- Assigned work: Broken Access Control (native reference 985).
- Local plan: `28d4420c-0cbf-457c-90be-997a3585fab1`, revision 1.
- Sealed plan hash: `4352842147cb8bcedc1218e3923542bfd51decadfd212099d5db421875d3094a`.
- Unified contract: `cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`.
- Regression Guard contract:
  `1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
- Normal material-change declaration; no exceptions or deferrals.
- Pre-implementation `gate:guard -- --tier test-standard`: ADMITTED.
- No post-Start amendment or scope deviation.
- Baseline catalog inspected: no records; no ignored/owned baselines.

## Requirement map

All cases below are in `server/__tests__/routes.test.ts`, suite
**Detail-shot references — production session isolation**, using the real
registered HTTP handlers and storage implementation against an isolated
PostgreSQL schema. The seven cases all passed in the bound tier.

| Label | Recurrence / expected outcome | Actual guard and assertion | Outcome |
|---|---|---|---|
| R1 | Entry creation references another session's photo or a missing photo | “entry POST rejects foreign and missing photos before any writes” asserts identical generic 404 responses, unchanged entries and pins | Delivered, PASS |
| R2 | Malformed photo reference reaches persistence | “entry POST rejects malformed photo IDs without inserting entries” asserts 400 and unchanged entries | Delivered, PASS |
| R3 | Photo PATCH establishes a cross-session parent or leaks its location | “photo PATCH rejects foreign and missing parents without changing either session” asserts 404, unchanged photos/entries, and untouched victim pin | Delivered, PASS |
| R4 | Parent-pin helper is called with foreign detail/entry/parent or a mismatched entry-photo relationship | “resolver refuses foreign detail, foreign entry, and legacy foreign parent relationships” calls the real helper and entry route with adversarial relationships; asserts victim and unrelated local pins remain uncommitted | Delivered, PASS |
| R5 | Hardening breaks authorized links or unlinking | “same-session parent updates and explicit unlink still work”, “same-session entry creation resolves only the matching uncommitted parent pin”, and “entries with regular, null, or omitted photos remain supported” assert success, correct linkage, untouched unrelated pins, and no overwriting committed pins | Delivered, PASS |

The original implementation would fail R1 and R3 by accepting foreign IDs, and
R4 by updating the victim pin. R5 also detects a broken/non-executing SQL guard
instead of allowing every helper call to silently no-op.

## Validation and target

Bound tier: `test-standard`; workload source `docs/validation/manifest.json`.

```sh
TASK_ID=28d4420c-0cbf-457c-90be-997a3585fab1 \
TASK_PLAN_FILE=.local/tasks/28d4420c-0cbf-457c-90be-997a3585fab1.md \
npm run gate:run -- --tier test-standard
```

Observed result: **PASS**, exit 0. All eight steps passed: typecheck,
storage-lint, port-reference-scan, storage-lint-contract, unit-tests,
clerk-release-contract, vite-hmr-tests, and manifest-parity.

Run identity: `d8b1329c-2171-4e5c-90af-9bfb6abbd761`.
Detailed local evidence:
`.local/failure-gate-unified/runs/d8b1329c-2171-4e5c-90af-9bfb6abbd761.jsonl`.
Portable run summary is retained in `docs/validation/unified-registry.json`.
Tested source fingerprint:
`188a32ff6dfc996b06e8edae18609f59370b5f2d6a064b8baf5c888afe6d4085`.
This handoff was added after validation; no tested application/test source
changed afterward.

Restarted the development application successfully and confirmed the public
landing page renders. The screenshot browser was not signed in; authenticated
UI was not visually verified. Protected behavior was verified through the
authenticated production-route fixture, not an authentication bypass in the app.

Separate optional read-only verification: **not selected**. The platform's
task-completion checks remain separate from this executor handoff.
