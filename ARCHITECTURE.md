# Master Reel Counter Architecture

Production-focused reference for developers, maintainers, and reviewers of the warehouse wire-reel inventory system.

## Five deployment/infrastructure assumptions and uncertainties

1. **Configured, not live-attested:** `.replit` selects Replit Autoscale and Node.js 20 tooling. TODO: Which production project, hostname, runtime version, region, replica limits, and deployed revision are authoritative?
2. **External persistence:** Code requires PostgreSQL and Replit Object Storage; the workspace PostgreSQL 16 module does not establish production's provider/version. TODO: Which production database provider/version and storage policies apply?
3. **No dedicated worker:** Maintenance runs inside web processes. Autoscale can become idle; no Always-On or scheduled-worker guarantee is established. TODO: What maintenance execution guarantees are required?
4. **Recovery unspecified:** No verified backup retention, restore target, RPO/RTO, or deployment rollback mechanism is recorded. TODO: Who approves recovery, and which provider procedures are tested?
5. **Operational governance unknown:** No staging environment, SLA, compliance certification, criticality classification, or verified operator roster is established. TODO: What requirements and accountable roles apply?

Source and release guidance supersede stale README references to Replit Auth, tester login and OpenAI scanning/chat.

## At-a-glance architecture

```text
 Browser: React/Vite PWA
 [Query cache | IndexedDB offline queues | local/session storage]
       | HTTPS REST, SSE help chat, WSS /ws
       v
 Replit published ingress/TLS (actual settings: TODO)
       |
       v
 One Node/Express web deployment
 [static SPA | REST | Clerk proxy | WS rooms | PDF jobs]
 [in-process caches, limits, maintenance timers, task tracker]
       | SQL/Drizzle     | object SDK       | provider APIs
       v                 v                  +--> Poe: scanning/help
 PostgreSQL         Replit Object Storage   +--> Replit AI: audio/image
       ^
 local accounts, approval, roles/capabilities

 Browser <--> Clerk SDK / same-origin production proxy <--> Clerk
 Release build --> isolated candidate + temporary DB + browser smoke
 Published verifier --> live URL (read-only; no DB/Clerk secret)
```

Express stores inventory/photo metadata referencing durable objects. WebSockets distribute events within one process, not between replicas. Offline replay requires verified identity.

## System overview and component inventory

| Component | Responsibility / source |
|---|---|
| Web/PWA | React 18, Vite 7, wouter, TanStack Query, capture/annotation, review, statistics, exports; [client](client/src/App.tsx). |
| API/BFF | Express 5 REST, SSE help, static delivery and `/ws`; [bootstrap](server/index.ts), [routes](server/routes.ts). |
| Auth | Clerk identity; PostgreSQL approval, `Admin`/`User` roles, capabilities, owner restrictions and session owner/editor/viewer access. Historical `replit_integrations/auth` naming does not mean active Replit OIDC. |
| Database | `pg.Pool` + Drizzle; [connection](server/db.ts), [inventory schema](shared/schema.ts), [accounts](shared/models/auth.ts). |
| Objects | Photos/avatars via Google Cloud Storage SDK and Replit credential sidecar; [storage adapter](server/replit_integrations/object_storage/objectStorage.ts). Local files are fallback/cache, not backups. |
| AI | [Poe boundary](server/providers/poe.ts) for label vision/help text; separate Replit AI audio/image modules. No automatic provider fallback is implemented in Poe. |
| Background work/cache | Web-process PDF generation, heartbeat/pruning, trash/upload cleanup, provider/profile caches, task/crash tracking; no broker, Redis, search service, independent cron or worker deployment identified. |
| Design sandbox | Separate Vite component-preview artifact, not the production inventory frontend; see deployment map. |

## Runtime and deployment boundaries

This full-stack monolith plus design sandbox uses one HTTP listener for same-origin auth and static delivery. Splitting adds distributed-state and authorization obligations.

