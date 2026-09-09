---
name: Service-worker validation
description: Browser checks use the built public worker, so source worker changes need a fresh build before focused E2E runs.
---

The browser harness serves the generated public service worker during E2E runs; focused service-worker tests can otherwise exercise stale generated output after editing the source worker.

**Why:** A source-only change can appear ineffective in browser tests when the generated public bundle was built before the edit.

**How to apply:** Rebuild before focused service-worker browser checks, then run the task-locked heavy tier against the final tree.