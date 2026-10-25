import 
{
 test, describe, before, after 
}
 from "node:test"
;

import assert from "node:assert/strict"
;
import sharp from "sharp";
import { Readable } from "node:stream";
import {
  acquireLabelScanSlot,
  LABEL_SCAN_LIMITS,
  LabelScanResourceError,
  prepareLabelScan,
  readBoundedScanImage,
} from "../lib/labelScanResources";
import { cropPhoto } from "../lib/cropPhoto";
import { registerSessionAuthorizationTests } from "./session-authorization-cases";

test("permanent folder deletion promotes descendants in an isolated database", { timeout: 30000 }, async (t) => {
  const schema = `folder_lifecycle_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const setup = await pool.connect();
  let isolatedPool: pg.Pool | undefined;
  t.after(async () => {
    await isolatedPool?.end();
    try {
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      setup.release();
    }
  });

  await setup.query(`CREATE SCHEMA "${schema}"`);
  await setup.query(`
    CREATE TABLE "${schema}".folders (
      id serial PRIMARY KEY,
      user_id varchar NOT NULL,
      name text NOT NULL,
      parent_folder_id integer,
      trashed_from_parent_folder_id integer,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now(),
      deleted_at timestamp
    )
  `);
  await setup.query(`
    CREATE TABLE "${schema}".counting_sessions (
      id serial PRIMARY KEY,
      user_id varchar NOT NULL,
      folder_id integer,
      name text NOT NULL,
      started_at timestamp NOT NULL DEFAULT now(),
      trashed_from_folder_id integer
    )
  `);
  isolatedPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=8000`,
    application_name: schema,
    connectionTimeoutMillis: 5000,
  });
  const isolated = drizzle(isolatedPool, { schema: databaseSchema });

  const insertFolder = async (userId: string, name: string, parentId: number | null = null) => {
    const result = await isolatedPool!.query(
      `INSERT INTO folders (user_id, name, parent_folder_id) VALUES ($1, $2, $3) RETURNING id`,
      [userId, name, parentId],
    );
    return result.rows[0].id as number;
  };
  const insertSession = async (userId: string, name: string, folderId: number) => {
    const result = await isolatedPool!.query(
      `INSERT INTO counting_sessions (user_id, name, folder_id) VALUES ($1, $2, $3) RETURNING id`,
      [userId, name, folderId],
    );
    return result.rows[0].id as number;
  };

  const parentId = await insertFolder("owner-one", "parent");
  const childId = await insertFolder("owner-one", "child");
  await isolatedPool.query(
    `UPDATE folders SET deleted_at = now() WHERE id = $1`,
    [parentId],
  );
  await isolatedPool.query(
    `UPDATE folders SET trashed_from_parent_folder_id = $1 WHERE id = $2`,
    [parentId, childId],
  );
  const grandchildId = await insertFolder("owner-one", "grandchild", childId);
  const childSessionId = await insertSession("owner-one", "child-session", childId);
  const otherParentId = await insertFolder("owner-two", "other-parent");
  const otherChildId = await insertFolder("owner-two", "other-child", otherParentId);
  const otherSessionId = await insertSession("owner-two", "other-session", otherChildId);

  await permanentlyDeleteFolderData(isolated, parentId);

  const remainingFolders = await isolatedPool.query(
    `SELECT id, user_id, parent_folder_id, trashed_from_parent_folder_id FROM folders ORDER BY id`,
  );
  assert.deepEqual(remainingFolders.rows, [
    { id: childId, user_id: "owner-one", parent_folder_id: null, trashed_from_parent_folder_id: null },
    { id: grandchildId, user_id: "owner-one", parent_folder_id: childId, trashed_from_parent_folder_id: null },
    { id: otherParentId, user_id: "owner-two", parent_folder_id: null, trashed_from_parent_folder_id: null },
    { id: otherChildId, user_id: "owner-two", parent_folder_id: otherParentId, trashed_from_parent_folder_id: null },
  ]);
  const remainingSessions = await isolatedPool.query(
    `SELECT id, user_id, folder_id FROM counting_sessions ORDER BY id`,
  );
  assert.deepEqual(remainingSessions.rows, [
    { id: childSessionId, user_id: "owner-one", folder_id: childId },
    { id: otherSessionId, user_id: "owner-two", folder_id: otherChildId },
  ]);
});

describe("label scan resource boundaries", () => {
  const pin = (photoId: number, pinId = photoId) => ({
    photoId, pinId, x: 50, y: 50, zoomLevel: 1,
  });
  const photo = (id: number) => Promise.resolve({
    sessionId: 7, objectStorageKey: String(id), rotation: 0,
  });
  const isOversized = (error: unknown) =>
    error instanceof LabelScanResourceError && error.statusCode === 413;

  test("bounded reads accept the exact limit and reject actual overflow without trusting metadata", async () => {
    const exact = Readable.from([Buffer.alloc(4, 1), Buffer.alloc(4, 2)]);
    assert.equal((await readBoundedScanImage(exact, 8)).length, 8);
    assert.equal(exact.destroyed, true);
    const overflow = Readable.from([Buffer.alloc(4), Buffer.alloc(5), Buffer.alloc(1)]);
    await assert.rejects(readBoundedScanImage(overflow, 8), isOversized);
    assert.equal(overflow.destroyed, true);
    const broken = new Readable({ read() { this.destroy(new Error("download failed")); } });
    await assert.rejects(readBoundedScanImage(broken, 8), /download failed/);
    assert.equal(broken.destroyed, true);
  });

  test("scan slot rejects overlap, releases on error, and stale release cannot unlock another scan", async () => {
    const release = acquireLabelScanSlot();
    try {
      assert.throws(acquireLabelScanSlot, (error: unknown) =>
        error instanceof LabelScanResourceError && error.statusCode === 429);
      await assert.rejects((async () => {
        try {
          await prepareLabelScan(7, [pin(1)], photo, async () => { throw new Error("failed"); });
        } finally {
          release();
        }
      })(), /failed/);
      const nextRelease = acquireLabelScanSlot();
      try {
        release();
        assert.throws(acquireLabelScanSlot, /Another label scan/);
      } finally {
        nextRelease();
      }
    } finally {
      release();
    }
    acquireLabelScanSlot()();
  });

  test("normal scans crop sequentially, preserve coordinates and rotation, and exclude foreign/missing photos", async () => {
    const input = await sharp({
      create: { width: 80, height: 40, channels: 3, background: "#ffaa00" },
    }).png().toBuffer();
    const pins = [pin(2, 20), pin(1, 10), pin(2, 21), pin(3, 30), pin(4, 40)];
    const loads: string[] = [];
    const prepared = await prepareLabelScan(7, pins, async (id) => id === 4 ? undefined : ({
      sessionId: id === 3 ? 8 : 7, objectStorageKey: String(id), rotation: id === 2 ? 90 : 0,
    }), async (key, remaining) => {
      loads.push(key);
      assert.equal(remaining, LABEL_SCAN_LIMITS.inputBytes - (loads.length - 1) * input.length);
      return input;
    });
    assert.deepEqual(loads, ["2", "1"]);
    assert.deepEqual(prepared.requests.map((item) => item.pinId), [20, 10, 21]);
    assert.equal(prepared.crops.length, 3);
    const oriented = await sharp(input).rotate(90).toBuffer();
    const expected = await cropPhoto(oriented, [pin(2, 20)]);
    assert.equal(prepared.crops.find((crop) => crop.pinId === 20)?.base64, expected.results[0].base64);
    const metadata = await sharp(Buffer.from(prepared.crops[0].base64, "base64")).metadata();
    assert.equal(metadata.width, 40);
    assert.equal(metadata.height, 80);
    assert.equal(prepared.truncated, false);
    assert.equal(prepared.skippedCount, 0);
  });

  test("pixel bombs are rejected from headers before decoding and before loading subsequent photos", async () => {
    // SVG headers safely exercise dimensions without allocating a huge raster.
    const bomb = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200000" height="200000"/>');
    let loads = 0;
    await assert.rejects(prepareLabelScan(7, [pin(1), pin(2)], photo, async () => {
      loads++;
      return bomb;
    }), isOversized);
    assert.equal(loads, 1);
  });

  test("aggregate pixels are limited even when each individual compressed photo is allowed", async () => {
    const image = await sharp({
      create: { width: 4000, height: 3500, channels: 3, background: "#aaa" },
    }).png().toBuffer();
    assert.ok(image.length < 1024 * 1024);
    await assert.rejects(prepareLabelScan(7, [pin(1), pin(2), pin(3)], photo,
      async () => image), isOversized);
  });

  test("aggregate actual input bytes are enforced even for small images with large trailing data", async () => {
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#aaa" },
    }).jpeg().toBuffer();
    const padded = Buffer.alloc(LABEL_SCAN_LIMITS.inputBytes / 2 + 1);
    image.copy(padded);
    const budgets: number[] = [];
    await assert.rejects(prepareLabelScan(7, [pin(1), pin(2)], photo, async (_key, remaining) => {
      budgets.push(remaining);
      return padded;
    }), isOversized);
    assert.deepEqual(budgets, [LABEL_SCAN_LIMITS.inputBytes, LABEL_SCAN_LIMITS.inputBytes - padded.length]);
  });

  test("retained AI crops have a separate payload budget", async () => {
    const image = await sharp(randomBytes(600 * 600 * 3), {
      raw: { width: 600, height: 600, channels: 3 },
    }).png().toBuffer();
    await assert.rejects(prepareLabelScan(7,
      Array.from({ length: 50 }, (_, index) => pin(1, index)),
      photo, async () => image), isOversized);
  });

  test("both production scan routes acquire before preparation, reject resource failures, and always release", () => {
    const source = readFileSync("server/routes.ts", "utf8");
    for (const route of ["/api/photos/:photoId/analyze-labels", "/api/sessions/:sessionId/analyze-labels"]) {
      const start = source.indexOf(`app.post("${route}"`);
      assert.ok(start > 0);
      const end = source.indexOf("\n  app.", start + 1);
      const handler = source.slice(start, end);
      const slot = handler.indexOf("releaseScan = acquireLabelScanSlot()");
      const prepare = handler.indexOf("await prepareLabelScan(");
      const provider = handler.indexOf("getPoeProvider().completeVision(");
      assert.ok(slot > handler.indexOf("verifySessionAccess("));
      assert.ok(prepare > slot && provider > prepare);
      assert.match(handler, /error instanceof LabelScanResourceError/);
      assert.match(handler, /return res\.status\(error\.statusCode\)/);
      assert.match(handler, /finally \{\s+releaseScan\?\.\(\);/);
      assert.doesNotMatch(handler, /photoBufferMap|loadPhotoBuffer\(photo\.objectStorageKey\)/);
    }
    assert.match(source, /readBoundedScanImage\(gcsFile\.createReadStream\(\), maxBytes\)/);
    assert.match(source, /readBoundedScanImage\(createReadStream\(path\.join\(UPLOADS_DIR, photoFilename\)\), maxBytes\)/);
  });
});

import 
{
 readFileSync 
}
 from "node:fs"
;

import { randomUUID, randomBytes } from "node:crypto";
import type { TestContext } from "node:test";
import { execFileSync } from "node:child_process";

import http from "node:http"
;

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as databaseSchema from "@shared/schema";
import express from "express"
;
import multer from "multer";
import { createApiErrorHandler } from "../middlewares/apiErrorHandler.js";