| Unit | Configured runtime / entrypoint | Environment and behavior |
|---|---|---|
| Production web | Node.js 20 tooling in [.replit](.replit); build `npm run release:build`; run `node ./dist/index.cjs` | Core, storage and selected AI variables below. Binds `0.0.0.0:$PORT`; workspace maps 5000 to external 80. Autoscale configured; actual runtime/Always-On/replicas unverified. |
| Development web | Same Node toolchain; `npm run dev` → `scripts/dev-supervisor.mjs` | Core development variables; Express embeds Vite/HMR. Not a separate production frontend server. |
| Release candidate | Compiled production Node artifact + temporary HTTPS proxy + Playwright, launched by [release script](scripts/build-and-verify-release.sh) | Publishing `DATABASE_URL`, isolated smoke database, Clerk keys, `SESSION_SECRET`, storage configuration; release variables below. Transient build-time processes, not customer-facing workers. |
| CI validation / published verifier | GitHub-configured Ubuntu 24.04, Node 20; validation uses PostgreSQL 16 service | `npm run ci`; separate `npm run verify:managed-clerk-published`. Synthetic validation environment or read-only production target respectively; neither deploys the app. Activation/required checks not attested. |
| Mockup Sandbox | Workspace Node/Vite; `cd artifacts/mockup-sandbox && npm run dev` | `PORT`, `BASE_PATH`; preview `/__mockup/`. Build/serve scripts exist; no production deployment or persistence established. |
| External services | PostgreSQL, Clerk, Object Storage, Poe, Replit AI | Provider-managed entrypoints, not repository processes. Exact hosts/versions, availability contracts and operators remain TODO; names only, no credentials/identifiers recorded here. |

Other workspace ports/Python tooling do not prove additional production services. Assets live in `dist/public`; esbuild emits `dist/index.cjs`, leaving some dependencies external. Filesystem durability across publishes/replacements is not assured.

## Data model, persistence and migrations

PostgreSQL holds accounts/settings, folders/counting sessions, photos, pins/entries, collaborators/invites, comments/activity/reviews, scan results/dismissals/catalogs, feedback, conversations/messages, AI usage and support analytics. Transactions, foreign keys, unique constraints and selected advisory/optimistic locks protect particular operations; they are not universal distributed coordination.

Object Storage holds binaries separately from relational metadata. Upload intents track objects awaiting photo registration; blob deletion and SQL changes are not one atomic transaction. Recovery must reconcile both stores and shared object references. Trash expires after 30 days; this is deletion behavior, **not a backup policy**.

Transient state includes process-local rooms, PDF buffers/job IDs, authorization/provider/profile caches and limits. `.crash_log.json` is best-effort local history only. In browsers, Query cache supports temporary offline viewing; IndexedDB persists queued photos/entries with claims/retries and identity reconciliation; scoped local/session storage stores preferences/drafts/help state. Service-worker registration is production-only. Browser storage can be evicted and is not an inventory backup.

[Drizzle configuration](drizzle.config.ts) points at `shared/schema.ts` and `migrations/`. Development post-merge setup installs packages and invokes a guarded `npm run db:push`; unresolved interactive choices fail rather than silently confirm migration.

**Production boundary:** Review/apply development-to-production schema differences through Publish. Never run `db:push`, startup DDL, or custom migration scripts against production. [Release database guidance](docs/release-database-migration.md) defines reviewed migrations and read-only schema comparison. The candidate harness does not repair publication data.

TODO: What backups, retention, encryption-at-rest, restore testing and cross-store recovery consistency are actually provided?

## Communication, authentication and contracts

Browser calls use same-origin REST `/api/*`, SSE for help responses, and authenticated `/ws` collaboration. Shared TypeScript/Drizzle/Zod schemas validate selected inputs; no comprehensive OpenAPI/versioned API or external compatibility policy was identified. Coordinate client/server contract changes and service-worker cache upgrades; do not assume an old offline client immediately updates.

Clerk SDK cookies identify users; the production same-origin proxy is `/api/__clerk`. The bridge maps Clerk identities to persisted local accounts, retaining verified migrated aliases. New sign-ups remain pending approval. Server approval/capability middleware, resource ownership/collaboration roles and owner-only admin restrictions are separate checks; client visibility grants nothing. WebSocket authentication, join authorization and revalidation must survive revocation; see [realtime authorization](server/realtime-authorization.ts).

Poe allows only code-owned `Gemini-3.1-Pro` and `Claude-Sonnet-4.5`, with live capability checks/configured capability metadata; scanning requires vision/structured-output support. Requests have 15-second attempt deadlines, up to two retries, four in-flight slots and a five-minute model cache per process. Failures are explicit, not routed automatically to OpenAI. [Approved models](server/providers/approved-models.ts) separately constrain Replit AI audio/transcription/image calls. Images, audio and chat content can leave the application through these providers.

## Development and CI/CD workflow

