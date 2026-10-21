import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import express from "express";
import sharp from "sharp";
import { cropPhoto } from "../lib/cropPhoto";
import { createImageUpload, IMAGE_UPLOAD_MAX_BYTES } from "../lib/imageUpload";
import { createApiErrorHandler } from "../middlewares/apiErrorHandler";

const consumer = createRequire(new URL("../routes.ts", import.meta.url));
const requirements = { sharp: "0.35.5", multer: "2.4.0" };

function installedVersion(name: string): string {
  let directory = dirname(consumer.resolve(name));
  for (;;) {
    try {
      const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (metadata.name === name) return metadata.version;
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    assert.notEqual(parent, directory, `missing package metadata: ${name}`);
    directory = parent;
  }
}

function assertPatched(name: string, version: string, minimum: string) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "stable releases only");
  const [major, minor, patch] = version.split(".").map(Number);
  const [floorMajor, floorMinor, floorPatch] = minimum.split(".").map(Number);
  assert.equal(major, floorMajor, `${name}: compatible major`);
  if (major === 0) assert.equal(minor, floorMinor, `${name}: compatible minor`);
  assert.ok(minor > floorMinor || (minor === floorMinor && patch >= floorPatch),
    `${name} requires >=${minimum}; found ${version}`);
}

function multipart(bytes: Buffer, mime = "image/png", field = "file") {
  return Buffer.concat([
    Buffer.from(`--fixture\r\nContent-Disposition: form-data; name="${field}"; filename="exact-original.png"\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes, Buffer.from("\r\n--fixture--\r\n"),
  ]);
}

type Outcome = { status: number; body: any };
async function post(url: string, body: Buffer, contentType = "multipart/form-data; boundary=fixture"): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: "POST", headers: { "content-type": contentType, "content-length": body.length },
    }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.setTimeout(2_000, () => req.destroy(new Error("fixture request hung")));
    req.on("error", reject);
    req.end(body);
  });
}

// Uses the production parser/policy and public error handler. Storage is a
// disposable in-memory sink, never the application's database or object bucket.
async function withUploadFixture(run: (fixture: {
  url: string;
  blobs: Map<string, Buffer>;
  rows: string[];
  callbacks: () => number;
  removals: () => number;
  startedFile: Promise<void>;
  closedFile: Promise<void>;
}) => Promise<void>) {
  const app = express();
  const upload = createImageUpload(1_024);
  let callbacks = 0;
  let removals = 0;
  const blobs = new Map<string, Buffer>();
  const rows: string[] = [];
  const memory = (upload as any).storage;
  let started!: () => void;
  let closed!: () => void;
  const startedFile = new Promise<void>(resolve => { started = resolve; });
  const closedFile = new Promise<void>(resolve => { closed = resolve; });
  const handle = memory._handleFile.bind(memory);
  memory._handleFile = (req: any, file: any, cb: any) => {
    started();
    file.stream.once("close", closed);
    handle(req, file, cb);
  };
  const remove = memory._removeFile.bind(memory);
  memory._removeFile = (req: any, file: any, cb: any) => {
    removals++;
    remove(req, file, cb);
  };
  app.post("/", upload.single("file"), async (req: any, res) => {
    callbacks++;
    if (!req.file) return res.status(400).json({ rejected: req._rejectedMimetype ?? "missing" });
    try {
      // Same rotate/resize/encode order as the avatar handler. Direct upload
      // intentionally stores bytes without decoding; it is not a signature gate.
      const output = await sharp(req.file.buffer).rotate()
        .resize(256, 256, { fit: "cover", position: "center" }).jpeg({ quality: 85 }).toBuffer();
      blobs.set(req.file.originalname, output);
      rows.push(req.file.originalname);
      res.json({ name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
    } catch {
      res.status(500).json({ message: "Failed to upload avatar" });
    }
  });
  app.use(createApiErrorHandler(() => {}));
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    await run({ url, blobs, rows, callbacks: () => callbacks, removals: () => removals,
      startedFile, closedFile });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe("image dependency security and compatibility", { timeout: 20_000 }, () => {
  test("consumer-resolved versions and every lockfile copy are patched", () => {
    const lock = JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    for (const [name, minimum] of Object.entries(requirements)) {
      const installed = installedVersion(name);
      assertPatched(name, installed, minimum);
      assert.equal(lock.packages[""].dependencies[name], pkg.dependencies[name]);
      const copies = Object.entries(lock.packages).filter(([key]) => key.endsWith(`node_modules/${name}`));
      assert.ok(copies.length > 0);
      for (const [key, metadata] of copies) {
        const version = (metadata as { version: string }).version;
        assertPatched(name, version, minimum);
        assert.equal(JSON.parse(readFileSync(new URL(`../../${key}/package.json`, import.meta.url), "utf8")).version, version);
      }
    }
    assert.equal(sharp.versions.sharp, installedVersion("sharp"));
    assert.ok(sharp.versions.vips, "native image library must load");
  });

  test("version guard rejects the affected releases without installing them", () => {
    assert.throws(() => assertPatched("sharp", "0.35.4", requirements.sharp), /requires >=0.35.5/);
    assert.throws(() => assertPatched("multer", "2.3.0", requirements.multer), /requires >=2.4.0/);
    assert.throws(() => assertPatched("sharp", "0.35.5-rc.1", requirements.sharp), /stable/);
  });

  test("production memory-storage and byte-limit defaults remain unchanged", () => {
    assert.equal(IMAGE_UPLOAD_MAX_BYTES, 50 * 1024 * 1024);
    assert.equal((createImageUpload() as any).limits.fileSize, IMAGE_UPLOAD_MAX_BYTES);
    assert.equal((createImageUpload() as any).storage.constructor.name, "MemoryStorage");
  });

  for (const format of ["jpeg", "png", "webp"] as const) {
    test(`${format}: multipart keeps original name and MIME, conversion and crops decode`, async () => {
      const source = await sharp({
        create: { width: 40, height: 24, channels: 3, background: "#c74423" },
      })[format]().toBuffer();
      const metadata = await sharp(source).metadata();
      assert.equal(metadata.width, 40);
      assert.equal(metadata.height, 24);
      const rotated = await sharp(source).rotate(90).toBuffer({ resolveWithObject: true });
      assert.equal(rotated.info.width, 24);
      assert.equal(rotated.info.height, 40);
      const thumbnail = await sharp(source).resize(20, 20, { fit: "inside" }).jpeg().toBuffer();
      const thumbMeta = await sharp(thumbnail).metadata();
      assert.equal(thumbMeta.width, 20);
      assert.equal(thumbMeta.height, 12);
      const crops = await cropPhoto(source, [{ pinId: 7, x: 100, y: 0, zoomLevel: 0.5 }]);
      assert.equal(crops.truncated, false);
      assert.equal(crops.skippedCount, 0);
      assert.equal(crops.results[0].pinId, 7);
      const crop = await sharp(Buffer.from(crops.results[0].base64, "base64")).metadata();
      assert.equal(crop.format, "jpeg");
      assert.equal(crop.width, 20);
      assert.equal(crop.height, 12);
      await withUploadFixture(async fixture => {
        const response = await post(fixture.url, multipart(source, `image/${format}`));
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, {
          name: "exact-original.png", size: source.length, mimetype: `image/${format}`,
        });
        assert.deepEqual(fixture.rows, ["exact-original.png"]);
        assert.equal(fixture.blobs.size, 1);
        const avatar = await sharp(fixture.blobs.get("exact-original.png")!).metadata();
        assert.equal(avatar.width, 256);
        assert.equal(avatar.height, 256);
        assert.equal(avatar.format, "jpeg");
      });
    });
  }

  test("EXIF auto-rotation swaps dimensions and strips orientation", async () => {
    const source = await sharp({ create: { width: 40, height: 24, channels: 3, background: "#123456" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const rotated = await sharp(source).rotate().toBuffer();
    const metadata = await sharp(rotated).metadata();
    assert.equal(metadata.width, 24);
    assert.equal(metadata.height, 40);
    assert.equal(metadata.orientation, undefined);
  });

  test("small trusted SVG fixture still decodes with the patched native library", async () => {
    const output = await sharp(Buffer.from('<svg width="4" height="3" xmlns="http://www.w3.org/2000/svg"><rect width="4" height="3" fill="red"/></svg>'))
      .png().toBuffer();
    assert.equal((await sharp(output).metadata()).width, 4);
  });

  test("malformed multipart and unexpected fields never reach persistence", async () => {
    await withUploadFixture(async fixture => {
      for (const [body, type] of [
        [Buffer.from("--fixture\r\ninvalid"), "multipart/form-data; boundary=fixture"],
        [Buffer.from("not a multipart body"), "multipart/form-data"],
        [multipart(Buffer.from("bytes"), "image/png", "unexpected"), "multipart/form-data; boundary=fixture"],
      ] as const) {
        const result = await post(fixture.url, body, type);
        assert.ok(result.status >= 400);
      }
      assert.equal(fixture.callbacks(), 0);
      assert.equal(fixture.blobs.size, 0);
      assert.deepEqual(fixture.rows, []);
    });
  });

  test("SVG, GIF and arbitrary MIME are rejected without side effects", async () => {
    await withUploadFixture(async fixture => {
      for (const mime of ["image/svg+xml", "image/gif", "application/octet-stream"]) {
        const result = await post(fixture.url, multipart(Buffer.from("untrusted"), mime));
        assert.equal(result.status, 400);
        assert.equal(result.body.rejected, mime);
      }
      assert.equal(fixture.blobs.size, 0);
      assert.deepEqual(fixture.rows, []);
    });
  });

  test("bytes above the limit are rejected and partial memory files are removed", async () => {
    await withUploadFixture(async fixture => {
      for (const size of [1_025, 4_096]) {
        const result = await post(fixture.url, multipart(Buffer.alloc(size)));
        assert.equal(result.status, 413);
      }
      assert.equal(fixture.callbacks(), 0);
      assert.equal(fixture.removals(), 2);
      assert.equal(fixture.blobs.size, 0);
      assert.deepEqual(fixture.rows, []);
    });
  });

  test("valid images just below and exactly at the configured limit succeed", async () => {
    const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: "red" } }).png().toBuffer();
    for (const size of [1_023, 1_024]) {
      await withUploadFixture(async fixture => {
        const padded = Buffer.concat([png, Buffer.alloc(size - png.length)]);
        const result = await post(fixture.url, multipart(padded));
        assert.equal(result.status, 200);
        assert.equal(result.body.size, size);
        assert.equal(fixture.blobs.size, 1);
        assert.deepEqual(fixture.rows, ["exact-original.png"]);
      });
    }
  });

  test("corrupt allowed image fails decoding before storage; crop rejects too", async () => {
    const corrupt = Buffer.from("not an image");
    await assert.rejects(cropPhoto(corrupt, [{ pinId: 1, x: 50, y: 50, zoomLevel: 1 }]));
    await withUploadFixture(async fixture => {
      const response = await post(fixture.url, multipart(corrupt));
      assert.equal(response.status, 500);
      assert.equal(fixture.blobs.size, 0);
      assert.deepEqual(fixture.rows, []);
    });
  });

  test("aborting an in-flight multipart request closes it without persistence", async () => {
    await withUploadFixture(async fixture => {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(fixture.url, {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=fixture", "content-length": 4_096 },
        });
        req.on("error", error => {
          if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
        });
        req.on("close", resolve);
        req.setTimeout(2_000, () => req.destroy(new Error("abort fixture hung")));
        req.flushHeaders();
        req.write(multipart(Buffer.alloc(128)).subarray(0, -17));
        void fixture.startedFile.then(() => req.destroy()).catch(reject);
      });
      // Observe actual parser stream cleanup, not a fixed sleep or a client-only
      // abort that could happen before the server receives any upload bytes.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          fixture.closedFile,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("aborted file stream did not close")), 2_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.equal(fixture.callbacks(), 0);
      assert.equal(fixture.blobs.size, 0);
      assert.deepEqual(fixture.rows, []);
      assert.equal((await post(fixture.url, multipart(Buffer.from("bad"), "image/svg+xml"))).status, 400,
        "server remains responsive after abort");
    });
  });
});