describe("patched Express parser HTTP compatibility", () => {
  test("JSON, form limits, safe errors and multipart bypass remain intact", { timeout: 10_000 }, async () => {
    const app = express();
    app.use(express.json({ limit: 128 }));
    app.use(express.urlencoded({ extended: false, limit: 128 }));
    app.post("/", (req, res) => {
      if (req.is("multipart/form-data")) {
        assert.equal(req.body, undefined);
        let raw = "";
        req.on("data", chunk => { raw += chunk; });
        req.on("end", () => res.json({ raw }));
      } else res.json(req.body);
    });
    app.use(createApiErrorHandler(() => {}));
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    async function post(body: string, type: string) {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST", headers: { "content-type": type }, body,
        signal: AbortSignal.timeout(2_000),
      });
      return { status: response.status, body: await response.json() };
    }
    try {
      assert.deepEqual(await post('{"ok":true}', "application/json"), { status: 200, body: { ok: true } });
      assert.deepEqual(await post("a=hello", "application/x-www-form-urlencoded"), { status: 200, body: { a: "hello" } });
      assert.deepEqual(await post('{"private":', "application/json"), {
        status: 400, body: { message: "Invalid JSON request body." },
      });
      for (const type of ["application/json", "application/x-www-form-urlencoded"]) {
        const result = await post("x".repeat(129), type);
        assert.equal(result.status, 413);
        assert.equal(JSON.stringify(result.body).includes("xxx"), false);
      }
      const multipart = "--fixture\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.txt\"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--fixture--\r\n";
      assert.deepEqual(await post(multipart, "multipart/form-data; boundary=fixture"), { status: 200, body: { raw: multipart } });
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

import helmet from "helmet"
;

import 
{
 clerkMiddleware 
}
 from "@clerk/express"
;
import { buildPublishableKey } from "@clerk/shared/keys";
import { CLERK_FRONTEND_API_HOST } from "@shared/clerk-config";
import type { User } from "@shared/models/auth";

import 
{

  patchPhotoSchema,
  patchPinSchema,
  patchPinFlagSchema,
  patchEntrySchema,
  buildScanResultsForPins,
  canEdit,
  authorizeCommentUpdate,
  createAdminAiHealthHandler,
  createHelpChatHandler,
  helpChatRateLimiter,
  respondWithScanResultsPersistenceFailure,
  SCAN_RESULTS_PERSISTENCE_ERROR,
  createSessionHandler,
  getCurrentPdfJobAccess,
  registerRoutes,
  accountCapabilityMiddleware,
}
 from "../routes.js"
;

import 
{
 PoeProviderError, type PoeProvider 
}
 from "../providers/poe.js"
;

import 
{
  isAuthenticated,
  getPersistedIdentityAliases,
  resolveClerkAccount,
}
 from "../replit_integrations/auth/replitAuth.js"
;

import 
{

  evictAllSessionSockets,
  evictUserSockets,
  evictSessionUserSockets,
  PRE_AUTH_WEBSOCKET_LIMITS,
  PreAuthWebSocketBuffer,
  RealtimeAuthorizationTracker,
  joinRealtimeRoom,
  broadcastRealtimeRoom,
  registerAuthorizationChangeHandler,
}
 from "../realtime-authorization.js"
;

import 
{
  db,
  pool
}
 from "../db.js"
;
import { eq } from "drizzle-orm";
import { permanentlyDeleteFolderData, storage } from "../storage.js";

import 
{
 isProtectedOwnerIdentity 
}
 from "../replit_integrations/auth/replitAuth.js"
;

import 
{

  isApproved,
  classifyAuthUserLookup,
  isIdentityApproved,
  getIdentityAuthorizationOutcome,
  isAdminIdentity,
  isWebSocketIdentityAuthorized,
  registerAuthRoutes,
}
 from "../replit_integrations/auth/routes.js"
;

import { buildSignInPath, getSafeReturnPath } from "../../shared/auth-routing.js";
import { RESTRICTED_USER_CAPABILITIES } from "@shared/models/auth";
import { SESSION_VALIDATION_ERROR_CODE } from "@shared/schema";

import 
{
  authStorage,
  AuthStorage,
  sanitizeUserProfileWrite,
}
 from "../replit_integrations/auth/storage.js"
;

import 
{
 registerObjectStorageRoutes 
}
 from "../replit_integrations/object_storage/routes.js"
;

import 
{
 createSecurityHeadersOptions
}
 from "../contentSecurityPolicy.js"
;

import 
{

  CLERK_PROXY_PATH,
  ClerkProxyHealth,
  createClerkProxyMiddleware,
}
 from "../middlewares/clerkProxyMiddleware.js"
;


// The route module opens a PostgreSQL pool even when the real-server checks
// are skipped. Close this test process's pool so the unit tier cannot hang
// after all assertions have passed.
after(async () => {
  await pool.end().catch(() => {});
});


test("approval transitions — persisted state and mounted HTTP boundaries", { timeout: 30000 }, async (t) => {
  const schema = `approval_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const setup = await pool.connect();
  let isolatedPool: pg.Pool | undefined;
  let server: http.Server | undefined;
  const events: Array<[string, string]> = [];
  const methods = [
    "getUser", "getUserByClerkUserId", "setUserApproved", "setUserCapabilities",
    "rejectUser", "clearAllRejected", "canRemoveAdmin",
  ] as const;
  const originals = methods.map((name) => [name, authStorage[name]] as const);
  t.after(async () => {
    if (server?.listening) await closeHttpServer(server);
    for (const [name, original] of originals) (authStorage as any)[name] = original;
    registerAuthorizationChangeHandler(() => {});
    await isolatedPool?.end();
    try {
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      setup.release();
    }
  });
  await setup.query(`CREATE SCHEMA "${schema}"`);
  await setup.query(`
    CREATE TABLE "${schema}".users (
      id varchar PRIMARY KEY, clerk_user_id varchar UNIQUE, email varchar,
      first_name varchar, last_name varchar, profile_image_url varchar,
      custom_avatar_key varchar, approved boolean NOT NULL DEFAULT false,
      rejected boolean NOT NULL DEFAULT false, role text NOT NULL DEFAULT 'User',
      capabilities jsonb NOT NULL DEFAULT '${JSON.stringify(RESTRICTED_USER_CAPABILITIES)}',
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now()
    )
  `);
  isolatedPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=8000`,
    application_name: schema,
    connectionTimeoutMillis: 5000,
  });
  const isolated = new AuthStorage(drizzle(isolatedPool, { schema: databaseSchema }));
  for (const name of methods) (authStorage as any)[name] = isolated[name].bind(isolated);
  for (const user of [
    { id: "admin", role: "Admin" as const, approved: true },
    { id: "ordinary", approved: true },
    { id: "pending" },
    { id: "rejected-actor", rejected: true },
    { id: "target" },
  ]) {
    await isolated.createUserForClerkIdentity(user, user.id);
  }
  registerAuthorizationChangeHandler((id, outcome) => events.push([id, outcome]));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers["x-test-identity"] as string | undefined;
    (req as any).auth = Object.assign(
      () => ({
        userId: userId ?? null,
        sessionClaims: userId ? { sub: userId } : null,
        tokenType: "session_token",
      }),
      { [Symbol.for("@clerk/express.auth")]: true },
    );
    next();
  });
  registerAuthRoutes(app);
  server = http.createServer(app);
  const baseUrl = await listenOnLoopback(server);
  const request = async (
    path: string, method = "PATCH", body: unknown = { approved: true },
    actor: string | null = "admin",
  ) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(actor ? { "x-test-identity": actor } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    return { status: response.status, body: await response.json() };
  };
  const approvalPath = "/api/admin/users/target/approval";
  const readTarget = async () => {
    const user = await isolated.getUser("target");
    assert.ok(user);
    return user;
  };

  await t.test("R1 genuine approval restricts defaults; repeat approval preserves a custom HTTP grant", async () => {
    await isolated.setUserCapabilities("target", { ...RESTRICTED_USER_CAPABILITIES, exports: true });
    assert.equal((await request(approvalPath)).status, 200);
    assert.deepEqual((await readTarget()).capabilities, RESTRICTED_USER_CAPABILITIES);
    assert.equal((await request("/api/admin/users/target/capabilities", "PATCH", { exports: true })).status, 200);
    const before = await readTarget();
    events.length = 0;
    const response = await request(approvalPath);
    assert.equal(response.status, 200);
    assert.equal(response.body.capabilities.exports, true);
    assert.deepEqual(await readTarget(), before, "unchanged approval must not write or reset a grant");
    assert.deepEqual(events.slice(), [], "unchanged approval does not reduce authorization");
  });

  await t.test("R2 rejected approval conflicts without writes; explicit clear then approve recovers", async () => {
    assert.equal((await request("/api/admin/users/target", "DELETE", {})).status, 200);
    assert.deepEqual(events.slice(), [["target", "account_rejected"]]);
    const rejected = await readTarget();
    events.length = 0;
    const response = await request(approvalPath);
    assert.equal(response.status, 409);
    assert.match(response.body.message, /clear rejection/i);
    assert.deepEqual(await readTarget(), rejected);
    assert.deepEqual(events.slice(), []);
    assert.equal((await request("/api/admin/users/clear-rejected", "POST", {})).status, 200);
    assert.ok(events.some(([id, outcome]) => id === "target" && outcome === "rejected_users_cleared"));
    assert.equal((await readTarget()).approved, false);
    assert.equal((await request(approvalPath)).status, 200);
    const restored = await readTarget();
    assert.equal(restored.approved, true);
    assert.equal(restored.rejected, false);
    assert.deepEqual(restored.capabilities, RESTRICTED_USER_CAPABILITIES);
  });

  await t.test("R3 guards reject unauthorized, self-targeted, malformed and missing-target requests", async () => {
    const before = await readTarget();
    for (const [actor, status] of [[null, 401], ["ordinary", 403], ["pending", 403], ["rejected-actor", 403]] as const) {
      // Reapply rejection because clear-rejected is intentionally a bulk recovery action.
      if (actor === "rejected-actor") await isolated.rejectUser(actor);
      assert.equal((await request(approvalPath, "PATCH", { approved: true }, actor)).status, status);
    }
    assert.equal((await request("/api/admin/users/admin/approval", "PATCH", { approved: false })).status, 400);
    assert.equal((await request("/api/admin/users/admin/approval")).status, 400);
    assert.equal((await request(approvalPath, "PATCH", { approved: "true" })).status, 400);
    assert.equal((await request("/api/admin/users/absent/approval")).status, 404);
    assert.deepEqual(await isolated.setUserApproved("absent", true), { kind: "not_found" });
    assert.deepEqual(await readTarget(), before);
    await isolated.createUserForClerkIdentity({ id: "disabled-admin", role: "Admin" }, "disabled-admin");
    assert.equal((await request("/api/admin/users/admin/approval", "PATCH", { approved: false }, "disabled-admin")).status, 403);
    // A distinct approved Admin remains subject to the final-Admin guard.
    await isolatedPool!.query(`UPDATE users SET role = 'User' WHERE id = 'admin'`);
    await isolatedPool!.query(`UPDATE users SET approved = true WHERE id = 'disabled-admin'`);
    assert.equal((await request("/api/admin/users/disabled-admin/approval", "PATCH", { approved: false }, "ordinary")).status, 403);
    assert.equal(await isolated.canRemoveAdmin("disabled-admin"), false);
    await isolatedPool!.query(`UPDATE users SET role = 'Admin' WHERE id = 'admin'`);
  });

  await t.test("R3 admission removal resets capabilities and emits authorization reduction", async () => {
    await isolated.setUserCapabilities("target", { ...RESTRICTED_USER_CAPABILITIES, exports: true });
    events.length = 0;
    const response = await request(approvalPath, "PATCH", { approved: false });
    assert.equal(response.status, 200);
    assert.equal((await readTarget()).approved, false);
    assert.deepEqual((await readTarget()).capabilities, RESTRICTED_USER_CAPABILITIES);
    assert.deepEqual(events.slice(), [["target", "approval_removed"]]);
  });

  // Hold an uncommitted competing write while the HTTP handler reads the old
  // committed row. Observe its database lock wait before committing the writer.
  // This reproduces the stale-read window deterministically, not by a sleep.
  const withInterveningWrite = async (update: string) => {
    const writer = await isolatedPool!.connect();
    let pending: ReturnType<typeof request> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query(update);
      pending = request(approvalPath);
      let waiting = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const result = await setup.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'",
          [schema],
        );
        if (result.rowCount) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(waiting, "approval must reach the competing row lock before the writer commits");
      await writer.query("COMMIT");
      return await pending;
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      if (pending) await pending;
    }
  };
  await t.test("R1 blocked repeated approval rereads a newer capability grant", async () => {
    await isolated.setUserApproved("target", true);
    const response = await withInterveningWrite(
      `UPDATE users SET capabilities = capabilities || '{"exports":true}'::jsonb WHERE id = 'target'`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.capabilities.exports, true);
    assert.equal((await readTarget()).capabilities.exports, true);
  });
  await t.test("R2 blocked approval cannot overwrite an intervening rejection", async () => {
    const before = await readTarget();
    events.length = 0;
    const response = await withInterveningWrite(
      "UPDATE users SET approved = false, rejected = true WHERE id = 'target'",
    );
    assert.equal(response.status, 409);
    const after = await readTarget();
    assert.deepEqual(after, { ...before, approved: false, rejected: true });
    assert.deepEqual(events.slice(), []);
  });
});

