import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, readFile, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";
import test from "node:test";
import http, { createServer as createHttpServer, type Server } from "node:http";
import { createConnection } from "node:net";
import { LiveConnectionTracker } from "../lib/live-connections";
import { createHmrOptions } from "../vite-hmr";
import {
  closeHmrHarness,
  createHmrHarness,
  isProcessGroupAlive,
  signalProcessGroup,
  socketEvents,
  waitFor,
} from "./helpers/vite-hmr-harness";
import {
  attachUnknownUpgradePathRejector,
  attachWebSocketServerAtPath,
} from "../websocket-upgrade";

const server = {} as Server;
const replitDevDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
const previewLocalPort = 5001;
const previewExternalPort = 3003;

test("uses the secure public HMR endpoint in a Replit preview", () => {
  assert.deepEqual(createHmrOptions(server, "example.replit.dev"), {
    server,
    path: "/vite-hmr",
    protocol: "wss",
    host: "example.replit.dev",
    clientPort: 443,
  });
  assert.deepEqual(createHmrOptions(server, "example.replit.dev", 3003), {
    server,
    path: "/vite-hmr",
    protocol: "wss",
    host: "example.replit.dev",
    clientPort: 3003,
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
    await closeHmrHarness(harness);
  }
});

test(
  "a browser connected through the Replit preview origin receives a live Vite update",
  { skip: !replitDevDomain },
  async () => {
    const harness = await createHmrHarness({
      previewHost: replitDevDomain,
      previewClientPort: previewExternalPort,
      listenPort: previewLocalPort,
      baseUrl: `https://${replitDevDomain}:${previewExternalPort}/`,
    });
    const processGroupId = harness.processHandle.pid;
    assert.ok(processGroupId);
    const directory = harness.directory;
    try {
      await waitFor(
        "the Replit preview HMR WebSocket",
        () => socketEvents(harness.page),
        (events) =>
          events.some(
            (event) => event.event === "open" && new URL(event.url).pathname === "/vite-hmr",
          ),
        30000,
      );
      assert.equal(await harness.page.locator("#value").textContent(), "initial");

      const pageUrl = new URL(harness.page.url());
      assert.equal(pageUrl.hostname, replitDevDomain);
      assert.equal(pageUrl.port, String(previewExternalPort));
      const hmrUrl = new URL(
        (await socketEvents(harness.page)).find((event) => event.event === "open")!.url,
      );
      assert.equal(hmrUrl.protocol, "wss:");
      assert.equal(hmrUrl.hostname, replitDevDomain);
      assert.equal(hmrUrl.port, String(previewExternalPort));

      await writeFile(
        join(harness.sourceDirectory, "marker.js"),
        `export const value = "preview-updated";\n`,
        "utf8",
      );
      await harness.page.waitForFunction(
        () => document.querySelector("#value")?.textContent === "preview-updated",
      );
      assert.deepEqual(
        await harness.page.evaluate(
          () => (window as unknown as Window & { __hmrUpdates: string[] }).__hmrUpdates,
        ),
        ["preview-updated"],
      );
    } finally {
      await closeHmrHarness(harness);
    }

    assert.equal(isProcessGroupAlive(processGroupId), false);
    await assert.rejects(access(directory), { code: "ENOENT" });
  },
);

test(
  "a failed Replit preview check removes its owned process group and fixture",
  { skip: !replitDevDomain },
  async () => {
    const harness = await createHmrHarness({
      previewHost: replitDevDomain,
      previewClientPort: previewExternalPort,
      listenPort: previewLocalPort,
      baseUrl: `https://${replitDevDomain}:${previewExternalPort}/`,
    });
    const processGroupId = harness.processHandle.pid;
    assert.ok(processGroupId);
    const directory = harness.directory;
    try {
      await harness.page.waitForFunction(
        () => document.querySelector("#value")?.textContent === "initial",
      );
      await assert.rejects(
        async () => {
          try {
            assert.equal(await harness.page.locator("#value").textContent(), "deliberate-mismatch");
          } finally {
            await closeHmrHarness(harness);
          }
        },
        /Expected values to be strictly equal/,
      );
    } finally {
      await closeHmrHarness(harness);
    }

    assert.equal(isProcessGroupAlive(processGroupId), false);
    await assert.rejects(access(directory), { code: "ENOENT" });
  },
);

test(
  "an interrupted live preview check cleans its owned server process group",
  { skip: !replitDevDomain },
  async () => {
    const worker = spawn(
      process.execPath,
      [
        "--import",
        "tsx/esm",
        resolve("server/__tests__/fixtures/vite-hmr-interruption-worker.mjs"),
      ],
      {
        cwd: resolve("."),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    worker.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    worker.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    let workerState: {
      processGroupId: number;
      serverPid: number;
      directory: string;
    } | null = null;
    try {
      workerState = await waitFor(
        "the interrupted preview worker to deliver a live update",
        async () => {
          if (worker.exitCode !== null || worker.signalCode !== null) {
            throw new Error(`Preview interruption worker exited early:\n${output}`);
          }
          const readyLine = output
            .split("\n")
            .find((line) => line.startsWith("HMR_WORKER_READY "));
          return readyLine
            ? JSON.parse(readyLine.slice("HMR_WORKER_READY ".length))
            : null;
        },
        (value) => value !== null,
        45000,
      );
      assert.ok(workerState);
      worker.kill("SIGTERM");
      await waitFor(
        "the preview interruption worker to finish cleanup",
        async () => worker.exitCode === null && worker.signalCode === null,
        (running) => !running,
        15000,
      );
      assert.equal(worker.exitCode, 143);
      await waitFor(
        "the interrupted preview server process group to exit",
        async () => isProcessGroupAlive(workerState!.processGroupId),
        (alive) => !alive,
      );
      assert.equal(processIsAlive(workerState.serverPid), false);
      await assert.rejects(access(workerState.directory), { code: "ENOENT" });
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGTERM");
        try {
          await waitFor(
            "preview interruption worker shutdown",
            async () => worker.exitCode === null && worker.signalCode === null,
            (running) => !running,
            10000,
          );
        } catch {
          worker.kill("SIGKILL");
        }
      }
      if (workerState && isProcessGroupAlive(workerState.processGroupId)) {
        signalProcessGroup(workerState.processGroupId, "SIGKILL");
        await waitFor(
          "forced preview server process group cleanup",
          async () => isProcessGroupAlive(workerState!.processGroupId),
          (alive) => !alive,
        );
      }
    }
  },
);

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
      await closeHmrHarness(harness);
    }
  },
);