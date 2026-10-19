# Managed Clerk credential capability verification

Date: 2026-09-14

## Safety boundary

- No credential, password, testing token, cookie, session value, request body,
  response body, browser storage state, native trace, or authenticated
  screenshot was recorded.
- The capability probe used one uniquely marked disposable provider fixture.
- The probe did not create a local database row because provider-user creation
  was rejected before the local fixture step.
- Cleanup queried the owned provider marker and confirmed no provider user
  remained.

## Capability results

| Capability | Result | Evidence |
| --- | --- | --- |
| Server/client publishable configuration selects one Clerk environment | **Passed** | The shared non-sensitive publishable-key metadata check completed successfully. |
| Disposable Clerk user creation | **Blocked** | The connected Clerk API returned the redacted status class `422 Unprocessable Entity` with error code `form_data_missing`. |
| Clerk testing-token issuance | **Blocked** | User creation was blocked, so no testing token was issued or retained. |
| Supported release browser sign-in and Clerk proxy path | **Blocked** | The prerequisite disposable user was unavailable; no browser sign-in was attempted. |
| Protected `/api/auth/user` identity and protected navigation | **Blocked** | The prerequisite browser session was unavailable. |
| Provider and local cleanup | **Passed** | The provider absence check passed; no local row was created. |
| Browser/session/artifact cleanup | **Passed** | The probe retained no browser context or storage state. The release harness now signs out, clears protected storage and cookies, closes the context, disables screenshots, and performs provider/local absence checks in `finally`. |

## Validation

Passed focused deterministic checks:

```text
npm run test:managed-clerk-release-contract
npx tsc --noEmit --project tsconfig.playwright.json
```

The task-locked command was run exactly as planned:

```text
TASK_PLAN_FILE=.local/tasks/task-670.md node scripts/run-locked-tier.mjs .local/tasks/task-670.md
```

Heavy-tier results:

- Passed: startup smoke, dependency audit, schema check, workspace-skill
  contract, TypeScript checks, storage lint, unit tests, Vite/HMR tests,
  serial-lock tests, port-authority tests, validation-manifest parity, and
  collision smoke.
- Blocked at `browser-tests` during the existing Clerk browser fixture's
  disposable-user creation with the same redacted `422` / `form_data_missing`
  provider result.
- The exact managed release target was not invoked because the explicit
  production target and isolated release-database inputs were unavailable; the
  release spec correctly refuses an implicit target.

Completion validation independently reproduced the same result. The heavy
tier passed through collision smoke and stopped at browser fixture
provisioning with the same provider error. The other tiers failed closed after
waiting behind the active validation lock; no additional product failure was
reported.

The release contract now requires the matched publishable configuration,
supported testing-token path, unconditional browser-context cleanup, and
post-cleanup provider/local absence checks. Once the connected credential can
create disposable users, rerun the exact release candidate gate and this
task-locked heavy tier without weakening those assertions.