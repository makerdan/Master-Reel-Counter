# GitHub Actions application validation

The workflows remain unchanged:

- `.github/workflows/validation.yml` runs `npm run ci`, which calls
  `npm run test-heavy` and the application workload manifest.
- `.github/workflows/managed-clerk-release.yml` retains the published Clerk
  verifier.

Only the retired gate contract/package-parity checks have been removed from
the called workload manifest. Application checks, audit thresholds, database
setup, diagnostics, and aggregate result behavior remain intact.

Old activation records, run IDs, and task decisions are preserved in
[the historical report](archive/legacy-failure-gate/docs/validation/github-actions.md).
They are not proof that a current remote revision passed. This retirement
does not dispatch GitHub workflows or change branch protection.

The workload runner is not task admission. The replacement gate is not
installed.
