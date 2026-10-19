# Failure Gate compression preview

## Handoff

- **Candidate label:** `P3 — Complete candidate`
- **Preview mode:** preview only; no approval to modify the authoritative source
- **Canonical source:** `.agents/skills/failure-gate/SKILL.md`
- **B0 snapshot:** `B0-SKILL.md`
- **Candidate text:** `P3-candidate-SKILL.md`
- **Preview directory:** `skill-previews/failure-gate/candidate-2026-09-16-a/`
- **Baseline SHA-256:** `65208c6217e38553f42912f8d07c2bc3e0acc38718a6852f437e93a118086c6a`
- **Candidate SHA-256:** `b49f13191ab263e0547b77eea3b19b8f176cd911bbfa113bb74e7000603cff15`
- **Baseline size:** 419 lines, 18,865 bytes
- **Candidate size:** 381 lines, 16,450 bytes
- **Source status:** unchanged during review; canonical source hash equals the B0 snapshot hash

The candidate preserves frontmatter, identity, trigger metadata, referenced
resources, executable behavior, and the repository adapter. It changes only
instructional wording in the preview. The canonical source, runtime mirrors,
tests, tier definitions, metadata, and published archive were not changed.

## B0 — Baseline

The complete immutable baseline is stored at `B0-SKILL.md`. It was copied from
the canonical source before candidate drafting and verified by the baseline
hash above. All candidates and review decisions compare against this snapshot
and the immediately preceding candidate.

### Protected source boundary

- Frontmatter is protected identity and trigger metadata.
- The instructional-text boundary is after the closing frontmatter delimiter.
- Default scope is instructional text only.
- `.local/custom_skills/` is a generated runtime mirror and is not a write
  target.
- The baseline source must be re-captured and the workflow restarted if the
  canonical hash changes.

## Invariant Ledger

| Area | B0 evidence and preserved invariant | Status |
|---|---|---|
| Triggers | Applies at plan time and execute time; the frontmatter trigger remains unchanged. | explicit |
| Requirements | Baseline ownership, validation ceiling, fail-closed locking, exact matching, lifecycle status, completion handoff, and immutable audit semantics remain required. | explicit |
| Workflow steps | Plan discovery precedes plan creation; execute-time locking precedes validation; failure classification is ordered; completion and terminal reporting follow classification. Required announcement and regression-guard handoff remain. | explicit |
| Safety and authorization | No silent waivers, no tier escalation, no audit weakening, no unsafe baseline promotion, no direct runtime-mirror edits, and no task-agent `--allow-no-plan` bypass. | explicit |
| Inputs | Plan, registered tier, baseline catalog, memory/evidence, task revision, suite/test/signature, and host-specific adapter data remain the required inputs. Ambiguous or missing plan/tier data fails closed. | explicit |
| Outputs | Baseline/validation plan sections, required announcements, self-classification log, terminal step statuses, named not-reached steps, maintenance report, and completion handoff remain specified. | explicit |
| Exceptions | Intermittent retries, unknown or stale records, incomplete results, exhausted completion polling, ad-hoc validation, archive inspection, and regression-guard N/A/self-satisfying cases remain distinct. | explicit |
| Escalation | Stop for missing plan sections, tier-lock violations, insufficient evidence, invalid records, unresolved source changes, and failed completion validation; ask or obtain evidence rather than infer. | explicit |
| Tool/file constraints | Host adaptation is separate from portable requirements; canonical tracked surfaces and generated assets are named; `.local/tasks/` remains environment-local and bulk archive repair remains out of scope. | explicit |
| Identity/metadata | `name`, `description`, frontmatter structure, and source identity are unchanged. | protected explicit |

No B0 contradiction was silently resolved. The terms “task validation,”
“completion validation,” “baseline,” “incomplete,” “not reached,”
“self-classified,” and “audit” remain deliberate domain terms.

## Brainstorm-and-iterate Round 1 — safe opportunities

Reviewed B0 and the ledger for duplicated contract language, hidden
assumptions, weak boundaries, and human-error paths.

Accepted into `C1`:

1. Combine the opening purpose and the test/non-test distinction without
   removing the plan/execute trigger.
2. Consolidate repeated statements that a host may change paths but not
   semantics.
3. Keep one authoritative description of terminal step statuses while retaining
   the operational classification rules.
4. Replace repeated explanations of task versus completion validation with a
   compact distinction plus the polling-limit rule.
5. Keep concrete commands, paths, exact markers, and hard-gate wording where
   they are executable contract.

Rejected:

