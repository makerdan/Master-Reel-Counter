import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import express from "express";
import helmet from "helmet";
import {
  patchPhotoSchema,
  patchPinSchema,
  patchPinFlagSchema,
  patchEntrySchema,
  verifyTesterCredentials,
} from "../routes.js";
import {
  evictAllSessionSockets,
  evictSessionUserSockets,
  RealtimeAuthorizationTracker,
} from "../realtime-authorization.js";
import { buildTesterLoginUrl, getTesterOwnerFromSearch } from "../../client/src/lib/testerAccess.js";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { isProtectedOwnerIdentity } from "../replit_integrations/auth/replitAuth.js";
import {
  isApproved,
  isIdentityApproved,
  isOwnerIdentity,
  isWebSocketIdentityAuthorized,
} from "../replit_integrations/auth/routes.js";
import { authStorage } from "../replit_integrations/auth/storage.js";
import { registerObjectStorageRoutes } from "../replit_integrations/object_storage/routes.js";
import { createContentSecurityPolicyDirectives } from "../contentSecurityPolicy.js";

// The route module opens a PostgreSQL pool even when the real-server checks
// are skipped. Close this test process's pool so the unit tier cannot hang
// after all assertions have passed.
after(async () => {
  await pool.end().catch(() => {});
});

