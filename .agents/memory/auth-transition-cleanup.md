---
name: Auth transition cleanup
description: Browser-state cleanup must distinguish initial auth hydration from later settled identity changes.
---

Record the first application identity only after the local-user query has settled. Clear protected browser and application state on later settled changes, including signed-out to signed-in transitions, while preserving the auth query that resolves the new identity.

**Why:** Clearing the entire query client during auth-query resolution can create a refetch loop, while treating every signed-out-to-signed-in change as initial hydration can expose state seeded in a shared browser.

**How to apply:** Keep auth resolution separate from protected application-query cleanup whenever identity lifecycle handling changes.