Use an isolated development database and configured development services:

```sh
npm ci
npm run dev
```

For an explicitly reviewed **development** target only:

```sh
npm run db:push
```

No general production seeding command is recommended. [Testing](docs/testing.md) and the [tier manifest](docs/validation/manifest.json) define workload coverage. Assigned tasks use provisioned `TASK_ID`/`TASK_PLAN_FILE`, sealed plans, `gate:guard`, then their one bound `gate:run` tier; standalone tier aliases are not task admission.

[Canonical CI](.github/workflows/validation.yml) configures PR/main/merge-group/manual triggers, frozen install, synthetic PostgreSQL schema/owner, Chromium/WebKit and `npm run ci` → heavy validation, with aggregate result and diagnostic artifacts. This is repository intent, not evidence of an active remote check, successful run or branch protection.

`release:build` selects an isolated database before compilation: an owned temporary database or explicit `RELEASE_SMOKE_DATABASE_URL`. The database must differ on the same PostgreSQL endpoint; aliases/search paths do not prove isolation. Automatic mode needs database lifecycle privileges. Explicit targets are never silently replaced or dropped.

The release compiles the candidate, compares publication schema read-only, runs the exact artifact under the canonical HTTPS origin with disposable local/Clerk identities, and checks auth/roles/navigation/sign-out. Children stop before owned-database cleanup; setup, schema drift or cleanup errors block release.

The [manual published workflow](.github/workflows/managed-clerk-release.yml) is trusted-main, read-only anonymous authorization/proxy/Google visibility checking, without database or Clerk secret access. It does not repeat writable candidate coverage. TODO: Is staging used, who approves promotion, and which current checks are required? No staging deploy command is established.

## Observability and monitoring

Express logs API method/path/status/duration and request IDs to stdout; other subsystems use console diagnostics. Task/crash summaries and database-backed activity, AI usage and page-view data exist; owner/admin surfaces expose privileged diagnostics, not public telemetry.

`GET /api/healthz` performs `SELECT 1`, returning 503 on failure; `/api/health` includes bounded task/crash summary. Neither proves storage, Clerk or AI health. Release build identity helps distinguish artifacts.

Find development logs in the application workflow; production build/runtime logs in Replit Publishing; CI diagnostics in workflow artifacts (configured seven-day validation retention, three-day published failure retention). Retention is configured intent. No central log aggregator, Sentry, distributed tracing, alert destination or alert-response guarantee is established. TODO: Who monitors failures, where, and for how long? Logs can contain business details; redact before sharing.

## Reliability and scaling

- Autoscale can scale to zero: timers run only while a process lives. Startup cleanup begins after 30 seconds, then hourly; trash and expired upload-intent cleanup are best-effort, not guaranteed schedules. Intent grace defaults to 24 hours.
- Horizontal replicas do not share WS rooms/revocations, PDF job buffers/status, limits or caches. Requests landing elsewhere can miss jobs/events; restarts lose them. Local locks do not establish multi-replica safety. Resolve these boundaries before relying on horizontal growth.
- CPU/memory-heavy image conversion, PDF/Excel generation and large result sets compete with API traffic. Pagination, route-specific rate limits, bounded scan resources and provider backpressure help, but are not a global resource budget.
- Each replica has a PostgreSQL pool. Aggregate connections and expensive queries constrain scale; measure before increasing replicas/compute.
- SIGTERM/fatal-error handling attempts a 30-second drain, then bounded termination; unhandled rejections are recorded but nonfatal. Do not assume deployment orchestration waits for every task.

Failure responses: database failure → check connectivity/provider, not schema mutation; storage failure → preserve intents/retry evidence; Clerk failure → inspect proxy/environment alignment, never bypass auth; AI failure → retry within limits or use manual entry; lost PDF job → regenerate; stale collaboration → reconnect/refetch authoritative REST data. TODO: Which observed incidents, capacity thresholds and user-critical versus experimental paths should be recorded?

## Security and secrets

Keep server secrets in deployment-scoped Replit Secrets or the approved secret manager; never expose them through `VITE_*`. Only intentionally public frontend configuration belongs there. Confirm production scope separately from development.

Helmet/CSP is configured in [security headers](server/contentSecurityPolicy.ts); production disallows development script-evaluation allowances but retains broad network/frame sources. Same-origin architecture avoids a general cross-origin API requirement; review explicit origins before enabling CORS. Ingress TLS terminates outside Node; verify custom-domain certificate handling operationally.

