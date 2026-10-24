import { readFileSync, statSync } from "node:fs";
import { relative, resolve, isAbsolute } from "node:path";
import { invariant, safePath } from "./store.mjs";

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function retryOptions(options = {}) {
  invariant(options && typeof options === "object" && !Array.isArray(options), "invalid run options");
  for (const key of Object.keys(options)) invariant(
    ["stepName", "recoverOnly", "selector"].includes(key), `unknown run option: ${key}`);
  if (options.stepName !== undefined) invariant(
    typeof options.stepName === "string" && options.stepName.trim(), "invalid diagnostic step");
  if (options.recoverOnly !== undefined) invariant(typeof options.recoverOnly === "boolean", "invalid recovery option");
  if (options.selector === undefined) return undefined;
  const selector = options.selector;
  invariant(selector && typeof selector === "object" && !Array.isArray(selector), "invalid selector");
  invariant(Object.keys(selector).every((key) => ["file", "case", "pattern"].includes(key)), "unknown selector option");
  invariant(options.stepName && !options.recoverOnly, "selector requires a diagnostic step, not recovery");
  invariant(typeof selector.file === "string" && selector.file.length > 0 && selector.file.length <= 512 &&
    !isAbsolute(selector.file) && !selector.file.split("/").some((s) => !s || s === "." || s === "..") &&
    !/[\\\x00-\x1f*?[\]{}]/.test(selector.file) && !selector.file.startsWith("-"),
  "selector file must be a literal project-relative path");
  invariant(!(selector.case !== undefined && selector.pattern !== undefined), "case and pattern are mutually exclusive");
  for (const key of ["case", "pattern"]) if (selector[key] !== undefined) invariant(
    typeof selector[key] === "string" && selector[key].trim().length > 0 &&
    selector[key].length <= 256 && !/[\x00-\x1f]/.test(selector[key]), `invalid selector ${key}`);
  if (selector.pattern !== undefined) new RegExp(selector.pattern);
  return { ...selector };
}

