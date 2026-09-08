import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Server } from "node:http";
import { createHmrOptions } from "../vite-hmr";
import { attachWebSocketServerAtPath } from "../websocket-upgrade";

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