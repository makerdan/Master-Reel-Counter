// GHSA-q7qp-rjg7-q26m: real HTTP teardown while the filter callback is pending.
// This fixture uses no database, object store, external identity or child process.
import assert from "node:assert/strict";
import http from "node:http";
import { setImmediate as nextTurn } from "node:timers/promises";
import express from "express";
import multer from "multer";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function bounded(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const filterEntered = deferred();
const requestAborted = deferred();
const middlewareFinished = deferred();
let acceptDelayed;
let handles = 0;
let persisted = 0;
const storage = multer.memoryStorage();
const originalHandle = storage._handleFile;
storage._handleFile = function (...args) {
  handles++;
  return originalHandle.apply(this, args);
};
const upload = multer({
  storage,
  limits: { fileSize: 1_024 },
  fileFilter(req, file, cb) {
    if (!acceptDelayed) {
      acceptDelayed = cb;
      filterEntered.resolve();
    } else {
      cb(null, true);
    }
  },
}).single("file");
const app = express();
app.get("/health", (req, res) => res.send("ok"));
app.post("/", (req, res) => {
  req.once("aborted", () => requestAborted.resolve());
  upload(req, res, (error) => {
    middlewareFinished.resolve(error);
    if (error) return res.status(400).end();
    persisted++;
    res.json({ size: req.file.size });
  });
});
const server = http.createServer(app);
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
let request;
try {
  request = http.request(url, {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=fixture",
      "content-length": 4_096,
    },
  });
  request.on("error", (error) => {
    assert.equal(error.code, "ECONNRESET");
  });
  request.write('--fixture\r\nContent-Disposition: form-data; name="file"; filename="pending.png"\r\nContent-Type: image/png\r\n\r\npartial');
  await bounded(filterEntered.promise, "the async filter was not entered");
  request.destroy();
  await bounded(requestAborted.promise, "server never observed request teardown");
  const error = await bounded(middlewareFinished.promise, "teardown hung with a pending filter");
  assert.ok(error instanceof Error);
  acceptDelayed(null, true);
  await nextTurn();
  await nextTurn();
  assert.equal(handles, 0, "late filter acceptance must not start storage");
  assert.equal(persisted, 0, "aborted input must not reach persistence");

  const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
  assert.equal(await health.text(), "ok", "server remains responsive");
  const valid = await fetch(url, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=fixture" },
    body: '--fixture\r\nContent-Disposition: form-data; name="file"; filename="valid.png"\r\nContent-Type: image/png\r\n\r\nordinary\r\n--fixture--\r\n',
    signal: AbortSignal.timeout(2_000),
  });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { size: 8 });
  assert.equal(handles, 1);
  assert.equal(persisted, 1);
  console.log("pending-filter-teardown:ok");
} finally {
  request?.destroy();
  server.closeAllConnections();
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
}