// Deliberately not a shell parser. Only plain Node --test commands, literal
// operands/loaders and explicit && / npm aliases are understood. No generic
// argument appending to opaque package scripts.
function nodeWorkloads(root, command, env = {}, seen = new Set()) {
  let tokens = [...command], environment = { ...env };
  while (/^[A-Z_][A-Z0-9_]*=/.test(tokens[0] ?? "")) {
    const [key, ...value] = tokens.shift().split("=");
    if (key !== "VITE_HMR_RECOVERY" || !["0", "1"].includes(value.join("="))) return null;
    environment[key] = value.join("=");
  }
  if (tokens.length === 3 && tokens[0] === "npm" && tokens[1] === "run") {
    const name = tokens[2];
    if (seen.has(name)) return null;
    const script = JSON.parse(readFileSync(safePath(root, "package.json"), "utf8")).scripts?.[name];
    if (typeof script !== "string" || /[|;<>`$"'\\\n\r]/.test(script)) return null;
    const next = new Set([...seen, name]);
    const parts = script.split(" && ");
    if (parts.some((s) => s.includes("&"))) return null;
    const workloads = parts.map((s) => nodeWorkloads(root, s.trim().split(/\s+/), environment, next));
    return workloads.some((s) => !s) ? null : workloads.flat();
  }
  if (!["node", process.execPath].includes(tokens.shift())) return null;
  const loaders = [];
  while (["--import", "--require", "-r", "--loader"].includes(tokens[0])) {
    const flag = tokens.shift(), value = tokens.shift();
    if (!value || value.startsWith("-")) return null;
    loaders.push(flag, value);
  }
  if (tokens.shift() !== "--test" || !tokens.length ||
    tokens.some((s) => s.startsWith("-") || !/^[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts)$/.test(s))) return null;
  return [{ files: tokens, loaders, env: environment }];
}

export function retryAdapter(root, step, selector) {
  const file = safePath(root, selector.file);
  invariant(statSync(file).isFile(), "selector file is not a regular file");
  const common = { selector, registeredCommand: step.command };
  if (JSON.stringify(step.command) === JSON.stringify(["node", "scripts/run-browser-tests.mjs"])) {
    invariant(/^tests\/.+\.spec\.ts$/.test(selector.file) && !selector.file.startsWith("tests/release/"),
      "selector file is outside the registered browser workload");
    return { ...common, runner: "playwright", pattern: selector.case !== undefined
      ? `^ ?${escape(selector.case)}$` : selector.pattern };
  }
  const workloads = nodeWorkloads(root, step.command);
  if (!workloads) return { ...common, runner: "unsupported", unsupported:
    "Registered command is not an explicitly supported Node --test workload or heavy browser wrapper; opaque harness isolation is unavailable." };
  const matches = workloads.filter((w) => w.files.includes(selector.file));
  invariant(matches.length === 1, matches.length ? "ambiguous selector: file occurs in multiple workloads"
    : "selector file is outside the registered Node workload");
  return { ...common, runner: "node", ...matches[0], pattern: selector.case !== undefined
    ? `^${escape(selector.case)}$` : selector.pattern };
}

export function retryCommand(root, adapter, evidencePath) {
  if (adapter.unsupported) return undefined;
  // All execution inputs are generated from validated selectors and registered
  // commands, never caller-supplied executable flags.
  const command = adapter.runner === "node" ? [process.execPath, ...adapter.loaders, "--test",
    `--test-reporter=${resolve(root, "scripts/lib/unified-gate/retry-node-reporter.mjs")}`,
    ...(adapter.pattern !== undefined ? ["--test-name-pattern", adapter.pattern] : []), adapter.selector.file]
    : [process.execPath, resolve(root, "scripts/run-typechecked-playwright.mjs"), "--isolated-database",
      `^${escape(resolve(root, adapter.selector.file))}$`,
      ...(adapter.pattern !== undefined ? ["--grep", adapter.pattern] : []),
      "--reporter", resolve(root, "scripts/lib/unified-gate/retry-browser-reporter.mjs")];
  return [process.execPath, resolve(root, "scripts/lib/unified-gate/retry-dispatch.mjs"),
    JSON.stringify({ ...adapter, evidencePath, command })];
}

export function readRetryEvidence(root, path, adapter) {
  try {
    invariant(statSync(safePath(root, path)).size <= 1_000_000, "execution evidence exceeds bound");
    const bytes = readFileSync(safePath(root, path));
    invariant(bytes.length <= 1_000_000, "execution evidence exceeds bound");
    const report = JSON.parse(bytes);
    invariant(report.schemaVersion === 1 && report.complete === true &&
      report.runner === adapter.runner && Array.isArray(report.tests) &&
      report.tests.every((t) => typeof t.file === "string" &&
        relative(root, resolve(root, t.file)) === adapter.selector.file &&
        typeof t.case === "string" && t.case.length > 0 &&
        ["passed", "failed", "skipped", "cancelled", "todo", "filtered"].includes(t.outcome) &&
        typeof t.executed === "boolean" &&
        (!["skipped", "todo", "cancelled", "filtered"].includes(t.outcome) || !t.executed) &&
        (t.outcome !== "passed" || t.executed) &&
        (adapter.runner !== "playwright" || (typeof t.project === "string" && Number.isInteger(t.attempt)))),
    "missing, malformed or incomplete runner evidence");
    const counts = { observed: report.tests.length, selected: 0, executed: 0, passed: 0, failed: 0,
      skipped: 0, cancelled: 0, todo: 0, filtered: 0 };
    for (const t of report.tests) { counts[t.outcome]++; if (t.executed) counts.executed++; }
    counts.selected = counts.observed - counts.filtered;
    const outcome = !counts.selected ? "NO_MATCH" : !counts.executed ? "NO_EXECUTION"
      : counts.failed || counts.cancelled || report.error ? "FAILED" : "SUCCEEDED";
    return { ...report, counts, outcome,
      ...(outcome === "NO_MATCH" ? { reason: "The runner observed no selected tests; no successful retry occurred." }
        : outcome === "NO_EXECUTION" ? { reason: "No test body execution was established. Skips, cancellation, hook-only attempts and discovery are not successful retries." } : {}) };
  } catch (error) {
    return { outcome: "EVIDENCE_UNAVAILABLE", reason: error.message };
  }
}