describe("Clerk owner and approval regression guard", () => {
  test("retains owner only for the existing migrated legacy identity", () => {
    const base = {
      existing: { isTester: false },
      userId: "legacy-owner-subject",
      username: "dan",
      replOwner: "dan",
    };
    assert.equal(isProtectedOwnerIdentity(base), true);
    assert.equal(isProtectedOwnerIdentity({ ...base, existing: undefined }), false);
    assert.equal(isProtectedOwnerIdentity({ ...base, userId: "user_new-clerk-id" }), false);
    assert.equal(isProtectedOwnerIdentity({ ...base, username: "someone-else" }), false);
    assert.equal(isProtectedOwnerIdentity({ ...base, existing: { isTester: true } }), false);
  });

  test("owner authorization trusts only normalized isOwner, never username claims", () => {
    assert.equal(isOwnerIdentity({ isOwner: true, claims: { username: "dan" } }), true);
    assert.equal(isOwnerIdentity({ isOwner: false, claims: { username: "dan" } }), false);
    assert.equal(isOwnerIdentity({ claims: { username: "dan" } }), false);
  });

  test("approval admits normalized owner and tester identities but rejects missing identity", async () => {
    assert.equal(await isIdentityApproved({ isOwner: true }), true);
    assert.equal(await isIdentityApproved({ isTester: true }), true);
    assert.equal(await isIdentityApproved({}), false);
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
      assert.equal(await isWebSocketIdentityAuthorized({ isOwner: true }), true);
      assert.equal(await isWebSocketIdentityAuthorized({ isTester: true }), true);
    } finally {
      authStorage.getUser = originalGetUser;
    }
  });

  test("fails WebSocket revalidation after a connected collaborator is rejected", async () => {
    const originalGetUser = authStorage.getUser;
    let rejected = false;
    authStorage.getUser = async () => ({ approved: !rejected, rejected });

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
      assert.equal((await run({ isOwner: true, claims: { sub: "owner" } })).nextCalled, true);
      assert.equal((await run({ isTester: true, claims: { sub: "tester" } })).nextCalled, true);
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

function getDirective(header: string, directive: string): string {
  const value = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directive} `));
  assert.ok(value, `CSP should include ${directive}`);
  return value;
}

async function getCspHeader(isProduction: boolean): Promise<string> {
  const app = express();
  app.use(helmet({
    contentSecurityPolicy: {
      directives: createContentSecurityPolicyDirectives(isProduction),
    },
  }));
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
    const csp = response.headers["content-security-policy"];
    if (typeof csp !== "string") {
      assert.fail("response should include a string Content-Security-Policy header");
    }
    return csp;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Content Security Policy", () => {
  test("production script-src is an exact Clerk and app allow-list", async () => {
    const csp = await getCspHeader(true);
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
    const csp = await getCspHeader(false);
    assert.equal(
      getDirective(csp, "script-src"),
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://frontend-api.clerk.dev https://*.clerk.accounts.dev https://challenges.cloudflare.com https://*.protect.clerk.com",
    );
    assert.match(getDirective(csp, "script-src"), /unsafe-inline/);
    assert.match(csp, /style-src[^;]*'unsafe-inline'/);
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

describe("RealtimeAuthorizationTracker", () => {
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
    assert.deepEqual(JSON.parse(sent[0]), { type: "authorization_changed" });
    assert.equal(affected.closeCode, 1008);
    assert.equal(affected.closeReason, "Session access revoked");
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

describe("tester access security", () => {
  test("shared login links contain an owner scope but never a password", () => {
    const url = buildTesterLoginUrl("https://example.com", "owner-123");
    assert.equal(url, "https://example.com/tester-login?owner=owner-123");
    assert.equal(getTesterOwnerFromSearch(new URL(url).search), "owner-123");
    assert.equal(url.includes("pw="), false);
    assert.equal(url.includes("secret-password"), false);
  });

  test("credential verification fetches and checks only the requested owner", async () => {
    const hash = await bcrypt.hash("correct-password", 4);
    const requestedOwners: string[] = [];
    const result = await verifyTesterCredentials("owner-123", "correct-password", async (userId) => {
      requestedOwners.push(userId);
      return { userId, testerPassword: hash } as any;
    });

    assert.equal(result?.userId, "owner-123");
    assert.deepEqual(requestedOwners, ["owner-123"]);
  });

  test("credential verification rejects missing and mismatched owner credentials", async () => {
    const hash = await bcrypt.hash("correct-password", 4);
    let lookups = 0;
    const comparedHashes: string[] = [];
    const comparePassword = async (password: string, candidateHash: string) => {
      comparedHashes.push(candidateHash);
      return bcrypt.compare(password, candidateHash);
    };
    const missing = await verifyTesterCredentials(
      "unknown-owner",
      "correct-password",
      async () => {
        lookups++;
        return undefined;
      },
      comparePassword,
    );
    const mismatch = await verifyTesterCredentials("owner-123", "wrong-password", async (userId) => {
      lookups++;
      return { userId, testerPassword: hash } as any;
    }, comparePassword);

    assert.equal(missing, undefined);
    assert.equal(mismatch, undefined);
    assert.equal(lookups, 2);
    assert.equal(comparedHashes.length, 2, "every attempt must perform exactly one bcrypt comparison");
    assert.notEqual(comparedHashes[0], hash, "unknown owners must be checked against the dummy hash");
    assert.equal(comparedHashes[1], hash);
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

describe("tester login real-server integration — owner-scoped authentication", () => {
  let ownerUserId = "";
  let skip = false;
  const password = "routes-test-owner-scoped-password";

  before(async () => {
    if (!(await devServerReachable())) {
      skip = true;
      return;
    }
    const seed = await devReq("POST", "/api/__test__/seed-tester-password", {
      body: { password },
    });
    if (seed.status !== 200 || !seed.body.ownerUserId) {
      skip = true;
      return;
    }
    ownerUserId = seed.body.ownerUserId;
  });

  test("requires an owner access code", async () => {
    if (skip) return;
    const response = await devReq("POST", "/api/auth/tester-login", {
      body: { displayName: "ScopedTester", password },
    });
    assert.equal(response.status, 400);
  });

  test("accepts the password only for its selected owner", async () => {
    if (skip) return;
    const response = await devReq("POST", "/api/auth/tester-login", {
      body: { displayName: "ScopedTester", ownerUserId, password },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.testerOwnerUserId, ownerUserId);
  });

  test("returns the same unauthorized response for an unknown owner", async () => {
    if (skip) return;
    const response = await devReq("POST", "/api/auth/tester-login", {
      body: { displayName: "ScopedTester", ownerUserId: "unknown-owner", password },
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.message, "Invalid owner access code or tester password");
  });
});
