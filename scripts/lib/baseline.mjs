import { readFileSync } from "fs";
import { resolve } from "path";

export const BASELINE_PATH = resolve("docs/validation/failure-baseline.json");
export const VALID_STATUSES = new Set([
  "active",
  "expired",
  "resolved",
  "intermittent",
  "environment-limited",
  "unknown",
  "needs-review",
]);

function parseDate(value, field, id) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`baseline ${id}: ${field} must be an ISO date`);
  }
}

export function loadCatalog(path = BASELINE_PATH) {
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read baseline catalog ${path}: ${error.message}`);
  }
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.records)) {
    throw new Error("baseline catalog must have schemaVersion 1 and records[]");
  }
  const ids = new Set();
  for (const record of catalog.records) {
    const id = record?.id;
    if (!id || ids.has(id)) throw new Error(`baseline ${id ?? "<missing>"}: duplicate or missing id`);
    ids.add(id);
    for (const field of ["suite", "test", "signature", "status", "owner", "observedOn", "reviewBy", "verifiedOn"]) {
      if (typeof record[field] !== "string" || !record[field].trim()) {
        throw new Error(`baseline ${id}: ${field} is required`);
      }
    }
    if (!VALID_STATUSES.has(record.status)) throw new Error(`baseline ${id}: unsupported status ${record.status}`);
    for (const field of ["observedOn", "reviewBy", "verifiedOn"]) parseDate(record[field], field, id);
    if (!["active", "expired", "resolved", "intermittent", "environment-limited", "unknown", "needs-review"].includes(record.status)) {
      throw new Error(`baseline ${id}: invalid status`);
    }
  }
  return catalog;
}

export function isReferenceable(record, today = new Date()) {
  if (!record || record.status !== "active") return false;
  const end = Date.parse(`${record.reviewBy}T23:59:59Z`);
  return !Number.isNaN(end) && end >= today.getTime();
}

export function findExactRecord(catalog, { id, suite, test, signature }) {
  const record = catalog.records.find((item) => item.id === id);
  if (!record) return { ok: false, reason: `unknown baseline id ${id}` };
  if (record.suite !== suite || record.test !== test || record.signature !== signature) {
    return { ok: false, reason: `baseline ${id} does not exactly match suite, test, and signature` };
  }
  if (!isReferenceable(record)) return { ok: false, reason: `baseline ${id} is ${record.status} or expired` };
  return { ok: true, record };
}

export function maintenanceFindings(catalog, { today = new Date(), warningDays = 30, staleDays = 90 } = {}) {
  const now = today.getTime();
  return catalog.records.flatMap((record) => {
    const findings = [];
    if (record.status === "active") {
      const reviewAt = Date.parse(`${record.reviewBy}T23:59:59Z`);
      const days = Math.ceil((reviewAt - now) / 86400000);
      if (days < 0) findings.push({ id: record.id, category: "expired-active", message: "active record is past reviewBy" });
      else if (days <= warningDays) findings.push({ id: record.id, category: "review-due", message: `review due in ${days} day(s)` });
      const verifiedAt = Date.parse(`${record.verifiedOn}T23:59:59Z`);
      if (now - verifiedAt > staleDays * 86400000) findings.push({ id: record.id, category: "stale-verification", message: "verification is stale" });
    }
    return findings;
  });
}