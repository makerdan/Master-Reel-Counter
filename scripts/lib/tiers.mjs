import { readFileSync } from "fs";
import { resolve } from "path";

// The packaged registry is a derivative example, never a fallback live authority.
export const TIERS_PATH = resolve(import.meta.dirname, "../../docs/validation/manifest.json");
const STEP_KINDS = new Set(["typecheck", "test", "lint", "audit", "smoke", "harness"]);

export function loadTiers(path = TIERS_PATH) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (
    (data.schemaVersion !== 1 && data.version !== 1) ||
    !data.tiers ||
    typeof data.tiers !== "object" ||
    Array.isArray(data.tiers) ||
    Object.keys(data.tiers).length === 0
  ) {
    throw new Error("tier registry must have schemaVersion 1 and tiers");
  }
  for (const [name, tier] of Object.entries(data.tiers)) {
    if (
      !name.startsWith("test-") ||
      !tier ||
      typeof tier !== "object" ||
      !Array.isArray(tier.steps) ||
      tier.steps.length === 0
    ) {
      throw new Error(`invalid tier registry entry ${name}`);
    }
    for (const step of tier.steps) {
      if (
        !step ||
        typeof step !== "object" ||
        typeof step.name !== "string" ||
        !step.name.trim() ||
        !STEP_KINDS.has(step.kind) ||
        !Array.isArray(step.command) ||
        step.command.length === 0 ||
        step.command.some((part) => typeof part !== "string" || !part.trim())
      ) {
        throw new Error(`invalid step in ${name}`);
      }
    }
  }
  return Object.fromEntries(Object.entries(data.tiers).map(([name, tier]) => [
    name, { ...tier, serial: tier.serial ?? Boolean(tier.resource) },
  ]));
}

export function getHeavyOnlyStepNames(tiers) {
  const heavy = tiers["test-heavy"];
  const standardPlus = tiers["test-standard-plus"];
  if (!heavy || !standardPlus) {
    throw new Error("runtime tier registry must include test-heavy and test-standard-plus");
  }
  const standardPlusNames = new Set(standardPlus.steps.map((step) => step.name));
  return [...new Set(heavy.steps
    .map((step) => step.name)
    .filter((name) => !standardPlusNames.has(name)))];
}

export function referencedHeavyOnlyStepNames(reason, tiers) {
  if (typeof reason !== "string") return [];
  return getHeavyOnlyStepNames(tiers).filter((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?:$|[^A-Za-z0-9_-])`, "i").test(reason);
  });
}