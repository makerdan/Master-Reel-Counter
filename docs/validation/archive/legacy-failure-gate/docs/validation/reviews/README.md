# Project-local Failure Gate review records

This directory holds decisions **made and added by a designated human reviewer,
not the task agent**. The roster is `docs/validation/reviewers.json`; its
current project-local ID `reviewer-primary` is explained in
`docs/validation/reviewer-designation.md`. Neither a name typed by the caller
nor a draft review request is an approval. Roster and record authorship are
procedural: Git tracking and local checks do not attest human identity or
prevent someone with write access from changing the files.

Each decision is a tracked file named
`docs/validation/reviews/<review-id>.json` (letters, numbers, `_` or `-` in
the ID). Its `reference` is that exact path. It must be formatted as
`JSON.stringify(record, null, 2) + "\n"` with these fields:

```json
{
  "version": 1,
  "reference": "docs/validation/reviews/example-review.json",
  "namespace": "project-local-namespace",
  "reviewer": "designated-human-id",
  "decision": "approved",
  "action": "activate",
  "reviewedAt": "2026-09-28T12:00:00.000Z",
  "subject": {
    "taskId": "project-local-namespace:allocated-id",
    "expectedVersion": 0,
    "config": {}
  },
  "subjectDigest": "sha256-of-exact-subject",
  "scope": {
    "taskId": "project-local-namespace:allocated-id",
    "planReference": "docs/validation/plans/reviewed-plan.md",
    "planVersion": 1,
    "planDigest": "sha256-of-reviewed-plan",
    "authorizedTier": "reviewed-registered-tier",
    "tierDefinitionDigest": "sha256-of-reviewed-tier",
    "parametersDigest": "sha256-of-reviewed-parameters",
    "policyVersion": "reviewed-policy-version",
    "policyDigest": "sha256-of-reviewed-policy",
    "authorizationVersionBefore": 0,
    "authorizationVersionAfter": 1
  }
}
```

The example above is **not** a usable approval. The reviewer must inspect the
actual plan and governing inputs, write the exact request and scope, and add the
record in a Git commit. The coordinator reads both files from the **same
committed revision** and checks
the complete subject, its digest, all explicit scope fields, the registered
reviewer, action, decision and reference inside its transition transaction.
Both files must also match the committed bytes in the working tree at the time
of the check; staging alone cannot authorize them. The applied decision's
record digest and source commit are retained separately in the coordinator's
append-only evidence table. An approved committed record remains a decision
from that revision even if a later commit changes the working copy; this
cooperative workflow does not automatically detect or attest revocation.
Changed plans, tiers, parameters, policy, or authorization versions need new
decisions. A record for rejection authorizes the rejection action only.

The reviewer is designated, but no actual decision record has been supplied.
This does not enable the ordinary activation CLI or local completion. In
particular, a SQLite transaction alone cannot coordinate file writers through
final input verification, evidence assessment, and terminal write. Until all
relevant project writers participate in a verified common boundary, completion
and live cutover remain blocked.