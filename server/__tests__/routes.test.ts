import 
{
 test, describe, before, after 
}
 from "node:test"
;

import assert from "node:assert/strict"
;

import 
{
 readFileSync 
}
 from "node:fs"
;

import http from "node:http"
;

import express from "express"
;

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

import 
{

  patchPhotoSchema,
  patchPinSchema,
  patchPinFlagSchema,
  patchEntrySchema,
  buildScanResultsForPins,
  canEdit,
  createHelpChatHandler,
  helpChatRateLimiter,
  respondWithScanResultsPersistenceFailure,
  SCAN_RESULTS_PERSISTENCE_ERROR,
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
 isAuthenticated 
}
 from "../replit_integrations/auth/replitAuth.js"
;

import 
{

  evictAllSessionSockets,
  evictUserSockets,
  evictSessionUserSockets,
  RealtimeAuthorizationTracker,
}
 from "../realtime-authorization.js"
;

import 
{
 pool 
}
 from "../db.js"
;

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
}
 from "../replit_integrations/auth/routes.js"
;

import { buildSignInPath, getSafeReturnPath } from "../../shared/auth-routing.js";

import 
{
 authStorage 
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

describe("Clerk identity and approval regression guard", () => {
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
        req.user = { claims: { sub: userId } };
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
        req.user = { claims: { sub: "pending-poe-user" } };
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
