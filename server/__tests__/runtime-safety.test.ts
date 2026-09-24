import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http, { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { HttpRequestDrainTracker } from "../lib/http-request-drain";
import {
  LiveConnectionTracker,
  type ManagedLiveSocket,
} from "../lib/live-connections";

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

class FakeLiveSocket extends EventEmitter implements ManagedLiveSocket {
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  terminateCalls = 0;

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  terminate(): void {
    this.terminateCalls += 1;
    this.emit("close");
  }
}

test("graceful HTTP draining waits for an accepted upload to finish", async () => {
  const app = express();
  const drain = new HttpRequestDrainTracker();
  app.use(drain.middleware);

  let firstChunkReceived!: () => void;
  const firstChunk = new Promise<void>((resolve) => {
    firstChunkReceived = resolve;
  });
  app.post("/upload", (request, response) => {
    let receivedBytes = 0;
    request.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
      firstChunkReceived();
    });
    request.on("end", () => response.status(201).json({ receivedBytes }));
  });

  const server = createServer(app);
  const port = await listen(server);
  let closed = false;
  let uploadRequest: http.ClientRequest | undefined;

  try {
    const responsePromise = new Promise<{ status: number; body: string }>((resolve, reject) => {
      uploadRequest = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/upload",
        method: "POST",
        headers: { "content-length": "8" },
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      });
      uploadRequest.once("error", reject);
      uploadRequest.write("part");
    });

    await firstChunk;
    assert.equal(drain.activeCount, 1);
    const serverClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else {
          closed = true;
          resolve();
        }
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closed, false, "server close must wait while the upload is active");

    uploadRequest!.end("done");
    const response = await responsePromise;
    await serverClosed;
    assert.equal(response.status, 201);
    assert.deepEqual(JSON.parse(response.body), { receivedBytes: 8 });
    assert.equal(drain.activeCount, 0);
  } finally {
    uploadRequest?.destroy();
    if (!closed) await closeServer(server);
  }
});

test("the shutdown deadline returns a bounded 503 for unfinished HTTP work", async () => {
  const app = express();
  const drain = new HttpRequestDrainTracker();
  app.use(drain.middleware);

  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  app.get("/held", () => requestStarted());

  const server = createServer(app);
  const port = await listen(server);
  try {
    const responsePromise = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = http.get({ hostname: "127.0.0.1", port, path: "/held" }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
      });
      request.once("error", reject);
    });

    await started;
    assert.equal(drain.activeCount, 1);
    assert.equal(drain.failActiveRequests(), 1);
    const response = await responsePromise;
    assert.equal(response.status, 503);
    assert.match(response.body, /Please retry/);
    assert.equal(drain.activeCount, 0);
  } finally {
    await closeServer(server);
  }
});

test("live connections have global, pending-authentication, and per-user limits", () => {
  const tracker = new LiveConnectionTracker({
    maxConnections: 4,
    maxPendingAuthentication: 2,
    maxConnectionsPerUser: 1,
  });
  const first = tracker.tryAcquire();
  const second = tracker.tryAcquire();
  assert.ok(first);
  assert.ok(second);
  assert.equal(tracker.tryAcquire(), null, "pending authentication is capped");
  assert.equal(tracker.pendingAuthenticationCount, 2);

  assert.equal(first.identify("owner"), true);
  const third = tracker.tryAcquire();
  assert.ok(third);
  assert.equal(second.identify("collaborator"), true);
  const fourth = tracker.tryAcquire();
  assert.ok(fourth);
  assert.equal(fourth.identify("owner"), false, "a user cannot exceed their socket limit");
  fourth.release();
  assert.equal(tracker.activeCount, 3);
  assert.equal(tracker.authenticatedCount, 2);

  first.release();
  third.release();
  second.release();
  assert.equal(tracker.activeCount, 0);
});

test("graceful live-connection drain stops admission and requests a restart close", () => {
  const tracker = new LiveConnectionTracker({
    maxConnections: 2,
    maxPendingAuthentication: 2,
    maxConnectionsPerUser: 1,
  });
  const lease = tracker.tryAcquire();
  assert.ok(lease);
  const socket = new FakeLiveSocket();
  lease.attach(socket);
  assert.equal(lease.identify("owner"), true);

  tracker.beginDrain();
  assert.equal(tracker.isAccepting, false);
  assert.equal(tracker.tryAcquire(), null);
  assert.deepEqual(socket.closeCalls, [{ code: 1012, reason: "Service restarting" }]);
  assert.equal(tracker.activeCount, 1, "drain waits for the close handshake");

  socket.emit("close");
  assert.equal(tracker.activeCount, 0);
});