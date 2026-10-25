#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { invariant, pins, readRegistry, taskState, tierDefinition, TIERS, mergeGuard, git, environmentAvailability } from "./lib/unified-gate/store.mjs";
import { provision, amend, guard, restorePlan, cancel, catalog, baselineWarnings, prepareDraft } from "./lib/unified-gate/plans.mjs";
import { run, classificationLog } from "./lib/unified-gate/execution.mjs";
import { parseInput } from "./lib/unified-gate/regression.mjs";
import { summaryHistory } from "./lib/unified-gate/summaries.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [operation, ...args] = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}
function input(name = "spec") {
  const path = option(name);
  invariant(path, `--${name} JSON path required`);
  return parseInput(readFileSync(resolve(process.cwd(), path), "utf8"));
}
const id = option("id") ?? process.env.TASK_ID;
const tier = option("tier");
const context = { id, tier, planFile: process.env.TASK_PLAN_FILE };
try {
  if (operation === "run") {
    const values = new Set(["id", "tier", "step", "file", "case", "pattern"]);
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
      const name = args[i].replace(/^--/, "");
      invariant(args[i].startsWith("--") && (values.has(name) || name === "recover"),
        `unknown run option: ${args[i]}`);
      invariant(!seen.has(name), `duplicate run option: --${name}`);
      seen.add(name);
      if (values.has(name)) {
        invariant(typeof args[i + 1] === "string" && !args[i + 1].startsWith("--"),
          `--${name} requires a value`);
        i++;
      }
    }
  }
  // This check applies to every gate command, including diagnostics/status.
  const pin = pins(root);
  invariant(!process.env.TASK_ID || !id || process.env.TASK_ID === id, "TASK_ID context mismatch");
  let result;
  switch (operation) {
    case "history": {
      invariant(args.every((arg, index) => index % 2
        ? !arg.startsWith("--") : ["--run", "--limit"].includes(arg)) &&
        args.length % 2 === 0 && new Set(args.filter((_, i) => i % 2 === 0)).size === args.length / 2,
      "history accepts only --run <UUID> and --limit <1-100>");
      result = summaryHistory(root, { runId: option("run"),
        limit: option("limit") === undefined ? 10 : Number(option("limit")) });
      break;
    }
    case "draft": result = prepareDraft(root, input()); break;
    case "new": result = await provision(root, input(), option("resume")); break;
    case "amend": result = await amend(root, id, input(), option("reason")); break;
    case "guard": {
      const registry = readRegistry(root); mergeGuard(root, registry);
      result = { status: "ADMITTED", id: guard(root, context, registry).id, revision: taskState(registry.tasks[id]).revision };
      break;
    }
    case "restore-plan": result = await restorePlan(root, id); break;
    case "cancel":
      result = await cancel(root, id, { reason: option("reason"),
        ...(option("direction") ? { completionMode: "owner_direction",
          direction: option("direction"), reference: option("reference") } : {}) });
      break;
    case "run": result = await run(root, context, {
      stepName: option("step"), recoverOnly: args.includes("--recover"),
      ...(["file", "case", "pattern"].some((name) => option(name) !== undefined) ? {
        selector: Object.fromEntries(["file", "case", "pattern"]
          .filter((name) => option(name) !== undefined).map((name) => [name, option(name)])),
      } : {}),
    }); break;
    case "classify": {
      const observation = input("observation");
      result = await classificationLog(root, context, observation.failure, observation.evidence); break;
    }
    case "merge-guard":
      mergeGuard(root, readRegistry(root), args.includes("--staged"));
      result = { status: "READY", check: "task/tombstone and committed-history preservation" }; break;
    case "baseline-warnings": result = { warnings: baselineWarnings(root) }; break;
    case "status": {
      const registry = readRegistry(root); mergeGuard(root, registry);
      for (const name of TIERS) tierDefinition(root, name);
      const historicalBlockers = [];
      for (const record of Object.values(registry.tasks)) {
        const state = taskState(record); pins(root, state.pin);
        if (state.status === "sealed") {
          try { guard(root, { id: state.id, tier: state.tier, planFile: state.planPath }, registry); }
          catch (error) { historicalBlockers.push({ id: state.id, reason: error.message }); }
        }
      }
      const executionEnvironment = environmentAvailability(root);
      result = { status: historicalBlockers.length ? "BLOCKED" : "CHECKS_AVAILABLE",
        historicalBlockers,
        executionEnvironment,
        historicalBlockerScope: "listed tasks only; not a waiver or universal denial of unrelated admission",
        runtimeAcceptance: pin.acceptance ?? "historical single-file contract",
        nativeAuthorizationObservation: "NOT_OBSERVED",
        check: "gate setup status, not a tier PASS", pin: pin.current,
        tasks: Object.keys(registry.tasks).length, baselines: catalog(root).records.length,
        localHooks: git(root, ["config", "--get", "core.hooksPath"], true).stdout.trim() === ".githooks"
          ? "configured at .githooks" : "not configured in this clone",
        warnings: baselineWarnings(root), enforcement:
          "local sealed-plan and assigned-tier checks only; Agent tracks native approval, cancellation and scope; platform actions are not intercepted" };
      break;
    }
    default: throw new Error("supported operations: draft, new, amend, guard, restore-plan, cancel, run, classify, merge-guard, baseline-warnings, status, history");
  }
  console.log(JSON.stringify(result, null, 2));
  if (operation === "run" && result.state !== "PASS") process.exitCode = 1;
  if (operation === "status" && result.status === "BLOCKED") process.exitCode = 2;
} catch (error) {
  console.error(JSON.stringify({ state: "BLOCKED", check: operation, reason: error.message }));
  process.exitCode = 2;
}
