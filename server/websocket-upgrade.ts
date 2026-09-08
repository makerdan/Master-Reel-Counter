import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { WebSocket, WebSocketServer } from "ws";

export function attachWebSocketServerAtPath(
  server: Server,
  webSocketServer: WebSocketServer,
  path: string,
) {
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const requestPath = (request.url ?? "/").split("?", 1)[0];
    if (requestPath !== path) {
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket: WebSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });
}