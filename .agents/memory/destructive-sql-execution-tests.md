---
name: Destructive SQL needs execution tests
description: Why safety-critical cleanup SQL must run against PostgreSQL instead of relying only on source-text contracts.
---

Destructive account cleanup SQL must have at least one executable PostgreSQL regression test covering its final clean-state invariant. Static source checks may supplement this test but cannot replace it.

**Why:** Source-text contracts did not detect an invalid correlated update or that a summed `count(*)` expression reached Node as a string, which would have made a valid cleanup roll back every time.

**How to apply:** For destructive migrations and reset utilities, execute the exact production query constants against disposable temporary tables and assert both dirty and clean outcomes using the same value types consumed by production code.