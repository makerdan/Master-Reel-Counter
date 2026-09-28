---
name: Markdown report-contract boundaries
description: How to keep documentation contract tests focused on the complete report sections they are meant to validate.
---

When prose summaries repeat report labels, contract tests should locate
standalone section headings rather than the first matching phrase. Otherwise,
the test may inspect a short cross-reference instead of the full report
definition. Assert raw status/result fields separately from assessment fields.

**Why:** Repeated labels in a summary caused report-section assertions to
validate the wrong Markdown range during Failure Gate reporting work.

**How to apply:** For tests that extract Markdown report blocks, make section
headings explicit in the guidance and use the complete heading as the delimiter.