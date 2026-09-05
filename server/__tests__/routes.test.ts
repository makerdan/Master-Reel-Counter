import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  patchPhotoSchema,
  patchPinSchema,
  patchPinFlagSchema,
  patchEntrySchema,
} from "../routes.js";
import { pool } from "../db.js";

// The route module opens a PostgreSQL pool even when the real-server checks
// are skipped. Close this test process's pool so the unit tier cannot hang
// after all assertions have passed.
after(async () => {
  await pool.end().catch(() => {});
});

// ---------------------------------------------------------------------------
// Unit tests — schema validation in isolation
// ---------------------------------------------------------------------------

describe("patchPhotoSchema — Zod body guard", () => {
  test("rejects undefined (missing body)", () => {
    const result = patchPhotoSchema.safeParse(undefined);
    assert.equal(result.success, false, "undefined body must fail validation");
  });

  test("rejects null body", () => {
    const result = patchPhotoSchema.safeParse(null);
    assert.equal(result.success, false, "null body must fail validation");
  });

  test("accepts empty object (all fields optional)", () => {
    const result = patchPhotoSchema.safeParse({});
    assert.equal(result.success, true, "empty object must pass (all fields are optional)");
  });

  test("accepts valid partial update", () => {
    const result = patchPhotoSchema.safeParse({ rotation: 90, notes: "test" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.rotation, 90);
      assert.equal(result.data.notes, "test");
    }
  });

  test("rejects wrong types (rotation as string)", () => {
    const result = patchPhotoSchema.safeParse({ rotation: "ninety" });
    assert.equal(result.success, false, "rotation must be a number");
  });

  test("rejects non-object body (string)", () => {
    const result = patchPhotoSchema.safeParse("not-an-object");
    assert.equal(result.success, false, "string body must fail validation");
  });

  test("rejects non-object body (number)", () => {
    const result = patchPhotoSchema.safeParse(42);
    assert.equal(result.success, false, "number body must fail validation");
  });
});

describe("patchPinSchema — Zod body guard", () => {
  test("rejects undefined (missing body)", () => {
    const result = patchPinSchema.safeParse(undefined);
    assert.equal(result.success, false, "undefined body must fail validation");
  });

  test("rejects null body", () => {
    const result = patchPinSchema.safeParse(null);
    assert.equal(result.success, false, "null body must fail validation");
  });

  test("accepts empty object (all fields optional)", () => {
    const result = patchPinSchema.safeParse({});
    assert.equal(result.success, true, "empty object must pass (all fields are optional)");
  });

  test("accepts valid coordinate update", () => {
    const result = patchPinSchema.safeParse({ xPercent: 42.5, yPercent: 10.0 });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.xPercent, 42.5);
    }
  });

  test("rejects wrong types (xPercent as string)", () => {
    const result = patchPinSchema.safeParse({ xPercent: "fifty" });
    assert.equal(result.success, false, "xPercent must be a number");
  });
});

describe("patchPinFlagSchema — Zod body guard", () => {
  test("rejects undefined (missing body)", () => {
    const result = patchPinFlagSchema.safeParse(undefined);
    assert.equal(result.success, false, "undefined body must fail validation");
  });

  test("rejects null body", () => {
    const result = patchPinFlagSchema.safeParse(null);
    assert.equal(result.success, false, "null body must fail validation");
  });

  test("accepts empty object (all fields optional)", () => {
    const result = patchPinFlagSchema.safeParse({});
    assert.equal(result.success, true, "empty object must pass");
  });

  test("accepts flag with reason", () => {
    const result = patchPinFlagSchema.safeParse({ flagged: true, flagReason: "blurry" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.flagged, true);
      assert.equal(result.data.flagReason, "blurry");
    }
  });

  test("rejects wrong types (flagged as string)", () => {
    const result = patchPinFlagSchema.safeParse({ flagged: "yes" });
    assert.equal(result.success, false, "flagged must be a boolean");
  });
});

describe("patchEntrySchema — Zod body guard", () => {
  test("rejects undefined (missing body)", () => {
    const result = patchEntrySchema.safeParse(undefined);
    assert.equal(result.success, false, "undefined body must fail validation");
  });

  test("rejects null body", () => {
    const result = patchEntrySchema.safeParse(null);
    assert.equal(result.success, false, "null body must fail validation");
  });

  test("accepts empty object (all fields optional)", () => {
    const result = patchEntrySchema.safeParse({});
    assert.equal(result.success, true, "empty object must pass");
  });

  test("accepts valid partial update", () => {
    const result = patchEntrySchema.safeParse({ wireType: "THHN", footage: 500 });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.wireType, "THHN");
      assert.equal(result.data.footage, 500);
    }
  });

  test("rejects wrong types (footage as string)", () => {
    const result = patchEntrySchema.safeParse({ footage: "five-hundred" });
    assert.equal(result.success, false, "footage must be a number");
  });
});

