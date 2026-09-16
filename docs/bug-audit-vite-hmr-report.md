# Bug & Error Audit Report

**Scope:** Vite HMR validation path: `server/__tests__/vite.test.ts`,
`server/vite-hmr.ts`, `server/websocket-upgrade.ts`, the Vite middleware
startup in `server/vite.ts`, development-process supervision in
`scripts/dev-supervisor.mjs`, and the `test-standard` manifest/package-script
integration.
**Mode:** report-only
**Date:** 2026-09-16
**Stack:** TypeScript, Node.js built-in test runner, Vite, Express, `ws`, and
the Replit development proxy. The typed-language checks were applicable.
Browser, live-server, and dependency-audit checks were not separately run
because the task's validation ceiling is `test-standard`.
**Product/test behavior changed:** No. Only this report was added; no HMR,
server, supervisor, or validation implementation was changed.

## Inventory and execution evidence

- `package.json:17` maps `test:vite-hmr` to
  `server/__tests__/vite.test.ts`.
- `docs/validation/manifest.json:15-27` runs that script as the
  `vite-hmr-tests` step in `test-standard`. The same step is also present in
  the higher registered tiers, but those tiers were not run.
- `server/vite.ts:12-54` is the actual Vite middleware setup. It creates a
  Vite server with middleware mode, passes `createHmrOptions(server)`, mounts
  Vite middleware, and transforms the client HTML.
- `scripts/dev-supervisor.mjs:104-157` is the development process harness. It
  clears the configured port, spawns the server entry, probes HTTP readiness,
  restarts unexpected exits, and sends a forced kill after the shutdown grace
  period.
- `server/index.ts:175-207,224-231,281-282` owns the shared HTTP server,
  installs Vite in development, and closes the server on `SIGTERM`.
- `server/__tests__/vite.test.ts:10-54` imports only the HMR option helper and
  path-scoped upgrade helper. It uses a cast empty `Server`, an
  `EventEmitter`, and a fake WebSocket server; it does not import or call
  `setupVite`, `createViteServer`, the supervisor, or a browser/client
  observation mechanism.

The local probe `npm run test-standard` completed successfully. Its HMR step
reported three passing tests in 303 ms:

1. secure preview option shape,
2. direct-local option shape, and
3. unmatched `/vite-hmr` upgrade routing plus matched `/ws` routing.

The process probe after the tier showed no listener left by the test. That is
consistent with the suite never starting a server, rather than evidence that
an HMR server and client were started and cleaned up correctly.

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 0 |

| # | Severity | Category | File:Line | One-line description |
|---|---|---|---|---|
| F-001 | High | Async & timing | `server/__tests__/vite.test.ts:1-54`, `server/vite.ts:12-54` | The HMR suite never observes a live update or recovery, so broken runtime HMR can pass `test-standard` |
| F-002 | Medium | State & data integrity | `server/__tests__/vite.test.ts:10-25`, `server/vite-hmr.ts:4-21`, `server/vite.ts:12-16` | The tested host branches bypass the runtime environment boundary and do not prove the preview origin is usable |

## Findings

### Finding F-001 — The HMR test is a configuration/routing unit test, not a live update test

- **File and line:** `server/__tests__/vite.test.ts:1-54`;
  `server/vite.ts:12-54`
- **Category:** Async & timing
- **Severity:** High
- **Risk:** The three passing tests construct no Vite server, do not mount the
  Vite middleware, do not open an HTTP or WebSocket client connection, do not
  mutate a served module, and do not wait for an HMR update or reconnect. The
  upgrade test only emits a synthetic event into the application's path
  filter and asserts that the fake `/ws` server was called. A regression in
  Vite's actual HMR listener registration, the browser WebSocket handshake,
  update delivery, client reload behavior, or reconnect/recovery path would
  therefore leave `test-standard` green. This is a confirmed false-pass
  condition: the HMR step passed while making no runtime request and leaving
  no HMR process or connection to clean up.
- **Recommended fix:** Add a focused isolated integration harness that starts
  the real development server (or `setupVite` with a real HTTP server), loads
  the client through the same origin used by the test, opens the HMR
  WebSocket, edits a fixture module, and asserts a real update event reaches
  the client. Include a controlled server-stop/restart or transport-drop
  scenario and assert that the client reconnects or reports the expected
  recovery state. Ensure the harness closes the browser/client, Vite server,
  and HTTP server in `finally` blocks. Keep the existing pure helper tests as
  fast unit coverage, but do not treat them as the live HMR guard.

### Finding F-002 — The preview-origin contract is tested only with an injected argument

- **File and line:** `server/__tests__/vite.test.ts:10-25`;
  `server/vite-hmr.ts:4-21`; `server/vite.ts:12-16`
- **Category:** State & data integrity
- **Severity:** Medium
- **Risk:** The preview test passes the literal `"example.replit.dev"` as the
  second argument, and the local test passes `""`. The production call site
  invokes `createHmrOptions(server)` without that argument, so the function
  reads `process.env.REPLIT_DEV_DOMAIN` at runtime. No test sets that
  environment value, calls the production call site, verifies the resulting
  browser-visible origin, or traverses the Replit HTTPS proxy. A regression in
  environment propagation, preview-host selection, TLS/proxy reachability, or
  the actual `setupVite` wiring can consequently pass both host-branch tests
  while preview clients connect to the wrong HMR endpoint or fail to connect.
- **Recommended fix:** Exercise the real no-override call path with an
  isolated environment and a controlled proxy/origin fixture. Assert the
  client-observed WebSocket URL and complete at least one update through that
  origin, while separately retaining unit cases for the secure and direct
  option shapes. Restore the environment and close the fixture servers in
  teardown.

## Tooling signals (Phase 0 and acceptance)

- **Typecheck:** clean in `test-standard`
  (`npm run typecheck` passed).
- **Storage lint:** clean in `test-standard`
  (`npm run lint:storage --strict` passed).
- **Tests:** clean in `test-standard`; all unit, managed-Clerk contract,
  Vite-HMR, and manifest-parity steps passed. The Vite-HMR step had 3 tests
  and 0 failures.
- **Dependency audit:** not run. The task explicitly limits validation to
  `test-standard`; no dependency-audit result is used as evidence for or
  against these findings.
- **Working tree:** no pre-existing or audit-induced changes were present in
  the audited implementation files.

## Deferred / not audited

- No live browser/client HMR flow exists in the audited test path, so update
  delivery and recovery behavior could not be verified without adding the
  harness described in F-001. This is the main remediation priority.
- The separate `scripts/__tests__/dev-supervisor.test.mjs` test covers a
  crash-restart fixture and port release, but it does not establish HMR
  listener or WebSocket cleanup. It was traced as part of the inventory, not
  reported as a defect independent of F-001.
- The actual Replit production proxy, browser cache behavior, and physical
  multi-tab recovery were not exercised. These require a live preview/proxy
  environment and are outside the registered `test-standard` command.
- No HMR, server, supervisor, process-management, or validation code was
  changed because this task is report-only.
