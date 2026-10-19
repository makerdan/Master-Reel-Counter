# Failure Gate Compression Safety

## Outcome
The approved Failure Gate compression is applied without changing required behavior or allowing a stale preview to overwrite newer semantics.

## Covered tasks
- #805
- #806

## Implementation steps
1. Apply the approved compression candidate to the canonical skill source.
2. Compare the preview against current semantics and stop on drift.

## Dependencies
- #767

## Regression hardening
- **Scenario or failure mode:** The source changes after preview generation.
  **Verification approach:** Introduce a controlled semantic mismatch before apply.
  **Specific behavior guarded:** Preview freshness.
  **Expected result:** Apply stops without modifying the source.
- **Scenario or failure mode:** Compression drops a required rule.
  **Verification approach:** Compare required behaviors before and after compression.
  **Specific behavior guarded:** Failure Gate contract parity.
  **Expected result:** Every required behavior remains represented.