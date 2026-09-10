---
name: Playwright WebSocket mocks
description: Compatibility requirement for browser tests that intercept WebSockets with Playwright routeWebSocket.
---

Browser tests that use Playwright's routeWebSocket need a URL.parse compatibility shim installed on each page before navigation. Page initialization is isolated between tests, so installing it in one test does not protect later tests.

**Why:** The bundled WebSocket mock calls URL.parse, while the Chromium version used by this project may not expose that API. Without the per-page shim, the client crashes before the WebSocket contract runs and the test reports the app-level error boundary instead of the real assertion.

**How to apply:** Put the shim in a small page setup helper and call it in every test that registers a WebSocket route, before page.goto.