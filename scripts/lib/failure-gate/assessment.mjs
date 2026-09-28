// Pure workflow assessment. Inputs must come from the coordinator/registered
// report parser, NEVER caller-supplied PASS labels or imported result files.
// Returned status is recomputed; raw step exit results are never overwritten.
const identityFields = ["suite", "test", "signature", "variant", "environment"];
const sameFailure = (a, b) => identityFields.every((key) =>
  typeof a?.[key] === "string" && a[key].length > 0 && a[key] === b?.[key]);
const dateValue = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp : NaN;
};

export function matchingBaseline({ failure, catalog = [], ignoredBaselineIds = [], now }) {
  const today = dateValue(now);
  if (!Number.isFinite(today)) return null;
  const records = Array.isArray(catalog) ? catalog : catalog?.records ?? [];
  const matches = records.filter((record) => sameFailure(failure, record));
  // Ambiguity fails closed even if only one of the colliding IDs was requested.
  if (matches.length !== 1) return null;
  const record = matches[0];
  if (!ignoredBaselineIds.includes(record.id) || record.status !== "active" ||
      record.matchingRule !== "exact-v1" || !record.owner || !record.reviewer ||
      !Number.isFinite(dateValue(record.reviewBy)) || today > dateValue(record.reviewBy) ||
      record.revoked === true) return null;
  return record;
}

// Provenance object is produced by the approved reviewer/diagnostic adapter.
// Exactly three distinct retries FOLLOW the original; they prove intermittency
// only. Direct evidence must bind a verified earlier unaffected snapshot and the
// same applicable environment. Corroboration must have a distinct observation ID.
export function assessProvenance({ failure, provenance, initialRunId }) {
  const p = provenance;
  if (!p?.reviewer || !p.reviewReference || !p.diagnosticsAuthorized ||
      !Array.isArray(p.retries) || p.retries.length !== 3) return false;
  const ids = p.retries.map((r) => r.runId);
  if (ids.some((id) => typeof id !== "string" || !id || id === initialRunId) ||
      new Set(ids).size !== 3) return false;
  if (p.retries.some((r) => r.purpose !== "diagnostic_retry" ||
      r.environment !== failure.environment || !r.reportVerified ||
      !Number.isInteger(r.tests) || r.tests < 1 || r.skipped !== 0 ||
      r.signal || ![0, 1].includes(r.exitCode) ||
      (r.exitCode === 1 && !sameFailure(r.failure, failure)))) return false;
  const direct = p.direct;
  if (!direct?.verified || !direct.unaffected || !direct.earlier ||
      !direct.snapshotDigest || !direct.observationId ||
      !sameFailure(direct.failure, failure)) return false;
  return Array.isArray(p.corroboration) && p.corroboration.some((c) =>
    c.verified && c.observationId && c.observationId !== direct.observationId &&
    ["historical-record", "applicable-catalog", "complete-input-comparison"].includes(c.kind) &&
    sameFailure(c.failure, failure) &&
    (c.kind !== "complete-input-comparison" || c.transitiveInputsVerified === true));
}

/**
 * tier.steps = [{name,kind,command,expectedTests?: positive minimum}]
 * run = {runId,purpose,taskId,namespace,authorizationVersion,planDigest,
 *   tierDefinitionDigest,policyDigest,snapshotDigest,environmentVerified,
 *   isolation:"independent-copy",steps:[{name,status,exitCode,signal,
 *   reportVerified,tests,skipped,failures:Failure[],passedTests:FailureIdentity[]}]}
 * authorization repeats identity/version/digest fields above.
 * ownedRepairs are durable full Failure identities, not catalog pointers.
 * reports must be verified by caller against coordinator-owned artifact digests.
 */
export function assessRun({
  run, tier, authorization, currentSnapshotDigest, catalog = [], now,
  ownedRepairs = [], ignoredBaselineIds = [], provenance = [],
}) {
  const reasons = [];
  const result = (status) => ({ status, reasons, rawResults: run?.steps ?? [] });
  if (!run || !authorization || !Array.isArray(tier?.steps) || !tier.steps.length ||
      run.purpose !== "required_tier_validation" || !run.runId) {
    reasons.push("missing required-tier evidence or authorization"); return result("BLOCKED");
  }
  for (const key of ["taskId", "namespace", "authorizationVersion", "planDigest",
    "tierDefinitionDigest", "policyDigest"]) {
    if (run[key] === undefined || run[key] !== authorization[key]) {
      reasons.push(`stale or mismatched ${key}`); return result("BLOCKED");
    }
  }
  if (!currentSnapshotDigest || run.snapshotDigest !== currentSnapshotDigest ||
      run.isolation !== "independent-copy" || run.environmentVerified !== true) {
    reasons.push("unknown or stale snapshot/environment"); return result("BLOCKED");
  }
  if (!Array.isArray(run.steps) || run.steps.length !== tier.steps.length ||
      new Set(run.steps.map((s) => s.name)).size !== run.steps.length ||
      new Set(tier.steps.map((s) => s.name)).size !== tier.steps.length) {
    reasons.push("missing, extra, or duplicate required step results"); return result("INCOMPLETE");
  }
  for (const spec of tier.steps) {
    const step = run.steps.find((s) => s.name === spec.name);
    if (!step || !["passed", "failed"].includes(step.status) || step.signal ||
        !Number.isInteger(step.exitCode) || step.exitCode < 0 ||
        !step.reportVerified || !Array.isArray(step.failures) ||
        (step.status === "passed") !== (step.exitCode === 0)) {
      reasons.push(`incomplete result: ${spec.name}`); return result("INCOMPLETE");
    }
    if (spec.kind === "test" && (!Number.isInteger(step.tests) ||
        step.tests < Math.max(1, spec.expectedTests ?? 1) || step.skipped !== 0)) {
      reasons.push(`missing discovery or skipped tests: ${spec.name}`); return result("INCOMPLETE");
    }
    if ((step.exitCode === 0 && step.failures.length) ||
        (spec.kind === "test" && step.exitCode !== 0 && !step.failures.length)) {
      reasons.push(`inconsistent failure accounting: ${spec.name}`); return result("INCOMPLETE");
    }
  }
  // Ownership is independent of catalog eligibility and checked before ignores.
  for (const repair of ownedRepairs) {
    const discovered = run.steps.some((s) => s.reportVerified &&
      Array.isArray(s.passedTests) && s.passedTests.some((test) => sameFailure(test, repair)));
    const stillFailing = run.steps.some((s) => s.failures.some((f) => sameFailure(f, repair)));
    if (!discovered || stillFailing) {
      reasons.push("owned repair lacks discovered passing proof"); return result("FAIL");
    }
  }
  let acceptedFailures = 0;
  for (const spec of tier.steps) {
    const step = run.steps.find((s) => s.name === spec.name);
    if (step.exitCode === 0) continue;
    if (spec.kind !== "test") {
      reasons.push(`non-test failure cannot be waived: ${spec.name}`); return result("FAIL");
    }
    for (const failure of step.failures) {
      if (matchingBaseline({ failure, catalog, ignoredBaselineIds, now })) {
        acceptedFailures++; continue;
      }
      const evidence = provenance.filter((p) => sameFailure(p.failure, failure));
      if (evidence.length === 1 && assessProvenance({
        failure, provenance: evidence[0], initialRunId: run.runId,
      })) { acceptedFailures++; continue; }
      reasons.push(`unresolved failure: ${spec.name}`); return result("BLOCKED");
    }
  }
  return result(acceptedFailures ? "ACCEPTABLE_WITH_IGNORED_FAILURES" : "PASS");
}