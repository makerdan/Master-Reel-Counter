---
name: Large base64 validation
description: Safe validation strategy for large untrusted base64 request strings in Node.
---

For large base64 payloads, check the encoded and decoded size before decoding, then validate the alphabet and padding with a linear character scan. Avoid whole-input regular expressions built from repeated groups: V8 can throw a maximum-call-stack `RangeError` on very long strings.

**Why:** A strict repeated-group expression failed on a maximum-sized audio upload and turned an intended client-size rejection into a server error.

**How to apply:** Use size-first validation and an iterative scan for any large base64 field accepted by a Node request handler.