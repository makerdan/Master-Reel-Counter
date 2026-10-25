---
name: Validation document fingerprints
description: Prepare delivery records before starting an admitted validation run.
---

Finish new handoff documents and other tracked or untracked deliverables before launching the admitted tier. Do not edit them during the run.

**Why:** The validation target fingerprint includes documentation and newly created files, not just executable application code. Adding delivery notes during otherwise passing checks makes the overall run INCOMPLETE with “tested source changed during execution.”

**How to apply:** Prepare the handoff before dispatch; record final observations after the run finishes, keeping document-only updates distinct from changes to tested application code.

Opening existing development test ports can also cause the platform to add
preview-exposure metadata to `.replit`, without an Agent code edit.

**Why:** Runtime fixtures repeatedly regenerated that metadata after restoration,
so an otherwise passing unit diagnostic had a different final source fingerprint.

**How to apply:** Inspect the actual drift before attributing it to application
changes. Preserve observed test results, disclose the recorder's incomplete
status, and restore unrelated generated configuration outside active validation;
do not repeatedly rerun unchanged assertions solely to chase platform metadata.
