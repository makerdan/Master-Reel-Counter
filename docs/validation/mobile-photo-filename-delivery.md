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
Owner explicitly authorized the main executor's Zod repair and directed that
native #1007's previous executor remain idle. That executor was not resumed.
Zod 4.6.7 is now installed in both roots, with compatible adapters; see
`zod-security-delivery.md`. No duplicate native task or ignored baseline was added.

## Validation

Started the full admitted `test-heavy` run:
`3cd96cc0-c712-4b48-b50e-35b584887340`.
The outer shell call timed out after 60 seconds before the full tier finished.
The startup-smoke observation was PASS; no completed audit/browser outcome was
recorded. Process discovery afterward found no remaining gate, step or audit
process. This is interrupted/unverified validation, not a tier PASS.

The interrupted record originally remained RUNNING, with its original cleanup deadline
`2026-10-25T04:49:18.184Z` (October 24, 11:49:18 PM America/Chicago).
After that deadline, supported bound-context `gate:run -- --tier test-heavy
--recover` recorded INCOMPLETE at `2026-10-25T04:49:35.247Z`. No deadline,
record or lease was manually reset.

An exact short-case selector selected no tests because this test has a parent
suite; it established no browser coverage. The subsequent supported file/pattern
diagnostic `e843c349-fe89-493a-83c5-96140b4a48e0` actually executed the handoff
case on **mobile-chromium**, passed on attempt 0, and passed the compiler-first
preflight. The JSON evidence explicitly records `executed: true`.
Assertions cover the generated session/photo filename, metadata persistence,
decoded protected image before/after reload, empty durable queue and one upload/
registration response throughout. This is a real local browser pass, not a
full bound-tier or iPhone/WebKit PASS.

The related security repair's full heavy attempt stopped at the remaining Multer
advisory; body-parser and Zod were no longer flagged. No full heavy or native
completion is claimed. Local diagnostics remain INCOMPLETE by gate design even
when their selected test observations are PASS.
