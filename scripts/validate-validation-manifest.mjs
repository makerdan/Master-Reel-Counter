#!/usr/bin/env node
/**
 * Validate the tracked tier manifest and its package-script contract.
 * This check is intentionally side-effect free so it can run in standard tiers.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { loadTiers } from "./lib/tiers.mjs";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "docs/validation/manifest.json");
const packagePath = resolve(root, "package.json");
const registryPath = resolve(root, ".agents/skills/validation-tiers/tiers.json");
const stepKinds = new Set(["typecheck", "test", "lint", "audit", "smoke", "harness"]);

function fail(message) {
  console.error(`[validation-manifest] FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) fail(`missing ${manifestPath}`);
let manifest;
let packageJson;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
} catch (error) {
  fail(`invalid JSON: ${error.message}`);
}
if (
  manifest.version !== 1 ||
  !manifest.tiers ||
  typeof manifest.tiers !== "object" ||
  Array.isArray(manifest.tiers) ||
  Object.keys(manifest.tiers).length === 0
) {
  fail("manifest must declare version 1 and tiers");
}

let registeredTiers;
try {
  registeredTiers = loadTiers(registryPath);
} catch (error) {
  fail(`invalid tier registry: ${error.message}`);
}

const expectedTiers = Object.keys(registeredTiers);
const manifestTiers = Object.keys(manifest.tiers);
const missingTiers = expectedTiers.filter((tier) => !manifestTiers.includes(tier));
const unexpectedTiers = manifestTiers.filter((tier) => !expectedTiers.includes(tier));
if (missingTiers.length || unexpectedTiers.length) {
  const details = [
    missingTiers.length ? `missing ${missingTiers.join(", ")}` : "",
    unexpectedTiers.length ? `unexpected ${unexpectedTiers.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  fail(`manifest tier parity mismatch: ${details}`);
}

for (const tier of expectedTiers) {
  const entry = manifest.tiers[tier];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail(`${tier} must be an object`);
  if (entry.packageScript !== `npm run ${tier}`) fail(`${tier} has incorrect packageScript`);
  if (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0) fail(`${tier} needs a positive timeoutMs`);
  if (!Number.isInteger(entry.priority) || entry.priority < 1 || entry.priority > 9) fail(`${tier} needs priority 1-9`);
  if (!Array.isArray(entry.steps) || entry.steps.length === 0) fail(`${tier} needs executable steps`);
  if (packageJson.scripts?.[tier] !== `node scripts/run-tier.mjs ${tier} --allow-no-plan`) {
    fail(`package.json script '${tier}' must use the canonical runner with the explicit ad-hoc escape hatch`);
  }
  for (const step of entry.steps) {
    if (
      !step ||
      typeof step !== "object" ||
      typeof step.name !== "string" ||
      !step.name.trim() ||
      !stepKinds.has(step.kind) ||
      !Array.isArray(step.command) ||
      step.command.length === 0 ||
      step.command.some((part) => typeof part !== "string" || !part.trim())
    ) {
      fail(`${tier} contains an invalid step`);
    }
  }
}

const securityAudits = manifest.tiers["test-heavy"].steps.filter((step) => step.name === "security-audit");
if (securityAudits.length !== 1) {
  fail("test-heavy must contain exactly one security-audit step");
}

const [securityAudit] = securityAudits;
if (
  securityAudit.kind !== "audit" ||
  JSON.stringify(securityAudit.command) !== JSON.stringify(["npm", "audit", "--audit-level=high"])
) {
  fail("test-heavy security-audit must retain kind audit and the high-severity threshold");
}

console.log(`[validation-manifest] PASS: ${expectedTiers.length} tiers and package-script parity verified.`);