---
name: App Support Ops
description: >-
  Design, implement, audit, or harden application support operations for
  in-app help, protected administrator analytics, runtime and port safety, and
  development-only backend outage/restart controls. Use this skill whenever a
  request mentions a help center, onboarding or contextual guidance, an
  admin-only analytics surface, port collisions or process cleanup, or a
  development API outage/restart control. Discover the host project's
  capabilities first, select only the requested mode, and remain
  framework-, provider-, deployment-, and artifact-neutral.
---

# App Support Ops

Build only the support capability the user requested. This skill has three
independent modes—**Help**, **Admin Analytics**, and **Runtime Safety**—plus an
explicit **Combined** mode when the user asks for more than one. Do not bundle
the modes merely because the repository could support them.

## 1. Discover the repository and capabilities first

First select the requested mode and operation: definition installation,
planning/audit, or application implementation. Installing this skill does not
select an application mode or authorize product changes. For an existing
integration, preserve its actual owner-selected modes; do not infer Combined.

Before proposing or changing code, inspect relevant repository instructions,
routes/commands, deployment boundaries and tests. Apply the capability matrix
only to the selected mode and its real dependencies. Mark other rows not
applicable rather than auditing unrelated systems. Do not infer capability from
a familiar framework, filename, installed library or task completion label.

| Area | Discover |
|---|---|
| Client/UI | browser, server-rendered, native, terminal, embedded, or no interactive client; routing, layout, responsive and accessibility conventions |
| Server/services | API or service entry points, service ownership, environment-provided ports, health checks, restart/control hooks, production markers |
| Identity | authentication, authorization, roles/capabilities, server-side middleware or service policy, denial semantics |
| Data | persistence, migrations, content/config storage, telemetry events, retention, privacy controls |
| Support surface | existing help/onboarding/feedback content, search, dialogs, command help, localization, contact configuration |
| Analytics | event schema, consent/privacy rules, page-view instrumentation, aggregation and chart/table components |
| AI | existing server-side AI/provider abstraction, grounding sources, configuration, limits, and relevant installed specialist guidance |
| Validation/runtime | test runners, test-port allocation, process cleanup, locks, workflows, artifact boundaries, and hardcoded-port checks |

Record a capability matrix: **present**, **absent**, **unclear**, or **not
applicable**, with evidence. Resolve unclear items by reading the relevant
source; never invent a database, chart library, auth provider, AI model,
browser, service, or restart mechanism. If a requested mode lacks prerequisites,
report it unavailable or not applicable, with the safe partial outcome and any
user decision needed.

Choose the mode from the request:

- **Help only:** content, guidance, Q&A, feedback, and support UX.
- **Admin Analytics only:** protected operational/product analytics and its
  instrumentation.
- **Runtime Safety only:** ports, process/test hygiene, and eligible
  development outage controls.
- **Combined:** perform each explicitly requested mode as a separate workstream,
  sharing discovery and validation but not silently adding another mode.

Use the host project's native approach and conventions. Read only relevant
canonical specialist sources under `.agents`, never runtime mirrors or retired
definitions. For runtime work, use `.agents/skills/port-authority/SKILL.md`
and its applicable references; locate the actual canonical path if the project
uses a different layout. Port Authority owns process/port/lease safety; App Support
Ops owns the requested support feature, capability gates and coordinated handoff.
These are complementary responsibilities, not competing choices to ask the user
to arbitrate. A bare port-conflict request uses the runtime specialist without
adding Help or Analytics. Missing applicable runtime guidance blocks only the
dependent runtime work, not independent Help or Analytics. Do not install an
extra gate or require a separate companion installation merely to use other modes.
When adopted, Failure Gate Unified governs admission and validation, and
Regression Guard governs recurrence-prevention declarations and delivery.
Neither is required merely to use App Support Ops. For server-side AI help,
read `.agents/skills/poe-setup/SKILL.md` only if relevant to the actual provider.
Do not copy a specialist's product, provider, or framework assumptions into this
skill or the host project.

## 2. Shared boundaries

- Keep authorization, secrets, persistence, telemetry, and service control at
  the narrowest native boundary that can enforce them. A client hint is never
  an authorization decision.
- Preserve existing route, error, content, accessibility, and test contracts
  unless the request explicitly changes them. Prefer an adapter around existing
  systems to a parallel implementation.
- Treat user-authored content, telemetry values, AI output, and query parameters
  as untrusted: validate, bound, escape, and redact as appropriate.
- Do not add invented branding, routes, contacts, roles, environment variables,
  providers, credentials, or infrastructure. Use project configuration or stop
  and ask for the missing value.
- Keep optional features optional. A repository without a UI, server, database,
  AI, multiple services, or a controllable development process can still use
  the applicable subset; say what was skipped and why.
- Tests must prove both the enabled path and the capability gate. Do not use a
  mock that hides whether the real authorization, environment, or process
  boundary is enforced.

### Planning, authorization and validation integration

Read [the integration contract](reference/integration-contract.md) before planning
application implementation, changing validation wiring, or migrating an existing
integration. It preserves workload discovery, exact scope authorization, supported
amendments and historical records. This reference is normative; unavailable guidance
blocks only work depending on it. Definition-only delivery is not application admission.

