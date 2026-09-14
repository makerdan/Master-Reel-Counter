---
name: Drizzle push EOF prompts
description: Closed-stdin behavior when Drizzle push encounters schema ambiguities in post-merge setup.
---

Do not treat a successful post-merge wrapper result as proof that `drizzle-kit push` applied pending schema changes when Drizzle encountered an interactive ambiguity prompt. Confirm the required development schema read-only.

**Why:** In the non-interactive post-merge environment, Drizzle displayed create-versus-rename choices, received EOF, and exited with status 0 without applying either choice. The wrapper therefore reported success even though the database remained unchanged.

**How to apply:** When a post-merge schema run logs an unresolved prompt, stop before destructive choices, inspect the exact development target, obtain consent for any data loss, and rerun the configured process with explicit safe responses. Then rerun the closed-stdin wrapper and verify metadata read-only.