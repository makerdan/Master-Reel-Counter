# Compress Failure Gate Skill

## What & Why
Run the user-selected Skill Compression workflow against the revised canonical Failure Gate skill to produce a durable, correctness-preserving candidate that is clearer and more concise while surfacing loopholes, ambiguities, and missing edge-case guidance.

## Done looks like
- An immutable baseline and complete invariant ledger cover triggers, requirements, workflow, safety boundaries, inputs, outputs, exceptions, escalation, and file/tool constraints.
- Exactly two brainstorm rounds, three ordered compression passes, adversarial checks, and two-stage final review are recorded.
- The complete candidate, diffs, rejected alternatives, retained wording, unresolved findings, and recommendation are saved outside ignored or generated locations.
- The canonical skill and runtime mirrors remain unchanged pending explicit approval of the identified candidate.
- The user receives a durable preview package suitable for review and download.

## Out of scope
- Applying the candidate to `.agents/skills/failure-gate/SKILL.md` before explicit candidate approval.
- Editing metadata, executable resources, tests, tier definitions, or generated mirrors as part of text compression.
- Workspace-wide publication or automatic distribution to other projects.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-standard`
**Why:** The standard tier provides the canonical skill and package contract checks needed to ensure the preview candidate preserves Failure Gate semantics.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Self-satisfying** — this task’s deliverable is the invariant-ledger, adversarial-review, and semantic-fidelity guard for the compressed Failure Gate candidate.

## Steps
1. **Resolve and freeze the target** — Confirm the revised tracked Failure Gate file is the authoritative target, capture the exact baseline, and stop if it changes during review.
2. **Build the invariant ledger** — Account for every trigger, safety rule, validation boundary, exception, output, escalation path, and adaptation requirement before changing wording.
3. **Run the mandated review sequence** — Complete exactly two brainstorm-and-iterate rounds followed by redundancy, boundary-clarification, and language-ordering passes, preserving earlier wording whenever a shorter form weakens the contract.
4. **Challenge the candidate** — Test the strongest candidate against concise, safety-sensitive, procedural, exception-heavy, contradictory, and domain-specific scenarios, then perform semantic-fidelity review before portability review.
5. **Persist and present the preview** — Save the full candidate and review record to a unique tracked preview path outside `.local/`, verify it by read-back, package it for direct download, and request explicit approval of the named candidate without modifying the canonical source.

## Relevant files
- `.agents/skills/failure-gate/SKILL.md`
- `.agents/skills/validation-tiers/SKILL.md`
- `docs/validation/failure-gate-capabilities.md`
- `scripts/__tests__/failure-gate.test.mjs`
