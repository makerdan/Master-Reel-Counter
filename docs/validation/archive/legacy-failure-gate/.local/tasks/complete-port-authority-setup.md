# Complete Port Authority Setup

## What & Why
Upgrade and consolidate the project’s partial Port Authority installation into one complete, durable runtime-hygiene and validation system. Preserve working protections while adding the missing validation tiers, resource-aware locking, heavy-project workflow budgeting, deterministic verification, and tracked capability documentation so concurrent or repeated validation cannot silently collide, hang, or leave stale runtime state.

## Done looks like
- Runtime processes, ports, workflows, test suites, shared databases/files, and current ownership rules are audited before changes, with applicable and skipped Port Authority gates recorded.
- One canonical port-cleanup command safely handles every project-owned test/service port, rejects missing or invalid input, protects its caller tree and production execution, terminates full supervising process trees, confirms release, and logs forced cleanup loudly.
- `test-fast`, `test-standard`, `test-standard-plus`, and `test-heavy` are each backed by real executable project checks, exposed through a canonical manifest and durable Replit validation registrations, and assigned documented post-lock timeout budgets.
- Validation uses one crash-safe, reentrant, resource-aware lock implementation with named-resource striping, priorities, waiter manifests, stale/dead-holder recovery, loud takeovers, correct child exit propagation, and budgets that begin only after acquisition.
- Browser, unit, startup, static, audit, and schema/data checks are placed in the appropriate tiers without nested double-locking; Playwright cleanup occurs before its web server starts and health checks reach the backend.
- Workflow slots are reserved for the long-lived app service while on-demand checks are consolidated into registered validations rather than additional workflows or background shells.
- Automated coverage deterministically proves cleanup no-ops and invalid input, lock success/failure cleanup, stale takeover, reentrancy, priorities, resource isolation/serialization, collision prevention, and registration-to-command parity.
- The selected full acceptance tier succeeds twice back-to-back with no manual port clearing, process killing, or lock deletion between runs.
- Tracked project documentation ends with a capability checklist identifying every base and heavy-project capability as installed and verified, installed but not applicable, or deliberately skipped because its documented gate is absent.

## Out of scope
- Product UI, application features, or Mockup Sandbox changes.
- Adding speculative WebSocket, code-generation, database, or service machinery when the project audit shows the corresponding conditional gate is absent.
- Creating more long-lived workflows for individual test suites.
- Editing platform-managed skill mirrors or copying project deliverables into `.local/`.

## Steps
1. **Capture the runtime and validation baseline** — Inventory active processes and listeners, configured ports and workflows, all test/check entrypoints, shared database/file/port resources, existing cleanup and lock behavior, and executable tooling. Compare the existing implementation with the canonical Port Authority contract and record which conditional phases and heavy-project protections apply.
2. **Consolidate canonical port ownership** — Adapt the existing cleanup utility rather than replacing it blindly so explicit project ports, caller-tree safety, recursive/production guards, supervising process-tree termination, graceful escalation, verification, and loud incident reporting all satisfy the installation contract. Wire cleanup only at safe service startup boundaries, including before Playwright creates its web server.
3. **Build the four-tier validation contract** — Define a tracked canonical validation manifest and executable commands for fast, standard, standard-plus, and heavy coverage using the project’s actual typecheck, lint, unit, startup, browser, audit, documentation/data, and schema checks. Give every tier a clear scope and post-acquisition timeout budget, and make missing interpreters or backing targets fail registration instead of becoming placeholders.
4. **Upgrade validation serialization** — Evolve the current global lock into the canonical resource-aware validation lock, preserving proven heartbeat behavior while adding named-resource striping, priority queues, waiter manifests, per-resource reentrancy, dead/stale/max-hold recovery, and correct cleanup and exit propagation. Map conflicting checks to shared resources and leave independent checks unwrapped or on separate resources so safe work can run concurrently.
5. **Apply heavy-project workflow budgeting** — Keep long-lived services in the limited workflow budget and move on-demand validation behind the four registered commands. Remove duplicate validation workflow proliferation, prevent double-wrapped commands, and ensure all time budgets start after lock acquisition with contention reported separately from true test slowness.
6. **Harden runtime and harness integration** — Reconfirm environment-driven service ports, backend-reaching health probes, database pool error handling, WebSocket native pings where already applicable, generated-file serialization only if generation exists, and test teardown/quarantine hygiene. Preserve existing behavior that already complies and make every forced cleanup or takeover observable.
7. **Add deterministic verification coverage** — Extend the existing lock and collision test harnesses and add cleanup/manifest parity checks using isolated temporary ports and lock directories. Force queueing deterministically and cover invalid/no-op cleanup, successful and failing children, stale/dead takeover, same-resource reentrancy and priority, distinct-resource concurrency, signal cleanup, and exact registration-to-package-command parity.
8. **Verify and document capabilities** — Run isolated smoke checks before live services, invoke every tier’s backing command, compare the tracked manifest with Replit registrations, then run `test-heavy` twice consecutively without intervention. Publish tracked runtime-hygiene guidance and a final capability checklist with evidence and explicit gate-based not-applicable decisions.

## Pre-existing failures to ignore
None known at plan time. Treat every failure as a potential regression.

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance. Use the execution evidence rules before assigning ownership.

## Validation
**Command:** `test-heavy`
**Why:** This task changes project-wide validation registration, browser and backend checks, shared-port cleanup, and concurrency control, so the serialized full tier is the lightest tier that covers every affected boundary.
**Do not escalate:** Run exactly this command. Pre-existing failures are not a reason to run a heavier tier.

## Regression Guard
**Covers:** Concurrent and repeated validations must serialize only when they share resources, release locks and ports after success, failure, or stale ownership, preserve child exit status, and fail if an entrypoint bypasses the canonical lock or registered tier contract.
**Test location:** `server/__tests__/ci-serial-lock.test.ts`
**What it checks:** Extends the real-process harness to assert resource striping, deterministic queueing, priority, reentrancy, stale/dead takeover, cleanup, exit propagation, and integration parity so removal or weakening of runtime-hygiene wiring causes a repeatable failure.

## Relevant files
- `package.json`
- `.replit`
- `scripts/free-ports.mjs`
- `scripts/serial-lock.mjs`
- `scripts/ci.sh`
- `scripts/ci-collision-test.mjs`
- `scripts/startup-smoke.sh`
- `server/__tests__/ci-serial-lock.test.ts`
- `server/__tests__/routes.test.ts`
- `server/index.ts`
- `server/db.ts`
- `playwright.config.ts`
- `tests/global-setup.ts`
- `docs/testing.md`
