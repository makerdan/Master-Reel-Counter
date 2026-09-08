import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const listenPort = Number(process.env.RELEASE_SMOKE_HTTPS_PORT);
const targetPort = Number(process.env.RELEASE_SMOKE_APP_PORT);
const keyPath = process.env.RELEASE_SMOKE_TLS_KEY;
const certPath = process.env.RELEASE_SMOKE_TLS_CERT;
const publicHost = process.env.RELEASE_SMOKE_PUBLIC_HOST;

if (!listenPort || !targetPort || !keyPath || !certPath || !publicHost) {
  throw new Error("Release candidate HTTPS proxy configuration is incomplete");
}

const server = https.createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  },
  (request, response) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          host: publicHost,
          "x-forwarded-host": publicHost,
          "x-forwarded-proto": "https",
        },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end("Candidate upstream unavailable");
    });
    request.pipe(upstream);
  },
);

server.listen(listenPort, "127.0.0.1");