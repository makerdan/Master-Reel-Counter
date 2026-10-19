# Correct AI Model Status

## What & Why
Correct the Admin health indicators so they report only the two AI models supported by the app—Gemini 3.1 Pro and Claude Sonnet 4.5—and color each chip from that model's actual availability. Keep general API health independent so a healthy API cannot mask or falsely fail an individual model.

## Done looks like
- The Admin tab shows exactly two AI model chips: Gemini 3.1 Pro and Claude Sonnet 4.5
- Each chip is green when its exact configured Poe model is present in the current live model response
- Each chip is red when that model is absent or its availability cannot be confirmed
- General API online/healthy status remains accurate and independent from individual model availability
- Admin health data remains protected by the existing server-authoritative Admin access policy

## Out of scope
- Adding or switching AI providers
- Changing which model handles help chat or label scanning beyond aligning health reporting with the app-supported model registry
- Redesigning the rest of the Admin tab or general system-health reporting
- Treating unrelated Poe models as supported merely because the provider returns them

## Pre-existing failures to ignore
None known at plan time. The primary backend baseline passed 79 of 79 tests.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** This tier covers the TypeScript client/server contract and the backend provider and protected-route behavior changed by this task.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** The Admin model-health contract exposes only Gemini 3.1 Pro and Claude Sonnet 4.5 and derives each status independently from the exact live Poe model list rather than general API health.
**Test location:** `server/__tests__/poe-provider.test.ts` and focused Admin UI coverage colocated with the project's existing client test convention
**What it checks:** Extra provider models are excluded; both available, mixed availability, missing models, and provider failure produce the correct two-model response and green/red chip states without changing API-online status.

## Steps
1. **Establish the supported-model registry** — Represent Gemini 3.1 Pro and Claude Sonnet 4.5 as the only app-supported health entries, using verified Poe identifiers and stable display labels rather than every model returned by the provider.
2. **Return per-model availability** — Extend the protected Admin health data flow to compare the two registered identifiers against the current live Poe model list and return a bounded status for each, while preserving the separate general API health result and existing authorization behavior.
3. **Correct the Admin chips** — Render exactly the two registered models and map each model's confirmed availability to green or red styling with accessible status text; do not infer chip state from the aggregate API indicator.
4. **Add regression coverage** — Cover filtering of unrelated models, both-available and mixed-availability responses, unavailable/provider-error behavior, protected access, exact labels, and independent chip coloring.
5. **Validate within the registered ceiling** — Run the locked `test-standard` tier and classify any failures according to the documented baseline rules without expanding into unrelated repairs.

## Relevant files
- `client/src/pages/settings.tsx`
- `server/providers/poe.ts`
- `server/routes.ts`
- `server/__tests__/poe-provider.test.ts`
- `server/__tests__/routes.test.ts`
- `.agents/skills/validation-tiers/tiers.json`
- `docs/validation/failure-baseline.json`
