# Obsolete Poe skill command retirement

The exact installed Poe skill intentionally does not contain
`targeted-correction-contract.test.mjs`. Retire `test:poe-setup-skill` from
`package.json`; do not restore the removed file or substitute unrelated tests
under that name.

## Preserved contracts

- **R1:** The obsolete alias is absent, as is its intentionally removed target.
- **R2:** The installed Poe package must retain exactly the file paths and
  SHA-256 hashes in `skill-bundle-installation.json`. No package files are added,
  removed or edited by this retirement.
- **R3:** Every other package script, `package-lock.json`, `.replit`, the
  validation manifest and the bundle installation record remain unchanged.
  Every pre-existing gate record and binding is retained. The only new gate
  record belongs to this separately provisioned retirement.

The removed alias was not referenced by any registered tier. Existing Poe
provider tests remain in `test:unit`; all four registered tier workloads and
the platform's registered completion validation remain unchanged.

## Admission and validation evidence

The supported provisioner admitted plan
`9af9b4d3-d322-47a1-8953-89efa669e2a2`, revision 1, bound only to
`test-standard`. The canonical gate pin matched before provisioning, and the
Agent-first `gate:guard` preflight passed before implementation.

The baseline catalog was valid and empty. No baseline waiver or tier amendment
was used. The full pre-change `test-standard` run passed all eight registered
steps, including manifest-parity. Its HMR restart test is intentionally skipped
in this tier; it belongs to the unchanged heavy-only recovery workload.

Run the same tier after the change:

```sh
TASK_ID=9af9b4d3-d322-47a1-8953-89efa669e2a2 \
TASK_PLAN_FILE=.local/tasks/9af9b4d3-d322-47a1-8953-89efa669e2a2.md \
npm run gate:run -- --tier test-standard
```

The portable `unified-registry.json` record retains the sealed plan, requirement
assertions, exact target hashes, step results and completion state for both runs.
Use the post-change full-tier result, not the baseline run, as delivery evidence.

## Regression Guard handoff

This is deletion-only maintenance: the obsolete command is entirely removed,
leaving no execution path to its absent test. No new recurrence test or missing
package-file scanner is introduced. The surviving contracts R1–R3 are verified
with read-only structural/path/hash comparisons against the pre-task snapshot
and the unchanged installation manifest. The registered `manifest-parity` step
also checks all four tier/package-script mappings.

Optional independent verification was not selected. Completion review is handled
by the task completion process. Application runtime and UI are unchanged.
