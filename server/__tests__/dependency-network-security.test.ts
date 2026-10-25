import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
// Resolve from the consumer, not from an unrelated hoisted root copy.
const expressRequire = createRequire(require.resolve("express"));
const proxyRequire = createRequire(
  createRequire(require.resolve("http-proxy-middleware")).resolve("http-proxy"),
);
const limiterRequire = createRequire(require.resolve("express-rate-limit"));
const consumers = [
  { name: "body-parser", minimum: "2.4.0", consumer: expressRequire },
  { name: "proxy-addr", minimum: "2.0.8", consumer: expressRequire },
  { name: "follow-redirects", minimum: "1.16.1", consumer: proxyRequire },
  { name: "ip-address", minimum: "10.7.4", consumer: limiterRequire },
];

function assertPatched(version: string, minimum: string) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "require a stable patched release");
  const actual = version.split(".").map(Number);
  const floor = minimum.split(".").map(Number);
  assert.equal(actual[0], floor[0], "keep the compatible major");
  assert.ok(
    actual[1] > floor[1] || (actual[1] === floor[1] && actual[2] >= floor[2]),
    `require at least ${minimum}, found ${version}`,
  );
}

function packageVersion(entry: string, name: string): string {
  // Also works for packages that do not export package.json.
  let directory = dirname(entry);
  for (;;) {
    try {
      const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (metadata.name === name) return metadata.version;
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    assert.notEqual(parent, directory, `missing metadata for ${name}`);
    directory = parent;
  }
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: http.Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
}

describe("consumer-resolved network dependency security", { timeout: 20_000 }, () => {
  test("each installed Express copy resolves a patched body parser", () => {
    const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
    for (const path of Object.keys(lock.packages).filter(path => /(^|\/)node_modules\/express$/.test(path))) {
      const consumer = createRequire(new URL(`../../${path}/index.js`, import.meta.url));
      assertPatched(packageVersion(consumer.resolve("body-parser"), "body-parser"), "2.4.0");
    }
    assert.throws(() => assertPatched("2.3.0", "2.4.0"));
  });

  test("compressed trailing bytes cannot crash or stall an isolated HTTP server", { timeout: 12_000 }, () => {
    const script = `
      const assert = require("node:assert/strict");
      const http = require("node:http");
      const zlib = require("node:zlib");
      const express = require(${JSON.stringify(require.resolve("express"))});
      const app = express();
      app.use(express.json({ limit: "20mb" }));
      app.post("/", (req, res) => res.json(req.body));
      app.use((err, req, res, next) => res.status(err.status || 500).end("rejected"));
      const server = http.createServer(app);
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      async function send(body, encoding, trailing, delayed) {
        return new Promise((resolve, reject) => {
          const req = http.request({
            host: "127.0.0.1", port: server.address().port, path: "/", method: "POST",
            headers: { "Content-Type": "application/json",
              ...(encoding ? { "Content-Encoding": encoding } : {}),
              "Content-Length": body.length + trailing.length }
          }, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("error", reject);
            res.on("end", () => resolve({ status: res.statusCode, data }));
          });
          req.on("error", reject);
          req.setTimeout(1500, () => req.destroy(new Error("request timeout")));
          if (delayed) { req.write(body); setTimeout(() => req.end(trailing), 40); }
          else req.end(Buffer.concat([body, trailing]));
        });
      }
      server.listen(0, "127.0.0.1", async () => {
        try {
          const input = Buffer.from('{"a":1}');
          for (const [encoding, encode] of [
            ["gzip", zlib.gzipSync], ["deflate", zlib.deflateSync], ["br", zlib.brotliCompressSync]
          ]) {
            const good = await send(encode(input), encoding, Buffer.alloc(0), false);
            assert.equal(good.status, 200);
            assert.deepEqual(JSON.parse(good.data), { a: 1 });
            for (const delayed of [false, true]) {
              const result = await send(encode(input), encoding,
                Buffer.concat([Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]), delayed);
              assert.ok([200, 400].includes(result.status));
              await delay(100);
              const next = await send(input, null, Buffer.alloc(0), false);
              assert.equal(next.status, 200);
              assert.deepEqual(JSON.parse(next.data), { a: 1 });
            }
          }
          assert.ok(process.resourceUsage().maxRSS < 256 * 1024, "fixture RSS exceeds 256MiB");
          server.closeAllConnections();
          server.close(() => process.stdout.write("survived"));
        } catch (error) { console.error(error); process.exit(1); }
      });
    `;
    assert.equal(execFileSync(process.execPath, ["--max-old-space-size=96", "-e", script], {
      timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 8_192, env: {},
    }).toString(), "survived");
  });

  test("every consumer and installed lockfile copy is patched", () => {
    const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
    for (const { name, minimum, consumer } of consumers) {
      assertPatched(packageVersion(consumer.resolve(name), name), minimum);
      const copies = Object.entries(lock.packages).filter(([path]) =>
        path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`,
      );
      assert.ok(copies.length > 0, `lockfile must contain ${name}`);
      for (const [path, metadata] of copies) {
        assertPatched((metadata as { version: string }).version, minimum);
        assertPatched(JSON.parse(readFileSync(new URL(`../../${path}/package.json`, import.meta.url), "utf8")).version, minimum);
      }
    }
  });

  test("Express keeps forwarded addresses untrusted by default", async () => {
    const app = require("express")();
    assert.equal(app.get("trust proxy"), false);
    app.get("/", (req: any, res: any) => res.json({
      ip: req.ip, remote: req.socket.remoteAddress, ips: req.ips,
    }));
    const server = http.createServer(app);
    try {
      const origin = await listen(server);
      const response = await fetch(origin, {
        headers: { "x-forwarded-for": "198.51.100.99" },
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.json();
      assert.equal(body.ip, body.remote);
      assert.notEqual(body.ip, "198.51.100.99");
      assert.deepEqual(body.ips, []);
    } finally {
      await close(server);
    }
  });

  test("mapped IPv6 cannot acquire trust from short or unrelated IPv6 prefixes", () => {
    const proxyAddr = expressRequire("proxy-addr");
    for (const ranges of [
      ["::ffff:10.0.0.0/8"],
      ["::/1"],
      ["::ffff:10.0.0.0/8", "192.168.0.0/16"],
      ["::/1", "192.168.0.0/16"],
    ]) {
      const trust = proxyAddr.compile(ranges);
      assert.equal(trust("198.51.100.8"), false);
      assert.equal(trust("::ffff:198.51.100.8"), false);
      const request = {
        headers: { "x-forwarded-for": "203.0.113.99" },
        socket: { remoteAddress: "::ffff:198.51.100.8" },
      };
      assert.equal(proxyAddr(request, trust), "::ffff:198.51.100.8");
    }
    for (const ranges of [
      ["::ffff:10.0.0.0/104"],
      ["10.0.0.0/8"],
      ["::ffff:10.0.0.0/104", "192.168.0.0/16"],
    ]) {
      const trust = proxyAddr.compile(ranges);
      assert.equal(trust("10.1.2.3"), true);
      assert.equal(trust("::ffff:10.1.2.3"), true);
      assert.equal(trust("198.51.100.8"), false);
      assert.equal(trust("::ffff:198.51.100.8"), false);
    }
  });

  test("limiter address package rejects mixed-family membership in both directions", () => {
    const { Address4, Address6 } = limiterRequire("ip-address");
    for (const method of ["isInSubnet", "isHostInSubnet"]) {
      assert.equal(new Address6("a00::1")[method](new Address4("10.0.0.0/8")), false);
      assert.equal(new Address4("32.0.0.1")[method](new Address6("2000::/3")), false);
      assert.equal(new Address4("10.1.2.3")[method](new Address4("10.0.0.0/8")), true);
      assert.equal(new Address6("2001:db8::1")[method](new Address6("2001:db8::/32")), true);
    }
  });

  test("oversized IPv6 diagnostics terminate in a memory- and time-bounded child", { timeout: 6_000 }, () => {
    const entry = limiterRequire.resolve("ip-address");
    const script = `
      const assert = require("node:assert/strict");
      const { Address6, AddressError } = require(${JSON.stringify(entry)});
      const input = "!".repeat(32 * 1024 * 1024);
      assert.equal(Address6.isValid(input), false);
      assert.throws(() => new Address6(input), error => {
        assert.ok(error instanceof AddressError);
        assert.ok(error.message.length < 512);
        assert.ok(!error.parseMessage || error.parseMessage.length < 512);
        return true;
      });
      process.stdout.write("bounded");
    `;
    const output = execFileSync(process.execPath, ["--max-old-space-size=128", "-e", script], {
      timeout: 4_000,
      killSignal: "SIGKILL",
      maxBuffer: 8_192,
      // No application credentials are needed or inherited by this fixture.
      env: {},
    });
    assert.equal(output.toString(), "bounded");
  });

  for (const arrayHeaders of [true, false]) {
    test(`cross-origin redirects strip credentials with ${arrayHeaders ? "array" : "metacharacter object"} headers`, async () => {
      const redirects = proxyRequire("follow-redirects");
      const protectedNames = ["Authorization", "Proxy-Authorization", "Cookie", "X-Control-Key", "X-Api^Key", "X-Token|Secret"];
      const entries = [
        ...protectedNames.map((name) => [name, "local-fixture-only"]),
        ["X-Public", "keep"], ["X-Token", "keep"], ["Secret", "keep"],
      ];
      let sourceHits = 0;
      let targetHits = 0;
      let sourceHeaders: http.IncomingHttpHeaders | undefined;
      let targetHeaders: http.IncomingHttpHeaders | undefined;
      const target = http.createServer((req, res) => {
        targetHits++;
        targetHeaders = req.headers;
        res.end("ok");
      });
      const source = http.createServer((req, res) => {
        sourceHits++;
        sourceHeaders = req.headers;
        res.writeHead(302, { location: targetOrigin });
        res.end();
      });
      let targetOrigin = "";
      try {
        targetOrigin = await listen(target);
        const sourceOrigin = await listen(source);
        const headers = arrayHeaders ? entries.flat() : Object.fromEntries(entries);
        await new Promise<void>((resolve, reject) => {
          let request: http.ClientRequest | undefined;
          const timer = setTimeout(() => request?.destroy(new Error("local redirect fixture deadline")), 2_500);
          const done = (error?: Error) => {
            clearTimeout(timer);
            error ? reject(error) : resolve();
          };
          try {
            request = redirects.http.get(sourceOrigin, {
              headers,
              maxRedirects: 2,
              sensitiveHeaders: ["X-Control-Key", "X-Api^Key", "X-Token|Secret"],
            }, (res: http.IncomingMessage) => {
              assert.equal(res.statusCode, 200);
              res.resume();
              res.once("error", done);
              res.once("end", () => done());
            });
            request!.once("error", done);
          } catch (error) {
            done(error as Error);
          }
        });
        assert.equal(sourceHits, 1);
        assert.equal(targetHits, 1);
        for (const name of protectedNames) {
          assert.equal(sourceHeaders?.[name.toLowerCase()], "local-fixture-only", "positive control: source receives header");
          assert.equal(targetHeaders?.[name.toLowerCase()], undefined, `${name} must not cross origins`);
        }
        for (const name of ["x-public", "x-token", "secret"]) {
          assert.equal(targetHeaders?.[name], "keep", "unrelated headers must survive literal-name filtering");
        }
      } finally {
        await Promise.all([close(source), close(target)]);
      }
    });
  }
});
