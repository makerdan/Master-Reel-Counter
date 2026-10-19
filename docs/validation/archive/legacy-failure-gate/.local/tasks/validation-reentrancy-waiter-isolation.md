# Prevent validation self-deadlocks

## What & Why
Resolve the remaining serial-lock findings from the merged audit after the crash, ownership-race, and descendant-cleanup fixes. The non-smoke heavy tier currently routes through a recursive `npm run ci` path that can queue behind its own validation lock, and shared waiter directories allow a waiter for another resource to block acquisition.

## Done looks like
- The canonical non-smoke heavy path executes its intended steps once without recursively reacquiring the same lock.
- Reentrancy, if retained, is explicit and scoped to the same resource and lock identity.
- Waiter priority considers only manifests for the current resource, even when directories are shared.
- Non-smoke and shared-waiter tests fail before these deadlock or cross-resource blocking paths can reach CI.

## Out of scope
- General serial-lock crash recovery and process-tree cleanup already merged in Tasks #736 and #737.
- Redesigning validation tier membership beyond removing the recursive invocation and enforcing resource scoping.

## Steps
1. **Remove or formalize recursion** — Trace the heavy manifest, package script, and runner environment; invoke the heavy steps once or preserve a verified same-resource reentrancy marker without stripping the required identity.
2. **Scope waiter decisions** — Filter priority and stale cleanup by the requested resource and make the waiter namespace/resource naming unambiguous.
3. **Add non-smoke coverage** — Run the real non-smoke manifest path and a shared-waiter fixture with unrelated resources, asserting bounded completion and correct lock ownership.
4. **Validate the collision boundary** — Run the standard heavy validation command and preserve existing lock timeout and exit-status behavior.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-heavy`
**Why:** The defects occur only in the non-smoke heavy-tier path and serial-lock integration; the registered heavy tier includes the nested-tier and collision checks.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** A non-smoke `test-heavy` invocation holding the validation lock while its manifest reaches the CI step, and a higher-priority waiter for resource A sharing a directory with a contender for resource B.
**Test location:** `server/__tests__/ci-serial-lock.test.ts`
**What it checks:** Asserts the heavy command completes without self-queueing and that resource B acquires despite an unrelated resource-A waiter, while lock ownership and timeout diagnostics remain correct.

## Relevant files
- `scripts/serial-lock.mjs`
- `scripts/run-tier.mjs`
- `docs/validation/manifest.json`
- `package.json:28-43`
- `server/__tests__/ci-serial-lock.test.ts`
- `scripts/ci-collision-test.mjs`
