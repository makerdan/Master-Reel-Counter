# Network dependency security handoff

## Scope and admission

Task 958 repairs installed-dependency findings F-001–F-003 only. Classification:
material security and compatibility repair, with normal Regression Guard coverage.
Separate independent verification was not selected.

- Unified task: `fdd8da6e-7ac7-4aa2-9477-53f8b6215ec6`, sealed revision **1**.
- Plan SHA-256: `7a5496688fb5b24739ec9e302b3aec0076472ed8d1c3eba04624d443693afb8c`.
- Governing Unified source: `.agents/skills/failure-gate-unified/SKILL.md`;
  its pin and the full sealed specification are retained in
  `docs/validation/unified-registry.json`.
- Regression Guard declaration follows
  `.agents/skills/regression-guard/SKILL.md`; delivery follows its
  `reference/delivery-handoff.md`. No guard installation or historical-contract
  migration was performed.
- `gate:guard -- --tier test-heavy` returned **ADMITTED** before package or
  application edits. The supported provisioner supplied the UUID, plan, stubs
  and binding; no sealed plan was edited manually.
- Baseline catalog was readable, schema version 1, with zero records.
  No ignored/owned baseline or vulnerability waiver was added.
- Assigned tier: **test-heavy**, unchanged `docs/validation/manifest.json`.
  All gate runs used the UUID and its generated `TASK_PLAN_FILE`.
  Enforcement is the cooperative Agent-first preflight and supported runner,
  not interception of arbitrary file edits or the platform's completion checks.

## Delivered dependency paths

| Actual consumer path | Before | Delivered |
|---|---|---|
| Express 5.2.1 → proxy-addr | 2.0.7 | **2.0.8** |
| http-proxy-middleware 3.0.7 → http-proxy 1.18.1 → follow-redirects | 1.16.0 | **1.16.1** |
| express-rate-limit 8.5.1 → ip-address | 10.7.0 | **10.7.4** |

`package.json` uses compatible overrides scoped to the owning Express,
http-proxy and express-rate-limit packages. These establish patched floors
without upgrading the direct consumers or replacing the proxy stack.
`package-lock.json` changes only these three package entries, using public npm
tarball URLs and their registry integrity values. No forced audit fix was used.

Production source, authentication policy, redirect behavior, forwarded-header
handling and trust-proxy configuration are unchanged. Specifically,
`server/index.ts`, `server/middlewares/clerkProxyMiddleware.ts`,
`shared/clerk-config.ts` and `server/__tests__/routes.test.ts` have no task diff.

The new test is wired into `npm run test:unit` and included in
`tsconfig.tests.json`. Full-tier typechecking was not reached after audit failed;
inclusion is not a claim that the compiler check ran.

## Requirement-to-delivery map

All new cases are in `server/__tests__/dependency-network-security.test.ts`.

| Requirement | Actual detecting assertions | Observed evidence / remaining limits |
|---|---|---|
| R1: prevent vulnerable copies returning through actual consumers | `createRequire` starts at Express, http-proxy-middleware → http-proxy, and express-rate-limit entry points; checks stable compatible-major patched floors. Every matching lockfile entry and its installed metadata are also checked. | Unit diagnostic passed; fresh install passed all seven new cases and `npm ls` showed all three patched paths. Fresh-install audit has no entries for these three packages. |
| R2: prevent mapped IPv6 proxy-trust bypass | Short mapped `/8` and zero-leading `::/1` prefixes, each in single- and multi-subnet trust configurations, reject plain IPv4 and mapped IPv6 outside the named network. A forged forwarded address cannot replace the untrusted socket address. Positive controls accept in-range IPv4/mapped candidates under correct `/104` and IPv4 `/8` ranges. | Passed in unit workload and clean-install fixture. A local Express request separately proves default trust remains false and ignores forged `X-Forwarded-For`. Test-specific trust functions do not enable trust in the app. |
| R2: prevent mixed-family subnet acceptance | Both `isInSubnet` and `isHostInSubnet` reject IPv6 `a00::1` against IPv4 `10.0.0.0/8`, and IPv4 `32.0.0.1` against IPv6 `2000::/3`. Same-family positive controls still pass. | Passed through limiter-resolved ip-address, including fresh install. These are the advisory's coincident-leading-bit triggers, not merely unrelated addresses. |
| R2: bound oversized address diagnostics | A separate Node child parses 32 MiB of invalid IPv6 characters. Validation returns false; constructor throws `AddressError` with message and optional diagnostic shorter than 512 characters. Child has 128 MiB old-space cap, four-second kill deadline, bounded captured output and no inherited application environment. | Passed in unit workload and fresh install (child case approximately 124 ms in fresh install). Old vulnerable diagnostics expand each invalid character; the memory/error assertions detect that recurrence without installing vulnerable packages into the app. |
| R3: prevent cross-origin credential forwarding | Two loopback HTTP servers on distinct ports exercise consumer-resolved follow-redirects. Separate array-form and object-form requests carry built-in Authorization, Proxy-Authorization and Cookie plus declared `X-Control-Key`, `X-Api^Key` and `X-Token\|Secret`. Source must receive all; destination must receive none. Public and collateral `X-Token`/`Secret` names must survive literal filtering. One request reaches each server; redirects and deadlines are bounded. | Both cases passed in unit workload and fresh install. Only synthetic local fixture strings are used; no Clerk calls or credential output. Redirect following is exercised only in these library fixtures, not enabled in the app. |
| R4: preserve Clerk lifecycle/framing/header contracts | Existing production-proxy tests retain request forwarding, multi-chunk payload/header framing, connect and response timeouts, downstream abort and sanitized failure assertions. | Unmodified `routes.test.ts` ran in the passing 170-test unit diagnostic. Supervised `release-schema-contract` also passed. Signed-in browser UI and production exploitation were not verified; neither is claimed. |

