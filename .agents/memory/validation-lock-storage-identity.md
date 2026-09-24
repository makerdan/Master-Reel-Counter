---
name: Validation lock storage identity
description: Lock ownership must remain bound to the acquired storage object, not just matching lock contents.
---

A lock token alone is not sufficient proof of ownership: a replacement file can copy the token. Heartbeats, completion checks, and cleanup must also verify that the lock path still refers to the acquired file. If ownership cannot be confirmed, protected work must fail closed and cleanup must leave replacement state untouched.

**Why:** Validation can otherwise continue after another run has replaced its lock, or delete replacement state that happens to carry the former token.

**How to apply:** For lock lifecycle changes, validate both logical ownership and underlying file identity before refreshing or removing state; check ownership again before reporting protected work as successful.