# Mobile photo filename assertion repair

## Scope and admission

Owner direction: fix the existing mobile photo generated-filename expectation.
Reused restored local plan `02401352-2967-439c-afc2-0456d418271a`, revision 1,
original single-file contract and `test-heavy` binding. Pre-implementation
`gate:guard -- --tier test-heavy` returned ADMITTED. No replacement ID or amendment.

Classification: test-only, self-satisfying regression repair under that plan.
No production naming, upload, authentication, storage or application change.

## Requirement map

- R1: independently derive `S<session>_P<photo ID padded to at least four digits>.jpg`
  from created session/registration IDs; compare persisted originalFilename,
  not the user-supplied `handoff.jpg`.
- R2: retain physical object path, one photo, 37x23 dimensions, aisle/section and
  unchanged API array after reload; additionally assert upload and registration
  response counts still each equal one after reload.
- R3: retain protected-image decoding and successful GET assertions both before
  and after reload; no skip/early exit or authentication workaround.
- R4: full bound-heavy validation remains required. Supported diagnostic results
  are reported separately and do not replace the full tier or iPhone matrix.

## Separate security work

Body-parser 2.4.0 is present following the merged compressed-request repair.
Zod 3.25.76 remains in the installed graph. Native #1007 is IN_PROGRESS and
WAITING_FOR_INPUT; that does not establish an idle executor. No overlapping
dependency repair or duplicate task is started without resolving execution
ownership. No ignored baseline entry is added.

## Validation

Started the full admitted `test-heavy` run:
`3cd96cc0-c712-4b48-b50e-35b584887340`.
The outer shell call timed out after 60 seconds before the full tier finished.
The startup-smoke observation was PASS; no completed audit/browser outcome was
recorded. Process discovery afterward found no remaining gate, step or audit
process. This is interrupted/unverified validation, not a tier PASS.

The durable record remains RUNNING, with its original cleanup deadline
`2026-10-25T04:49:18.184Z` (October 24, 11:49:18 PM America/Chicago).
Do not edit/reset that record or start a competing run. After that deadline,
use the supported bound-context `gate:run -- --tier test-heavy --recover`;
recovery records an interrupted outcome, not successful workload validation.
Then actual required validation still needs execution. No browser assertions,
iPhone coverage, current audit success or native completion are claimed.
