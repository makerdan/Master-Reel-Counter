---
name: Storage lint registry trust
description: The storage-key lint contract must distinguish actual key exports from unrelated registry exports and validate identity-scoped factories.
---

The storage-key analyzer should derive its trusted symbol set from the registry's actual key constants and key factories. Importing from the registry module alone is not proof that a value is a usable storage key.

**Why:** A broad import exemption lets numeric metadata, field lists, aliased shadowed bindings, and malformed dashboard keys bypass the contract while still looking registry-related.

**How to apply:** Keep local aliases and storage-object aliases lexical and fail closed on unknown exports, expression-built keys, invalid factory arity, undocumented dashboard fields, or fixed identity values.