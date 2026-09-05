---
name: Validation Tiers
description: Declarative project validation tiers used by Failure Gate.
---

# Validation Tiers

Tiers are registered in `tiers.json`, not in runner conditionals. Each step
has a name, command, kind, and optional serial requirement. `test-light`,
`test-standard`, and `test-heavy` are the project contract; future suites are
added as registry entries and tests, then included in a tier by data.

- **light**: typecheck and storage lint.
- **standard**: light checks plus backend unit tests.
- **heavy**: startup smoke, dependency audit, light checks, backend tests,
  serial-lock collision smoke, and Playwright e2e. The heavy group is wrapped
  by the existing serial lock and port cleanup controls.

`kind` distinguishes `typecheck`, `test`, `lint`, `audit`, `smoke`, and
`harness` results. A typecheck failure is a task failure. A harness limitation
must be reported as such and cannot be silently promoted to a baseline.