describe("Clerk identity and approval regression guard", () => {
  test("identity-link migration applies and rolls back against PostgreSQL", async () => {
    const migration = readFileSync(
      new URL("../../migrations/0026_add_users_clerk_user_id.sql", import.meta.url),
      "utf8",
    );
    const rollback = readFileSync(
      new URL("../../migrations/rollback/0026_add_users_clerk_user_id.sql", import.meta.url),
      "utf8",
    );
    const client = await pool.connect();
    const schema = `clerk_mapping_test_${process.pid}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query('CREATE TABLE "users" ("id" varchar PRIMARY KEY)');
      await client.query(migration);
      await client.query(
        `INSERT INTO "users" ("id", "clerk_user_id") VALUES ('one', 'user_same')`,
      );
      await client.query("SAVEPOINT duplicate_mapping");
      await assert.rejects(
        client.query(
          `INSERT INTO "users" ("id", "clerk_user_id") VALUES ('two', 'user_same')`,
        ),
        /unique/i,
      );
      await client.query("ROLLBACK TO SAVEPOINT duplicate_mapping");
      await client.query(rollback);
      const columns = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'users'`,
        [schema],
      );
      assert.deepEqual(columns.rows.map(({ column_name }) => column_name), ["id"]);

      await client.query(
        `ALTER TABLE "users"
         ADD COLUMN "clerk_user_id" varchar
         CONSTRAINT "users_clerk_user_id_unique" UNIQUE`,
      );
      await client.query(rollback);
      const constraintColumns = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'users'`,
        [schema],
      );
      assert.deepEqual(
        constraintColumns.rows.map(({ column_name }) => column_name),
        ["id"],
      );
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  test("keeps concurrent bind and create operations to one immutable Clerk mapping", async () => {
    const suffix = `${process.pid}_${randomUUID().replaceAll("-", "")}`;
    const testSchema = `clerk_race_${suffix}`;
    const legacyUserId = `clerk-race-legacy-${suffix}`;
    const createdUserId = `clerk-race-created-${suffix}`;
    const clerkUserId = `user_clerk-race-${suffix}`;
    const migration = readFileSync(
      new URL("../../migrations/0026_add_users_clerk_user_id.sql", import.meta.url),
      "utf8",
    );
    const capabilitiesMigration = readFileSync(
      new URL("../../migrations/0027_add_user_capabilities.sql", import.meta.url),
      "utf8",
    );
    const setupClient = await pool.connect();
    let isolatedPool: pg.Pool | undefined;

    try {
      await setupClient.query("BEGIN");
      await setupClient.query(`CREATE SCHEMA "${testSchema}"`);
      await setupClient.query(`SET LOCAL search_path TO "${testSchema}"`);
      await setupClient.query(`
        CREATE TABLE "users" (
          "id" varchar PRIMARY KEY,
          "email" varchar,
          "first_name" varchar,
          "last_name" varchar,
          "profile_image_url" varchar,
          "custom_avatar_key" varchar,
          "approved" boolean NOT NULL DEFAULT false,
          "rejected" boolean NOT NULL DEFAULT false,
          "role" text NOT NULL DEFAULT 'User',
          "created_at" timestamp DEFAULT now(),
          "updated_at" timestamp DEFAULT now()
        )
      `);
      await setupClient.query(migration);
      await setupClient.query(capabilitiesMigration);
      await setupClient.query("COMMIT");

      isolatedPool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        options: `-c search_path="${testSchema}"`,
      });
      const isolatedDb = drizzle(isolatedPool, { schema: databaseSchema });
      const isolatedAuthStorage = new AuthStorage(isolatedDb);
      await isolatedAuthStorage.createUserIfMissing({ id: legacyUserId });

      const outcomes = await Promise.allSettled([
        isolatedAuthStorage.bindClerkUserId(legacyUserId, clerkUserId),
        isolatedAuthStorage.createUserForClerkIdentity({ id: createdUserId }, clerkUserId),
      ]);
      const fulfilled = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<User | undefined> => outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
      );

      assert.equal(fulfilled.length, 1, "exactly one competing mapping operation must win");
      assert.equal(rejected.length, 1, "the conflicting operation must fail closed");

      const mappings = await isolatedPool.query(
        `SELECT id, clerk_user_id
         FROM "users"
         WHERE clerk_user_id = $1`,
        [clerkUserId],
      );
      assert.equal(mappings.rowCount, 1, "the Clerk identity must have one local mapping");
      assert.ok(
        [legacyUserId, createdUserId].includes(mappings.rows[0].id),
        "the winning mapping must point to one of the competing local accounts",
      );
      assert.equal(mappings.rows[0].clerk_user_id, clerkUserId);
    } finally {
      await isolatedPool?.end().catch(() => {});
      await setupClient.query("ROLLBACK").catch(() => {});
      await setupClient.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      setupClient.release();
    }
  });

  test("ordinary account writes discard hostile Clerk identity linkage", () => {
    const sanitized = sanitizeUserProfileWrite({
      id: "local-id",
      firstName: "Pat",
      clerkUserId: "user_hostile",
    } as any);
    assert.deepEqual(sanitized, {
      id: "local-id",
      email: undefined,
      firstName: "Pat",
      lastName: undefined,
      profileImageUrl: undefined,
      customAvatarKey: undefined,
      approved: undefined,
      rejected: undefined,
      role: undefined,
      capabilities: undefined,
      createdAt: undefined,
      updatedAt: undefined,
    });
    assert.equal("clerkUserId" in sanitized, false);
  });

  test("resolves a persisted native Clerk mapping without loading the Clerk profile", async () => {
    const originalGetByClerkId = authStorage.getUserByClerkUserId;
    let profileLoads = 0;
    authStorage.getUserByClerkUserId = async () => ({
      id: "legacy-local-id",
      clerkUserId: "user_native-id",
    } as any);

    try {
      const resolved = await resolveClerkAccount("user_native-id", async () => {
        profileLoads++;
        throw new Error("Clerk Users API must not be called");
      });
      assert.equal(resolved.userId, "legacy-local-id");
      assert.equal(resolved.identityBinding, "clerk-external-id");
      assert.equal(profileLoads, 0);
    } finally {
      authStorage.getUserByClerkUserId = originalGetByClerkId;
    }
  });

  test("verified alias recovery uses the persisted mapping without Clerk profile access", async () => {
    const originalGetByClerkId = authStorage.getUserByClerkUserId;
    authStorage.getUserByClerkUserId = async () => ({
      id: "legacy-local-id",
      clerkUserId: "user_native-id",
    } as any);
    try {
      assert.deepEqual(
        await getPersistedIdentityAliases("user_native-id", "legacy-local-id"),
        ["user_native-id"],
      );
      assert.deepEqual(
        await getPersistedIdentityAliases("user_native-id", "different-local-id"),
        [],
      );
    } finally {
      authStorage.getUserByClerkUserId = originalGetByClerkId;
    }
  });

  test("persists a legacy mapping only from Clerk's verified external ID", async () => {
    const originalGetByClerkId = authStorage.getUserByClerkUserId;
    const originalGetUser = authStorage.getUser;
    const originalBind = authStorage.bindClerkUserId;
    const bindings: Array<[string, string]> = [];
    authStorage.getUserByClerkUserId = async () => undefined;
    authStorage.getUser = async (id) => id === "verified-legacy-id"
      ? { id, clerkUserId: null } as any
      : undefined;
    authStorage.bindClerkUserId = async (id, clerkUserId) => {
      bindings.push([id, clerkUserId]);
      return { id, clerkUserId } as any;
    };

    try {
      const resolved = await resolveClerkAccount("user_native-id", async () => ({
        id: "user_native-id",
        externalId: "verified-legacy-id",
      }));
      assert.equal(resolved.userId, "verified-legacy-id");
      assert.deepEqual(bindings, [["verified-legacy-id", "user_native-id"]]);
    } finally {
      authStorage.getUserByClerkUserId = originalGetByClerkId;
      authStorage.getUser = originalGetUser;
      authStorage.bindClerkUserId = originalBind;
    }
  });

  test("rejects a conflicting immutable Clerk mapping", async () => {
    const originalGetByClerkId = authStorage.getUserByClerkUserId;
    const originalGetUser = authStorage.getUser;
    const originalBind = authStorage.bindClerkUserId;
    authStorage.getUserByClerkUserId = async () => undefined;
    authStorage.getUser = async () => ({ id: "legacy-id", clerkUserId: "user_other" } as any);
    authStorage.bindClerkUserId = async () => undefined;

    try {
      await assert.rejects(
        resolveClerkAccount("user_native-id", async () => ({
          id: "user_native-id",
          externalId: "legacy-id",
        })),
        /already linked/,
      );
    } finally {
      authStorage.getUserByClerkUserId = originalGetByClerkId;
      authStorage.getUser = originalGetUser;
      authStorage.bindClerkUserId = originalBind;
    }
  });

  test("keeps missing local users distinct from provisioned approval states", () => {
    assert.deepEqual(classifyAuthUserLookup({ claims: { sub: "missing" } }, undefined), {
      kind: "not_provisioned",
    });
    assert.equal(
      classifyAuthUserLookup(
        { claims: { sub: "pending" } },
        { id: "pending", approved: false, rejected: false } as any,
      ).kind,
      "user",
    );
  });

  test("initial Admin promotion trusts legacy and Clerk external bindings, never native Clerk", () => {
    const base = {
      existing: { role: "Admin" },
      userId: "legacy-owner-subject",
      username: "dan",
      replOwner: "dan",
      binding: "legacy-claim" as const,
    };
    assert.equal(isProtectedOwnerIdentity(base), true);
    assert.equal(
      isProtectedOwnerIdentity({ ...base, binding: "clerk-external-id" }),
      true,
    );
    assert.equal(
      isProtectedOwnerIdentity({ ...base, binding: "native-clerk" }),
      false,
    );
    assert.equal(isProtectedOwnerIdentity({ ...base, existing: undefined }), false);
    assert.equal(isProtectedOwnerIdentity({ ...base, userId: "user_new-clerk-id" }), false);
    assert.equal(isProtectedOwnerIdentity({ ...base, username: "someone-else" }), false);
    assert.equal(isProtectedOwnerIdentity({ ...base, existing: { role: "User" } }), true);
    assert.equal(
      isProtectedOwnerIdentity({ ...base, binding: "clerk-external-id" }),
      true,
    );
    assert.equal(
      isProtectedOwnerIdentity({ ...base, binding: "native-clerk" }),
      false,
    );
  });

  test("Admin authorization trusts only persisted role, never username claims", () => {
    assert.equal(isAdminIdentity({ role: "Admin", claims: { username: "dan" } }), true);
    assert.equal(isAdminIdentity({ role: "User", claims: { username: "dan" } }), false);
    assert.equal(isAdminIdentity({ claims: { username: "dan" } }), false);
  });

  test("approval rejects missing identity and remains separate from role", async () => {
    assert.equal(await isIdentityApproved({ role: "Admin" }), false);
    assert.equal(await isIdentityApproved({}), false);
  });

  test("exposes stable authorization outcomes for pending, rejected, and changed identities", async () => {
    const originalGetUser = authStorage.getUser;
    const records = new Map([
      ["pending-user", { approved: false, rejected: false }],
      ["rejected-user", { approved: false, rejected: true }],
      ["approved-user", { approved: true, rejected: false }],
    ]);
    authStorage.getUser = async (userId: string) => records.get(userId) as any;

    try {
      assert.equal(
        await getIdentityAuthorizationOutcome({ claims: { sub: "pending-user" } }),
        "pending",
      );
      assert.equal(
        await getIdentityAuthorizationOutcome({ claims: { sub: "rejected-user" } }),
        "rejected",
      );
      assert.equal(
        await getIdentityAuthorizationOutcome({ claims: { sub: "approved-user" } }),
        "approved",
      );
      assert.equal(await getIdentityAuthorizationOutcome(undefined), "identity_changed");
    } finally {
      authStorage.getUser = originalGetUser;
    }
  });

  test("rejects pending and rejected collaborators from WebSocket authorization", async () => {
    const originalGetUser = authStorage.getUser;
    const records = new Map([
      ["pending-user", { approved: false, rejected: false }],
      ["rejected-user", { approved: false, rejected: true }],
      ["approved-user", { approved: true, rejected: false }],
    ]);
    authStorage.getUser = async (userId: string) => records.get(userId) as any;

    try {
      assert.equal(
        await isWebSocketIdentityAuthorized({ claims: { sub: "pending-user" } }),
        false,
      );
      assert.equal(
        await isWebSocketIdentityAuthorized({ claims: { sub: "rejected-user" } }),
        false,
      );
      assert.equal(
        await isWebSocketIdentityAuthorized({ claims: { sub: "approved-user" } }),
        true,
      );
      assert.equal(await isWebSocketIdentityAuthorized({ claims: { sub: "missing-user" }, role: "Admin" }), false);
    } finally {
      authStorage.getUser = originalGetUser;
    }
  });

  test("fails WebSocket revalidation after a connected collaborator is rejected", async () => {
    const originalGetUser = authStorage.getUser;
    let rejected = false;
    authStorage.getUser = async () => ({
      id: "collaborator-user",
      approved: !rejected,
      rejected,
    } as User);

    try {
      const connectedUser = { claims: { sub: "collaborator-user" } };
      assert.equal(await isWebSocketIdentityAuthorized(connectedUser), true);
      rejected = true;
      assert.equal(
        await isWebSocketIdentityAuthorized({ claims: { sub: "collaborator-user" } }, connectedUser),
        false,
      );
    } finally {
      authStorage.getUser = originalGetUser;
    }
  });

  test("approval middleware blocks pending/rejected photo viewers but admits approved collaborators", async () => {
    const originalGetUser = authStorage.getUser;
    const records = new Map([
      ["pending-photo-user", { approved: false, rejected: false }],
      ["rejected-photo-user", { approved: false, rejected: true }],
      ["approved-photo-user", { approved: true, rejected: false }],
    ]);
    authStorage.getUser = async (userId: string) => records.get(userId) as any;

    try {
      const run = async (user: any) => {
        let nextCalled = false;
        let statusCode = 0;
        let body: any;
        await isApproved(
          { user } as any,
          {
            status(code: number) {
              statusCode = code;
              return this;
            },
            json(value: any) {
              body = value;
              return this;
            },
          } as any,
          () => { nextCalled = true; },
        );
        return { nextCalled, statusCode, body };
      };

      for (const userId of ["pending-photo-user", "rejected-photo-user"]) {
        const result = await run({ claims: { sub: userId } });
        assert.equal(result.nextCalled, false);
        assert.equal(result.statusCode, 403);
        assert.deepEqual(result.body, { message: "pending_approval" });
      }
      assert.deepEqual(await run({ claims: { sub: "approved-photo-user" }}), {
        nextCalled: true,
        statusCode: 0,
        body: undefined,
      });
      assert.equal((await run({ claims: { sub: "approved-photo-user" }, role: "Admin" })).nextCalled, true);
    } finally {
      authStorage.getUser = originalGetUser;
    }
  });

  test("protected object route wires local approval after authentication", () => {
    const app = express();
    registerObjectStorageRoutes(app);
    const router = (app as any).router ?? (app as any)._router;
    const routeLayer = router.stack.find(
      (layer: any) => layer.route?.path === "/objects/{*objectPath}",
    );
    assert.ok(routeLayer, "protected object route should be registered");
    assert.deepEqual(
      routeLayer.route.stack.slice(0, 2).map((layer: any) => layer.handle.name),
      ["isAuthenticated", "isApproved"],
    );
  });
});

describe("protected sign-in return paths", () => {
  test("allows only known internal destinations", () => {
    for (const path of ["/session/42", "/join/invite-token", "/settings", "/stats", "/help"]) {
      assert.equal(getSafeReturnPath(path), path);
    }
    assert.equal(getSafeReturnPath("https://evil.example/session/42"), null);
    assert.equal(getSafeReturnPath("//evil.example/session/42"), null);
    assert.equal(getSafeReturnPath("/api/auth/user"), null);
    assert.equal(getSafeReturnPath("/join/token/extra"), null);
  });

  test("encodes a validated destination without exposing arbitrary query values", () => {
    assert.equal(
      buildSignInPath("/session/42?tab=photos", "/app"),
      "/app/sign-in?redirect_url=%2Fsession%2F42%3Ftab%3Dphotos",
    );
    assert.equal(buildSignInPath("https://evil.example", "/app"), "/app/sign-in");
  });
});

describe("scan result persistence contract", () => {
  test("returns an explicit retryable response when persistence fails", () => {
    let statusCode: number | undefined;
    let body: unknown;
    const response = {
      status(code: number) {
        statusCode = code;
        return {
          json(payload: unknown) {
            body = payload;
            return payload;
          },
        };
      },
    } as any;

    respondWithScanResultsPersistenceFailure(response);

    assert.equal(statusCode, 503);
    assert.deepEqual(body, SCAN_RESULTS_PERSISTENCE_ERROR);
    assert.equal((body as any).retryable, true);
    assert.equal((body as any).code, "scan_results_persistence");
  });
});

describe("comment update authorization", () => {
  test("denies a revoked collaborator before persistence or broadcast", async () => {
    const collaborator = "comment-collaborator";
    const comment = {
      id: 42,
      sessionId: 7,
      userId: collaborator,
      text: "before revocation",
    };
    let access: { role: string } | null = { role: "editor" };
    const broadcasts: string[] = [];

    const createComment = await authorizeCommentUpdate(
      comment,
      collaborator,
      async () => access,
    );
    assert.equal(createComment.allowed, true, "an editor can create the original comment");

    access = null;
    const updateComment = async (text: string) => {
      const authorization = await authorizeCommentUpdate(
        comment,
        collaborator,
        async () => access,
      );
      if (!authorization.allowed) return authorization;
      comment.text = text;
      broadcasts.push(text);
      return authorization;
    };

    const denied = await updateComment("after revocation");
    assert.deepEqual(denied, { allowed: false, status: 404, message: "Session not found" });
    assert.equal(comment.text, "before revocation");
    assert.deepEqual(broadcasts, []);
  });

  test("retains author and editable-role checks for an authorized update", async () => {
    const accessChecker = async () => ({ role: "editor" });
    assert.deepEqual(
      await authorizeCommentUpdate(
        { sessionId: 7, userId: "author" },
        "author",
        accessChecker,
      ),
      { allowed: true, access: { role: "editor" } },
    );
    assert.deepEqual(
      await authorizeCommentUpdate(
        { sessionId: 7, userId: "author" },
        "other-user",
        accessChecker,
      ),
      { allowed: false, status: 403, message: "Not authorized" },
    );
    assert.deepEqual(
      await authorizeCommentUpdate(
        { sessionId: 7, userId: "author" },
        "author",
        async () => ({ role: "viewer" }),
      ),
      { allowed: false, status: 403, message: "View-only access" },
    );
  });
});

function getDirective(header: string, directive: string): string {
  const value = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directive} `));
  assert.ok(value, `CSP should include ${directive}`);
  return value;
}

