# Bug & Error Audit Report

**Scope:** Vite HMR validation path: `server/__tests__/vite.test.ts`,
`server/vite-hmr.ts`, `server/websocket-upgrade.ts`, the Vite middleware
startup in `server/vite.ts`, development-process supervision in
`scripts/dev-supervisor.mjs`, and the validation manifest/package scripts.
**Mode:** remediation verification
**Date:** 2026-09-17
**Stack:** TypeScript, Node.js built-in test runner, Vite, Express, `ws`,
Playwright/Chromium, and the Replit development proxy.

**Product/test behavior changed:** No application behavior changed. The HMR
validation path now starts an isolated supervised Vite server and a real
Chromium client, edits a served module, and verifies restart recovery.

## Inventory and execution evidence

- `package.json:17-18` maps `test:vite-hmr` and
  `test:vite-hmr-recovery` to `server/__tests__/vite.test.ts`.
- `docs/validation/manifest.json:15-29` runs the normal live check as
  `vite-hmr-tests` in `test-standard`.
- `docs/validation/manifest.json:47-68` runs the recovery command as
  `vite-hmr-recovery-tests` in `test-heavy`; `test-standard-plus` retains the
  normal live-update check.
- `server/vite.ts:12-54` remains the actual application Vite middleware setup.
  The new test uses an isolated Vite middleware server rather than application
  routes or the database.
- `scripts/dev-supervisor.mjs:104-157` is exercised as the real supervisor:
  it clears the configured port, starts the fixture, probes readiness, and
  restarts the terminated child.
- `server/__tests__/vite.test.ts` retains the pure HMR option and upgrade
  routing tests and adds a real browser client, module edit, process identity,
  socket lifecycle, and teardown assertions.

The focused live probe `npm run test:vite-hmr` completed successfully with four
passing tests and one intentionally skipped recovery test. The heavy-mode
probe `npm run test:vite-hmr-recovery` completed successfully with five
passing tests:

1. secure preview option shape;
2. direct-local option shape;
3. unmatched `/vite-hmr` upgrade routing plus matched `/ws` routing;
4. a real browser client receiving an edited module through Vite HMR; and
5. the same browser page reconnecting after the supervised process changes.

The recovery harness asserts that the pre-restart socket closes, the old
process exits, the new process serves the page, and the post-restart module
update contains the new process identity. Teardown closes the page, browser,
supervisor, and temporary fixture directory.

## Summary

| Severity | Open count |
|---|---:|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

| # | Former severity | Category | Resolution |
|---|---|---|---|
| F-001 | High | Async & timing | Resolved by the live browser update and supervised restart checks in `server/__tests__/vite.test.ts`. |
| F-002 | Medium | State & data integrity | Resolved by observing the actual `/vite-hmr` URL and verifying the new served process identity. |

## Resolved findings

### F-001 — The HMR test was only a configuration/routing unit test

The previous three tests constructed no Vite server, opened no browser
connection, edited no served module, and waited for no update or recovery. A
runtime handshake or delivery regression could therefore pass
`test-standard`.

The standard tier now starts the isolated fixture through the real supervisor,
launches Chromium, requires a live `/vite-hmr` socket, edits `marker.js`, and
requires the browser DOM plus the accepted HMR update to change.

### F-002 — The preview-origin contract was only tested with injected options

The previous host-branch tests did not observe a browser-visible HMR endpoint.
The live harness now observes the actual `/vite-hmr` WebSocket URL and completes
an update through it. Recovery additionally requires the original socket to
close, a replacement socket to open, the old PID to exit, and the new PID to
serve the page before accepting the second update.

## Tooling signals

- **Focused live HMR:** `npm run test:vite-hmr` passed.
- **Focused restart recovery:** `npm run test:vite-hmr-recovery` passed.
- **Manifest parity:** `node scripts/validate-validation-manifest.mjs` passed.
- **Typecheck and storage lint:** the pre-change `npm run test-standard` baseline
  passed; the final locked standard run is the acceptance check for this change.
- **Dependency audit:** not run as part of the task's `test-standard` ceiling.

## Deferred / not audited

- The actual Replit production proxy, browser cache behavior, and physical
  multi-tab recovery remain outside this isolated local harness.
- The separate `scripts/__tests__/dev-supervisor.test.mjs` test continues to
  cover crash-restart and port release; this task adds browser/HMR lifecycle
  assertions without changing production WebSocket behavior.
- No production HMR, server, supervisor, or process-management behavior was
  changed; only the isolated validation fixture and tier routing were added.
