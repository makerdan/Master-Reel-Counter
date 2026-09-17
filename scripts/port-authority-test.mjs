#!/usr/bin/env node
/**
 * Deterministic smoke checks for the canonical port cleanup command.
 * Uses only isolated ephemeral ports and child processes.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { findHardcodedPortReferences } from "./port-reference-scan.mjs";

const root = resolve(import.meta.dirname, "..");
const cleanupScript = resolve(root, "scripts/free-ports.mjs");

// Scanner fixtures: a fixed service bind/URL fails closed, while an
// environment-driven bind and an ephemeral test listener remain valid.
assert.deepEqual(
  findHardcodedPortReferences(
    "server.listen(5000); server.listen('5001'); fetch('http://0.0.0.0:5002/api/healthz')",
  ),
  ["listen(5000", "listen('5001'", "0.0.0.0:5002"],
);
assert.deepEqual(
  findHardcodedPortReferences(
    "server.listen(Number(process.env.PORT || 5000)); server.listen(0); fetch(`http://localhost:${port}`)",
  ),
  [],
);

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

const replacementCode = [
  "const net=require('net');",
  "const s=net.createServer();",
  "s.listen(0,'127.0.0.1',()=>{",
  "  const port=s.address().port; console.log(port);",
  "  setTimeout(()=>s.close(()=>{",
  "    const replacement=net.createServer();",
  "    replacement.listen(port,'127.0.0.1',()=>console.log('replacement'));",
  "  }),500);",
  "});",
].join("");
const replacement = spawn(process.execPath, ["-e", replacementCode], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let replacementOutput = "";
replacement.stdout.on("data", (data) => { replacementOutput += data; });
const replacementPort = await new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error("replacement listener did not bind")), 5000);
  replacement.stdout.on("data", () => {
    const match = replacementOutput.match(/^\d+/m);
    if (match) {
      clearTimeout(timer);
      resolvePromise(Number(match[0]));
    }
  });
});
const replacementCleanupPromise = run(process.execPath, [cleanupScript, String(replacementPort)], {
  FREE_PORTS_BEFORE_SIGNAL_MS: "800",
  FREE_PORTS_GRACE_MS: "50",
});
if (!replacementOutput.includes("replacement")) {
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("replacement listener did not become observable")), 5000);
    replacement.stdout.on("data", () => {
      if (replacementOutput.includes("replacement")) {
        clearTimeout(timer);
        resolvePromise();
      }
    });
  });
}
const replacementCleanup = await replacementCleanupPromise;
assert.equal(replacementCleanup.code, 1, "changed socket ownership must fail closed");
assert.match(replacementCleanup.output, /ownership changed/);
assert.equal(replacement.exitCode, null, "replacement listener must not be terminated");
replacement.kill("SIGTERM");
await new Promise((resolvePromise) => replacement.once("close", resolvePromise));

const sharedCode = [
  "const net=require('net');",
  "const first=net.createServer(); const second=net.createServer();",
  "first.listen(0,'127.0.0.1',()=>{",
  "  const firstPort=first.address().port;",
  "  second.listen(0,'127.0.0.1',()=>console.log(firstPort+' '+second.address().port));",
  "});",
].join("");
const shared = spawn(process.execPath, ["-e", sharedCode], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let sharedOutput = "";
shared.stdout.on("data", (data) => { sharedOutput += data; });
const sharedPorts = await new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error("shared listeners did not bind")), 5000);
  shared.stdout.on("data", () => {
    const match = sharedOutput.match(/(\d+)\s+(\d+)/);
    if (match) {
      clearTimeout(timer);
      resolvePromise([Number(match[1]), Number(match[2])]);
    }
  });
});
const sharedCleanup = await run(process.execPath, [cleanupScript, String(sharedPorts[0])], {
  FREE_PORTS_GRACE_MS: "50",
});
assert.equal(sharedCleanup.code, 1, "shared process cleanup must fail closed");
assert.match(sharedCleanup.output, /shared/);
assert.equal(shared.exitCode, null, "shared process must not be terminated");
shared.kill("SIGTERM");
await new Promise((resolvePromise) => shared.once("close", resolvePromise));

console.log("[port-authority-test] PASS: isolated cleanup, socket replacement, shared-process, and scanner guards verified.");