---
name: Object-key ownership comparisons
description: Safety rule for deleting blobs whose database references may use legacy path aliases.
---

Normalize every supported representation of an object key before candidate selection and retained-reference exclusion. Ownership safety must be decided by physical object identity, not raw database strings. Batch cleanup must exclude the complete candidate set from retained-reference checks and deduplicate deletion by physical identity. When aliases are finite, compare the canonical alias set inside indexed database queries rather than loading all references into application memory.

**Why:** Legacy `/objects/...` and direct path forms can resolve to the same blob. Comparing raw strings can misclassify a shared blob as exclusively owned and delete data retained by another account. Conversely, treating two aliases inside the same deletion batch as retained references skips both deletions and leaves an orphan. Application-side full-table normalization makes per-photo cleanup quadratic and can time out large deletions.

**How to apply:** Any account, session, or orphan cleanup that checks whether an object is still referenced must canonicalize both the deletion candidates and all retained references before comparing them. Exclude every row in the current batch, delete each canonical key at most once, and preserve bounded database lookups and anti-joins.