## 3. Help mode

Design a maintainable support system for the interfaces the repository actually
has. Use structured content records or the host's equivalent instead of
scattering long help strings through components or commands. A record has a
stable key, title, body, feature/workflow context, audience or availability
metadata when needed, and a revision/source marker. Keep content versionable,
searchable where useful, and safe to render; do not claim an unsupported feature.

Cover, where applicable:

1. **First-time guidance:** orient a new user to the main task, essential
   controls, and next step without blocking repeat users. Persist dismissal or
   completion through the existing user/settings mechanism, with a reset or
   revisit path. Scope persisted state to the actual user/profile and content
   revision as appropriate; switching accounts must not inherit another user's
   completion. Storage absence, denial, corruption or write failure must not
   hide guidance or crash navigation. Test the actual failure and revisit path;
   do not invent a database solely to persist dismissal.
2. **Feature and workflow examples:** explain concrete tasks in the product's
   vocabulary, prerequisites, expected result, recovery path, and limitations.
   Prefer short contextual help plus a deeper article or command reference.
3. **Grounded Q&A:** when server-side AI exists, keep answers app-only and
   grounded in approved current help/product sources and available user context.
   Do not expose provider credentials or let the model invent routes,
   capabilities, policy, or contacts. Validate and bound requests and output,
   handle unavailable/unsafe answers clearly, and preserve server-side auth,
   timeout, rate-limit, telemetry, and error policies. Without AI, use
   search/static guidance or report Q&A unavailable; do not add a speculative
   provider.
4. **Feedback:** use the configured support contact or feedback channel. Never
   invent an email, webhook, or external destination. If none is configured,
   state the configuration gap and provide a local/non-delivery fallback only
   when the host supports one.
5. **Interaction:** preserve the selected native Help surface and the user's
   place. For requested floating/minimizable/draggable interactions, provide
   accessible non-pointer alternatives and safe close/focus behavior. Do not add
   dragging or extra chrome merely because the interface supports it. Pages,
   command help and API guidance need only their actual interaction contracts.
6. **Device and input adaptation:** make guidance usable on small screens,
   touch, keyboard, assistive technology, and non-pointer inputs. Avoid
   hover-only instructions; preserve focus; provide intentional keyboard
   close/minimize; use semantic headings/controls; expose state changes to
   assistive technology; and follow established contrast, motion, zoom, and
   reduced-motion conventions.

Test rendering/escaping, first-time versus returning state, search or Q&A
grounding, contact configuration, dismissal/revisit, keyboard and screen-reader
semantics where UI exists, responsive/touch behavior, and the no-AI/no-browser
fallback. Do not test a browser-only outcome in an API-only or command-line
project.

## 4. Admin Analytics mode

Establish the requested analytics and the actor allowed to see them. Existing
record aggregates do not require new telemetry, page-view events or visitor IDs.
Add collection only when explicitly in scope and governed by actual privacy policy.
Distinguish route/authorization tests from query/persistence evidence: an injected
aggregate loader does not establish the real query's date bounds or isolation.
Record that gap rather than inventing a successful database test. Keep the
capability check server- or service-authoritative for every read, export,
aggregation, and mutation. A client admin flag, hidden route, or exposed
administrator identifier is not a security control.

- Use the existing authorization policy and role/capability source. Deny by
  default and re-check authorization at the data boundary.
- Match established interface semantics. For an interactive UI, use
  indistinguishable UI not-found behavior for an unauthorized admin-only page
  when that is the host's privacy convention. For an API, return its documented
  authorization response (normally 403 for an authenticated but unauthorized
  caller) without revealing protected-record existence. Never impose UI
  not-found semantics on an API with another contract, or vice versa.
- Never send admin IDs, role lists, secrets, raw access tokens, privileged query
  details, or unaggregated private records to an unnecessary client. Keep them
  out of URLs, bundles, logs, analytics payloads, and errors.
- Collect only minimum privacy-safe events for the stated purpose. Prefer coarse,
  purpose-limited dimensions and aggregation; do not record full URLs with
  secrets, free-form sensitive text, raw IPs, or unnecessary identifiers.
- If a pseudonymous visitor ID is necessary, derive it server-side with a
  server-held keyed construction, rotate or scope it as appropriate, bound
  retention, and document access/deletion. Plain or unsalted IP hashing is not
  sufficient privacy protection.
- Make page-view and supporting telemetry non-blocking: instrument after the
  user-visible operation or enqueue through the existing bounded mechanism.
  Telemetry failure must not fail navigation, help, analytics loading, or
  authorization. Bound retries and avoid duplicate events on rerender/reload
  using the established lifecycle.
- Use native persistence/query and chart/table mechanisms. Apply aggregation,
  time-range limits, pagination, export restrictions, and retention before
  rendering or returning data. Without a suitable chart surface, use a safe
  table or report instead of adding charts.

Test authorized, anonymous, unauthorized, direct-API, and stale-session access;
identifier/secret non-disclosure; aggregation, retention, and export limits;
duplicate page views; and telemetry-failure isolation. Verify UI and API denial
semantics when both interfaces exist.

