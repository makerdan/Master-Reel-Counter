#!/usr/bin/env node

import { spawn } from "node:child_process";
import http from "node:http";
import { resolve } from "node:path";

const port = Number.parseInt(process.env.PORT ?? "5000", 10);
const startupTimeoutMs = Number.parseInt(
  process.env.DEV_STARTUP_TIMEOUT_MS ?? "30000",
  10,
);
const healthPath = process.env.DEV_HEALTH_PATH ?? "/";
const testEntry =
  process.env.NODE_ENV === "test" ? process.env.DEV_SUPERVISOR_ENTRY : undefined;
const entry = testEntry ? resolve(testEntry) : resolve("server/index.ts");
const tsxCli = resolve("node_modules", "tsx", "dist", "cli.mjs");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("[dev-supervisor] PORT must be an integer from 1 to 65535.");
  process.exit(2);
}

if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1000) {
  console.error("[dev-supervisor] DEV_STARTUP_TIMEOUT_MS must be at least 1000.");
  process.exit(2);
}

let child;
let stopping = false;
const recentCrashes = [];

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const processHandle = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });
    processHandle.once("error", reject);
    processHandle.once("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function probe() {
  return new Promise((resolvePromise) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: healthPath,
        timeout: 1000,
      },
      (response) => {
        response.resume();
        resolvePromise(
          response.statusCode !== undefined && response.statusCode < 500,
        );
      },
    );
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolvePromise(false));
  });
}

async function waitUntilReady(processHandle) {
  const deadline = Date.now() + startupTimeoutMs;
  while (!stopping && processHandle.exitCode === null && Date.now() < deadline) {
    if (await probe()) return true;
    await wait(250);
  }
  return false;
}

function restartDelay() {
  const cutoff = Date.now() - 60_000;
  while (recentCrashes[0] < cutoff) recentCrashes.shift();
  recentCrashes.push(Date.now());
  return Math.min(500 * 2 ** (recentCrashes.length - 1), 10_000);
}

async function stopChild(signal = "SIGTERM") {
  if (!child || child.exitCode !== null) return;
  child.kill(signal);
  const forceTimer = setTimeout(() => {
    if (child?.exitCode === null) child.kill("SIGKILL");
  }, 10_000);
  forceTimer.unref();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`[dev-supervisor] ${signal} received; stopping server.`);
    void stopChild(signal);
  });
}

async function main() {
  while (!stopping) {
    const cleanup = await run(
      process.execPath,
      [resolve("scripts/free-ports.mjs"), String(port)],
      {
        env: { ...process.env, NODE_ENV: "development" },
      },
    );
    if (cleanup.code !== 0) {
      console.error("[dev-supervisor] Port cleanup failed; retrying.");
      await wait(restartDelay());
      continue;
    }

    console.log(`[dev-supervisor] Starting development server on port ${port}.`);
    child = spawn(process.execPath, [tsxCli, entry], {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: testEntry ? "test" : "development",
        PORT: String(port),
      },
    });

    const exit = new Promise((resolvePromise) => {
      child.once("error", (error) => resolvePromise({ error }));
      child.once("exit", (code, signal) => resolvePromise({ code, signal }));
    });

    const ready = await waitUntilReady(child);
    if (!ready && !stopping && child.exitCode === null) {
      console.error(
        `[dev-supervisor] Server did not become ready within ${startupTimeoutMs}ms; restarting.`,
      );
      await stopChild();
    } else if (ready) {
      console.log(`[dev-supervisor] Server ready on port ${port}.`);
    }

    const result = await exit;
    child = undefined;
    if (stopping) break;

    const delay = restartDelay();
    const reason =
      "error" in result
        ? result.error.message
        : `exit ${result.code ?? "null"}${result.signal ? ` (${result.signal})` : ""}`;
    console.error(
      `[dev-supervisor] Server stopped unexpectedly: ${reason}; restarting in ${delay}ms.`,
    );
    await wait(delay);
  }
}

main().catch((error) => {
  console.error("[dev-supervisor] Fatal supervisor error:", error);
  process.exitCode = 1;
});