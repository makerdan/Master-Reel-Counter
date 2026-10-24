---
name: follow-up-tasks
description: Propose reviewable native drafts with Regression Guard coverage; require local admission before execution, preserving dedicated follow-up routes and limits.
---

# Follow-Up Tasks

As you work, identify genuine separate units of work related to the current task
but outside its scope. Do not create extra work merely to fill a suggestion quota.
Required current-scope work and acceptance failures stay with the current assignment;
do not relabel them as follow-ups to claim completion. A genuine approved scope
deferral preserves its unresolved status and actual authorization.

## Categories and titles

- **`incomplete_scope`**: Original scope intentionally deferred.
- **`next_steps`**: Useful next functionality or unmet needs.
- **`tech_debt`**: Material shortcuts or code-quality issues.
- **`test_gaps`**: Concrete tests outside the current deliverable.
- **`custom_analytics`**: A meaningful website interaction/outcome lacks custom
  instrumentation. Read `project-analytics` before proposing; if unavailable, do
  not propose it. Tell the next Agent to read it before editing.
- **`new_artifact`**: A new web, mobile, slides or video artifact alongside the
  project. Require evidence of a concrete unmet user need; an absent mobile
  artifact alone is not justification. Check existing artifacts first; do not
  propose a kind already present. Set `artifactKinds: ["web" | "mobile" | "slides" | "video"]`.

Use non-technical, impact-first titles that name concrete value or risk, including
for tech debt and test gaps. Ask whether a non-technical user would understand why
the work matters.

Prefer “Catch [specific regression] before it ships,” “Confirm [critical flow]
still works after [change],” or “Prevent [bad outcome] when [edge case happens].”
Avoid “Add automated tests,” “Improve coverage,” “Refactor better,” or a generic
“Add a dashboard/report/export.” For example, replace “Add server-side validation”
with “Prevent broken records from being saved.”

## Before suggestions are shown: proposal completeness checkpoint

The proposal call displays tasks to the user. Perform these checks **before**
calling it, not after approval or Start. Read the project's adopted policies and
their canonical sources; an installed skill alone does not prove adoption.
Where adopted, use `.agents/skills/failure-gate-unified/SKILL.md` and
`.agents/skills/regression-guard/SKILL.md`, not mirrors or historical definitions.
If an adopted contract is unavailable, report that prerequisite; do not silently
disable it. Projects without those policies retain their normal planning rules.

Determine adoption separately for Failure Gate Unified and Regression Guard.
If only Regression Guard is adopted, require its classification/coverage and the
actual host planning rules, not Unified IDs, ledgers, seals or tiers. If only
Unified is adopted, follow its actual coverage obligations without silently
installing another skill. If neither is adopted, use the actual host policy.
A definition's presence alone does not establish adopted enforcement.

For every ordinary implementation follow-up, apply these conditional checks:

1. **Investigate and classify.** Check current tasks for overlap and inspect enough
   actual code to scope actionable work. Identify every material component, not
   just the title or category. A `test_gaps` label does not make a material repair
   self-satisfying; unrelated additive work cannot exempt changed behavior.
2. **Prepare the applicable proposal.** When Unified is adopted, prepare an
   unadmitted native draft. Inspect the baseline catalog and exact
   applicable suite/test/signature records. Mark it `UNADMITTED_NATIVE_DRAFT`;
   prepare a complete plan and one intended adequate registered tier, not yet bound.
   Do not invoke a writing provisioner just to propose work.
   Inspect the tier's actual workload, definition and supported invocation; record
   the coverage rationale. Missing or malformed baseline data is not “None known.”
   An unavailable adequate workload is not permission to choose weaker coverage.
   Without Unified, use the actual host's proposal and validation format; do not
   invent Unified-specific declarations or admission machinery.
