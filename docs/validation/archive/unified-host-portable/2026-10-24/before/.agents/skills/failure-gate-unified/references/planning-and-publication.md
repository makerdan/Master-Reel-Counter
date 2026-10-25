## Plan-time procedure

Native draft proposals are not admitted execution plans. This is an explicit
policy change, not a reinterpretation of earlier contracts. Mark a draft
`UNADMITTED_NATIVE_DRAFT`; include complete reviewable scope, baseline findings,
one intended adequate tier and coverage rationale, Regression Guard declarations,
and first-action execution admission instructions. No ID or binding is claimed.
Use supported Planner task-file/publication tools without shell ledger writes.
Do not redirect denied writes or require a mode switch just to propose work.
Read-only preparation may validate inputs without reservation, snapshot or binding.
Unknown prerequisites must be stated, not reported as successful admission.

Complete the following before implementation or validation workloads. Follow the
supported provisioner's input order, including supplying a tier/specification
upfront when required; do not impose an impossible "no headings before a plan"
sequence.

1. **Establish scope and coverage.** Inspect the requested change, current
   tier definitions and actual workloads. Choose the lightest adequate
   registered tier and identify its supported invocation. Distinguish tier
   registration, adequate coverage and current execution availability. An
   unavailable required tier is not permission to select an inadequate one;
   record any execution blocker without misrepresenting plan readiness.
2. **Inspect the baseline catalog.** Read and validate
   `docs/validation/failure-baseline.json`; look for exact suite, test, and
   signature matches. Missing, unreadable or malformed data is not an empty
   catalog and must not be reported as "None known." Resolve that prerequisite
   through the supported route before declaring baseline admission complete.
3. **Provision and bind safely.** Use the verified project script to mint the
   unique ID and generate its plan/stubs with exactly one selected tier bound
   through the supported mechanism. Do not fabricate an ID or binding.
    Native references and custom host evidence are not provisioning prerequisites.
    Keep permanent local identity separate from the platform's task reference.
4. **Complete baseline declarations.** Include the following section in every plan,
   including when no failures are known:

   ```markdown
   ## Pre-existing failures to ignore
   None known at plan time. Treat every failure as a potential regression.

   **Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.
   ```

   Replace the default statement with the exact known issues and their required
   `**Ignored baseline:**` or `**Owned baseline repair:**` labels when
   applicable. Do not treat a retry, by itself, as proof that a failure
   predates the task. Use "None known" only after successful catalog inspection
   establishes no applicable known entries, not when inspection is unavailable.
5. **Complete, seal and guard.** Fill in scope, baseline declarations and the
   validation section, then seal through the project's supported mechanism.
   Run local plan guards against that revision and resolve admission errors.

Before treating a draft as an admitted execution plan, confirm the provisioner
generated its unique ID, exactly one adequate registered tier is bound, baseline
declarations are complete, and the sealed plan passes local plan guards.
A diagnostic or prerequisite record is not an admitted implementation plan.

Every admitted plan names exactly one bound tier in the section below. Native
drafts name one intended tier, explicitly not yet bound; do not copy a claim of
binding into an unadmitted draft:

```markdown
## Validation
**Command:** `test-standard`
**Why:** <one-line reason this tier covers the task>
**Coverage evidence:** <current tier definition/workload reference and supported invocation>
**Do not switch tiers:** This task ID is strictly bound to this tier. Other tiers will block execution; changes require a supported amendment.
```

Replace `test-standard` with the chosen registered tier. Keep the rationale
specific to the task.

### Publication and ordinary authorization

A complete reviewable native draft may be published without local admission.
An admitted plan must be allocated, bound, completed, sealed and guarded.
Use the platform's actual supported route and payload limits.
Retain complete local sealed content and revision context for execution and
handoff; native task descriptions are not themselves local seals.

The [authorization and local-enforcement boundary](../SKILL.md#authorization-and-local-enforcement-boundary) governs publication and
execution. Missing custom native integration alone blocks neither publication nor
valid local dispatch. Local JSON and a guard PASS establish neither approval nor
test success.

Do not invent unsupported API fields, publish incomplete plans, truncate required
payloads, fabricate references, or blindly repeat uncertain writes. Preserve
consumed identities and observed attempts; reconcile uncertainty using available
platform capabilities and report unresolved outcomes without assuming success.

### Follow-up compatibility in adopting projects

Ordinary follow-ups obey all applicable Unified requirements from planning and
publication through authorization, execution and closure. Owner-directed gate
maintenance retains its exception; never force gate work through its own admission.
Inspect the host's dedicated follow-up instructions, actual capabilities and
limits. Keep its required route, parent linkage, categories, duplicate avoidance,
one-shot/batch limits and standalone-session restrictions.

Prepare every ordinary item as an explicitly unadmitted native draft or already
admitted plan before a batch call and check each complete supported payload fits.
Include complete reviewable content and retrieval context in the
supported description. Partial or uncertain batches require per-item
reconciliation without repeating the one-shot call. Missing the actual dedicated
route or exceeding its real payload limits blocks that batch; absence of custom
readback/association integration does not. Do not invent fields, truncate required
content, or fall back to ordinary task creation. Platform constraints remain
independent of local plan guards.

