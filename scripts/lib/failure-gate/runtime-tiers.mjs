import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const playwrightReport = "test-results/failure-gate/playwright.json";
const reentrancyChecks = [
  "nested validation exited 0",
  "outer run reached its manifest step",
  "nested tier reached its manifest step",
  "nested tier did not inherit the outer task plan",
  "nested tier used the owned reentrancy path",
  "nested tier did not wait behind its owning lock",
  "nested manifest step ran exactly once",
];

function boundedPlaywrightReport(root) {
  if (!root) throw new Error("FAILURE-GATE BLOCKED: Playwright report root unavailable");
  // Fixed relative path; reject symlinked parents as well as the file itself.
  for (const parent of ["test-results", "test-results/failure-gate"]) {
    if (!lstatSync(resolve(root, parent)).isDirectory())
      throw new Error("FAILURE-GATE BLOCKED: unsafe Playwright report directory");
  }
  const fd = openSync(resolve(root, playwrightReport), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > 16 * 1024 * 1024)
      throw new Error("FAILURE-GATE BLOCKED: invalid Playwright report size");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!read) throw new Error("FAILURE-GATE BLOCKED: partial Playwright report");
      offset += read;
    }
    const after = fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw new Error("FAILURE-GATE BLOCKED: changing Playwright report");
    return JSON.parse(bytes.toString("utf8"));
  } finally { closeSync(fd); }
}

function parsePlaywright(root, step, environment, outputDigest) {
  const report = boundedPlaywrightReport(root);
  if (!Array.isArray(report.errors) && report.errors !== undefined ||
      report.errors?.length || !Array.isArray(report.suites))
    throw new Error("FAILURE-GATE BLOCKED: incomplete Playwright run");
  const identities = new Set();
  const failures = [];
  const passedTests = [];
  let tests = 0;
  let skipped = 0;
  const walk = (suites, titles = []) => {
    if (!Array.isArray(suites)) throw new Error("FAILURE-GATE BLOCKED: missing Playwright suites");
    for (const suite of suites) {
      if (!Array.isArray(suite.specs) && suite.specs !== undefined ||
          !Array.isArray(suite.suites) && suite.suites !== undefined)
        throw new Error("FAILURE-GATE BLOCKED: incomplete Playwright suite");
      const path = suite.title ? [...titles, suite.title] : titles;
      for (const spec of suite.specs ?? []) {
        if (!Array.isArray(spec.tests) || !spec.tests.length || typeof spec.title !== "string")
          throw new Error("FAILURE-GATE BLOCKED: incomplete Playwright spec");
        for (const entry of spec.tests) {
          if (typeof entry.projectName !== "string" || !entry.projectName ||
              !Array.isArray(entry.results) || !entry.results.length ||
              !["expected", "unexpected", "flaky", "skipped"].includes(entry.status))
            throw new Error("FAILURE-GATE BLOCKED: incomplete Playwright test");
          const name = [...path, spec.title].filter(Boolean).join(" > ");
          const identity = { suite: step.name, test: `${entry.projectName}: ${name}`,
            variant: entry.projectName, environment };
          if (!name || identities.has(identity.test))
            throw new Error("FAILURE-GATE BLOCKED: duplicate Playwright test identity");
          identities.add(identity.test);
          tests++;
          if (entry.status === "skipped") { skipped++; continue; }
          if (entry.status === "unexpected") {
            failures.push({ ...identity, signature: `sha256:${hash(JSON.stringify(entry.results.map(
              ({ status, errors }) => ({ status, errors }))))}` });
          } else if (entry.status === "expected" || entry.status === "flaky") {
            if (!entry.results.some((result) => result.status === "passed"))
              throw new Error("FAILURE-GATE BLOCKED: Playwright pass without passing result");
            passedTests.push(identity);
          }
        }
      }
      walk(suite.suites ?? [], path);
    }
  };
  walk(report.suites);
  if (!Number.isSafeInteger(report.stats?.expected) || !Number.isSafeInteger(report.stats?.unexpected) ||
      !Number.isSafeInteger(report.stats?.flaky) || !Number.isSafeInteger(report.stats?.skipped) ||
      tests < 1 || report.stats.expected + report.stats.unexpected +
      report.stats.flaky + report.stats.skipped !== tests ||
      report.stats.unexpected !== failures.length || report.stats.skipped !== skipped ||
      report.stats.expected + report.stats.flaky !== passedTests.length)
    throw new Error("FAILURE-GATE BLOCKED: Playwright discovery mismatch");
  return { tests, skipped, outputDigest, parser: "playwright-json-v1", complete: true,
    expectedRuns: 1, observedRuns: 1, failures, passedTests };
}

