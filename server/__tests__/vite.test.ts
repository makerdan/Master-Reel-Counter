import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import http, { createServer as createHttpServer, type Server } from "node:http";
import { createConnection } from "node:net";
import { chromium, type Page } from "@playwright/test";
import { LiveConnectionTracker } from "../lib/live-connections";
import { createHmrOptions } from "../vite-hmr";
import {
  attachUnknownUpgradePathRejector,
  attachWebSocketServerAtPath,
} from "../websocket-upgrade";

const server = {} as Server;

test("uses the secure public HMR endpoint in a Replit preview", () => {
  assert.deepEqual(createHmrOptions(server, "example.replit.dev"), {
    server,
    path: "/vite-hmr",
    protocol: "wss",
    host: "example.replit.dev",
    clientPort: 443,
  });
});

test("keeps Vite's inferred connection settings for direct local preview", () => {
  assert.deepEqual(createHmrOptions(server, ""), {
    server,
    path: "/vite-hmr",
  });
});

test("the application WebSocket server leaves Vite HMR upgrades unclaimed", () => {
  const httpServer = new EventEmitter() as Server;
  const handledPaths: string[] = [];
  const emittedEvents: string[] = [];
  const webSocketServer = {
    handleUpgrade(request: { url?: string }, _socket: unknown, _head: unknown, callback: (webSocket: object) => void) {
      handledPaths.push(request.url ?? "");
      callback({});
    },
    emit(event: string) {
      emittedEvents.push(event);
    },
  };

  attachWebSocketServerAtPath(httpServer, webSocketServer as never, "/ws");

  httpServer.emit("upgrade", { url: "/vite-hmr?token=example" }, {}, Buffer.alloc(0));
  assert.deepEqual(handledPaths, []);

  assert.doesNotThrow(() => {
    httpServer.emit("upgrade", { url: "//[" }, {}, Buffer.alloc(0));
  });
  assert.deepEqual(handledPaths, []);

  httpServer.emit("upgrade", { url: "/ws?session=example" }, {}, Buffer.alloc(0));
  assert.deepEqual(handledPaths, ["/ws?session=example"]);
  assert.deepEqual(emittedEvents, ["connection"]);
});

test("recognized WebSocket upgrades reserve capacity before allocating a connection", () => {
  class MockUpgradeSocket extends EventEmitter {
    destroyed = false;
    output = "";

    end(data?: string | Uint8Array) {
      if (data) this.output += data.toString();
      this.emit("close");
      return this;
    }

    destroy() {
      this.destroyed = true;
      this.emit("close");
      return this;
    }
  }

  const httpServer = new EventEmitter() as Server;
  const tracker = new LiveConnectionTracker({
    maxConnections: 1,
    maxPendingAuthentication: 1,
    maxConnectionsPerUser: 1,
  });
  let allocations = 0;
  let webSocket: EventEmitter & {
    close(code?: number, reason?: string): void;
    terminate(): void;
  } | undefined;
  const webSocketServer = {
    handleUpgrade(
      _request: unknown,
      _socket: unknown,
      _head: unknown,
      callback: (socket: object) => void,
    ) {
      allocations += 1;
      webSocket = Object.assign(new EventEmitter(), {
        close() {},
        terminate() {},
      });
      callback(webSocket);
    },
    emit() {},
  };
  attachWebSocketServerAtPath(httpServer, webSocketServer as never, "/ws", {
    acquire: () => tracker.tryAcquire(),
  });

  const firstSocket = new MockUpgradeSocket();
  httpServer.emit("upgrade", { url: "/ws" }, firstSocket, Buffer.alloc(0));
  assert.equal(allocations, 1);
  assert.equal(tracker.activeCount, 1);

  const excessSocket = new MockUpgradeSocket();
  httpServer.emit("upgrade", { url: "/ws" }, excessSocket, Buffer.alloc(0));
  assert.match(excessSocket.output, /^HTTP\/1\.1 503 Service Unavailable/);
  assert.equal(allocations, 1, "the rejected client must not allocate a WebSocket");

  webSocket?.emit("close");
  assert.equal(tracker.activeCount, 0);
  firstSocket.destroy();
  excessSocket.destroy();
});

