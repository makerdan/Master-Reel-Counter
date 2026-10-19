# CONSOLIDATION - Validation Tier Contracts

## What & Why
Combine #723 and #724 so task plans, the canonical manifest, and runtime validation agree on every supported tier and command shape.

## Done looks like
- Every advertised tier is accepted by task-plan validation
- Hidden tiers, missing tiers, and malformed command entries fail parity checks clearly

## Out of scope
- Adding new validation tiers
- Changing the checks assigned to existing tiers

## Steps
1. **Single supported-tier contract** — Align plan validation with the canonical set of advertised tiers.
2. **Strict manifest parity** — Reject unexpected tiers and malformed command arrays or entries.
3. **Regression coverage** — Exercise valid, missing, extra, and malformed tier definitions.

## Regression hardening
- **Tier**: `test-fast` | **Test**: extend focused manifest validation tests | **Guards against**: an advertised tier being rejected by the task-plan scaffold
- **Tier**: `test-standard` | **Test**: extend `scripts/validate-validation-manifest.mjs` contract coverage | **Guards against**: hidden tiers or non-string commands passing validation

## Relevant files
- `scripts/validate-validation-manifest.mjs`
- `scripts/validation-steps.mjs`
- `docs/validation/manifest.json`
- `.agents/skills/validation-tiers/tiers.json`