function parseReentrancy(text, step, environment, outputDigest) {
  const checks = [...text.matchAll(/^  (PASS|FAIL): (.+)$/gm)];
  const seen = new Set();
  const failures = [];
  const passedTests = [];
  for (const [, state, message] of checks) {
    const name = reentrancyChecks.find((check) => message === check ||
      (check === "nested validation exited 0" && /^nested validation exited 0 \(got .+\)$/.test(message)));
    if (!name || seen.has(name)) throw new Error("FAILURE-GATE BLOCKED: unknown or duplicate reentrancy check");
    seen.add(name);
    const identity = { suite: step.name, test: name, variant: "non-smoke", environment };
    if (state === "FAIL") failures.push({ ...identity, signature: `sha256:${hash(message)}` });
    else passedTests.push(identity);
  }
  return { tests: seen.size, skipped: 0, outputDigest, parser: "reentrancy-assertions-v1",
    complete: seen.size === reentrancyChecks.length && (failures.length > 0 ||
      text.includes("[ci-collision-test] Non-smoke reentrancy regression passed.")),
    expectedRuns: 1, observedRuns: seen.size === reentrancyChecks.length ? 1 : 0,
    failures, passedTests };
}

function identitiesForRows(rows, step, environment, variant, signature) {
  const seen = new Set();
  const failures = [];
  const passedTests = [];
  for (const [state, name] of rows) {
    if (!name || seen.has(name)) throw new Error("FAILURE-GATE BLOCKED: duplicate or unnamed test");
    seen.add(name);
    const identity = { suite: step.name, test: name, variant, environment };
    if (state === "fail") failures.push({ ...identity, signature });
    else passedTests.push(identity);
  }
  return { failures, passedTests };
}