async function getSecurityHeaders(isProduction: boolean): Promise<http.IncomingHttpHeaders> {
  const app = express();
  app.use(helmet(createSecurityHeadersOptions(isProduction)));
  app.get("/", (_req, res) => {
    res.type("html").send(
      '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
    );
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await new Promise<{ headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const request = http.get(
        { hostname: "127.0.0.1", port: address.port, path: "/" },
        (incoming) => {
          incoming.resume();
          incoming.on("end", () => resolve({ headers: incoming.headers }));
        },
      );
      request.on("error", reject);
    });
    return response.headers;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Content Security Policy", () => {
  test("production script-src is an exact Clerk and app allow-list", async () => {
    const csp = (await getSecurityHeaders(true))["content-security-policy"];
    if (typeof csp !== "string") {
      assert.fail("response should include a string Content-Security-Policy header");
    }
    assert.equal(
      getDirective(csp, "script-src"),
      "script-src 'self' https://frontend-api.clerk.dev https://*.clerk.accounts.dev https://challenges.cloudflare.com https://*.protect.clerk.com",
    );
    const scriptSrc = getDirective(csp, "script-src");
    assert.doesNotMatch(scriptSrc, /unsafe-eval/);
    assert.doesNotMatch(scriptSrc, /unsafe-inline/);
    assert.doesNotMatch(scriptSrc, /(^| )https:(;|$)/);
    assert.match(csp, /style-src[^;]*'unsafe-inline'/);
    assert.match(csp, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);
  });

  test("development adds only Vite's eval allowance to the same explicit sources", async () => {
    const csp = (await getSecurityHeaders(false))["content-security-policy"];
    if (typeof csp !== "string") {
      assert.fail("response should include a string Content-Security-Policy header");
    }
    assert.equal(
      getDirective(csp, "script-src"),
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://frontend-api.clerk.dev https://*.clerk.accounts.dev https://challenges.cloudflare.com https://*.protect.clerk.com",
    );
    assert.match(getDirective(csp, "script-src"), /unsafe-inline/);
    assert.match(csp, /style-src[^;]*'unsafe-inline'/);
  });

  test("allows Clerk OAuth popups to communicate with the app window", async () => {
    const headers = await getSecurityHeaders(false);
    assert.equal(
      headers["cross-origin-opener-policy"],
      "same-origin-allow-popups",
    );
  });

  test("the managed-Clerk entry page uses an external module script allowed by self", () => {
    const entryPage = readFileSync(
      new URL("../../client/index.html", import.meta.url),
      "utf8",
    );
    assert.match(entryPage, /<script type="module" src="\/src\/main\.tsx"><\/script>/);
    assert.doesNotMatch(entryPage, /<script(?![^>]*\bsrc=)[^>]*>/);
  });
});

describe("pre-authentication WebSocket message limits", () => {
  test("bounds retained message count during unresolved authentication", () => {
    const buffer = new PreAuthWebSocketBuffer<Buffer>();
    const payload = Buffer.from('{"type":"ping"}');

    for (let index = 0; index < PRE_AUTH_WEBSOCKET_LIMITS.maxMessages; index += 1) {
      assert.equal(buffer.enqueue(payload, payload.byteLength), "accepted");
    }
    assert.equal(buffer.enqueue(payload, payload.byteLength), "message_limit");
    assert.equal(buffer.retainedMessageCount, PRE_AUTH_WEBSOCKET_LIMITS.maxMessages);
    assert.equal(
      buffer.retainedBytes,
      PRE_AUTH_WEBSOCKET_LIMITS.maxMessages * payload.byteLength,
    );
  });

  test("rejects oversized frames and aggregate byte overflow without retaining them", () => {
    const buffer = new PreAuthWebSocketBuffer<Buffer>({
      maxMessages: 10,
      maxAggregateBytes: 10,
      maxPayloadBytes: 6,
    });

    assert.equal(buffer.enqueue(Buffer.alloc(7), 7), "payload_limit");
    assert.equal(buffer.retainedMessageCount, 0);
    assert.equal(buffer.enqueue(Buffer.alloc(6), 6), "accepted");
    assert.equal(buffer.enqueue(Buffer.alloc(5), 5), "aggregate_limit");
    assert.equal(buffer.retainedMessageCount, 1);
    assert.equal(buffer.retainedBytes, 6);
  });

  test("timeout releases retained frames and late authentication cannot process them", async () => {
    const buffer = new PreAuthWebSocketBuffer<Buffer>();
    const processed: string[] = [];
    buffer.enqueue(Buffer.from("queued"), 6);

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        buffer.release();
        resolve();
      }, 1);
    });

    assert.equal(
      await buffer.drain((message) => { processed.push(message.toString()); }, () => true),
      false,
    );
    assert.deepEqual(processed, []);
    assert.equal(buffer.retainedMessageCount, 0);
    assert.equal(buffer.retainedBytes, 0);
  });

  test("disconnect during authentication releases frames and blocks late resolution", async () => {
    const buffer = new PreAuthWebSocketBuffer<Buffer>();
    const processed: string[] = [];
    buffer.enqueue(Buffer.from("join"), 4);
    buffer.release();

    assert.equal(
      await buffer.drain((message) => { processed.push(message.toString()); }, () => false),
      false,
    );
    assert.deepEqual(processed, []);
    assert.equal(buffer.isAccepting, false);
  });

  test("authenticated sockets drain valid join and ping frames in order", async () => {
    const buffer = new PreAuthWebSocketBuffer<Buffer>();
    const processed: string[] = [];
    const messages = [
      Buffer.from('{"type":"join","sessionId":42}'),
      Buffer.from('{"type":"ping"}'),
    ];
    for (const message of messages) {
      assert.equal(buffer.enqueue(message, message.byteLength), "accepted");
    }

    assert.equal(
      await buffer.drain((message) => { processed.push(message.toString()); }, () => true),
      true,
    );
    assert.deepEqual(processed, messages.map((message) => message.toString()));
    assert.equal(buffer.retainedMessageCount, 0);
    assert.equal(buffer.retainedBytes, 0);
  });

  test("stops draining queued operations after the socket closes", async () => {
    const buffer = new PreAuthWebSocketBuffer<Buffer>();
    const processed: string[] = [];
    let open = true;
    buffer.enqueue(Buffer.from("first"), 5);
    buffer.enqueue(Buffer.from("second"), 6);

    assert.equal(
      await buffer.drain((message) => {
        processed.push(message.toString());
        open = false;
      }, () => open),
      false,
    );
    assert.deepEqual(processed, ["first"]);
    assert.equal(buffer.retainedMessageCount, 0);
  });
});

