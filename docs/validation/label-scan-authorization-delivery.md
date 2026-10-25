# Label scan object authorization

## Scope and governing plan

Security and data-integrity repair only: no schema, UI, provider or account
permission changes. The approved session owner/editor access checks remain in
place. Local plan identity, revision, contract pin, target fingerprint and run
results are retained by the supported gate under claim
`label-scan-object-authorization` in `docs/validation/unified-registry.json`.
The planning specification is `label-scan-authorization.spec.json`.
Independent verification was not selected.

## Requirement-to-delivery map

| Requirement | Implementation | Executable recurrence guard |
| --- | --- | --- |
| R1: Reject unowned pin identifiers before processing | Both production handlers call `authorizeLabelScanPins` before acquiring scan resources or preparing images. The complete batch must contain unique positive integer pin IDs matching their photos and the authorized session. The photo handler supplies its authorized photo ID. | `server/__tests__/routes.test.ts`, suite `label scan object authorization — production HTTP and PostgreSQL`, case `both routes reject forged and malformed IDs before image/provider work`: real HTTP requests with a valid pin followed by a foreign, wrong-photo, absent or malformed pin fail with 400; image/provider call counts stay zero, local results remain empty and victim results remain identical. The session route also rejects a genuine victim pin/photo pair and absent photo IDs. |
| R2: Keep persistence scoped and atomic | `DatabaseStorage.upsertScanResults` checks current pin/photo/session relationships in its transaction, holds shared row locks until commit and scopes conflict updates to matching existing photo/session IDs. Failure rolls back the entire batch. Session-route persistence uses prepared requests for photo IDs. | Same suite, cases `storage rejects mismatched ownership and rolls back a mixed batch`, `storage cannot overwrite a conflicting result stored under another scope`, and `storage rechecks pin ownership after a pin moves during analysis`: the actual PostgreSQL method rejects invalid scope and missing pins, rolls back an earlier valid write, leaves the foreign conflict row unchanged and rejects stale pin placement. |
| R3: Preserve legitimate scanning | Existing session access, provider requests, crops, response format and result updates are retained. | Same suite, case `an approved editor can scan and update authorized pins through both routes`: real handlers, disposable PostgreSQL schema and real Sharp crops with mocked image transport/provider produce 200 responses, insert results on both authorized photos and update the existing result ID; victim data stays unchanged. |

## Detection and limits

With the old handlers, the forged-pin HTTP requests proceed to image transport
instead of returning 400. With the old storage method, mixed forged writes update
the victim and inconsistent conflict rows instead of rejecting and rolling back.
The assertions therefore detect the reported vulnerability at its owning
boundaries, rather than relying on source-string checks.

The pin-move fixture controls the state change between request authorization and
persistence; it does not claim to simulate real AI timing. Shared database locks
protect the final check/write interval. HTTP fixtures run the real authentication,
approval, capability and editor authorization middleware with a test Clerk identity;
they do not contact Clerk or bill an AI service. Disposable test schemas are removed.

## Validation evidence

The bound workload is `test-standard` from `docs/validation/manifest.json`,
including typechecking and the registered unit command containing these cases.
Use the gate's revision-bound run record and `gate:history` for observed status,
commands, target and captured step output. Planned assertions are not a claim of
passing validation; only the completed bound run supplies that evidence.
The changed API requires authentication, so a public preview screenshot cannot
verify the signed-in scan UI; production HTTP and PostgreSQL tests cover this fix.
