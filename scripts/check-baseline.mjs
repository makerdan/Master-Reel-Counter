#!/usr/bin/env node
import { loadCatalog } from "./lib/baseline.mjs";
try {
  const catalog = loadCatalog();
  console.log(`Baseline catalog valid: ${catalog.records.length} record(s).`);
} catch (error) {
  console.error(`Baseline catalog invalid: ${error.message}`);
  process.exit(1);
}