test("concurrent unknown upgrades are rejected before admission without blocking the API", async () => {
  const tracker = new LiveConnectionTracker({
    maxConnections: 1,
    maxPendingAuthentication: 1,
    maxConnectionsPerUser: 1,
  });
  let admissionAttempts = 0;
  let webSocketAllocations = 0;
  let viteUpgradeAttempts = 0;
  const httpServer = createHttpServer((_request, response) => {
    response.statusCode = 200;
    response.end("api ok");
  });
  const webSocketServer = {
    handleUpgrade(
      _request: unknown,
      _socket: unknown,
      _head: unknown,
      callback: (socket: object) => void,
    ) {
      webSocketAllocations += 1;
      callback({ terminate() {} });
    },
    emit() {},
  };

  attachWebSocketServerAtPath(httpServer, webSocketServer as never, "/ws", {
    acquire: () => {
      admissionAttempts += 1;
      return tracker.tryAcquire();
    },
  });
  httpServer.on("upgrade", (request, socket) => {
    if (request.url?.split("?", 1)[0] !== "/vite-hmr") return;
    viteUpgradeAttempts += 1;
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  attachUnknownUpgradePathRejector(httpServer, ["/ws", "/vite-hmr"]);

  await new Promise<void>((resolvePromise, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");

  const sendUpgrade = (pathname: string) => new Promise<string>((resolvePromise, reject) => {
    const socket = createConnection(address.port, "127.0.0.1");
    let response = "";
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error(`Upgrade request for ${pathname} was not closed`));
    });
    socket.once("connect", () => {
      socket.write([
        `GET ${pathname} HTTP/1.1`,
        `Host: 127.0.0.1:${address.port}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Cookie: __session=authenticated",
        "",
        "",
      ].join("\r\n"));
    });
    socket.on("data", (chunk) => { response += chunk.toString(); });
    socket.once("end", () => resolvePromise(response));
    socket.once("error", reject);
  });

  const ordinaryApiRequest = new Promise<{ status: number; body: string }>((resolvePromise, reject) => {
    const request = http.get({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/api/healthz",
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body }));
    });
    request.once("error", reject);
  });

  try {
    const unknownAttempts = Array.from({ length: 48 }, (_, index) =>
      sendUpgrade(`/unknown-${index}`),
    );
    const [unknownResponses, apiResponse] = await Promise.all([
      Promise.all(unknownAttempts),
      ordinaryApiRequest,
    ]);

    assert.equal(unknownResponses.length, 48);
    assert.ok(unknownResponses.every((response) => response.startsWith("HTTP/1.1 404 Not Found")));
    assert.equal(admissionAttempts, 0, "unknown paths must not reserve live capacity");
    assert.equal(webSocketAllocations, 0, "unknown paths must not allocate WebSocket clients");
    assert.equal(apiResponse.status, 200);
    assert.equal(apiResponse.body, "api ok");

    const hmrResponse = await sendUpgrade("/vite-hmr?token=example");
    assert.ok(hmrResponse.startsWith("HTTP/1.1 403 Forbidden"));
    assert.equal(viteUpgradeAttempts, 1, "recognized Vite upgrades must reach Vite first");
  } finally {
    await new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise()));
  }
});

async function availablePort() {
  const server = createNetServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  return address.port;
}

async function waitFor<T>(
  description: string,
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 15000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function chromiumExecutable() {
  try {
    return execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function launchBrowser() {
  const executablePath = chromiumExecutable();
  if (!executablePath) {
    throw new Error("Live Vite HMR validation requires a Chromium executable");
  }
  return chromium.launch({ headless: true, executablePath });
}

async function createHmrHarness() {
  const directory = await mkdtemp(join(tmpdir(), "vite-hmr-live-"));
  const sourceDirectory = join(directory, "src");
  const stateFile = join(directory, "state.jsonl");
  await mkdir(sourceDirectory);

  await writeFile(
    join(directory, "index.html"),
    `<!doctype html>
<html><body><output id="value"></output><script type="module" src="/src/main.js"></script></body></html>`,
    "utf8",
  );
  await writeFile(
    join(sourceDirectory, "marker.js"),
    `export const value = "initial";\n`,
    "utf8",
  );
  await writeFile(
    join(sourceDirectory, "main.js"),
    `import { value } from "./marker.js";
window.__hmrUpdates = [];
function render(nextValue) {
  document.querySelector("#value").textContent = nextValue;
}
render(value);
if (import.meta.hot) {
  import.meta.hot.accept("./marker.js", (module) => {
    const nextValue = module?.value;
    window.__hmrUpdates.push(nextValue);
    render(nextValue);
  });
}
`,
    "utf8",
  );

  const port = await availablePort();
  const supervisor = spawn(process.execPath, [resolve("scripts/dev-supervisor.mjs")], {
    cwd: resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DEV_SUPERVISOR_ENTRY: resolve("server/__tests__/fixtures/vite-hmr-server.mjs"),
      DEV_STARTUP_TIMEOUT_MS: "10000",
      VITE_HMR_FIXTURE_ROOT: directory,
      VITE_HMR_STATE_FILE: stateFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  supervisor.stdout.on("data", (chunk) => {
    output += chunk;
  });
  supervisor.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const state = await waitFor(
    "the supervised Vite server",
    async () => {
      try {
        return (await readFile(stateFile, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { pid: number; port: number });
      } catch {
        return [];
      }
    },
    (value) => value.length >= 1 && output.includes("Server ready on port"),
  );

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const nativeWebSocket = window.WebSocket;
    const events: Array<{ event: string; url: string }> = [];
    (window as Window & { __hmrSocketEvents?: typeof events }).__hmrSocketEvents = events;
    window.WebSocket = new Proxy(nativeWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket;
        const url = socket.url;
        events.push({ event: "construct", url });
        for (const event of ["open", "close", "error"]) {
          socket.addEventListener(event, () => events.push({ event, url }));
        }
        return socket;
      },
    });
  });
  const browserSocketEvents: Array<{ event: string; url: string }> = [];
  page.on("websocket", (webSocket) => {
    if (new URL(webSocket.url()).pathname !== "/vite-hmr") return;
    const url = webSocket.url();
    browserSocketEvents.push({ event: "open", url });
    webSocket.on("close", () => browserSocketEvents.push({ event: "close", url }));
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

  return {
    directory,
    sourceDirectory,
    stateFile,
    port,
    supervisor,
    browser,
    page,
    browserSocketEvents,
    state,
  };
}

async function closeHarness(harness: Awaited<ReturnType<typeof createHmrHarness>>) {
  await harness.page.close().catch(() => {});
  await harness.browser.close().catch(() => {});
  if (harness.supervisor.exitCode === null) {
    harness.supervisor.kill("SIGTERM");
    await new Promise<void>((resolvePromise) => {
      harness.supervisor.once("exit", () => resolvePromise());
    });
  }
  await rm(harness.directory, { recursive: true, force: true });
}

function socketEvents(page: Page) {
  return page.evaluate(
    () =>
      (window as Window & {
        __hmrSocketEvents?: Array<{ event: string; url: string }>;
      }).__hmrSocketEvents ?? [],
  );
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("a real browser client receives a live Vite module update", async () => {
  const harness = await createHmrHarness();
  try {
    await waitFor(
      "the initial Vite HMR WebSocket",
      () => socketEvents(harness.page),
      (events) =>
        events.some(
          (event) => event.event === "open" && new URL(event.url).pathname === "/vite-hmr",
        ),
    );
    assert.equal(await harness.page.locator("#value").textContent(), "initial");

    await writeFile(
      join(harness.sourceDirectory, "marker.js"),
      `export const value = "updated";\n`,
      "utf8",
    );
    await harness.page.waitForFunction(
      () => document.querySelector("#value")?.textContent === "updated",
    );
    assert.deepEqual(
      await harness.page.evaluate(
        () => (window as unknown as Window & { __hmrUpdates: string[] }).__hmrUpdates,
      ),
      ["updated"],
    );
  } finally {
    await closeHarness(harness);
  }
});

test(
  "the same browser client reconnects to a new supervised Vite process",
  { skip: process.env.VITE_HMR_RECOVERY !== "1" },
  async () => {
    const harness = await createHmrHarness();
    try {
      await waitFor(
        "the initial Vite HMR WebSocket",
        async () => harness.browserSocketEvents,
        (events) => events.filter((event) => event.event === "open").length >= 1,
      );
      const firstPid = harness.state[0].pid;
      process.kill(firstPid, "SIGKILL");

      const restartedState = await waitFor(
        "a new supervised Vite process",
        async () => {
          try {
            return (await readFile(harness.stateFile, "utf8"))
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line) as { pid: number; port: number });
          } catch {
            return [];
          }
        },
        (value) => value.length >= 2 && value.at(-1)?.pid !== firstPid,
      );
      const secondPid = restartedState.at(-1)?.pid;
      assert.ok(secondPid && secondPid !== firstPid);
      await waitFor(
        "the old Vite process to exit",
        async () => processIsAlive(firstPid),
        (alive) => !alive,
      );
      await harness.page.reload({ waitUntil: "domcontentloaded" });
      await waitFor(
        "the browser HMR socket to reconnect after the restart",
        async () => harness.browserSocketEvents,
        (events) => events.filter((event) => event.event === "open").length >= 2,
      );
      assert.ok(
        harness.browserSocketEvents.some((event) => event.event === "close"),
        "the pre-restart browser HMR socket must close before the replacement opens",
      );
      const servedServerId = await harness.page.evaluate(async () =>
        fetch("/server-id.js").then((response) => response.text()),
      );
      assert.match(servedServerId, new RegExp(`serverPid = ${secondPid}`));

      await writeFile(
        join(harness.sourceDirectory, "marker.js"),
        `export const value = "restarted-${secondPid}";\n`,
        "utf8",
      );
      await harness.page.waitForFunction(
        (expected) => document.querySelector("#value")?.textContent === expected,
        `restarted-${secondPid}`,
      );
      const events = harness.browserSocketEvents;
      assert.ok(
        events
          .filter((event) => event.event === "open")
          .every((event) => new URL(event.url).pathname === "/vite-hmr"),
      );
      assert.equal(
        await harness.page.evaluate(
          () => (window as unknown as Window & { __hmrUpdates: string[] }).__hmrUpdates.at(-1),
        ),
        `restarted-${secondPid}`,
      );
    } finally {
      await closeHarness(harness);
    }
  },
);