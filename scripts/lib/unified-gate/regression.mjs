import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const POLICY = "docs/validation/regression-guard-pin.json";
const files = ["SKILL.md", "reference/delivery-handoff.md", "reference/enforcement-contract.md"].sort();
const hash = (x) => createHash("sha256").update(x).digest("hex");
function requireThat(ok, why) { if (!ok) throw new Error(`Regression Guard: ${why}`); }
export function parseInput(bytes) {
  const value = JSON.parse(bytes); // Establish valid JSON before token inspection.
  const stack = [];
  for (const [token] of bytes.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/g)) {
    const top = stack.at(-1);
    if (token === "{") stack.push({ keys: new Set(), key: true });
    else if (token === "[") stack.push({ key: false });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === ":" && top?.keys) top.key = false;
    else if (token === "," && top?.keys) top.key = true;
    else if (token.startsWith('"') && top?.keys && top.key) {
      const key = JSON.parse(token);
      requireThat(!top.keys.has(key), `duplicate JSON field: ${key}`);
      top.keys.add(key);
    }
  }
  return value;
}
function complete(x, field) {
  requireThat(typeof x === "string" && x.trim().length >= 12 &&
    !/\bTODO\b|\bTBD\b|<[^>]+>|tests? the fix|^hard to test$/i.test(x) &&
    !/^##|\*\*(?:Covers|Test location|What it checks|N\/A|Self-satisfying)/m.test(x),
  `${field} must be concrete, without placeholders or embedded declarations`);
  return x.trim();
}
export function contract(root, safePath, recorded) {
  const unifiedPath = safePath(root, "docs/validation/unified-pin.json");
  const adopted = existsSync(unifiedPath)
    ? JSON.parse(readFileSync(unifiedPath)).regressionGuard : undefined;
  if (!existsSync(safePath(root, POLICY))) {
    requireThat(!recorded && !adopted, "recorded/adopted contract mapping unavailable");
    return null;
  }
  const pin = JSON.parse(readFileSync(safePath(root, POLICY)));
  requireThat(!adopted || pin.current === adopted, "selected project companion pin mismatch");
  for (const [directory, expected] of [
    [".agents/skills/regression-guard", pin.current],
    [pin.revisions?.[recorded ?? pin.current], recorded ?? pin.current],
  ]) {
    requireThat(typeof directory === "string" && /^[a-f0-9]{64}$/.test(expected), "unknown contract mapping");
    const actual = hash(files.map((name) =>
      `${name}\0${hash(readFileSync(safePath(root, join(directory, name))))}\n`).join(""));
    requireThat(actual === expected, "core/reference contract drift");
  }
  return recorded ?? pin.current;
}
export function declaration(value) {
  requireThat(value && typeof value === "object" && !Array.isArray(value), "one structured declaration required");
  const { form, material, rationale } = value;
  requireThat(typeof material === "boolean", "explicit material-scope classification required");
  complete(rationale, "scope rationale");
  requireThat(form !== "deferred", "deferral capability unavailable; deliver coverage here");
  const fields = {
    normal: ["covers", "testLocation", "assertion"],
    na: ["category", "scenario", "evidence", "alternatives", "residualRisk"],
    self: ["testLocation", "assertion"],
    excluded: ["category"],
  }[form];
  requireThat(fields, "unknown form");
  requireThat(Object.keys(value).every((k) => ["form", "material", "rationale", ...fields].includes(k)),
    "mixed forms or unknown fields");
  requireThat(!material || ["normal", "na"].includes(form), "material scope cannot be excluded or self-satisfying");
  for (const field of fields.filter((k) => k !== "category")) complete(value[field], field);
  if (value.testLocation) requireThat(
    /^[^/\\][^\\]*\.[a-z0-9]+(?:\s|$)/i.test(value.testLocation) &&
    !/^[a-z]:/i.test(value.testLocation) &&
    !value.testLocation.split(/[ /]/).includes(".."),
    "test location must identify a project-relative file and concrete case");
  if (form === "na") requireThat(
    ["real-timing", "external-service", "visual", "removed"].includes(value.category), "unsupported N/A category");
  if (form === "excluded") requireThat(
    ["additive", "cosmetic", "internal", "deletion-marked"].includes(value.category), "unsupported exclusion");
  if (form === "normal") return `**Covers:** ${value.covers}\n**Test location:** ${value.testLocation}\n**What it checks:** ${value.assertion}`;
  if (form === "na") return `**N/A**\n**Why N/A:** ${value.category}: ${value.scenario}; evidence: ${value.evidence}; alternatives: ${value.alternatives}; residual risk: ${value.residualRisk}`;
  if (form === "self") return `**Self-satisfying** — ${value.testLocation}: ${value.assertion}. ${rationale}`;
  return null; // Exclusion classification stays in sealed metadata, not a fake normal form.
}
