# Harden storage-key linting

## What & Why
Make the storage-key validator enforce the registry contract instead of relying on line-based heuristics. The merged storage-lint audit reproduced false negatives for multiline, indirect, concatenated, and aliased calls, plus an unrestricted `dash:` exemption and false positives in comments.

## Done looks like
- Executable storage calls are analyzed across multiline formatting and local key/storage aliases.
- Unregistered constants, templates, concatenations, and storage-object aliases cannot bypass strict validation.
- Dashboard exemptions are limited to the documented registry shape and lifecycle.
- Comments, strings, and template contents are ignored as code, while strict and report-only exit contracts remain clear.
- Focused fixtures cover every reported false-negative and false-positive class.

## Out of scope
- Migrating current application call sites unless required by the narrowed exemption contract.
- Changing storage lifecycle behavior or the registry's product-facing key names.

## Steps
1. **Replace text heuristics** — Use token-aware or AST-backed analysis to identify executable storage calls and preserve useful source locations.
2. **Resolve allowed key forms** — Trace local constants, factories, concatenations, and storage aliases conservatively; fail closed when the registry relationship cannot be proven.
3. **Narrow dashboard handling** — Remove the broad prefix exemption or require the exact documented identity-scoped shape and registered factory.
4. **Add contract fixtures** — Cover multiline calls, indirect keys, aliases, comments, strings, templates, legitimate registry helpers, malformed input, and both exit modes.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** This registered tier runs the strict storage linter, its unit/contract coverage, and the surrounding validation-manifest checks.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Self-satisfying** — this task's primary deliverable is the storage-lint analyzer and its focused contract suite covering the reported bypasses and false positives.

## Relevant files
- `scripts/lint-storage.mjs`
- `scripts/__tests__/`
- `client/src/lib/storageKeys.ts`
- `docs/validation/manifest.json`
- `.agents/skills/validation-tiers/tiers.json`