function nodeTapRows(body) {
  const headings = new Map();
  const rows = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = line.match(/^(\s*)# Subtest: (.+)$/);
    if (heading) {
      const depth = heading[1].length;
      for (const key of headings.keys()) if (key >= depth) headings.delete(key);
      headings.set(depth, { name: heading[2], hasChildren: false });
      continue;
    }
    const result = line.match(/^(\s*)(ok|not ok) \d+ - (.+)$/);
    if (!result) continue;
    const depth = result[1].length;
    const entry = headings.get(depth);
    if (entry && entry.name !== result[3])
      throw new Error("FAILURE-GATE BLOCKED: Node TAP heading/result mismatch");
    const parents = [...headings.entries()].filter(([level]) => level < depth)
      .sort(([a], [b]) => a - b);
    for (const [, parent] of parents) parent.hasChildren = true;
    if (entry?.hasChildren) {
      // A completed suite is not a test identity; its children are.
    } else {
      rows.push([result[2] === "ok" ? "pass" : "fail",
        [...parents.map(([, parent]) => parent.name), result[3]].join(" > ")]);
    }
    if (entry) headings.delete(depth);
  }
  return rows;
}

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
      } else if (step.name === "nested-tier-regression" &&
          step.command.join(" ") === "npm run test:validation-reentrancy" &&
          pkg.scripts["test:validation-reentrancy"] === "node scripts/ci-collision-test.mjs --non-smoke") {
        adapter = { kind: "reentrancy-assertions-v1", expectedRuns: 1 };
      } else if (step.name === "browser-tests" &&
          step.command.join(" ") === "node scripts/run-browser-tests.mjs") {
        adapter = { kind: "playwright-json-v1", expectedRuns: 1 };
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
export function parseRuntimeReport({ output, step, environment, root, truncated = false }) {
  if (truncated) throw new Error("FAILURE-GATE BLOCKED: truncated test output");
  const text = output.replace(/\u001b\[[0-9;]*m/g, "");
  const outputDigest = hash(text);
  if (step.reportAdapter?.kind === "playwright-json-v1")
    return parsePlaywright(root, step, environment, outputDigest);
  if (step.reportAdapter?.kind === "reentrancy-assertions-v1")
    return parseReentrancy(text, step, environment, outputDigest);
  let summaries = [];
  let failures = [];
  let passedTests = [];
  if (step.reportAdapter?.kind === "node-console-v1") {
    const starts = [...text.matchAll(/^(?:#|ℹ)\s+tests\s+(\d+)\s*$/gm)];
    for (let i = 0; i < starts.length; i++) {
      const section = text.slice(starts[i].index, starts[i + 1]?.index ?? text.length);
      const body = text.slice(i === 0 ? 0 : starts[i - 1].index, starts[i].index);
      const number = (field) => {
        const values = [...section.matchAll(new RegExp("^(?:#|ℹ)\\s+" + field + "\\s+(\\d+)\\s*$", "gm"))];
        if (values.length !== 1) throw new Error("FAILURE-GATE BLOCKED: incomplete Node summary");
        return Number(values[0][1]);
      };
      summaries.push({ tests: Number(starts[i][1]), passed: number("pass"),
        failed: number("fail"), skipped: number("skipped"), todo: number("todo"),
        cancelled: number("cancelled") });
      const tap = nodeTapRows(body);
      const spec = [...body.matchAll(/^(✔|✖)\s+(.+?)\s+\([\d.,]+(?:ms|s)\)\s*$/gm)]
        .map(([, state, name]) => [state === "✔" ? "pass" : "fail", name]);
      if (tap.length && spec.length)
        throw new Error("FAILURE-GATE BLOCKED: mixed Node test reporters");
      const rows = tap.length ? tap : spec;
      if (rows.length !== summaries[i].passed + summaries[i].failed ||
          rows.filter(([state]) => state === "fail").length !== summaries[i].failed)
        throw new Error("FAILURE-GATE BLOCKED: Node test identity count mismatch");
      const identified = identitiesForRows(rows, step, environment,
        `node-run-${i + 1}`, `sha256:${outputDigest}`);
      failures.push(...identified.failures);
      passedTests.push(...identified.passedTests);
    }
  } else if (step.reportAdapter?.kind === "serial-lock-summary-v1") {
    summaries = [...text.matchAll(/^Results: (\d+) passed, (\d+) failed\s*$/gm)].map((match) => ({
      tests: Number(match[1]) + Number(match[2]), passed: Number(match[1]),
      failed: Number(match[2]), skipped: 0, todo: 0, cancelled: 0,
    }));
    const rows = [...text.matchAll(/^  (PASS|FAIL)  (.+)$/gm)]
      .map(([, state, name]) => [state === "PASS" ? "pass" : "fail", name]);
    if (summaries.length !== 1 || rows.length !== summaries[0].tests ||
        rows.filter(([state]) => state === "fail").length !== summaries[0].failed)
      throw new Error("FAILURE-GATE BLOCKED: serial-lock test identity count mismatch");
    const identified = identitiesForRows(rows, step, environment,
      "serial-lock", `sha256:${outputDigest}`);
    failures = identified.failures;
    passedTests = identified.passedTests;
  } else throw new Error("FAILURE-GATE BLOCKED: report adapter unavailable");
  if (summaries.length === 0 ||
      summaries.some((s) => s.tests < 1 || s.tests !== s.passed + s.failed + s.skipped + s.todo + s.cancelled)) {
    throw new Error("FAILURE-GATE BLOCKED: missing test process/discovery summary");
  }
  const tests = summaries.reduce((n, s) => n + s.tests, 0);
  const skipped = summaries.reduce((n, s) => n + s.skipped + s.todo + s.cancelled, 0);
  return { tests, skipped, outputDigest, parser: step.reportAdapter.kind,
    complete: summaries.length === step.reportAdapter.expectedRuns,
    expectedRuns: step.reportAdapter.expectedRuns, observedRuns: summaries.length,
    failures, passedTests };
}