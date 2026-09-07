# Port Authority Runtime Hygiene

## Audit record

The September 4, 2026 audit found one Express/Vite application service, one
PostgreSQL pool, Playwright browser tests, and no separate worker service. The
application uses port `5000`; startup smoke tests use an isolated `5001`.
Ports `23636`–`23638` are configured by Replit but have no project-owned
listener or validation target. The project has no generated-code step and no
standalone WebSocket service; application WebSockets and Vite HMR remain
covered by the existing native ping behavior.

The app workflow is the only project workflow that must remain long-lived.
Validation, e2e, lint, typecheck, audit, and schema checks are on-demand
registered commands, not background workflows. A single PostgreSQL pool error
listener is installed in `server/db.ts`, and health probes use the backend
route `/api/healthz`.

## Ownership rules

- `scripts/free-ports.mjs` is the only port cleanup command. It requires
  explicit ports, rejects production execution, excludes its caller tree,
  terminates supervised descendants, escalates from SIGTERM to SIGKILL, and
  verifies release. Forced cleanup is logged as an `INCIDENT`.
- `scripts/serial-lock.mjs` is the only validation lock. Resources are striped
  by name, waiter manifests are written while queued, priorities are 1–9, and
  dead, stale, or overlong holders are reclaimed loudly.
- `VALIDATION_LOCK_FILE` and `VALIDATION_LOCK_WAITERS_DIR` can isolate smoke
  checks. `SERIAL_LOCK_PATH` remains supported for older callers.
- Playwright cleanup is part of its `webServer.command`, before the server is
  created; `globalSetup` only waits for and exercises the already healthy
  backend.
- `scripts/port-reference-scan.mjs` is the focused scanner contract for
  executable service references. Its synthetic fixtures reject fixed bind ports
  and fixed localhost URLs while accepting `process.env.PORT` and ephemeral
  port `0`.

## Capability checklist

| Capability | Status | Evidence or gate decision |
|---|---|---|
| Explicit port cleanup and input validation | Installed and verified | `scripts/free-ports.mjs`, `scripts/port-authority-test.mjs` |
| Caller-tree and production protection | Installed and verified | Cleanup guard and process-tree tests |
| Supervising process-tree termination | Installed and verified | `/proc` parent/descendant expansion in cleanup |
| Crash-safe named-resource lock | Installed and verified | `scripts/serial-lock.mjs`, real-process lock tests |
| Heartbeat, stale/dead/max-hold recovery | Installed and verified | `server/__tests__/ci-serial-lock.test.ts` |
| Waiter manifests and priority queue | Installed and verified | Real-process priority test |
| Reentrant lock acquisition | Installed and verified | Same-resource nested wrapper test |
| Independent resource concurrency | Installed and verified | Resource striping test |
| Child status and signal propagation | Installed and verified | Failure and SIGTERM tests |
| Four registered validation tiers | Installed and verified | `docs/validation/manifest.json` and platform registrations |
| Post-lock timeout budgets | Installed and verified | Tier manifest and lock `--timeout-ms` |
| Playwright pre-server cleanup | Installed and verified | `playwright.config.ts` `webServer.command` |
| Backend-reaching health checks | Installed and verified | `/api/healthz` in app, CI, and Playwright |
| Database pool error handling | Installed and verified | Existing `pool.on("error")` handler |
| Native WebSocket pings | Installed and verified | Existing app WebSocket path; no new machinery needed |
| Generated-file serialization | Installed but not applicable | Audit found no generated-code pipeline |
| Multiple-service port registry | Installed but not applicable | Audit found one project-owned service |
| Separate worker/service workflow | Deliberately skipped | No worker/service gate exists |
| Additional validation workflows | Deliberately skipped | Heavy-project budget reserves one app workflow |
| Browser/e2e hygiene | Installed and verified | Playwright web server and full heavy tier |
| Schema/data check | Installed and verified | Read-only migration/schema checker in heavy tier |