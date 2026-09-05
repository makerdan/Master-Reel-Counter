import { readFileSync } from "fs";
import { resolve } from "path";

export const TIERS_PATH = resolve(".agents/skills/validation-tiers/tiers.json");
export function loadTiers(path = TIERS_PATH) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (data.schemaVersion !== 1 || !data.tiers || typeof data.tiers !== "object") {
    throw new Error("tier registry must have schemaVersion 1 and tiers");
  }
  for (const [name, tier] of Object.entries(data.tiers)) {
    if (!name.startsWith("test-") || !Array.isArray(tier.steps) || tier.steps.length === 0) {
      throw new Error(`invalid tier registry entry ${name}`);
    }
    for (const step of tier.steps) {
      if (!step.name || !step.kind || !step.command) throw new Error(`invalid step in ${name}`);
    }
  }
  return data.tiers;
}