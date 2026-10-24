import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadCatalog, maintenanceFindings, isReferenceable } from "../baseline.mjs";
import { contract as regressionContract, declaration as regressionDeclaration } from "./regression.mjs";
import { MANIFEST, UUID, invariant, stable, digest, hash, pins, tierDefinition,
  readRegistry, taskState, safePath, atomicWrite, append, saveRegistry, withWriter, admissionReady } from "./store.mjs";

export function catalog(root) {
  return loadCatalog(safePath(root, "docs/validation/failure-baseline.json"));
}
export function baselineWarnings(root) { return maintenanceFindings(catalog(root)); }
function text(value, label) {
  invariant(typeof value === "string" && value.trim().length >= 3 &&
    !/\b(TODO|TBD)\b|<[^>]+>/.test(value), `${label} must be a complete declaration`);
  return value.trim();
}
export function specification(root, input, { draft = false, modular = false, historical = false } = {}) {
  const tier = input.tier;
  const definition = tierDefinition(root, tier);
  const spec = {
    title: text(input.title, "title"), scope: text(input.scope, "scope"), tier,
    why: text(input.why, "coverage rationale"), coverage: text(input.coverage, "coverage evidence"),
    approval: draft ? {
      reference: "Not an approval record",
      direction: "Ordinary authorization is checked by the executing Agent",
      applicability: "Execution admission is required before implementation or validation",
    } : {
      reference: text(input.approval?.reference, "attributable approval reference"),
      direction: text(input.approval?.direction, "owner direction"),
      applicability: text(input.approval?.applicability, "approval applicability to this revision"),
    },
    ignoredBaselines: input.ignoredBaselines ?? [], ownedBaselines: input.ownedBaselines ?? [],
    assertions: input.assertions,
  };
  const guardPin = historical ? input.guardContract : regressionContract(root, safePath);
  if (guardPin) {
    regressionContract(root, safePath, guardPin);
    spec.guardContract = guardPin;
    spec.regression = structuredClone(input.regression);
    spec.regressionGuard = regressionDeclaration(spec.regression);
  } else if (modular) spec.regressionGuard = text(input.regressionGuard, "scope-based Regression Guard declaration");
  invariant(definition.steps.some((step) => spec.coverage.includes(step.name)),
    "coverage evidence must identify a real selected-tier step");
  invariant(Array.isArray(spec.assertions) && spec.assertions.length > 0, "planned guard assertions required");
  spec.assertions = spec.assertions.map((a) => ({
    requirement: text(a.requirement, "assertion requirement"), check: text(a.check, "assertion check"),
  }));
  const baselines = catalog(root);
  invariant(Array.isArray(spec.ignoredBaselines) && Array.isArray(spec.ownedBaselines),
    "baseline declarations must be ID arrays");
  const refs = [...spec.ignoredBaselines, ...spec.ownedBaselines];
  invariant(new Set(refs).size === refs.length, "baseline declarations must be disjoint unique ID arrays");
  for (const id of refs) invariant(baselines.records.some((r) => r.id === id),
    `unknown exact catalog reference: ${id}`);
  return spec;
}
export function renderPlan(root, state) {
  const { spec, id, tier, revision, pin } = state;
  const records = catalog(root).records;
  const declarations = [];
  for (const [key, label] of [["ignoredBaselines", "Ignored baseline"], ["ownedBaselines", "Owned baseline repair"]]) {
    for (const id of spec[key]) {
      const record = records.find((r) => r.id === id);
      invariant(record, `declared baseline no longer exists: ${id}`);
      declarations.push(`**${label}:** ${JSON.stringify({ id, suite: record.suite, test: record.test, signature: record.signature })}`);
    }
  }
  const plan = `# ${spec.title}

## Task identity
**Task ID:** ${id}
**Revision:** ${revision}
**Skill pin:** ${pin}

## Scope
${spec.scope}${spec.guardContract ? `\n\n## Regression classification\n**Guard contract:** ${spec.guardContract}\n**Form:** ${spec.regression.form}\n**Material scope:** ${spec.regression.material}\n**Rationale:** ${spec.regression.rationale}` : ""}

## Approval evidence
**Reference:** ${spec.approval.reference}
**Owner direction:** ${spec.approval.direction}
**Applicability:** ${spec.approval.applicability}

## Pre-existing failures to ignore
${declarations.length ? declarations.join("\n") : "None known at plan time. Treat every failure as a potential regression."}

**Flaky-test rule:** A passing retry establishes intermittency, not pre-existing provenance.

## Validation
**Command:** \`${tier}\`
**Why:** ${spec.why}
**Coverage evidence:** ${MANIFEST}; ${spec.coverage}; supported invocation: TASK_ID=${id} TASK_PLAN_FILE=.local/tasks/${id}.md npm run gate:run -- --id ${id} --tier ${tier}
**Do not switch tiers:** This task ID is strictly bound to this tier. Other tiers will block execution; changes require a supported amendment.

## Planned guard assertions
${spec.assertions.map((a) => `- ${a.requirement} — ${a.check}`).join("\n")}${spec.regressionGuard ? `\n\n## Regression Guard\n${spec.regressionGuard}` : ""}
`;
  if (spec.guardContract) {
    const sections = plan.match(/^## Regression Guard\s*$/gm) ?? [];
    invariant(sections.length === (spec.regressionGuard ? 1 : 0),
      "Regression Guard: duplicate or injected declaration section");
  }
  return plan;
}
function publish(root, registry, state, spec, reason) {
  if (spec.guardContract) {
    regressionContract(root, safePath, spec.guardContract);
    regressionDeclaration(spec.regression);
  }
  const next = { ...state, spec, tier: spec.tier, pin: pins(root).current,
    revision: state.revision + 1, status: "sealed",
    workloadHash: digest(tierDefinition(root, spec.tier)), amendmentReason: text(reason, "amendment rationale") };
  next.plan = renderPlan(root, next);
  next.planHash = hash(next.plan);
  next.approvalHash = digest({ approval: spec.approval, planHash: next.planHash });
  atomicWrite(root, next.planPath, next.plan);
  atomicWrite(root, `.local/tasks/${next.id}.stubs.json`,
    JSON.stringify({ id: next.id, revision: next.revision, assertions: spec.assertions }, null, 2) + "\n");
  append(registry, next, "amend");
  saveRegistry(root, registry);
  // Guard the published seal inside the same writer transaction.
  guard(root, { id: next.id, tier: next.tier, planFile: next.planPath }, registry);
  return next;
}
export async function provision(root, input, resumeId) {
  admissionReady(root);
  const spec = specification(root, input, { modular: pins(root).schemaVersion === 2 });
  return withWriter(root, (registry) => {
    admissionReady(root);
    let state;
    // A stable local claim is supplied before any write; it is not host approval.
    // Reconcile an uncertain successful write or partial reservation under lock.
    const claim = input.claim ? text(input.claim, "local retry claim") : undefined;
    if (pins(root).schemaVersion === 2) invariant(claim, "new admission requires a stable local retry claim");
    if (claim && !resumeId) {
      const prior = Object.values(registry.tasks).map(taskState).find((s) => s.claim === claim);
      if (prior) {
        invariant(prior.specHash === digest(spec), "retry claim already belongs to different work");
        if (prior.status === "sealed") return guard(root,
          { id: prior.id, tier: prior.tier, planFile: prior.planPath }, registry);
        resumeId = prior.id;
      }
    }
    if (resumeId) {
      invariant(UUID.test(resumeId) && registry.tasks[resumeId], "resume requires an existing reservation");
      state = taskState(registry.tasks[resumeId]);
      invariant(state.status === "reserved" && state.specHash === digest(spec),
        "reservation retry cannot assign the identity to different work");
    } else {
      let id;
      do { id = randomUUID(); } while (registry.tombstones.includes(id));
      state = { id, createdAt: new Date().toISOString(), status: "reserved", revision: 0,
        tier: spec.tier, pin: pins(root).current, planPath: `.local/tasks/${id}.md`,
        specHash: digest(spec), runs: [] };
      if (claim) state.claim = claim;
      append(registry, state, "provision");
      saveRegistry(root, registry); // Durable reservation survives generation failure.
    }
    return publish(root, registry, state, spec, "initial complete plan and binding");
  });
}
export async function amend(root, id, input, reason) {
  admissionReady(root);
  const spec = specification(root, input, { modular: pins(root).schemaVersion === 2 });
  return withWriter(root, (registry) => {
    admissionReady(root);
    invariant(registry.tasks[id], "unknown Unified task ID; do not rebind legacy tasks");
    const state = taskState(registry.tasks[id]);
    invariant(state.status === "sealed" && state.runs.at(-1)?.state !== "RUNNING",
      "amend requires a sealed quiescent task");
    return publish(root, registry, state, spec, reason);
  });
}
export function prepareDraft(root, input) {
  pins(root);
  // Pure preparation: no writer, mkdir, reservation, seal or native reference.
  const spec = specification(root, input, { draft: true, modular: pins(root).schemaVersion === 2 });
  const state = { spec, id: "UNADMITTED_NATIVE_DRAFT", tier: spec.tier,
    revision: "NOT_ADMITTED", pin: pins(root).current };
  const plan = renderPlan(root, state)
    .replace(/## Task identity[\s\S]*?## Scope/, "## Status\nUNADMITTED_NATIVE_DRAFT — no local identity, seal or tier binding exists.\n\n## Scope")
    .replace(/; supported invocation:.*\n/, "; intended invocation after execution admission: gate:run with the generated TASK_ID and TASK_PLAN_FILE\n")
    .replace(/\*\*Do not switch tiers:\*\*.*\n/, "**Intended tier, not bound:** Execution must first provision, seal and guard this tier.\n");
  return { status: "UNADMITTED_NATIVE_DRAFT", nativeAuthorizationObservation: "NOT_OBSERVED",
    plan: `${plan}\n## First execution action\nRespect ordinary approval and current scope; reuse the stable local claim with gate:new, then gate:guard before implementation or validation. Missing write capability blocks execution, not this draft.\n` };
}
export function guard(root, { id, tier, planFile }, registry = readRegistry(root), { allowUnresolvedRun = false } = {}) {
  invariant(UUID.test(id ?? "") && registry.tasks[id], "unknown/unprovisioned Unified task ID");
  const state = taskState(registry.tasks[id]);
  const pin = pins(root, state.pin);
  if (pin.revisions[state.pin]?.kind === "normative-package") admissionReady(root);
  invariant(state.status === "sealed", "task is not eligible for ordinary execution");
  invariant(allowUnresolvedRun || state.runs.at(-1)?.state !== "RUNNING",
    "previous run is unresolved; use bound-tier run --recover after its bounded deadline");
  invariant(tier === state.tier, "wrong tier: task is bound to exactly one tier");
  invariant(typeof planFile === "string" &&
    relative(resolve(root), resolve(root, planFile)) === state.planPath, "TASK_PLAN_FILE context mismatch");
  const bytes = readFileSync(safePath(root, planFile), "utf8");
  invariant(hash(bytes) === state.planHash && bytes === state.plan, "sealed plan changed or stale");
  invariant(state.plan === renderPlan(root, state), "required plan sections/declarations differ from sealed specification");
  const stubs = JSON.parse(readFileSync(safePath(root, `.local/tasks/${id}.stubs.json`), "utf8"));
  invariant(stable(stubs) === stable({ id, revision: state.revision, assertions: state.spec.assertions }),
    "required stubs missing or changed");
  invariant(state.workloadHash === digest(tierDefinition(root, tier)), "tier workload changed; use supported amendment");
  invariant(state.approvalHash === digest({ approval: state.spec.approval, planHash: state.planHash }),
    "local approval notes do not match this sealed revision");
  specification(root, state.spec, { modular: pin.revisions[state.pin]?.kind === "normative-package", historical: true });
  return state;
}
export async function restorePlan(root, id) {
  return withWriter(root, (registry) => {
    invariant(registry.tasks[id], "unknown task");
    const state = taskState(registry.tasks[id]);
    pins(root, state.pin);
    invariant(state.status === "sealed", "cannot materialize an ineligible task");
    atomicWrite(root, state.planPath, state.plan);
    atomicWrite(root, `.local/tasks/${id}.stubs.json`,
      JSON.stringify({ id, revision: state.revision, assertions: state.spec.assertions }, null, 2) + "\n");
    return guard(root, { id, tier: state.tier, planFile: state.planPath }, registry);
  });
}
export async function cancel(root, id, closure) {
  return withWriter(root, (registry) => {
    invariant(registry.tasks[id], "unknown task; legacy IDs are never rebound");
    const state = taskState(registry.tasks[id]);
    invariant(state.runs.at(-1)?.state !== "RUNNING", "run is unresolved; use the supported run recovery first");
    const next = { ...state, status: closure.completionMode === "owner_direction" ? "closed" : "cancelled",
      closure: { reason: text(closure.reason, "closure reason"), ...closure, state: "INCOMPLETE" } };
    append(registry, next, "cancel"); saveRegistry(root, registry);
    return next;
  });
}
export function classifyFailure(root, state, observation, evidence) {
  const record = catalog(root).records.find((r) =>
    r.suite === observation.suite && r.test === observation.test && r.signature === observation.signature);
  if (record && state.spec.ownedBaselines.includes(record.id)) return { classification: "OWNED_REPAIR", id: record.id };
  if (record && state.spec.ignoredBaselines.includes(record.id) && isReferenceable(record)) {
    return { classification: "IGNORED_BASELINE", id: record.id };
  }
  if (evidence) {
    invariant(["untouched-diff", "documented-pattern"].includes(evidence.kind) &&
      typeof evidence.note === "string" && evidence.note.trim().length >= 10 &&
      !/passing retry|retry passed|isolated pass/i.test(evidence.note), "retry success alone is not provenance");
    return { classification: "SELF_CLASSIFIED_PRE_EXISTING",
      log: `[SELF-CLASSIFIED PRE-EXISTING] ${observation.suite} / ${observation.test} — evidence: ${evidence.kind}: ${evidence.note}` };
  }
  return { classification: "POTENTIAL_REGRESSION" };
}