- Remove the repository adapter as “non-portable”: it is explicitly labeled
  host-specific and is required for this host's adaptation.
- Replace exact baseline suite/test/signature matching with “known failure”:
  that weakens ownership and allows unrelated failures to be ignored.
- Collapse all non-test failures into “validation failures”: audit integrity and
  harness incompleteness have different handling.
- Remove the required announcement and code blocks as examples: they are
  exact interchange/output contracts.
- Rewrite `unknown`, `needs-review`, `intermittent`, and
  `environment-limited` as one “inactive” state: lifecycle distinctions are
  safety-relevant.

`C1` retained every ledger entry and became the starting point for Round 2.

## Brainstorm-and-iterate Round 2 — challenge and iterate

Independently challenged `C1` against B0 and the ledger for precedence,
omissions, ambiguous references, authorization implications, and accidental
scope expansion.

Accepted into `C2`:

1. State explicitly that an active baseline match may either be skipped when
   unrelated or repaired when the plan owns it.
2. State that three failed retries are evidence of consistency, not ownership.
3. Keep the two-factor evidence gate in a numbered order.
4. Keep separate bullets for incomplete and not-reached work and require every
   not-reached step by name.
5. Keep the source-change restart rule in the durable baseline handoff.

Rejected:

- Use “retry until stable”: it removes the exact retry count and can turn
  repeated failures into an unsupported ownership claim.
- Say “all remaining errors must be handled”: it obscures the three allowed
  completion outcomes.
- Replace “host-defined ad-hoc/non-task escape hatch” with “local override”:
  the latter implies an unbounded bypass.
- Move audit integrity into the general test-failure paragraph: this hides the
  no-waiver rule.
- Remove the regression guard's concrete N/A reasons: “not applicable” alone
  is an unsafe escape hatch.

`C2` was demonstrably safer than C1 and was used for the ordered passes.

## Ordered compression passes

### Pass 1 — Remove redundancy (`P1`)

Compared C2 with B0 and the immediately preceding candidate. Removed repeated
explanations around portability, plan scaffolding, tier-lock mechanics,
completion validation, and maintenance reporting. Kept every concrete
command, status, marker, exception, and ownership rule. No invariant changed.

Rejected shorter alternatives that merged conditions where precedence mattered,
especially the baseline ownership cases and incomplete/not-reached reporting.

### Pass 2 — Clarify decision boundaries (`P2`)

Compared P1 with B0 and C2. Made the active-baseline split, evidence gate,
retry meaning, completion-polling outcome, ad-hoc escape hatch, and
regression-guard validity conditions explicit. Preserved the distinction
between task validation and completion validation. No unresolved ambiguity was
silently generalized.

Rejected replacing “registered `test` kind” with “test-like step,” because the
host registry's kind is the authority for baseline eligibility.

### Pass 3 — Polish language and ordering (`P3`)

Compared P2 with B0 and the prior candidate. Improved parallel structure and
scanability, moved repeated caveats next to the rule they constrain, and
retained concrete domain terms. Required counts, gates, stop conditions, and
scope did not change. The complete result is in
`P3-candidate-SKILL.md`.

Rejected a final word-count cut because it would remove one of the explicit
exception, escalation, or output boundaries.

## Adversarial acceptance checks

| Check | Scenario and ledger coverage | Result |
|---|---|---|
| Concise target | A future agent reads only the shortened skill and must still find triggers, baseline rules, validation ceiling, terminal statuses, and preview/approval boundaries. | Pass; all remain explicit and contract phrases were scanned. |
| Safety-sensitive target | An agent tries to ignore a mismatched test, waive an audit, use an expired record, or bypass a task lock. | Pass; exact matching, lifecycle restrictions, audit integrity, and fail-closed lock remain mandatory. |
| Procedural target | An agent creates a plan, locks a tier, retries a failure, classifies ownership, and reports completion. | Pass; order, exact retry count, two-factor gate, announcements, and handoffs remain executable. |
| Exception-heavy target | A retry passes, a runner times out, a later step never starts, completion polling exhausts, or an ad-hoc caller runs. | Pass; intermittent, incomplete, not reached, completion-incomplete, and explicit ad-hoc cases remain distinct. |
| Contradictory target | A reader encounters portable requirements alongside repository-specific paths. | Pass; the adapter is explicitly host-specific and portability remains separate. No B0 contradiction was hidden. |
| Domain-specific target | A reader interprets baseline, tier lock, audit, `test` kind, or Regression Guard. | Pass; terms remain named and their decision boundaries remain defined. |

