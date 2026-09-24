import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { WebSocket, WebSocketServer } from "ws";
import type { LiveConnectionLease } from "./lib/live-connections";

interface WebSocketUpgradeOptions {
  acquire?: () => LiveConnectionLease | null;
  onLease?: (webSocket: WebSocket, lease: LiveConnectionLease) => void;
}

function rejectUpgrade(socket: Duplex, status: 400 | 404 | 503): void {
  const reason = status === 400
    ? "Bad Request"
    : status === 404
      ? "Not Found"
      : "Service Unavailable";
  try {
    if (!socket.destroyed) {
      socket.end(
        `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    }
  } catch {
    socket.destroy();
  }
}

export function attachWebSocketServerAtPath(
  server: Server,
  webSocketServer: WebSocketServer,
  path: string,
  options: WebSocketUpgradeOptions = {},
) {
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const requestPath = (request.url ?? "/").split("?", 1)[0];
    if (requestPath !== path) {
      return;
    }

    let lease: LiveConnectionLease | null | undefined;
    try {
      lease = options.acquire?.();
    } catch {
      rejectUpgrade(socket, 503);
      return;
    }
    if (options.acquire && !lease) {
      rejectUpgrade(socket, 503);
      return;
    }

    lease && socket.once("close", lease.release);
    try {
      webSocketServer.handleUpgrade(request, socket, head, (webSocket: WebSocket) => {
        if (lease?.isReleased) {
          webSocket.terminate();
          return;
        }
        try {
          if (lease) {
            lease.attach(webSocket);
            options.onLease?.(webSocket, lease);
          }
          webSocketServer.emit("connection", webSocket, request);
        } catch {
          lease?.release();
          webSocket.terminate();
        }
      });
    } catch {
      lease?.release();
      socket.destroy();
    }
  });
}

/**
 * Install after every known upgrade handler (including Vite's HMR handler).
 * Unknown paths are then closed promptly without reaching a WebSocket server.
 */
export function attachUnknownUpgradePathRejector(
  server: Server,
  recognizedPaths: readonly string[],
): () => void {
  const allowed = new Set(recognizedPaths);
  const listener = (request: IncomingMessage, socket: Duplex) => {
    const requestPath = (request.url ?? "/").split("?", 1)[0];
    if (
      !requestPath.startsWith("/") ||
      requestPath.startsWith("//") ||
      requestPath.includes("#")
    ) {
      rejectUpgrade(socket, 400);
      return;
    }

    if (allowed.has(requestPath)) return;
    rejectUpgrade(socket, 404);
  };
  server.on("upgrade", listener);
  return () => server.off("upgrade", listener);
}