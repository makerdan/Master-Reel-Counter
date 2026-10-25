---
name: Task checkout merge visibility
description: Merged-task notifications do not prove that the assigned task checkout includes those changes.
---

Compare the assigned checkout's source and lockfile with the expected fixes before assuming that merged-task notifications have updated its code.

**Why:** A retry after dependency-repair tasks were reported merged still used the older vulnerable versions in both the checkout's lockfile and installed packages. The notifications alone did not establish code availability in that task environment.

**How to apply:** When retrying after other tasks merge, inspect the relevant files and installed-versus-locked versions. Report a checkout synchronization prerequisite rather than repeatedly testing the same old snapshot or silently replacing unrelated dependencies.

Merged status also does not establish availability of environment-local sealed
plan files in main. Check those separately before historical continuation.

**Why:** merged records have remained accessible while their local plan files
were absent; native completion did not supply that execution prerequisite.

**How to apply:** use the existing exact-plan recovery route only for the
affected task when continuation is authorized. Do not re-provision its identity,
copy an isolated ledger or declare other tasks blocked because its file is absent.
