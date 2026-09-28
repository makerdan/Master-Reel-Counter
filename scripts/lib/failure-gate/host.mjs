import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync, rmSync, readdirSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSnapshot, verifySnapshot, inputManifest } from "./evidence.mjs";
import { digest } from "./coordinator.mjs";
import { policyDigest, projectFile } from "./execution.mjs";
import { adaptRuntimeTiers } from "./runtime-tiers.mjs";

const here = fileURLToPath(import.meta.url);
const repository = resolve(here, "../../../..");
const blocked = (text) => { throw new Error(`FAILURE-GATE BLOCKED: ${text}`); };
const sleep = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

// A separate guardian is actually launched beneath the existing serial-lock.
// Its ready marker is not approval and never establishes platform identity.
if (process.argv[1] && resolve(process.argv[1]) === here && process.argv[2] === "--guardian") {
  const directory = process.argv[3];
  const holder = Number(process.env[process.argv[4]]);
  if (!Number.isSafeInteger(holder) || holder < 1 || !directory) process.exit(2);
  writeFileSync(resolve(directory, "ready"), String(process.pid), { flag: "wx", mode: 0o600 });
  while (!existsSync(resolve(directory, "release"))) await sleep(25);
}

export function policyDeclaration({ root, policyInputs, tiers, parameters, environment, exclusions = [] }) {
  return { version: 4, mode: "workflow", policyDigest: policyDigest(root, policyInputs),
    adapterDigest: policyDigest(repository, [
      "scripts/serial-lock.mjs", "scripts/lib/failure-gate/host.mjs",
      "scripts/lib/failure-gate/execution.mjs", "scripts/lib/failure-gate/assessment.mjs",
      "scripts/lib/failure-gate/evidence.mjs", "scripts/lib/failure-gate/coordinator.mjs",
      "scripts/lib/failure-gate/runtime-tiers.mjs",
    ]),
    tiersDigest: digest(tiers), parametersDigest: digest(parameters),
    environmentDigest: digest(environment), exclusionsDigest: digest(exclusions),
    activation: "requires independent exact policy review", platformCompletion: "BLOCKED" };
}

export function runtimePolicyInputs(root) {
  const inputs = ["package.json", "package-lock.json", "docs/validation/manifest.json",
    ".agents/skills/validation-tiers/tiers.json"];
  function walk(path) {
    for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name.includes(".test.")) continue;
      const name = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (/\.(?:mjs|sh)$/.test(entry.name)) inputs.push(name);
    }
  }
  walk("scripts");
  return inputs.sort();
}

// Actual repository mapping, not fixture tier substitution. Unsupported heavy
// interfaces are retained by name and fail preflight before ANY tier command.
export function createRuntimeHost(options) {
  const { tiers, unsupported } = adaptRuntimeTiers({ root: options.root });
  const host = createLocalHost({ ...options, tiers, policyInputs: runtimePolicyInputs(options.root) });
  return { host, unsupported };
}

/**
 * Single-workspace concrete adapter. `control` belongs to the workspace owner
 * and is injected by the coordinator installation, not a project CLI flag.
 * This is procedural workflow approval, not cryptographic attestation.
 */