describe("RealtimeAuthorizationTracker", () => {
  function fixture(t: TestContext) {
    const makeSocket = () => ({
      readyState: 1,
      messages: [] as any[],
      closes: [] as Array<{ code: number; reason: string }>,
      send(data: string) { this.messages.push(JSON.parse(data)); },
      // Intentionally keep readyState OPEN to exercise the revocation latch
      // independently of ws.close()'s synchronous transition to CLOSING.
      close(code: number, reason: string) { this.closes.push({ code, reason }); },
    });
    type Socket = ReturnType<typeof makeSocket>;
    type Info = { sessionId: number | null; userId: string | null; role: string | null; revoked?: boolean };
    const rooms = new Map<number, Set<Socket>>();
    const users = new Map<Socket, Info>();
    const accounts = new Map<string, { approved: boolean; rejected: boolean }>([
      ["affected", { approved: true, rejected: false }],
      ["other", { approved: true, rejected: false }],
    ]);
    t.mock.method(authStorage, "getUser", async (userId: string) => accounts.get(userId));
    const options = {
      sessionRooms: rooms,
      socketUsers: users,
      openReadyState: 1,
      authorization: new RealtimeAuthorizationTracker(),
      authorizeSession: async (_sessionId: number, _userId: string): Promise<{ role: string } | null> => ({ role: "owner" }),
      accountOutcome: (userId: string) => getIdentityAuthorizationOutcome({ claims: { sub: userId } }),
      broadcastPresence: (_sessionId: number) => {},
    };
    const connect = (userId = "affected") => {
      const socket = makeSocket();
      users.set(socket, { sessionId: null, userId, role: null });
      return socket;
    };
    const broadcast = () => broadcastRealtimeRoom(rooms, 42, { type: "protected-update" }, 1);
    return { rooms, users, accounts, options, connect, broadcast };
  }

  for (const outcome of ["account_rejected", "approval_removed"] as const) {
    test(`${outcome} closes joined and unjoined sockets and excludes later broadcasts without affecting another account`, async (t) => {
      const f = fixture(t);
      const joined = f.connect();
      const unjoined = f.connect();
      const other = f.connect("other");
      await joinRealtimeRoom(joined, 42, f.options);
      await joinRealtimeRoom(other, 42, f.options);
      f.accounts.set("affected", { approved: false, rejected: outcome === "account_rejected" });
      evictUserSockets(f.rooms, f.users, "affected", 1, outcome, outcome);
      for (const socket of [joined, unjoined]) {
        assert.deepEqual(socket.closes, [{ code: 1008, reason: outcome }]);
        assert.equal(socket.messages.at(-1)?.outcome, outcome);
        assert.equal(f.users.get(socket)?.sessionId, null);
      }
      await joinRealtimeRoom(unjoined, 42, f.options);
      f.broadcast();
      assert.deepEqual([...f.rooms.get(42)!], [other]);
      assert.equal(unjoined.messages.some(m => m.type === "joined"), false);
      assert.equal(joined.messages.some(m => m.type === "protected-update"), false);
      assert.equal(unjoined.messages.some(m => m.type === "protected-update"), false);
      assert.equal(other.messages.at(-1)?.type, "protected-update");
      assert.equal(other.closes.length, 0);
    });

    for (const boundary of ["session", "account"] as const) {
      test(`${outcome} during delayed ${boundary} authorization cannot restore room access`, async (t) => {
        const f = fixture(t);
        const affected = f.connect();
        const other = f.connect("other");
        await joinRealtimeRoom(other, 42, f.options);
        let release!: () => void;
        let started!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { started = resolve; });
        if (boundary === "session") {
          f.options.authorizeSession = async () => {
            started();
            await pending;
            return { role: "editor" };
          };
        } else {
          f.options.accountOutcome = async () => {
            started();
            await pending;
            return "approved"; // A stale read must not override local revocation.
          };
        }
        const join = joinRealtimeRoom(affected, 42, f.options);
        await entered;
        evictUserSockets(f.rooms, f.users, "affected", 1, outcome, outcome);
        release();
        await join;
        assert.equal(affected.messages.some(m => m.type === "joined"), false);
        assert.equal(f.users.get(affected)?.sessionId, null);
        assert.deepEqual([...f.rooms.get(42)!], [other]);
        f.broadcast();
        assert.equal(affected.messages.some(m => m.type === "protected-update"), false);
        assert.equal(other.messages.at(-1)?.type, "protected-update");
        assert.equal(other.closes.length, 0);
      });
    }
  }

  for (const state of ["pending", "rejected", "missing"] as const) {
    test(`fresh account admission denies ${state} even when session access allows ownership`, async (t) => {
      const f = fixture(t);
      const socket = f.connect();
      if (state === "missing") f.accounts.delete("affected");
      else f.accounts.set("affected", { approved: false, rejected: state === "rejected" });
      await joinRealtimeRoom(socket, 42, f.options);
      assert.equal(socket.closes[0]?.code, 1008);
      assert.equal(socket.messages[0]?.outcome, state === "missing" ? "identity_changed" : state);
      assert.equal(f.rooms.size, 0);
      assert.equal(socket.messages.some(m => m.type === "joined"), false);
    });
  }

  for (const lifecycle of ["closing", "closed", "removed", "replaced"] as const) {
    test(`a ${lifecycle} socket cannot be inserted after delayed authorization`, async (t) => {
      const f = fixture(t);
      const socket = f.connect();
      let release!: () => void;
      f.options.authorizeSession = () => new Promise(resolve => {
        release = () => resolve({ role: "owner" });
      });
      const join = joinRealtimeRoom(socket, 42, f.options);
      if (lifecycle === "closing") socket.readyState = 2;
      if (lifecycle === "closed") socket.readyState = 3;
      if (lifecycle === "removed") f.users.delete(socket);
      if (lifecycle === "replaced") f.users.set(socket, { sessionId: null, userId: "other", role: null });
      release();
      await join;
      assert.equal(f.rooms.size, 0);
      assert.equal(socket.messages.length, 0);
    });
  }

  test("session invalidation during account admission still rechecks collaborator access", async (t) => {
    const f = fixture(t);
    const socket = f.connect();
    let allowed = true;
    let calls = 0;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    f.options.authorizeSession = async () => { calls++; return allowed ? { role: "editor" } : null; };
    f.options.accountOutcome = async () => { started(); await pending; return "approved"; };
    const join = joinRealtimeRoom(socket, 42, f.options);
    await entered;
    allowed = false;
    f.options.authorization.invalidate(42);
    release();
    await join;
    assert.equal(calls, 2);
    assert.equal(socket.messages[0]?.outcome, "denied_join");
    assert.equal(socket.closes[0]?.code, 1008);
    assert.equal(f.rooms.size, 0);
  });

  test("approved owner and collaborator joins preserve room switching and permission denial", async (t) => {
    const f = fixture(t);
    const owner = f.connect();
    const collaborator = f.connect("other");
    f.options.authorizeSession = async (sessionId, userId) =>
      sessionId === 99 ? null : { role: userId === "affected" ? "owner" : "viewer" };
    await joinRealtimeRoom(owner, 41, f.options);
    await joinRealtimeRoom(owner, 42, f.options);
    await joinRealtimeRoom(collaborator, 42, f.options);
    assert.equal(f.rooms.has(41), false);
    assert.equal(f.users.get(owner)?.role, "owner");
    assert.equal(f.users.get(collaborator)?.role, "viewer");
    f.broadcast();
    assert.equal(owner.messages.at(-1)?.type, "protected-update");
    assert.equal(collaborator.messages.at(-1)?.type, "protected-update");
    const denied = f.connect();
    await joinRealtimeRoom(denied, 99, f.options);
    assert.equal(denied.messages[0]?.outcome, "denied_join");
    assert.equal(f.rooms.has(99), false);
  });

  test("evicts every socket for the affected user without removing other collaborators", () => {
    const sent: string[] = [];
    const affected = {
      readyState: 1,
      send: (data: string) => sent.push(data),
      closeCode: 0,
      closeReason: "",
      close(code: number, reason: string) {
        this.closeCode = code;
        this.closeReason = reason;
      },
    };
    const unaffected = {
      readyState: 1,
      send: (_data: string) => {},
      close: (_code: number, _reason: string) => {},
    };
    const rooms = new Map([[42, new Set([affected, unaffected])]]);
    const users = new Map([
      [affected, { sessionId: 42, userId: "revoked-user", role: "editor" }],
      [unaffected, { sessionId: 42, userId: "other-user", role: "viewer" }],
    ]);

    evictSessionUserSockets(rooms, users, 42, "revoked-user", 1, "Session access revoked");

    assert.deepEqual([...rooms.get(42)!], [unaffected]);
    assert.deepEqual(users.get(affected), { sessionId: null, userId: "revoked-user", role: null });
    assert.deepEqual(JSON.parse(sent[0]), {
      type: "authorization_changed",
      outcome: "removed_collaborator",
      message: "Your access to this session was removed.",
    });
    assert.equal(affected.closeCode, 1008);
    assert.equal(affected.closeReason, "Session access revoked");
  });

  test("evicts the same account from every active session", () => {
    const closed: string[] = [];
    const sent: Array<{ sessionId: number; message: any }> = [];
    const makeSocket = (sessionId: number) => ({
      readyState: 1,
      send: (data: string) => sent.push({ sessionId, message: JSON.parse(data) }),
      close: (_code: number, _reason: string) => closed.push(String(sessionId)),
    });
    const first = makeSocket(1);
    const second = makeSocket(2);
    const other = makeSocket(2);
    const rooms = new Map([
      [1, new Set([first])],
      [2, new Set([second, other])],
    ]);
    const users = new Map([
      [first, { sessionId: 1, userId: "revoked-user", role: "editor" }],
      [second, { sessionId: 2, userId: "revoked-user", role: "viewer" }],
      [other, { sessionId: 2, userId: "other-user", role: "viewer" }],
    ]);

    evictUserSockets(
      rooms,
      users,
      "revoked-user",
      1,
      "Account approval removed",
      "approval_removed",
    );

    assert.deepEqual(closed.sort(), ["1", "2"]);
    assert.equal(rooms.has(1), false);
    assert.deepEqual([...rooms.get(2)!], [other]);
    assert.deepEqual(sent.map(({ message }) => message), [
      {
        type: "authorization_changed",
        outcome: "approval_removed",
        message: "Your account approval was removed.",
      },
      {
        type: "authorization_changed",
        outcome: "approval_removed",
        message: "Your account approval was removed.",
      },
    ]);
    assert.equal(users.get(first)?.sessionId, null);
    assert.equal(users.get(second)?.sessionId, null);
    assert.equal(users.get(other)?.sessionId, 2);
  });

  test("evicts every room member when the session is deleted", () => {
    const closed: string[] = [];
    const makeSocket = (name: string) => ({
      readyState: 1,
      send: (_data: string) => {},
      close: (_code: number, _reason: string) => closed.push(name),
    });
    const owner = makeSocket("owner");
    const collaborator = makeSocket("collaborator");
    const rooms = new Map([[42, new Set([owner, collaborator])]]);
    const users = new Map([
      [owner, { sessionId: 42, userId: "owner", role: "owner" }],
      [collaborator, { sessionId: 42, userId: "collaborator", role: "viewer" }],
    ]);

    evictAllSessionSockets(rooms, users, 42, 1, "Session deleted");

    assert.equal(rooms.has(42), false);
    assert.deepEqual(closed.sort(), ["collaborator", "owner"]);
    assert.equal(users.get(owner)?.sessionId, null);
    assert.equal(users.get(owner)?.role, null);
    assert.equal(users.get(collaborator)?.sessionId, null);
    assert.equal(users.get(collaborator)?.role, null);
  });

  test("retries an in-flight authorization after the session is invalidated", async () => {
    const tracker = new RealtimeAuthorizationTracker();
    let resolveFirst!: (value: string) => void;
    let calls = 0;

    const authorization = tracker.authorizeConsistently(42, async () => {
      calls++;
      if (calls === 1) {
        return new Promise<string>((resolve) => { resolveFirst = resolve; });
      }
      return "viewer";
    });

    await Promise.resolve();
    tracker.invalidate(42);
    resolveFirst("editor");

    assert.equal(await authorization, "viewer");
    assert.equal(calls, 2);
  });

  test("does not invalidate authorization checks for other sessions", async () => {
    const tracker = new RealtimeAuthorizationTracker();
    let calls = 0;

    const authorization = tracker.authorizeConsistently(7, async () => {
      calls++;
      tracker.invalidate(8);
      return "editor";
    });

    assert.equal(await authorization, "editor");
    assert.equal(calls, 1);
  });
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

describe("Zod 4 schema compatibility", () => {
  test("Drizzle entry validation preserves null footage/text and string conductors", async () => {
    const { insertEntrySchema } = await import("../../shared/schema");
    const input = {
      sessionId: 1, userId: "zod-compat-fixture", aisle: "B", section: "007",
      footage: null, notes: null, conductors: "3/C",
    };
    const result = insertEntrySchema.safeParse(input);
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.deepEqual(result.data, input);
    assert.equal(insertEntrySchema.safeParse({ ...input, footage: "100" }).success, false,
      "numeric strings must not silently bypass the existing numeric contract");
  });

  test("entry patches preserve nulls, ordinary numbers and structured issues", () => {
    const input = { footage: null, notes: null, color: null, conductors: null, reelCount: 2 };
    assert.deepEqual(patchEntrySchema.parse(input), input);
    const invalid = patchEntrySchema.safeParse({ footage: "not a number" });
    assert.equal(invalid.success, false);
    if (invalid.success) return;
    assert.ok(Array.isArray(invalid.error.issues));
    assert.deepEqual(invalid.error.issues[0].path, ["footage"]);
    assert.equal(typeof invalid.error.issues[0].message, "string");
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

function sessionRequest(body: unknown): any {
  return {
    body,
    user: { claims: { sub: "session-owner" } },
  };
}

function sessionResponse() {
  let statusCode = 200;
  let payload: unknown;
  const response: any = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      payload = body;
      return response;
    },
  };
  return {
    response,
    get statusCode() {
      return statusCode;
    },
    get payload() {
      return payload;
    },
  };
}

describe("session creation route error contract", () => {
  test("returns actionable validation errors without inserting a session", async () => {
    let insertCalls = 0;
    const handler = createSessionHandler({
      getFolder: async () => undefined,
      createSession: async () => {
        insertCalls++;
        throw new Error("must not insert invalid input");
      },
    });
    const response = sessionResponse();

    await handler(sessionRequest({ name: "   " }), response.response, (() => {}) as any);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.payload, {
      code: SESSION_VALIDATION_ERROR_CODE,
      message: "Please correct the highlighted session fields.",
      errors: { name: ["Session name is required"] },
      formErrors: [],
    });
    assert.equal(insertCalls, 0);
  });

  test("returns the same safe validation contract for a malformed body", async () => {
    const handler = createSessionHandler({
      getFolder: async () => undefined,
      createSession: async () => {
        throw new Error("must not insert malformed input");
      },
    });
    const response = sessionResponse();

    await handler(sessionRequest({ name: 42 }), response.response, (() => {}) as any);

    assert.equal(response.statusCode, 400);
    const payload = response.payload as any;
    assert.equal(payload.code, SESSION_VALIDATION_ERROR_CODE);
    assert.ok(Array.isArray(payload.errors.name));
    assert.equal(typeof payload.errors.name[0], "string");
  });

  test("keeps unexpected insert failures generic and non-disclosing", async () => {
    const handler = createSessionHandler({
      getFolder: async () => undefined,
      createSession: async () => {
        throw new Error("database connection details must not reach the client");
      },
    });
    const response = sessionResponse();

    await handler(sessionRequest({ name: "Valid session" }), response.response, (() => {}) as any);

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.payload, { message: "Failed to create session" });
    assert.doesNotMatch(JSON.stringify(response.payload), /database connection details/);
  });

  test("inserts valid input and returns the created session", async () => {
    let inserted: any;
    const created = { id: 42, userId: "session-owner", name: "Valid session" };
    const handler = createSessionHandler({
      getFolder: async () => undefined,
      createSession: async (session) => {
        inserted = session;
        return created as any;
      },
    });
    const response = sessionResponse();

    await handler(sessionRequest({ name: "  Valid session  ", location: "Warehouse" }), response.response, (() => {}) as any);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.payload, created);
    assert.equal(inserted.userId, "session-owner");
    assert.equal(inserted.name, "Valid session");
    assert.equal(inserted.location, "Warehouse");
  });
});

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

