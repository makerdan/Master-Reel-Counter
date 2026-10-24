# Port Authority — capability-scoped canonical revision

Same canonical identity; not Core/Heavy split skills. Install the complete directory
at .agents/skills/port-authority/ only through an authorized migration.

Read SKILL.md and its applicable references. Basic hygiene, conflict serialization
and advanced controls are capability groups, not tiers or separate authorities.
Existing safety semantics and all four runtime modules and two test modules are
unchanged. No process cleanup, service restart, new provider or host activation is
performed by this package. Authorizing a definition installation does not authorize
service disruption or uncertain-lease deletion.

The manifest records file roles. Normative instructions + runtime modules + test
resources form the selected safety-package fingerprint. Sort those relative paths,
concatenate each path + NUL + lowercase SHA-256 of its bytes + LF, encode as UTF-8,
and SHA-256 hash the result. Selected fingerprint: eed2f79de206ef073f333ad26d541d1096919d3bd445a8fd7b672723f245bc2e

Track this through the real project's versioning mechanism; a self-edited manifest
is not a trusted selected pin. Preserve old contract snapshots and historical lease
state. The supplied content checker is not task admission or proof of runtime safety.

Use the migration kit's matching project plan. No Unified or Regression Guard upgrade
is required solely for Port Authority. Preserve the actual adopted host contract.
No independent reviewer is selected. Runtime watchdogs and acknowledgement remain
required runtime mechanisms where applicable, not reviewer requirements.

Previous authoring specifications, manifests, reports and logs are preserved in the
kit's review/baseline directory as historical source, not active adoption authority.
This canonical replacement intentionally excludes those obsolete reports; it retains
all functional references, scripts and tests. Source presence and old fixture results
do not establish new host acceptance. There is no universal automatic installer.
