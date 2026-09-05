---
name: Failure Gate validation
description: How to interpret tier validation that stops on unchanged dependency audit failures.
---

When a registered tier stops at dependency audit before later suites, classify
the audit result against the unchanged manifest and lockfile before assigning
ownership. Do not weaken the audit threshold or repair dependencies in a
validation-contract task; preserve the failure as pre-existing evidence for
the dependency-maintenance work.

**Why:** Validation-contract work must not silently turn an existing dependency
warning into a passing result or expand scope into unrelated dependency
upgrades.

**How to apply:** Compare dependency sections and lockfiles with the task's
starting revision, record the exact audit output, and report later tier steps
as not reached rather than treating them as passing.