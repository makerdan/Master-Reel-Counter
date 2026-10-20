#!/usr/bin/env node
// Bounded workload primitive, NOT task admission or task completion.
// Its independent monitor survives loss of the top-level gate runner.
import { runOwnedProcessGroup } from "./lib/owned-process-group.mjs";
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
const controller = new AbortController();
let timeout = false;
const budget = Number(process.argv[2]);
const command = JSON.parse(process.argv[3]);
if (!Number.isInteger(budget) || budget <= 0 || !Array.isArray(command) ||
  !command.length || !command.every((s) => typeof s === "string" && s)) process.exit(125);
const timer = setTimeout(() => { timeout = true; controller.abort(); }, budget);
const onSignal = () => controller.abort();
process.once("SIGTERM", onSignal); process.once("SIGINT", onSignal);
try {
  const result = await runOwnedProcessGroup(command[0], command.slice(1), {
    cwd: process.cwd(), env: process.env, signal: controller.signal,
    terminationGraceMs: 250, terminationWaitMs: 1500,
  });
  process.exitCode = timeout ? 124 : !result.groupGone ? 125 : result.status;
} catch {
  process.exitCode = 125;
} finally {
  clearTimeout(timer);
  process.removeListener("SIGTERM", onSignal); process.removeListener("SIGINT", onSignal);
}
