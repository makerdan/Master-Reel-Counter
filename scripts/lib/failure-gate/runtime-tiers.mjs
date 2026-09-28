import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const hash = (text) => createHash("sha256").update(text).digest("hex");

// Discover only known, non-filtered Node test chains. Original commands remain
// byte-for-byte argv-equivalent; npm still executes its own approved scripts.
function nodeRuns(argv, scripts, visited = new Set()) {
  if (argv[0] === "node" && argv.includes("--test") &&
      !argv.some((arg) => /^--test-(?:only|name-pattern|skip-pattern)/.test(arg))) return 1;
  if (argv[0] !== "npm" || argv[1] !== "run" || argv.length !== 3 || visited.has(argv[2])) return null;
  const script = scripts[argv[2]];
  if (typeof script !== "string") return null;
  const next = new Set([...visited, argv[2]]);
  let total = 0;
  for (const part of script.split(/\s+&&\s+/)) {
    // The only registered shell prefix currently used by Node test chains.
    const command = part.replace(/^VITE_HMR_RECOVERY=1\s+/, "");
    if (/[|;<>()`$"'\\]/.test(command)) return null;
    const count = nodeRuns(command.trim().split(/\s+/), scripts, next);
    if (count === null) return null;
    total += count;
  }
  return total || null;
}

export function adaptRuntimeTiers({ root }) {
  const manifest = JSON.parse(readFileSync(resolve(root, "docs/validation/manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const unsupported = [];
  const tiers = Object.fromEntries(Object.entries(manifest.tiers).map(([name, tier]) => [
    name, { ...tier, steps: tier.steps.map((step) => {
      const mapped = { ...step, command: [...step.command], timeoutMs: tier.timeoutMs };
      if (step.kind !== "test") return mapped;
      const runs = nodeRuns(step.command, pkg.scripts);
      let adapter;
      if (runs) adapter = { kind: "node-console-v1", expectedRuns: runs };
      else if (step.command.join(" ") === "npx tsx server/__tests__/ci-serial-lock.test.ts") {
        adapter = { kind: "serial-lock-summary-v1", expectedRuns: 1 };
      }
      if (!adapter) {
        const reason = step.name === "browser-tests"
          ? "Playwright is configured with HTML-only reports; no approved per-test machine-report adapter"
          : "Custom harness has no registered discovery/failure identity report";
        unsupported.push({ tier: name, step: step.name, command: step.command, reason });
        return { ...mapped, unsupportedReport: reason };
      }
      return { ...mapped, minimumTests: 1, expectedTests: 1,
        report: `test-results/failure-gate/${step.name}.json`, reportAdapter: adapter };
    }) },
  ]));
  return { tiers, unsupported };
}

// Output is bounded in the process collector. We never persist raw console text:
// it can contain credentials, endpoints, SQL, or user content. Failure identities
// are exact opaque fingerprints; no volatile normalization or baseline widening.
export function parseRuntimeReport({ output, step, environment, truncated = false }) {
  if (truncated) throw new Error("FAILURE-GATE BLOCKED: truncated test output");
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  let summaries = [];
  if (step.reportAdapter?.kind === "node-console-v1") {
    const starts = [...text.matchAll(/^(?:#|ℹ)\s+tests\s+(\d+)\s*$/gm)];
    for (let i = 0; i < starts.length; i++) {
      const section = text.slice(starts[i].index, starts[i + 1]?.index ?? text.length);
      const number = (field) => {
        const values = [...section.matchAll(new RegExp("^(?:#|ℹ)\\s+" + field + "\\s+(\\d+)\\s*$", "gm"))];
        if (values.length !== 1) throw new Error("FAILURE-GATE BLOCKED: incomplete Node summary");
        return Number(values[0][1]);
      };
      summaries.push({ tests: Number(starts[i][1]), passed: number("pass"),
        failed: number("fail"), skipped: number("skipped"), todo: number("todo"),
        cancelled: number("cancelled") });
    }
  } else if (step.reportAdapter?.kind === "serial-lock-summary-v1") {
    summaries = [...text.matchAll(/^Results: (\d+) passed, (\d+) failed\s*$/gm)].map((match) => ({
      tests: Number(match[1]) + Number(match[2]), passed: Number(match[1]),
      failed: Number(match[2]), skipped: 0, todo: 0, cancelled: 0,
    }));
  } else throw new Error("FAILURE-GATE BLOCKED: report adapter unavailable");
  if (summaries.length === 0 ||
      summaries.some((s) => s.tests < 1 || s.tests !== s.passed + s.failed + s.skipped + s.todo + s.cancelled)) {
    throw new Error("FAILURE-GATE BLOCKED: missing test process/discovery summary");
  }
  const tests = summaries.reduce((n, s) => n + s.tests, 0);
  const skipped = summaries.reduce((n, s) => n + s.skipped + s.todo + s.cancelled, 0);
  const failed = summaries.reduce((n, s) => n + s.failed, 0);
  const outputDigest = hash(text);
  return { tests, skipped, outputDigest, parser: step.reportAdapter.kind,
    complete: summaries.length === step.reportAdapter.expectedRuns,
    expectedRuns: step.reportAdapter.expectedRuns, observedRuns: summaries.length,
    failures: Array.from({ length: failed }, (_, i) => ({
      suite: step.name, test: `opaque-failure-${i + 1}`, signature: `sha256:${outputDigest}`,
      variant: step.reportAdapter.kind, environment,
    })), passedTests: [] };
}