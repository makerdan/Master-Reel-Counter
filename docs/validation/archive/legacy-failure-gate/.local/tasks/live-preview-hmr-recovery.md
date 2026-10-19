# CONSOLIDATION - Live Preview HMR Recovery

## What & Why
Combine #725 and #726 into an end-to-end live-update check that verifies both normal Vite HMR and recovery after a supervised dev-server restart.

## Done looks like
- Validation observes a real browser client receiving a module update
- The same client recovers after restart without using stale sockets or processes

## Out of scope
- Changing application features unrelated to development preview
- Production WebSocket behavior

## Steps
1. **Live HMR harness** — Start an isolated development server and verify a browser client receives an actual update.
2. **Restart recovery** — Restart the supervised server and verify the client reconnects to the new process.
3. **Lifecycle assertions** — Ensure stale processes and sockets cannot produce a false pass.

## Regression hardening
- **Tier**: `test-standard` | **Test**: add a live Vite HMR integration check | **Guards against**: a broken WebSocket handshake passing option-only tests
- **Tier**: `test-heavy` | **Test**: add restart recovery coverage to the live HMR harness | **Guards against**: updates appearing successful through a stale dev-server process

## Relevant files
- `scripts/validation-steps.mjs`
- `docs/bug-audit-vite-hmr-report.md`
- `docs/validation/manifest.json`
