import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function waitForFile(path, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(path, "utf8");
      if (predicate(content)) return content;
    } catch {
      // The fixture has not created the file yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test("dev supervisor restarts a crashed server and releases its port", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dev-supervisor-"));
  const fixture = join(directory, "fixture.ts");
  const state = join(directory, "state.txt");
  const port = await availablePort();

  await writeFile(
    fixture,
    `import http from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
const state = process.env.DEV_FIXTURE_STATE!;
let starts = 0;
try { starts = readFileSync(state, "utf8").trim().split("\\n").filter(Boolean).length; } catch {}
appendFileSync(state, "start\\n");
const server = http.createServer((_req, res) => { res.statusCode = 200; res.end("ok"); });
server.listen(Number(process.env.PORT), "0.0.0.0", () => {
  if (starts === 0) setTimeout(() => process.exit(7), 200);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
`,
  );

  const supervisor = spawn(
    process.execPath,
    [resolve("scripts/dev-supervisor.mjs")],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        DEV_SUPERVISOR_ENTRY: fixture,
        DEV_FIXTURE_STATE: state,
        DEV_STARTUP_TIMEOUT_MS: "5000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  supervisor.stdout.on("data", (chunk) => {
    output += chunk;
  });
  supervisor.stderr.on("data", (chunk) => {
    output += chunk;
  });

  try {
    await waitForFile(
      state,
      (content) => content.trim().split("\n").length >= 2,
    );
    assert.match(output, /stopped unexpectedly/);
    assert.match(output, /Server ready on port/);
  } finally {
    supervisor.kill("SIGTERM");
    await new Promise((resolvePromise) => supervisor.once("exit", resolvePromise));
    await rm(directory, { recursive: true, force: true });
  }

  const portProbe = createServer();
  await new Promise((resolvePromise, reject) => {
    portProbe.once("error", reject);
    portProbe.listen(port, "127.0.0.1", resolvePromise);
  });
  await new Promise((resolvePromise) => portProbe.close(resolvePromise));
});