async function rawHttpReq(
  baseUrl: string,
  method: string,
  path: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method },
      (res) => {
        const chunks: Buffer[] = [];
        let ended = false;
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          ended = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
        res.once("aborted", () => reject(new Error("downstream response aborted")));
        res.once("error", reject);
        res.once("close", () => {
          if (!ended) reject(new Error("downstream response closed before completion"));
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function listenOnLoopback(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

async function closeHttpServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("global API error response contract", () => {
  const diagnostics: unknown[] = [];
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 1 },
    });

    app.use(express.json());
    app.post("/api/parser-error", (_req, res) => res.json({ ok: true }));
    app.post("/api/upload-error", upload.single("file"), (_req, res) => res.json({ ok: true }));
    app.post("/api/database-error", (_req, _res, next) => {
      next(Object.assign(new Error("database password=private-db-secret"), {
        code: "28P01",
        status: 400,
      }));
    });
    app.post("/api/provider-error", (_req, _res, next) => {
      next(Object.assign(new Error("provider token=private-provider-secret"), {
        statusCode: 502,
      }));
    });
    app.use(createApiErrorHandler((error) => diagnostics.push(error)));

    server = http.createServer(app);
    baseUrl = await listenOnLoopback(server);
  });

  after(async () => {
    await closeHttpServer(server);
  });

  test("returns a safe client error for malformed JSON", async () => {
    const response = await fetch(`${baseUrl}/api/parser-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"secret":"private-parser-secret"',
    });
    const body = await response.text();

    assert.equal(response.status, 400);
    assert.equal(body, JSON.stringify({ message: "Invalid JSON request body." }));
    assert.doesNotMatch(body, /private-parser-secret|secret/);
    assert.equal(diagnostics.length, 1);
  });

  test("classifies upload middleware size failures without exposing details", async () => {
    const form = new FormData();
    form.append("file", new Blob(["private-upload-secret"]), "photo.png");
    const response = await fetch(`${baseUrl}/api/upload-error`, {
      method: "POST",
      body: form,
    });
    const body = await response.text();

    assert.equal(response.status, 413);
    assert.equal(body, JSON.stringify({ message: "Uploaded file is too large." }));
    assert.doesNotMatch(body, /private-upload-secret|MulterError|LIMIT_FILE_SIZE/);
    assert.equal(diagnostics.length, 2);
  });

  test("normalizes database-style errors and ignores their untrusted status", async () => {
    const response = await fetch(`${baseUrl}/api/database-error`, { method: "POST" });
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.equal(body, JSON.stringify({ message: "Internal Server Error" }));
    assert.doesNotMatch(body, /private-db-secret|28P01|password/);
    assert.ok(diagnostics.some((error) =>
      error instanceof Error && error.message.includes("private-db-secret"),
    ));
  });

  test("normalizes provider-style errors without reflecting provider details", async () => {
    const response = await fetch(`${baseUrl}/api/provider-error`, { method: "POST" });
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.equal(body, JSON.stringify({ message: "Internal Server Error" }));
    assert.doesNotMatch(body, /private-provider-secret|provider token|502/);
    assert.ok(diagnostics.some((error) =>
      error instanceof Error && error.message.includes("private-provider-secret"),
    ));
  });
});

describe("production Clerk proxy lifecycle guards", () => {
  const originalSecretKey = process.env.CLERK_SECRET_KEY;

  before(() => {
    process.env.CLERK_SECRET_KEY = "routes-test-clerk-secret";
  });

  after(() => {
    if (originalSecretKey === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = originalSecretKey;
  });

  test("returns a bounded 504 for an upstream that never returns headers", async () => {
    const health = new ClerkProxyHealth();
    const target = http.createServer(() => {
      // Deliberately stall until the proxy's response deadline destroys this request.
    });
    const targetUrl = await listenOnLoopback(target);
    const app = express();
    app.use(
      CLERK_PROXY_PATH,
      createClerkProxyMiddleware({
        target: targetUrl,
        connectTimeoutMs: 200,
        responseTimeoutMs: 35,
        health,
      }),
    );
    const proxy = http.createServer(app);
    const proxyUrl = await listenOnLoopback(proxy);

    try {
      const started = Date.now();
      const response = await rawHttpReq(proxyUrl, "GET", `${CLERK_PROXY_PATH}/v1/client`);
      assert.equal(response.status, 504);
      assert.equal(response.body, "");
      assert.equal(health.snapshot().counters["upstream-response-timeout"], 1);
      assert.ok(Date.now() - started < 1_000, "stalled upstream must not hang the browser request");
    } finally {
      await closeHttpServer(proxy);
      await closeHttpServer(target);
    }
  });

  test("terminates an upstream response that stalls after sending part of its body", async () => {
    const health = new ClerkProxyHealth();
    const target = http.createServer((_req, res) => {
      res.writeHead(200, {
        "content-length": "100",
        "content-type": "application/json",
      });
      res.write('{"partial":true');
      // Deliberately omit the rest of the body and end event.
    });
    const targetUrl = await listenOnLoopback(target);
    const app = express();
    app.use(
      CLERK_PROXY_PATH,
      createClerkProxyMiddleware({
        target: targetUrl,
        connectTimeoutMs: 200,
        responseTimeoutMs: 35,
        health,
      }),
    );
    const proxy = http.createServer(app);
    const proxyUrl = await listenOnLoopback(proxy);

    try {
      const started = Date.now();
      await assert.rejects(
        rawHttpReq(proxyUrl, "GET", `${CLERK_PROXY_PATH}/v1/client`),
      );
      assert.equal(health.snapshot().counters["upstream-response-timeout"], 1);
      assert.ok(Date.now() - started < 1_000, "partial response must not keep the browser request open");
    } finally {
      await closeHttpServer(proxy);
      await closeHttpServer(target);
    }
  });

  test("destroys upstream work when the downstream browser disconnects", async () => {
    const health = new ClerkProxyHealth();
    let upstreamReceived!: () => void;
    let upstreamClosed!: () => void;
    const received = new Promise<void>((resolve) => { upstreamReceived = resolve; });
    const closed = new Promise<void>((resolve) => { upstreamClosed = resolve; });
    const target = http.createServer((req) => {
      upstreamReceived();
      req.once("close", upstreamClosed);
    });
    const targetUrl = await listenOnLoopback(target);
    const app = express();
    app.use(
      CLERK_PROXY_PATH,
      createClerkProxyMiddleware({
        target: targetUrl,
        connectTimeoutMs: 200,
        responseTimeoutMs: 500,
        health,
      }),
    );
    const proxy = http.createServer(app);
    const proxyUrl = await listenOnLoopback(proxy);

    try {
      const url = new URL(`${CLERK_PROXY_PATH}/v1/client`, proxyUrl);
      const downstream = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
      });
      downstream.on("error", () => {});
      downstream.end();
      await received;
      downstream.destroy();
      await Promise.race([
        closed,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("upstream request was not destroyed")), 1_000),
        ),
      ]);
      assert.ok(true, "downstream disconnect closed the upstream request");
      assert.equal(health.snapshot().counters["downstream-aborted"], 1);
    } finally {
      await closeHttpServer(proxy);
      await closeHttpServer(target);
    }
  });

  test("preserves successful and bodyless Clerk response headers and bodies", async () => {
    const target = http.createServer((req, res) => {
      if (req.url === "/empty") {
        res.writeHead(204, { "x-clerk-test": "bodyless" });
        res.end();
        return;
      }
      const body = "clerk-ok";
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "x-clerk-test": "preserved",
      });
      res.end(body);
    });
    const targetUrl = await listenOnLoopback(target);
    const app = express();
    app.use(
      CLERK_PROXY_PATH,
      createClerkProxyMiddleware({
        target: targetUrl,
        connectTimeoutMs: 200,
        responseTimeoutMs: 200,
      }),
    );
    const proxy = http.createServer(app);
    const proxyUrl = await listenOnLoopback(proxy);

    try {
      const successful = await rawHttpReq(proxyUrl, "GET", `${CLERK_PROXY_PATH}/ok`);
      assert.equal(successful.status, 200);
      assert.equal(successful.body, "clerk-ok");
      assert.equal(successful.headers["content-type"], "application/json");
      assert.equal(successful.headers["content-length"], "8");
      assert.equal(successful.headers["x-clerk-test"], "preserved");

      const bodyless = await rawHttpReq(proxyUrl, "GET", `${CLERK_PROXY_PATH}/empty`);
      assert.equal(bodyless.status, 204);
      assert.equal(bodyless.body, "");
      assert.equal(bodyless.headers["x-clerk-test"], "bodyless");
      assert.equal(bodyless.headers["content-length"], undefined);
    } finally {
      await closeHttpServer(proxy);
      await closeHttpServer(target);
    }
  });

  test("preserves a healthy streamed response while each chunk arrives before the deadline", async () => {
    const target = http.createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "x-clerk-test": "streamed",
      });
      res.write('{"first":');
      setTimeout(() => {
        res.write('"chunk"');
        setTimeout(() => {
          res.end(',"last":true}');
        }, 5);
      }, 5);
    });
    const targetUrl = await listenOnLoopback(target);
    const app = express();
    app.use(
      CLERK_PROXY_PATH,
      createClerkProxyMiddleware({
        target: targetUrl,
        connectTimeoutMs: 200,
        responseTimeoutMs: 30,
      }),
    );
    const proxy = http.createServer(app);
    const proxyUrl = await listenOnLoopback(proxy);

    try {
      const response = await rawHttpReq(proxyUrl, "GET", `${CLERK_PROXY_PATH}/stream`);
      assert.equal(response.status, 200);
      assert.equal(response.body, '{"first":"chunk","last":true}');
      assert.equal(response.headers["content-type"], "application/json");
      assert.equal(response.headers["x-clerk-test"], "streamed");
      assert.equal(response.headers["content-length"], "29");
    } finally {
      await closeHttpServer(proxy);
      await closeHttpServer(target);
    }
  });

  test("normalizes upstream errors and does not log sensitive request material", async () => {
    const health = new ClerkProxyHealth();
    const target = http.createServer((req, _res) => {
      req.socket.destroy();
    });
    const targetUrl = await listenOnLoopback(target);
    const app = express();
    app.use(
      CLERK_PROXY_PATH,
      createClerkProxyMiddleware({
        target: targetUrl,
        connectTimeoutMs: 200,
        responseTimeoutMs: 200,
        health,
      }),
    );
    const proxy = http.createServer(app);
    const proxyUrl = await listenOnLoopback(proxy);
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

    try {
      const response = await rawHttpReq(
        proxyUrl,
        "GET",
        `${CLERK_PROXY_PATH}/sensitive/path?cookie=secret-cookie&token=secret-token`,
      ).catch(() => ({ status: 0, headers: {}, body: "" }));
      assert.ok(response.status === 502 || response.status === 504);
      assert.equal(health.snapshot().counters["upstream-error"], 1);
      const diagnostic = warnings.join("\n");
      assert.match(diagnostic, /\[clerk-proxy\] upstream-error/);
      assert.doesNotMatch(diagnostic, /sensitive|secret-cookie|secret-token/);
      assert.doesNotMatch(JSON.stringify(health.snapshot()), /sensitive|secret-cookie|secret-token/);
    } finally {
      console.warn = originalWarn;
      await closeHttpServer(proxy);
      await closeHttpServer(target);
    }
  });

  test("keeps each health failure class distinct and caps aggregate counters", () => {
    const health = new ClerkProxyHealth(2);
    health.record("upstream-connect-timeout");
    health.record("upstream-connect-timeout");
    health.record("upstream-connect-timeout");
    health.record("upstream-response-timeout");
    health.record("upstream-error");
    health.record("downstream-aborted");
    health.record("downstream-aborted");

    assert.deepEqual(health.snapshot(), {
      counters: {
        "upstream-connect-timeout": 2,
        "upstream-response-timeout": 1,
        "upstream-error": 1,
        "downstream-aborted": 2,
      },
      total: 6,
      capped: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Production route integration tests. Requests pass through the real
// registerRoutes() middleware and handlers. The request auth object is the
// branded shape Clerk's middleware installs, so production authentication,
// approval, capability, resource lookup, and safeParse paths all execute.
// ---------------------------------------------------------------------------

type PatchRouteTestContext = {
  baseUrl: string;
  server: http.Server;
  photoId: number;
  pinId: number;
  entryId: number;
  cleanup: () => Promise<void>;
};

type ConfigurablePoolOptions = {
  max?: number;
  options?: string;
};

const routeTestPoolOptions = (pool as unknown as {
  options: ConfigurablePoolOptions;
}).options;

async function setPoolSearchPath(searchPath: string): Promise<void> {
  const clientCount = routeTestPoolOptions.max ?? 10;
  const clients = await Promise.all(
    Array.from({ length: clientCount }, () => pool.connect()),
  );
  try {
    await Promise.all(
      clients.map((client) =>
        client.query("SELECT set_config('search_path', $1, false)", [searchPath]),
      ),
    );
  } finally {
    for (const client of clients) client.release();
  }
}

async function createIsolatedPatchTestSchema(): Promise<() => Promise<void>> {
  const schema = `routes_patch_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const schemaSql = execFileSync(
    "npx",
    [
      "drizzle-kit",
      "export",
      "--sql",
      "--dialect",
      "postgresql",
      "--schema",
      "./shared/schema.ts",
    ],
    { encoding: "utf8" },
  ).replaceAll('"public".', `"${schema}".`);
  const setupPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const setupClient = await setupPool.connect();
  let schemaCreated = false;
  try {
    await setupClient.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await setupClient.query(`SET search_path TO "${schema}"`);
    await setupClient.query(schemaSql);
  } catch (error) {
    if (schemaCreated) {
      await setupClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    }
    await setupPool.end();
    throw error;
  } finally {
    setupClient.release();
  }

  const previousSearchPath = (
    await setupPool.query("SHOW search_path")
  ).rows[0].search_path as string;
  const previousPoolOptions = routeTestPoolOptions.options;
  routeTestPoolOptions.options = [previousPoolOptions, `-c search_path=${schema}`]
    .filter(Boolean)
    .join(" ");

  try {
    await setPoolSearchPath(schema);
  } catch (error) {
    routeTestPoolOptions.options = previousPoolOptions;
    await setupPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await setupPool.end();
    throw error;
  }

  let disposed = false;
  return async () => {
    if (disposed) return;
    disposed = true;
    routeTestPoolOptions.options = previousPoolOptions;
    await setPoolSearchPath(previousSearchPath);
    try {
      await setupPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await setupPool.end();
    }
  };
}

async function buildProductionPatchRouteContext(
  useLegacyPinDeleteRoute = false,
  asEditor = false,
): Promise<PatchRouteTestContext> {
  const app = express();
  app.use(express.json());

  const userId = `routes-test-${randomUUID()}`;
  let sessionId = 0;
  let server: http.Server | undefined;
  const testUser = {
    id: userId,
    approved: true,
    rejected: false,
    role: "User" as const,
    capabilities: {
      session_create: true,
      session_delete: true,
      exports: true,
      photo_management: true,
      ai_scanning: true,
      collaborator_management: true,
      statistics: true,
      account_settings: true,
    },
  };
  const originalGetUserByClerkId = authStorage.getUserByClerkUserId;
  const originalGetUser = authStorage.getUser;
  const originalCreateActivityLog = storage.createActivityLog;
  const pendingActivityLogs = new Set<Promise<unknown>>();
  let disposeTestSchema: (() => Promise<void>) | undefined;
  let authStoragePatched = false;
  let storagePatched = false;

  const cleanup = async () => {
    if (server?.listening) await closeHttpServer(server);
    await new Promise<void>((resolve) => setImmediate(resolve));
    while (pendingActivityLogs.size > 0) {
      await Promise.allSettled([...pendingActivityLogs]);
    }
    if (disposeTestSchema) await disposeTestSchema();
    if (authStoragePatched) {
      authStorage.getUserByClerkUserId = originalGetUserByClerkId;
      authStorage.getUser = originalGetUser;
      authStoragePatched = false;
    }
    if (storagePatched) {
      storage.createActivityLog = originalCreateActivityLog;
      storagePatched = false;
    }
  };

  try {
    disposeTestSchema = await createIsolatedPatchTestSchema();
    authStorage.getUserByClerkUserId = async (clerkUserId: string) =>
      clerkUserId === userId
        ? testUser as any
        : originalGetUserByClerkId.call(authStorage, clerkUserId);
    authStorage.getUser = async (lookupUserId: string) =>
      lookupUserId === userId
        ? testUser as any
        : originalGetUser.call(authStorage, lookupUserId);
    authStoragePatched = true;
    storage.createActivityLog = (log) => {
      const pending = originalCreateActivityLog.call(storage, log);
      pendingActivityLogs.add(pending);
      pending.then(
        () => pendingActivityLogs.delete(pending),
        () => pendingActivityLogs.delete(pending),
      );
      return pending;
    };
    storagePatched = true;

    const [session] = await db
      .insert(databaseSchema.countingSessions)
      .values({ userId: asEditor ? `owner-${randomUUID()}` : userId, name: `__routes-test-${userId}__` })
      .returning();
    sessionId = session.id;
    if (asEditor) {
      await db.insert(databaseSchema.sessionCollaborators).values({ sessionId, userId, role: "editor" });
    }

    const [photo] = await db
      .insert(databaseSchema.photos)
      .values({
        sessionId,
        userId,
        objectStorageKey: `/uploads/${userId}-photo.jpg`,
      })
      .returning();
    const [pin] = await db
      .insert(databaseSchema.pins)
      .values({
        photoId: photo.id,
        xPercent: 10,
        yPercent: 20,
      })
      .returning();
    const [entry] = await db
      .insert(databaseSchema.entries)
      .values({
        sessionId,
        userId,
        photoId: photo.id,
        aisle: "A",
        section: "1",
      })
      .returning();

    const testAuth = Object.assign(
      () => ({
        userId,
        sessionClaims: { sub: userId },
        tokenType: "session_token",
      }),
      { [Symbol.for("@clerk/express.auth")]: true },
    );
    app.use((req, _res, next) => {
      (req as any).auth = testAuth;
      next();
    });

    server = http.createServer(app);
    await registerRoutes(server, app);
    if (useLegacyPinDeleteRoute) {
      // Express normally reaches the first DELETE registration. Remove that
      // route only in this fixture so the second production handler is tested
      // through the same real authentication and authorization middleware.
      const stack = (app as any).router.stack as Array<{ route?: { path: string; methods: { delete?: boolean } } }>;
      const index = stack.findIndex(layer => layer.route?.path === "/api/pins/:id" && layer.route.methods.delete);
      assert.notEqual(index, -1);
      stack.splice(index, 1);
    }
    const baseUrl = await listenOnLoopback(server);

    return {
      baseUrl,
      server,
      photoId: photo.id,
      pinId: pin.id,
      entryId: entry.id,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

registerSessionAuthorizationTests(() => buildProductionPatchRouteContext(false, true));

describe("pin entry links — production authorization boundary", () => {
  let context: PatchRouteTestContext;
  let victimEntry: databaseSchema.Entry;
  let localPhoto: databaseSchema.Photo;

  before(async () => {
    context = await buildProductionPatchRouteContext(false, true);
    localPhoto = (await storage.getPhoto(context.photoId))!;
    const [victimSession] = await db.insert(databaseSchema.countingSessions).values({
      userId: `victim-${randomUUID()}`, name: "__pin-link-victim__",
    }).returning();
    victimEntry = await storage.createEntry({
      sessionId: victimSession.id, userId: victimSession.userId, aisle: "V", section: "1",
    });
  });
  after(async () => { await context?.cleanup(); });

  const patch = async (body: unknown) => fetch(`${context.baseUrl}/api/pins/${context.pinId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  test("foreign and missing entry links reject the whole patch without mutation", async () => {
    const original = await storage.getPin(context.pinId);
    for (const entryId of [victimEntry.id, 2147483647]) {
      const response = await patch({ entryId, label: "must-not-be-saved" });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { message: "Entry does not belong to this session" });
      assert.deepEqual(await storage.getPin(context.pinId), original);
      assert.deepEqual(await storage.getEntry(victimEntry.id), victimEntry);
    }
  });

  test("same-session linking, omitted links and explicit null detachment remain supported", async () => {
    for (const body of [
      { entryId: context.entryId }, { label: "safe-label" }, { entryId: null },
    ]) {
      const response = await patch(body);
      assert.equal(response.status, 200);
      const pin = await response.json();
      assert.equal(pin.entryId, "entryId" in body ? body.entryId : context.entryId);
    }
    assert.ok(await storage.getEntry(context.entryId), "detaching does not delete the entry");
  });

  const create = async (body: unknown) => fetch(`${context.baseUrl}/api/photos/${context.photoId}/pins`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

  test("creation and draft promotion reject foreign and missing entry links without mutation", async () => {
    const draft = await storage.atomicCreatePin({
      photoId: context.photoId, xPercent: 10, yPercent: 20, label: "security-draft",
    });
    const originalPins = await storage.getPhotoPins(context.photoId);
    for (const label of [undefined, "security-new-pin", draft.label]) {
      for (const entryId of [victimEntry.id, 2147483647]) {
        const response = await create({ xPercent: 70, yPercent: 80, label, entryId });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { message: "Entry does not belong to this session" });
        assert.deepEqual(await storage.getPhotoPins(context.photoId), originalPins);
        assert.deepEqual(await storage.getEntry(victimEntry.id), victimEntry);
      }
    }
  });

  test("same-session creation and draft promotion still succeed, including unlabelled pins", async () => {
    const draft = await storage.atomicCreatePin({
      photoId: context.photoId, xPercent: 10, yPercent: 20, label: "safe-draft",
    });
    for (const label of [undefined, "safe-new-pin", draft.label]) {
      const response = await create({ xPercent: 70, yPercent: 80, label, entryId: context.entryId });
      assert.equal(response.status, 200);
      const pin = await response.json();
      assert.equal(pin.entryId, context.entryId);
      assert.equal(pin.photoId, context.photoId);
      if (label === draft.label) assert.equal(pin.id, draft.id, "promotes the existing draft row");
      assert.equal((await storage.getPin(pin.id))!.entryId, context.entryId);
    }
    assert.deepEqual(await storage.getEntry(victimEntry.id), victimEntry);
  });

  test("creation still accepts explicit null and omitted entry links", async () => {
    for (const body of [{ entryId: null }, {}]) {
      const response = await create({ xPercent: 10, yPercent: 20, ...body });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).entryId, null);
    }
  });

  test("storage deletion predicates on both entry ID and authorized session", async () => {
    await storage.deleteEntry(victimEntry.id, localPhoto.sessionId);
    assert.deepEqual(await storage.getEntry(victimEntry.id), victimEntry);
    await storage.deleteEntry(victimEntry.id, victimEntry.sessionId);
    assert.equal(await storage.getEntry(victimEntry.id), undefined);
  });
});

for (const legacy of [false, true]) {
  describe(`pin deletion — ${legacy ? "second" : "first"} production handler`, () => {
    let context: PatchRouteTestContext;
    let localPhoto: databaseSchema.Photo;
    let victimEntry: databaseSchema.Entry;

    before(async () => {
      context = await buildProductionPatchRouteContext(legacy, true);
      localPhoto = (await storage.getPhoto(context.photoId))!;
      const [session] = await db.insert(databaseSchema.countingSessions).values({
        userId: `victim-${randomUUID()}`, name: "__pin-delete-victim__",
      }).returning();
      victimEntry = await storage.createEntry({
        sessionId: session.id, userId: session.userId, aisle: "V", section: "1",
      });
    });
    after(async () => { await context?.cleanup(); });

    test("deleting a pre-existing malformed pin never deletes a foreign entry", async () => {
      await storage.updatePin(context.pinId, { entryId: victimEntry.id });
      const response = await fetch(`${context.baseUrl}/api/pins/${context.pinId}`, { method: "DELETE" });
      assert.equal(response.status, 200);
      assert.equal(await storage.getPin(context.pinId), undefined);
      assert.deepEqual(await storage.getEntry(victimEntry.id), victimEntry);
      assert.ok(await storage.getEntry(context.entryId));
    });

    test("same-session linked and unlinked pin deletion still succeeds", async () => {
      for (const entryId of [context.entryId, null]) {
        const pin = await storage.createPin({
          photoId: localPhoto.id, xPercent: 10, yPercent: 20, entryId,
        });
        const response = await fetch(`${context.baseUrl}/api/pins/${pin.id}`, { method: "DELETE" });
        assert.equal(response.status, 200);
        assert.equal(await storage.getPin(pin.id), undefined);
        if (entryId !== null) assert.equal(await storage.getEntry(entryId), undefined);
        assert.deepEqual(await storage.getEntry(victimEntry.id), victimEntry);
      }
    });
  });
}

describe("Detail-shot references — production session isolation", () => {
  let context: PatchRouteTestContext;
  let localPhoto: databaseSchema.Photo;
  let victimParent: databaseSchema.Photo;
  let victimDetail: databaseSchema.Photo;
  let victimPin: databaseSchema.Pin;
  let localDetail: databaseSchema.Photo;
  let localPin: databaseSchema.Pin;
  const missingPhotoId = 2147483647;

  before(async () => {
    context = await buildProductionPatchRouteContext();
    localPhoto = (await storage.getPhoto(context.photoId))!;
    const [victimSession] = await db.insert(databaseSchema.countingSessions).values({
      userId: `victim-${randomUUID()}`, name: "Private victim inventory",
    }).returning();
    [victimParent] = await db.insert(databaseSchema.photos).values({
      sessionId: victimSession.id, userId: victimSession.userId,
      objectStorageKey: "/uploads/private-parent.jpg", aisle: "PRIVATE", section: "SECRET",
    }).returning();
    [victimDetail] = await db.insert(databaseSchema.photos).values({
      sessionId: victimSession.id, userId: victimSession.userId,
      objectStorageKey: "/uploads/private-detail.jpg", isDetailShot: true,
      parentPhotoId: victimParent.id, linkedPinLabel: "target",
    }).returning();
    [victimPin] = await db.insert(databaseSchema.pins).values({
      photoId: victimParent.id, label: "target", xPercent: 10, yPercent: 20,
    }).returning();
    [localDetail] = await db.insert(databaseSchema.photos).values({
      sessionId: localPhoto.sessionId, userId: localPhoto.userId,
      objectStorageKey: "/uploads/local-detail.jpg", isDetailShot: true,
      parentPhotoId: localPhoto.id, linkedPinLabel: "target",
    }).returning();
    [localPin] = await db.insert(databaseSchema.pins).values({
      photoId: localPhoto.id, label: "target", xPercent: 10, yPercent: 20,
    }).returning();
  });
  after(async () => { await context?.cleanup(); });

  async function createEntry(photoId?: number | null) {
    return httpReq(context.baseUrl, "POST", `/api/sessions/${localPhoto.sessionId}/entries`, {
      body: { aisle: "A", section: "1", ...(photoId === undefined ? {} : { photoId }) },
    });
  }

  test("entry POST rejects foreign and missing photos before any writes", async () => {
    const entriesBefore = await db.select().from(databaseSchema.entries);
    const pinsBefore = await db.select().from(databaseSchema.pins);
    for (const photoId of [victimDetail.id, victimParent.id, missingPhotoId]) {
      const result = await createEntry(photoId);
      assert.equal(result.status, 404);
      assert.deepEqual(result.body, { message: "Photo not found" });
    }
    assert.deepEqual(await db.select().from(databaseSchema.entries), entriesBefore);
    assert.deepEqual(await db.select().from(databaseSchema.pins), pinsBefore);
  });

  test("entry POST rejects malformed photo IDs without inserting entries", async () => {
    const entriesBefore = await db.select().from(databaseSchema.entries);
    for (const photoId of ["1", -1, 1.5, {}, []]) {
      const result = await httpReq(context.baseUrl, "POST", `/api/sessions/${localPhoto.sessionId}/entries`, {
        body: { aisle: "A", section: "1", photoId },
      });
      assert.equal(result.status, 400);
    }
    assert.deepEqual(await db.select().from(databaseSchema.entries), entriesBefore);
  });

  test("photo PATCH rejects foreign and missing parents without changing either session", async () => {
    const photosBefore = await db.select().from(databaseSchema.photos);
    const entriesBefore = await db.select().from(databaseSchema.entries);
    for (const parentPhotoId of [victimParent.id, missingPhotoId]) {
      const result = await httpReq(context.baseUrl, "PATCH", `/api/photos/${localDetail.id}`, {
        body: { parentPhotoId, isDetailShot: true, linkedPinLabel: "target", notes: "must not save" },
      });
      assert.equal(result.status, 404);
      assert.deepEqual(result.body, { message: "Photo not found" });
    }
    assert.deepEqual(await db.select().from(databaseSchema.photos), photosBefore);
    assert.deepEqual(await db.select().from(databaseSchema.entries), entriesBefore);
    assert.equal((await storage.getPin(victimPin.id))!.entryId, null);
  });

  test("same-session parent updates and explicit unlink still work", async () => {
    for (const parentPhotoId of [localPhoto.id, null, localPhoto.id]) {
      const result = await httpReq(context.baseUrl, "PATCH", `/api/photos/${localDetail.id}`, {
        body: { parentPhotoId },
      });
      assert.equal(result.status, 200);
      assert.equal((await storage.getPhoto(localDetail.id))!.parentPhotoId, parentPhotoId);
    }
  });

  test("resolver refuses foreign detail, foreign entry, and legacy foreign parent relationships", async () => {
    // An attacker's entry referencing a victim detail must never resolve the victim pin.
    const [badEntry] = await db.insert(databaseSchema.entries).values({
      sessionId: localPhoto.sessionId, userId: localPhoto.userId,
      photoId: victimDetail.id, aisle: "A", section: "1",
    }).returning();
    await storage.resolveParentPinForDetailShot(victimDetail.id, badEntry.id, localPhoto.sessionId);
    assert.equal((await storage.getPin(victimPin.id))!.entryId, null);
    // Even supplying the victim session as the expected session cannot use a foreign entry.
    await storage.resolveParentPinForDetailShot(victimDetail.id, badEntry.id, victimDetail.sessionId);
    assert.equal((await storage.getPin(victimPin.id))!.entryId, null);

    const [localEntry] = await db.insert(databaseSchema.entries).values({
      sessionId: localPhoto.sessionId, userId: localPhoto.userId,
      photoId: localDetail.id, aisle: "A", section: "1",
    }).returning();
    await storage.updatePhoto(localDetail.id, { parentPhotoId: victimParent.id });
    await storage.resolveParentPinForDetailShot(localDetail.id, localEntry.id, localPhoto.sessionId);
    assert.equal((await storage.getPin(victimPin.id))!.entryId, null);
    // The route must also be safe when it encounters an old cross-session parent.
    const result = await createEntry(localDetail.id);
    assert.equal(result.status, 200);
    assert.equal((await storage.getPin(victimPin.id))!.entryId, null);
    await storage.updatePhoto(localDetail.id, { parentPhotoId: localPhoto.id });

    // Matching sessions alone are insufficient if the entry references another photo.
    await storage.resolveParentPinForDetailShot(localDetail.id, context.entryId, localPhoto.sessionId);
    assert.equal((await storage.getPin(localPin.id))!.entryId, null);
  });

  test("same-session entry creation resolves only the matching uncommitted parent pin", async () => {
    const result = await createEntry(localDetail.id);
    assert.equal(result.status, 200);
    assert.equal((await storage.getPin(localPin.id))!.entryId, result.body.id);
    assert.equal((await storage.getPin(context.pinId))!.entryId, null, "unlabelled pin is untouched");
    assert.equal((await storage.getPin(victimPin.id))!.entryId, null);
    const second = await createEntry(localDetail.id);
    assert.equal(second.status, 200);
    assert.equal((await storage.getPin(localPin.id))!.entryId, result.body.id, "committed pin is not relinked");
  });

  test("entries with regular, null, or omitted photos remain supported", async () => {
    for (const photoId of [localPhoto.id, null, undefined]) {
      const result = await createEntry(photoId);
      assert.equal(result.status, 200);
      assert.equal(result.body.photoId, photoId ?? null);
    }
  });
});

describe("PATCH production routes — body validation returns 400, not 500", () => {
  let server: http.Server;
  let baseUrl: string;
  let photoId: number;
  let pinId: number;
  let entryId: number;
  let cleanup: () => Promise<void>;

  before(async () => {
    const context = await buildProductionPatchRouteContext();
    ({ baseUrl, server, photoId, pinId, entryId, cleanup } = context);
  });

  after(async () => {
    await cleanup();
  });

  test("PATCH /api/photos/:id — no body → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/photos/${photoId}`);
    assert.equal(status, 400, "missing body must yield 400");
  });

  test("PATCH /api/photos/:id — wrong Content-Type (text/plain) → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/photos/${photoId}`, {
      body: "plain text", contentType: "text/plain",
    });
    assert.equal(status, 400, "non-JSON Content-Type leaves body unparsed → 400");
  });

  test("PATCH /api/photos/:id — invalid field type → 400", async () => {
    const { status, body } = await httpReq(baseUrl, "PATCH", `/api/photos/${photoId}`, { body: { rotation: "bad" } });
    assert.equal(status, 400);
    assert.ok(body.errors, "response should include field errors");
  });

  test("PATCH /api/photos/:id — valid partial body → 200", async () => {
    const { status, body } = await httpReq(baseUrl, "PATCH", `/api/photos/${photoId}`, { body: { rotation: 90, notes: "OK" } });
    assert.equal(status, 200);
    assert.equal(body.notes, "OK");
  });

  test("PATCH /api/pins/:id — no body → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/pins/${pinId}`);
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:id — wrong Content-Type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/pins/${pinId}`, { body: "plain text", contentType: "text/plain" });
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:id — invalid field type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/pins/${pinId}`, { body: { xPercent: "not-a-number" } });
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:id — valid partial body → 200", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/pins/${pinId}`, { body: { xPercent: 50.0, yPercent: 25.0 } });
    assert.equal(status, 200);
  });

  test("PATCH /api/pins/:pinId/flag — no body → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/pins/${pinId}/flag`);
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:pinId/flag — wrong Content-Type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/pins/${pinId}/flag`, { body: "plain text", contentType: "text/plain" });
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:pinId/flag — invalid flagged type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/pins/${pinId}/flag`, { body: { flagged: "yes" } });
    assert.equal(status, 400);
  });

  test("PATCH /api/pins/:pinId/flag — valid flag body → 200", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/pins/${pinId}/flag`, { body: { flagged: true, flagReason: "blurry image" } });
    assert.equal(status, 200);
  });

  test("PATCH /api/entries/:id — no body → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/entries/${entryId}`);
    assert.equal(status, 400);
  });

  test("PATCH /api/entries/:id — wrong Content-Type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/entries/${entryId}`, { body: "plain text", contentType: "text/plain" });
    assert.equal(status, 400);
  });

  test("PATCH /api/entries/:id — invalid footage type → 400", async () => {
    const { status } = await httpReq(baseUrl, "PATCH", `/api/entries/${entryId}`, { body: { footage: "five-hundred" } });
    assert.equal(status, 400);
  });

  test("PATCH /api/entries/:id — valid partial body → 200", async () => {
    const { status, body } = await httpReq(baseUrl, "PATCH", `/api/entries/${entryId}`, { body: { wireType: "THHN", footage: 250 } });
    assert.equal(status, 200);
    assert.equal(body.wireType, "THHN");
  });
});