3. **Prepare applicable Regression Guard coverage.** Where adopted or required by
   the governing contract, record the governing revision,
   classification and scope-based rationale. Qualifying work needs exactly one
   `## Regression Guard` section: concrete recurrence, appropriate test/check file
   and case, and observable detecting assertion; or a justified permitted N/A; or
   genuinely pure-test-only self-satisfaction. Wholly excluded work records its
   rationale without forcing a normal section. Review the affected boundary and
   assertion semantically—keywords and file names do not prove coverage.
   Planned tests are not delivered tests. Deferral requires a real committed
   follow-up owning the recurrence and verifiable applicable approval; proposed
   suggestions, pasted references or caller approval claims cannot supply that.
   A permitted deferral form does not establish a supported local admission route.
   If commitment or authorization cannot be established through actual capabilities,
   keep that deferral unresolved; ordinary covered work does not need a new service.
4. **Validate every proposal.** Supply the complete sections, guard form and
   revision metadata required by the actual adopted policy through its supported
   draft route. Under Unified this includes baseline and Validation declarations. Emit any required classification announcement before
   publication. Validate candidate declarations without ledger writes. Invalid,
   missing, contradictory, duplicate or placeholder declarations block publication.
   Never rewrite sealed plans or retrofit historical tasks to make admission pass.
5. **Check the dedicated publication capability and complete batch.** Before the
   one-shot call, verify its supported fields and payload limits. No custom
   publication/readback/association or native-approval evidence is required.
   Custom publication intent, exact host readback and a separate association route
   are not prerequisites. Missing custom readback or association integration alone
   does not block publication.
   Under Unified every ordinary item is explicitly an unadmitted native draft
   or already admitted. In other hosts use the actual supported plan format;
   every complete payload must fit. Initial publication carries complete scope
   and applicable declarations/preflight instructions using actual supported fields.
   Under Unified include baseline, intended tier and applicable guard, or complete
   admitted content with its actual ID, revision/hash and contracts. Where required, include retrieval context for the
   requirement-to-delivery handoff. No unsupported fields, truncated contract,
   pointer-only substitute, placeholder task, fabricated native reference or
   fallback to general task creation. Keep any governing local sealed revision retrievable; do not create one solely
   because this skill is installed.
6. **Refuse incomplete publication.** If any intended item lacks required
   draft declarations or the required dedicated host capability, do not call the proposal
   API for that batch. Report the precise blocker in chat, not as a purported
   implementation task. Preserve consumed reservations. Correct candidates before
   the single call; do not spend it on a partial or diagnostic batch.

Failure Gate's authentic owner-directed gate-maintenance exception remains its
own contract. It does not admit ordinary product follow-ups or let a suggestion
authorize gate changes. Clearly distinguish a prerequisite/diagnostic record from
an admitted implementation task.

## Dedicated proposal route and limits

Before marking an assigned task complete, propose **up to 3** highest-impact
follow-ups in **one** `proposeFollowUpTasks` call—not `bulkCreateProjectTasks` or
`createProjectTask`. Preserve its automatic current-task parent linkage. Each item
needs a clear title, complete description and required `category`, with relevant
paths and enough context for another Agent to work independently.

Do not propose overlapping tasks, trivial work, current-scope work or Agent
housekeeping such as updating instructions, comments or documentation; handle
housekeeping inline. If the assignment already lists downstream dependent tasks,
skip the proposal call entirely.

The API is **one-shot per assigned project task**, not per turn, feature or
`markTaskComplete` cycle. Never repeat it after uncertain or partial outcomes.
Retain observed attempts and reconcile uncertainty using available platform
capabilities; unresolved outcomes are not success and do not justify another
create. Preserve parent/category and duplicate-avoidance constraints. Do not
reseal or treat creation as authorization. There is no custom association,
readback or approval ceremony. Ordinary task approval authorizes the Agent,
who remains responsible for cancellation and scope changes; local guards do not
independently authenticate native state or intercept platform actions.

Do not manufacture host support with environment flags, fixture results or a
general creation adapter. Use only actual supported host capabilities; this
safeguard does not introduce custom host-evidence prerequisites.

If completing the same assigned task again, review existing suggestions and use
`markFollowUpTaskObsolete` for genuinely stale ones; do not propose a second batch.

## First action after Start and delivery