Optional entry-field AES-256-GCM encryption wraps keys using material derived from `SESSION_SECRET` (minimum 32 characters). It is not end-to-end encryption or encryption of every record/object. Losing/changing that secret can make existing encrypted data unreadable.

Use least-privilege runtime credentials; release database creation/drop privileges are additional build-time needs, not a blanket runtime recommendation. TODO: What service-account permissions, data residency/retention, compliance requirements and approved rotation intervals apply?

## Operational runbooks

These are operator procedures, **not authorization to act**. None were executed for this document. Obtain incident/change approval; never paste credential-bearing commands into shared logs.

### Database outage and restore

1. Record incident time, deployed build and symptoms. Obtain the verified production origin through Publishing; set `PRODUCTION_BASE_URL` in an approved operator environment.
2. Check application/database availability without mutation:
   ```sh
   curl --fail --silent --show-error "$PRODUCTION_BASE_URL/api/healthz"
   curl --fail --silent --show-error "$PRODUCTION_BASE_URL/api/health"
   ```
3. Inspect provider status, connection limits and configuration presence without printing values. Do not treat every 503 as schema drift or immediately restore data.
4. If restoration is necessary, first establish an approved write freeze covering web replicas, background deletion and reconnecting offline clients. Preserve evidence and current recoverable state.
5. **TODO BLOCKER:** Confirm provider, backup/PITR availability, recovery timestamp, isolated restore destination, approved restore command/UI procedure and operator. No provider-specific restore command is verified here. Do not improvise `psql` imports or restore over publication data.
6. Restore to an isolated destination using that approved procedure; compare schema/data read-only, sample photo references against restored objects and confirm encrypted entries remain readable. Obtain acceptance before any approved cutover. Reconcile offline retries before reopening writes.
7. Recheck health and permitted user flows; observe errors/connection counts. Any schema change still follows Publish review, not “migrate to latest” during recovery.

### Deployment rollback

1. Record current/last-known-good code and build identities, configuration differences, and schema compatibility:
   ```sh
   git log -n 10 --oneline
   git show --stat <last-known-good-commit>
   ```
2. **TODO BLOCKER:** Confirm the actual production rollback UI/command, retained artifact availability and approving operator. A workspace checkpoint rollback is not proof that published code, PostgreSQL and objects roll back together.
3. Prefer an approved known-good artifact only after confirming compatibility with current schema and key material. If rebuilding old source, use a separate recovery checkout and the normal `npm run release:build` candidate gate; it writes isolated fixtures and requires approval/credentials. It is not itself a production rollback command.
4. Perform only the separately approved deployment action. Never automatically reverse database migrations or rotate secrets as part of code rollback.
5. Check health/build identity; run `npm run verify:managed-clerk-published` only in the documented read-only verifier environment, without database/Clerk secret inputs. Authenticated acceptance needs its own approved procedure.

### Process/background work and queues

Use the deployment's approved restart controls (TODO: exact operator procedure); restarting a workspace workflow is not a production restart. Drain when supported, then verify health. Expect lost PDF jobs/presence and regenerate/reconnect. Inspect persistent upload intents before retrying cleanup; admin purge/sweep endpoints are destructive, not generic recovery checks. Offline queues live on user devices: do not clear IndexedDB, intents or browser state blindly. No separate worker/central queue exists to restart or flush.

### Add/rotate configuration

Identify consumers, build-time versus runtime scope and recovery requirements. Store changes through approved secret management, coordinate provider overlap, rebuild public frontend configuration when needed, and validate an isolated candidate before approved promotion/revocation. **Do not rotate `SESSION_SECRET` without an encrypted-data key migration/recovery plan.** TODO: Confirm responsible roles, rotation cadence and retained-key policy.

## Cost drivers

Drivers are Autoscale compute/requests and sustained connections, PostgreSQL compute/storage/connections, objects/transfer, photo duplication/export processing, Clerk usage, Poe tokens/images, Replit AI audio/image calls and CI/browser minutes. No account prices or budgets are verified. Measure usage, resize/compress photos appropriately, bound AI concurrency and avoid repeated exports before buying capacity. Never reduce backup retention or clear customer data solely for savings without policy approval.

## Migration and refactor guidance