The behavioral triggers above match the advisory mechanisms: incorrect
cross-family leading-bit comparisons, unbounded per-character diagnostics,
array-index header filtering and missing regex escaping. Positive controls
prevent blanket rejection or removal from masquerading as correct behavior.
No vulnerable package was reintroduced as a negative control.

## Execution evidence — 2026-10-21

Gate observations, including content-based target hashes, output hashes,
exit status and bounded excerpts, are retained in the tracked registry.
Local raw evidence paths below are environment-local, not portable artifacts.

| Execution | Result |
|---|---|
| `gate:run -- --tier test-heavy --step unit-tests` — run `13fa4af6-2da3-4aa9-8270-ba672f1de8ab` | Step **PASS**, exit 0, **170 passed**, zero failed/skipped/cancelled, about 8.5 seconds. Diagnostic overall is **INCOMPLETE**, intentionally not full-tier PASS. |
| Disposable clean install | Copied only package metadata/lockfile and the new test into a fresh `/tmp` directory. `npm ci --no-audit --no-fund` installed 799 packages in 13 seconds, with lifecycle scripts enabled and a 180-second outer deadline. The seven new cases all passed, zero skipped/cancelled, in about 0.5 seconds. Temporary installation was removed. |
| Clean-install `npm audit --json` | Exit **1**; no proxy-addr, follow-redirects or ip-address findings; **15 remaining findings: 0 critical, 10 high, 5 moderate**. |
| `gate:run -- --tier test-heavy --step release-schema-contract` — run `6f0c4d92-52c2-4d63-a38b-edd1832c1e43` | Step **PASS**, exit 0, about 19.7 seconds. Diagnostic overall **INCOMPLETE**, not full-tier PASS. |
| `gate:run -- --tier test-heavy` — run `9fd521f3-0ac7-4f70-97cf-b11ebaa3d1e6` | **FAIL**. Startup smoke passed. Startup boundary process passed (13 passed, one CI-only database test skipped). `security-audit` exited **1** with 15 remaining findings. |
| Development preview | Restarted the managed Start application workflow; server became ready on port 5000. Screenshot showed the public landing page. Anonymous `/api/auth/user` returned expected 401. Clerk development-key and PostCSS warnings remain; signed-in UI was not inspected. |

The full run did **not reach** schema-check, release-schema-contract,
workspace-skill-contract, typecheck, storage-lint, port-reference-scan,
storage-lint-contract, unit-tests, vite-hmr-tests, vite-hmr-recovery-tests,
serial-lock-tests, port-authority-tests, manifest-parity, nested-tier-regression,
collision-smoke or browser-tests. Passing isolated unit/release diagnostics
do not change that full-run result or cover the unexecuted checks.

Raw local outputs: `/tmp/network-unit-diagnostic.log`,
`/tmp/network-release-diagnostic.log`, `/tmp/network-heavy.log`,
`/tmp/network-clean-install.log`, `/tmp/network-clean-audit.json`.

The tested metadata hashes (unchanged between fresh installation and full run):

```text
package.json
81fb9e77d332e4f076790577d6b1eef18f9092c6c6c9bf0040b3303ec146974c
package-lock.json
e696bd8e9d9dce59316048408a0f2cdf968a76d5742f47119fe9cd1d38635b04
server/__tests__/dependency-network-security.test.ts
9f2796e45423265ef82d45af84082168d96dda43f70c02e74b262c723c09c91b
tsconfig.tests.json
ec568fe9c3e7acb4e45b1516abe3017ec782e927b541dbf58f8d8d43e89de29b
```

The unit diagnostic preceded normalization of follow-redirects' lockfile
tarball URL from the local package mirror to its public npm URL; the package
version, integrity and installed code did not change. Fresh installation,
release diagnostic and full-tier execution used the final lockfile. Subsequent
handoff documentation and classification records do not change tested code.

## Remaining findings and ownership

The initial planning audit reported 18 findings (one critical, 11 high, six
moderate). Only F-001–F-003 were repaired here. Fresh-install and full-tier
audits now report:

- **High (10):** brace-expansion, braces, chokidar, fast-glob,
  http-proxy-middleware (via micromatch/braces), micromatch, sharp,
  source-map-js, tailwindcss, vite.
- **Moderate (5):** @tailwindcss/typography, multer, postcss-nested,
  postcss-selector-parser, tailwindcss-animate.

These remaining package entries/versions are untouched by this task. They
belong to the planned subsequent sharp/multer, shared glob/CSS and other
dependency-remediation work, not audit exclusions. In particular, the remaining
http-proxy-middleware finding is the explicitly excluded micromatch/braces
chain, not follow-redirects. No duplicate follow-up tasks were proposed because
downstream remediation is already queued.

**Final assigned-tier state: FAIL at security-audit.** Targeted repair and
regression checks are delivered; aggregate validation remains unresolved.
Installed vulnerable versions were proven before repair, but production
exploitation of trust settings, redirect following or limiter subnet methods
was not established. No deployment or remote CI operation was performed.