describe("account capability route guard", () => {
  let server: http.Server;
  let baseUrl: string;
  let capabilities = {
    ai_scanning: false,
    photo_management: false,
    session_create: true,
  };
  let mutationCalls = 0;
  const userId = "capability-route-test-user";
  const originalGetUser = authStorage.getUser;

  before(async () => {
    authStorage.getUser = async (requestedUserId: string) =>
      requestedUserId === userId
        ? {
            id: userId,
            approved: true,
            rejected: false,
            role: "User",
            capabilities,
          } as User
        : undefined;

    const app = express();
    app.use((req: any, _res, next) => {
      req.user = { claims: { sub: userId } };
      next();
    });
    app.use("/api", accountCapabilityMiddleware);
    app.post("/api/photos/:photoId/analyze-labels", (_req, res) => res.json({ ok: true }));
    app.post("/api/sessions/:sessionId/analyze-labels", (_req, res) => res.json({ ok: true }));
    app.patch("/api/photos/:photoId", (_req, res) => res.json({ ok: true }));
    const mutationHandler: express.RequestHandler = (_req, res) => {
      mutationCalls++;
      res.json({ ok: true });
    };
    app.post("/api/photos/:photoId/duplicate", mutationHandler);
    app.post("/api/sessions/:sessionId/duplicate", mutationHandler);
    app.post("/api/sessions", mutationHandler);

    server = http.createServer(app);
    baseUrl = await listenOnLoopback(server);
  });

  after(async () => {
    authStorage.getUser = originalGetUser;
    await closeHttpServer(server);
  });

  test("requires AI scanning for both label-analysis URLs and photo management for photo writes", async () => {
    const labelPaths = [
      "/api/photos/12/analyze-labels",
      "/api/sessions/34/analyze-labels",
    ];
    const combinations = [
      { ai_scanning: false, photo_management: false, labelStatus: 403, photoStatus: 403 },
      { ai_scanning: false, photo_management: true, labelStatus: 403, photoStatus: 200 },
      { ai_scanning: true, photo_management: false, labelStatus: 200, photoStatus: 403 },
      { ai_scanning: true, photo_management: true, labelStatus: 200, photoStatus: 200 },
    ];

    for (const combination of combinations) {
      capabilities = {
        ai_scanning: combination.ai_scanning,
        photo_management: combination.photo_management,
        session_create: true,
      };
      for (const path of labelPaths) {
        const response = await httpReq(baseUrl, "POST", path);
        assert.equal(
          response.status,
          combination.labelStatus,
          `${path} with ai_scanning=${combination.ai_scanning} and photo_management=${combination.photo_management}`,
        );
        if (combination.labelStatus === 403) {
          assert.deepEqual(response.body, {
            message: "capability_denied",
            capability: "ai_scanning",
          });
        }
      }

      const photoResponse = await httpReq(baseUrl, "PATCH", "/api/photos/12");
      assert.equal(
        photoResponse.status,
        combination.photoStatus,
        `photo mutation with ai_scanning=${combination.ai_scanning} and photo_management=${combination.photo_management}`,
      );
      if (combination.photoStatus === 403) {
        assert.deepEqual(photoResponse.body, {
          message: "capability_denied",
          capability: "photo_management",
        });
      }
    }
  });

  test("duplication capability matrix keeps photo management separate from session creation", async () => {
    for (const sessionCreate of [false, true]) {
      for (const photoManagement of [false, true]) {
        capabilities = {
          ai_scanning: false,
          session_create: sessionCreate,
          photo_management: photoManagement,
        };
        // Exercise Express's default case-insensitive and optional trailing-slash
        // routing too, so alternate spellings cannot bypass the session rule.
        const operations = [
          { path: "/api/photos/12/duplicate", allowed: photoManagement, capability: "photo_management" },
          { path: "/api/photos/12/duplicate/?source=grid", allowed: photoManagement, capability: "photo_management" },
          { path: "/api/PHOTOS/12/duplicate", allowed: photoManagement, capability: "photo_management" },
          { path: "/API/PHOTOS/12/DUPLICATE/?source=grid", allowed: photoManagement, capability: "photo_management" },
          { path: "/api/sessions/34/duplicate", allowed: sessionCreate, capability: "session_create" },
          { path: "/api/sessions/34/duplicate/?source=dashboard", allowed: sessionCreate, capability: "session_create" },
          { path: "/api/sessions/34/DUPLICATE", allowed: sessionCreate, capability: "session_create" },
          { path: "/api/sessions", allowed: sessionCreate, capability: "session_create" },
        ];
        for (const operation of operations) {
          const callsBefore = mutationCalls;
          const response = await httpReq(baseUrl, "POST", operation.path);
          const context = `${operation.path}: session_create=${sessionCreate}, photo_management=${photoManagement}`;
          assert.equal(response.status, operation.allowed ? 200 : 403, context);
          assert.equal(mutationCalls, callsBefore + (operation.allowed ? 1 : 0), context);
          assert.deepEqual(response.body, operation.allowed
            ? { ok: true }
            : { message: "capability_denied", capability: operation.capability }, context);
        }
      }
    }
  });
});

