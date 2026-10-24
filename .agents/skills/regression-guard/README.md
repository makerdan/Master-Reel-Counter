# Regression Guard — canonical replacement package

Install the COMPLETE directory at .agents/skills/regression-guard/ only under an authorized project migration. Delivery does not install or publish it.

Normative files: SKILL.md, reference/enforcement-contract.md and reference/delivery-handoff.md. Read references at their stated triggers. Keep all three together.

PACKAGE-MANIFEST.json records every payload file except itself. canonicalSkillSha256 identifies the core only. normativeContractSha256 identifies all three normative files: sort their relative paths, concatenate each path + NUL + lowercase SHA-256 of its bytes + LF, encode as UTF-8, then SHA-256 hash that string. Pin the selected digest through the actual host's revision mechanism, not solely in a self-editable manifest. This is content identity, not native approval or a new authority service.

Where a host stores only a core hash, adapt it through authorized maintenance before claiming full-package revision enforcement. Preserve old identities/snapshots and historical task rules. Where no machine pin exists, document actual supported revision tracking and its limits rather than claiming a fingerprint is enforced.

Use the matching migration-kit plan and prompt. Inspect actual classification/checker/renderer/amendment/dispatch routes, stage normal and exception forms, keep validation read-only on sealed plans, and record actual delivery. Do not install or migrate Failure Gate Unified solely to use Regression Guard. If Unified is already adopted, compose with its applicable revision and authorized maintenance route. Do not create a second gate, automatically change tiers, or add independent review.

Archive superseded definitions and prompts outside active discovery. Do not delete imported code or historical ledgers by directory name. Remove validation-time auto-stub editing only as a scoped, tested behavior change. The migration itself changes existing enforcement and needs normal guard coverage of those changes; its own bounded maintenance fixtures can supply it without a recursive task chain.

No runtime implementation or automatic installer is included. No deployment, database mutation, runtime-mirror edit or workspace-library publication is authorized by this package alone.
