---
name: React state updater queue race
description: Why asynchronous queue drainers must not depend on values assigned inside a state updater.
---

Do not assign a queue item inside a React state updater and then read that assignment synchronously after calling the setter. Select the item from the current render snapshot (or an explicit queue ref), claim it with a separate processing guard, and then update its visible status.

**Why:** React may defer the updater. A drainer built around a synchronous side effect can mark an item as uploading on a later render while the function that should start the request has already returned, leaving the queue permanently stuck.

**How to apply:** Use this rule for client-side sequential drain loops, especially when UI state mirrors durable IndexedDB records. Keep the processing claim independent from the visible status update.

Fresh durable claims must also have an expiry-driven recovery path while the replacement page remains open. Preserve claims during their active window, then clear expired claims, notify queue observers, and re-run the drainer without requiring another reload.

**Why:** A page can disappear just after claiming an IndexedDB record. A startup-only stale sweep misses claims that are still fresh during startup and otherwise leaves the restored item blocked forever.

**How to apply:** Any durable cross-tab claim needs both atomic acquisition and periodic or deadline-based expiry recovery. Regression tests should restore a still-fresh abandoned claim, prove it is not stolen early, and prove it syncs after expiry.