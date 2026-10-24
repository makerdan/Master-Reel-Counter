# Historical Port Authority package verification

This report and `validation/run-1.log` / `validation/run-2.log` describe the
pre-compatibility revision only. They are retained historical evidence, not
verification of the current sources. See `COMPATIBILITY-VERIFICATION.md` for
the current Failure Gate Unified compatibility revision.

**Result:** two consecutive complete isolated package runs passed on the delivered
canonical source revision. This is package regression evidence, not application
installation, independent acceptance, runtime authorization or deployment evidence.

## Full runs

Command for each run:

```sh
node .agents/skills/port-authority/tests/hardening.test.mjs --supervised
```

| Check | Run 1 | Run 2 |
|---|---:|---:|
| Tests | 74 | 74 |
| Passed | 74 | 74 |
| Failed | 0 | 0 |
| Cancelled / skipped / todo | 0 / 0 / 0 | 0 / 0 / 0 |
| Reported test duration | 84.518 seconds | 84.853 seconds |
| Outer fixture result | FINISHED, raw exit 0, workloadStopped true | FINISHED, raw exit 0, workloadStopped true |

Runs were sequential, without source edits or manual port/process/lease intervention
between them. Automated private-fixture teardown is part of the tests. Raw evidence
is included as `validation/run-1.log` and `validation/run-2.log` in the package.
The source manifest identifies the delivered canonical files and log hashes.

Environment observed: Linux, Node v24.13.0. The templates retain their Node 20+
requirement, but this authoring did not execute other Node versions or operating systems.
Each supervised run declared a 180,000 ms execution limit, 30,000 ms hardening-test
timeout and 5,000 ms fixture-hook timeout. Default-profile tests also use explicit
per-test bounds. The local independent fixture watchdog registered before user work;
completed outer records report quiescence. These are isolated local controls, not a
genuine checked host runner, full parent-budget policy or hostile-code containment proof.

## Coverage and package checks

- All 58 original advanced runtime behavior-case names are retained. Their private
  fixtures explicitly select the advanced profile; nested tests now use private
  fixture scripts rather than inadvertently invoking a default-profile source.
- Five obsolete policy-text checks are replaced with the reduced contract's identity,
  complete C01–C12 criteria, staging, host-acceptance and genuine-authority boundaries.
  These are documentation checks, not evidence of installed app wiring.
- Eleven executable default-profile cases cover read-only free/busy inventory,
  unsupported reclaim flags, malformed/disabled/production inputs, unavailable authority
  adapters, raw exits, denied resource/priority/reentry, command-argument isolation,
  actual nested rejection, same-file serialization, queue expiry and finite execution.
- All four runtime modules and both test modules passed `node --check`.
- The skill entry point has valid `port-authority` frontmatter, 168 lines, a description
  within its size bound, and existing applicable relative reference links.
- Ten canonical source files comprise one entry point, four runtime modules, three
  references and two test modules. The bundled host adapter remains byte-identical to
  the designated original and deliberately unavailable for genuine authority.

## Initial observations and repair

The first complete authoring run reported 72/74 passing. Two failures were test
adaptation issues: one obsolete wording assertion and one advanced reentry fixture
still invoking a default-profile source. The wording assertion was aligned to the
same preserved no-overwrite rule; the nested fixture was pointed at the actual private
advanced fixture. No runtime safety invariant or expected case was dropped.

A focused check of those repairs and command-argument isolation passed 3/3. The
two complete runs above followed those repairs. Initial and focused counts are
recorded here from the execution transcript; their full raw output was not saved
as package log files. They are not substituted for the two saved complete runs.

## Size and source provenance

Designated original: the supplied October 10 Port Authority ZIP, pinned by archive
SHA-256 and per-member hashes in `SOURCE-MANIFEST.json`; seven original members.
The original upload is preserved, not overwritten.

| Reading scope | Words |
|---|---:|
| Original entry point plus runtime contract | 10,369 |
| Revised default entry point plus core contract | 2,689 |
| Revised instructions including optional advanced and symptom modules | 4,348 |

Default required reading is approximately **74% smaller**. This is a word-count
comparison, not a claim that every integration is cheaper or the lifecycle engine
was reduced. The hardened engine remains substantially intact intentionally.
The original entry point was 498 lines; the revised entry point is 168 lines.

## Not performed / not asserted

- No project was connected, installed into or migrated.
- No live app processes, managed services, production routes or deployed health probes
  were modified; test signals were confined to created private fixture processes.
- No genuine host attestation, checked reclaim provider, validation tier, task registry,
  approval record, automation hook, remote workflow or production deploy was activated.
- No independent reviewer or native dependent confirm task ran.
- No CORE_VERIFIED, ADVANCED_VERIFIED or LIVE_RECLAIM_ENABLED application state is claimed.

Actual adoption must still discover the app's capabilities and policy, implement the
affected real callers, obtain required independent review and run the applicable
authorized host acceptance checks. Failure Gate Unified does not supply live reclaim authority.
