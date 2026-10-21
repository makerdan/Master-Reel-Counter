---
name: Nested Node test runners
description: Avoid false success when a Node test spawns another Node test runner.
---

When testing intentional runner failures in a nested Node process, remove inherited
`NODE_TEST_CONTEXT` from the nested runner's environment and assert evidence that
the intended case actually executed, not merely its exit code.

**Why:** In this workspace's Node 20 runtime, a nested `node --test` inherited the
outer runner's context and returned zero without exercising the generated test.
That false success concealed the intended interruption boundary.

**How to apply:** Give nested runners an independent environment and bounded owned
process supervision. Keep fixture-only command paths separate from the runner's
own tool-discovery path.
