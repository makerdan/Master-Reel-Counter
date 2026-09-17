import { appendFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";

const port = Number(process.env.PORT);
const root = resolve(process.env.VITE_HMR_FIXTURE_ROOT);
const stateFile = resolve(process.env.VITE_HMR_STATE_FILE);

if (!Number.isInteger(port) || !root || !stateFile) {
  throw new Error("VITE HMR fixture requires PORT, VITE_HMR_FIXTURE_ROOT, and VITE_HMR_STATE_FILE");
}

const httpServer = http.createServer();
const vite = await createViteServer({
  root,
  configFile: false,
  server: {
    middlewareMode: true,
    hmr: {
      server: httpServer,
      path: "/vite-hmr",
    },
  },
  appType: "spa",
  logLevel: "error",
});

httpServer.on("request", (request, response) => {
  vite.middlewares(request, response, () => {
    response.statusCode = 404;
    response.end("Not found");
  });
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await vite.close();
  await new Promise((resolvePromise) => httpServer.close(resolvePromise));
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown();
  });
}

await new Promise((resolvePromise, reject) => {
  httpServer.once("error", reject);
  httpServer.listen(port, "127.0.0.1", resolvePromise);
});

appendFileSync(
  stateFile,
  `${JSON.stringify({ pid: process.pid, port })}\n`,
  "utf8",
);
writeFileSync(resolve(root, "server-id.js"), `export const serverPid = ${process.pid};\n`);