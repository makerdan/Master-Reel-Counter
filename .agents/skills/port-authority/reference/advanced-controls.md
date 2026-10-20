# Optional advanced controls

Read only for explicitly selected advanced features or approved migration of an
actual dependent caller. All core safety/authority boundaries remain in force.
This module does not activate a feature, install Failure Gate or broaden approval.
The shared engine is retained to avoid rebuilding safety-critical lifecycle code;
advanced behaviors are off by default and do not have a second skill identity.

## Profile selection and per-control acceptance

Only a **leading** `--advanced` selects the advanced CLI profile:

```sh
node scripts/free-ports.mjs --advanced [--dry-run] [--ownership-manifest FILE] PORT...
node scripts/validation-lock.mjs --advanced [--resource NAME] [--priority 1-9] -- CMD...
```

It is configuration, never attestation or authorization. A command argument named
`--advanced` after `--` cannot enable features. Local engine metadata is cooperative,
not authentication against an editor who can change scripts.

Select each actual required feature independently: named locks, priorities, verified
reentry, an attested development exception, or live reclaim. Only the selected feature
and its real transitive dependencies require acceptance. A blocked reclaim provider
does not block unrelated permitted ordinary local leases or inert staging.

`ADVANCED_VERIFIED` covers only named advanced non-reclaim controls with actual
authorized host evidence. `LIVE_RECLAIM_ENABLED` additionally requires genuine
attestation, checked reclaim and acknowledged outcomes for exact callers/scope.
Neither fixture passes nor a copied adapter can establish these states.

## Named resources, priorities and reentry

One invocation holds one resource name. Names are lowercase alphanumeric/hyphen.
`global` and composite names are independent identities, not parents of other locks.
All conflicting commands must acquire the same canonical file or the actual overlapping
sets in one verified order. Same name/different file is not shared exclusion.
Publish the complete caller/resource conflict map, including aliases and pre/post hooks.

Priority is advisory, 1 highest through 9 lowest, default 5, with a two-second priority
grace and disposable waiter records. No fairness or execution deadline is guaranteed
by priority. Choose only values permitted by the governing limits/policy.

Verified reentry binds the canonical path/token, boot, owner incarnation and actual
ancestor lease chain. Nested wrappers use parent-token-specific sibling slots:
parallel siblings serialize, deeper sequential nesting may proceed. Parent and child
must not mutate the shared resource concurrently. Preserve the same resource identity,
environment lineage and lock order. PID-only, forged or incompatible context blocks.

Core's finite supervision, exact startup registration, retained exclusion and recovery
conditions still apply. Reentry never resets a parent budget or supplies task authority.
Prefer unwrapped inner commands where possible.

## Development-workspace exception

Hard `NODE_ENV=production` and `REPLIT_DEPLOYMENT=1` always block.
Only `REPLIT_ENVIRONMENT=production` may admit the explicit advanced exception.
Do not infer development from a domain, local record or remembered environment.

The real host must independently attest the current development workspace/root,
boot, domain and managed launcher, verify this is not deployment, and resolve fresh
unrevoked provider evidence through the code-owned adapter. Never spoof real flags.

`PORT_AUTHORITY_DEV_CONTEXT_FILE` must be an absolute, regular same-UID private file:
no symlink/hardlink or group/world write permission. Its version-1 fields are:
kind `replit-development-workspace`, current bootId, canonical cwd projectRoot, exact
devDomain, live same-UID ancestor supervisor `{pid,startTime}`, issuedAt, expiresAt,
verificationReference and attestationReference. Issue time is not future, expiry is
future and total lifetime at most 15 minutes. These fields locate evidence, not create it.

The helper validates binding before calling `attestRuntime`. Real attestation has
protocolVersion 1, attestationId, environment `development`, matching projectRoot/bootId
and fresh expiresAt. Verify identity/revocation/applicability at the actual provider.
Missing/unavailable or forged evidence blocks. Log admitted exceptions.

Recheck before queued dispatch and each cleanup signal batch. Expiry before escalation
prevents new signals; report partial outcomes and recovery need. Expiry after admitted
owned work starts does not disable its existing finite supervision and safe cleanup.

## Live reclaim and Failure Gate Unified compatibility

Live reclaim means signaling **pre-existing** listeners/wrappers, not cleaning up a
child admitted and owned by the current run. Failure Gate Unified does not provide
pre-existing-process reclaim authority. Never present installing Unified, passing its
validation or its owned-child cleanup as the missing reclaim authority.

For shipped advanced reclaim, independently discover an actually authorized checked
reclaim extension/provider and the genuine host attester. Use the project's verified,
authorized reclaim route and exact active contract; Unified task approval alone
does not supply this capability. Resolve actual policy/adoption/capability requirements
for the affected operation; otherwise reclaim stays BLOCKED.
Port Authority must not invent a substitute approval registry or auto-install one.
No ordinary Port Authority installation requires this extension. Missing reclaim
capability does not block independent Unified planning, read-only inventory or
validation without a reclaim dependency. Unified's owner-directed gate-repair route
does not authorize live reclaim or uncertain-lease deletion.

