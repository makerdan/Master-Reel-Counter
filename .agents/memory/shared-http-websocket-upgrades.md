---
name: Shared HTTP WebSocket upgrades
description: How multiple path-scoped WebSocket protocols must coexist on the application's shared HTTP server.
---

Path-scoped WebSocket servers sharing one HTTP server must use selective upgrade handling that ignores unmatched paths rather than rejecting them.

**Why:** A WebSocket server attached directly with its own path can answer another protocol's upgrade first with HTTP 400. The target protocol then never sees the request, even when its client URL and proxy settings are correct.

**How to apply:** When adding another WebSocket endpoint to the shared application port, use no-server mode and claim only that endpoint's path. Verify both direct and Replit-proxied upgrades for protocols that share the server.