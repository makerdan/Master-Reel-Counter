---
name: Browser file retry identity
description: Stable identity for user-selected files across browser retry events.
---

When a retry must reuse an idempotency key for the same selected file, derive the pending identity from file content rather than mutable `File` metadata.

**Why:** Browsers and browser-test APIs can recreate a selected `File` with a different `lastModified` value on each input event, even when the filename, type, size, and bytes are unchanged.

**How to apply:** Hash the bytes before the first side effect, retain the generated operation key by that hash until confirmation, and clear it only after the server confirms the operation.