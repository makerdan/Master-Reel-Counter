# Follow-up Tasks — canonical customization

Install the complete directory at .agents/skills/follow-up-tasks/. This is a
project customization, not a replacement of the platform-managed .local skill.
Leave .local untouched. Add explicit project source selection and reconcile
conflicting project guidance; no file installation guarantees Agent adoption.

Read SKILL.md and reference/installation-contract.md. The latter defines a
non-publishing walkthrough. It must not create tasks, reserve IDs, consume an
offer, mark tasks obsolete, or invoke completion/approval operations.
Actual higher-priority rules, callback schemas and platform limits still govern.

Selected contract identity: e8b956730577eddd0dc46d48f5c87b041e4047d5a47c83806ac8c34220e5aafe
Identity covers core, normative installation reference and policy tests. Sort
relative paths, concatenate path + NUL + lowercase file SHA-256 + LF, then SHA-256
the UTF-8 string. Track the selected identity through actual project policy;
the manifest is content metadata, not approval, adoption or platform enforcement.

Run the package policy tests through the applicable authorized bounded route:
node --test .agents/skills/follow-up-tasks/tests/policy.test.mjs
These are text-artifact tests, not an implementation of the task API.

No Unified/Regression Guard installation or upgrade is intrinsically required.
Determine their adoption independently. If an older adopted contract conflicts
with draft publication, report the specific conflict and use an authorized
compatibility change; do not silently bypass it or claim this file repaired it.
Preserve old tasks, links, attempts, seals, records and history.

## Example project instruction

Merge into the actual instruction surface without overwriting unrelated rules:

## Follow-up task guidance

Before preparing or displaying follow-up suggestions, read
`.agents/skills/follow-up-tasks/SKILL.md` and its applicable normative reference.
Use this canonical project customization alongside current platform instructions.
Do not edit `.local` runtime copies, claim to disable their loading, or override
higher-priority rules or actual tool schemas. If a relevant conflict remains,
report it before publication rather than using a fallback creation route.
Determine Unified and Regression Guard adoption separately; prepare complete
proposals without unnecessary ledger writes, then perform applicable execution
admission before implementation. Preserve the dedicated follow-up route, parent/
category linkage, batch and one-shot limits, standalone offer requirement and
uncertain-outcome safeguards. No installation test may publish dummy tasks or
consume the real follow-up opportunity.


No live project, runtime mirror, shared library or native task was changed by
creating this package. Historical sources/results are preserved in the kit review
directory and are not active instructions.
