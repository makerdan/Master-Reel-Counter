#!/usr/bin/env node
import { loadCatalog, maintenanceFindings } from "./lib/baseline.mjs";
const warningDays = Number(process.env.BASELINE_WARNING_DAYS ?? 30);
const staleDays = Number(process.env.BASELINE_STALE_DAYS ?? 90);
try {
  const findings = maintenanceFindings(loadCatalog(), { warningDays, staleDays });
  if (!findings.length) {
    console.log("Validation baseline maintenance: no findings.");
    process.exit(0);
  }
  for (const finding of findings) console.log(`[${finding.category}] ${finding.id}: ${finding.message}`);
  process.exit(1);
} catch (error) {
  console.error(`Validation baseline maintenance: ${error.message}`);
  process.exit(2);
}