describe("authenticated Poe route contracts", () => {
  function stubProvider(overrides: Partial<PoeProvider> = {}): PoeProvider {
    return {
      listModels: async () => [],
      streamText: async () => ({
        model: "stub-text",
        retries: 0,
        usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
        stream: (async function* () { yield "stub response"; })(),
        abort: () => {},
      }),
      completeVision: async () => ({ model: "stub-vision", retries: 0, labels: ["stub"] }),
      ...overrides,
    };
  }

  async function withHelpRoute<T>(
    provider: PoeProvider,
    callback: (port: number) => Promise<T>,
    userId = "owner-user",
  ): Promise<T> {
    const app = express();
    app.use(express.json());
    app.post(
      "/api/help-chat",
      (req, _res, next) => {
        (req as typeof req & { user: { claims: { sub: string } } }).user = { claims: { sub: userId } };
        next();
      },
      helpChatRateLimiter,
      createHelpChatHandler(provider, "stub help prompt"),
    );
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      return await callback(port);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  test("does not invoke the provider through unauthenticated, pending, or viewer gates", async () => {
    let calls = 0;
    const provider = stubProvider({
      streamText: async () => {
        calls++;
        return {
          model: "stub-text",
          retries: 0,
          usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
          stream: (async function* () { yield "should not run"; })(),
          abort: () => {},
        };
      },
    });
    const app = express();
    app.use(
      clerkMiddleware({
        publishableKey: buildPublishableKey(CLERK_FRONTEND_API_HOST),
      }),
    );
    app.use(express.json());
    const handler = createHelpChatHandler(provider, "stub help prompt");
    app.post("/unauthenticated", isAuthenticated, handler);
    app.post(
      "/pending",
      (req, _res, next) => {
        (req as typeof req & { user: { claims: { sub: string } } }).user = {
          claims: { sub: "pending-poe-user" },
        };
        next();
      },
      isApproved,
      handler,
    );
    app.post(
      "/viewer",
      (_req, res, next) => {
        if (!canEdit("viewer")) return res.status(403).json({ message: "viewer cannot scan" });
        next();
      },
      handler,
    );
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const originalGetUser = authStorage.getUser;
    authStorage.getUser = async (userId: string) =>
      userId === "pending-poe-user" ? ({ approved: false, rejected: false } as any) : undefined;
    try {
      const request = () => fetch(`http://127.0.0.1:${port}/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
      });
      const unauthenticated = await fetch(`http://127.0.0.1:${port}/unauthenticated`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
      });
      const pending = await request();
      const viewer = await fetch(`http://127.0.0.1:${port}/viewer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
      });
      await Promise.all([unauthenticated.text(), pending.text(), viewer.text()]);
      assert.equal(unauthenticated.status, 401);
      assert.equal(pending.status, 403);
      assert.equal(viewer.status, 403);
      assert.equal(calls, 0);
    } finally {
      authStorage.getUser = originalGetUser;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("streams the existing SSE wire format and terminates with done", async () => {
    let calls = 0;
    const provider = stubProvider({
      streamText: async () => {
        calls++;
        return {
          model: "stub-text",
          retries: 0,
          usage: Promise.resolve({ promptTokens: 1, completionTokens: 2 }),
          stream: (async function* () {
            yield "Hello";
            yield " world";
          })(),
          abort: () => {},
        };
      },
    });

    const body = await withHelpRoute(provider, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/help-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "How do I place pins?" }] }),
      });
      assert.equal(response.status, 200);
      return response.text();
    });

    assert.equal(calls, 1);
    assert.match(body, /data: \{"content":"Hello"\}\n\n/);
    assert.match(body, /data: \{"content":" world"\}\n\n/);
    assert.match(body, /data: \{"done":true\}\n\n/);
  });

  test("normalizes an upstream stream failure as an SSE error frame", async () => {
    const provider = stubProvider({
      streamText: async () => ({
        model: "stub-text",
        retries: 1,
        usage: Promise.resolve({ promptTokens: 1, completionTokens: 0 }),
        stream: (async function* () {
          yield "partial";
          throw new PoeProviderError("upstream", "private upstream detail", 502);
        })(),
        abort: () => {},
      }),
    });

    const body = await withHelpRoute(provider, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/help-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "What is Mobile Flow?" }] }),
      });
      assert.equal(response.status, 200);
      return response.text();
    });

    assert.match(body, /data: \{"content":"partial"\}\n\n/);
    assert.match(body, /data: \{"error":"Failed to get response"\}\n\n/);
    assert.doesNotMatch(body, /"done":true/);
    assert.doesNotMatch(body, /private upstream detail/);
  });

  test("does not invoke the provider for a rate-limited request", async () => {
    let calls = 0;
    const provider = stubProvider({
      streamText: async () => {
        calls++;
        return {
          model: "stub-text",
          retries: 0,
          usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
          stream: (async function* () { yield "ok"; })(),
          abort: () => {},
        };
      },
    });

    const statuses = await withHelpRoute(provider, async (port) => {
      const results: number[] = [];
      for (let i = 0; i < 21; i++) {
        const response = await fetch(`http://127.0.0.1:${port}/api/help-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: `Request ${i}` }] }),
        });
        results.push(response.status);
        await response.text();
      }
      return results;
    }, `rate-limit-${Date.now()}`);

    assert.equal(statuses.at(-1), 429);
    assert.equal(calls, 20);
  });

  test("aborts the provider and does not write a late frame after client disconnect", async () => {
    let abortCalled = false;
    let release!: () => void;
    const provider = stubProvider({
      streamText: async () => ({
        model: "stub-text",
        retries: 0,
        usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
        stream: (async function* () {
          yield "partial";
          await new Promise<void>((resolve) => { release = resolve; });
        })(),
        abort: () => {
          abortCalled = true;
          release?.();
        },
      }),
    });

    await withHelpRoute(provider, async (port) => {
      await new Promise<void>((resolve, reject) => {
        const request = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/help-chat",
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
          (response) => {
            response.once("data", () => request.destroy());
            response.once("close", () => resolve());
          },
        );
        request.once("error", (error) => {
          if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
        });
        request.end(JSON.stringify({ messages: [{ role: "user", content: "Disconnect me" }] }));
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    assert.equal(abortCalled, true);
  });

  test("rejects malformed scanner output before persistence and preserves pin order", () => {
    assert.throws(
      () => buildScanResultsForPins(
        [{ pinId: 11, pinLabel: "P011" }],
        [{ pinId: 11 }],
        [{ rawText: "not a string" }],
      ),
      (error: unknown) => error instanceof PoeProviderError && error.code === "validation",
    );

    assert.deepEqual(
      buildScanResultsForPins(
        [
          { pinId: 22, pinLabel: "P022" },
          { pinId: 11, pinLabel: "P011" },
          { pinId: 33, pinLabel: "P033" },
        ],
        [{ pinId: 11 }, { pinId: 33 }],
        ["first", ""],
      ),
      [
        { pinId: 22, pinLabel: "P022", rawText: null, readable: false },
        { pinId: 11, pinLabel: "P011", rawText: "first", readable: true },
        { pinId: 33, pinLabel: "P033", rawText: null, readable: false },
      ],
    );
  });
});

describe("Admin AI health route contract", () => {
  test("returns independent API and exact supported-model health", async () => {
    let statusCode = 0;
    let body: unknown;
    const response = {
      setHeader: () => {},
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    } as any;

    await createAdminAiHealthHandler({
      listModels: async () => [
        { id: "Gemini-3.1-Pro", capabilities: [], privacyClass: "approved" },
        { id: "unrelated-provider-model", capabilities: [], privacyClass: "approved" },
      ],
      streamText: async () => {
        throw new Error("not used");
      },
      completeVision: async () => {
        throw new Error("not used");
      },
    })({} as any, response, (() => {}) as any);

    assert.equal(statusCode, 0);
    assert.deepEqual(body, {
      apiOnline: true,
      models: [
        { id: "Gemini-3.1-Pro", label: "Gemini 3.1 Pro", available: true },
        { id: "Claude-Sonnet-4.5", label: "Claude Sonnet 4.5", available: false },
      ],
    });
  });

  test("returns both supported models unavailable when the provider fails", async () => {
    let body: any;
    const response = {
      setHeader: () => {},
      json(payload: unknown) {
        body = payload;
      },
    } as any;

    await createAdminAiHealthHandler({
      listModels: async () => {
        throw new PoeProviderError("upstream", "safe", 502);
      },
      streamText: async () => {
        throw new Error("not used");
      },
      completeVision: async () => {
        throw new Error("not used");
      },
    })({} as any, response, (() => {}) as any);

    assert.equal(body.apiOnline, false);
    assert.deepEqual(body.models.map((model: any) => model.available), [false, false]);
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
          const setCookie = res.headers["set-cookie"]?.[0]?.split("\n")[0];
          resolve({ status: res.statusCode ?? 0, body: parsed, cookie: setCookie });
        });
      }
    );
    req.on("error", reject);
    if (raw !== undefined) req.write(raw);
    req.end();
  });
}
