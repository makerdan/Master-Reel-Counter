---
name: Object-key ownership comparisons
description: Safety rule for deleting blobs whose database references may use legacy path aliases.
---

Normalize every supported representation of an object key before candidate selection and retained-reference exclusion. Ownership safety must be decided by physical object identity, not raw database strings.

**Why:** Legacy `/objects/...` and direct path forms can resolve to the same blob. Comparing raw strings can misclassify a shared blob as exclusively owned and delete data retained by another account.

**How to apply:** Any account, session, or orphan cleanup that checks whether an object is still referenced must canonicalize both the deletion candidates and all retained references before comparing them.