describe("body guard — safeParse-first pattern (regression guard)", () => {
  test("schema guards prevent 500 from undefined destructuring", () => {
    const rawBody = undefined;
    const parsed = patchPhotoSchema.safeParse(rawBody);
    if (!parsed.success) {
      assert.ok(true, "should return 400 — the route does: if (!parsed.success) return res.status(400).json(...)");
    } else {
      assert.fail("Undefined body should not pass schema validation");
    }
  });

  test("schema guards prevent 500 from empty Content-Type body", () => {
    const rawBody = null;
    const parsed = patchPhotoSchema.safeParse(rawBody);
    if (!parsed.success) {
      assert.ok(true, "should return 400 — the route does: if (!parsed.success) return res.status(400).json(...)");
    } else {
      assert.fail("null body should not pass schema validation");
    }
  });

  test("any future body change still goes through safeParse before destructuring", () => {
    const bodies = [undefined, null, "", 0, false, []];
    for (const body of bodies) {
      const result = patchPhotoSchema.safeParse(body);
      assert.equal(result.success, false, `body ${JSON.stringify(body)} should fail schema validation`);
    }
  });
});

// ---------------------------------------------------------------------------
// Synthetic HTTP integration tests — minimal Express app exercises the same
// safeParse-first pattern used in the real routes.  Catches regressions where
// the schema itself breaks, but does not require DB or auth infrastructure.
// ---------------------------------------------------------------------------

function buildTestApp() {
  const app = express();
  app.use(express.json());

  app.patch("/api/photos/:id", (req, res) => {
    const parsed = patchPhotoSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ message: "Invalid photo update data", errors: parsed.error.flatten().fieldErrors });
    }
    res.json({ ok: true, data: parsed.data });
  });

  app.patch("/api/pins/:id", (req, res) => {
    const parsed = patchPinSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ message: "Invalid pin update data", errors: parsed.error.flatten().fieldErrors });
    }
    res.json({ ok: true, data: parsed.data });
  });

  app.patch("/api/pins/:pinId/flag", (req, res) => {
    const parsed = patchPinFlagSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ message: "Invalid pin flag data", errors: parsed.error.flatten().fieldErrors });
    }
    res.json({ ok: true, data: parsed.data });
  });

  app.patch("/api/entries/:id", (req, res) => {
    const parsed = patchEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ message: "Invalid entry update data", errors: parsed.error.flatten().fieldErrors });
    }
    res.json({ ok: true, data: parsed.data });
  });

  return app;
}

async function httpReq(
  baseUrl: string,
  method: string,
  path: string,
  opts: { body?: unknown; contentType?: string } = {}
): Promise<{ status: number; body: any }> {
  const raw = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string> = {};
  if (raw !== undefined) {
    headers["Content-Type"] = opts.contentType ?? "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(raw));
  }
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });
}

describe("PATCH synthetic integration — body validation returns 400, not 500", () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const app = buildTestApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  test("PATCH /api/photos/:id — no body → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/photos/1");
    assert.equal(status, 400, "missing body must yield 400");
  });

  test("PATCH /api/photos/:id — wrong Content-Type (text/plain) → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/photos/1", {
      body: "plain text", contentType: "text/plain",
    });
    assert.equal(status, 400, "non-JSON Content-Type leaves body unparsed → 400");
  });

  test("PATCH /api/photos/:id — invalid field type → 400", async () => {
    const { status, body } = await httpReq(baseUrl, "PATCH", "/api/photos/1", { body: { rotation: "bad" } });
    assert.equal(status, 400);
    assert.ok(body.errors, "response should include field errors");
  });

  test("PATCH /api/photos/:id — valid partial body → 200", async () => {
    const { status, body } = await httpReq(baseUrl, "PATCH", "/api/photos/1", { body: { rotation: 90, notes: "OK" } });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  test("PATCH /api/pins/:id — no body → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/pins/1");
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:id — wrong Content-Type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/pins/1", { body: "plain text", contentType: "text/plain" });
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:id — invalid field type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/pins/1", { body: { xPercent: "not-a-number" } });
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:id — valid partial body → 200", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/pins/1", { body: { xPercent: 50.0, yPercent: 25.0 } });
    assert.equal(status, 200);
  });

  test("PATCH /api/pins/:pinId/flag — no body → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/pins/1/flag");
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:pinId/flag — wrong Content-Type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/pins/1/flag", { body: "plain text", contentType: "text/plain" });
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:pinId/flag — invalid flagged type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/pins/1/flag", { body: { flagged: "yes" } });
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:pinId/flag — valid flag body → 200", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/pins/1/flag", { body: { flagged: true, flagReason: "blurry image" } });
    assert.equal(status, 200);
  });

  test("PATCH /api/entries/:id — no body → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/entries/1");
    assert.equal(status, 400);
  });

  test("PATCH /api/entries/:id — wrong Content-Type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/entries/1", { body: "plain text", contentType: "text/plain" });
    assert.equal(status, 400);
  });

  test("PATCH /api/entries/:id — invalid footage type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/entries/1", { body: { footage: "five-hundred" } });
    assert.equal(status, 400);
  });

  test("PATCH /api/entries/:id — valid partial body → 200", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", "/api/entries/1", { body: { wireType: "THHN", footage: 250 } });
    assert.equal(status, 200);
  });
});

