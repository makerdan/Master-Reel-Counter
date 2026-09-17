---
name: Live Vite HMR validation
description: The local HMR guard uses a real Chromium client and supervised fixture process to prove update delivery and restart recovery.
---

The HMR regression guard must observe the browser-visible `/vite-hmr` WebSocket,
an actual edited-module update, and a changed supervised process identity. For
restart recovery, keep the same browser page, require the old socket to close
and a replacement socket to open, reload through Vite's restart recovery path,
and deliver a second update from the new PID.

**Why:** Option-shape and synthetic upgrade tests can pass while the real
browser handshake, update delivery, or stale-process cleanup is broken. In the
isolated Vite middleware harness, an abruptly killed server may not surface the
browser close event until navigation, so process identity and browser-level
socket events must be asserted together.

**How to apply:** Keep normal live-update coverage in the standard tier and
restart coverage in the heavy tier. Use a temporary fixture root and the
development supervisor; never edit application files or depend on the app
database for this check.