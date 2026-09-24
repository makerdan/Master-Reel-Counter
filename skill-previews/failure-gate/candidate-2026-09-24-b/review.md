# Failure Gate compression preview — P3.1

## Approval status

**Awaiting explicit user approval.** This package is a review preview only.
The canonical Failure Gate source and generated runtime mirror have not been
modified.

## Handoff

- **Candidate label:** `P3.1 — Complete candidate with portability safeguard restored`
- **Canonical source:** `.agents/skills/failure-gate/SKILL.md`
- **Immutable baseline:** `B0-SKILL.md`
- **Original candidate and review:** `P3-candidate-SKILL.md` and `P3-review.md`
- **Corrected candidate:** `P3.1-candidate-SKILL.md`
- **Baseline SHA-256:** `65208c6217e38553f42912f8d07c2bc3e0acc38718a6852f437e93a118086c6a`
- **Corrected candidate SHA-256:** `b807d7bdce7057d6df2bfb117e5cb667c8e6cc32abc35ca60c543bccbc8ba967`
- **Baseline size:** 18,865 bytes
- **Corrected candidate size:** 16,741 bytes
- **Canonical source at review:** byte-for-byte equal to B0; SHA-256 matches the baseline above.

## Revision finding and correction

The original P3 candidate omitted this B0 rule from the portability boundary:

> The concrete paths and commands in **Host-project adapter: this repository**
> are examples for this repository, not universal requirements. Baseline
> records, project memory, tier composition, and application paths must never be
> copied as portable defaults.

P3.1 restores that rule verbatim after the required host-adaptation list. The
rest of P3's instructional content is unchanged; its candidate label comment
now identifies the correction. P3 is retained in this package as review
history, not as an approvable candidate.

## Required-behavior comparison

Compared the corrected candidate with B0 and the prior invariant ledger.

| Required area | P3.1 result |
|---|---|
| Plan-time and execute-time triggers; protected identity and frontmatter | Preserved |
| Portable requirements versus host adaptation | Preserved; P3.1 explicitly restores the no-copy rule for repository-specific defaults |
| Required baseline and validation sections, planner checklist, announcement, and plan guards | Preserved |
| Exact active-baseline matching, lifecycle restrictions, ownership markers, retry count, and two-factor provenance | Preserved |
| Fail-closed task tier lock, validation ceiling, and bounded ad-hoc exception | Preserved |
| Separate task and completion validation, including exhausted polling | Preserved |
| Immutable audit command, threshold, and result; audit failures cannot be waived | Preserved |
| Passed, failed, incomplete, and not-reached outcomes, including named later steps | Preserved |
| Regression Guard ownership, valid self-satisfying/N/A cases, and deferred-guard boundary | Preserved |
| Canonical versus generated files, archive limits, maintenance guidance, and host-specific paths | Preserved |

No required behavior was intentionally dropped, generalized, or assigned a
weaker force or scope in P3.1. Frontmatter remains byte-for-byte identical to
B0.

## Adversarial checks

| Scenario | Expected contract | Result |
|---|---|---|
| An adopter copies the repository's sample paths or baseline data as universal defaults | Host-specific paths, records, memory, tier composition, and app paths are not portable defaults | Pass; explicit rule restored |
| A failure has a different suite, test, or signature from an active record | Do not ignore it based on catalog membership alone | Pass |
| An isolated retry passes | Record intermittency only; do not infer pre-existing provenance | Pass |
| An audit fails or is retried | Preserve the registered command, threshold, and result; do not waive it | Pass |
| A runner returns no valid result and later steps never start | Report incomplete and name later steps as not reached | Pass |
| A task has a missing plan or invalid tier lock | Fail closed; only an explicit host-defined ad-hoc caller may use the bypass | Pass |

## Preview-freshness check

The apply precondition is exact equality between the canonical source hash and
the B0 hash above. A controlled semantic edit was introduced in a temporary
source copy before the apply decision. Its hash differed from B0, so the
precondition blocked application; the temporary source bytes remained
unchanged after the block. The canonical source was not used for this negative
test and remained byte-for-byte equal to B0.

## Validation evidence

- Scoped Failure Gate plan guard: pass.
- Scoped Regression Guard plan guard: pass.
- Corrected-candidate invariant-anchor scan, protected-frontmatter comparison,
  and preview-archive integrity check: pass.
- The first plan-locked `test-standard` attempt is retained as **incomplete**:
  it waited about 284 seconds for the shared validation lock, then the outer
  shell limit expired during typecheck. No valid tier result was produced.
- After confirming the recorded holder and child process group had exited, a
  second plan-locked `test-standard` run with an isolated waiter directory
  passed. The original incomplete attempt remains recorded; the retry does not
  reclassify or erase it.
- The canonical source still matches B0 after validation.

## Apply boundary

Apply only this exact P3.1 candidate after explicit approval and an immediate
recheck that the canonical source still matches the B0 hash. If the source hash
differs, stop and create a new preview. Apply only instructional text; preserve
frontmatter and do not edit generated `.local/custom_skills/` mirrors directly.

The current contract test also anchors one sentence to P3's previous wording
about retry provenance. If P3.1 is approved, update that assertion to check the
equivalent P3.1 wording, then regenerate and verify the published Failure Gate
archive so it remains in parity with the canonical source.

## Recommendation

P3.1 corrects the identified omission and passes the required-behavior and
adversarial reviews above. Request explicit approval of **`P3.1 — Complete
candidate with portability safeguard restored`** before changing the canonical
skill.