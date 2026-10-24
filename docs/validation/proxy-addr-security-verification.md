# proxy-addr security verification

## Scope and admission

Verified the requested GHSA-jqcg-44mw-7w3h remediation. The existing
Express-scoped `proxy-addr` override already requires `^2.0.8`; the lockfile and
installed Express consumer both resolve to `2.0.8`. No dependency or application
changes were necessary.

The admitted plan is `0cb595c3-9f84-42c8-ae0b-a72d6cf230b7`, revision 1,
plan hash `7c14be4f5407c83080596a3ecdb37c5185d385ba3d15fd4a538e2b80ab55bb6a`.
The governing Unified contract is
`cc3b6bf33682701a17e89288bc1afe64d6440ac7856d0b5d6eb1ba5a2dfff15c`;
the Regression Guard contract is
`1e19c766f4eb453d7a123df93a10ea43925dc520a10f6fa078b9143d1d2bf4a3`.
Classification: material security boundary, normal declaration using existing
regression coverage. The baseline catalog was empty. Preflight returned
`ADMITTED` before validation; no amendment was needed.

## Requirement-to-delivery map

All cases below are existing tests in
`server/__tests__/dependency-network-security.test.ts`, exercised by the
registered `unit-tests` step.

| Requirement | Actual guard and assertion | Result |
|---|---|---|
| Prevent vulnerable dependency resolution | “every consumer and installed lockfile copy is patched” resolves from Express and checks every locked/installed copy has a stable compatible version at least `2.0.8` | PASS |
| Reject proxy trust bypass | “mapped IPv6 cannot acquire trust from short or unrelated IPv6 prefixes” rejects unrelated IPv4/mapped IPv6 addresses and preserves the real remote address despite spoofed forwarded headers; also accepts legitimate trusted subnets | PASS |
| Preserve default Express behavior | “Express keeps forwarded addresses untrusted by default” sends an HTTP request with a spoofed forwarded address and asserts the socket address remains authoritative | PASS |

The version assertion would reject `2.0.7`; the trust assertions directly test
the vulnerable mixed-family boundary without reintroducing the vulnerable
dependency.

## Observed validation

```sh
TASK_ID=0cb595c3-9f84-42c8-ae0b-a72d6cf230b7 \
TASK_PLAN_FILE=.local/tasks/0cb595c3-9f84-42c8-ae0b-a72d6cf230b7.md \
npm run gate:run -- --tier test-standard
```

Result: **PASS**, all eight registered steps, no unreached steps, approximately
69 seconds. Run `b4d32e01-24f1-49a4-9ec1-1c12411863db` and its target,
workload hashes, and observations are retained in
`docs/validation/unified-registry.json`; detailed environment-local evidence is
`.local/failure-gate-unified/runs/b4d32e01-24f1-49a4-9ec1-1c12411863db.jsonl`.

The tested application/dependency snapshot was unchanged throughout the run.
Delivery adds only this verification handoff and the required gate history.
Separate read-only verification was not selected. No production deployment,
database operation, or unrelated dependency remediation was performed.
