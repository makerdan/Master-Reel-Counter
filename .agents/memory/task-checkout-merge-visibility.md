---
name: Task checkout merge visibility
description: Merged-task notifications do not prove that the assigned task checkout includes those changes.
---

Compare the assigned checkout's source and lockfile with the expected fixes before assuming that merged-task notifications have updated its code.

**Why:** A retry after dependency-repair tasks were reported merged still used the older vulnerable versions in both the checkout's lockfile and installed packages. The notifications alone did not establish code availability in that task environment.

**How to apply:** When retrying after other tasks merge, inspect the relevant files and installed-versus-locked versions. Report a checkout synchronization prerequisite rather than repeatedly testing the same old snapshot or silently replacing unrelated dependencies.
