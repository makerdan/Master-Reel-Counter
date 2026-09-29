#!/usr/bin/env node
import { candidateStatus } from "./lib/failure-gate/execution.mjs";
import { Coordinator, digest } from "./lib/failure-gate/coordinator.mjs";
import { readFileSync } from "node:fs";
import { projectFile } from "./lib/failure-gate/execution.mjs";
import { randomUUID } from "node:crypto";

// Deliberately no --approved, --actor, --adapter, or task-context environment
// fallback: production activation has not been independently accepted.
const [operation, ...extra] = process.argv.slice(2);
if (["draft", "review-request", "tier-status"].includes(operation)) {
  let coordinator;
  try {
    const allowed = new Set(["--root", "--state", "--namespace", "--external-reference", "--plan", "--task-id"]);
    const options = {};
    for (let i = 0; i < extra.length; i += 2) {
      if (!allowed.has(extra[i]) || !extra[i + 1] || options[extra[i]]) throw new Error("invalid arguments");
      options[extra[i]] = extra[i + 1];
    }
    if (!options["--root"]) throw new Error("explicit root required");
    if (operation === "tier-status") {
      if (!options["--state"] || !options["--namespace"] || !options["--task-id"])
        throw new Error("explicit state, namespace, and local task ID required");
      coordinator = new Coordinator({ root: options["--root"], directory: options["--state"],
        namespace: options["--namespace"] });
      console.log(JSON.stringify({ taskId: options["--task-id"],
        statuses: coordinator.tierStatuses(options["--task-id"]) }, null, 2));
    } else if (operation === "draft") {
      if (!options["--state"] || !options["--namespace"]) throw new Error("explicit state and namespace required");
      coordinator = new Coordinator({ root: options["--root"], directory: options["--state"],
        namespace: options["--namespace"] });
      const draft = coordinator.reserve({ externalTaskReference: options["--external-reference"] ?? null,
        key: randomUUID() });
      console.log(JSON.stringify({ ...draft, authorization: "none; draft cannot execute" }));
    } else {
      const bytes = readFileSync(projectFile(options["--root"], options["--plan"]), "utf8");
      console.log(JSON.stringify({ purpose: "review-request", planDigest: digest(bytes),
        approval: "not granted", activation: "BLOCKED: no designated human reviewer or accepted host control adapter" }));
    }
  } catch (error) {
    console.error(`FAILURE-GATE BLOCKED: ${error.message}`);
    process.exitCode = 2;
  } finally { coordinator?.close(); }
} else if (operation === "status" && extra.length === 0) {
  console.log(JSON.stringify(candidateStatus(), null, 2));
} else {
  console.error("FAILURE-GATE BLOCKED: tracked review records do not themselves authorize activation; no designated human reviewer or accepted host control adapter is configured. Use status or tier-status for read-only capability state.");
  process.exitCode = 2;
}