# Browser validation PostgreSQL boundary

## Scope and admission

The browser runner's temporary-database setup and teardown use finite connection
(15 seconds), query (30 seconds), and shutdown (5 seconds) deadlines. Expiry
destroys the client transport, not just the waiting promise. PostgreSQL also
receives a statement timeout. The runner retains its generated database name
before creation so an uncertain CREATE result still gets a cleanup attempt.
Externally supplied isolated databases remain caller-owned.

Admitted plan: `d3f849a7-0691-4ca8-bf2e-6b3b2a81a024`, revision 1.
Plan hash: `93d4662d80b9417e44fcaeddf5bfebbfbff2c5c5ca8676cec117a3d8a52684a5`.
Regression Guard contract:
`1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
Classification: material reliability and cleanup lifecycle repair; normal guard.
Pre-implementation `gate:guard -- --tier test-heavy` returned ADMITTED.
No separate verifier was selected.

## Requirement-to-delivery handoff

| Requirement | Delivered guard | Evidence and disposition |
|---|---|---|
| Bound connect, create, terminate, drop and shutdown | `scripts/__tests__/github-actions-empty-database.test.mjs`: “browser database boundary bounds real PostgreSQL startup, create, terminate, drop and shutdown stalls” | Local TCP PostgreSQL protocol fixture withholds each response in turn; assertions check rejection within two seconds using short test deadlines, query reachability, and destroyed client transports. The normal path exercises create, terminate and drop successfully. |
| Preserve primary failures and report shutdown failures | Same file: “browser database cleanup preserves the primary error and force-closes an unresponsive shutdown” | Injected never-resolving `end()` preserves original error identity/message, exposes cleanup errors, destroys transport, and returns within 500ms. Runner retains separate validation and cleanup reporting and its original nonzero command status. |
| Preserve process-group cleanup safety | Existing `scripts/__tests__/browser-validation-lifecycle.test.mjs` | Runner still refuses database removal unless its owned process group is confirmed stopped. |

Focused diagnostic run `1e7cb499-f5cc-44e9-85fc-b641bb3e6925` executed all eight
selected cases successfully. The diagnostic is explicitly INCOMPLETE for full-tier
acceptance; it is not a substitute for the required tier.

The bound workload is `docs/validation/manifest.json` → `test-heavy`, including
`startup-smoke-boundaries`, existing lifecycle unit checks, and `browser-tests`.
Supported full invocation:

```sh
TASK_ID=d3f849a7-0691-4ca8-bf2e-6b3b2a81a024 \
TASK_PLAN_FILE=.local/tasks/d3f849a7-0691-4ca8-bf2e-6b3b2a81a024.md \
npm run gate:run -- --tier test-heavy
```

Full results, target fingerprints, step outcomes, and any diagnostics are retained
by the existing gate in the task's append-only registry and local run evidence.
Completion must report their actual outcome, not infer PASS from focused tests.

### Observed execution

- Full tier run `2511db20-2723-42b0-89bf-84eda70cb106`: startup PASS;
  database-boundary suite 35 passed, one CI-only skip, zero failures.
  Tier **FAIL** at `security-audit`: `npm audit --audit-level=high` reported
  nine vulnerabilities (five moderate, four high). Later steps, including the
  full browser suite, were not reached.
- Dependency manifests and lockfile match the starting HEAD; this task made no
  package changes. Classification record `fd63461f-dd1f-47a6-a8c1-ddf531ac3843`
  records the evidence-based pre-existing classification. There is no ignored
  baseline addition, passing-tier claim, or audit waiver. The supported diagnostic
  route accepts test-kind steps only, so it cannot isolate the audit step.
- Lifecycle diagnostic `2f68591e-9905-428b-a9ca-da5f384c8c1d`: all six cases
  passed, including process-group cleanup and compiler-gated database wrapping.
- Existing release static contract assertions initially expected inline SQL in
  the runner. They now follow its explicit helper import, retain CREATE/DROP
  assertions at the actual boundary, and verify isolation and retained ownership
  precede creation. Release contract diagnostic
  `b70db369-c9f4-4894-82ba-19997d4923a9` passed its selected file. This is an
  in-scope test adaptation, not a changed plan or relaxed isolation rule.
- `gate:merge-guard` returned READY. The unchanged public landing page rendered
  in the preview. Signed-in UI was not verified; this task changes no UI.

## Owner-approved gate maintenance

Admission initially failed with `git prerequisite failed: show`. The committed
registry was 4,701,851 bytes, exceeding the gate's 4,000,000-byte Git output limit.
The owner explicitly approved fixing that limit and continuing this task.
The allowance is now 32,000,000 bytes; the existing three-second Git deadline,
registry preservation checks, bindings and records are unchanged.
During synchronization, main also supplied immutable-object registry sizing.
Both are retained: generic Git reads use the larger default while registry
reads resolve a fixed blob and supply their own size-based allowance. Registry
history was regenerated as an append-only union without dropping either
branch's task identities, events or tombstones. Incoming dependency repairs were
also preserved; the earlier audit failure above describes the pre-sync target,
not the subsequently repaired dependency graph. New run records identify the
combined target and its actual validation outcome.

Post-sync maintenance verification passed all 32 gate tests. Bound-tier run
`e11a90ae-fdb4-465a-805b-9ef8106643c0` again passed startup and the complete
database-boundary suite, then failed `security-audit` on four remaining high
findings (`body-parser`, `multer`, and `zod`/`zod-validation-error`). The moderate
findings were resolved by the incoming dependency work; the full tier still did
not reach later checks. This remains FAIL, not a waived or passing tier.

The maintenance regression test commits a disposable registry-sized file above
the old limit and asserts a complete read through the actual gate Git helper.
Bounded maintenance check:
`timeout -k 3s 80s node --test --test-timeout=40000 scripts/__tests__/unified-gate.test.mjs`
passed 31 tests, zero failures. This is maintenance evidence, not a tier PASS.
