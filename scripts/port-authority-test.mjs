#!/usr/bin/env node
/**
 * Deterministic smoke checks for the canonical port cleanup command.
 * Uses only isolated ephemeral ports and child processes.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cleanupScript = resolve(root, "scripts/free-ports.mjs");

function run(command, args, env = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("close", (code) => resolvePromise({ code: code ?? 1, output }));
  });
}

const missing = await run(process.execPath, [cleanupScript]);
assert.equal(missing.code, 2, "missing port must be rejected");
const invalid = await run(process.execPath, [cleanupScript, "not-a-port"]);
assert.equal(invalid.code, 2, "invalid port must be rejected");
const noop = await run(process.execPath, [cleanupScript, "9"]);
assert.equal(noop.code, 0, "unused port cleanup must be a no-op success");
assert.match(noop.output, /already free/);

const listenerCode = [
  "const net=require('net');",
  "const s=net.createServer();",
  "s.listen(0,'127.0.0.1',()=>console.log(s.address().port));",
].join("");
const listener = spawn(process.execPath, ["-e", listenerCode], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let listenerOutput = "";
const listenerDone = new Promise((resolvePromise) => listener.on("close", resolvePromise));
listener.stdout.on("data", (data) => { listenerOutput += data; });
const port = await new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error("listener did not bind")), 5000);
  listener.stdout.on("data", () => {
    const match = listenerOutput.match(/\d+/);
    if (match) {
      clearTimeout(timer);
      resolvePromise(Number(match[0]));
    }
  });
});
const cleared = await run(process.execPath, [cleanupScript, String(port)], {
  FREE_PORTS_GRACE_MS: "100",
});
assert.equal(cleared.code, 0, `ephemeral listener cleanup failed: ${cleared.output}`);
assert.match(cleared.output, /INCIDENT/);
await listenerDone;
assert.ok(
  listener.exitCode !== null || listener.signalCode !== null,
  "listener should be terminated",
);
console.log("[port-authority-test] PASS: invalid, no-op, and real ephemeral-port cleanup verified.");