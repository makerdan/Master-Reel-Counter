---
name: Node test harness budgets
description: Whole-file deadline behavior when running serial setup fixtures through Node's test runner.
---

Budget Node setup checks for the cumulative work in a test-file harness, not
only the duration of the slowest individual case. In this workspace,
`--test-timeout` can terminate the file harness while its individual cases
have been passing.

**Why:** A bounded setup suite was interrupted by its file deadline rather
than a failing assertion. That interruption was not evidence of a passing run.

**How to apply:** Use explicit, proportionate whole-file and outer process
bounds for setup fixtures. Do not confuse those setup bounds with authorization
to raise ordinary validation-tier budgets.