## 5. Runtime Safety mode

Apply the runtime specialist's relevant contract to the requested controls, then
adapt it to the host project. Basic hygiene, demonstrated-conflict serialization
and advanced recovery retain their distinct prerequisites. Do not activate
optional controls merely to satisfy an audit, assume a missing specialist
capability exists, or reclassify an unresolved conflict as repaired. Independently
permitted non-runtime work may continue. For selected network runtime work, apply
the following relevant feature-side requirements without duplicating or weakening
Port Authority's ownership, production, recovery or acceptance rules:

1. **Environment-owned ports:** every service reads its listen port from
   environment/platform service configuration. Repository-wide, scan server
   entry points, client dev servers, test URLs, scripts, workflow commands, and
   executable/configuration documentation for hardcoded ports. Ignore examples
   only when the scanner explicitly distinguishes them. An authoritative
   platform service-port assignment is not an unauthorized runtime literal;
   distinguish configuration, executable callers, fixtures and examples using
   narrow evidence, not blanket test/documentation exclusions.
2. **Regression fixture:** test the scan with a synthetic failing fixture
   containing a representative hardcoded bind or URL and reject it; also test a
   valid environment-driven fixture. Do not weaken the production scan.
3. **Canonical test-port allocation:** use the documented allocator/registry or
   an ephemeral reservation strategy for parallel tests. Make ownership,
   readiness, collision handling, cleanup, and artifact-base/service routing
   explicit. Never choose a convenient fixed port without proving it is the
   canonical path.
4. **Safe lifecycle and cleanup:** use Port Authority's applicable managed-
   service, owned-child or advanced reclaim contract. These are distinct scopes,
   not interchangeable cleanup permissions. Preserve exact ownership, finite
   termination, observed quiescence, protected unrelated work and uncertain
   lease retention. Never infer takeover authority from a port, process name,
   task approval or local flag. A read-only inventory must never become cleanup.
5. **Repeatable validation:** follow the applicable Port Authority acceptance
   contract for newly activated runtime controls, including its two consecutive
   authorized host runs without manual cleanup. Exercise actual affected callers;
   isolated fixture passes or correct production denials do not prove activation.
   Do not apply a blanket twice-run rule to definition installation or independent
   Help/Analytics work. Preserve the host's required workload coverage and actual
   lock/reentry, timeout, owned-child cleanup and uncertain-state protections.

Cleanup requirements do not grant takeover permission. Under Port Authority,
ordinary port inventory remains read-only; owned-child cleanup and an exact
authorized managed-service lifecycle are distinct from pre-existing-process
reclaim. Apply the advanced reclaim contract only when explicitly scoped and
supported. Exercise cleanup assertions with isolated owned fixtures; do not
disrupt live services or erase uncertain leases to make tests pass.

Without network services, mark port/process checks not applicable but use the
host's safe lifecycle for local workers/commands. For a single-service project,
do not invent multi-service orchestration.

### Development-only outage/restart surface

Add this only when all three gates are proven: an interactive client benefits
from it; a controllable development server/process and safe restart mechanism
exist; and the control can be proven absent or inert in production.

Keep it development-only at both boundaries. At build time, prove production
bundles/routes neither contain nor expose it and production configuration cannot
enable it. At the server boundary, gate the route/command with a trustworthy
environment/build-mode check before any state change and return the host's normal
not-found/unsupported response outside development. Never trust a client mode
flag. Require appropriate development authorization, CSRF or equivalent
cross-site protection where relevant, rate-limit repeated restarts, and make the
action explicit and recoverable.

Exercise the real client-to-development-server failure state and safe
restart/reconnect path, not a client boolean. If there is no interactive client
or controllable development server, report the surface not applicable and do
not add it.

Test build and server environment gating, unauthorized/direct invocation,
restart idempotence, concurrent requests, process cleanup, readiness/health,
client recovery, and production exclusion. Never run destructive restart tests
against production.

## 6. Combined mode and delivery

For an explicitly combined request, keep Help, Admin Analytics, and Runtime
Safety as separate workstreams with separate capability gates and tests. Share
only genuinely shared adapters (such as auth or telemetry) and preserve each
mode's boundary. State which requested modes were implemented, skipped,
unavailable, or not applicable, and why.

Before completion, report:

1. discovered capabilities and evidence;
2. selected modes and deliberately unselected modes;
3. changed surfaces and native adapters;
4. authorization, privacy, accessibility, production, and process-safety
   decisions;
5. tests and negative-path coverage, including unavailable-capability tests;
6. configuration gaps or user decisions required; and
7. relevant specialist handoff and why it applied.

Include the requirement-to-check-to-runner mapping, assigned tier when applicable,
workload changes and approval basis, observed run evidence, and unresolved
dependencies. Keep definition installation, gate maintenance, plan admission,
guard delivery, assigned-tier validation, runtime activation and deployment
distinct. App Support Ops adds no platform Start interceptor, independent
reviewer requirement or authority over native task completion.

Never claim an operation is protected, private, accessible, or production-safe
unless the corresponding boundary was actually verified.