The executing Agent's **first action after Start** is the applicable preflight,
before implementation or validation workloads. Inspect actual scope, eligibility,
authorization and the independently adopted contracts. Recheck actual native/local
agreement and governing declarations where those exist. Under Unified, inspect the
baseline and assigned workload, then provision and seal unadmitted drafts only in
the writable execution environment before implementation; stop on missing capability.
With Regression Guard alone, assess its guard and the actual host execution rules;
do not create Unified identities, seals or tiers.
Reuse adequate declarations; prepare and apply
supported amendments where existing authorization covers them. Ask only for
uncovered decisions. Start is not blanket approval of changed scope.

If a gap appears mid-task, pause affected work, preserve observations, establish
no conflicting run remains active, amend through the supported route and recheck
before proceeding. Never edit a sealed plan in place or claim retrospective
authorization. Preserve historical identities and governing rules.

Maintain the governing policy's required delivery evidence. Where Regression
Guard applies, maintain its required revision-bound requirement-to-delivery handoff:
planned guard/exception, actual file/case/assertion or evidence, tested target,
results and gaps. Keep it outside any sealed plan; do not invent a seal or second ledger. Separate read-only verification is
optional unless selected or already required; do not create a reviewer prerequisite.
When Unified applies, use the assigned bound workload and report
PASS/FAIL/BLOCKED/INCOMPLETE honestly; a plan guard PASS or native Done status is not test delivery.

These are cooperative pre-publication and Agent-first checkpoints, not native
Start interception, a platform hook or tamper-proof enforcement.

## Standalone sessions

The same title/category, duplication, admission and publication checks apply when
there is no assigned task, with these additional restrictions:

- Call `proposeFollowUpTasks` only when the system reminder explicitly offers it
  and useful work qualifies. Use one call per offer, up to 3 items, respecting any
  tighter current system limits.
- Standalone suggestions may be archived automatically. Do not mention them unless
  asked; then describe automatic archival as archived suggestions, not cancelled
  work. `CANCELLED` alone does not establish its cause. Honor explicit cancellation.
- `markFollowUpTaskObsolete` only retracts assigned-task follow-ups. Users dismiss
  standalone suggestions, so propose only work worth their attention.

## Callback shape

The actual callback is `proposeFollowUpTasks({ tasks: [...] })`; each task has
`title`, `category`, `description`, and `artifactKinds` only where applicable.
Use the supported live schema, not invented gate fields. In adopting projects,
`description` must carry the complete reviewable draft or admitted content and context.
This callback shape is not an ungated executable example. Do not call it until
the proposal completeness checkpoint above succeeds for the complete batch.

For assigned-task obsolete follow-ups, use
`markFollowUpTaskObsolete({ taskRef: "#12" })` with the actual retained reference.


## Canonical source selection and runtime-managed guidance

Read [the installation and adoption contract](reference/installation-contract.md)
when installing, updating or reconciling this customization. It is normative.
The platform may load a runtime-managed `.local` skill alongside these instructions.
Do not edit, replace or claim to suppress that runtime copy. Keep the customization
under `.agents/skills/follow-up-tasks/` and explicitly select it in project guidance.
Project instructions cannot override higher-priority rules or actual callback limits.
If an unresolved instruction conflict affects publication, report it before the
affected call; do not silently use a less restrictive route.

Copying the file is installation, not proven Agent adoption or host interception.
Use a non-publishing source-selection walkthrough and policy tests to document
their actual limited evidence. Neither is proof of future Agent compliance.
Never publish dummy tasks, consume an offer, or mark real follow-ups obsolete just
to test installation. Native callback availability must be established separately.


## Evidence and migration boundaries

Policy text tests check the instruction artifact, not semantic coverage decisions,
native API behavior, approval, duplicate-free creation or platform enforcement.
Negative text fixtures may detect reintroduced sealing-before-publication or
custom-host-evidence requirements without invoking any platform callback.

Preserve historical handoffs and their tested revisions; add a current reconciliation
record rather than rewriting old results. Update stale test expectations with the
approved draft/execution boundary, not by deleting safety assertions until green.
Track the core, normative reference and policy tests as one selected package revision
through the actual project's supported mechanism. No new registry or receipts service.
Existing native tasks, parent/category links, attempt state, consumed identities,
seals, ledgers and execution evidence remain unchanged by definition migration.
