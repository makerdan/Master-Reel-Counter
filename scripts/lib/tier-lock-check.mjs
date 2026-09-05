import { existsSync, readFileSync } from "fs";
import { loadTiers } from "./tiers.mjs";
import { resolve } from "path";

function isRegisteredTier(command) {
  if (loadTiers()[command]) return true;
  try {
    const manifest = JSON.parse(readFileSync(resolve("docs/validation/manifest.json"), "utf8"));
    return Boolean(manifest.tiers?.[command]);
  } catch {
    return false;
  }
}

export function readPlanTier(planPath) {
  if (!planPath || !planPath.endsWith(".md")) throw new Error("TIER-LOCK VIOLATION: plan path must end in .md");
  if (!existsSync(planPath)) throw new Error(`TIER-LOCK VIOLATION: plan does not exist: ${planPath}`);
  let content;
  try { content = readFileSync(planPath, "utf8"); } catch (error) {
    throw new Error(`TIER-LOCK VIOLATION: plan is unreadable: ${error.message}`);
  }
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Validation");
  if (start < 0) throw new Error("TIER-LOCK VIOLATION: plan has no ## Validation section");
  const next = lines.slice(start + 1).findIndex((line) => /^## /.test(line));
  const body = lines.slice(start + 1, next < 0 ? lines.length : start + 1 + next).join("\n");
  const command = body.match(/^\*\*Command:\*\*\s*`?([^`\n]+)`?\s*$/m)?.[1]?.trim();
  if (!command) throw new Error("TIER-LOCK VIOLATION: Validation has no Command");
  if (!isRegisteredTier(command)) throw new Error(`TIER-LOCK VIOLATION: unregistered tier ${command}`);
  return { planPath, command, content };
}

export function assertRequestedTier(planPath, requestedTier) {
  const plan = readPlanTier(planPath);
  if (requestedTier && requestedTier !== plan.command) {
    throw new Error(`TIER-LOCK VIOLATION: requested ${requestedTier} but plan locks ${plan.command}`);
  }
  return plan;
}