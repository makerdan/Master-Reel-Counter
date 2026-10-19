# CONSOLIDATION - Failure Gate Archive Parity

## What & Why
Combine #720 and #721 so stale Failure Gate archives are rejected consistently by extended validation tiers and direct release packaging.

## Done looks like
- Standard-plus, heavy, and release build paths reject stale archives with consistent regeneration guidance
- Focused checks prove each protected path fails closed

## Out of scope
- Changing Failure Gate policy content
- Weakening existing validation thresholds

## Steps
1. **Extended-tier parity** — Apply the existing archive parity requirement to every intended extended validation tier.
2. **Release packaging preflight** — Require archive parity before direct release packaging begins.
3. **Contract coverage** — Add focused checks for stale and current archives across both entry paths.

## Regression hardening
- **Tier**: `test-standard` | **Test**: extend `scripts/__tests__/failure-gate.test.mjs` | **Guards against**: standard-plus or heavy validation silently omitting archive parity
- **Tier**: `test-heavy` | **Test**: add release packaging preflight coverage | **Guards against**: a direct release build accepting stale Failure Gate archives

## Relevant files
- `scripts/check-failure-gate-parity.mjs`
- `scripts/__tests__/failure-gate.test.mjs`
- `docs/validation/manifest.json`