## Final Review A — semantic fidelity

Compared P3 with B0, the ledger, and all adversarial findings. Every trigger,
requirement, ordered step, safety boundary, input, output, exception,
escalation rule, tool constraint, and file constraint remains present with the
same force and scope. Protected identity and trigger metadata are byte-for-byte
unchanged. **Result: pass.**

## Final Review B — general language

Removed no necessary repository-specific terminology. The repository adapter,
canonical-source distinction, generated mirror boundary, validation commands,
and Failure Gate domain vocabulary are necessary for correct execution and were
retained. No unrelated provider, framework, branding, or workspace assumption
was introduced. **Result: pass.**

## Unresolved risks and findings

- The canonical workspace source for the attached Skill Compression workflow
  was unavailable, so this review used the user-provided complete workflow
  attachment as the governing instruction set. The Failure Gate target itself
  is the tracked canonical `.agents` file.
- The host's exact completion-validation platform interface is referenced by
  contract but not implemented in this skill; the candidate preserves that
  required host adaptation rather than inventing one.
- The phrase “recently merged task” remains host-process dependent, as in B0;
  adopters must define their evidence source during host adaptation.
- No shorter alternative was accepted where it would make a safety or
  precedence decision inferential.

## Recommendation

**Apply** the named `P3 — Complete candidate` only after explicit user approval
that identifies this candidate and after rechecking the canonical source hash
against the B0 snapshot. The candidate passed semantic-fidelity and general-
language review. This task does not apply it.

## Validation

Ran exactly the assigned validation command, `TASK_PLAN_FILE=.local/tasks/task-767.md npm run test-standard`.
The registered `test-standard` tier passed, including the Failure Gate contract
tests, archive parity, manifest parity, and all required standard-tier steps.
The canonical source remained unchanged after validation.

## Change list

### Accepted changes

- Consolidated repeated portability and host-adaptation explanations while
  preserving the separation and fail-closed requirement.
- Reduced repeated task/completion validation wording while retaining ceilings,
  required completion checks, and exhausted-polling classification.
- Consolidated plan scaffold and tier-lock explanations without removing exact
  commands, markers, or stop conditions.
- Reordered related evidence, terminal-status, and regression-guard rules for
  scanning; no precedence changed.

### Materially shorter rejected alternatives

- “Ignore known failures” — rejected because it removes exact
  suite/test/signature matching and lifecycle authority.
- “Retry until stable” — rejected because it removes the required three
  isolated retries and the intermittency-only rule.
- “Validation errors are failures” — rejected because it obscures audit
  integrity and incomplete/not-reached semantics.
- “Use a local override if the plan is missing” — rejected because only an
  explicit host-defined ad-hoc escape hatch may bypass the lock.
- “Regression guard is optional when hard to test” — rejected because it
  creates an unaccepted waiver path.

### Retained wording

- Exact baseline markers, announcement strings, `TIER-LOCK VIOLATION`,
  self-classification output, and terminal status definitions.
- Audit command/threshold/result integrity.
- `unknown`, `needs-review`, `intermittent`, `environment-limited`, and
  `resolved` lifecycle terms.
- Host adapter paths and generated-mirror boundary.
- The two-factor evidence list, exact retry count, and named not-reached rule.

### Unresolved wording and findings

- Host-specific completion-validation and historical-evidence mechanisms remain
  adaptation responsibilities.
- The attached workflow was supplied as the review authority because its
  canonical workspace source was unavailable; no runtime mirror was promoted.
- No semantic contradiction in the Failure Gate baseline was resolved by
  compression.

### Scope and source status

The authoritative source is `.agents/skills/failure-gate/SKILL.md`, and the
scope is instructional-text preview only. Metadata, resources, scripts, tests,
tier definitions, generated mirrors, and the canonical source were not changed.
The durable preview is outside `.local/`, temporary directories, and the
canonical target. Applying the candidate requires explicit approval, a fresh
source-hash check, and a separate apply task.

## Ready-to-use apply-task specification

Create a separate proposed apply task only after this preview passes read-back.
The task must:

1. identify `P3 — Complete candidate` and this exact preview directory;
2. re-read `.agents/skills/failure-gate/SKILL.md` and require the current hash
   to equal the B0 hash above;
3. block and regenerate a preview if the source changed;
4. write only the approved instructional-text scope, preserving frontmatter,
   resources, scripts, tests, tier definitions, and mirrors; and
5. re-read the source and verify it equals the approved candidate within that
   scope before reporting success.