Extract incrementally: keep `client/` plus same-origin API routing; move export processing from `server/routes.ts` into a prospective `worker/` with durable job records/object outputs; replace room-local broadcasts with shared pub/sub and cross-replica revocation; externalize rate limits/coordination before replicas. These are recommendations, not existing services.

Map workers to scoped `DATABASE_URL`, storage configuration and only needed provider credentials; keep Clerk secrets in components that actually authenticate. Preserve ownership checks, upload-intent/idempotency contracts, browser identity barriers and release isolation. For off-Replit hosting, replace the storage credential sidecar, ingress/proxy and build environment explicitly. Use backward-compatible schema transitions and tested recovery before traffic moves.

## Appendix

### Environment names and requirements

“Required” means code/feature requirements, not verified secret provisioning. Staging, if adopted, needs its own isolated equivalents.

| Names | Purpose | Dev / staging / production requirement |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | Required all web environments; never document value. |
| `PORT`, `NODE_ENV` | Listener/mode | Valid port required; production mode required for static/proxy behavior. |
| `SESSION_SECRET` | Encryption/key wrapping | Required all web environments; preserve existing key continuity. |
| `CLERK_SECRET_KEY` | Server identity operations | Required authenticated app/candidate; forbidden in published verifier. |
| `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` | Matched server/browser environment | Required auth/build; published verification requires matched production keys. |
| `VITE_CLERK_PROXY_URL` | Frontend proxy | Release script sets shared proxy path; development can use direct transport. |
| `REPL_OWNER` | Protected migrated-owner recognition | Required where that owner path is used; not an operator contact. |
| `PRIVATE_OBJECT_DIR` | Private storage mapping | Required photo/avatar paths; omit identifiers/values. |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Public object lookup roots | Required when public lookup is used. |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | Platform storage configuration | Platform-provisioned where applicable; not proof of active SDK selection. |
| `POE_API_KEY`, `POE_API_BASE_URL`, `POE_MODEL_CAPABILITIES_JSON` | Poe credentials, optional endpoint/capability configuration | Key required scanning/help; other settings conditional. |
| `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL` | Replit AI boundary | Required audio/image features. |
| `ORPHAN_INTENT_MAX_AGE_MS` | Cleanup grace | Optional; defaults 24 hours. |
| `RELEASE_SMOKE_DATABASE_URL` | Explicit isolated candidate DB | Optional alternative to automatic creation; never publication DB. |
| `RELEASE_SMOKE_PUBLIC_HOST`, `RELEASE_SMOKE_PORT`, `RELEASE_CANDIDATE_ID` | Candidate routing/identity | Harness defaults/generated; not evidence of actual production host. |
| `PRODUCTION_DEPLOYMENT_ID`, `PRODUCTION_BASE_URL` | Build identity / approved live target | Configure consistently for published verification; target validated. |
| `RELEASE_PUBLISHED_SMOKE_TARGET`, `RELEASE_PUBLISHED_SMOKE_MODE` | Read-only verifier boundary | Target matches approved origin; mode `read-only`; no mutation credentials. |
| `BASE_PATH` | Sandbox mount | Sandbox only, with its own `PORT`. |

Additional `RELEASE_*` harness controls are documented by source, not routine production configuration.

### Commands, links and owners

Commands above are examples only. `npm run build` compiles but does **not** replace `release:build`; `npm start` starts compiled production mode. No supported staging deploy, provider restore or production rollback CLI is established.

Further references: [project instructions](AGENTS.md), [release schema/recovery boundary](docs/release-database-migration.md), [testing](docs/testing.md), [validation manifest](docs/validation/manifest.json), [offline queue](client/src/lib/offlineQueue.ts), [storage registry](client/src/lib/storageKeys.ts), [Replit deployment types](https://docs.replit.com/features/publishing/deployment-types), [data recovery](https://docs.replit.com/features/data-and-storage/data-recovery). Recent Git history supplies change context, not deployment evidence. No verified operational owner/contact roster or architecture PR link was supplied; Git authorship is not ownership.

### Owner finalization checklist

- [ ] Confirm production project/origin, provider/runtime versions, region and replica/idle settings.
- [ ] Supply backup/retention, restore target/procedure, RPO/RTO and compatible rollback procedure.
- [ ] Name accountable roles for web, database, storage, auth, AI, releases and incident response.
- [ ] Confirm staging/promotion/check activation, monitoring/retention and maintenance guarantees.
- [ ] Define critical/experimental paths, known incidents, SLA, compliance, rotation and cost policies.
