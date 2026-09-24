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

import { randomUUID } from "node:crypto";

import http from "node:http"
;

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as databaseSchema from "@shared/schema";
import express from "express"
;
import multer from "multer";
import { createApiErrorHandler } from "../middlewares/apiErrorHandler.js";

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
  getCurrentPdfJobAccess,
  createSessionHandler,
  registerRoutes,
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
import { storage } from "../storage.js";

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

describe("PDF export authorization", () => {
  test("re-checks current session access for an existing job", async () => {
    const job = { userId: "revoked-collaborator", sessionId: 42 };
    const accessChecks: Array<[number, string]> = [];

    const accessBeforeRevocation = await getCurrentPdfJobAccess(
      job,
      42,
      "revoked-collaborator",
      async (sessionId, userId) => {
        accessChecks.push([sessionId, userId]);
        return { role: "viewer" };
      },
    );
    assert.deepEqual(accessBeforeRevocation, { role: "viewer" });

    const accessAfterRevocation = await getCurrentPdfJobAccess(
      job,
      42,
      "revoked-collaborator",
      async (sessionId, userId) => {
        accessChecks.push([sessionId, userId]);
        return null;
      },
    );
    assert.equal(accessAfterRevocation, null);
    assert.deepEqual(accessChecks, [
      [42, "revoked-collaborator"],
      [42, "revoked-collaborator"],
    ]);
  });

  test("does not authorize a job for another session or identity", async () => {
    let accessCheckerCalled = false;
    const accessChecker = async () => {
      accessCheckerCalled = true;
      return { role: "owner" };
    };

    assert.equal(
      await getCurrentPdfJobAccess(
        { userId: "user-1", sessionId: 42 },
        43,
        "user-1",
        accessChecker,
      ),
      null,
    );
    assert.equal(
      await getCurrentPdfJobAccess(
        { userId: "user-1", sessionId: 42 },
        42,
        "user-2",
        accessChecker,
      ),
      null,
    );
    assert.equal(accessCheckerCalled, false);
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

async function buildProductionPatchRouteContext(): Promise<PatchRouteTestContext> {
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
  let authStoragePatched = false;
  let storagePatched = false;

  const cleanup = async () => {
    if (server?.listening) await closeHttpServer(server);
    await new Promise<void>((resolve) => setImmediate(resolve));
    while (pendingActivityLogs.size > 0) {
      await Promise.allSettled([...pendingActivityLogs]);
    }
    if (sessionId) {
      await db
        .delete(databaseSchema.countingSessions)
        .where(eq(databaseSchema.countingSessions.id, sessionId))
        .catch(() => {});
    }
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
      .values({ userId, name: `__routes-test-${userId}__` })
      .returning();
    sessionId = session.id;

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
