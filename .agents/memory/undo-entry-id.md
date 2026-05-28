---
name: Undo delete-entry creates new ID
description: The undo action for delete-entry re-creates the entry via POST, giving it a new server-assigned ID rather than restoring the original.
---

## Rule
After undoing a `delete-entry` action the restored entry has a **new auto-incremented ID** — not the original one.

**Why:** `applyReverse` for `case "delete-entry"` calls `POST /api/sessions/${sessionId}/entries` which always inserts a new row with a new primary key. The original ID is gone.

**How to apply:**
- E2E tests must not use `[data-testid="row-entry-${originalId}"]` after clicking Undo for an entry delete.
- Use `[data-testid^="row-entry-"]` (prefix match) or check the count instead.