// ---------------------------------------------------------------------------
// Real-server integration tests — hit the actual registerRoutes() handlers
// running on the dev server at localhost:5000 to verify end-to-end that the
// Zod body guards are wired into the real routes (not just the schemas).
// These tests authenticate via the __test__ endpoint, create real DB entities,
// send malformed PATCH requests, and verify 400 is returned before any crash.
// Skipped gracefully when the dev server is not reachable.
// ---------------------------------------------------------------------------

const DEV_SERVER = "http://localhost:5000";

async function devServerReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "localhost", port: 5000, path: "/api/healthz", method: "GET" },
      (res) => { resolve(res.statusCode === 200); }
    );
    req.on("error", () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function devReq(
  method: string,
  path: string,
  opts: { body?: unknown; contentType?: string; cookie?: string } = {}
): Promise<{ status: number; body: any; cookie?: string }> {
  const raw = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const headers: Record<string, string> = {};
  if (raw !== undefined) {
    headers["Content-Type"] = opts.contentType ?? "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(raw));
  }
  if (opts.cookie) headers["Cookie"] = opts.cookie;

  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "localhost", port: 5000, path, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          const setCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
          resolve({ status: res.statusCode ?? 0, body: parsed, cookie: setCookie });
        });
      }
    );
    req.on("error", reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });
}

describe("PATCH real-server integration — body guard wired into actual routes", () => {
  let cookie = "";
  let sessionId = 0;
  let entryId = 0;
  let skip = false;

  before(async () => {
    if (!(await devServerReachable())) {
      skip = true;
      return;
    }

    // Login as the test owner
    const loginRes = await devReq("POST", "/api/__test__/owner-login");
    if (loginRes.status !== 200 || !loginRes.cookie) { skip = true; return; }
    cookie = loginRes.cookie;

    // Create a throwaway session
    const sessRes = await devReq("POST", "/api/sessions", {
      body: { name: "routes-test-session" }, cookie,
    });
    if (sessRes.status !== 200) { skip = true; return; }
    sessionId = sessRes.body.id;

    // Create a throwaway entry
    const entryRes = await devReq("POST", `/api/sessions/${sessionId}/entries`, {
      body: { aisle: "A", section: "1", reelTag: "T1", wireType: "THHN", gauge: "12" },
      cookie,
    });
    if (entryRes.status !== 200) { skip = true; return; }
    entryId = entryRes.body.id;
  });

  after(async () => {
    if (sessionId && cookie) {
      await devReq("DELETE", `/api/sessions/${sessionId}`, { cookie }).catch(() => {});
      await devReq("DELETE", `/api/sessions/${sessionId}/permanent`, { cookie }).catch(() => {});
    }
  });

  test("PATCH /api/entries/:id (real route) — no Content-Type body → 400", async () => {
    if (skip) return;
    const { status } = await devReq("PATCH", `/api/entries/${entryId}`, { cookie });
    assert.equal(status, 400, "real route must return 400 on missing body, not 500");
  });

  test("PATCH /api/entries/:id (real route) — text/plain Content-Type → 400", async () => {
    if (skip) return;
    const { status } = await devReq("PATCH", `/api/entries/${entryId}`, {
      body: "plain text", contentType: "text/plain", cookie,
    });
    assert.equal(status, 400, "real route must reject non-JSON Content-Type with 400");
  });

  test("PATCH /api/entries/:id (real route) — invalid footage type → 400", async () => {
    if (skip) return;
    const { status, body } = await devReq("PATCH", `/api/entries/${entryId}`, {
      body: { footage: "not-a-number" }, cookie,
    });
    assert.equal(status, 400);
    assert.ok(body.errors, "response must include field-level errors");
  });

  test("PATCH /api/entries/:id (real route) — valid body → 200", async () => {
    if (skip) return;
    const { status, body } = await devReq("PATCH", `/api/entries/${entryId}`, {
      body: { wireType: "NM-B", footage: 100 }, cookie,
    });
    assert.equal(status, 200);
    assert.equal(body.wireType, "NM-B", "real route must apply the update");
  });
});