export function createLocalHost({
  root, directory, tiers, policyInputs, parameters, environment, exclusions = [],
  control, approvalReference,
}) {
  root = realpathSync(root);
  directory = resolve(directory);
  const rel = relative(root, directory);
  if ((!rel.startsWith(`..${sep}`) && rel !== "..") || directory.split(sep).includes(".local")) {
    blocked("evidence/snapshots must be outside project inputs and .local");
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory) blocked("state symlink");
  const declaration = policyDeclaration({ root, policyInputs, tiers, parameters, environment, exclusions });
  const approval = control?.acceptPolicy?.({ reference: approvalReference, declaration });
  if (!approval || approval.reference !== approvalReference ||
      approval.declarationDigest !== digest(declaration) || !approval.reviewer) {
    blocked("independent exact policy acceptance unavailable");
  }
  // Resource implementation and bridge are policy inputs even for fixture hosts.
  const schedulerDigest = policyDigest(repository, [
    "scripts/serial-lock.mjs", "scripts/lib/failure-gate/host.mjs",
  ]);
  const snapshots = new Map();
  const host = {
    mode: "workflow", accepted: true, tiers, policyInputs, parameters, environment, exclusions,
    verifyPolicy: () => digest(policyDeclaration({
      root, policyInputs, tiers, parameters, environment, exclusions,
    })) === approval.declarationDigest,
    processIdentity: () => ({ pid: process.pid,
      startIdentity: `${process.pid}:${readFileSync(`/proc/${process.pid}/stat`, "utf8").split(" ").at(21)}` }),
    snapshot: ({ runId }) => {
      const result = createSnapshot({ root, destination: resolve(directory, `snapshot-${runId}`),
        environment, exclusions });
      snapshots.set(runId, result);
      return result;
    },
    comparisonSnapshot: ({ comparison, runId }) => {
      const earlier = control.earlierSnapshot?.({ comparison });
      if (!earlier || realpathSync(earlier.root) === root ||
          digest(earlier.environment) !== comparison.environmentDigest) {
        blocked("verified earlier source/environment unavailable");
      }
      const manifest = inputManifest({ root: earlier.root, environment: earlier.environment,
        exclusions: earlier.exclusions ?? exclusions });
      if (manifest.digest !== comparison.earlierSnapshotDigest) blocked("earlier snapshot changed");
      return createSnapshot({ root: earlier.root, destination: resolve(directory, `comparison-${runId}`),
        environment: earlier.environment, exclusions: earlier.exclusions ?? exclusions });
    },
    verifySnapshot: (snapshot) => Boolean(verifySnapshot(snapshot)),
    withResourceLock: async (tier, action) => {
      if (policyDigest(repository, ["scripts/serial-lock.mjs", "scripts/lib/failure-gate/host.mjs"]) !== schedulerDigest) {
        blocked("resource scheduler changed after policy review");
      }
      if (!/^[a-z0-9-]+$/.test(tier.resource ?? "")) blocked("registered resource required");
      const rendezvous = resolve(directory, `lock-${randomUUID()}`);
      mkdirSync(rendezvous, { mode: 0o700 });
      const marker = `VALIDATION_LOCK_HELD_PID_${tier.resource.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
      const budget = tier.timeoutMs ?? 300000;
      const child = spawn(process.execPath, [
        resolve(repository, "scripts/serial-lock.mjs"), "--resource", tier.resource,
        "--priority", String(tier.priority ?? 2),
        "--timeout-ms", String(budget), "--", process.execPath, here, "--guardian", rendezvous, marker,
      ], { cwd: root, env: { PATH: process.env.PATH }, stdio: "ignore" });
      let ended = false;
      const closed = new Promise((done) => {
        child.once("error", () => { ended = true; done(1); });
        child.once("close", (code) => { ended = true; done(code ?? 1); });
      });
      const deadline = Date.now() + budget;
      try {
        while (!existsSync(resolve(rendezvous, "ready"))) {
          if (ended || Date.now() > deadline) blocked("resource acquisition incomplete");
          await sleep(25);
        }
        const result = await action({ held: true, stillHeld: () => !ended });
        if (ended) blocked("resource guardian ended before required work");
        return result;
      } finally {
        writeFileSync(resolve(rendezvous, "release"), "", { mode: 0o600 });
        if (Date.now() > deadline) child.kill("SIGTERM");
        await closed;
        rmSync(rendezvous, { recursive: true, force: true });
      }
    },
    storeEvidence: (evidence) => {
      const name = `${evidence.runId}.json`;
      writeFileSync(resolve(directory, name), JSON.stringify(evidence), { flag: "wx", mode: 0o600 });
      return name;
    },
    readEvidence: (reference) => {
      const path = projectFile(directory, reference);
      const bytes = readFileSync(path);
      if (bytes.length > 1024 * 1024) blocked("evidence exceeds bound");
      return JSON.parse(bytes.toString("utf8"));
    },
    withFinalWriterLock: (action) => {
      if (typeof control.withFinalWriterLock !== "function") blocked("final writer coordination unavailable");
      return control.withFinalWriterLock(action);
    },
    currentCatalog: () => control.currentCatalog?.() ?? [],
    reviewedProvenance: (runId) => control.reviewedProvenance?.(runId) ?? [],
  };
  return host;
}