`scripts/host-capabilities.mjs` deliberately throws unavailable by default.
Implement its code-owned boundary only against verified protected sources under actual
authorization. No caller-controlled verifier paths, boolean approvals or fixture fallback.
The adapter's historical error name does not prove Failure Gate is installed.

Host owns attestation; the checked reclaim authority owns exact approval, claim,
revocation/replay/conflict protection and outcome storage; Port Authority owns discovery,
target protection, signaling and termination observations. Independent genuine sources
must back each role. A local JSON envelope never authenticates its own scope.

## Checked reclaim wire contract

Action requires:

```sh
node scripts/free-ports.mjs --advanced --authorized-cleanup \
  --ownership-manifest /actual/private/scope.json PORT...
```

Manifest v2 has actual bootId, future expiresAt, covered ports, exact unique
`processes:[{pid,startTime}]`, authorizationReference, runBinding with taskId,
approvedPlanBinding and runId, and optional explicit `allowOwnTree:true`.
Validate numeric members, same UID, current incarnation and approved descendants.
Never target caller ancestors, editors, platform supervisors or an unrelated listener.
Do not infer approved wrappers/descendants from ancestry alone. An unapproved live
descendant or changed listener blocks the action. Dry-run never signals.

Own-tree mode requires both manifest permission and `--include-own-tree`, only at an
audited boundary between serialized steps where legitimate services are not targets.
Action still verifies approved targets if the socket closed before invocation.

`attestRuntime({binding,developmentRecord,deadlineAt,abortSignal})` resolves actual
host evidence. `beginReclaim({operationId,operation,manifest,binding,requestedScope,
scopeDigest,attestation,deadlineAt,abortSignal})` resolves the genuine exact approval
and atomically claims one operation. Operation is `runtime.process-reclaim`.
Bind project/workspace, current boot, actual task/approved-plan/run, expiry/revocation,
targets/ports, own-tree permission, permitted signals and execution/cleanup budgets.
Reject replay and concurrently conflicting grants.

Requested scope is a fixed-order object: sorted/deduplicated ports, PID-sorted
`processes` with exact startTime, allowOwnTree, signals in `["SIGTERM","SIGKILL"]` order,
graceMs 3000 and killVerificationMs 5000. scopeDigest is SHA-256 of UTF-8 JSON.stringify
of that object. The provider compares with independently approved exact scope; hashing
caller data is not approval. Different approved escalation/limits need actual compatible
adaptation before use, not silent policy substitution.

The returned handle requires protocolVersion 1, authorizationId, matching operationId,
scopeDigest, attestationId, expiresAt no later than manifest expiry, matching runBinding,
and `checkBeforeSignal`/`recordOutcome`. Before each signal batch, revalidate live
authorization/revocation and attestation, durably journal intent and require exactly
true acknowledgement. TERM precedes grace then approved KILL of verified survivors.
Signal only unchanged exact targets. Discovery failures prohibit blind escalation.

Submit actual raw outcome, every signal outcome and binding through `recordOutcome`.
Require exactly true durable acknowledgement; local log output is not authoritative
storage or accepted validation. Capture a claimed operation's partial outcome even
after expiry/revocation, without granting new signals. FREE additionally requires
complete port and approved-target quiescence; failed cleanup is 1, invalid/prohibited 2,
protected busy/skipped 3 and unknown 4.

Adapter calls have a two-second deadline and abort signal; real implementations must
honor cancellation and not block the event loop. A timed-out claim/write might have
committed. Persist stable operation identity, retain exclusion and reconcile through
the actual authorized read/recovery route before retry or replacement. Keep raw success
distinct from failed/unknown evidence storage. No synthetic pass or replay.

## Advanced acceptance

Keep current original requirements and the enabled feature's positive/negative cases:
attestation forgery/binding/expiry; hard production precedence; reclaim absence/altered
scope/replay/concurrent conflicts; grant revocation/expiry before escalation; storage/
claim timeout and partial outcomes; wrong boot/start-time/UID/ancestor/descendant;
unreadable socket discovery; live exact target stops while unrelated fixture survives;
closed socket with surviving wrapper; resource exclusion; forged reentry and parallel
siblings; parent-wide budgets; dead owner, watchdog and uncertain recovery.

The hardened suite retains these isolated runtime regressions with private simulated
providers, plus the default-profile cases. Actual provider integration, current
app callers and two consecutive authorized host runs remain separate proof.
Never install test adapters, strip host flags or signal current services to finish a
checklist. Map each applicable claim to actual adapted code and authorized scope.
Missing selected capability blocks its dependent activation, not unrelated safe work.

Cut over only approved affected callers after actual stage-specific acceptance.
Preserve old lease-v2 records and recovery disposition; do not manufacture compatibility
or silently rewrite history. The advanced flag is an explicit caller migration change,
not retroactive approval or a second ordinary validation authority.
