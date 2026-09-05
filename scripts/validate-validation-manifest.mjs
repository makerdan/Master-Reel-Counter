#!/usr/bin/env node
/**
 * Validate the tracked tier manifest and its package-script contract.
 * This check is intentionally side-effect free so it can run in standard tiers.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "docs/validation/manifest.json");
const packagePath = resolve(root, "package.json");
const expectedTiers = ["test-fast", "test-standard", "test-standard-plus", "test-heavy"];

function fail(message) {
  console.error(`[validation-manifest] FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) fail(`missing ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
if (manifest.version !== 1 || !manifest.tiers) fail("manifest must declare version 1 and tiers");

for (const tier of expectedTiers) {
  const entry = manifest.tiers[tier];
  if (!entry) fail(`missing tier '${tier}'`);
  if (entry.packageScript !== `npm run ${tier}`) fail(`${tier} has incorrect packageScript`);
  if (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0) fail(`${tier} needs a positive timeoutMs`);
  if (!Number.isInteger(entry.priority) || entry.priority < 1 || entry.priority > 9) fail(`${tier} needs priority 1-9`);
  if (!Array.isArray(entry.steps) || entry.steps.length === 0) fail(`${tier} needs executable steps`);
  if (packageJson.scripts?.[tier] !== `node scripts/run-tier.mjs ${tier}`) {
    fail(`package.json script '${tier}' must route through the canonical tier runner`);
  }
  for (const step of entry.steps) {
    if (!step.name || !Array.isArray(step.command) || step.command.length === 0) {
      fail(`${tier} contains an invalid step`);
    }
  }
}

console.log(`[validation-manifest] PASS: ${expectedTiers.length} tiers and package-script parity verified.`);