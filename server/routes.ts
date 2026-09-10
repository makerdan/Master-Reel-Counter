import type { Express, Request, Response as ExpressResponse, RequestHandler } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { attachWebSocketServerAtPath } from "./websocket-upgrade";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { storage, pinRetryStats, getPinRetryBuckets } from "./storage";
import {
  authenticateWebSocketRequest,
  destroyTesterSession,
  establishTesterSession,
  setupAuth,
  isAuthenticated,
} from "./replit_integrations/auth";
import {
  registerAuthRoutes,
  getIdentityAuthorizationOutcome,
  isApproved,
  isWebSocketIdentityAuthorized,
  isOwnerIdentity,
  ownerOnly,
} from "./replit_integrations/auth/routes";
import { authStorage } from "./replit_integrations/auth/storage";
import {
  objectStorageClient,
  registerObjectStorageRoutes,
} from "./replit_integrations/object_storage";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { generateSalt, generateDataKey, deriveKEK, wrapKey, unwrapKey, encryptEntry, decryptEntry, UNREADABLE_SENTINEL } from "./encryption";
import multer from "multer";
import PDFDocument from "pdfkit";
import { toDisplayUnit, unitLabel, type UnitType } from "./unit-conversion";
import sharp from "sharp";
import { randomUUID, randomBytes, createHash } from "crypto";
import bcrypt from "bcrypt";
import path from "path";
import fs from "fs/promises";
import { PassThrough } from "stream";
import { cropPhoto } from "./lib/cropPhoto";
import ExcelJS from "exceljs";
import { taskTracker } from "./lib/taskTracker";
import {
  evictAllSessionSockets as evictAllSessionSocketsFromRoom,
  evictSessionUserSockets as evictSessionUserSocketsFromRoom,
  evictUserSockets as evictUserSocketsFromRooms,
  registerAuthorizationChangeHandler,
  RealtimeAuthorizationTracker,
  type AuthorizationChangeOutcome,
} from "./realtime-authorization";
import { HELP_SOURCE_TEXT } from "@shared/help-content";
import {
  CLERK_PROXY_HEALTH_PATH,
  clerkProxyHealth,
} from "./middlewares/clerkProxyMiddleware";

// Fire-and-forget helper: records one AI API call to ai_usage_logs.
// Errors are suppressed so logging never disrupts the caller's flow.
import { insertSessionSchema, insertEntrySchema, insertPinSchema, insertPhotoBodySchema, photos, pins, entries, userSettings, insertFeedbackSchema, insertUserWireCatalogSchema, countingSessions, type Session, type UserSettings } from "@shared/schema";
import { getPoeProvider, PoeProviderError, type PoeProvider, type PoeTextMessage } from "./providers/poe";
const pdfJobs = new Map<string, {
  done: number;
  total: number;
  complete: boolean;
  error?: string;
  buffer?: Buffer;
  filename?: string;
  createdAt: number;
  completedAt?: number;
  userId: string;
  sessionId: number;
}>();
const pdfCleanupTimer = setInterval(() => {
  const now = Date.now();
  const staleCutoff = now - 15 * 60 * 1000;      // 15 min for in-progress jobs
  const completedCutoff = now - 2 * 60 * 1000;   // 2 min for completed-but-undownloaded
  for (const [k, v] of pdfJobs) {
    if (v.completedAt !== undefined ? v.completedAt < completedCutoff : v.createdAt < staleCutoff) {
      pdfJobs.delete(k);
    }
  }
}, 60 * 1000); // run every minute so completed-job TTL (2 min) is honoured promptly
pdfCleanupTimer.unref();

function formatPinLabel(label: string): string {
  if (/^\d+$/.test(label)) {
    return `P${label.padStart(3, "0")}`;
  }
  const m = label.match(/^(\d+)(d\d*)?$/);
  if (m) {
    return `P${m[1].padStart(3, "0")}${m[2] || ""}`;
  }
  return `P${label}`;
}

const sessionRooms = new Map<number, Set<WebSocket>>();
const wsUserMap = new Map<WebSocket, { sessionId: number | null; userId: string | null; username: string | null; role: string | null; testerOwnerUserId: string | null }>();
const realtimeAuthorization = new RealtimeAuthorizationTracker();
const encodingToggleInProgress = new Set<string>();

function evictSessionUserSockets(
  sessionId: number,
  userId: string,
  reason: string,
  outcome: AuthorizationChangeOutcome = "removed_collaborator",
): void {
  realtimeAuthorization.invalidate(sessionId);
  evictSessionUserSocketsFromRoom(
    sessionRooms,
    wsUserMap,
    sessionId,
    userId,
    WebSocket.OPEN,
    reason,
    outcome,
  );
  broadcastPresence(sessionId);
}

function evictAllSessionSockets(sessionId: number, reason: string): void {
  realtimeAuthorization.invalidate(sessionId);
  evictAllSessionSocketsFromRoom(sessionRooms, wsUserMap, sessionId, WebSocket.OPEN, reason);
}

function evictUserSockets(userId: string, outcome: AuthorizationChangeOutcome): void {
  const reasonByOutcome: Record<string, string> = {
    account_rejected: "Account access rejected",
    approval_removed: "Account approval removed",
    rejected_users_cleared: "Account access changed",
  };
  const affectedSessionIds = new Set(
    [...wsUserMap.values()]
      .filter((info) => info.userId === userId && info.sessionId !== null)
      .map((info) => info.sessionId as number),
  );
  evictUserSocketsFromRooms(
    sessionRooms,
    wsUserMap,
    userId,
    WebSocket.OPEN,
    reasonByOutcome[outcome] || "Authorization changed",
    outcome,
  );
  for (const sessionId of affectedSessionIds) broadcastPresence(sessionId);
}
/** Derive stable int32 advisory lock keys from a userId (SHA-256, two int4 values). */
function deriveAdvisoryLockKeys(userId: string): [number, number] {
  const h = createHash("sha256").update(userId).digest();
  return [h.readInt32BE(0), h.readInt32BE(4)];
}

type EncodingTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Acquire a shared advisory lock for the given user's encoding toggle.
 * Shared locks coexist with each other (concurrent writes are fine)
 * but conflict with the exclusive lock held by the toggle transaction.
 * Throws "ENCODING_TOGGLE_IN_PROGRESS" if the toggle holds the lock.
 * Must be called as the first statement inside a db.transaction() callback.
 */
async function acquireSharedEncodingLock(
  tx: EncodingTx,
  lk1: number,
  lk2: number
): Promise<void> {
  const lockResult = await tx.execute(
    sql`SELECT pg_try_advisory_xact_lock_shared(${lk1}, ${lk2}) AS acquired`
  );
  if (!(lockResult.rows[0] as { acquired: boolean }).acquired) {
    throw new Error("ENCODING_TOGGLE_IN_PROGRESS");
  }
}

function broadcastToSession(sessionId: number, message: any, excludeWs?: WebSocket) {
  const room = sessionRooms.get(sessionId);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const ws of room) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function broadcastToSessionOwners(sessionId: number, message: any, excludeWs?: WebSocket) {
  const room = sessionRooms.get(sessionId);
  if (!room) return;
  const data = JSON.stringify(message);
  for (const ws of room) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      const info = wsUserMap.get(ws);
      if (info?.role === "owner") {
        ws.send(data);
      }
    }
  }
}

function getOnlineUsers(sessionId: number): { userId: string; username: string }[] {
  const users: { userId: string; username: string }[] = [];
  const seen = new Set<string>();
  for (const [ws, info] of wsUserMap) {
    if (info.sessionId === sessionId && info.userId && ws.readyState === WebSocket.OPEN && !seen.has(info.userId)) {
      seen.add(info.userId);
      users.push({ userId: info.userId, username: info.username || info.userId });
    }
  }
  return users;
}

function broadcastPresence(sessionId: number) {
  const users = getOnlineUsers(sessionId);
  const room = sessionRooms.get(sessionId);
  if (!room) return;
  const data = JSON.stringify({ type: "presence", users });
  for (const ws of room) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

async function logActivity(sessionId: number, userId: string, username: string | undefined, action: string, entityType?: string, entityId?: number, details?: string) {
  try {
    await storage.createActivityLog({ sessionId, userId, username: username || null, action, entityType: entityType || null, entityId: entityId || null, details: details || null });
    broadcastToSession(sessionId, { type: "activity", action, entityType, entityId, userId, username });
  } catch (err) { console.error("logActivity failed:", err); }
}

async function verifySessionAccess(sessionId: number, userId: string, testerOwnerUserId?: string, allowTrashed = false): Promise<{ session: any; role: "owner" | "editor" | "viewer" } | null> {
  const session = await storage.getSession(sessionId);
  if (!session) return null;
  if (!allowTrashed && session.deletedAt) return null;
  if (session.userId === userId) return { session, role: "owner" };
  if (testerOwnerUserId && session.userId === testerOwnerUserId) return { session, role: "editor" };
  const collab = await storage.getCollaborator(sessionId, userId);
  if (collab) return { session, role: collab.role as "editor" | "viewer" };
  return null;
}

export function canEdit(role: string): boolean {
  return role === "owner" || role === "editor";
}

export type ScanResult = {
  pinId: number;
  pinLabel: string;
  rawText: string | null;
  readable: boolean;
};

export const SCAN_RESULTS_PERSISTENCE_ERROR = Object.freeze({
  message: "Label analysis completed, but the results could not be saved. Please retry.",
  code: "scan_results_persistence",
  retryable: true,
});
/**
 * Turn a provider response into persisted scan rows only after checking that it
 * contains one string result for every crop. Keeping this boundary separate
 * makes it impossible for malformed provider output to reach storage and
 * preserves the request order used by the scanner UI.
 */
export function buildScanResultsForPins(
  pins: Array<{ pinId: number; pinLabel: string }>,
  orderedCrops: Array<{ pinId: number }>,
  labels: unknown,
): ScanResult[] {
  if (
    !Array.isArray(labels) ||
    labels.length !== orderedCrops.length ||
    labels.some((label) => typeof label !== "string")
  ) {
    throw new PoeProviderError("validation", "Poe returned invalid structured output.", 502);
  }

  const labelsByPinId = new Map(
    orderedCrops.map((crop, index) => [crop.pinId, labels[index] as string]),
  );
  return pins.map((pin) => {
    const rawText = labelsByPinId.has(pin.pinId)
      ? (labelsByPinId.get(pin.pinId) || null)
      : null;
    return {
      pinId: pin.pinId,
      pinLabel: pin.pinLabel,
      rawText,
      readable: rawText !== null,
    };
  });
}

export function createHelpChatHandler(
  provider: PoeProvider = getPoeProvider(),
  helpSystemPrompt = "",
): RequestHandler {
  return async (req: any, res: any) => {
    let aborted = false;
    try {
      const { messages } = (req.body ?? {}) as any;
      if (!Array.isArray(messages) || messages.length === 0 || messages.length > 12) {
        return res.status(400).json({ error: "messages must be a non-empty array (max 12)" });
      }

      const validRoles = new Set(["user", "assistant"]);
      const sanitized: PoeTextMessage[] = [];
      let totalCharacters = 0;
      for (const m of messages) {
        if (!m || typeof m.content !== "string" || !validRoles.has(m.role)) {
          return res.status(400).json({ error: "Each message must have role (user/assistant) and content (string)" });
        }
        const content = m.content.trim().slice(0, 1200);
        if (!content) return res.status(400).json({ error: "Message content cannot be empty" });
        totalCharacters += content.length;
        if (totalCharacters > 8_000) {
          return res.status(400).json({ error: "Conversation is too long; start a new question." });
        }
        sanitized.push({ role: m.role as "user" | "assistant", content });
      }

      const chatMessages: PoeTextMessage[] = [
        {
          role: "system",
          content: `${helpSystemPrompt}\n\nApproved current help source (use only this source for product facts):\n${HELP_SOURCE_TEXT}\n\nNever invent settings, permissions, integrations, or recovery steps. If the answer is not in the approved source, say that you do not know and direct the user to Feedback.`,
        },
        ...sanitized,
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const requestAbort = new AbortController();
      let providerStream: Awaited<ReturnType<PoeProvider["streamText"]>> | undefined;
      const abortForDisconnect = () => {
        if (res.writableEnded) return;
        aborted = true;
        requestAbort.abort();
        providerStream?.abort();
      };
      req.on("aborted", abortForDisconnect);
      res.on("close", abortForDisconnect);

      providerStream = await provider.streamText({
        messages: chatMessages,
        useCase: "help-chat",
        maxTokens: 512,
        signal: requestAbort.signal,
        userId: (req as AuthenticatedRequest).user?.claims?.sub ?? null,
      });

      for await (const content of providerStream.stream) {
        if (aborted) break;
        if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }

      if (!aborted) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    } catch (error) {
      console.error("Error in help chat:", error instanceof PoeProviderError ? error.code : "unknown error");
      if (aborted || abortedOrEnded(res)) return;
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to get response" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to get response" });
      }
    }
  };
}

function abortedOrEnded(res: any): boolean {
  return res.writableEnded === true || res.destroyed === true;
}

function isOwner(role: string): boolean {
  return role === "owner";
}

function checkLocked(session: any, role: string): string | null {
  if (session.isLocked && !isOwner(role)) {
    return "This session is locked";
  }
  return null;
}

function resolveUserId(req: AuthenticatedRequest | any): string {
  const ar = req as AuthenticatedRequest;
  if (ar.user?.isTester && ar.user?.claims?.testerOwnerUserId) {
    return ar.user.claims.testerOwnerUserId;
  }
  return ar.user?.claims?.sub;
}

function getTesterOwner(req: AuthenticatedRequest | any): string | undefined {
  const ar = req as AuthenticatedRequest;
  if (ar.user?.isTester && ar.user?.claims?.testerOwnerUserId) {
    return ar.user.claims.testerOwnerUserId;
  }
  return undefined;
}

function correctEntryFootage(entries: any[]): any[] {
  return entries;
}


async function getEncryptionKey(userId: string): Promise<Buffer | null> {
  const settings = await storage.getUserSettings(userId);
  if (!settings?.encodingEnabled || !settings.encryptionKey || !settings.encryptionSalt) return null;
  const kek = deriveKEK(settings.encryptionSalt);
  return unwrapKey(settings.encryptionKey, kek);
}

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts, please try again later." },
  skipSuccessfulRequests: false,
});

const resourceRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

const MAX_PINS_PER_CROP_REQUEST = 50;

const cropAiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => (req as AuthenticatedRequest).user?.claims?.sub ?? ipKeyGenerator(req),
  message: { message: "Too many scan requests. Please wait a moment before trying again." },
});

export const helpChatRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => (req as AuthenticatedRequest).user?.claims?.sub ?? ipKeyGenerator(req),
  message: { message: "Too many chat requests. Please wait a few minutes before sending more messages." },
});

// Public endpoint rate limiter: prevents DB flooding on unauthenticated routes.
// Uses ipKeyGenerator (proxy-aware, IPv6-safe) from express-rate-limit so it
// behaves correctly behind Replit's reverse proxy without IPv6 validation errors.
const pageviewRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  message: { ok: false, message: "Too many pageview requests, please try again later." },
});
const recentPageViews = new Map<string, number>();

/**
 * Typed wrapper for Express requests that have been authenticated.
 * Replaces `req: any` on high-risk route handlers so TypeScript can catch
 * missing-field bugs at compile time. Apply incrementally — handlers still
 * using `req: any` are marked with // TODO(req-typing).
 */
interface AuthenticatedUser {
  isTester?: boolean;
  claims: {
    sub: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    testerOwnerUserId?: string;
  };
}

/** Generic authenticated request — TBody types req.body for compile-time safety.
 *  Params defaults to Record<string,string> so req.params.id is always string. */
interface AuthenticatedRequest<TBody = Record<string, unknown>> extends Request<Record<string, string>> {
  user: AuthenticatedUser;
  body: TBody;
}

/** Body shape for POST /api/uploads/direct (multipart; body fields are minimal). */
interface UploadBody {
  sessionId?: string;
}

/** Body shape for POST /api/sessions/:sessionId/photos */
interface PhotoCreateBody {
  registrationKey?: string;
  objectStorageKey?: string;
  originalFilename?: string;
  objectPath?: string;
  mimeType?: string;
  aisle?: string;
  section?: string;
  notes?: string;
  isReceiving?: boolean | string;
  isOnFloor?: boolean | string;
  fileSize?: number;
  rotation?: number;
  capturedAt?: string;
  width?: number;
  height?: number;
}

/** Body shape for POST /api/sessions/:sessionId/entries */
interface EntryCreateBody {
  aisle?: string;
  section?: string;
  category?: string;
  footage?: number;
  manufacturer?: string;
  reelCount?: number;
  notes?: string;
  reelTag?: string;
  photoId?: number;
  unitType?: string;
}

/** Body shape for POST /api/photos/:photoId/pins */
interface PinCreateBody {
  x?: number;
  y?: number;
  label?: string;
  notes?: string;
  photoUrl?: string;
  isDraft?: boolean;
  scale?: number;
}

const patchSessionSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  status: z.enum(["active", "completed"]).optional(),
  isLocked: z.boolean().optional(),
  completedAt: z.union([z.string().datetime(), z.null()]).optional(),
  lastPhotoIndex: z.number().int().min(0).optional(),
  folderId: z.number().int().nullable().optional(),
  expectedLastUpdatedAt: z.union([z.string().datetime(), z.number()]).optional(),
}).strict();

export const patchPhotoSchema = z.object({
  aisle: z.string().optional(),
  section: z.string().optional(),
  rotation: z.number().optional(),
  notes: z.string().nullable().optional(),
  isDetailShot: z.boolean().optional(),
  parentPhotoId: z.number().nullable().optional(),
  pinScale: z.number().optional(),
  linkReason: z.string().nullable().optional(),
  linkedPinLabel: z.string().nullable().optional(),
});

export const patchPinSchema = z.object({
  xPercent: z.number().optional(),
  yPercent: z.number().optional(),
  label: z.string().optional(),
  reelCount: z.number().nullable().optional(),
  wireDetails: z.string().nullable().optional(),
  vendorCode: z.string().nullable().optional(),
  footage: z.number().nullable().optional(),
  entryId: z.number().nullable().optional(),
  flagged: z.boolean().optional(),
  serverUpdatedAt: z.union([z.string(), z.number()]).optional(),
});

export const patchPinFlagSchema = z.object({
  flagged: z.boolean().optional(),
  flagReason: z.string().nullable().optional(),
  serverUpdatedAt: z.union([z.string(), z.number()]).optional(),
});

export const patchEntrySchema = z.object({
  aisle: z.string().optional(),
  section: z.string().optional(),
  position: z.string().nullable().optional(),
  palletId: z.string().nullable().optional(),
  reelTag: z.string().optional(),
  wireType: z.string().optional(),
  gauge: z.string().optional(),
  footage: z.number().nullable().optional(),
  reelCount: z.number().nullable().optional(),
  color: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  conductors: z.number().nullable().optional(),
  photoId: z.number().nullable().optional(),
  serverUpdatedAt: z.union([z.string(), z.number()]).optional(),
});

/** Typed-request wrapper: allows `req` to be declared as AuthenticatedRequest in
 *  handler bodies without hitting Express's TS2769 contravariance error at the
 *  call-site where RequestHandler is expected.
 */
function typed<TBody = Record<string, unknown>>(
  handler: (req: AuthenticatedRequest<TBody>, res: ExpressResponse) => Promise<any>
): RequestHandler {
  return handler as unknown as RequestHandler;
}

/**
 * Injectable dependencies for executePhotoDeletion.
 * Separating these enables unit tests to mock the DB and storage layers
 * independently, exercising the two-step sequencing without real infrastructure.
 */
export interface PhotoDeletionDeps {
  /** Step 1 — DB cascade. Throwing here aborts deletion; storage is NOT touched. */
  deletePhotoFromDb: (photoId: number) => Promise<void>;
  /** Returns true if another photo row reuses the same storage key. */
  isObjectKeyShared: (key: string, excludePhotoId: number) => Promise<boolean>;
  /**
   * Step 2 — file removal (cloud + local). Throwing here is swallowed so the
   * caller still returns success — the DB row is gone so the UI has no broken
   * reference. An orphaned blob is left in storage but causes no user impact.
   */
  deleteStorageFile: (key: string) => Promise<void>;
}

/**
 * Core photo deletion logic — DB cascade first, then storage file removal.
 * Exported so tests can inject mocks at both boundaries without re-implementing
 * the sequencing logic.
 *
 * Throws if Step 1 (DB) fails; callers should return HTTP 500.
 * Swallows failures from Step 2 (storage); callers should return HTTP 200.
 */
export async function executePhotoDeletion(
  photo: { id: number; objectStorageKey: string },
  deps: PhotoDeletionDeps,
  keepFile: boolean = false
): Promise<void> {
  // Step 1: DB cascade first — if this throws, no file is removed.
  await deps.deletePhotoFromDb(photo.id);

  // Step 2: Remove the file from storage only after the DB delete succeeds.
  // A failure here leaves an orphaned blob but the DB record is already gone,
  // so the UI has no broken references. Log and continue rather than re-throw.
  if (!keepFile) {
    try {
      const key = photo.objectStorageKey;
      const shared = await deps.isObjectKeyShared(key, photo.id);
      if (!shared) {
        await deps.deleteStorageFile(key);
      }
    } catch (err) {
      console.warn("Orphaned storage blob after DB delete (photo %d, key %s):", photo.id, photo.objectStorageKey, err);
    }
  }
}

const TESTER_LOGIN_DUMMY_HASH = "$2b$10$lAFb311fxS137sB1dRXSLO/PuLciY.N6I1qM4Hdbgv9NDozRWWLr.";
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    next();
  });

  const { sessionParser } = await setupAuth(app);
  registerAuthorizationChangeHandler((userId, outcome) => {
    evictUserSockets(userId, outcome);
  });

  app.use("/api", (req, res, next) => {
    const skipPaths = [
      "/api/auth/user", "/api/auth/tester-login", "/api/auth/tester-logout",
      "/api/__test__/seed-tester-password",
      "/api/__test__/owner-login",
      "/api/track/pageview",
      "/api/healthz",
    ];
    const matchesSkip = skipPaths.some(p => req.originalUrl === p || req.originalUrl.startsWith(p + "/") || req.originalUrl.startsWith(p + "?"));
    if (matchesSkip) return next();
    isAuthenticated(req, res, (authError?: unknown) => {
      if (authError) return next(authError);
      isApproved(req, res, next);
    });
  });
  // All admin operations share one deny-by-default owner boundary. Individual
  // handlers still validate their own inputs and resource scope.
  app.use("/api/admin", ownerOnly);
  app.get(CLERK_PROXY_HEALTH_PATH, ownerOnly, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, ...clerkProxyHealth.snapshot() });
  });

  registerAuthRoutes(app);
  registerObjectStorageRoutes(app);

  const testerLoginSchema = z.object({
    displayName: z.string().trim().min(1, "Display name is required").max(100),
    ownerUserId: z.string().trim().min(1, "Owner access code is required").max(255),
    password: z.string().trim().min(1, "Password is required").max(256),
  });

  app.post("/api/auth/tester-login", authRateLimiter, async (req: any, res) => {
    try {
      const parsed = testerLoginSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Display name, owner access code, and password are required" });
      }
      const { displayName, ownerUserId, password } = parsed.data;
      const ownerSettings = await verifyTesterCredentials(ownerUserId.trim(), password);
      if (!ownerSettings) {
        return res.status(401).json({ message: "Invalid owner access code or tester password" });
      }
      const testerId = `tester-${createHash("sha256").update(`${ownerSettings.userId}:${displayName.trim().toLowerCase()}`).digest("hex").slice(0, 16)}`;
      await authStorage.upsertUser({
        id: testerId,
        email: null,
        firstName: displayName.trim(),
        lastName: null,
        profileImageUrl: null,
        isTester: true,
      });
      const testerUser = {
        claims: {
          sub: testerId,
          firstName: displayName.trim(),
          testerOwnerUserId: ownerSettings.userId,
        },
        expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        isTester: true,
      };
      await establishTesterSession(req, testerUser);
      return res.json({
        id: testerId,
        email: null,
        firstName: displayName.trim(),
        lastName: null,
        profileImageUrl: null,
        customAvatarKey: null,
        isTester: true,
        testerOwnerUserId: ownerSettings.userId,
      });
    } catch (error) {
      console.error("Tester login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.get("/api/auth/tester-logout", async (req: any, res) => {
    try {
      await destroyTesterSession(req);
      res.redirect("/");
    } catch {
      res.status(500).json({ message: "Logout failed" });
    }
  });

  const UPLOADS_DIR = path.join(process.cwd(), "uploads");

  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  const BUCKET_NAME = privateDir.split("/").filter(Boolean)[0] ?? "";
  const toStorageObjectName = (key: string): string => {
    const filename = key.startsWith("/uploads/") ? key.slice("/uploads/".length) : key;
    const dirPart = privateDir.replace(/^\/[^/]+\/?/, "");
    return `${dirPart}/uploads/${filename}`;
  };
  const toAvatarObjectName = (filename: string): string => {
    return toStorageObjectName(`/uploads/${filename}`);
  };

  const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
  const putToObjectStorage = async (
    bucketName: string,
    objectName: string,
    buffer: Buffer,
    contentType: string,
    localFallbackPath?: string
  ): Promise<void> => {
    try {
      const signController = new AbortController();
      const signTimeoutId = setTimeout(() => signController.abort(), 5000);
      let signRes: Response;
      try {
        signRes = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bucket_name: bucketName,
            object_name: objectName,
            method: "PUT",
            expires_at: new Date(Date.now() + 900_000).toISOString(),
          }),
          signal: signController.signal,
        });
      } finally {
        clearTimeout(signTimeoutId);
      }
      if (!signRes.ok) throw new Error(`Sidecar sign: ${signRes.status}`);
      const { signed_url: signedUrl } = await signRes.json();
      const uploadRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: buffer,
      });
      if (!uploadRes.ok) throw new Error(`GCS PUT: ${uploadRes.status}`);
    } catch (gcsErr) {
      if (!localFallbackPath) throw gcsErr;
      console.warn(`Object storage unavailable (${(gcsErr as Error).message}), writing to local disk: ${localFallbackPath}`);
      await fs.mkdir(path.dirname(localFallbackPath), { recursive: true });
      await fs.writeFile(localFallbackPath, buffer);
    }
  };

  const ALLOWED_IMAGE_MIMETYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  // Reject files whose MIME type is not in the allow-list. cb(null, false) is
  // used so multer does not call next(err), keeping the error in route-handler
  // territory. The rejected MIME type is annotated on the request so each
  // handler can return a descriptive 400 JSON payload.
  const imageFileFilter: multer.Options["fileFilter"] = (req: any, file, cb) => {
    if (ALLOWED_IMAGE_MIMETYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      req._rejectedMimetype = file.mimetype;
      cb(null, false);
    }
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 }, fileFilter: imageFileFilter });

  app.post("/api/uploads/direct", isAuthenticated, resourceRateLimiter, upload.single("file"), async (req: any, res) => {
    const authedReq = req as AuthenticatedRequest<UploadBody> & { file?: Express.Multer.File; _rejectedMimetype?: string };
    try {
      if (!authedReq.file) {
        if (authedReq._rejectedMimetype) {
          return res.status(400).json({ error: `Invalid file type: ${authedReq._rejectedMimetype}. Allowed: image/jpeg, image/png, image/webp.` });
        }
        return res.status(400).json({ error: "No file provided" });
      }

      const ext = path.extname(authedReq.file.originalname) || "";
      const objectId = `${randomUUID()}${ext}`;
      const objectPath = `/uploads/${objectId}`;
      const objectName = toStorageObjectName(objectPath);
      const localFallback = path.join(UPLOADS_DIR, objectId);
      await putToObjectStorage(BUCKET_NAME, objectName, authedReq.file.buffer, authedReq.file.mimetype, localFallback);
      console.log(`Upload success: file="${objectId}", size=${authedReq.file.size}, type=${authedReq.file.mimetype}`);

      // Track the pending upload so orphan cleanup can delete the file if the
      // client never completes the photo-registration step.
      // We await this so that a DB failure causes step-1 to surface an error
      // rather than silently leaving an untracked orphan. On failure, we make
      // a best-effort attempt to delete the already-uploaded file.
      const uploadUserId = resolveUserId(authedReq);
      try {
        await storage.createUploadIntent(objectPath, uploadUserId);
      } catch (intentErr: unknown) {
        console.error("createUploadIntent failed; rolling back object storage write:", (intentErr as Error)?.message);
        objectStorageClient.bucket(BUCKET_NAME).file(objectName).delete({ ignoreNotFound: true }).catch(() => {});
        fs.unlink(localFallback).catch(() => {});
        return res.status(500).json({ error: "Failed to record upload intent; upload rolled back" });
      }

      res.json({
        objectPath,
        metadata: {
          name: authedReq.file.originalname,
          size: authedReq.file.size,
          contentType: authedReq.file.mimetype,
        },
      });
    } catch (error: any) {
      console.error("Error uploading file:", error?.message || error, error?.stack);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });

  app.get("/uploads/:filename", isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const filename = req.params.filename;
      if (typeof filename !== "string" || !/^[A-Za-z0-9._-]+$/.test(filename) || filename.length > 255 || filename === "." || filename === "..") {
        return res.status(400).json({ error: "Invalid filename" });
      }

      const storageKey = `/uploads/${filename}`;
      const requestingUserId = (req as AuthenticatedRequest).user.claims.sub;
      const photo = await storage.getPhotoByStorageKey(storageKey);
      if (photo) {
        const testerOwner = getTesterOwner(req as AuthenticatedRequest);
        const access = await verifySessionAccess(photo.sessionId, requestingUserId, testerOwner);
        if (!access) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else {
        const ownerUserId = getTesterOwner(req as AuthenticatedRequest) ?? requestingUserId;
        const [userRecord, userSettingsRecord] = await Promise.all([
          authStorage.getUser(ownerUserId),
          storage.getUserSettings(ownerUserId),
        ]);
        const isOwnAvatar = userRecord?.customAvatarKey === storageKey;
        const isOwnLogo = userSettingsRecord?.companyLogoKey === storageKey;
        if (!isOwnAvatar && !isOwnLogo) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const ext = path.extname(filename).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic",
        ".heif": "image/heif", ".bmp": "image/bmp", ".tiff": "image/tiff",
      };
      const headers = {
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
      };
      let servedFromGcs = false;
      try {
        const gcsFile = objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(`/uploads/${filename}`));
        const [existsInGcs] = await Promise.race([
          gcsFile.exists(),
          new Promise<[boolean]>(resolve => setTimeout(() => { console.warn("[GCS] exists() timed out for /uploads/%s — treating as not found", filename); resolve([false]); }, 5000)),
        ]);
        if (existsInGcs) {
          res.set(headers);
          gcsFile.createReadStream().on("error", (err) => { console.error("GCS stream error:", err); if (!res.headersSent) res.status(500).json({ error: "Stream failed" }); }).pipe(res);
          servedFromGcs = true;
        }
      } catch {
        // GCS unavailable in dev environment — fall through to local disk
      }
      if (servedFromGcs) return;
      const filePath = path.join(UPLOADS_DIR, filename);
      try {
        await fs.access(filePath);
      } catch {
        return res.status(404).json({ error: "File not found", message: "The file may still be uploading or was moved. Try again in a moment." });
      }
      res.set(headers);
      const { createReadStream } = await import("fs");
      createReadStream(filePath).on("error", (err) => { console.error("File stream error:", err); if (!res.headersSent) res.status(500).json({ error: "Stream failed" }); }).pipe(res);
    } catch (error) {
      console.error("Error serving file:", error);
      res.status(500).json({ error: "Failed to serve file" });
    }
  });

  // Sessions CRUD
  app.get("/api/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const trash = req.query.trash === "true";
      const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset) : undefined;
      const { sessions, total } = await storage.getUserSessions(userId, { trash, limit, offset });
      const sessionIds = sessions.map(s => s.id);
      const [stats, photoStats, thumbnails, collabUsernames, wireTypesMap] = await Promise.all([
        storage.getSessionStats(sessionIds),
        storage.getSessionPhotoStats(sessionIds),
        storage.getSessionThumbnails(sessionIds),
        storage.getSessionCollaboratorUsernames(sessionIds),
        storage.getSessionWireTypes(sessionIds),
      ]);
      const sessionsWithStats = sessions.map(s => {
        const st = stats.get(s.id) || { entryCount: 0, totalFootage: 0, sectionCount: 0 };
        const ps = photoStats.get(s.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
        const thumbnailKey = thumbnails.get(s.id) || null;
        const collaboratorUsernames = collabUsernames.get(s.id) || [];
        const wireTypes = wireTypesMap.get(s.id) || [];
        return { ...s, ...st, ...ps, thumbnailKey, collaboratorUsernames, wireTypes };
      });
      res.json({ sessions: sessionsWithStats, total, limit, offset: offset || 0 });
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ message: "Failed to fetch sessions" });
    }
  });

  app.post("/api/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const data = insertSessionSchema.parse({ ...req.body, userId });
      if (data.folderId) {
        const folder = await storage.getFolder(data.folderId);
        if (!folder || folder.userId !== userId) return res.status(400).json({ message: "Invalid folder" });
      }
      const session = await storage.createSession(data);
      res.json(session);
    } catch (error) {
      console.error("Error creating session:", error);
      res.status(500).json({ message: "Failed to create session" });
    }
  });

  app.get("/api/sessions/shared", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const sharedSessions = await storage.getSharedSessions(userId);
      const sessionIds = sharedSessions.map(s => s.id);
      const [stats, photoStats, thumbnails, collabUsernames, wireTypesMap] = await Promise.all([
        storage.getSessionStats(sessionIds),
        storage.getSessionPhotoStats(sessionIds),
        storage.getSessionThumbnails(sessionIds),
        storage.getSessionCollaboratorUsernames(sessionIds),
        storage.getSessionWireTypes(sessionIds),
      ]);
      const result = sharedSessions.map(s => {
        const st = stats.get(s.id) || { entryCount: 0, totalFootage: 0, sectionCount: 0 };
        const ps = photoStats.get(s.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
        const thumbnailKey = thumbnails.get(s.id) || null;
        const collaboratorUsernames = collabUsernames.get(s.id) || [];
        const wireTypes = wireTypesMap.get(s.id) || [];
        return { ...s, ...st, ...ps, thumbnailKey, collaboratorUsernames, wireTypes };
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching shared sessions:", error);
      res.status(500).json({ message: "Failed to fetch shared sessions" });
    }
  });

  app.get("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const { session, role } = access;
      const photoStats = await storage.getSessionPhotoStats([session.id]);
      const ps = photoStats.get(session.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
      const collaborators = await storage.getSessionCollaborators(session.id);
      res.json({ ...session, ...ps, role, collaboratorCount: collaborators.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch session" });
    }
  });

  app.patch("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = patchSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.errors });
      }
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const { expectedLastUpdatedAt, completedAt, ...rest } = parsed.data;
      const data: Partial<Session> = { ...rest };
      if (completedAt !== undefined) {
        data.completedAt = completedAt === null ? null : new Date(completedAt);
      }
      // IDOR guard: if the caller is moving the session to a folder, verify
      // that folder belongs to the requesting user before proceeding.
      if (data.folderId != null) {
        const userId = resolveUserId(req as AuthenticatedRequest);
        const targetFolder = await storage.getFolder(data.folderId);
        if (!targetFolder || targetFolder.userId !== userId) {
          return res.status(403).json({ message: "Target folder not found or access denied" });
        }
      }
      const mutatingKeys = Object.keys(data);
      const isLastPhotoIndexOnly = mutatingKeys.length === 1 && "lastPhotoIndex" in data;
      if (!isLastPhotoIndexOnly && !isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can edit session details" });
      // Optimistic locking: required for all session detail edits to prevent silent
      // concurrent overwrites. The `lastPhotoIndex`-only fast path (used by the
      // capture flow to record scroll position) is intentionally exempt.
      let updated: Session | undefined;
      if (isLastPhotoIndexOnly) {
        updated = await storage.updateSession(access.session.id, data);
      } else {
        if (expectedLastUpdatedAt === undefined) {
          return res.status(400).json({ message: "expectedLastUpdatedAt is required for session edits" });
        }
        const expectedDate = new Date(expectedLastUpdatedAt);
        if (isNaN(expectedDate.getTime())) {
          return res.status(400).json({ message: "Invalid expectedLastUpdatedAt" });
        }
        updated = await storage.updateSessionIfUnchanged(access.session.id, expectedDate, data);
        if (!updated) {
          const current = await storage.getSession(access.session.id);
          return res.status(409).json({
            message: "This session was updated by someone else. Please reload to see the latest changes before saving again.",
            code: "SESSION_VERSION_CONFLICT",
            currentLastUpdatedAt: current?.lastUpdatedAt ?? null,
          });
        }
      }
      if (!isLastPhotoIndexOnly) {
        const changedFields = Object.keys(data).filter(k => k !== "lastPhotoIndex").join(", ");
        logActivity(access.session.id, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, "session_updated", "session", access.session.id, changedFields);
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Failed to update session:", error?.message || error);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  const lockSessionBody = z.object({ locked: z.boolean() });

  app.post("/api/sessions/:id/lock", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can lock/unlock sessions" });
      const lockParse = lockSessionBody.safeParse(req.body ?? {});
      if (!lockParse.success) return res.status(400).json({ message: "Invalid request body", errors: lockParse.error.flatten().fieldErrors });
      const { locked } = lockParse.data;
      const updated = await storage.updateSession(access.session.id, { isLocked: !!locked });
      await logActivity(access.session.id, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, locked ? "locked_session" : "unlocked_session", "session", access.session.id);
      broadcastToSession(access.session.id, { type: "session_lock", locked: !!locked });
      res.json(updated);
    } catch (error: any) {
      console.error("Failed to toggle session lock:", error?.message || error);
      res.status(500).json({ message: "Failed to toggle session lock" });
    }
  });


  app.delete("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can delete sessions" });
      await storage.softDeleteSession(access.session.id);
      evictAllSessionSockets(access.session.id, "Session deleted");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete session" });
    }
  });

  app.post("/api/sessions/:id/restore", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest), true);
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can restore sessions" });
      await storage.restoreSession(access.session.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to restore session" });
    }
  });

  app.delete("/api/sessions/:id/permanent", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest), true);
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can permanently delete sessions" });
      const sessionPhotos = await storage.getSessionPhotos(access.session.id);
      for (const photo of sessionPhotos) {
        try {
          const shared = await storage.isObjectKeyShared(photo.objectStorageKey, photo.id);
          if (!shared) {
            const key = photo.objectStorageKey;
            const filename = key.startsWith("/uploads/") ? key.slice("/uploads/".length) : key.replace(/^\/objects\/uploads\//, "");
            const filePath = path.join(UPLOADS_DIR, filename);
            await objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(key)).delete({ ignoreNotFound: true }).catch(() => {});
            await fs.unlink(filePath).catch(() => {});
          }
        } catch (err) {
          console.warn("Could not delete photo file on session delete:", err);
        }
      }
      await storage.deleteSession(access.session.id);
      evictAllSessionSockets(access.session.id, "Session deleted");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to permanently delete session" });
    }
  });

  app.post("/api/sessions/bulk/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { ids, status } = (req.body ?? {}) as any;
      if (!Array.isArray(ids) || !ids.length || !["active", "completed"].includes(status)) {
        return res.status(400).json({ message: "Invalid request" });
      }
      const results = [];
      for (const id of ids) {
        const access = await verifySessionAccess(id, userId, getTesterOwner(req as AuthenticatedRequest));
        if (access && isOwner(access.role)) {
          const data: any = { status };
          if (status === "completed") data.completedAt = new Date();
          else data.completedAt = null;
          await storage.updateSession(id, data);
          results.push(id);
        }
      }
      res.json({ updated: results });
    } catch (error) {
      res.status(500).json({ message: "Failed to update sessions" });
    }
  });

  app.post("/api/sessions/bulk/move", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { ids, folderId } = (req.body ?? {}) as any;
      if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({ message: "Invalid request" });
      }
      if (folderId !== null && folderId !== undefined) {
        const folder = await storage.getFolder(folderId);
        if (!folder || folder.userId !== userId || folder.deletedAt !== null) {
          return res.status(404).json({ message: "Folder not found" });
        }
      }
      const results = [];
      for (const id of ids) {
        const access = await verifySessionAccess(id, userId, getTesterOwner(req as AuthenticatedRequest));
        if (access && isOwner(access.role)) {
          await storage.updateSession(id, { folderId: folderId ?? null });
          results.push(id);
        }
      }
      res.json({ moved: results });
    } catch (error) {
      res.status(500).json({ message: "Failed to move sessions" });
    }
  });

  app.post("/api/sessions/bulk/delete", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { ids } = (req.body ?? {}) as any;
      if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({ message: "Invalid request" });
      }
      const results = [];
      for (const id of ids) {
        const access = await verifySessionAccess(id, userId, getTesterOwner(req as AuthenticatedRequest));
        if (access && isOwner(access.role)) {
          const sessionPhotos = await storage.getSessionPhotos(id);
          for (const photo of sessionPhotos) {
            try {
              const shared = await storage.isObjectKeyShared(photo.objectStorageKey, photo.id);
              if (!shared) {
                const key = photo.objectStorageKey;
                const filename = key.startsWith("/uploads/") ? key.slice("/uploads/".length) : key.replace(/^\/objects\/uploads\//, "");
                const filePath = path.join(UPLOADS_DIR, filename);
                await objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(key)).delete({ ignoreNotFound: true }).catch(() => {});
                await fs.unlink(filePath).catch(() => {});
              }
            } catch (err) {
              console.warn("Could not delete photo file on bulk session delete:", err);
            }
          }
          await storage.deleteSession(id);
          evictAllSessionSockets(id, "Session deleted");
          results.push(id);
        }
      }
      res.json({ deleted: results });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete sessions" });
    }
  });

  // Folders
  app.get("/api/folders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const userFolders = await storage.getUserFolders(userId);
      res.json(userFolders);
    } catch (error) {
      res.status(500).json({ message: "Failed to get folders" });
    }
  });

  app.post("/api/folders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { name } = (req.body ?? {}) as any;
      if (!name || typeof name !== "string") return res.status(400).json({ message: "Name is required" });
      const existing = await storage.getUserFolders(userId);
      const maxOrder = existing.reduce((m, f) => Math.max(m, f.sortOrder), -1);
      const folder = await storage.createFolder({ userId, name, sortOrder: maxOrder + 1 });
      res.json(folder);
    } catch (error) {
      res.status(500).json({ message: "Failed to create folder" });
    }
  });

  app.patch("/api/folders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const folder = await storage.getFolder(parseInt(req.params.id));
      if (!folder || folder.userId !== userId) return res.status(404).json({ message: "Folder not found" });
      if (folder.deletedAt) return res.status(400).json({ message: "Cannot modify a trashed folder" });
      const { name, sortOrder, parentFolderId } = (req.body ?? {}) as any;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      if (parentFolderId !== undefined) {
        if (parentFolderId !== null) {
          if (parentFolderId === folder.id) return res.status(400).json({ message: "Cannot move folder into itself" });
          const parentFolder = await storage.getFolder(parentFolderId);
          if (!parentFolder || parentFolder.userId !== userId) return res.status(403).json({ message: "Parent folder not found or access denied" });
          const visited = new Set<number>([folder.id, parentFolder.id]);
          let ancestor: typeof parentFolder | undefined = parentFolder;
          let depth = 0;
          while (ancestor && ancestor.parentFolderId && depth < 50) {
            if (ancestor.parentFolderId === folder.id) return res.status(400).json({ message: "Cannot create circular folder nesting" });
            if (visited.has(ancestor.parentFolderId)) return res.status(400).json({ message: "Corrupt folder chain detected" });
            visited.add(ancestor.parentFolderId);
            const next = await storage.getFolder(ancestor.parentFolderId);
            if (!next || next.userId !== userId) return res.status(400).json({ message: "Invalid folder chain" });
            ancestor = next;
            depth++;
          }
        }
        updates.parentFolderId = parentFolderId;
      }
      const updated = await storage.updateFolder(folder.id, updates);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update folder" });
    }
  });

  app.delete("/api/folders/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const folder = await storage.getFolder(parseInt(req.params.id));
      if (!folder || folder.userId !== userId) return res.status(404).json({ message: "Folder not found" });
      await storage.softDeleteFolder(folder.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });

  app.post("/api/folders/:id/restore", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const folder = await storage.getFolder(parseInt(req.params.id));
      if (!folder || folder.userId !== userId) return res.status(404).json({ message: "Folder not found" });
      const { relinkedCount, relinkedSessionNames } = await storage.restoreFolder(folder.id);
      res.json({ success: true, relinkedCount, relinkedSessionNames });
    } catch (error) {
      res.status(500).json({ message: "Failed to restore folder" });
    }
  });

  app.delete("/api/folders/:id/permanent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const folder = await storage.getFolder(parseInt(req.params.id));
      if (!folder || folder.userId !== userId) return res.status(404).json({ message: "Folder not found" });
      if (!folder.deletedAt) return res.status(400).json({ message: "Folder must be in trash before permanent delete" });
      await storage.permanentDeleteFolder(folder.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to permanently delete folder" });
    }
  });

  app.get("/api/folders/trash", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const trashedFolders = await storage.getTrashedFolders(userId);
      res.json(trashedFolders);
    } catch (error) {
      res.status(500).json({ message: "Failed to get trashed folders" });
    }
  });

  app.post("/api/folders/reorder", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { folderIds } = (req.body ?? {}) as any;
      if (!Array.isArray(folderIds)) return res.status(400).json({ message: "folderIds array required" });
      const userFolders = await storage.getUserFolders(userId);
      const ownedIds = new Set(userFolders.map(f => f.id));
      // Reject requests that include folder IDs the caller does not own.
      for (const id of folderIds) {
        if (!ownedIds.has(id)) {
          return res.status(403).json({ message: "Access denied: one or more folder IDs do not belong to you" });
        }
      }
      for (let i = 0; i < folderIds.length; i++) {
        await storage.updateFolder(folderIds[i], { sortOrder: i });
      }
      const updated = await storage.getUserFolders(userId);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to reorder folders" });
    }
  });

  app.post("/api/sessions/:id/move", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== userId) return res.status(404).json({ message: "Session not found" });
      const { folderId } = (req.body ?? {}) as any;
      if (folderId !== null && folderId !== undefined) {
        const folder = await storage.getFolder(folderId);
        if (!folder || folder.userId !== userId || folder.deletedAt !== null) return res.status(403).json({ message: "Target folder not found or access denied" });
      }
      const updated = await storage.updateSession(session.id, { folderId: folderId ?? null });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to move session" });
    }
  });

  app.post("/api/sessions/:id/duplicate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (getTesterOwner(req as AuthenticatedRequest)) return res.status(403).json({ message: "Testers cannot duplicate sessions" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "Viewers cannot duplicate sessions" });
      const { folderId, name } = req.body || {};
      const targetFolderId = folderId ?? access.session.folderId ?? null;
      if (targetFolderId) {
        const folder = await storage.getFolder(targetFolderId);
        if (!folder || folder.userId !== userId || folder.deletedAt !== null) return res.status(403).json({ message: "Target folder not found or access denied" });
      }
      const copyFileCallback = async (srcKey: string): Promise<string> => {
        const ext = path.extname(srcKey || "");
        const newId = `${randomUUID()}${ext}`;
        const newObjectPath = `/uploads/${newId}`;
        const srcObjectName = toStorageObjectName(srcKey);
        const destObjectName = toStorageObjectName(newObjectPath);
        const localSrcFilename = srcKey.startsWith("/uploads/") ? srcKey.slice("/uploads/".length) : srcKey;
        const localSrcPath = path.join(UPLOADS_DIR, localSrcFilename);
        const localDestPath = path.join(UPLOADS_DIR, newId);
        try {
          await objectStorageClient.bucket(BUCKET_NAME).file(srcObjectName)
            .copy(objectStorageClient.bucket(BUCKET_NAME).file(destObjectName));
        } catch {
          try {
            await fs.copyFile(localSrcPath, localDestPath);
          } catch {
            return srcKey;
          }
        }
        return newObjectPath;
      };
      const newSession = await storage.duplicateSession(access.session.id, userId, targetFolderId, name, copyFileCallback);
      res.json(newSession);
    } catch (error) {
      res.status(500).json({ message: "Failed to duplicate session" });
    }
  });

  app.post("/api/sessions/:id/reset-to-photos", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== userId) return res.status(403).json({ message: "Only the session owner can reset" });
      await storage.resetSessionToPhotos(session.id);
      const displayName = (req as AuthenticatedRequest).user.claims.first_name || (req as AuthenticatedRequest).user.claims.username || userId;
      await logActivity(session.id, userId, displayName, "session_reset_to_photos", "session", session.id);
      broadcastToSession(session.id, { type: "sync", entity: "session", sessionId: session.id });
      res.json({ message: "Session reset to photos only" });
    } catch (error) {
      res.status(500).json({ message: "Failed to reset session" });
    }
  });

  app.get("/api/search/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const query = String(req.query.q || "");
      const searchInside = req.query.inside === "true";
      const filters: {
        status?: string;
        collaborator?: string;
        minFootage?: number;
        dateMonth?: number;
        dateYear?: number;
        wireType?: string;
      } = {};
      if (req.query.status && (req.query.status === "active" || req.query.status === "completed")) {
        filters.status = String(req.query.status);
      }
      if (req.query.collaborator) filters.collaborator = String(req.query.collaborator);
      if (req.query.minFootage) {
        const mf = parseInt(String(req.query.minFootage));
        if (!isNaN(mf) && mf > 0) filters.minFootage = mf;
      }
      if (req.query.dateMonth) {
        const dm = parseInt(String(req.query.dateMonth));
        if (!isNaN(dm) && dm >= 1 && dm <= 12) filters.dateMonth = dm;
      }
      if (req.query.dateYear) {
        const dy = parseInt(String(req.query.dateYear));
        if (!isNaN(dy) && dy >= 2000 && dy <= 2100) filters.dateYear = dy;
      }
      if (req.query.wireType) filters.wireType = String(req.query.wireType);
      const hasFilters = Object.keys(filters).length > 0;
      if (!query.trim() && !hasFilters) return res.json({ ownedIds: [], sharedIds: [], reasons: {}, entrySnippets: {} });
      const result = await storage.searchUserSessions(userId, query, searchInside, filters);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Search failed" });
    }
  });

  app.get("/api/sessions/:id/entries/search", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const query = String(req.query.q || "").trim();
      if (!query) return res.json({ matches: [], total: 0, encryptionActive: false });
      const userSettings = await storage.getUserSettings(userId);
      const encodingEnabled = !!(userSettings?.encodingEnabled);
      const result = await storage.searchSessionEntries(access.session.id, query, encodingEnabled);
      res.json({ matches: result.matches, total: result.matches.length, encryptionActive: result.encryptionActive });
    } catch (error) {
      res.status(500).json({ message: "Entry search failed" });
    }
  });

  // Photos - all operations verify session access
  app.get("/api/sessions/:sessionId/photos", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.sessionId), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (req.query.limit !== undefined || req.query.offset !== undefined) {
        const limit = Math.max(1, parseInt(req.query.limit) || 50);
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        const { photos, total } = await storage.getSessionPhotosPaginated(access.session.id, limit, offset);
        res.json({ photos, total, limit, offset });
      } else {
        const photos = await storage.getSessionPhotos(access.session.id);
        res.json(photos);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch photos" });
    }
  });

  app.post("/api/sessions/:sessionId/photos", isAuthenticated, async (req: any, res) => {
    const r = req as AuthenticatedRequest<PhotoCreateBody>; // typed access — TODO(req-typing): migrate all handlers
    try {
      const userId = resolveUserId(r);
      const access = await verifySessionAccess(parseInt(r.params.sessionId as string), userId, getTesterOwner(r));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to add photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const parsed = insertPhotoBodySchema.safeParse(r.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid photo data", errors: parsed.error.flatten().fieldErrors });
      }
      const displayName = r.user.claims.first_name
        ? `${r.user.claims.first_name} ${r.user.claims.last_name || ""}`.trim()
        : r.user.claims.email || userId;
      const ext = (parsed.data.originalFilename || "photo.jpg").match(/\.[^.]+$/)?.[0] || ".jpg";
      const photo = await storage.atomicCreatePhoto({
        ...parsed.data,
        sessionId: access.session.id,
        userId,
        uploadedBy: displayName,
      }, ext);
      console.log(`Photo uploaded: id=${photo.id}, by="${displayName}" (${userId}), session=${access.session.id}, filename="${photo.originalFilename}", at=${photo.createdAt.toISOString()}`);
      logActivity(access.session.id, userId, displayName, "photo_uploaded", "photo", photo.id, photo.originalFilename || undefined);
      broadcastToSession(access.session.id, { type: "sync", entity: "photos", sessionId: access.session.id });
      res.json(photo);
    } catch (error) {
      console.error("Error creating photo:", error);
      res.status(500).json({ message: "Failed to create photo" });
    }
  });

  app.patch("/api/photos/:id", isAuthenticated, typed(async (req, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.id));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit photos" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }

      const parsedPhoto = patchPhotoSchema.safeParse(req.body);
      if (!parsedPhoto.success) {
        return res.status(400).json({ message: "Invalid photo update data", errors: parsedPhoto.error.flatten().fieldErrors });
      }
      const { aisle, section, rotation, notes, isDetailShot, parentPhotoId, pinScale, linkReason, linkedPinLabel } = parsedPhoto.data;
      const safeUpdate: Record<string, any> = {};
      if (aisle !== undefined) safeUpdate.aisle = aisle;
      if (section !== undefined) safeUpdate.section = section;
      if (rotation !== undefined) safeUpdate.rotation = rotation;
      if (notes !== undefined) safeUpdate.notes = notes;
      if (isDetailShot !== undefined) safeUpdate.isDetailShot = isDetailShot;
      if (parentPhotoId !== undefined) safeUpdate.parentPhotoId = parentPhotoId;
      if (linkReason !== undefined) safeUpdate.linkReason = linkReason;
      if (linkedPinLabel !== undefined) safeUpdate.linkedPinLabel = linkedPinLabel;
      if (pinScale !== undefined && typeof pinScale === "number" && !isNaN(pinScale)) safeUpdate.pinScale = Math.max(0.5, Math.min(5, pinScale));
      if (Object.keys(safeUpdate).length === 0) return res.status(400).json({ message: "No valid fields to update" });
      const updated = await storage.updatePhoto(photo.id, safeUpdate);

      if (safeUpdate.section !== undefined || safeUpdate.aisle !== undefined) {
        const { db } = await import("./db");
        await db.transaction(async () => {
          const entryUpdate: Record<string, any> = {};
          if (safeUpdate.section !== undefined) entryUpdate.section = safeUpdate.section;
          if (safeUpdate.aisle !== undefined) entryUpdate.aisle = safeUpdate.aisle;

          const photoPins = await storage.getPhotoPins(photo.id);
          const committedPins = photoPins.filter(p => p.entryId);
          for (const pin of committedPins) {
            if (pin.entryId) {
              await storage.updateEntry(pin.entryId, entryUpdate);
            }
          }

          const sessionPhotos = await storage.getSessionPhotos(photo.sessionId);
          const detailShots = sessionPhotos.filter(p => p.parentPhotoId === photo.id);
          for (const ds of detailShots) {
            await storage.updatePhoto(ds.id, entryUpdate);
            const dsPins = await storage.getPhotoPins(ds.id);
            for (const dp of dsPins.filter(p => p.entryId)) {
              if (dp.entryId) await storage.updateEntry(dp.entryId, entryUpdate);
            }
          }
        });
      }

      if (safeUpdate.parentPhotoId !== undefined && safeUpdate.parentPhotoId !== null) {
        const parentPhoto = await storage.getPhoto(safeUpdate.parentPhotoId);
        if (parentPhoto && (parentPhoto.aisle || parentPhoto.section)) {
          const { db } = await import("./db");
          await db.transaction(async () => {
            const inheritUpdate: Record<string, any> = {};
            if (parentPhoto.aisle) inheritUpdate.aisle = parentPhoto.aisle;
            if (parentPhoto.section) inheritUpdate.section = parentPhoto.section;
            await storage.updatePhoto(photo.id, inheritUpdate);
            const dsPins = await storage.getPhotoPins(photo.id);
            for (const dp of dsPins.filter(p => p.entryId)) {
              if (dp.entryId) await storage.updateEntry(dp.entryId, inheritUpdate);
            }
          });
        }
      }

      res.json(updated);
      broadcastToSession(photo.sessionId, { type: "sync", entity: "photos", sessionId: photo.sessionId });
      if (safeUpdate.aisle !== undefined || safeUpdate.section !== undefined) {
        broadcastToSession(photo.sessionId, { type: "sync", entity: "entries", sessionId: photo.sessionId });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to update photo" });
    }
  }));

  app.post("/api/photos/:id/duplicate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const original = await storage.getPhoto(parseInt(req.params.id));
      if (!original) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(original.sessionId, userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to duplicate photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });
      const displayName = (req as AuthenticatedRequest).user.claims.first_name || (req as AuthenticatedRequest).user.claims.username || userId;

      // Generate a unique storage key for the copied file so the two photos are independent
      const ext = path.extname(original.objectStorageKey || "");
      const newId = `${randomUUID()}${ext}`;
      const newObjectPath = `/uploads/${newId}`;
      const srcObjectName = toStorageObjectName(original.objectStorageKey!);
      const destObjectName = toStorageObjectName(newObjectPath);
      const localSrcFilename = original.objectStorageKey!.startsWith("/uploads/")
        ? original.objectStorageKey!.slice("/uploads/".length)
        : original.objectStorageKey!;
      const localSrcPath = path.join(UPLOADS_DIR, localSrcFilename);
      const localDestPath = path.join(UPLOADS_DIR, newId);

      try {
        // Server-side GCS copy — no bandwidth cost, works even for large files
        await objectStorageClient.bucket(BUCKET_NAME).file(srcObjectName)
          .copy(objectStorageClient.bucket(BUCKET_NAME).file(destObjectName));
      } catch {
        // Fall back to local-disk copy if GCS is unavailable
        try {
          await fs.copyFile(localSrcPath, localDestPath);
        } catch (copyErr) {
          // Both copy paths failed — abort so no DB row is created pointing to
          // the original's storage object (which would cause data loss on delete).
          console.error("Photo duplicate: storage copy failed, aborting:", copyErr);
          return res.status(502).json({ message: "Failed to copy photo file — please try again" });
        }
      }

      const [newPhoto] = await db.insert(photos).values({
        sessionId:        original.sessionId,
        userId:           userId,
        uploadedBy:       original.uploadedBy,
        objectStorageKey: newObjectPath,
        originalFilename: original.originalFilename,
        mimeType:         original.mimeType,
        width:            original.width,
        height:           original.height,
        exifTimestamp:    original.exifTimestamp,
        exifGps:          original.exifGps,
        rotation:         original.rotation ?? 0,
        aisle:            original.aisle,
        section:          original.section,
        notes:            original.notes,
        isDetailShot:     original.isDetailShot ?? false,
        parentPhotoId:    original.parentPhotoId,
        pinScale:         original.pinScale ?? 1,
        fileSize:         original.fileSize,
        createdAt:        original.createdAt,
      }).returning();
      res.json(newPhoto);
      broadcastToSession(original.sessionId, { type: "sync", entity: "photos", sessionId: original.sessionId });
      logActivity(original.sessionId, userId, displayName, "photo_duplicated", "photo", newPhoto.id, original.originalFilename || undefined);
    } catch (error) {
      res.status(500).json({ message: "Failed to duplicate photo" });
    }
  });

  app.delete("/api/photos/:id", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.id));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const keepFile = req.query.keepFile === "1";

      await executePhotoDeletion(photo, {
        deletePhotoFromDb: (id) => storage.deletePhoto(id),
        isObjectKeyShared: (key, excludeId) => storage.isObjectKeyShared(key, excludeId),
        deleteStorageFile: async (key) => {
          const filename = key.startsWith("/uploads/") ? key.slice("/uploads/".length) : key.replace(/^\/objects\/uploads\//, "");
          const filePath = path.join(UPLOADS_DIR, filename);
          await objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(key)).delete({ ignoreNotFound: true }).catch(() => {});
          await fs.unlink(filePath).catch(() => {});
        },
      }, keepFile);

      logActivity(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, "photo_deleted", "photo", photo.id, photo.originalFilename || undefined);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete photo" });
    }
  });

  app.post("/api/sessions/:id/photos/restore", isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req as AuthenticatedRequest).user.claims.sub;
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to restore photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const body = req.body;
      if (!body.objectStorageKey || typeof body.objectStorageKey !== "string") {
        return res.status(400).json({ message: "objectStorageKey is required" });
      }

      const safePhotoData: any = {
        sessionId: access.session.id,
        userId,
        objectStorageKey: body.objectStorageKey,
      };
      const allowedFields = [
        "uploadedBy", "originalFilename", "mimeType", "width", "height",
        "exifTimestamp", "exifGps", "rotation", "aisle", "section", "notes",
        "isDetailShot", "parentPhotoId", "linkReason", "linkedPinLabel",
        "pinScale", "fileSize",
      ];
      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          safePhotoData[field] = body[field];
        }
      }

      const oldPhotoId = body.oldPhotoId ? parseInt(body.oldPhotoId) : null;
      const [lk1, lk2] = deriveAdvisoryLockKeys(access.session.userId);

      const { photo } = await db.transaction(async (tx) => {
        await acquireSharedEncodingLock(tx, lk1, lk2);
        const encKey = await getEncryptionKey(access.session.userId);
        const [insertedPhoto] = await tx.insert(photos).values(safePhotoData).returning();
        const idMap = new Map<number, number>();

        if (body.entries && Array.isArray(body.entries)) {
          for (const entryData of body.entries) {
            const { id: oldId, createdAt: _ca, updatedAt: _ua, ...entryFields } = entryData;
            let safeEntryData: any = {
              ...entryFields,
              sessionId: access.session.id,
              userId,
              photoId: (oldPhotoId && entryFields.photoId === oldPhotoId) ? insertedPhoto.id : (entryFields.photoId || null),
            };
            if (encKey) safeEntryData = encryptEntry(safeEntryData, encKey) as any;
            const parsed = insertEntrySchema.parse(safeEntryData);
            const [newEntry] = await tx.insert(entries).values(parsed).returning();
            if (oldId) idMap.set(oldId, newEntry.id);
          }
        }

        if (body.pins && Array.isArray(body.pins)) {
          for (const pinData of body.pins) {
            const { id: _id, createdAt: _ca, ...pinFields } = pinData;
            const restoredEntryId = pinFields.entryId ? (idMap.get(pinFields.entryId) ?? null) : null;
            await tx.insert(pins).values({ ...pinFields, photoId: insertedPhoto.id, entryId: restoredEntryId });
          }
        }

        return { photo: insertedPhoto, entryIdMap: idMap };
      });

      res.json(photo);
    } catch (error) {
      if (error instanceof Error && error.message === "ENCODING_TOGGLE_IN_PROGRESS") {
        return res.status(503).json({ message: "Encryption is being reconfigured — please retry in a moment." });
      }
      res.status(500).json({ message: "Failed to restore photo" });
    }
  });

  app.get("/api/sessions/:sessionId/pins", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (req.query.limit !== undefined || req.query.offset !== undefined) {
        const limit = Math.max(1, parseInt(req.query.limit) || 50);
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        const { pins, total } = await storage.getSessionPinsPaginated(access.session.id, limit, offset);
        res.json({ pins, total, limit, offset });
      } else {
        const sessionPins = await storage.getSessionPins(access.session.id);
        res.json(sessionPins);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pins" });
    }
  });

  // Entries CRUD - all operations verify session access + encoding
  app.get("/api/sessions/:sessionId/entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const encKey = isOwner(access.role) ? await getEncryptionKey(userId) : await getEncryptionKey(access.session.userId);
      if (req.query.limit) {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const { entries: rawEntries, total } = await storage.getSessionEntriesPaginated(access.session.id, limit, offset);
        const result = encKey ? rawEntries.map(e => decryptEntry(e, encKey, { strict: false }) as any) : rawEntries;
        res.json({ entries: result, total, limit, offset });
      } else {
        const rawEntries = await storage.getSessionEntries(access.session.id);
        const result = encKey ? rawEntries.map(e => decryptEntry(e, encKey, { strict: false }) as any) : rawEntries;
        res.json(result);
      }
    } catch (error) {
      console.error("Error fetching entries:", error);
      res.status(500).json({ message: "Failed to fetch entries" });
    }
  });

  app.post("/api/sessions/:sessionId/entries", isAuthenticated, async (req: any, res) => {
    const r = req as AuthenticatedRequest<EntryCreateBody>; // typed access — TODO(req-typing): migrate all handlers
    try {
      const userId = resolveUserId(r);
      const access = await verifySessionAccess(parseInt(r.params.sessionId as string), userId, getTesterOwner(r));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to add entries" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const [lk1, lk2] = deriveAdvisoryLockKeys(access.session.userId);
      const { entry, encKey } = await db.transaction(async (tx) => {
        await acquireSharedEncodingLock(tx, lk1, lk2);
        const key = await getEncryptionKey(access.session.userId);
        let rawData: any = { ...r.body, sessionId: access.session.id, userId };
        if (key) rawData = encryptEntry(rawData, key) as any;
        const parsed = insertEntrySchema.parse(rawData);
        const [inserted] = await tx.insert(entries).values(parsed).returning();
        return { entry: inserted, encKey: key };
      });
      if (entry.photoId) {
        try {
          await storage.resolveParentPinForDetailShot(entry.photoId, entry.id);
        } catch (resolveErr) {
          console.error("Non-fatal: failed to resolve parent pin for detail shot", resolveErr);
        }
      }
      await storage.updateSession(access.session.id, {});
      const result = encKey ? decryptEntry(entry, encKey) : entry;
      const username = r.user.claims.first_name || r.user.claims.email || userId;
      logActivity(access.session.id, userId, username, "entry_created", "entry", entry.id, result.reelTag || undefined);
      broadcastToSession(access.session.id, { type: "sync", entity: "entries", sessionId: access.session.id });
      res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "ENCODING_TOGGLE_IN_PROGRESS") {
        return res.status(503).json({ message: "Encryption is being reconfigured — please retry in a moment." });
      }
      console.error("Error creating entry:", error);
      res.status(500).json({ message: "Failed to create entry" });
    }
  });

  app.patch("/api/entries/:id", isAuthenticated, typed(async (req, res) => {
    try {
      const userId = resolveUserId(req);
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const access = await verifySessionAccess(entry.sessionId, userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Entry not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit entries" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const parsedEntry = patchEntrySchema.safeParse(req.body);
      if (!parsedEntry.success) {
        return res.status(400).json({ message: "Invalid entry update data", errors: parsedEntry.error.flatten().fieldErrors });
      }

      const { serverUpdatedAt, ...entryFields } = parsedEntry.data;
      if (serverUpdatedAt) {
        const current = new Date(entry.updatedAt).toISOString();
        const expected = new Date(serverUpdatedAt).toISOString();
        if (current !== expected) {
          return res.status(409).json({ message: "This entry was modified by another user — undo skipped." });
        }
      }

      const safeBody: Record<string, any> = {};
      for (const [key, val] of Object.entries(entryFields)) {
        if (val !== undefined) safeBody[key] = val;
      }
      const [lk1, lk2] = deriveAdvisoryLockKeys(access.session.userId);
      const { updated, encKey } = await db.transaction(async (tx) => {
        await acquireSharedEncodingLock(tx, lk1, lk2);
        const key = await getEncryptionKey(access.session.userId);
        let updateData: any = safeBody;
        if (key) updateData = encryptEntry(updateData, key) as any;
        const [row] = await tx.update(entries)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(entries.id, entry.id))
          .returning();
        return { updated: row, encKey: key };
      });
      const result = encKey && updated ? decryptEntry(updated, encKey) : updated;

      {
        const allSessionPins = await storage.getSessionPins(entry.sessionId);
        const linkedPin = allSessionPins.find(p => p.entryId === entry.id);

        if (linkedPin) {
          const pinSync: Record<string, any> = {};
          if (safeBody.reelTag !== undefined) pinSync.wireDetails = safeBody.reelTag;
          if (safeBody.footage !== undefined) pinSync.footage = safeBody.footage;
          if (safeBody.reelCount !== undefined) pinSync.reelCount = safeBody.reelCount;
          if (safeBody.manufacturer !== undefined) pinSync.vendorCode = safeBody.manufacturer;
          if (Object.keys(pinSync).length > 0) {
            await storage.updatePin(linkedPin.id, pinSync);
            broadcastToSession(entry.sessionId, { type: "sync", entity: "pins", sessionId: entry.sessionId });
          }
        }
      }

      if (safeBody.section !== undefined || safeBody.aisle !== undefined) {
        const allSessionPins = await storage.getSessionPins(entry.sessionId);
        const linkedPin = allSessionPins.find(p => p.entryId === entry.id);
        if (linkedPin) {
          const { db } = await import("./db");
          await db.transaction(async () => {
            const photoUpdate: Record<string, any> = {};
            if (safeBody.section !== undefined) photoUpdate.section = safeBody.section;
            if (safeBody.aisle !== undefined) photoUpdate.aisle = safeBody.aisle;
            await storage.updatePhoto(linkedPin.photoId, photoUpdate);
            const siblingPins = allSessionPins.filter(p => p.photoId === linkedPin.photoId && p.entryId && p.entryId !== entry.id);
            for (const sp of siblingPins) {
              if (sp.entryId) {
                await storage.updateEntry(sp.entryId, photoUpdate);
              }
            }
            const sessionPhotos = await storage.getSessionPhotos(entry.sessionId);
            const detailShots = sessionPhotos.filter(p => p.parentPhotoId === linkedPin.photoId);
            for (const ds of detailShots) {
              await storage.updatePhoto(ds.id, photoUpdate);
              const dsPins = allSessionPins.filter(p => p.photoId === ds.id && p.entryId);
              for (const dp of dsPins) {
                if (dp.entryId) {
                  await storage.updateEntry(dp.entryId, photoUpdate);
                }
              }
            }
          });
          broadcastToSession(entry.sessionId, { type: "sync", entity: "photos", sessionId: entry.sessionId });
        }
      }

      const username = (req as AuthenticatedRequest).user.claims.first_name || (req as AuthenticatedRequest).user.claims.email || userId;
      logActivity(entry.sessionId, userId, username, "entry_updated", "entry", entry.id);
      broadcastToSession(entry.sessionId, { type: "sync", entity: "entries", sessionId: entry.sessionId });
      res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "ENCODING_TOGGLE_IN_PROGRESS") {
        return res.status(503).json({ message: "Encryption is being reconfigured — please retry in a moment." });
      }
      console.error("Error updating entry:", error);
      res.status(500).json({ message: "Failed to update entry" });
    }
  }));

  app.delete("/api/entries/:id", isAuthenticated, async (req: any, res) => {
    try {
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(entry.sessionId, userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Entry not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete entries" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const { serverUpdatedAt: entryToken } = req.body || {};
      if (entryToken) {
        const current = new Date(entry.updatedAt).toISOString();
        const expected = new Date(entryToken).toISOString();
        if (current !== expected) {
          return res.status(409).json({ message: "This entry was modified by another user — undo skipped." });
        }
      }

      await storage.deleteEntry(entry.id);
      const username = (req as AuthenticatedRequest).user.claims.first_name || (req as AuthenticatedRequest).user.claims.email || userId;
      logActivity(entry.sessionId, userId, username, "entry_deleted", "entry", entry.id);
      broadcastToSession(entry.sessionId, { type: "sync", entity: "entries", sessionId: entry.sessionId });
      broadcastToSession(entry.sessionId, { type: "sync", entity: "pins", sessionId: entry.sessionId });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete entry" });
    }
  });

  app.get("/api/sessions/:id/incomplete-pins", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const result = await storage.getSessionIncompletePins(sessionId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch incomplete pins" });
    }
  });

  app.get("/api/sessions/:id/flagged-pins", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const flaggedPins = await storage.getSessionFlaggedPins(sessionId);
      const sessionPhotos = await storage.getSessionPhotos(sessionId);
      const photoMap = new Map(sessionPhotos.map(p => [p.id, p]));
      const detailParentIds = new Set(
        sessionPhotos.filter(p => p.isDetailShot && p.parentPhotoId).map(p => p.parentPhotoId!)
      );
      const sessionEntries = await storage.getSessionEntries(sessionId);
      const entryMap = new Map(sessionEntries.map(e => [e.id, e]));
      const enriched = flaggedPins.map(pin => {
        const photo = photoMap.get(pin.photoId);
        let photoUrl: string | null = null;
        if (photo?.objectStorageKey) {
          const key = photo.objectStorageKey;
          photoUrl = key.startsWith("/uploads/") ? key : key.startsWith("/objects/") ? key : `/uploads/${key}`;
        }
        const linkedEntry = pin.entryId ? entryMap.get(pin.entryId) : null;
        return {
          ...pin,
          photoUrl,
          photoFilename: photo?.originalFilename || null,
          photoAisle: photo?.aisle || null,
          photoSection: photo?.section || null,
          hasDetailPhoto: detailParentIds.has(pin.photoId),
          hasNotes: !!(linkedEntry?.notes),
          entryNotes: linkedEntry?.notes || null,
        };
      });
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch flagged pins" });
    }
  });

  app.get("/api/entries/:entryId/pin", isAuthenticated, async (req: any, res) => {
    try {
      const entryId = parseInt(req.params.entryId);
      const entry = await storage.getEntry(entryId);
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const access = await verifySessionAccess(entry.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Entry not found" });
      const sessionPins = await storage.getSessionPins(entry.sessionId);
      const pin = sessionPins.find(p => p.entryId === entryId);
      if (!pin) return res.status(404).json({ message: "No pin linked to this entry" });
      res.json(pin);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch entry pin" });
    }
  });

  app.patch("/api/pins/:pinId/flag", isAuthenticated, typed(async (req, res) => {
    try {
      const pin = await storage.getPin(parseInt(req.params.pinId));
      if (!pin) return res.status(404).json({ message: "Pin not found" });
      const photo = await storage.getPhoto(pin.photoId);
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Pin not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to flag pins" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }

      const parsedFlag = patchPinFlagSchema.safeParse(req.body);
      if (!parsedFlag.success) {
        return res.status(400).json({ message: "Invalid pin flag data", errors: parsedFlag.error.flatten().fieldErrors });
      }
      const { flagged, flagReason, serverUpdatedAt: flagToken } = parsedFlag.data;
      if (flagToken && pin.updatedAt) {
        const current = new Date(pin.updatedAt).toISOString();
        const expected = new Date(flagToken).toISOString();
        if (current !== expected) {
          return res.status(409).json({ message: "This pin was modified by another user — undo skipped." });
        }
      }
      const updated = await storage.updatePin(pin.id, {
        flagged: !!flagged,
        flagReason: flagged ? (flagReason || null) : null,
      });
      logActivity(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, flagged ? "pin_flagged" : "pin_unflagged", "pin", pin.id, flagReason || undefined);
      broadcastToSessionOwners(photo.sessionId, { type: flagged ? "pin_flagged" : "pin_unflagged", pinId: pin.id, flagged: !!flagged, flagReason: flagged ? (flagReason || null) : null });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pin flag" });
    }
  }));

  app.get("/api/sessions/:id/dismissed-duplicates", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const keys = await storage.getDismissedDuplicates(access.session.id);
      res.json(keys);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dismissed duplicates" });
    }
  });

  app.post("/api/sessions/:id/dismissed-duplicates", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }
      const { key, keys } = (req.body ?? {}) as any;
      if (keys && Array.isArray(keys)) {
        await storage.addDismissedDuplicatesBulk(access.session.id, keys);
        res.json({ success: true });
      } else if (key && typeof key === "string") {
        await storage.addDismissedDuplicate(access.session.id, key);
        res.json({ success: true });
      } else {
        return res.status(400).json({ message: "key or keys required" });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to dismiss duplicate" });
    }
  });

  app.delete("/api/sessions/:id/dismissed-duplicates", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }
      const { key } = (req.body ?? {}) as any;
      if (!key || typeof key !== "string") return res.status(400).json({ message: "key required" });
      await storage.removeDismissedDuplicate(access.session.id, key);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove dismissed duplicate" });
    }
  });

  // Pins - verify access through photo -> session chain
  app.get("/api/photos/:photoId/pins", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.photoId));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      const pins = await storage.getPhotoPins(photo.id);
      res.json(pins);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pins" });
    }
  });

  app.post("/api/photos/:photoId/pins", isAuthenticated, async (req: any, res) => {
    const r = req as AuthenticatedRequest<PinCreateBody>; // typed access — TODO(req-typing): migrate all handlers
    try {
      const photo = await storage.getPhoto(parseInt(r.params.photoId as string));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, r.user.claims.sub, getTesterOwner(r));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to add pins" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const data = insertPinSchema.parse({ ...r.body, photoId: photo.id });

      // atomicCreatePin enforces (photoId, label) uniqueness at the DB level,
      // preventing duplicates from double-clicks or concurrent collaborator inserts.
      const pin = await storage.atomicCreatePin(data);
      broadcastToSession(photo.sessionId, { type: "sync", entity: "pins", sessionId: photo.sessionId });
      res.json(pin);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "A pin with that label already exists on this photo" });
      }
      console.error("Error creating pin:", error);
      res.status(500).json({ message: "Failed to create pin" });
    }
  });

  app.patch("/api/pins/:id", isAuthenticated, typed(async (req, res) => {
    try {
      const pin = await storage.getPin(parseInt(req.params.id));
      if (!pin) return res.status(404).json({ message: "Pin not found" });
      const photo = await storage.getPhoto(pin.photoId);
      if (!photo) return res.status(404).json({ message: "Pin not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Pin not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit pins" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }

      const parsedPin = patchPinSchema.safeParse(req.body);
      if (!parsedPin.success) {
        return res.status(400).json({ message: "Invalid pin update data", errors: parsedPin.error.flatten().fieldErrors });
      }

      const pinToken = parsedPin.data.serverUpdatedAt;
      if (pinToken && pin.updatedAt) {
        const current = new Date(pin.updatedAt).toISOString();
        const expected = new Date(pinToken).toISOString();
        if (current !== expected) {
          return res.status(409).json({ message: "This pin was modified by another user — undo skipped." });
        }
      }
      const allowedPinFields = ['xPercent', 'yPercent', 'label', 'reelCount', 'wireDetails', 'vendorCode', 'footage', 'entryId', 'flagged'] as const;
      const safeUpdate: Record<string, any> = {};
      for (const key of allowedPinFields) {
        if (parsedPin.data[key] !== undefined) safeUpdate[key] = parsedPin.data[key];
      }
      const updated = await storage.updatePin(pin.id, safeUpdate);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pin" });
    }
  }));

  app.delete("/api/pins/:id", isAuthenticated, async (req: any, res) => {
    try {
      const pin = await storage.getPin(parseInt(req.params.id));
      if (!pin) return res.status(404).json({ message: "Pin not found" });
      const photo = await storage.getPhoto(pin.photoId);
      if (!photo) return res.status(404).json({ message: "Pin not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Pin not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete pins" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }

      const { serverUpdatedAt: pinDeleteToken } = req.body || {};
      if (pinDeleteToken && pin.updatedAt) {
        const current = new Date(pin.updatedAt).toISOString();
        const expected = new Date(pinDeleteToken).toISOString();
        if (current !== expected) {
          return res.status(409).json({ message: "This pin was modified by another user — undo skipped." });
        }
      }

      if (pin.entryId) {
        await storage.deleteEntry(pin.entryId);
        broadcastToSession(photo.sessionId, { type: "sync", entity: "entries", sessionId: photo.sessionId });
      }
      await storage.deletePin(pin.id);
      logActivity(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, "pin_deleted", "pin", pin.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete pin" });
    }
  });

  // Atomic batch-keep: keeps one pin from a duplicate group and deletes all others
  // in a single DB transaction. Concurrent keeps are safe — already-deleted pins
  // are silently skipped rather than causing a 404.
  app.delete("/api/sessions/:sessionId/pins/keep/:pinIdToKeep", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const pinIdToKeep = parseInt(req.params.pinIdToKeep);
      const { pinGroupIds } = req.body ?? {};

      if (!Array.isArray(pinGroupIds) || !pinGroupIds.every((id: unknown) => Number.isInteger(id))) {
        return res.status(400).json({ message: "pinGroupIds must be an array of integers" });
      }

      const access = await verifySessionAccess(sessionId, resolveUserId(req as AuthenticatedRequest), getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete pins" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      // Verify the pin we're keeping actually belongs to this session.
      // If the pin no longer exists it was already deleted by a concurrent
      // keep that won the race — treat this as a successful no-op rather
      // than an error so both users get a clean result.
      const keeperPin = await storage.getPin(pinIdToKeep);
      if (!keeperPin) return res.json({ success: true, deletedCount: 0 });
      const keeperPhoto = await storage.getPhoto(keeperPin.photoId);
      if (!keeperPhoto || keeperPhoto.sessionId !== sessionId) {
        return res.status(403).json({ message: "Pin does not belong to this session" });
      }

      const pinIdsToDelete = (pinGroupIds as number[]).filter((id) => id !== pinIdToKeep);
      // sessionId is passed to storage so the DELETE is scoped to this session
      // even if the client submits IDs from another session (defense-in-depth).
      const { deletedCount } = await storage.batchKeepPins(sessionId, pinIdToKeep, pinIdsToDelete);

      broadcastToSession(sessionId, { type: "sync", entity: "pins", sessionId });
      broadcastToSession(sessionId, { type: "sync", entity: "entries", sessionId });
      logActivity(sessionId, resolveUserId(req as AuthenticatedRequest), (req as AuthenticatedRequest).user?.claims?.username, "pins_batch_kept", "pin", pinIdToKeep);

      res.json({ success: true, deletedCount });
    } catch (error) {
      console.error("Error in batch-keep pins:", error);
      res.status(500).json({ message: "Failed to process keep operation" });
    }
  });

  app.put("/api/photos/:photoId/draft-pins", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.photoId));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit pins" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }

      const { pins: pinData, deletedClientIds } = (req.body ?? {}) as any;
      if (!Array.isArray(pinData)) return res.status(400).json({ message: "pins must be an array" });
      // replaceDraftPins uses per-row upsert by draftClientId and only deletes
      // pins explicitly listed in deletedClientIds — never by absence from the set.
      const saved = await storage.replaceDraftPins(photo.id, pinData, Array.isArray(deletedClientIds) ? deletedClientIds : undefined);
      res.json(saved);
    } catch (error) {
      console.error("Error saving draft pins:", error);
      res.status(500).json({ message: "Failed to save draft pins" });
    }
  });

  const labelResultsCache = new Map<number, { results: Array<{ pinId: number; pinLabel: string; rawText: string | null; readable: boolean }> }>();

  async function loadPhotoBuffer(photoKey: string): Promise<Buffer> {
    const photoFilename = photoKey.startsWith("/uploads/") ? photoKey.slice("/uploads/".length) : photoKey.replace(/^\/objects\/uploads\//, "");
    try {
      const gcsFile = objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(photoKey));
      const [existsInGcs] = await Promise.race([
        gcsFile.exists(),
        new Promise<[boolean]>(resolve => setTimeout(() => { console.warn("[GCS] exists() timed out for photo key %s — treating as not found", photoKey); resolve([false]); }, 5000)),
      ]);
      if (existsInGcs) {
        const [downloaded] = await gcsFile.download();
        return downloaded;
      }
    } catch {}
    return fs.readFile(path.join(UPLOADS_DIR, photoFilename));
  }

  app.post("/api/photos/:photoId/analyze-labels", isAuthenticated, cropAiRateLimiter, async (req: any, res) => {
    taskTracker.increment();
    let _sid: number | null = null;
    try {
      const photoId = parseInt(req.params.photoId);
      const photo = await storage.getPhoto(photoId);
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to analyze labels" });
      _sid = photo.sessionId;
      taskTracker.startSession(_sid, "scan");

      const { pins: pinData } = (req.body ?? {}) as any;
      if (!Array.isArray(pinData) || pinData.length === 0) {
        return res.status(400).json({ message: "pins array is required" });
      }
      if (pinData.length > MAX_PINS_PER_CROP_REQUEST) {
        return res.status(400).json({ message: `Too many pins: maximum ${MAX_PINS_PER_CROP_REQUEST} per request.` });
      }

      const photoBuffer = await loadPhotoBuffer(photo.objectStorageKey);

      let orientedBuffer = photoBuffer;
      const manualRotation = (photo.rotation ?? 0) % 360;
      let pipeline = sharp(photoBuffer).rotate();
      if (manualRotation !== 0) {
        pipeline = pipeline.rotate(manualRotation);
      }
      orientedBuffer = await pipeline.toBuffer();

      const MAX_BATCH = 20;
      const allResults: Array<{ pinId: number; pinLabel: string; rawText: string | null; readable: boolean }> = [];
      let anyTruncated = false;
      let totalSkipped = 0;

      for (let i = 0; i < pinData.length; i += MAX_BATCH) {
        const batch = pinData.slice(i, i + MAX_BATCH);
        try {
          const { results: crops, truncated: batchTruncated, skippedCount } = await cropPhoto(orientedBuffer, batch.map((p: any) => ({
            pinId: p.pinId,
            x: p.x,
            y: p.y,
            zoomLevel: p.zoomLevel ?? 1,
          })));
          if (batchTruncated) {
            anyTruncated = true;
            totalSkipped += skippedCount;
            console.warn(`[analyze-labels] cropPhoto output truncated at 50 MB for photoId=${photoId}, batch i=${i}, skipped=${skippedCount}`);
          }

          const imageMessages = crops.map((crop) => ({
            type: "image_url" as const,
            image_url: { url: `data:image/jpeg;base64,${crop.base64}`, detail: "high" as const },
          }));

          const response = await getPoeProvider().completeVision({
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Read the text on each of these ${crops.length} wire reel label images. Return a JSON object with a "labels" array in the same order. Use an empty string when a label is unreadable.`,
                  },
                  ...imageMessages,
                ],
              },
            ],
            expectedLabels: crops.length,
            useCase: "label-scan",
            maxTokens: 2000,
            userId: (req as AuthenticatedRequest).user?.claims?.sub ?? null,
          });
          allResults.push(...buildScanResultsForPins(
            batch.map((pin, index) => ({
              pinId: pin.pinId,
              pinLabel: pin.pinLabel || `P${String(index + i + 1).padStart(3, "0")}`,
            })),
            crops,
            response.labels,
          ));
        } catch (subErr) {
          if (subErr instanceof PoeProviderError) throw subErr;
          for (let j = 0; j < batch.length; j++) {
            allResults.push({
              pinId: batch[j].pinId,
              pinLabel: batch[j].pinLabel || `P${String(j + i + 1).padStart(3, "0")}`,
              rawText: null,
              readable: false,
            });
          }
        }
      }

      const cacheEntry = { results: allResults };

      try {
        const scanResultRows = allResults.map((r) => ({
          sessionId: photo.sessionId,
          photoId,
          pinId: r.pinId,
          pinLabel: r.pinLabel,
          rawText: r.rawText,
          readable: r.readable,
          scannedBy: (req as AuthenticatedRequest).user?.claims?.sub || null,
        }));
        await storage.upsertScanResults(scanResultRows);
        labelResultsCache.set(photoId, cacheEntry);
        broadcastToSession(photo.sessionId, { type: "sync", entity: "scan_results", sessionId: photo.sessionId });
      } catch (e) {
        console.error("[analyze-labels] Failed to persist scan results:", e);
        return respondWithScanResultsPersistenceFailure(res);
      }

      res.json({ ...cacheEntry, truncated: anyTruncated, truncatedCount: totalSkipped });
    } catch (error) {
      if (error instanceof PoeProviderError) {
        return res.status(error.statusCode).json({ message: "Label analysis is temporarily unavailable", code: error.code });
      }
      console.error("Error analyzing labels:", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ message: "Failed to analyze labels" });
    } finally {
      taskTracker.decrement();
      if (_sid !== null) taskTracker.endSession(_sid, "scan");
    }
  });

  app.post("/api/sessions/:sessionId/analyze-labels", isAuthenticated, cropAiRateLimiter, async (req: any, res) => {
    const _sid = parseInt(req.params.sessionId);
    taskTracker.increment();
    try {
      const sessionId = parseInt(req.params.sessionId);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to analyze labels" });
      taskTracker.startSession(_sid, "scan");

      const { pins: pinData } = (req.body ?? {}) as any;
      if (!Array.isArray(pinData) || pinData.length === 0) {
        return res.status(400).json({ message: "pins array is required" });
      }
      if (pinData.length > MAX_PINS_PER_CROP_REQUEST) {
        return res.status(400).json({ message: `Too many pins: maximum ${MAX_PINS_PER_CROP_REQUEST} per request.` });
      }

      const uniquePhotoIds = [...new Set(pinData.map((p: any) => p.photoId as number))];
      const photoBufferMap = new Map<number, Buffer>();
      for (const photoId of uniquePhotoIds) {
        const photo = await storage.getPhoto(photoId);
        if (!photo || photo.sessionId !== sessionId) continue;
        const raw = await loadPhotoBuffer(photo.objectStorageKey);
        const manualRotation = (photo.rotation ?? 0) % 360;
        let pipeline = sharp(raw).rotate();
        if (manualRotation !== 0) pipeline = pipeline.rotate(manualRotation);
        photoBufferMap.set(photoId, await pipeline.toBuffer());
      }

      const allCropRequests: Array<{ photoId: number; pinId: number; pinLabel: string; x: number; y: number; zoomLevel: number }> = [];
      for (const p of pinData) {
        if (!photoBufferMap.has(p.photoId)) continue;
        allCropRequests.push({
          photoId: p.photoId,
          pinId: p.pinId,
          pinLabel: p.pinLabel || `P${String(p.pinId).padStart(3, "0")}`,
          x: p.x,
          y: p.y,
          zoomLevel: p.zoomLevel ?? 1,
        });
      }

      const MAX_BATCH = 20;
      const allResults: Array<{ pinId: number; pinLabel: string; rawText: string | null; readable: boolean }> = [];
      const totalBatches = Math.ceil(allCropRequests.length / MAX_BATCH);
      let anyTruncated = false;
      let totalSkipped = 0;

      for (let i = 0; i < allCropRequests.length; i += MAX_BATCH) {
        const batch = allCropRequests.slice(i, i + MAX_BATCH);
        try {
          const cropsByPhoto = new Map<number, typeof batch>();
          for (const item of batch) {
            if (!cropsByPhoto.has(item.photoId)) cropsByPhoto.set(item.photoId, []);
            cropsByPhoto.get(item.photoId)!.push(item);
          }

          const crops: Array<{ pinId: number; base64: string }> = [];
          for (const [photoId, items] of cropsByPhoto) {
            const buf = photoBufferMap.get(photoId)!;
            const { results: photoCrops, truncated: photoTruncated, skippedCount } = await cropPhoto(buf, items.map((it) => ({
              pinId: it.pinId,
              x: it.x,
              y: it.y,
              zoomLevel: it.zoomLevel,
            })));
            if (photoTruncated) {
              anyTruncated = true;
              totalSkipped += skippedCount;
              console.warn(`[session-analyze-labels] cropPhoto output truncated at 50 MB for photoId=${photoId}, batch i=${i}, skipped=${skippedCount}`);
            }
            crops.push(...photoCrops);
          }

          const cropOrder = batch.map((b) => b.pinId);
          const orderedCrops = cropOrder.map((pid) => crops.find((c) => c.pinId === pid)!).filter(Boolean);

          const imageMessages = orderedCrops.map((crop) => ({
            type: "image_url" as const,
            image_url: { url: `data:image/jpeg;base64,${crop.base64}`, detail: "high" as const },
          }));

          const response = await getPoeProvider().completeVision({
            messages: [{
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Read the text on each of these ${orderedCrops.length} wire reel label images. Return a JSON object with a "labels" array in the same order. Use an empty string when a label is unreadable.`,
                },
                ...imageMessages,
              ],
            }],
            expectedLabels: orderedCrops.length,
            useCase: "session-scan",
            maxTokens: 2000,
            userId: (req as AuthenticatedRequest).user?.claims?.sub ?? null,
          });
          allResults.push(...buildScanResultsForPins(
            batch.map((pin) => ({ pinId: pin.pinId, pinLabel: pin.pinLabel })),
            orderedCrops,
            response.labels,
          ));
        } catch (subErr) {
          if (subErr instanceof PoeProviderError) throw subErr;
          for (let j = 0; j < batch.length; j++) {
            allResults.push({
              pinId: batch[j].pinId,
              pinLabel: batch[j].pinLabel,
              rawText: null,
              readable: false,
            });
          }
        }

        const batchIndex = Math.floor(i / MAX_BATCH) + 1;
        broadcastToSession(sessionId, { type: "label_progress", sessionId, done: batchIndex, total: totalBatches });
      }

      try {
        const scanResultRows = allResults.map((r) => {
          const pinEntry = pinData.find((p: any) => p.pinId === r.pinId);
          return {
            sessionId,
            photoId: pinEntry?.photoId ?? 0,
            pinId: r.pinId,
            pinLabel: r.pinLabel,
            rawText: r.rawText,
            readable: r.readable,
            scannedBy: (req as AuthenticatedRequest).user?.claims?.sub || null,
          };
        });
        await storage.upsertScanResults(scanResultRows);
        broadcastToSession(sessionId, { type: "sync", entity: "scan_results", sessionId });
      } catch (e) {
        console.error("[session-analyze-labels] Failed to persist scan results:", e);
        return respondWithScanResultsPersistenceFailure(res);
      }

      res.json({ results: allResults, totalBatches, truncated: anyTruncated, truncatedCount: totalSkipped });
    } catch (error) {
      if (error instanceof PoeProviderError) {
        return res.status(error.statusCode).json({ message: "Label analysis is temporarily unavailable", code: error.code });
      }
      console.error("Error analyzing session labels:", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ message: "Failed to analyze labels" });
    } finally {
      taskTracker.decrement();
      taskTracker.endSession(_sid, "scan");
    }
  });

  app.post("/api/photos/:photoId/sample-pixel", isAuthenticated, async (req: any, res) => {
    try {
      const photoId = parseInt(req.params.photoId);
      const photo = await storage.getPhoto(photoId);
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Photo not found" });

      const { xPercent, yPercent } = (req.body ?? {}) as any;
      if (typeof xPercent !== "number" || typeof yPercent !== "number") {
        return res.status(400).json({ message: "xPercent and yPercent required" });
      }

      const photoBuffer = await loadPhotoBuffer(photo.objectStorageKey);
      let pipeline = sharp(photoBuffer).rotate();
      const manualRotation = (photo.rotation ?? 0) % 360;
      if (manualRotation !== 0) pipeline = pipeline.rotate(manualRotation);

      const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
      const { width, height, channels } = info;

      const px = Math.round((xPercent / 100) * (width - 1));
      const py = Math.round((yPercent / 100) * (height - 1));
      const idx = (py * width + px) * channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // Also sample a 5x5 area around the click for a better average
      const samples: { r: number; g: number; b: number }[] = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const sx = Math.max(0, Math.min(width - 1, px + dx));
          const sy = Math.max(0, Math.min(height - 1, py + dy));
          const si = (sy * width + sx) * channels;
          samples.push({ r: data[si], g: data[si + 1], b: data[si + 2] });
        }
      }
      const avg = {
        r: Math.round(samples.reduce((s, p) => s + p.r, 0) / samples.length),
        g: Math.round(samples.reduce((s, p) => s + p.g, 0) / samples.length),
        b: Math.round(samples.reduce((s, p) => s + p.b, 0) / samples.length),
      };

      console.log(`[sample-pixel] (${xPercent.toFixed(1)}%, ${yPercent.toFixed(1)}%) → exact rgb(${r},${g},${b}) | 5x5 avg rgb(${avg.r},${avg.g},${avg.b})`);
      res.json({ exact: { r, g, b }, avg, width, height, px, py });
    } catch (error) {
      console.error("Error sampling pixel:", error);
      res.status(500).json({ message: "Failed to sample pixel" });
    }
  });

  app.post("/api/photos/:photoId/detect-received", isAuthenticated, async (req: any, res) => {
    try {
      const photoId = parseInt(req.params.photoId);
      const photo = await storage.getPhoto(photoId);
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Photo not found" });

      const photoBuffer = await loadPhotoBuffer(photo.objectStorageKey);

      let pipeline = sharp(photoBuffer).rotate();
      const manualRotation = (photo.rotation ?? 0) % 360;
      if (manualRotation !== 0) pipeline = pipeline.rotate(manualRotation);
      pipeline = pipeline.resize(1200, 1200, { fit: "inside", withoutEnlargement: true });

      const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
      const { width, height, channels } = info;

      // --- HSV green detection on raw pixels (hue ~90–160°, sat >40%, val >25%) ---
      const totalPixels = width * height;
      const greenMask = new Uint8Array(totalPixels);
      for (let i = 0; i < totalPixels; i++) {
        const rf = data[i * channels]     / 255;
        const gf = data[i * channels + 1] / 255;
        const bf = data[i * channels + 2] / 255;
        const cmax = Math.max(rf, gf, bf);
        const cmin = Math.min(rf, gf, bf);
        const delta = cmax - cmin;

        const val = cmax;
        const sat = cmax === 0 ? 0 : delta / cmax;

        if (val < 0.25 || sat < 0.40) continue;

        let hue = 0;
        if (delta === 0) continue;
        if (cmax === rf) {
          hue = 60 * (((gf - bf) / delta) % 6);
          if (hue < 0) hue += 360;
        } else if (cmax === gf) {
          hue = 60 * ((bf - rf) / delta + 2);
        } else {
          hue = 60 * ((rf - gf) / delta + 4);
        }

        if (hue >= 90 && hue <= 160) {
          greenMask[i] = 1;
        }
      }

      const CELL = 20;
      const gridW = Math.ceil(width / CELL);
      const gridH = Math.ceil(height / CELL);
      const greenCells = new Uint8Array(gridW * gridH);

      for (let cy = 0; cy < gridH; cy++) {
        for (let cx = 0; cx < gridW; cx++) {
          let greenCount = 0, totalCount = 0;
          const px0 = cx * CELL, px1 = Math.min((cx + 1) * CELL, width);
          const py0 = cy * CELL, py1 = Math.min((cy + 1) * CELL, height);
          for (let py = py0; py < py1; py++) {
            for (let px = px0; px < px1; px++) {
              greenCount += greenMask[py * width + px];
              totalCount++;
            }
          }
          if (totalCount > 0 && greenCount / totalCount > 0.08) {
            greenCells[cy * gridW + cx] = 1;
          }
        }
      }

      const visited = new Uint8Array(gridW * gridH);
      const blobs: Array<{ count: number; sumX: number; sumY: number; minX: number; maxX: number; minY: number; maxY: number }> = [];

      for (let cy = 0; cy < gridH; cy++) {
        for (let cx = 0; cx < gridW; cx++) {
          const idx = cy * gridW + cx;
          if (!greenCells[idx] || visited[idx]) continue;
          const queue: number[] = [idx];
          visited[idx] = 1;
          let count = 0, sumX = 0, sumY = 0;
          let minX = cx, maxX = cx, minY = cy, maxY = cy;
          while (queue.length > 0) {
            const cur = queue.shift()!;
            count++;
            const curX = cur % gridW;
            const curY = Math.floor(cur / gridW);
            sumX += curX;
            sumY += curY;
            if (curX < minX) minX = curX;
            if (curX > maxX) maxX = curX;
            if (curY < minY) minY = curY;
            if (curY > maxY) maxY = curY;
            const neighbors = [
              curY > 0 ? (curY - 1) * gridW + curX : -1,
              curY < gridH - 1 ? (curY + 1) * gridW + curX : -1,
              curX > 0 ? curY * gridW + (curX - 1) : -1,
              curX < gridW - 1 ? curY * gridW + (curX + 1) : -1,
            ];
            for (const n of neighbors) {
              if (n >= 0 && greenCells[n] && !visited[n]) {
                visited[n] = 1;
                queue.push(n);
              }
            }
          }
          blobs.push({ count, sumX, sumY, minX, maxX, minY, maxY });
        }
      }

      // Known label: 3"x5". Accept aspect ratios 0.4–4.5 to cover portrait,
      // landscape, and perspective distortion. Reject obvious false positives.
      const MIN_ASPECT = 0.4;
      const MAX_ASPECT = 4.5;

      const detections = blobs
        .filter(b => {
          if (b.count < 2) return false;
          const blobW = (b.maxX - b.minX + 1) * CELL;
          const blobH = (b.maxY - b.minY + 1) * CELL;
          const aspect = blobW / blobH;
          return aspect >= MIN_ASPECT && aspect <= MAX_ASPECT;
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map(b => ({
          xPercent: Math.max(1, Math.min(99, ((b.sumX / b.count * CELL + CELL / 2) / width) * 100)),
          yPercent: Math.max(1, Math.min(99, ((b.sumY / b.count * CELL + CELL / 2) / height) * 100)),
          x1Percent: Math.max(0, (b.minX * CELL / width) * 100),
          y1Percent: Math.max(0, (b.minY * CELL / height) * 100),
          x2Percent: Math.min(100, ((b.maxX + 1) * CELL / width) * 100),
          y2Percent: Math.min(100, ((b.maxY + 1) * CELL / height) * 100),
        }));

      res.json({ detections });
    } catch (error) {
      console.error("Error detecting received labels:", error);
      res.status(500).json({ message: "Failed to detect labels" });
    }
  });

  app.get("/api/photos/:photoId/label-cache", isAuthenticated, async (req: any, res) => {
    try {
      const photoId = parseInt(req.params.photoId);
      const photo = await storage.getPhoto(photoId);
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Photo not found" });

      const cached = labelResultsCache.get(photoId);
      if (cached) {
        return res.json(cached);
      }
      res.json({ results: null });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch label cache" });
    }
  });


  app.get("/api/sessions/:id/scan-results", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const results = await storage.getSessionScanResults(sessionId);
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch scan results" });
    }
  });

  app.delete("/api/sessions/:id/scan-results", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "No permission" });
      await storage.deleteSessionScanResults(sessionId);
      broadcastToSession(sessionId, { type: "sync", entity: "scan_results", sessionId });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete scan results" });
    }
  });

  // Called by ReviewTab on mount to anchor the review cohort from server-side
  // presence before any assignments are shown. Uses a conditional UPDATE so
  // concurrent mounts from multiple clients are safe — only one write wins.
  app.post("/api/sessions/:id/review-cohort", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });

      // If already anchored, return the existing cohort.
      if (access.session.reviewCohort) {
        return res.json({ cohort: JSON.parse(access.session.reviewCohort) });
      }

      const userId = (req as AuthenticatedRequest).user.claims.sub;
      const username = (req as AuthenticatedRequest).user.claims.first_name || (req as AuthenticatedRequest).user.claims.username || userId;
      const onlineNow = getOnlineUsers(sessionId).sort((a, b) => a.userId.localeCompare(b.userId));
      // Always include the requesting user (they may not have joined the WS room yet).
      if (!onlineNow.find(u => u.userId === userId)) {
        onlineNow.push({ userId, username });
        onlineNow.sort((a, b) => a.userId.localeCompare(b.userId));
      }

      const anchored = await storage.setSessionReviewCohort(sessionId, onlineNow);
      if (anchored) {
        broadcastToSession(sessionId, { type: "review_cohort_set", cohort: onlineNow });
        return res.json({ cohort: onlineNow });
      }

      // Another request raced and won — re-fetch to get the winner's value.
      const fresh = await storage.getSession(sessionId);
      const cohort = fresh?.reviewCohort ? JSON.parse(fresh.reviewCohort) : onlineNow;
      res.json({ cohort });
    } catch (error) {
      res.status(500).json({ message: "Failed to anchor review cohort" });
    }
  });

  app.get("/api/sessions/:id/review-responses", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const responses = await storage.getSessionReviewResponses(sessionId);
      res.json(responses);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch review responses" });
    }
  });

  app.post("/api/sessions/:id/review-responses", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const { entryId, verdict, flagReason } = (req.body ?? {}) as any;
      if (!entryId || !verdict || !["approved", "flagged"].includes(verdict)) {
        return res.status(400).json({ message: "entryId and verdict (approved|flagged) are required" });
      }
      const entry = await storage.getEntry(entryId);
      if (!entry || entry.sessionId !== sessionId) {
        return res.status(400).json({ message: "Entry does not belong to this session" });
      }
      const userId = (req as AuthenticatedRequest).user.claims.sub;
      const username = (req as AuthenticatedRequest).user.claims.first_name || (req as AuthenticatedRequest).user.claims.username || userId;
      const response = await storage.upsertReviewResponse({
        sessionId,
        entryId,
        userId,
        username,
        verdict,
        flagReason: verdict === "flagged" ? (flagReason || null) : null,
      });

      // Anchor the review cohort on the first response for this session.
      // `setSessionReviewCohort` is a conditional UPDATE (WHERE review_cohort IS NULL)
      // so concurrent first-response requests are safe — only one wins the write.
      // The cohort is captured from server-side presence so all clients compute
      // identical entry→reviewer mappings regardless of their join timing.
      const sessionForCohort = await storage.getSession(sessionId);
      if (sessionForCohort && !sessionForCohort.reviewCohort) {
        const onlineNow = getOnlineUsers(sessionId)
          .sort((a, b) => a.userId.localeCompare(b.userId));
        // Always include the submitting user even if they aren't in the WS room yet.
        if (!onlineNow.find(u => u.userId === userId)) {
          onlineNow.push({ userId, username });
          onlineNow.sort((a, b) => a.userId.localeCompare(b.userId));
        }
        const anchored = await storage.setSessionReviewCohort(sessionId, onlineNow);
        if (anchored) {
          broadcastToSession(sessionId, { type: "review_cohort_set", cohort: onlineNow });
        }
      }

      res.json(response);
    } catch (error) {
      res.status(500).json({ message: "Failed to save review response" });
    }
  });

  app.delete("/api/sessions/:id/review-responses/:entryId", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const entryId = parseInt(req.params.entryId);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const userId = (req as AuthenticatedRequest).user.claims.sub;
      await storage.deleteReviewResponse(sessionId, entryId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete review response" });
    }
  });

  app.post("/api/sessions/:id/review-responses/resolve", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to resolve review flags" });
      const { entryId } = (req.body ?? {}) as any;
      if (!entryId) return res.status(400).json({ message: "entryId is required" });
      const entry = await storage.getEntry(entryId);
      if (!entry || entry.sessionId !== sessionId) {
        return res.status(400).json({ message: "Entry does not belong to this session" });
      }
      await storage.resolveReviewResponsesByEntry(sessionId, entryId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to resolve review responses" });
    }
  });

  app.delete("/api/pins/:pinId", isAuthenticated, async (req: any, res) => {
    try {
      const pin = await storage.getPin(parseInt(req.params.pinId));
      if (!pin) return res.status(404).json({ message: "Pin not found" });
      const photo = await storage.getPhoto(pin.photoId);
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Pin not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete pins" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }
      if (pin.entryId) {
        await storage.deleteEntry(pin.entryId);
        broadcastToSession(photo.sessionId, { type: "sync", entity: "entries", sessionId: photo.sessionId });
      }
      await storage.deletePin(pin.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting pin:", error);
      res.status(500).json({ message: "Failed to delete pin" });
    }
  });

  // Collaborators
  app.get("/api/sessions/:id/collaborators", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const collaborators = await storage.getSessionCollaborators(access.session.id);
      res.json({ collaborators, owner: { userId: access.session.userId } });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch collaborators" });
    }
  });

  const addCollaboratorBody = z.object({
    username: z.string().min(1, "Username is required"),
    role: z.enum(["editor", "viewer"]).default("editor"),
  });

  app.post("/api/sessions/:id/collaborators", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can add collaborators" });
      const collabParse = addCollaboratorBody.safeParse(req.body ?? {});
      if (!collabParse.success) return res.status(400).json({ message: "Invalid request body", errors: collabParse.error.flatten().fieldErrors });
      const { username, role } = collabParse.data;
      if (username === (req as AuthenticatedRequest).user.claims.username) return res.status(400).json({ message: "You cannot add yourself as a collaborator" });
      const existing = await storage.getSessionCollaborators(access.session.id);
      if (existing.find(c => c.username === username)) {
        return res.status(400).json({ message: "This user is already a collaborator" });
      }
      const collaborator = await storage.addCollaborator({
        sessionId: access.session.id,
        userId: username,
        username,
        role,
      });
      logActivity(access.session.id, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, "collaborator_added", "collaborator", collaborator.id, `${username} as ${role}`);
      res.json(collaborator);
    } catch (error) {
      console.error("Error adding collaborator:", error);
      res.status(500).json({ message: "Failed to add collaborator" });
    }
  });

  app.delete("/api/sessions/:id/collaborators/:collabId", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can remove collaborators" });
      const collabId = parseInt(req.params.collabId);
      const removed = await storage.removeCollaborator(collabId, access.session.id);
      if (!removed) return res.status(404).json({ message: "Collaborator not found" });
      evictSessionUserSockets(access.session.id, removed.userId, "Session access revoked");
      logActivity(access.session.id, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, "collaborator_removed", "collaborator", collabId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove collaborator" });
    }
  });

  const updateCollaboratorRoleBody = z.object({
    role: z.enum(["editor", "viewer"], { errorMap: () => ({ message: "Role must be editor or viewer" }) }),
  });

  app.patch("/api/sessions/:id/collaborators/:collabId", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can change roles" });
      const roleParse = updateCollaboratorRoleBody.safeParse(req.body ?? {});
      if (!roleParse.success) return res.status(400).json({ message: "Invalid request body", errors: roleParse.error.flatten().fieldErrors });
      const { role } = roleParse.data;
      const updated = await storage.updateCollaboratorRole(parseInt(req.params.collabId), access.session.id, role);
      if (!updated) return res.status(404).json({ message: "Collaborator not found" });
      evictSessionUserSockets(
        access.session.id,
        updated.userId,
        "Session role changed",
        "role_changed",
      );
      await logActivity(access.session.id, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, "changed_role", "collaborator", updated.id, `Changed to ${role}`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update collaborator role" });
    }
  });

  app.post("/api/sessions/:id/transfer-ownership", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can transfer ownership" });
      const { collaboratorId } = (req.body ?? {}) as any;
      if (!collaboratorId) return res.status(400).json({ message: "collaboratorId is required" });
      const collaborators = await storage.getSessionCollaborators(access.session.id);
      const targetCollab = collaborators.find(c => c.id === collaboratorId);
      if (!targetCollab) return res.status(404).json({ message: "Collaborator not found" });
      await storage.transferSessionOwnership(access.session.id, targetCollab.userId, targetCollab.username || "");
      evictAllSessionSockets(access.session.id, "Session ownership transferred");
      await logActivity(access.session.id, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, "transferred_ownership", "session", access.session.id, `Transferred to ${targetCollab.username || targetCollab.userId}`);
      broadcastToSession(access.session.id, { type: "ownership_transfer" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error transferring ownership:", error?.message || error);
      res.status(500).json({ message: "Failed to transfer ownership" });
    }
  });

  app.post("/api/sessions/:id/leave", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const sessionId = parseInt(req.params.id);
      const collab = await storage.getCollaborator(sessionId, userId);
      if (!collab) return res.status(404).json({ message: "Not a collaborator of this session" });
      await storage.removeCollaboratorBySessionAndUser(sessionId, userId);
      evictSessionUserSockets(sessionId, collab.userId, "Session access revoked");
      logActivity(sessionId, userId, (req as AuthenticatedRequest).user?.claims?.username, "collaborator_left", "session", sessionId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to leave session" });
    }
  });

  // Invite links
  app.get("/api/sessions/:id/invite-links", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can manage invite links" });
      const links = await storage.getSessionInviteLinks(access.session.id);
      res.json(links);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invite links" });
    }
  });

  const createInviteLinkBody = z.object({
    label: z.string().max(100).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  });

  app.post("/api/sessions/:id/invite-links", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can create invite links" });
      const inviteParse = createInviteLinkBody.safeParse(req.body ?? {});
      if (!inviteParse.success) return res.status(400).json({ message: "Invalid request body", errors: inviteParse.error.flatten().fieldErrors });
      const token = randomBytes(24).toString("hex");
      const link = await storage.createInviteLink({
        sessionId: access.session.id,
        token,
        createdBy: (req as AuthenticatedRequest).user.claims.sub,
        isActive: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      logActivity(access.session.id, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, "invite_created", "invite_link", link.id);
      res.json(link);
    } catch (error) {
      console.error("Error creating invite link:", error);
      res.status(500).json({ message: "Failed to create invite link" });
    }
  });

  app.delete("/api/invite-links/:id", isAuthenticated, async (req: any, res) => {
    try {
      const link = await storage.getInviteLinkById(parseInt(req.params.id));
      if (!link) return res.status(404).json({ message: "Invite link not found" });
      const access = await verifySessionAccess(link.sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access || !isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can revoke invite links" });
      await storage.revokeInviteLink(link.id);
      logActivity(link.sessionId, (req as AuthenticatedRequest).user.claims.sub, (req as AuthenticatedRequest).user.claims.username, "invite_deactivated", "invite_link", link.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to revoke invite link" });
    }
  });

  // Join via invite token
  app.post("/api/join/:token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const username = (req as AuthenticatedRequest).user.claims.username || (req as AuthenticatedRequest).user.claims.first_name || userId;
      const link = await storage.getInviteLinkByToken(req.params.token);
      if (!link || !link.isActive) return res.status(404).json({ message: "Invalid or expired invite link" });
      if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
        return res.status(410).json({ message: "This invite link has expired" });
      }
      const session = await storage.getSession(link.sessionId);
      if (!session) return res.status(404).json({ message: "Session no longer exists" });
      if (session.userId === userId) return res.json({ session, message: "You own this session", alreadyMember: true });
      const existing = await storage.getCollaborator(link.sessionId, userId);
      if (existing) return res.json({ session, message: "You are already a collaborator", alreadyMember: true });
      await storage.addCollaborator({
        sessionId: link.sessionId,
        userId,
        username,
        role: "editor",
      });
      await storage.incrementInviteLinkUsedCount(link.id);
      res.json({ session, message: "Successfully joined session", alreadyMember: false });
    } catch (error) {
      console.error("Error joining session:", error);
      res.status(500).json({ message: "Failed to join session" });
    }
  });

  app.get("/api/sessions/:id/active-tasks", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      res.json(taskTracker.getSessionTasks(sessionId));
    } catch {
      res.status(500).json({ message: "Failed to get active tasks" });
    }
  });

  // POST /api/sessions/:id/export/pdf/start — create a background PDF job, returns {jobId}
  app.post("/api/sessions/:id/export/pdf/start", isAuthenticated, resourceRateLimiter, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const jobId = randomUUID();
      const sessionId = parseInt(req.params.id);
      pdfJobs.set(jobId, { done: 0, total: 0, complete: false, createdAt: Date.now(), userId, sessionId });
      res.json({ jobId });
    } catch {
      res.status(500).json({ message: "Failed to create PDF job" });
    }
  });

  // GET /api/sessions/:id/export/pdf/progress/:jobId — poll generation progress
  app.get("/api/sessions/:id/export/pdf/progress/:jobId", isAuthenticated, (req: any, res) => {
    const userId = resolveUserId(req as AuthenticatedRequest);
    const routeSessionId = parseInt(req.params.id);
    const job = pdfJobs.get(req.params.jobId);
    if (!job || job.userId !== userId || job.sessionId !== routeSessionId) return res.status(404).json({ error: "Job not found" });
    res.json({ done: job.done, total: job.total, complete: job.complete, error: job.error });
  });

  // GET /api/sessions/:id/export/pdf/download/:jobId — retrieve completed PDF buffer
  app.get("/api/sessions/:id/export/pdf/download/:jobId", isAuthenticated, (req: any, res) => {
    const userId = resolveUserId(req as AuthenticatedRequest);
    const routeSessionId = parseInt(req.params.id);
    const job = pdfJobs.get(req.params.jobId);
    if (!job || job.userId !== userId || job.sessionId !== routeSessionId) return res.status(404).json({ error: "Job not found" });
    if (!job.complete) return res.status(202).json({ message: "Not ready" });
    if (job.error) return res.status(500).json({ error: job.error });
    if (!job.buffer) return res.status(500).json({ error: "No buffer" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${job.filename || "export.pdf"}"`);
    res.setHeader("Content-Length", job.buffer.length);
    const buf = job.buffer;
    pdfJobs.delete(req.params.jobId);
    res.send(buf);
  });

  app.get("/api/sessions/:id/export/pdf", isAuthenticated, resourceRateLimiter, async (req: any, res) => {
    const _sid = parseInt(req.params.id);
    taskTracker.increment();
    // Hoist jobId/job outside try so the catch block can safely mark the job failed
    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : null;
    const job = jobId ? pdfJobs.get(jobId) : null;
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      taskTracker.startSession(_sid, "pdf");
      if (jobId && !job) return res.status(404).json({ error: "Job not found" });
      // Respond immediately so the client can start polling progress
      if (job) res.json({ started: true });
      const session = access.session;
      const rawEntries = await storage.getSessionEntries(session.id);
      const key = await getEncryptionKey(userId);
      const sessionEntries = correctEntryFootage(key ? rawEntries.map(e => decryptEntry(e, key, { strict: false }) as any) : rawEntries);
      const CORRUPT_DISPLAY = "(corrupted)";
      const isSentinel = (v: any): boolean => v === UNREADABLE_SENTINEL;
      const fmtSentinel = (v: any): string => isSentinel(v) ? CORRUPT_DISPLAY : (v || "");
      const hasCorruptedEntries = (sessionEntries as any[]).some((e: any) =>
        [e.reelTag, e.wireType, e.gauge, e.color, e.manufacturer, e.notes, e.conductors].some(isSentinel)
      );
      const totalFootage = sessionEntries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
      const userSettings = await storage.getUserSettings(userId);
      const pdfUnit: UnitType = (userSettings?.defaultUnit as UnitType) || "feet";
      const pdfULabel = unitLabel(pdfUnit);
      const fmtFootage = (ft: number) => toDisplayUnit(ft, pdfUnit).toLocaleString();
      const photoStats = await storage.getSessionPhotoStats([session.id]);
      const pt = photoStats.get(session.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
      const sessionPhotos = await storage.getSessionPhotos(session.id);
      const photoMap = new Map(sessionPhotos.map(p => [p.id, p]));

      const allFlaggedPins = await storage.getSessionFlaggedPins(session.id);
      const flaggedEntryIds = new Set<number>(
        allFlaggedPins.filter((p: any) => p.entryId != null).map((p: any) => p.entryId as number)
      );
      const flaggedFootage = (sessionEntries as any[])
        .filter((e: any) => flaggedEntryIds.has(e.id))
        .reduce((s: number, e: any) => s + (e.footage || 0), 0);
      const flaggedReelCount = (sessionEntries as any[])
        .filter((e: any) => flaggedEntryIds.has(e.id))
        .reduce((s: number, e: any) => s + (e.reelCount || 1), 0);
      const activeEntries = (sessionEntries as any[]).filter((e: any) => !flaggedEntryIds.has(e.id));
      const activeTotalFootage = totalFootage - flaggedFootage;
      const flaggedPdfItems: Array<{ pin: any; photo: any; entry: any }> = allFlaggedPins
        .map((p: any) => {
          const photo = photoMap.get(p.photoId);
          const entry = p.entryId != null
            ? (sessionEntries as any[]).find((e: any) => e.id === p.entryId)
            : null;
          const syntheticEntry = entry || {
            id: -p.id,
            reelTag: p.wireDetails || "Unknown",
            manufacturer: p.vendorCode || "Unknown",
            reelCount: p.reelCount || 1,
            footage: p.footage || 0,
            notes: "Flagged — not yet committed",
          };
          return { pin: p, photo, entry: syntheticEntry };
        })
        .filter((item: any) => item.photo);

      const userSettingsData = await storage.getUserSettings(userId);
      const userTz = userSettingsData?.timezone || "America/Chicago";

      const TZ_ABBR: Record<string, string> = {
        "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT",
        "America/Los_Angeles": "PT", "America/Anchorage": "AKT", "Pacific/Honolulu": "HT",
        "America/Phoenix": "MST", "UTC": "UTC",
      };
      const tzAbbr = TZ_ABBR[userTz] || userTz;

      const formatExportTime = (d: Date) => {
        let h = d.getHours();
        const m = d.getMinutes();
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}'${String(m).padStart(2, "0")}${ampm}`;
      };
      const formatExportDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const buildExportFilename = (ext: string) => {
        const safeName = session.name.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, " ").trim();
        const first = pt.firstPhotoAt ? new Date(pt.firstPhotoAt) : null;
        const last = pt.lastPhotoAt ? new Date(pt.lastPhotoAt) : null;
        if (!first) return `${safeName.replace(/ /g, "_")}.${ext}`;
        const d1 = formatExportDate(first);
        const t1 = formatExportTime(first);
        if (!last || first.getTime() === last.getTime()) return `${safeName}_${d1}_${t1}.${ext}`;
        const d2 = formatExportDate(last);
        const t2 = formatExportTime(last);
        if (d1 === d2) return `${safeName}_${d1}_${t1}-${t2}.${ext}`;
        return `${safeName}_${d1}_${t1}-${d2}_${t2}.${ext}`;
      };

      const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36 });
      const filename = buildExportFilename("pdf");
      const bufferStream = new PassThrough();
      const pdfChunks: Buffer[] = [];
      bufferStream.on("data", (chunk: Buffer) => pdfChunks.push(chunk));
      doc.pipe(bufferStream);

      const companyName = typeof req.query.companyName === "string" ? req.query.companyName : null;
      const footerText = typeof req.query.footerText === "string" ? req.query.footerText : null;
      const exportQuality = req.query.quality === "full" ? "full" : "standard";

      const userSettingsForPdf = await storage.getUserSettings(userId);
      let logoBuffer: Buffer | null = null;
      if (userSettingsForPdf?.companyLogoKey) {
        try {
          logoBuffer = await loadPhotoBuffer(userSettingsForPdf.companyLogoKey);
        } catch (e) {
          console.warn("Failed to load company logo for PDF:", e);
        }
      }

      const accentHex = "#ea580c";
      const BLUE_SHADES_HEX = [
        "#3B82F6",
        "#38BDF8",
        "#6366F1",
        "#1D4ED8",
        "#06B6D4",
        "#8B5CF6",
      ];
      const headerBg = "#f5f0eb";
      const borderColor = "#cccccc";

      let titleY = 36;
      let logoRightEdge = 36;
      if (logoBuffer) {
        try {
          const meta = await sharp(logoBuffer).metadata();
          const maxW = 80;
          const maxH = 40;
          let w = meta.width || maxW;
          let h = meta.height || maxH;
          const scale = Math.min(maxW / w, maxH / h, 1);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
          doc.image(logoBuffer, 36, titleY, { width: w, height: h });
          logoRightEdge = 36 + w + 10;
          if (companyName) {
            const nameY = titleY + Math.max(0, (h - 14) / 2);
            doc.fontSize(12).fillColor("#999999").text(companyName, logoRightEdge, nameY);
          }
          titleY += h + 6;
        } catch (imgErr) {
          console.warn("Failed to render logo in PDF:", imgErr);
          logoBuffer = null;
        }
      }
      if (!logoBuffer && companyName) {
        doc.fontSize(12).fillColor("#999999").text(companyName, 36, titleY);
        titleY += 20;
      }
      doc.font('Helvetica-Bold').fontSize(20).fillColor(accentHex).text("Master Reel Counter", 36, titleY);
      titleY += 28;
      doc.font('Helvetica').fontSize(16).fillColor("#222222").text(session.name, 36, titleY);
      titleY += 24;

      doc.moveTo(36, titleY).lineTo(36 + (doc.page.width - 72), titleY).strokeColor(accentHex).lineWidth(2).stroke();
      titleY += 10;

      const coverLabelW = 100;
      const coverValueX = 36 + coverLabelW;
      const coverValueW = doc.page.width - 72 - coverLabelW;
      const coverLineH = 15;
      const coverLabelColor = "#000000";
      const coverValueColor = "#222222";
      const totalReels = activeEntries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);

      const coverRows: [string, string][] = [
        ["Location:", session.location || "N/A"],
        ["Status:", (session.status.charAt(0).toUpperCase() + session.status.slice(1))],
        ["Total Reels:", totalReels.toLocaleString()],
        ["Total Footage:", `${fmtFootage(activeTotalFootage)} ${pdfULabel}`],
        ...(flaggedEntryIds.size > 0 ? [["Flagged (excl.):", `${flaggedReelCount} reels / ${fmtFootage(flaggedFootage)} ${pdfULabel}`] as [string, string]] : []),
        ["Photos:", pt.photoCount.toLocaleString()],
      ];
      for (const [label, value] of coverRows) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(coverLabelColor).text(label, 36, titleY, { width: coverLabelW, lineBreak: false });
        doc.font('Helvetica').fontSize(9).fillColor(coverValueColor).text(value, coverValueX, titleY, { width: coverValueW, lineBreak: false });
        titleY += coverLineH;
      }

      if (pt.firstPhotoAt) {
        const dtFmt = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: userTz, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
        const startStr = dtFmt(new Date(pt.firstPhotoAt));
        const endStr = pt.lastPhotoAt ? dtFmt(new Date(pt.lastPhotoAt)) : "ongoing";
        doc.font('Helvetica-Bold').fontSize(9).fillColor(coverLabelColor).text("Session Time:", 36, titleY, { width: coverLabelW, lineBreak: false });
        doc.font('Helvetica').fontSize(9).fillColor(coverValueColor).text(`${startStr} ${tzAbbr}`, coverValueX, titleY, { width: coverValueW, lineBreak: false });
        titleY += coverLineH;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(coverLabelColor).text("", 36, titleY, { width: coverLabelW, lineBreak: false });
        doc.font('Helvetica').fontSize(9).fillColor(coverValueColor).text(`to ${endStr} ${tzAbbr}`, coverValueX, titleY, { width: coverValueW, lineBreak: false });
        titleY += coverLineH;
        if (pt.lastPhotoAt) {
          const diffMs = Math.abs(new Date(pt.lastPhotoAt).getTime() - new Date(pt.firstPhotoAt).getTime());
          const totalMin = Math.floor(diffMs / 60000);
          let elapsedStr: string;
          if (diffMs < 60000) { elapsedStr = `${Math.round(diffMs / 1000)}s`; }
          else if (totalMin < 60) { elapsedStr = `${totalMin}m`; }
          else { const h = Math.floor(totalMin / 60); const m = totalMin % 60; elapsedStr = m > 0 ? `${h}h ${m}m` : `${h}h`; }
          doc.font('Helvetica-Bold').fontSize(9).fillColor(coverLabelColor).text("Elapsed Time:", 36, titleY, { width: coverLabelW, lineBreak: false });
          doc.font('Helvetica').fontSize(9).fillColor(coverValueColor).text(elapsedStr, coverValueX, titleY, { width: coverValueW, lineBreak: false });
          titleY += coverLineH;
        }
      }

      if (session.description) {
        titleY += 4;
        doc.fontSize(9).fillColor("#666666").text(session.description, 36, titleY, { width: doc.page.width - 72 });
        titleY += doc.heightOfString(session.description, { width: doc.page.width - 72 }) + 4;
      }

      const tableLeft = 36;
      const pageWidth = doc.page.width - 72;
      const rowHeight = 16;
      const headerHeight = 18;
      let currentY = titleY + 8;
      const maxY = doc.page.height - 50;

      const formatCT = (d: Date): string => {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: userTz,
          month: '2-digit', day: '2-digit', year: 'numeric',
          hour: 'numeric', minute: '2-digit', second: '2-digit',
          hour12: false,
        }).formatToParts(d);
        const get = (type: string) => parts.find(p => p.type === type)?.value || '';
        let hour = get('hour');
        if (hour.startsWith('0') && hour.length > 1) hour = hour.slice(1);
        if (hour === '24') hour = '0';
        return `${get('month')}-${get('day')}-${get('year')} at ${hour}:${get('minute')}:${get('second')} ${tzAbbr}`;
      };

      const formatElapsed = (startMs: number, endMs: number): string => {
        const diffMs = Math.abs(endMs - startMs);
        if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s`;
        const totalMin = Math.floor(diffMs / 60000);
        if (totalMin < 60) return `${totalMin}m`;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
      };

      // --- Section-by-Section Pages with Photos and Pins ---
      const sectionGroups = new Map<string, { aisle: string; section: string; photos: typeof sessionPhotos; entries: typeof sessionEntries }>();
      for (const p of sessionPhotos) {
        const sKey = `${p.aisle || ""}|||${p.section || ""}`;
        if (!sectionGroups.has(sKey)) {
          sectionGroups.set(sKey, { aisle: p.aisle || "", section: p.section || "", photos: [], entries: [] });
        }
        sectionGroups.get(sKey)!.photos.push(p);
      }
      for (const e of sessionEntries as any[]) {
        const sKey = `${e.aisle || ""}|||${e.section || ""}`;
        if (!sectionGroups.has(sKey)) {
          sectionGroups.set(sKey, { aisle: e.aisle || "", section: e.section || "", photos: [], entries: [] });
        }
        sectionGroups.get(sKey)!.entries.push(e);
      }

      const allPinsMap = new Map<number, any[]>();
      for (const p of sessionPhotos) {
        const photoPins = await storage.getPhotoPins(p.id);
        const committed = photoPins.filter((pin: any) => pin.entryId != null);
        if (committed.length > 0) allPinsMap.set(p.id, committed);
      }
      const flaggedPinIds = new Set(allFlaggedPins.map((p: any) => p.id));

      const sortedSections = Array.from(sectionGroups.entries())
        .map(([, data]) => data)
        .sort((a, b) => {
          const aN_aisle = parseInt(a.aisle) || 0;
          const bN_aisle = parseInt(b.aisle) || 0;
          if (aN_aisle !== bN_aisle) return aN_aisle - bN_aisle;
          if (a.aisle < b.aisle) return -1;
          if (a.aisle > b.aisle) return 1;
          const aN = parseInt(a.section) || 0;
          const bN = parseInt(b.section) || 0;
          return aN - bN;
        });

      // --- Table of Contents ---
      const tocSections = sortedSections.filter(sec => {
        const hasPhotos = (sec.photos || []).length > 0;
        const hasEntries = sec.entries.length > 0;
        return hasPhotos || hasEntries;
      });

      if (tocSections.length > 0) {
        currentY += 10;
        doc.font('Helvetica-Bold').fontSize(14).fillColor(accentHex).text("Table of Contents", 36, currentY);
        currentY += 22;

        const tocAvailH = maxY - currentY;
        const tocLargeLineH = 28;
        const tocSmallLineH = 16;
        const tocLargeFontSize = 13;
        const tocSmallFontSize = 9;
        const fitsOnOnePage = tocSections.length * tocLargeLineH <= tocAvailH;
        const tocLineH = fitsOnOnePage ? tocLargeLineH : tocSmallLineH;
        const tocFontSize = fitsOnOnePage ? tocLargeFontSize : tocSmallFontSize;

        const tocItems: { label: string; destName: string; y: number }[] = [];

        for (let si = 0; si < tocSections.length; si++) {
          const sec = tocSections[si];
          if (currentY + tocLineH > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
          }
          const secFootage = sec.entries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
          const secReels = sec.entries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);
          const tocLabel = `Aisle ${sec.aisle || "—"} / Section ${sec.section || "—"} — ${sec.entries.length} entries, ${secReels} reels, ${fmtFootage(secFootage)} ${pdfULabel}`;
          const destName = `sec-${si}`;

          doc.font('Helvetica').fontSize(tocFontSize).fillColor("#1a6bc4")
            .text(tocLabel, 44, currentY + 2, { width: pageWidth - 20, lineBreak: false });
          const textW = Math.min(doc.widthOfString(tocLabel), pageWidth - 20);
          tocItems.push({ label: tocLabel, destName, y: currentY + 2 });
          doc.goTo(44, currentY + 2, textW, tocLineH, destName);

          currentY += tocLineH;
        }
      }

      const secEntryCols = [
        { header: "Catalog:", width: 110 },
        { header: "Vendor:", width: 70 },
        { header: "# of Reels:", width: 45, centered: true },
        { header: `Total (${pdfULabel}):`, width: 65, centered: true },
        { header: "Notes:", width: 110 },
      ];

      const scaleSecCols = (tblW: number) => {
        const secTotalW = secEntryCols.reduce((s, c) => s + c.width, 0);
        const secScale = tblW / secTotalW;
        return secEntryCols.map(c => ({ ...c, width: Math.floor(c.width * secScale) }));
      };

      const drawSecEntryHeader = (y: number, tblX: number, tblW: number, cols: { header: string; width: number; centered?: boolean }[]) => {
        doc.rect(tblX, y, tblW, headerHeight).fill(headerBg);
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor("#333333");
        let x = tblX;
        for (const col of cols) {
          if (col.centered) {
            doc.text(col.header, x, y + 4, { width: col.width, align: 'center', lineBreak: false });
            const tw = doc.widthOfString(col.header);
            const lineX = x + (col.width - tw) / 2;
            doc.save().moveTo(lineX, y + 13).lineTo(lineX + tw, y + 13).lineWidth(0.4).strokeColor("#333333").stroke().restore();
          } else {
            doc.text(col.header, x + 2, y + 4, { width: col.width - 4, lineBreak: false });
            const tw = doc.widthOfString(col.header);
            doc.save().moveTo(x + 2, y + 13).lineTo(x + 2 + tw, y + 13).lineWidth(0.4).strokeColor("#333333").stroke().restore();
          }
          x += col.width;
        }
        doc.font('Helvetica');
        doc.rect(tblX, y, tblW, headerHeight).stroke(borderColor);
        return y + headerHeight;
      };

      const drawCommittedPin = (pin: any, imgX: number, imgY: number, imgW: number, imgH: number, _imgOrigW: number, pinScale: number, overrideColor?: string) => {
        const pinColor = overrideColor || accentHex;
        const pinCenterX = imgX + (pin.xPercent / 100) * imgW;
        const pinCenterY = imgY + (pin.yPercent / 100) * imgH;

        const refDisplayW = 900;
        const sf = (imgW / refDisplayW) * pinScale;

        const pw = 82 * sf;
        const ph = 61 * sf;
        const borderW = Math.max(0.5, 2 * sf);
        const cornerR = Math.max(1, 5 * sf);
        const px = pinCenterX - pw / 2;
        const py = pinCenterY - ph / 2;

        doc.save();
        doc.roundedRect(px, py, pw, ph, cornerR)
          .strokeColor(pinColor)
          .lineWidth(borderW)
          .stroke();

        if (pin.label) {
          const labelFontSize = Math.max(4, 10 * sf);
          const labelPadX = Math.max(1, 3 * sf);
          const labelPadY = Math.max(0.5, 1 * sf);
          const tabCornerR = Math.max(0.5, 3 * sf);

          const labelText = formatPinLabel(String(pin.label));
          doc.font('Helvetica-Bold').fontSize(labelFontSize);
          const labelTextW = doc.widthOfString(labelText);
          const labelW = labelTextW + labelPadX * 2;
          const labelH = labelFontSize + labelPadY * 2;

          const reelCount = pin.reelCount || 1;
          let badgeW = 0;
          let badgeText = "";
          if (reelCount >= 2) {
            badgeText = `X${reelCount}`;
            const badgeTextW = doc.widthOfString(badgeText);
            badgeW = badgeTextW + labelPadX * 2;
          }
          const totalTopW = labelW + (badgeW > 0 ? badgeW + sf : 0);
          const tabX = pinCenterX - totalTopW / 2;
          const tabY = py - labelH + borderW / 2;

          doc.save();
          doc.moveTo(tabX + tabCornerR, tabY)
            .lineTo(tabX + labelW - tabCornerR, tabY)
            .quadraticCurveTo(tabX + labelW, tabY, tabX + labelW, tabY + tabCornerR)
            .lineTo(tabX + labelW, tabY + labelH)
            .lineTo(tabX, tabY + labelH)
            .lineTo(tabX, tabY + tabCornerR)
            .quadraticCurveTo(tabX, tabY, tabX + tabCornerR, tabY)
            .fill(pinColor);
          doc.fillColor("#ffffff").fontSize(labelFontSize)
            .text(labelText, tabX + labelPadX, tabY + labelPadY, { lineBreak: false });

          if (reelCount >= 2) {
            const gapBetween = sf;
            const badgeX = tabX + labelW + gapBetween;
            doc.save();
            doc.moveTo(badgeX + tabCornerR, tabY)
              .lineTo(badgeX + badgeW - tabCornerR, tabY)
              .quadraticCurveTo(badgeX + badgeW, tabY, badgeX + badgeW, tabY + tabCornerR)
              .lineTo(badgeX + badgeW, tabY + labelH)
              .lineTo(badgeX, tabY + labelH)
              .lineTo(badgeX, tabY + tabCornerR)
              .quadraticCurveTo(badgeX, tabY, badgeX + tabCornerR, tabY)
              .fill(pinColor);
            doc.fillColor("#ffffff").fontSize(labelFontSize)
              .text(badgeText, badgeX + labelPadX, tabY + labelPadY, { lineBreak: false });
            doc.restore();
          }
          doc.restore();
          doc.font('Helvetica');
        }
        doc.restore();
      };

      const drawFlaggedPin = (pin: any, imgX: number, imgY: number, imgW: number, imgH: number, _imgOrigW: number, pinScale: number) => {
        const flagColor = "#cc4400";
        const pinCenterX = imgX + (pin.xPercent / 100) * imgW;
        const pinCenterY = imgY + (pin.yPercent / 100) * imgH;

        const refDisplayW = 900;
        const sf = (imgW / refDisplayW) * pinScale;

        const pw = 82 * sf;
        const ph = 61 * sf;
        const borderW = Math.max(1, 4 * sf);
        const cornerR = Math.max(1, 5 * sf);
        const px = pinCenterX - pw / 2;
        const py = pinCenterY - ph / 2;

        doc.save();
        doc.roundedRect(px, py, pw, ph, cornerR)
          .strokeColor(flagColor)
          .lineWidth(borderW)
          .stroke();

        if (pin.label) {
          const labelFontSize = Math.max(4, 10 * sf);
          const labelPadX = Math.max(1, 3 * sf);
          const labelPadY = Math.max(0.5, 1 * sf);
          const tabCornerR = Math.max(0.5, 3 * sf);

          const labelText = formatPinLabel(String(pin.label));
          doc.font('Helvetica-Bold').fontSize(labelFontSize);
          const labelTextW = doc.widthOfString(labelText);
          const labelW = labelTextW + labelPadX * 2;
          const labelH = labelFontSize + labelPadY * 2;

          const reelCount = pin.reelCount || 1;
          let badgeW = 0;
          let badgeText = "";
          if (reelCount >= 2) {
            badgeText = `X${reelCount}`;
            const badgeTextW = doc.widthOfString(badgeText);
            badgeW = badgeTextW + labelPadX * 2;
          }
          const totalTopW = labelW + (badgeW > 0 ? badgeW + sf : 0);
          const tabX = pinCenterX - totalTopW / 2;
          const tabY = py - labelH + borderW / 2;

          doc.save();
          doc.moveTo(tabX + tabCornerR, tabY)
            .lineTo(tabX + labelW - tabCornerR, tabY)
            .quadraticCurveTo(tabX + labelW, tabY, tabX + labelW, tabY + tabCornerR)
            .lineTo(tabX + labelW, tabY + labelH)
            .lineTo(tabX, tabY + labelH)
            .lineTo(tabX, tabY + tabCornerR)
            .quadraticCurveTo(tabX, tabY, tabX + tabCornerR, tabY)
            .fill(flagColor);
          doc.fillColor("#ffffff").fontSize(labelFontSize)
            .text(labelText, tabX + labelPadX, tabY + labelPadY, { lineBreak: false });

          if (reelCount >= 2) {
            const gapBetween = sf;
            const badgeX = tabX + labelW + gapBetween;
            doc.save();
            doc.moveTo(badgeX + tabCornerR, tabY)
              .lineTo(badgeX + badgeW - tabCornerR, tabY)
              .quadraticCurveTo(badgeX + badgeW, tabY, badgeX + badgeW, tabY + tabCornerR)
              .lineTo(badgeX + badgeW, tabY + labelH)
              .lineTo(badgeX, tabY + labelH)
              .lineTo(badgeX, tabY + tabCornerR)
              .quadraticCurveTo(badgeX, tabY, badgeX + tabCornerR, tabY)
              .fill(flagColor);
            doc.fillColor("#ffffff").fontSize(labelFontSize)
              .text(badgeText, badgeX + labelPadX, tabY + labelPadY, { lineBreak: false });
            doc.restore();
          }
          doc.restore();
          doc.font('Helvetica');
        }

        const flagFontSize = Math.max(3.5, 8 * sf);
        const flagPadX = Math.max(1, 3 * sf);
        const flagPadY = Math.max(0.5, 1 * sf);
        const flagTabCornerR = Math.max(0.5, 3 * sf);
        const flagLabelText = "[FLAGGED]";
        doc.font('Helvetica-Bold').fontSize(flagFontSize);
        const flagTextW = doc.widthOfString(flagLabelText);
        const flagBadgeW = flagTextW + flagPadX * 2;
        const flagBadgeH = flagFontSize + flagPadY * 2;
        const flagBadgeX = pinCenterX - flagBadgeW / 2;
        const flagBadgeY = py + ph - borderW / 2;

        doc.save();
        doc.moveTo(flagBadgeX, flagBadgeY)
          .lineTo(flagBadgeX + flagBadgeW, flagBadgeY)
          .lineTo(flagBadgeX + flagBadgeW, flagBadgeY + flagBadgeH - flagTabCornerR)
          .quadraticCurveTo(flagBadgeX + flagBadgeW, flagBadgeY + flagBadgeH, flagBadgeX + flagBadgeW - flagTabCornerR, flagBadgeY + flagBadgeH)
          .lineTo(flagBadgeX + flagTabCornerR, flagBadgeY + flagBadgeH)
          .quadraticCurveTo(flagBadgeX, flagBadgeY + flagBadgeH, flagBadgeX, flagBadgeY + flagBadgeH - flagTabCornerR)
          .lineTo(flagBadgeX, flagBadgeY)
          .fill(flagColor);
        doc.fillColor("#ffffff").fontSize(flagFontSize)
          .text(flagLabelText, flagBadgeX + flagPadX, flagBadgeY + flagPadY, { lineBreak: false });
        doc.restore();
        doc.font('Helvetica');

        doc.restore();
      };

      // Probe GCS availability once before loading any photos (1.5s timeout)
      let gcsReachable = false;
      try {
        const gcsProbe = objectStorageClient.bucket(BUCKET_NAME).getMetadata().then(() => true as const);
        const gcsTimeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 1500));
        gcsReachable = await Promise.race([gcsProbe, gcsTimeout]);
      } catch {
        // GCS unavailable — all photos will load from local disk
      }
      console.log(`[pdf] GCS reachable: ${gcsReachable}`);

      type PhotoLayout = { photo: any; buffer: Buffer; imgW: number; imgH: number; origW: number; origH: number };
      const loadPhoto = async (photo: any): Promise<PhotoLayout | null> => {
        const photoKey = photo.objectStorageKey;
        const photoFilename = photoKey.replace("/uploads/", "");
        const photoPath = path.join(UPLOADS_DIR, photoFilename);
        try {
          let rawBuffer: Buffer;
          let loadedFromGcs = false;
          if (gcsReachable) {
            try {
              const gcsFile = objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(photoKey));
              const [existsInGcs] = await gcsFile.exists();
              if (existsInGcs) {
                const [downloaded] = await gcsFile.download();
                rawBuffer = downloaded;
                loadedFromGcs = true;
              }
            } catch {
              // GCS error for this specific file — fall through to local disk
            }
          }
          if (!loadedFromGcs) {
            rawBuffer = await fs.readFile(photoPath);
          }
          let sharpPipeline = sharp(rawBuffer!).rotate();
          if (exportQuality === "standard") {
            sharpPipeline = sharpPipeline
              .resize(1600, 1200, { fit: "inside", withoutEnlargement: true })
              .jpeg({ quality: 82 });
          }
          const manualRotation = (photo.rotation ?? 0) % 360;
          if (manualRotation !== 0) {
            sharpPipeline = sharpPipeline.rotate(manualRotation);
          }
          const { data: orientedBuffer, info } = await sharpPipeline
            .toBuffer({ resolveWithObject: true });
          return { photo, buffer: orientedBuffer, imgW: info.width, imgH: info.height, origW: info.width, origH: info.height };
        } catch {
          return null;
        }
      };

      const renderPhoto = (pl: PhotoLayout, x: number, y: number, maxW: number, maxH: number, photoEntries?: any[]) => {
        const captionH = 12;
        const availH = maxH - captionH;
        const aspect = pl.origW / pl.origH;
        let w: number, h: number;
        w = maxW;
        h = maxW / aspect;
        if (h > availH) {
          h = availH;
          w = availH * aspect;
          if (w > maxW) {
            w = maxW;
            h = maxW / aspect;
          }
        }
        const imgX = x;
        doc.image(pl.buffer, imgX, y, { width: w, height: h });

        const photoPins = allPinsMap.get(pl.photo.id) || [];
        const pinScale = pl.photo.pinScale || 1;
        for (const pin of photoPins) {
          if (flaggedPinIds.has(pin.id)) {
            drawFlaggedPin(pin, imgX, y, w, h, pl.origW, pinScale);
          } else {
            const shade = getPinColor(pin, pl.photo.id, pl.photo);
            drawCommittedPin(pin, imgX, y, w, h, pl.origW, pinScale, shade);
          }
        }

        doc.rect(imgX, y, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();

        const photoName = pl.photo.originalFilename || `Photo ${pl.photo.id}`;
        const reelTotal = photoEntries
          ? photoEntries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0)
          : photoPins.reduce((s: number, p: any) => s + (p.reelCount || 1), 0);
        const captionParts: string[] = [photoName];
        captionParts.push(`${reelTotal} reel${reelTotal !== 1 ? "s" : ""}`);
        if (pl.photo.createdAt) {
          captionParts.push(formatCT(new Date(pl.photo.createdAt)));
        }
        doc.font('Helvetica').fontSize(6).fillColor("#666666")
          .text(captionParts.join("  |  "), imgX, y + h + 2, { width: w, align: "center", lineBreak: false });

        return { renderedW: w, renderedH: h + captionH, imgX };
      };

      const renderCompactPhotoWithEntries = (pl: PhotoLayout, entries: any[], x: number, y: number, maxW: number, maxH: number) => {
        const imgW = Math.min(maxW * 0.35, 200);
        const captionH = 10;
        const aspect = pl.origW / pl.origH;
        let w = imgW;
        let h = imgW / aspect;
        const availImgH = maxH - captionH;
        if (h > availImgH) {
          h = availImgH;
          w = availImgH * aspect;
          if (w > imgW) { w = imgW; h = imgW / aspect; }
        }

        doc.image(pl.buffer, x, y, { width: w, height: h });
        const photoPins = allPinsMap.get(pl.photo.id) || [];
        const pinScale = pl.photo.pinScale || 1;
        for (const pin of photoPins) {
          if (flaggedPinIds.has(pin.id)) {
            drawFlaggedPin(pin, x, y, w, h, pl.origW, pinScale);
          } else {
            const shade = getPinColor(pin, pl.photo.id, pl.photo);
            drawCommittedPin(pin, x, y, w, h, pl.origW, pinScale, shade);
          }
        }
        doc.rect(x, y, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();

        const photoName = pl.photo.originalFilename || `Photo ${pl.photo.id}`;
        const reelTotal = entries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);
        const compactCaptionParts: string[] = [photoName];
        compactCaptionParts.push(`${reelTotal} reel${reelTotal !== 1 ? "s" : ""}`);
        if (pl.photo.createdAt) {
          compactCaptionParts.push(formatCT(new Date(pl.photo.createdAt)));
        }
        doc.font('Helvetica').fontSize(5.5).fillColor("#666666")
          .text(compactCaptionParts.join("  |  "), x, y + h + 1, { width: w, align: "center", lineBreak: false });

        const listX = x + w + 8;
        const listW = maxW - w - 8;
        let listY = y;
        const lineH = 9;
        const bottomLimit = y + maxH;

        for (const e of entries) {
          const entryLines: { text: string; fontSize: number; color: string; font: string; indent: boolean }[] = [];
          const pinLabel = photoPins.find((p: any) => p.entryId === e.id)?.label;
          const rawTag = e.reelTag || e.wireType;
          const tagDisplay = rawTag && !isSentinel(rawTag) ? rawTag : (isSentinel(rawTag) ? CORRUPT_DISPLAY : "Entry");
          const header = pinLabel ? `${formatPinLabel(String(pinLabel))} — ${tagDisplay}` : tagDisplay;
          entryLines.push({ text: header, fontSize: 6.5, color: isSentinel(rawTag) ? "#999999" : accentHex, font: isSentinel(rawTag) ? 'Helvetica-Oblique' : 'Helvetica-Bold', indent: false });

          const details: string[] = [];
          const detailCorrupted: boolean[] = [];
          if (e.manufacturer) { details.push(`Vendor: ${fmtSentinel(e.manufacturer)}`); detailCorrupted.push(isSentinel(e.manufacturer)); }
          if (e.reelCount && e.reelCount > 1) { details.push(`Reels: ${e.reelCount}`); detailCorrupted.push(false); }
          if (e.footage) { details.push(`Footage: ${fmtFootage(e.footage)} ${pdfULabel}`); detailCorrupted.push(false); }
          if (e.gauge) { details.push(`Gauge: ${fmtSentinel(e.gauge)}`); detailCorrupted.push(isSentinel(e.gauge)); }
          if (e.color) { details.push(`Color: ${fmtSentinel(e.color)}`); detailCorrupted.push(isSentinel(e.color)); }
          if (e.conductors) { details.push(`Conductors: ${fmtSentinel(e.conductors)}`); detailCorrupted.push(isSentinel(e.conductors)); }

          const slice1 = details.slice(0, 3);
          const slice1Corrupted = detailCorrupted.slice(0, 3).some(Boolean);
          const slice2 = details.slice(3);
          const slice2Corrupted = detailCorrupted.slice(3).some(Boolean);
          const line1 = slice1.join("  •  ");
          const line2 = slice2.join("  •  ");
          if (line1) entryLines.push({ text: line1, fontSize: 5.5, color: slice1Corrupted ? "#999999" : "#333333", font: slice1Corrupted ? 'Helvetica-Oblique' : 'Helvetica', indent: true });
          if (line2) entryLines.push({ text: line2, fontSize: 5.5, color: slice2Corrupted ? "#999999" : "#333333", font: slice2Corrupted ? 'Helvetica-Oblique' : 'Helvetica', indent: true });
          if (e.notes) entryLines.push({ text: `Notes: ${fmtSentinel(e.notes)}`, fontSize: 5, color: isSentinel(e.notes) ? "#999999" : "#666666", font: isSentinel(e.notes) ? 'Helvetica-Oblique' : 'Helvetica', indent: true });

          const neededH = entryLines.length * (lineH - 1) + 4;
          if (listY + neededH > bottomLimit) {
            if (listY > y + 10) {
              doc.font('Helvetica').fontSize(5).fillColor("#999999")
                .text(`(${entries.indexOf(e) + 1}/${entries.length} continued in table below)`, listX, listY, { width: listW, lineBreak: false });
              listY += lineH;
            }
            break;
          }

          for (const ln of entryLines) {
            doc.font(ln.font).fontSize(ln.fontSize).fillColor(ln.color)
              .text(ln.indent ? `  ${ln.text}` : ln.text, listX, listY, { width: listW, lineBreak: false });
            listY += lineH - 1;
          }
          listY += 3;
        }

        const totalH = Math.max(h + captionH, listY - y);
        return { renderedH: totalH };
      };

      const drawSectionHeader = (aisle: string, section: string, entryCount: number, reelCount: number, footage: number, photoLabel?: string, titleSuffix?: string) => {
        doc.rect(tableLeft, currentY, pageWidth, 22).fill("#e8e0d8");
        doc.fontSize(11).fillColor(accentHex).text(
          `Aisle ${aisle || "—"}  /  Section ${section || "—"}${titleSuffix || ""}`,
          tableLeft + 6, currentY + 4, { width: pageWidth - 100, lineBreak: false }
        );
        doc.fontSize(7).fillColor("#666666").text(
          `${entryCount} entries  |  ${reelCount} reels  |  ${fmtFootage(footage)} ${pdfULabel}`,
          tableLeft + pageWidth - 220, currentY + 6, { width: 210, align: "right", lineBreak: false }
        );
        doc.rect(tableLeft, currentY, pageWidth, 22).stroke(borderColor);
        if (photoLabel) {
          doc.fontSize(6).fillColor("#999999").text(
            photoLabel,
            tableLeft + pageWidth - 220, currentY + 14, { width: 210, align: "right", lineBreak: false }
          );
        }
        currentY += 28;
      };

      const drawEntriesTable = (entries: any[], tblX: number, tblW: number, startY: number, fontSize: number, rH: number, pinMap?: Map<number, string>) => {
        const pinColW = pinMap ? 30 : 0;
        const dataW = tblW - pinColW;
        const secScaled = scaleSecCols(dataW);
        const allCols = pinMap
          ? [{ header: "Pin:", width: pinColW }, ...secScaled]
          : secScaled;
        let tblY = drawSecEntryHeader(startY, tblX, tblW, allCols);
        const notesColIdx = allCols.length - 1;
        const notesColWidth = allCols[notesColIdx].width;
        for (let i = 0; i < entries.length; i++) {
          const e: any = entries[i];
          const notesText = fmtSentinel(e.notes);
          doc.font('Helvetica-Bold').fontSize(fontSize);
          const measuredNotesH = notesText ? doc.heightOfString(notesText, { width: notesColWidth - 4 }) : 0;
          const actualRowH = Math.max(rH, measuredNotesH + 6);
          if (tblY + actualRowH > maxY) break;
          if (i % 2 === 1) doc.rect(tblX, tblY, tblW, actualRowH).fill("#fafaf8");
          doc.font('Helvetica-Bold').fontSize(fontSize).fillColor("#333333");
          let x = tblX;
          const baseVals = [
            fmtSentinel(e.reelTag),
            fmtSentinel(e.manufacturer),
            String(e.reelCount || 1),
            e.footage ? `${fmtFootage(e.footage)} ${pdfULabel}` : "",
            notesText,
          ];
          const baseCorrupted = [
            isSentinel(e.reelTag),
            isSentinel(e.manufacturer),
            false,
            false,
            isSentinel(e.notes),
          ];
          const vals = pinMap
            ? [pinMap.get(e.id) || "", ...baseVals]
            : baseVals;
          const corruptedFlags = pinMap
            ? [false, ...baseCorrupted]
            : baseCorrupted;
          const cellTextY = tblY + Math.max(1, (actualRowH - fontSize) / 2);
          for (let j = 0; j < allCols.length; j++) {
            const isNotesCol = j === notesColIdx;
            const isPinCol = pinMap !== undefined && j === 0;
            const col = allCols[j] as { header: string; width: number; centered?: boolean };
            const cellCorrupted = corruptedFlags[j] ?? false;
            if (cellCorrupted) {
              doc.font('Helvetica-Oblique').fillColor("#999999");
            }
            if (isPinCol) {
              doc.fillColor(accentHex);
              doc.text(vals[j], x + 2, cellTextY, { width: col.width - 4, lineBreak: false });
              doc.fillColor("#333333");
            } else if (isNotesCol) {
              doc.text(vals[j], x + 2, tblY + 3, { width: col.width - 4, lineBreak: true, height: actualRowH - 4 });
            } else if (col.centered) {
              doc.text(vals[j], x, cellTextY, { width: col.width, align: 'center', lineBreak: false });
            } else {
              doc.text(vals[j], x + 2, cellTextY, { width: col.width - 4, lineBreak: false });
            }
            if (cellCorrupted) {
              doc.font('Helvetica-Bold').fillColor("#333333");
            }
            x += col.width;
          }
          doc.font('Helvetica');
          doc.rect(tblX, tblY, tblW, actualRowH).stroke(borderColor);
          tblY += actualRowH;
        }
        return tblY;
      };

      const deferredUnmatchedSections: { aisle: string; section: string; entries: any[] }[] = [];

      // Photos are loaded in bounded batches (per-section) inside the rendering
      // loop below rather than all at once, keeping peak memory proportional to
      // the largest single section rather than the entire session.
      const t0 = Date.now();
      const allPhotosFlat = sortedSections.flatMap((sec: any) => sec.photos || []);
      const PDF_PHOTO_BATCH_SIZE = 15;
      const LARGE_SESSION_PHOTO_THRESHOLD = 200;
      if (allPhotosFlat.length > LARGE_SESSION_PHOTO_THRESHOLD) {
        console.warn(`[pdf] session ${session.id}: ${allPhotosFlat.length} photos exceeds ${LARGE_SESSION_PHOTO_THRESHOLD} — streaming in batches of ${PDF_PHOTO_BATCH_SIZE}; export may take extra time`);
      }

      const originalShadeMap = new Map<number, Map<string, number>>();
      const detailShadeMap = new Map<number, number>();
      for (const photo of allPhotosFlat) {
        if (photo.isDetailShot || photo.parentPhotoId) continue;
        const labels: string[] = [];
        for (const dp of allPhotosFlat) {
          if (dp.parentPhotoId === photo.id && dp.linkedPinLabel && !labels.includes(dp.linkedPinLabel)) {
            labels.push(dp.linkedPinLabel);
          }
        }
        if (labels.length === 0) continue;
        labels.sort();
        const shadeMap = new Map<string, number>();
        labels.forEach((l, i) => shadeMap.set(l, i % BLUE_SHADES_HEX.length));
        originalShadeMap.set(photo.id, shadeMap);
      }
      for (const photo of allPhotosFlat) {
        if (!photo.isDetailShot || !photo.parentPhotoId) continue;
        const parentShades = originalShadeMap.get(photo.parentPhotoId);
        if (parentShades && photo.linkedPinLabel) {
          const idx = parentShades.get(photo.linkedPinLabel);
          if (idx !== undefined) detailShadeMap.set(photo.id, idx);
        }
      }

      const getPinColor = (pin: any, photoId: number, photo: any): string | undefined => {
        const parentShades = originalShadeMap.get(photoId);
        if (parentShades && pin.label) {
          const labelStr = String(pin.label);
          const shadeIdx = parentShades.get(labelStr);
          if (shadeIdx !== undefined) return BLUE_SHADES_HEX[shadeIdx];
        }
        if (photo.isDetailShot && photo.parentPhotoId) {
          const dIdx = detailShadeMap.get(photoId);
          if (dIdx !== undefined) return BLUE_SHADES_HEX[dIdx];
        }
        return undefined;
      };

      let pdfSecsDone = 0;
      const pdfSecsTotal = sortedSections.length;
      if (job) job.total = pdfSecsTotal;

      let tocSecIdx = 0;
      for (const sec of sortedSections) {
        const allPhotos = sec.photos || [];
        const secFootage = sec.entries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
        const secReels = sec.entries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);

        // ── Phase A: classify using metadata only (no image buffers yet) ──────
        // Classification needs only photo metadata, pins, and entries — not pixel
        // data.  Separating it from buffer loading lets us determine the render
        // order and apply section-skip logic without holding any images in memory.
        type MetaWithEntries = { photoMeta: any; entries: any[] };
        const metaMatchedEntryIds = new Set<number>();
        const metaWithEntries: MetaWithEntries[] = [];
        const metaWithoutEntries: any[] = [];

        for (const photoMeta of allPhotos) {
          const photoPins = allPinsMap.get(photoMeta.id) || [];
          const pinEntryIds = new Set(photoPins.map((p: any) => p.entryId).filter(Boolean));
          const photoEntries = sec.entries.filter((e: any) => pinEntryIds.has(e.id));
          if (photoEntries.length > 0) {
            const pinLabelForEntry = (e: any) => {
              const pin = photoPins.find((p: any) => p.entryId === e.id);
              return pin?.label ?? 999;
            };
            photoEntries.sort((a: any, b: any) => pinLabelForEntry(a) - pinLabelForEntry(b));
            metaWithEntries.push({ photoMeta, entries: photoEntries });
            photoEntries.forEach((e: any) => metaMatchedEntryIds.add(e.id));
          } else {
            metaWithoutEntries.push(photoMeta);
          }
        }

        const unmatchedEntries = sec.entries.filter((e: any) => !metaMatchedEntryIds.has(e.id));

        if (unmatchedEntries.length > 0) {
          deferredUnmatchedSections.push({ aisle: sec.aisle, section: sec.section, entries: unmatchedEntries });
        }

        const hasPhotoContent = allPhotos.length > 0;
        if (!hasPhotoContent && unmatchedEntries.length === sec.entries.length) {
          if (job) job.done = ++pdfSecsDone;
          continue;
        }

        const isReceivingSection = (sec.aisle || "").toLowerCase() === "receiving";

        const detailMetaByParent = new Map<number, MetaWithEntries[]>();
        const detailMetaWithoutByParent = new Map<number, any[]>();

        const compactMeta: MetaWithEntries[] = [];
        const standardMeta: MetaWithEntries[] = [];
        for (const item of metaWithEntries) {
          if (item.photoMeta.isDetailShot && item.photoMeta.parentPhotoId) {
            const parentId = item.photoMeta.parentPhotoId;
            if (!detailMetaByParent.has(parentId)) detailMetaByParent.set(parentId, []);
            detailMetaByParent.get(parentId)!.push(item);
          } else {
            (isReceivingSection ? compactMeta : standardMeta).push(item);
          }
        }

        const compactWithoutMeta: any[] = [];
        const standardWithoutMeta: any[] = [];
        for (const photoMeta of metaWithoutEntries) {
          if (photoMeta.isDetailShot && photoMeta.parentPhotoId) {
            const parentId = photoMeta.parentPhotoId;
            if (!detailMetaWithoutByParent.has(parentId)) detailMetaWithoutByParent.set(parentId, []);
            detailMetaWithoutByParent.get(parentId)!.push(photoMeta);
          } else {
            (isReceivingSection ? compactWithoutMeta : standardWithoutMeta).push(photoMeta);
          }
        }

        const isReceivingCompactSingle = isReceivingSection
          && compactMeta.length === 1
          && compactWithoutMeta.length === 0
          && standardMeta.length === 0
          && standardWithoutMeta.length === 0
          && detailMetaByParent.size === 0
          && detailMetaWithoutByParent.size === 0;

        const sectionHeaderH = 28;
        const compactBlockMinH = 100;
        const neededForReceivingStack = sectionHeaderH + compactBlockMinH;
        const canFitOnCurrentPage = isReceivingCompactSingle && currentY > 36 && (currentY + neededForReceivingStack <= maxY);

        if (!canFitOnCurrentPage) {
          doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
          currentY = 36;
        }
        doc.addNamedDestination(`sec-${tocSecIdx}`);
        tocSecIdx++;
        const photoLabel = allPhotos.length > 0 ? `${allPhotos.length} photo${allPhotos.length !== 1 ? "s" : ""}` : undefined;
        drawSectionHeader(sec.aisle, sec.section, sec.entries.length, secReels, secFootage, photoLabel);

        const gap = 10;
        const minPhotoH = 120;

        const ensureSpace = (needed: number) => {
          if (currentY + needed > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
            drawSectionHeader(sec.aisle, sec.section, sec.entries.length, secReels, secFootage, undefined, " (Continued)");
          }
        };

        // ── Phase B: load + render + release per render unit ─────────────────
        // `loadLayouts` loads image buffers for a list of photo metadata objects
        // in slices of PDF_PHOTO_BATCH_SIZE.  After the caller renders using the
        // returned map, the map goes out of scope and GC can reclaim the buffers.
        //
        // deferFailedEntries: called when a photo fails to load so its matched
        // entries still appear in "Entries Without Photos" (same as the original
        // loadedPhotos-based matching behaviour).  Tracks deferred IDs to prevent
        // duplicates if somehow the same entry is referenced by two failed photos.
        const deferredEntryIdsForSection = new Set<number>();
        const deferFailedEntries = (entries: any[]) => {
          const fresh = entries.filter((e: any) => !deferredEntryIdsForSection.has(e.id));
          if (fresh.length > 0) {
            deferredUnmatchedSections.push({ aisle: sec.aisle, section: sec.section, entries: fresh });
            fresh.forEach((e: any) => deferredEntryIdsForSection.add(e.id));
          }
        };
        const loadLayouts = async (metas: any[]): Promise<Map<number, PhotoLayout>> => {
          const layoutMap = new Map<number, PhotoLayout>();
          for (let i = 0; i < metas.length; i += PDF_PHOTO_BATCH_SIZE) {
            const batch = metas.slice(i, i + PDF_PHOTO_BATCH_SIZE);
            const results = await Promise.all(batch.map((p: any) => loadPhoto(p)));
            batch.forEach((p: any, j: number) => {
              const pl = results[j];
              if (pl) layoutMap.set(p.id, pl);
            });
          }
          return layoutMap;
        };

        const renderDetailShotColumnList = (pl: PhotoLayout, photoEntries: any[], x: number, y: number, maxW: number, maxH: number) => {
          const imgW = Math.min(maxW * 0.38, 220);
          const hasDetailLabel = pl.photo.isDetailShot && pl.photo.parentPhotoId;
          const captionH = hasDetailLabel ? 17 : 10;
          const aspect = pl.origW / pl.origH;
          let w = imgW;
          let h = imgW / aspect;
          const availImgH = maxH - captionH;
          if (h > availImgH) { h = availImgH; w = h * aspect; if (w > imgW) { w = imgW; h = imgW / aspect; } }

          doc.image(pl.buffer, x, y, { width: w, height: h });
          const photoPins = allPinsMap.get(pl.photo.id) || [];
          const pinScale = pl.photo.pinScale || 1;
          for (const pin of photoPins) {
            if (flaggedPinIds.has(pin.id)) {
              drawFlaggedPin(pin, x, y, w, h, pl.origW, pinScale);
            } else {
              const shade = getPinColor(pin, pl.photo.id, pl.photo);
              drawCommittedPin(pin, x, y, w, h, pl.origW, pinScale, shade);
            }
          }
          doc.rect(x, y, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();

          const photoName = pl.photo.originalFilename || `Photo ${pl.photo.id}`;
          const reelTotal = photoEntries.length > 0 ? photoEntries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0) : photoPins.reduce((s: number, p: any) => s + (p.reelCount || 1), 0);
          const capParts: string[] = [photoName];
          capParts.push(`${reelTotal} reel${reelTotal !== 1 ? "s" : ""}`);
          if (pl.photo.createdAt) capParts.push(formatCT(new Date(pl.photo.createdAt)));

          let detailLabel = "";
          if (pl.photo.isDetailShot && pl.photo.parentPhotoId) {
            const parentPh = allPhotosFlat.find((p: any) => p.id === pl.photo.parentPhotoId);
            const parentName = parentPh?.originalFilename || `Photo ${pl.photo.parentPhotoId}`;
            const reason = pl.photo.linkReason || "Detail";
            const pinRef = pl.photo.linkedPinLabel ? formatPinLabel(String(pl.photo.linkedPinLabel)) : "";
            const reasonParts = [reason];
            if (pinRef) reasonParts.push(`of ${pinRef}`);
            detailLabel = `Detail: ${reasonParts.join(" ")} (from ${parentName})`;
          }

          let captionY = y + h + 1;
          if (detailLabel) {
            doc.font('Helvetica-Bold').fontSize(5).fillColor("#3B82F6")
              .text(detailLabel, x, captionY, { width: w, align: "center", lineBreak: false });
            captionY += 7;
          }
          doc.font('Helvetica').fontSize(5.5).fillColor("#666666")
            .text(capParts.join("  |  "), x, captionY, { width: w, align: "center", lineBreak: false });

          const tblX = x + w + 10;
          const tblW = maxW - w - 10;
          let tblEndY = y;

          if (photoEntries.length > 0) {
            const entryPinMap = new Map<number, string>();
            for (const pin of photoPins) {
              if (pin.entryId && pin.label) {
                entryPinMap.set(pin.entryId, formatPinLabel(String(pin.label)));
              }
            }
            let augmentedEntries = photoEntries;
            if (pl.photo.isDetailShot && pl.photo.parentPhotoId) {
              const parentPh = allPhotosFlat.find((p: any) => p.id === pl.photo.parentPhotoId);
              const parentName = parentPh?.originalFilename || `Photo ${pl.photo.parentPhotoId}`;
              const detailNote = `Detail photo of ${parentName}`;
              augmentedEntries = photoEntries.map((e: any) => ({
                ...e,
                notes: e.notes ? `${detailNote}; ${e.notes}` : detailNote,
              }));
            }
            tblEndY = drawEntriesTable(augmentedEntries, tblX, tblW, y, 5.5, 14, entryPinMap.size > 0 ? entryPinMap : undefined);
          }

          const totalH = Math.max(h + captionH, tblEndY - y);
          return { renderedH: totalH };
        };

        // Renders detail shots for a parent using buffers already in `layouts`.
        // Called right after the parent is rendered so all buffers for the unit
        // go out of scope together when the enclosing block exits.
        const renderDetailShotsWithLayouts = (parentPhotoId: number, layouts: Map<number, PhotoLayout>) => {
          const detailMinH = 90;
          for (const { photoMeta, entries: photoEntries } of (detailMetaByParent.get(parentPhotoId) || [])) {
            const dpl = layouts.get(photoMeta.id);
            if (!dpl) {
              deferFailedEntries(photoEntries);
              continue;
            }
            ensureSpace(detailMinH);
            const availH = Math.min(maxY - currentY, 200);
            const result = renderDetailShotColumnList(dpl, photoEntries, tableLeft, currentY, pageWidth, availH);
            currentY += result.renderedH + gap;
          }
          for (const photoMeta of (detailMetaWithoutByParent.get(parentPhotoId) || [])) {
            const dpl = layouts.get(photoMeta.id);
            if (!dpl) continue;
            ensureSpace(detailMinH);
            const availH = Math.min(maxY - currentY, 200);
            const result = renderDetailShotColumnList(dpl, [], tableLeft, currentY, pageWidth, availH);
            currentY += result.renderedH + gap;
          }
        };

        // Tracks IDs of parent photos that were successfully loaded and rendered.
        // Populated incrementally so that a failed parent load still allows its
        // detail shots to surface in the orphan pass below.
        const renderedParentIds = new Set<number>();

        // Compact photos (receiving section, with entries): load → render → release.
        if (compactMeta.length > 0) {
          const compactMinH = 80;
          for (const item of compactMeta) {
            const photosNeeded: any[] = [
              item.photoMeta,
              ...(detailMetaByParent.get(item.photoMeta.id) || []).map((d: MetaWithEntries) => d.photoMeta),
              ...(detailMetaWithoutByParent.get(item.photoMeta.id) || []),
            ];
            const layouts = await loadLayouts(photosNeeded);
            const pl = layouts.get(item.photoMeta.id);
            if (!pl) {
              deferFailedEntries(item.entries);
              continue;
            }
            ensureSpace(compactMinH);
            const availH = Math.min(maxY - currentY, 180);
            const result = renderCompactPhotoWithEntries(pl, item.entries, tableLeft, currentY, pageWidth, availH);
            currentY += result.renderedH + gap;
            renderedParentIds.add(item.photoMeta.id);
            renderDetailShotsWithLayouts(item.photoMeta.id, layouts);
          }
        }

        // Compact photos without entries: load each row (≤ 4) → render → release.
        if (compactWithoutMeta.length > 0) {
          let idx = 0;
          while (idx < compactWithoutMeta.length) {
            const remaining = compactWithoutMeta.length - idx;
            const perRow = Math.min(4, remaining);
            const rowPhotos: any[] = compactWithoutMeta.slice(idx, idx + perRow);
            const photosNeeded: any[] = [
              ...rowPhotos,
              ...rowPhotos.flatMap((p: any) => [
                ...(detailMetaByParent.get(p.id) || []).map((d: MetaWithEntries) => d.photoMeta),
                ...(detailMetaWithoutByParent.get(p.id) || []),
              ]),
            ];
            const layouts = await loadLayouts(photosNeeded);
            const cellW = (pageWidth - gap * (perRow - 1)) / perRow;
            const rowAspects: number[] = rowPhotos.map((p: any) => {
              const pl = layouts.get(p.id);
              return pl ? pl.origW / pl.origH : 1;
            });
            const estimatedH = Math.max(...rowAspects.map(a => cellW / a)) + 14;
            ensureSpace(Math.min(estimatedH, 200));
            const availH = maxY - currentY;
            let maxRowH = 0;
            for (let c = 0; c < perRow; c++) {
              const pl = layouts.get(rowPhotos[c].id);
              if (!pl) continue;
              const x = tableLeft + c * (cellW + gap);
              const result = renderPhoto(pl, x, currentY, cellW, availH);
              if (result.renderedH > maxRowH) maxRowH = result.renderedH;
            }
            currentY += maxRowH + gap;
            for (const photoMeta of rowPhotos) {
              if (layouts.get(photoMeta.id)) {
                renderedParentIds.add(photoMeta.id);
                renderDetailShotsWithLayouts(photoMeta.id, layouts);
              }
            }
            idx += perRow;
          }
        }

        const renderStandardPhotoAt = (item: { pl: PhotoLayout; entries: any[] }, x: number, photoW: number, tblW: number, y: number, availH: number) => {
          const tblX = x + photoW + gap;
          const result = renderPhoto(item.pl, x, y, photoW, availH, item.entries);
          let tblEndY = y;
          if (item.entries.length > 0) {
            const photoPins = allPinsMap.get(item.pl.photo.id) || [];
            const entryPinMap = new Map<number, string>();
            for (const pin of photoPins) {
              if (pin.entryId && pin.label) {
                entryPinMap.set(pin.entryId, formatPinLabel(String(pin.label)));
              }
            }
            tblEndY = drawEntriesTable(item.entries, tblX, tblW, y, 5.5, 14, entryPinMap.size > 0 ? entryPinMap : undefined);
          }
          return { bottomY: Math.max(y + result.renderedH, tblEndY) };
        };

        // Standard photos (with entries): load parent + its detail shots → render → release.
        for (const item of standardMeta) {
          const photosNeeded: any[] = [
            item.photoMeta,
            ...(detailMetaByParent.get(item.photoMeta.id) || []).map((d: MetaWithEntries) => d.photoMeta),
            ...(detailMetaWithoutByParent.get(item.photoMeta.id) || []),
          ];
          const layouts = await loadLayouts(photosNeeded);
          const pl = layouts.get(item.photoMeta.id);
          if (!pl) {
            deferFailedEntries(item.entries);
            continue;
          }
          ensureSpace(minPhotoH);
          const photoW = pageWidth * 0.45;
          const tblW = pageWidth - photoW - gap;
          const r = renderStandardPhotoAt({ pl, entries: item.entries }, tableLeft, photoW, tblW, currentY, maxY - currentY);
          currentY = r.bottomY + gap;
          renderedParentIds.add(item.photoMeta.id);
          renderDetailShotsWithLayouts(item.photoMeta.id, layouts);
          // `layouts` goes out of scope → GC can collect the image buffers
        }

        // Standard photos without entries: rows of 1 or 2 → load → render → release.
        if (standardWithoutMeta.length > 0) {
          let idx = 0;
          while (idx < standardWithoutMeta.length) {
            const remaining = standardWithoutMeta.length - idx;

            if (remaining === 1) {
              const photoMeta = standardWithoutMeta[idx];
              const photosNeeded: any[] = [
                photoMeta,
                ...(detailMetaByParent.get(photoMeta.id) || []).map((d: MetaWithEntries) => d.photoMeta),
                ...(detailMetaWithoutByParent.get(photoMeta.id) || []),
              ];
              const layouts = await loadLayouts(photosNeeded);
              const pl = layouts.get(photoMeta.id);
              if (pl) {
                ensureSpace(minPhotoH);
                const maxW = pageWidth * 0.6;
                const availH = maxY - currentY;
                const centeredX = tableLeft + (pageWidth - maxW) / 2;
                const result = renderPhoto(pl, centeredX, currentY, maxW, availH);
                currentY += result.renderedH + gap;
                renderedParentIds.add(photoMeta.id);
                renderDetailShotsWithLayouts(photoMeta.id, layouts);
              }
              idx++;
            } else {
              const photosInRow = Math.min(2, remaining);
              const rowPhotos: any[] = standardWithoutMeta.slice(idx, idx + photosInRow);
              const photosNeeded: any[] = [
                ...rowPhotos,
                ...rowPhotos.flatMap((p: any) => [
                  ...(detailMetaByParent.get(p.id) || []).map((d: MetaWithEntries) => d.photoMeta),
                  ...(detailMetaWithoutByParent.get(p.id) || []),
                ]),
              ];
              const layouts = await loadLayouts(photosNeeded);
              ensureSpace(minPhotoH);
              const cellW = (pageWidth - gap) / 2;
              const availH = maxY - currentY;
              let maxRowH = 0;
              for (let c = 0; c < photosInRow; c++) {
                const pl = layouts.get(rowPhotos[c].id);
                if (!pl) continue;
                const x = tableLeft + c * (cellW + gap);
                const result = renderPhoto(pl, x, currentY, cellW, availH);
                if (result.renderedH > maxRowH) maxRowH = result.renderedH;
              }
              currentY += maxRowH + gap;
              for (const photoMeta of rowPhotos) {
                if (layouts.get(photoMeta.id)) {
                  renderedParentIds.add(photoMeta.id);
                  renderDetailShotsWithLayouts(photoMeta.id, layouts);
                }
              }
              idx += photosInRow;
            }
          }
        }

        // Orphan detail shots: detail shots whose parent photo was not successfully
        // loaded and rendered above (renderedParentIds is built incrementally).
        // A parent whose image failed to load is NOT in renderedParentIds, so its
        // detail shots still surface here (preserving graceful failure behaviour).
        for (const [parentId, items] of detailMetaByParent) {
          if (renderedParentIds.has(parentId)) continue;
          for (const { photoMeta, entries: photoEntries } of items) {
            const layouts = await loadLayouts([photoMeta]);
            const pl = layouts.get(photoMeta.id);
            if (!pl) {
              deferFailedEntries(photoEntries);
              continue;
            }
            ensureSpace(80);
            const availH = Math.min(maxY - currentY, 180);
            const result = renderCompactPhotoWithEntries(pl, photoEntries, tableLeft, currentY, pageWidth, availH);
            currentY += result.renderedH + gap;
          }
        }
        for (const [parentId, photos] of detailMetaWithoutByParent) {
          if (renderedParentIds.has(parentId)) continue;
          for (const photoMeta of photos) {
            const layouts = await loadLayouts([photoMeta]);
            const pl = layouts.get(photoMeta.id);
            if (!pl) continue;
            ensureSpace(80);
            const availH = Math.min(maxY - currentY, 180);
            const result = renderPhoto(pl, tableLeft, currentY, pageWidth * 0.35, availH);
            currentY += result.renderedH + gap;
          }
        }
        if (job) job.done = ++pdfSecsDone;
      }

      // --- Entries Without Photos (deferred, before Summary) ---
      if (deferredUnmatchedSections.length > 0) {
        doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
        currentY = 36;
        doc.fontSize(16).fillColor(accentHex).text("Entries Without Photos", 36, currentY);
        currentY += 24;

        for (const ums of deferredUnmatchedSections) {
          const unmatchedReels = ums.entries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);
          const unmatchedFootage = ums.entries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
          const aisleDisplay = ums.aisle.toLowerCase() === "receiving" ? "Receiving Area" : `Aisle ${ums.aisle || "—"}`;

          if (currentY + 50 > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
            doc.fontSize(14).fillColor(accentHex).text("Entries Without Photos (cont.)", 36, currentY);
            currentY += 22;
          }

          doc.rect(tableLeft, currentY, pageWidth, 22).fill("#e8e0d8");
          doc.fontSize(11).fillColor(accentHex).text(
            `${aisleDisplay} / Section ${ums.section || "—"}`,
            tableLeft + 6, currentY + 4, { width: pageWidth - 100, lineBreak: false }
          );
          doc.fontSize(7).fillColor("#666666").text(
            `${ums.entries.length} entries  |  ${unmatchedReels} reels  |  ${fmtFootage(unmatchedFootage)} ${pdfULabel}`,
            tableLeft + pageWidth - 220, currentY + 6, { width: 210, align: "right", lineBreak: false }
          );
          doc.rect(tableLeft, currentY, pageWidth, 22).stroke(borderColor);
          currentY += 26;
          const afterTable = drawEntriesTable(ums.entries, tableLeft, pageWidth, currentY, 6.5, rowHeight);
          currentY = afterTable + 12;
        }
      }

      // Flagged photos are loaded one at a time inside the render loop below
      // (load → render → release) so buffers don't accumulate.

      // --- Flagged Reels Section ---
      if (flaggedPdfItems.length > 0) {
        const sortedFlaggedItems = [...flaggedPdfItems].sort((a, b) => {
          const aA = parseInt(a.photo?.aisle || "0") || 0;
          const bA = parseInt(b.photo?.aisle || "0") || 0;
          if (aA !== bA) return aA - bA;
          const aS = parseInt(a.photo?.section || "0") || 0;
          const bS = parseInt(b.photo?.section || "0") || 0;
          if (aS !== bS) return aS - bS;
          return (parseInt(a.pin.label || "0") || 0) - (parseInt(b.pin.label || "0") || 0);
        });

        doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
        currentY = 36;

        doc.fontSize(16).fillColor(accentHex).text("Flagged Reels", 36, currentY);
        currentY += 22;

        const disclaimerH = 28;
        doc.rect(tableLeft, currentY, pageWidth, disclaimerH).fill("#fff3e0");
        doc.rect(tableLeft, currentY, pageWidth, disclaimerH).strokeColor(accentHex).lineWidth(1).stroke();
        doc.fontSize(8).fillColor("#333333").text(
          "The following reels have been flagged for re-shoot or review. Their footage and reel counts are NOT included in the session totals or Grand Total.",
          tableLeft + 8, currentY + 8, { width: pageWidth - 16, lineBreak: false }
        );
        currentY += disclaimerH + 10;

        const flaggedItemH = 160;
        const flaggedGap = 12;

        for (const item of sortedFlaggedItems) {
          if (currentY + flaggedItemH > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
            doc.fontSize(14).fillColor(accentHex).text("Flagged Reels (cont.)", 36, currentY);
            currentY += 22;
          }

          const a = item.photo?.aisle || "—";
          const s = item.photo?.section || "—";
          const aisleDisplay = a.toLowerCase() === "receiving" ? "Receiving Area" : `Aisle ${a}`;
          const pinLabel = item.pin.label ? formatPinLabel(String(item.pin.label)) : "P???";

          doc.rect(tableLeft, currentY, pageWidth, 18).fill("#e8e0d8");
          doc.fontSize(9).fillColor(accentHex).text(
            `${aisleDisplay} / Section ${s}  —  ${pinLabel}`,
            tableLeft + 6, currentY + 4, { width: pageWidth - 120, lineBreak: false }
          );
          doc.fontSize(7).fillColor("#cc4400").text(
            "[FLAGGED]",
            tableLeft + pageWidth - 100, currentY + 5, { width: 90, align: "right", lineBreak: false }
          );
          doc.rect(tableLeft, currentY, pageWidth, 18).stroke(borderColor);
          currentY += 22;

          const pl = item.photo ? await loadPhoto(item.photo) : undefined;
          const photoW = Math.min(pageWidth * 0.4, 280);
          const infoX = tableLeft + photoW + 14;
          const infoW = pageWidth - photoW - 14;
          let photoBottomY = currentY;

          if (pl) {
            const captionH = 10;
            const photoMaxH = 140;
            const availH = photoMaxH - captionH;
            const aspect = pl.origW / pl.origH;
            let w = photoW;
            let h = photoW / aspect;
            if (h > availH) { h = availH; w = availH * aspect; if (w > photoW) { w = photoW; h = photoW / aspect; } }

            doc.image(pl.buffer, tableLeft, currentY, { width: w, height: h });

            const committedPins = allPinsMap.get(pl.photo.id) || [];
            const pinScale = pl.photo.pinScale || 1;
            for (const cp of committedPins) {
              if (cp.id === item.pin.id) continue;
              const shade = getPinColor(cp, pl.photo.id, pl.photo);
              drawCommittedPin(cp, tableLeft, currentY, w, h, pl.origW, pinScale, shade);
            }

            drawFlaggedPin(item.pin, tableLeft, currentY, w, h, pl.origW, pinScale);

            doc.rect(tableLeft, currentY, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();

            const captionParts: string[] = [];
            if (pl.photo.originalFilename) captionParts.push(pl.photo.originalFilename);
            if (pl.photo.createdAt) captionParts.push(formatCT(new Date(pl.photo.createdAt)));
            doc.font('Helvetica').fontSize(5.5).fillColor("#666666")
              .text(captionParts.join("  |  "), tableLeft, currentY + h + 1, { width: w, align: "center", lineBreak: false });

            photoBottomY = currentY + h + captionH;
          }

          const e = item.entry;
          const lineH = 13;
          let infoY = currentY;

          doc.font('Helvetica-Bold').fontSize(9).fillColor("#cc4400")
            .text(`${pinLabel}  [FLAGGED]`, infoX, infoY, { width: infoW, lineBreak: false });
          infoY += lineH + 2;

          if (item.pin.flagReason) {
            doc.font('Helvetica-Oblique').fontSize(7).fillColor("#cc4400")
              .text(`Reason: ${item.pin.flagReason}`, infoX, infoY, { width: infoW, lineBreak: true });
            infoY += doc.heightOfString(`Reason: ${item.pin.flagReason}`, { width: infoW }) + 4;
          }

          const infoLines: [string, string, boolean][] = [
            ["Catalog:", isSentinel(e.reelTag) ? CORRUPT_DISPLAY : (e.reelTag || "Unknown"), isSentinel(e.reelTag)],
            ["Vendor:", isSentinel(e.manufacturer) ? CORRUPT_DISPLAY : (e.manufacturer || "Unknown"), isSentinel(e.manufacturer)],
            ["Reels:", String(e.reelCount || 1), false],
            ["Footage:", e.footage ? `${fmtFootage(e.footage)} ${pdfULabel}` : `0 ${pdfULabel}`, false],
          ];
          if (e.notes) infoLines.push(["Notes:", fmtSentinel(e.notes), isSentinel(e.notes)]);

          for (const [label, value, isCorrupted] of infoLines) {
            doc.font('Helvetica-Bold').fontSize(7).fillColor("#555555")
              .text(label, infoX, infoY, { width: 55, lineBreak: false });
            doc.font(isCorrupted ? 'Helvetica-Oblique' : 'Helvetica').fontSize(7).fillColor(isCorrupted ? "#999999" : "#333333")
              .text(value, infoX + 55, infoY, { width: infoW - 55, lineBreak: false });
            infoY += lineH;
          }

          currentY = Math.max(photoBottomY, infoY) + flaggedGap;
        }
      }

      // --- Summary Totals Page ---
      doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
      currentY = 36;

      doc.fontSize(18).fillColor(accentHex).text("Summary Totals", 36, currentY);
      currentY += 24;
      doc.fontSize(9).fillColor("#666666").text(`${session.name}  |  ${session.location || "N/A"}  |  ${activeEntries.length} entries  |  ${fmtFootage(activeTotalFootage)} ${pdfULabel} total`, 36, currentY);
      currentY += 14;
      if (flaggedEntryIds.size > 0) {
        doc.fontSize(8).fillColor("#cc4400").text(`Note: ${flaggedEntryIds.size} flagged reel(s) with ${fmtFootage(flaggedFootage)} ${pdfULabel} excluded from this summary — see Flagged Reels section.`, 36, currentY);
        currentY += 14;
      }
      currentY += 6;

      const entryPinLabelMap = new Map<number, string>();
      for (const [, pins] of allPinsMap) {
        for (const pin of pins) {
          if (pin.entryId && pin.label) {
            entryPinLabelMap.set(pin.entryId, formatPinLabel(String(pin.label)));
          }
        }
      }

      const entryBlueShadeMap = new Map<number, string>();
      for (const pin of Array.from(allPinsMap.values()).flat()) {
        if (!pin.entryId) continue;
        const photo = allPhotosFlat.find((p: any) => p.id === pin.photoId);
        if (!photo || !photo.isDetailShot || !photo.parentPhotoId) continue;
        const color = getPinColor(pin, photo.id, photo);
        if (color) entryBlueShadeMap.set(pin.entryId, color);
      }

      const catalogMap = new Map<string, { vendorCode: string; totalFootage: number; reelCount: number; locations: { text: string; color?: string }[] }>();
      for (const e of activeEntries) {
        const rawCat = e.reelTag || e.wireType;
        const cat = rawCat && !isSentinel(rawCat) ? rawCat : (isSentinel(rawCat) ? CORRUPT_DISPLAY : "Uncataloged");
        const vendor = isSentinel(e.manufacturer) ? CORRUPT_DISPLAY : (e.manufacturer || "");
        const groupKey = `${cat}|||${vendor}`;
        const existing = catalogMap.get(groupKey);
        const pinLabel = entryPinLabelMap.get(e.id);
        const locParts = [e.aisle, e.section, pinLabel].filter(Boolean);
        const loc = locParts.join("-");
        const locColor = entryBlueShadeMap.get(e.id);
        if (existing) {
          existing.totalFootage += (e.footage || 0);
          existing.reelCount += (e.reelCount || 1);
          if (loc) existing.locations.push({ text: loc, color: locColor });
        } else {
          catalogMap.set(groupKey, {
            vendorCode: vendor,
            totalFootage: e.footage || 0,
            reelCount: e.reelCount || 1,
            locations: loc ? [{ text: loc, color: locColor }] : [],
          });
        }
      }

      const reelSizeOrder = [500, 1000, 2000, 2500, 5000];
      const extractReelSize = (cat: string): number => {
        const match = cat.match(/(\d+)$/);
        if (!match) return 999999;
        const num = parseInt(match[1]);
        const idx = reelSizeOrder.indexOf(num);
        return idx >= 0 ? idx : reelSizeOrder.length;
      };
      const extractWireType = (cat: string): string => {
        return cat.replace(/\d+$/, "").trim();
      };

      const allCatalogs = Array.from(catalogMap.entries())
        .map(([groupKey, data]) => {
          const catalog = groupKey.split("|||")[0];
          const wireTypeGroup = extractWireType(catalog);
          const wtu = wireTypeGroup.toUpperCase().trim();
          const vendor = data.vendorCode.toUpperCase().trim() || "?";
          const displayGroup =
            wtu === "SER"         ? `SER--${vendor}` :
            wtu.startsWith("RX")  ? `RX--${vendor}`  :
            wtu.startsWith("TC")  ? `TC--${vendor}`  :
            wireTypeGroup;
          return { catalog, wireTypeGroup, displayGroup, reelSizeIdx: extractReelSize(catalog), ...data };
        });

      const displayGroupPriority = (dg: string): number => {
        const g = dg.toUpperCase().trim();
        if (g === "THHN") return 0;
        if (g === "XHHW") return 1;
        return 2;
      };
      allCatalogs.sort((a, b) => {
        const pa = displayGroupPriority(a.displayGroup);
        const pb = displayGroupPriority(b.displayGroup);
        if (pa !== pb) return pa - pb;
        if (a.displayGroup < b.displayGroup) return -1;
        if (a.displayGroup > b.displayGroup) return 1;
        return a.reelSizeIdx - b.reelSizeIdx;
      });

      const sortedCatalogs = allCatalogs;

      const groupReelCounts = new Map<string, number>();
      for (const cat of sortedCatalogs) {
        const g = cat.displayGroup;
        groupReelCounts.set(g, (groupReelCounts.get(g) || 0) + cat.reelCount);
      }

      const sumCols = [
        { header: "Catalog:", width: 140, align: "left" as const },
        { header: "Vendor Code:", width: 100, align: "center" as const },
        { header: "# of Reels:", width: 50, align: "center" as const },
        { header: `Total (${pdfULabel}):`, width: 80, align: "center" as const },
        { header: "Reel Location(s):", width: 330, align: "left" as const },
      ];
      const sumTotalW = sumCols.reduce((s, c) => s + c.width, 0);
      const sumScaleF = pageWidth / sumTotalW;
      const sumScaled = sumCols.map(c => ({ ...c, width: Math.floor(c.width * sumScaleF) }));

      const drawSumHeader = (y: number) => {
        doc.rect(tableLeft, y, pageWidth, headerHeight).fill(headerBg);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor("#333333");
        let x = tableLeft;
        for (const col of sumScaled) {
          doc.text(col.header, x + 3, y + 4, { width: col.width - 6, lineBreak: false, align: col.align });
          const tw = doc.widthOfString(col.header);
          let ulX = x + 3;
          if (col.align === "center") ulX = x + 3 + (col.width - 6 - tw) / 2;
          doc.save().moveTo(ulX, y + 13).lineTo(ulX + tw, y + 13).lineWidth(0.4).strokeColor("#333333").stroke().restore();
          x += col.width;
        }
        doc.font('Helvetica');
        doc.rect(tableLeft, y, pageWidth, headerHeight).stroke(borderColor);
        return y + headerHeight;
      };

      currentY = drawSumHeader(currentY);

      let lastWireTypeGroup = "";
      let altIdx = 0;
      for (let i = 0; i < sortedCatalogs.length; i++) {
        const rowH = 16;
        const cat = sortedCatalogs[i];

        if (cat.displayGroup !== lastWireTypeGroup) {
          const groupH = 18;
          if (currentY + groupH + rowH > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = drawSumHeader(36);
          }
          doc.rect(tableLeft, currentY, pageWidth, groupH).fill("#e8e0d8");
          const isRxGrp = cat.displayGroup.startsWith("RX--");
          const isTcGrp = cat.displayGroup.startsWith("TC--");
          const headerLabel = isRxGrp ? "RX" : isTcGrp ? "TC" : (cat.displayGroup || "Other");
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(accentHex).text(headerLabel, tableLeft + 6, currentY + 5, { width: pageWidth - 160, lineBreak: false });
          const groupCount = groupReelCounts.get(cat.displayGroup) || 0;
          doc.fontSize(7.5).fillColor(accentHex).text(
            `${groupCount} reels`,
            tableLeft + pageWidth - 150, currentY + 5, { width: 140, align: "right", lineBreak: false }
          );
          doc.font('Helvetica');
          doc.rect(tableLeft, currentY, pageWidth, groupH).stroke(borderColor);
          currentY += groupH;
          lastWireTypeGroup = cat.displayGroup;
          altIdx = 0;
        }

        const locText = cat.locations.map((l: { text: string }) => l.text).join(", ");
        doc.font('Helvetica').fontSize(6.5);
        const locH = locText ? doc.heightOfString(locText, { width: sumScaled[4].width - 6 }) : 0;
        const actualRowH = Math.max(rowH, locH + 8);

        if (currentY + actualRowH > maxY) {
          doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
          currentY = drawSumHeader(36);
        }
        if (altIdx % 2 === 1) doc.rect(tableLeft, currentY, pageWidth, actualRowH).fill("#fafaf8");
        doc.fontSize(6.5).fillColor("#333333");
        let x = tableLeft;
        const vals = [
          `    ${cat.catalog}`,
          cat.vendorCode,
          String(cat.reelCount),
          `${fmtFootage(cat.totalFootage)} ${pdfULabel}`,
          "",
        ];
        const aligns: ("left" | "center")[] = ["left", "center", "center", "center", "left"];
        for (let j = 0; j < sumScaled.length; j++) {
          const cellY = j < 4
            ? currentY + Math.max(1, (actualRowH - 6.5) / 2)
            : currentY + 4;
          if (j === 3) doc.font('Helvetica-Bold');
          if (j === 4) {
            const locCellX = x + 3;
            const locCellW = sumScaled[j].width - 6;
            const locCellY = cellY;
            let locDrawX = locCellX;
            let locDrawY = locCellY;
            const locLineH = 7.5;
            doc.font('Helvetica').fontSize(6.5);
            for (let li = 0; li < cat.locations.length; li++) {
              const locItem = cat.locations[li];
              const segment = li < cat.locations.length - 1 ? `${locItem.text}, ` : locItem.text;
              doc.fillColor(locItem.color || "#333333");
              const segW = doc.widthOfString(segment);
              if (locDrawX + segW > locCellX + locCellW && locDrawX > locCellX) {
                locDrawX = locCellX;
                locDrawY += locLineH;
              }
              doc.text(segment, locDrawX, locDrawY, { lineBreak: false, continued: false });
              locDrawX += segW;
            }
          } else {
            doc.text(vals[j], x + 3, cellY, { width: sumScaled[j].width - 6, lineBreak: false, align: aligns[j] });
          }
          if (j === 3) doc.font('Helvetica');
          x += sumScaled[j].width;
        }
        doc.rect(tableLeft, currentY, pageWidth, actualRowH).stroke(borderColor);
        currentY += actualRowH;
        altIdx++;
      }

      currentY += 6;
      doc.rect(tableLeft, currentY, pageWidth, rowHeight).fill(headerBg);
      doc.font('Helvetica-Bold').fontSize(7).fillColor("#333333");
      let tx = tableLeft;
      const totalVals = ["GRAND TOTAL", "", `${sortedCatalogs.reduce((s, c) => s + c.reelCount, 0)} reels`, `${fmtFootage(activeTotalFootage)} total ${pdfULabel}`, `${sortedCatalogs.length} total catalogs`];
      const totalAligns: ("left" | "center")[] = ["left", "center", "center", "center", "left"];
      for (let j = 0; j < sumScaled.length; j++) {
        doc.text(totalVals[j], tx + 3, currentY + 4, { width: sumScaled[j].width - 6, lineBreak: false, align: totalAligns[j] });
        tx += sumScaled[j].width;
      }
      doc.font('Helvetica');
      doc.rect(tableLeft, currentY, pageWidth, rowHeight).strokeColor("#000000").lineWidth(1.5).stroke();
      currentY += rowHeight;

      // --- Audit Trail ---
      currentY += 20;
      if (currentY + 90 > maxY) {
        doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
        currentY = 36;
      }
      doc.moveTo(36, currentY).lineTo(36 + pageWidth, currentY).strokeColor(accentHex).lineWidth(2).stroke();
      currentY += 8;
      doc.font('Helvetica-Bold').fontSize(8).fillColor("#333333");
      doc.text("Audit Trail:", 36, currentY, { lineBreak: false });
      const atLabelW = doc.widthOfString("Audit Trail:");
      doc.save().moveTo(36, currentY + 9).lineTo(36 + atLabelW, currentY + 9).lineWidth(0.5).strokeColor("#333333").stroke().restore();
      doc.font('Helvetica');
      currentY += 14;
      const ctGeneratedAt = formatCT(new Date());
      const auditLabel = (label: string, value: string) => {
        doc.font('Helvetica-Bold').fontSize(7).fillColor("#000000");
        const labelW = doc.widthOfString(label);
        doc.text(label, 36, currentY, { lineBreak: false });
        doc.save().moveTo(36, currentY + 8).lineTo(36 + labelW, currentY + 8).lineWidth(0.4).strokeColor("#000000").stroke().restore();
        doc.font('Helvetica').fillColor("#000000");
        doc.text(` ${value}`, 36 + labelW, currentY, { lineBreak: false });
        currentY += 11;
      };
      auditLabel("Report Generated:", ctGeneratedAt);
      auditLabel("Starting Photo:", pt.firstPhotoAt ? formatCT(new Date(pt.firstPhotoAt)) : "N/A");
      auditLabel("Ending Photo:", pt.lastPhotoAt ? formatCT(new Date(pt.lastPhotoAt)) : "N/A");
      if (pt.firstPhotoAt && pt.lastPhotoAt) {
        auditLabel("Elapsed Time:", formatElapsed(new Date(pt.firstPhotoAt).getTime(), new Date(pt.lastPhotoAt).getTime()));
      } else {
        auditLabel("Elapsed Time:", "N/A");
      }
      if (session.completedAt) { auditLabel("Completed:", formatCT(new Date(session.completedAt))); }
      auditLabel("Total Number of Reels:", String(sortedCatalogs.reduce((s, c) => s + c.reelCount, 0)));
      auditLabel("Data Encoding:", key ? "Active (entries decrypted for export)" : "Off");
      if (hasCorruptedEntries) {
        doc.font('Helvetica-Oblique').fontSize(7).fillColor("#cc4400");
        doc.text("Data Integrity Warning: One or more entry fields could not be decrypted and are shown as (corrupted) in this report. Re-enter the correct encryption key in Settings to recover the original values.", 36, currentY, { width: pageWidth, lineBreak: true });
        currentY += doc.heightOfString("Data Integrity Warning: One or more entry fields could not be decrypted and are shown as (corrupted) in this report. Re-enter the correct encryption key in Settings to recover the original values.", { width: pageWidth }) + 4;
        doc.font('Helvetica');
      }
      currentY += 5;

      doc.rect(36, currentY, 260, 20).strokeColor(accentHex).lineWidth(1.5).stroke();
      doc.fontSize(7).fillColor(accentHex).text(`VERIFIED EXPORT - ${ctGeneratedAt}`, 42, currentY + 6);

      if (footerText) {
        currentY += 28;
        doc.fontSize(8).fillColor("#999999").text(footerText, 36, currentY, { width: 300, lineBreak: true, height: maxY - currentY });
      }

      // --- Remove trailing blank pages ---
      const pageBuf = (doc as any)._pageBuffer;
      if (pageBuf && pageBuf.length > 1) {
        while (pageBuf.length > 1) {
          const lastPg = pageBuf[pageBuf.length - 1];
          const contentRef = lastPg && lastPg.content;
          const isBlank = contentRef && contentRef.uncompressedLength != null && contentRef.uncompressedLength <= 20;
          if (!isBlank) break;
          pageBuf.pop();
        }
      }

      console.log(`[pdf] layout+render done in ${Date.now() - t0}ms`);
      doc.end();

      await new Promise<void>((resolve, reject) => {
        bufferStream.on("finish", resolve);
        bufferStream.on("error", reject);
      });

      const pdfBuffer = Buffer.concat(pdfChunks);
      logActivity(session.id, userId, (req as AuthenticatedRequest).user?.claims?.username, "exported_pdf", "session", session.id);
      if (job) {
        job.buffer = pdfBuffer;
        job.filename = filename;
        job.complete = true;
        job.completedAt = Date.now();
      } else {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        res.send(pdfBuffer);
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      if (job) {
        job.error = error instanceof Error ? error.message : "Failed to generate PDF";
        job.complete = true;
        job.completedAt = Date.now();
      } else if (!res.headersSent) {
        res.status(500).json({ message: "Failed to generate report" });
      }
    } finally {
      taskTracker.decrement();
      taskTracker.endSession(_sid, "pdf");
    }
  });

  // Export session data (authenticated, decrypted)
  app.get("/api/sessions/:id/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const session = access.session;
      const rawEntries = await storage.getSessionEntries(session.id);
      const key = await getEncryptionKey(userId);
      const sessionEntries = key ? rawEntries.map(e => decryptEntry(e, key, { strict: false }) as any) : rawEntries;
      const sessionPhotos = await storage.getSessionPhotos(session.id);
      res.json({ session, entries: sessionEntries, photos: sessionPhotos });
    } catch (error) {
      res.status(500).json({ message: "Failed to export session" });
    }
  });

  app.get("/api/sessions/:id/export/excel", isAuthenticated, async (req: any, res) => {
    const _sid = parseInt(req.params.id);
    taskTracker.increment();
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      taskTracker.startSession(_sid, "excel");
      const session = access.session;
      const rawEntries = await storage.getSessionEntries(session.id);
      const key = await getEncryptionKey(userId);
      const sessionEntries = correctEntryFootage(key ? rawEntries.map(e => decryptEntry(e, key, { strict: false }) as any) : rawEntries);
      const sessionPhotos = await storage.getSessionPhotos(session.id);
      const allFlaggedPins = await storage.getSessionFlaggedPins(session.id);
      const flaggedEntryIds = new Set<number>(
        allFlaggedPins.filter((p: any) => p.entryId != null).map((p: any) => p.entryId as number)
      );
      const photoStats = await storage.getSessionPhotoStats([session.id]);
      const pt = photoStats.get(session.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };

      const userSettingsData = await storage.getUserSettings(userId);
      const userTz = userSettingsData?.timezone || "America/Chicago";
      const xlUnit: UnitType = (userSettingsData?.defaultUnit as UnitType) || "feet";
      const xlULabel = unitLabel(xlUnit);
      const xlFmt = (ft: number) => toDisplayUnit(ft, xlUnit);
      const companyName = typeof req.query.companyName === "string" ? req.query.companyName : null;

      const TZ_ABBR: Record<string, string> = {
        "America/New_York": "ET", "America/Chicago": "CT", "America/Denver": "MT",
        "America/Los_Angeles": "PT", "America/Anchorage": "AKT", "Pacific/Honolulu": "HT",
        "America/Phoenix": "MST", "UTC": "UTC",
      };
      const tzAbbr = TZ_ABBR[userTz] || userTz;
      const fmtDt = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: userTz, month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
      const fmtElapsed = (ms: number): string => {
        if (ms < 60000) return `${Math.round(ms / 1000)}s`;
        const totalMin = Math.floor(ms / 60000);
        if (totalMin < 60) return `${totalMin}m`;
        const h = Math.floor(totalMin / 60); const m = totalMin % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
      };

      const allPinsByPhoto = new Map<number, any[]>();
      for (const p of sessionPhotos) {
        const photoPins = await storage.getPhotoPins(p.id);
        const committed = photoPins.filter((pin: any) => pin.entryId != null);
        if (committed.length > 0) allPinsByPhoto.set(p.id, committed);
      }
      const entryPinMap = new Map<number, any>();
      for (const [, pins] of allPinsByPhoto) {
        for (const pin of pins) {
          if (pin.entryId) entryPinMap.set(pin.entryId, pin);
        }
      }

      const activeEntries = (sessionEntries as any[]).filter((e: any) => !flaggedEntryIds.has(e.id));
      const flaggedEntries = (sessionEntries as any[]).filter((e: any) => flaggedEntryIds.has(e.id));
      const activeTotalFootage = activeEntries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
      const totalReels = activeEntries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);
      const flaggedFootage = flaggedEntries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
      const flaggedReelCount = flaggedEntries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);

      const safeStr = (v: any): string => {
        if (v == null) return "";
        const s = String(v);
        if (s.length > 0 && "=+-@\t\r".includes(s[0])) return "'" + s;
        return s;
      };
      const xlIsSentinel = (v: any): boolean => v === UNREADABLE_SENTINEL;
      const xlFmtSentinel = (v: any): string => xlIsSentinel(v) ? "(corrupted)" : safeStr(v);
      const xlHasCorrupted = (sessionEntries as any[]).some((e: any) =>
        [e.reelTag, e.wireType, e.gauge, e.color, e.manufacturer, e.notes].some(xlIsSentinel)
      );
      const corruptedCellBg = "FFF3E0";

      const accentHex = "EA580C";
      const headerBg = "F5F0EB";
      const sectionBandBg = "E8E0D8";
      const altRowBg = "FAFAF8";
      const flaggedRowBg = "FFF0F0";
      const flaggedBandBg = "FFDDCC";
      const summaryGroupBg = "E8E0D8";

      const wb = new ExcelJS.Workbook();
      wb.creator = "Master Reel Counter";
      wb.created = new Date();
      const ws = wb.addWorksheet("Reel Count", { views: [{ showGridLines: false }] });

      ws.columns = [
        { key: "pin", width: 8 },
        { key: "aisle", width: 10 },
        { key: "section", width: 10 },
        { key: "catalog", width: 22 },
        { key: "vendor", width: 14 },
        { key: "reels", width: 10 },
        { key: "footage", width: 14 },
        { key: "color", width: 12 },
        { key: "notes", width: 28 },
        { key: "flagged", width: 10 },
        { key: "flagReason", width: 22 },
        { key: "detailOf", width: 22 },
      ];

      const thinBorder: Partial<ExcelJS.Borders> = {
        top: { style: "thin", color: { argb: "CCCCCC" } },
        bottom: { style: "thin", color: { argb: "CCCCCC" } },
        left: { style: "thin", color: { argb: "CCCCCC" } },
        right: { style: "thin", color: { argb: "CCCCCC" } },
      };

      let row = 1;

      if (companyName) {
        const r = ws.getRow(row);
        r.getCell(1).value = safeStr(companyName);
        r.getCell(1).font = { size: 10, color: { argb: "999999" } };
        row++;
      }

      const titleRow = ws.getRow(row);
      titleRow.getCell(1).value = "Master Reel Counter";
      titleRow.getCell(1).font = { size: 16, bold: true, color: { argb: accentHex } };
      row++;

      const nameRow = ws.getRow(row);
      nameRow.getCell(1).value = safeStr(session.name);
      nameRow.getCell(1).font = { size: 13, color: { argb: "222222" } };
      row++;

      const coverData: [string, string][] = [
        ["Location:", session.location || "N/A"],
        ["Status:", session.status.charAt(0).toUpperCase() + session.status.slice(1)],
        ["Total Reels:", totalReels.toLocaleString()],
        ["Total Footage:", `${xlFmt(activeTotalFootage).toLocaleString()} ${xlULabel}`],
      ];
      if (flaggedEntryIds.size > 0) {
        coverData.push(["Flagged (excl.):", `${flaggedReelCount} reels / ${xlFmt(flaggedFootage).toLocaleString()} ${xlULabel}`]);
      }
      coverData.push(["Photos:", pt.photoCount.toLocaleString()]);
      if (pt.firstPhotoAt) {
        coverData.push(["Session Start:", `${fmtDt(new Date(pt.firstPhotoAt))} ${tzAbbr}`]);
        if (pt.lastPhotoAt) {
          coverData.push(["Session End:", `${fmtDt(new Date(pt.lastPhotoAt))} ${tzAbbr}`]);
          const diffMs = Math.abs(new Date(pt.lastPhotoAt).getTime() - new Date(pt.firstPhotoAt).getTime());
          coverData.push(["Elapsed Time:", fmtElapsed(diffMs)]);
        }
      }

      const mid = Math.ceil(coverData.length / 2);
      const leftCol = coverData.slice(0, mid);
      const rightCol = coverData.slice(mid);
      const coverRows = Math.max(leftCol.length, rightCol.length);
      for (let ci = 0; ci < coverRows; ci++) {
        const r = ws.getRow(row);
        if (ci < leftCol.length) {
          r.getCell(1).value = leftCol[ci][0];
          r.getCell(1).font = { size: 9, bold: true, color: { argb: "000000" } };
          r.getCell(2).value = safeStr(leftCol[ci][1]);
          r.getCell(2).font = { size: 9, color: { argb: "222222" } };
        }
        if (ci < rightCol.length) {
          r.getCell(5).value = rightCol[ci][0];
          r.getCell(5).font = { size: 9, bold: true, color: { argb: "000000" } };
          r.getCell(6).value = safeStr(rightCol[ci][1]);
          r.getCell(6).font = { size: 9, color: { argb: "222222" } };
        }
        row++;
      }

      if (session.description) {
        row++;
        const r = ws.getRow(row);
        r.getCell(1).value = safeStr(session.description);
        r.getCell(1).font = { size: 9, color: { argb: "666666" } };
        ws.mergeCells(row, 1, row, 6);
        row++;
      }

      row += 2;

      const sortEntries = (entries: any[]) => {
        return [...entries].sort((a: any, b: any) => {
          const aA = parseInt(a.aisle) || 0;
          const bA = parseInt(b.aisle) || 0;
          if (aA !== bA) return aA - bA;
          if ((a.aisle || "") < (b.aisle || "")) return -1;
          if ((a.aisle || "") > (b.aisle || "")) return 1;
          const aS = parseInt(a.section) || 0;
          const bS = parseInt(b.section) || 0;
          if (aS !== bS) return aS - bS;
          const aPin = entryPinMap.get(a.id);
          const bPin = entryPinMap.get(b.id);
          const aPL = parseInt(aPin?.label || "999") || 999;
          const bPL = parseInt(bPin?.label || "999") || 999;
          return aPL - bPL;
        });
      };

      const detailPhotoMap = new Map<number, { reason: string; pinLabel: string }>();
      for (const p of sessionPhotos) {
        if (p.isDetailShot && p.parentPhotoId) {
          const reason = p.linkReason || "";
          const pinLabel = p.linkedPinLabel || "";
          detailPhotoMap.set(p.id, { reason, pinLabel });
        }
      }

      const entryHeaders = ["Pin:", "Aisle:", "Section:", "Catalog:", "Vendor:", "# Reels:", `Footage (${xlULabel}):`, "Color:", "Notes:", "Flagged:", "Flag Reason:", "Detail Of:"];
      const headerRow = ws.getRow(row);
      const centeredHeaderCols = new Set([1, 2, 4, 5, 6, 7, 9]);
      entryHeaders.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { size: 9, bold: true, underline: true, color: { argb: "000000" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBg } };
        cell.border = thinBorder;
        cell.alignment = { vertical: "middle", horizontal: centeredHeaderCols.has(i) ? "center" : undefined };
      });
      headerRow.height = 20;
      row++;

      const writeEntryRow = (e: any, isFlagged: boolean, altShade: boolean) => {
        const pin = entryPinMap.get(e.id);
        const pinLabel = pin?.label ? formatPinLabel(String(pin.label)) : "";
        const flagPin = isFlagged ? allFlaggedPins.find((fp: any) => fp.entryId === e.id) : null;
        let detailOfText = "";
        if (e.photoId) {
          const detailInfo = detailPhotoMap.get(e.photoId);
          if (detailInfo) {
            const parts: string[] = [];
            if (detailInfo.reason) parts.push(detailInfo.reason);
            if (detailInfo.pinLabel) parts.push(`of ${formatPinLabel(String(detailInfo.pinLabel))}`);
            detailOfText = parts.length > 0 ? parts.join(" ") : "Detail shot";
          }
        }
        const corruptedCols = new Set<number>();
        if (xlIsSentinel(e.reelTag)) corruptedCols.add(3);
        if (xlIsSentinel(e.manufacturer)) corruptedCols.add(4);
        if (xlIsSentinel(e.color)) corruptedCols.add(7);
        if (xlIsSentinel(e.notes)) corruptedCols.add(8);
        const vals = [
          pinLabel, safeStr(e.aisle), safeStr(e.section),
          xlFmtSentinel(e.reelTag), xlFmtSentinel(e.manufacturer),
          e.reelCount || 1, xlFmt(e.footage || 0),
          xlFmtSentinel(e.color),
          xlFmtSentinel(e.notes),
          isFlagged ? "Yes" : "",
          safeStr(flagPin?.flagReason),
          safeStr(detailOfText),
        ];
        const r = ws.getRow(row);
        r.height = 16;
        const centeredCols = new Set([1, 2, 4, 5, 6, 7, 9]);
        vals.forEach((v, i) => {
          const cell = r.getCell(i + 1);
          cell.value = v;
          const isCorruptedCell = corruptedCols.has(i);
          if (isCorruptedCell) {
            cell.font = { size: 8.5, italic: true, color: { argb: "999999" } };
          } else {
            cell.font = { size: 8.5, color: { argb: isFlagged ? "CC4400" : "333333" } };
          }
          cell.border = thinBorder;
          cell.alignment = { vertical: "middle", wrapText: i === 8, horizontal: centeredCols.has(i) ? "center" : undefined, indent: i === 0 ? 2 : undefined };
          if (i === 0 && pinLabel) cell.font = { size: 8.5, bold: true, color: { argb: accentHex } };
          if (i === 6 && typeof v === "number" && v > 0) cell.numFmt = `#,##0" ${xlULabel}"`;
          if (isCorruptedCell) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: corruptedCellBg } };
          } else if (isFlagged) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: flaggedRowBg } };
          } else if (altShade) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: altRowBg } };
          }
        });
        row++;
      };

      const writeSectionBand = (aisle: string, section: string, entryCount: number, reelCount: number, footage: number) => {
        const r = ws.getRow(row);
        const label = `Aisle ${aisle || "—"}  /  Section ${section || "—"}  —  ${entryCount} entries, ${reelCount} reels, ${xlFmt(footage).toLocaleString()} ${xlULabel}`;
        r.getCell(1).value = label;
        r.getCell(1).font = { size: 9.5, bold: true, color: { argb: accentHex } };
        ws.mergeCells(row, 1, row, 12);
        r.height = 22;
        for (let c = 1; c <= 12; c++) {
          r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: sectionBandBg } };
          r.getCell(c).border = thinBorder;
        }
        row++;
      };

      const sortedActive = sortEntries(activeEntries);
      let lastSecKey = "";
      let altIdx = 0;
      for (const e of sortedActive) {
        const secKey = `${e.aisle || ""}|||${e.section || ""}`;
        if (secKey !== lastSecKey) {
          const secEntries = sortedActive.filter((x: any) => `${x.aisle || ""}|||${x.section || ""}` === secKey);
          const secReels = secEntries.reduce((s: number, x: any) => s + (x.reelCount || 1), 0);
          const secFt = secEntries.reduce((s: number, x: any) => s + (x.footage || 0), 0);
          writeSectionBand(e.aisle || "", e.section || "", secEntries.length, secReels, secFt);
          lastSecKey = secKey;
          altIdx = 0;
        }
        writeEntryRow(e, false, altIdx % 2 === 1);
        altIdx++;
      }

      if (flaggedEntries.length > 0) {
        row++;
        const flagBandRow = ws.getRow(row);
        flagBandRow.getCell(1).value = `Flagged Reels (${flaggedEntries.length}) — excluded from totals`;
        flagBandRow.getCell(1).font = { size: 9.5, bold: true, color: { argb: "CC4400" } };
        ws.mergeCells(row, 1, row, 12);
        flagBandRow.height = 22;
        for (let c = 1; c <= 12; c++) {
          flagBandRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: flaggedBandBg } };
          flagBandRow.getCell(c).border = thinBorder;
        }
        row++;

        const sortedFlagged = sortEntries(flaggedEntries);
        for (let fi = 0; fi < sortedFlagged.length; fi++) {
          writeEntryRow(sortedFlagged[fi], true, fi % 2 === 1);
        }
      }

      row += 2;

      const sumTitleRow = ws.getRow(row);
      sumTitleRow.getCell(1).value = "Summary Totals";
      sumTitleRow.getCell(1).font = { size: 14, bold: true, color: { argb: accentHex } };
      row++;
      const sumSubRow = ws.getRow(row);
      sumSubRow.getCell(1).value = safeStr(`${session.name}  |  ${session.location || "N/A"}  |  ${activeEntries.length} entries  |  ${xlFmt(activeTotalFootage).toLocaleString()} ${xlULabel} total`);
      sumSubRow.getCell(1).font = { size: 8.5, color: { argb: "666666" } };
      ws.mergeCells(row, 1, row, 8);
      row++;
      if (flaggedEntryIds.size > 0) {
        const noteRow = ws.getRow(row);
        noteRow.getCell(1).value = `Note: ${flaggedEntryIds.size} flagged reel(s) with ${xlFmt(flaggedFootage).toLocaleString()} ${xlULabel} excluded from this summary — see Flagged Reels above.`;
        noteRow.getCell(1).font = { size: 8, color: { argb: "CC4400" } };
        ws.mergeCells(row, 1, row, 10);
        row++;
      }
      row++;

      const sumHeaders = ["Catalog", "Vendor Code", "# Reels", `Total Footage (${xlULabel})`, "Reel Location(s)"];
      const sumHeaderRow = ws.getRow(row);
      sumHeaders.forEach((h, i) => {
        const cell = sumHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.font = { size: 9, bold: true, color: { argb: "333333" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBg } };
        cell.border = thinBorder;
      });
      sumHeaderRow.height = 20;
      row++;

      const extractWireType = (cat: string) => cat.replace(/\d+$/, "").trim();
      const reelSizeOrder = [500, 1000, 2000, 2500, 5000];
      const extractReelSize = (cat: string): number => {
        const match = cat.match(/(\d+)$/);
        if (!match) return 999999;
        const num = parseInt(match[1]);
        const idx = reelSizeOrder.indexOf(num);
        return idx >= 0 ? idx : reelSizeOrder.length;
      };

      const catalogMap = new Map<string, { vendorCode: string; totalFootage: number; reelCount: number; locations: string[] }>();
      for (const e of activeEntries) {
        const rawXlCat = e.reelTag || e.wireType;
        const cat = rawXlCat && !xlIsSentinel(rawXlCat) ? rawXlCat : (xlIsSentinel(rawXlCat) ? "(corrupted)" : "Uncataloged");
        const vendor = xlIsSentinel(e.manufacturer) ? "(corrupted)" : (e.manufacturer || "");
        const groupKey = `${cat}|||${vendor}`;
        const existing = catalogMap.get(groupKey);
        const pin = entryPinMap.get(e.id);
        const pinLabel = pin?.label ? formatPinLabel(String(pin.label)) : undefined;
        const locParts = [e.aisle, e.section, pinLabel].filter(Boolean);
        const loc = locParts.join("-");
        if (existing) {
          existing.totalFootage += (e.footage || 0);
          existing.reelCount += (e.reelCount || 1);
          if (loc) existing.locations.push(loc);
        } else {
          catalogMap.set(groupKey, { vendorCode: vendor, totalFootage: e.footage || 0, reelCount: e.reelCount || 1, locations: loc ? [loc] : [] });
        }
      }

      const allCatalogs = Array.from(catalogMap.entries()).map(([groupKey, data]) => {
        const catalog = groupKey.split("|||")[0];
        const wireTypeGroup = extractWireType(catalog);
        const wtu = wireTypeGroup.toUpperCase().trim();
        const vendor = data.vendorCode.toUpperCase().trim() || "?";
        const displayGroup = wtu === "SER" ? `SER--${vendor}` : wtu.startsWith("RX") ? `RX--${vendor}` : wtu.startsWith("TC") ? `TC--${vendor}` : wireTypeGroup;
        return { catalog, wireTypeGroup, displayGroup, reelSizeIdx: extractReelSize(catalog), ...data };
      });

      const displayGroupPriority = (dg: string): number => {
        const g = dg.toUpperCase().trim();
        if (g === "THHN") return 0;
        if (g === "XHHW") return 1;
        return 2;
      };
      allCatalogs.sort((a, b) => {
        const pa = displayGroupPriority(a.displayGroup);
        const pb = displayGroupPriority(b.displayGroup);
        if (pa !== pb) return pa - pb;
        if (a.displayGroup < b.displayGroup) return -1;
        if (a.displayGroup > b.displayGroup) return 1;
        return a.reelSizeIdx - b.reelSizeIdx;
      });

      const groupReelCounts = new Map<string, number>();
      for (const cat of allCatalogs) {
        groupReelCounts.set(cat.displayGroup, (groupReelCounts.get(cat.displayGroup) || 0) + cat.reelCount);
      }

      let lastDisplayGroup = "";
      let sumAltIdx = 0;
      for (const cat of allCatalogs) {
        if (cat.displayGroup !== lastDisplayGroup) {
          const isRx = cat.displayGroup.startsWith("RX--");
          const isTc = cat.displayGroup.startsWith("TC--");
          const headerLabel = isRx ? "RX" : isTc ? "TC" : (cat.displayGroup || "Other");
          const groupCount = groupReelCounts.get(cat.displayGroup) || 0;
          const gRow = ws.getRow(row);
          gRow.getCell(1).value = safeStr(headerLabel);
          gRow.getCell(1).font = { size: 9, bold: true, color: { argb: accentHex } };
          gRow.getCell(5).value = `${groupCount} reels`;
          gRow.getCell(5).font = { size: 9, color: { argb: accentHex } };
          gRow.getCell(5).alignment = { horizontal: "right" };
          ws.mergeCells(row, 1, row, 4);
          gRow.height = 20;
          for (let c = 1; c <= 5; c++) {
            gRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: summaryGroupBg } };
            gRow.getCell(c).border = thinBorder;
          }
          row++;
          lastDisplayGroup = cat.displayGroup;
          sumAltIdx = 0;
        }

        const r = ws.getRow(row);
        const catVals: any[] = [safeStr(cat.catalog), safeStr(cat.vendorCode), cat.reelCount, xlFmt(cat.totalFootage), safeStr(cat.locations.join(", "))];
        catVals.forEach((v, i) => {
          const cell = r.getCell(i + 1);
          cell.value = v;
          cell.font = { size: 8.5, color: { argb: "333333" } };
          if (i === 3) cell.font = { size: 8.5, bold: true, color: { argb: "333333" } };
          cell.border = thinBorder;
          if (i === 2 || i === 3) cell.alignment = { horizontal: "center" };
          if (i === 3 && typeof v === "number") cell.numFmt = `#,##0" ${xlULabel}"`;
          if (i === 4) cell.alignment = { wrapText: true };
          if (sumAltIdx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: altRowBg } };
        });
        row++;
        sumAltIdx++;
      }

      const grandRow = ws.getRow(row);
      const grandVals = ["GRAND TOTAL", "", allCatalogs.reduce((s, c) => s + c.reelCount, 0), xlFmt(activeTotalFootage), `${allCatalogs.length} catalogs`];
      const thickBorder: Partial<ExcelJS.Borders> = {
        top: { style: "medium", color: { argb: "000000" } },
        bottom: { style: "medium", color: { argb: "000000" } },
        left: { style: "medium", color: { argb: "000000" } },
        right: { style: "medium", color: { argb: "000000" } },
      };
      grandVals.forEach((v, i) => {
        const cell = grandRow.getCell(i + 1);
        cell.value = v;
        cell.font = { size: 9, bold: true, color: { argb: "333333" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBg } };
        cell.border = thickBorder;
        if (i === 2 || i === 3) cell.alignment = { horizontal: "center" };
        if (i === 3 && typeof v === "number") cell.numFmt = `#,##0" ${xlULabel}"`;
        if (i === 2 && typeof v === "number") cell.numFmt = '#,##0" reels"';
      });
      grandRow.height = 20;
      row += 3;

      const auditTitleRow = ws.getRow(row);
      auditTitleRow.getCell(1).value = "Audit Trail";
      auditTitleRow.getCell(1).font = { size: 11, bold: true, color: { argb: "333333" } };
      row++;
      const nowStr = fmtDt(new Date()) + " " + tzAbbr;
      const auditData: [string, string][] = [
        ["Report Generated:", nowStr],
        ["Starting Photo:", pt.firstPhotoAt ? fmtDt(new Date(pt.firstPhotoAt)) + " " + tzAbbr : "N/A"],
        ["Ending Photo:", pt.lastPhotoAt ? fmtDt(new Date(pt.lastPhotoAt)) + " " + tzAbbr : "N/A"],
      ];
      if (pt.firstPhotoAt && pt.lastPhotoAt) {
        auditData.push(["Elapsed Time:", fmtElapsed(Math.abs(new Date(pt.lastPhotoAt).getTime() - new Date(pt.firstPhotoAt).getTime()))]);
      }
      if (session.completedAt) auditData.push(["Completed:", fmtDt(new Date(session.completedAt)) + " " + tzAbbr]);
      auditData.push(["Total Reels:", String(totalReels)]);
      auditData.push(["Data Encoding:", key ? "Active (entries decrypted for export)" : "Off"]);
      if (xlHasCorrupted) {
        auditData.push(["Data Integrity:", "Warning: fields shown as (corrupted) could not be decrypted — re-enter encryption key in Settings to recover"]);
      }

      for (const [label, value] of auditData) {
        const r = ws.getRow(row);
        r.getCell(1).value = label;
        r.getCell(1).font = { size: 8, bold: true, color: { argb: "000000" } };
        r.getCell(2).value = value;
        r.getCell(2).font = { size: 8, color: { argb: "000000" } };
        row++;
      }
      row++;
      const verifiedRow = ws.getRow(row);
      verifiedRow.getCell(1).value = `VERIFIED EXPORT - ${nowStr}`;
      verifiedRow.getCell(1).font = { size: 8, bold: true, color: { argb: accentHex } };
      verifiedRow.getCell(1).border = {
        top: { style: "medium", color: { argb: accentHex } },
        bottom: { style: "medium", color: { argb: accentHex } },
        left: { style: "medium", color: { argb: accentHex } },
        right: { style: "medium", color: { argb: accentHex } },
      };
      ws.mergeCells(row, 1, row, 4);

      const formatExportTime = (d: Date) => {
        let h = d.getHours();
        const m = d.getMinutes();
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${h}'${String(m).padStart(2, "0")}${ampm}`;
      };
      const formatExportDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const buildFilename = () => {
        const safeName = session.name.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, " ").trim();
        const first = pt.firstPhotoAt ? new Date(pt.firstPhotoAt) : null;
        const last = pt.lastPhotoAt ? new Date(pt.lastPhotoAt) : null;
        if (!first) return `${safeName.replace(/ /g, "_")}.xlsx`;
        const d1 = formatExportDate(first);
        const t1 = formatExportTime(first);
        if (!last || first.getTime() === last.getTime()) return `${safeName}_${d1}_${t1}.xlsx`;
        const d2 = formatExportDate(last);
        const t2 = formatExportTime(last);
        if (d1 === d2) return `${safeName}_${d1}_${t1}-${t2}.xlsx`;
        return `${safeName}_${d1}_${t1}-${d2}_${t2}.xlsx`;
      };

      const buffer = await wb.xlsx.writeBuffer();
      const filename = buildFilename();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", (buffer as Buffer).length);
      logActivity(session.id, userId, (req as AuthenticatedRequest).user?.claims?.username, "exported_excel", "session", session.id);
      res.send(buffer);
    } catch (error) {
      console.error("Error generating Excel:", error);
      if (!res.headersSent) res.status(500).json({ message: "Failed to generate Excel report" });
    } finally {
      taskTracker.decrement();
      taskTracker.endSession(_sid, "excel");
    }
  });

  // Update user profile name
  app.patch("/api/user/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { firstName, lastName } = (req.body ?? {}) as any;
      if (typeof firstName !== "string" || typeof lastName !== "string") {
        return res.status(400).json({ message: "firstName and lastName are required strings" });
      }
      const { authStorage } = await import("./replit_integrations/auth/storage");
      const user = await authStorage.upsertUser({ id: userId, firstName: firstName.trim(), lastName: lastName.trim() });
      res.json(user);
    } catch (error) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Upload user avatar
  app.post("/api/user/profile/avatar", isAuthenticated, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: req._rejectedMimetype ? `Invalid file type: ${req._rejectedMimetype}. Allowed: image/jpeg, image/png, image/webp.` : "No file provided" });
      const userId = resolveUserId(req as AuthenticatedRequest);
      const resizedBuffer = await sharp(req.file.buffer)
        .rotate()
        .resize(256, 256, { fit: "cover", position: "center" })
        .jpeg({ quality: 85 })
        .toBuffer();
      const filename = `avatar-${randomUUID()}.jpg`;
      const avatarKey = `/uploads/${filename}`;
      const objName = toAvatarObjectName(filename);
      const avatarLocalFallback = path.join(UPLOADS_DIR, filename);
      await putToObjectStorage(BUCKET_NAME, objName, resizedBuffer, "image/jpeg", avatarLocalFallback);
      const { authStorage } = await import("./replit_integrations/auth/storage");
      const user = await authStorage.updateUserAvatar(userId, avatarKey);
      res.json(user);
    } catch (error) {
      console.error("Avatar upload error:", error);
      res.status(500).json({ message: "Failed to upload avatar" });
    }
  });

  // Delete user avatar (revert to Replit avatar)
  app.delete("/api/user/profile/avatar", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { authStorage } = await import("./replit_integrations/auth/storage");
      const user = await authStorage.getUser(userId);
      if (user?.customAvatarKey) {
        const objName = toStorageObjectName(user.customAvatarKey);
        await objectStorageClient.bucket(BUCKET_NAME).file(objName).delete({ ignoreNotFound: true }).catch(() => {});
      }
      const updated = await authStorage.updateUserAvatar(userId, null);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to remove avatar" });
    }
  });

  app.post("/api/settings/logo", isAuthenticated, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: req._rejectedMimetype ? `Invalid file type: ${req._rejectedMimetype}. Allowed: image/jpeg, image/png, image/webp.` : "No file provided" });
      const userId = resolveUserId(req as AuthenticatedRequest);
      const existing = await storage.getUserSettings(userId);
      if (existing?.companyLogoKey) {
        const oldObj = toStorageObjectName(existing.companyLogoKey);
        await objectStorageClient.bucket(BUCKET_NAME).file(oldObj).delete({ ignoreNotFound: true }).catch(() => {});
        const oldFilename = existing.companyLogoKey.startsWith("/uploads/") ? existing.companyLogoKey.slice("/uploads/".length) : existing.companyLogoKey;
        await fs.unlink(path.join(UPLOADS_DIR, oldFilename)).catch(() => {});
      }
      const resizedBuffer = await sharp(req.file.buffer)
        .rotate()
        .resize(300, 80, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      const filename = `logo-${randomUUID()}.png`;
      const logoKey = `/uploads/${filename}`;
      const objName = toStorageObjectName(logoKey);
      const localFallback = path.join(UPLOADS_DIR, filename);
      await putToObjectStorage(BUCKET_NAME, objName, resizedBuffer, "image/png", localFallback);
      const result = await storage.upsertUserSettings(userId, { companyLogoKey: logoKey });
      res.json(result);
    } catch (error) {
      console.error("Logo upload error:", error);
      res.status(500).json({ message: "Failed to upload logo" });
    }
  });

  app.delete("/api/settings/logo", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const existing = await storage.getUserSettings(userId);
      if (existing?.companyLogoKey) {
        const objName = toStorageObjectName(existing.companyLogoKey);
        await objectStorageClient.bucket(BUCKET_NAME).file(objName).delete({ ignoreNotFound: true }).catch(() => {});
        const oldFilename = existing.companyLogoKey.startsWith("/uploads/") ? existing.companyLogoKey.slice("/uploads/".length) : existing.companyLogoKey;
        await fs.unlink(path.join(UPLOADS_DIR, oldFilename)).catch(() => {});
      }
      const result = await storage.upsertUserSettings(userId, { companyLogoKey: null });
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to remove logo" });
    }
  });

  app.get("/api/storage/usage", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const usage = await storage.getStorageUsageForUser(userId);
      res.json(usage);
    } catch (error) {
      console.error("Error getting storage usage:", error);
      res.status(500).json({ message: "Failed to get storage usage" });
    }
  });

  app.get("/api/storage/global-usage", isAuthenticated, async (req: any, res) => {
    try {
      if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const usage = await storage.getGlobalStorageUsage();
      res.json(usage);
    } catch (error) {
      console.error("Error getting global storage usage:", error);
      res.status(500).json({ message: "Failed to get global storage usage" });
    }
  });

  app.post("/api/storage/backfill-sizes", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { sessions: userSessions } = await storage.getUserSessions(userId);
      const userSessionIds = userSessions.map(s => s.id);
      if (userSessionIds.length === 0) {
        return res.json({ total: 0, updated: 0, failed: 0 });
      }
      const photosWithoutSize = await db.select({ id: photos.id, objectStorageKey: photos.objectStorageKey })
        .from(photos)
        .where(sql`${photos.fileSize} IS NULL AND ${photos.sessionId} IN (${sql.join(userSessionIds.map(id => sql`${id}`), sql`, `)})`);

      let updated = 0;
      let failed = 0;
      for (const photo of photosWithoutSize) {
        try {
          const objectName = toStorageObjectName(photo.objectStorageKey);
          const gcsFile = objectStorageClient.bucket(BUCKET_NAME).file(objectName);
          const [metadata] = await gcsFile.getMetadata();
          const size = parseInt(String(metadata.size || "0"), 10);
          if (size > 0) {
            await db.update(photos).set({ fileSize: size }).where(eq(photos.id, photo.id));
            updated++;
          }
        } catch {
          const localPath = path.join(UPLOADS_DIR, path.basename(photo.objectStorageKey));
          try {
            const stat = await fs.stat(localPath);
            await db.update(photos).set({ fileSize: Math.round(stat.size) }).where(eq(photos.id, photo.id));
            updated++;
          } catch {
            failed++;
          }
        }
      }
      res.json({ total: photosWithoutSize.length, updated, failed });
    } catch (error) {
      console.error("Error backfilling photo sizes:", error);
      res.status(500).json({ message: "Failed to backfill photo sizes" });
    }
  });

  // One-time cleanup: remove duplicate pins created by network-retry double-submission.
  // Keeps the lowest-id pin for each (photo_id, label) pair within sessions the
  // requesting user owns.  Safe to call multiple times (idempotent).
  app.post("/api/storage/dedupe-pins", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { sessions: userSessions } = await storage.getUserSessions(userId);
      const userSessionIds = userSessions.map(s => s.id);
      if (userSessionIds.length === 0) return res.json({ removed: 0 });

      // Find all (photo_id, label) pairs that have more than one pin, restricted to
      // photos that belong to the requesting user's sessions.
      const dupes = await db
        .select({
          photoId: pins.photoId,
          label: pins.label,
          minId: sql<number>`MIN(${pins.id})`,
        })
        .from(pins)
        .innerJoin(photos, eq(photos.id, pins.photoId))
        .where(
          sql`${photos.sessionId} IN (${sql.join(userSessionIds.map(id => sql`${id}`), sql`, `)})
              AND ${pins.label} IS NOT NULL`
        )
        .groupBy(pins.photoId, pins.label)
        .having(sql`COUNT(*) > 1`);

      let removed = 0;
      for (const dupe of dupes) {
        // Delete all pins with the same (photo_id, label) except the one with the lowest id.
        const result = await db
          .delete(pins)
          .where(
            sql`${pins.photoId} = ${dupe.photoId}
                AND ${pins.label} = ${dupe.label}
                AND ${pins.id} != ${dupe.minId}`
          );
        removed += (result as any).rowCount ?? 0;
      }

      res.json({ dupeGroups: dupes.length, removed });
    } catch (error) {
      console.error("Error deduplicating pins:", error);
      res.status(500).json({ message: "Failed to deduplicate pins" });
    }
  });

  // User Settings
  app.get("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const settings = await storage.getUserSettings(userId);
      const response = settings
        ? { ...settings, defaultExportFormat: settings.defaultExportFormat === "csv" ? "pdf" : settings.defaultExportFormat, testerPassword: settings.testerPassword ? "********" : null }
        : {
          userId,
          encodingEnabled: false,
          defaultExportFormat: "pdf",
          companyName: null,
          companyLogoKey: null,
          exportFooterText: null,
          photoQuality: 95,
          useReceivingQuality: true,
          receivingPhotoQuality: 40,
          useOnFloorQuality: true,
          onFloorPhotoQuality: 40,
          defaultAislePrefix: null,
          sectionAdvanceStep: 1,
          defaultUnit: "feet",
          defaultTheme: "system",
          thumbnailSize: "medium",
          largerTouchTargets: false,
          textSize: "default",
          customVendorCodes: [],
          testerPassword: null,
          helpGuideVersion: 0,
          helpGuideCompletedAt: null,
        };
      res.json(response);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      if ((req as AuthenticatedRequest).user?.isTester) {
        return res.status(403).json({ message: "Testers cannot modify settings" });
      }
      const userId = resolveUserId(req as AuthenticatedRequest);
      const allowedFields = [
        "defaultExportFormat", "companyName", "exportFooterText",
        "photoQuality", "useReceivingQuality", "receivingPhotoQuality",
        "useOnFloorQuality", "onFloorPhotoQuality",
        "defaultAislePrefix", "sectionAdvanceStep", "defaultUnit",
        "defaultTheme", "thumbnailSize", "largerTouchTargets", "textSize", "timezone",
        "customVendorCodes", "testerPassword",
        "helpGuideVersion", "helpGuideCompletedAt",
      ];
      const updates: Record<string, any> = {};
      const settingsBody = (req.body ?? {}) as any;
      for (const field of allowedFields) {
        if (settingsBody[field] !== undefined) {
          updates[field] = settingsBody[field];
        }
      }
      if (updates.testerPassword !== undefined) {
        if (updates.testerPassword && typeof updates.testerPassword === "string" && updates.testerPassword.trim()) {
          const plain = updates.testerPassword.trim();
          updates.testerPassword = await bcrypt.hash(plain, 10);
        } else {
          updates.testerPassword = null;
        }
      }
      if (updates.customVendorCodes) {
        if (!Array.isArray(updates.customVendorCodes)) {
          return res.status(400).json({ message: "customVendorCodes must be an array" });
        }
        const rawCodes = updates.customVendorCodes as unknown[];
        const incomingCodes = rawCodes
          .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
          .map((c) => c.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3))
          .filter((c) => c.length === 3);
        const existing = await storage.getUserSettings(userId);
        const existingCodes = existing?.customVendorCodes ?? [];
        updates.customVendorCodes = [...new Set([...existingCodes, ...incomingCodes])];
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      const result = await storage.upsertUserSettings(userId, updates);
      res.json(result);
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.get("/api/settings/encoding-status", isAuthenticated, (req: any, res) => {
    const userId = resolveUserId(req as AuthenticatedRequest);
    res.json({ inProgress: encodingToggleInProgress.has(userId) });
  });

  app.post("/api/settings/encoding", isAuthenticated, async (req: any, res) => {
    const userId = resolveUserId(req as AuthenticatedRequest);

    if (encodingToggleInProgress.has(userId)) {
      return res.status(409).json({
        success: false,
        error: "toggle_in_progress",
        message: "An encryption toggle is already in progress for your account. Please wait for it to complete.",
      });
    }

    encodingToggleInProgress.add(userId);
    try {
      const { enabled } = (req.body ?? {}) as any;

      const [lockKey1, lockKey2] = deriveAdvisoryLockKeys(userId);

      const encPrefixCondition = sql`(
        ${entries.reelTag}      LIKE 'enc:%' OR
        ${entries.wireType}     LIKE 'enc:%' OR
        ${entries.gauge}        LIKE 'enc:%' OR
        ${entries.color}        LIKE 'enc:%' OR
        ${entries.manufacturer} LIKE 'enc:%' OR
        ${entries.notes}        LIKE 'enc:%' OR
        ${entries.palletId}     LIKE 'enc:%' OR
        ${entries.position}     LIKE 'enc:%' OR
        ${entries.conductors}   LIKE 'enc:%'
      )`;

      // LENGTH > 0 guards against empty strings (encryptEntry skips them).
      const plainPresentCondition = sql`(
        (${entries.reelTag}      IS NOT NULL AND LENGTH(${entries.reelTag})      > 0 AND ${entries.reelTag}      NOT LIKE 'enc:%') OR
        (${entries.wireType}     IS NOT NULL AND LENGTH(${entries.wireType})     > 0 AND ${entries.wireType}     NOT LIKE 'enc:%') OR
        (${entries.gauge}        IS NOT NULL AND LENGTH(${entries.gauge})        > 0 AND ${entries.gauge}        NOT LIKE 'enc:%') OR
        (${entries.color}        IS NOT NULL AND LENGTH(${entries.color})        > 0 AND ${entries.color}        NOT LIKE 'enc:%') OR
        (${entries.manufacturer} IS NOT NULL AND LENGTH(${entries.manufacturer}) > 0 AND ${entries.manufacturer} NOT LIKE 'enc:%') OR
        (${entries.notes}        IS NOT NULL AND LENGTH(${entries.notes})        > 0 AND ${entries.notes}        NOT LIKE 'enc:%') OR
        (${entries.palletId}     IS NOT NULL AND LENGTH(${entries.palletId})     > 0 AND ${entries.palletId}     NOT LIKE 'enc:%') OR
        (${entries.position}     IS NOT NULL AND LENGTH(${entries.position})     > 0 AND ${entries.position}     NOT LIKE 'enc:%') OR
        (${entries.conductors}   IS NOT NULL AND LENGTH(${entries.conductors})   > 0 AND ${entries.conductors}   NOT LIKE 'enc:%')
      )`;

      let entriesProcessed = 0;

      if (enabled) {
        await db.transaction(async (tx) => {
          // Acquire cross-process advisory lock FIRST — all state reads and key decisions
          // happen after this point, preventing races across multiple app instances.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey1}, ${lockKey2})`);

          // Read settings and entry snapshot inside the lock.
          const lockedSettings = await tx
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1)
            .then(r => r[0] ?? null);
          const allEntries = await tx.select().from(entries).where(eq(entries.userId, userId));
          entriesProcessed = allEntries.length;

          // Decide which key to use — entirely inside the lock:
          // - If settings already show enabled+key: re-use that key (idempotent retry /
          //   "catch stragglers" call). encryptEntry skips already-encrypted fields.
          // - If settings show disabled but entries have enc: fields: a partial prior run
          //   left entries encrypted with an unknown key. Reject with MIXED_KEY_STATE.
          // - Otherwise (clean first-time enable): generate a fresh key.
          let salt: string;
          let dataKey: Buffer;
          let wrappedKey: string;

          const alreadyFullyEnabled =
            !!lockedSettings?.encodingEnabled &&
            !!lockedSettings.encryptionKey &&
            !!lockedSettings.encryptionSalt;

          if (alreadyFullyEnabled) {
            salt = lockedSettings!.encryptionSalt!;
            const kek = deriveKEK(salt);
            dataKey = unwrapKey(lockedSettings!.encryptionKey!, kek);
            wrappedKey = lockedSettings!.encryptionKey!;
          } else {
            // Check for enc: fields left by a partial prior run.
            const alreadyEncrypted = allEntries.filter(e =>
              [e.reelTag, e.wireType, e.gauge, e.color, e.manufacturer, e.notes, e.palletId, e.position, e.conductors]
                .some(v => typeof v === "string" && v.startsWith("enc:"))
            );
            if (alreadyEncrypted.length > 0) {
              const err = new Error("MIXED_KEY_STATE") as Error & { count: number };
              err.count = alreadyEncrypted.length;
              throw err;
            }
            salt = generateSalt();
            dataKey = generateDataKey();
            const kek = deriveKEK(salt);
            wrappedKey = wrapKey(dataKey, kek);
          }

          // Encrypt all entries in the same tx — fully atomic with verification below.
          for (const entry of allEntries) {
            const encrypted = encryptEntry({
              reelTag: entry.reelTag, wireType: entry.wireType, gauge: entry.gauge,
              color: entry.color, manufacturer: entry.manufacturer, notes: entry.notes,
              palletId: entry.palletId, position: entry.position, conductors: entry.conductors,
            }, dataKey);
            await tx.update(entries).set(encrypted).where(eq(entries.id, entry.id));
          }

          // Verification: no non-null non-empty encodable field may remain in plaintext.
          const unprotected = await tx
            .select({ id: entries.id })
            .from(entries)
            .where(sql`${entries.userId} = ${userId} AND ${plainPresentCondition}`);
          if (unprotected.length > 0) {
            const err = new Error("VERIFICATION_FAILED") as Error & { remaining: number };
            err.remaining = unprotected.length;
            throw err;
          }

          // Settings update atomically paired with the bulk encrypt.
          await tx.insert(userSettings)
            .values({ userId, encodingEnabled: true, encryptionKey: wrappedKey, encryptionSalt: salt })
            .onConflictDoUpdate({
              target: userSettings.userId,
              set: { encodingEnabled: true, encryptionKey: wrappedKey, encryptionSalt: salt, updatedAt: new Date() },
            });
        });

        res.json({ success: true, encodingEnabled: true, entriesEncoded: entriesProcessed });
      } else {
        await db.transaction(async (tx) => {
          // Acquire cross-process advisory lock FIRST.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey1}, ${lockKey2})`);

          // Read settings and entry snapshot inside the lock.
          const lockedSettings = await tx
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, userId))
            .limit(1)
            .then(r => r[0] ?? null);
          const allEntries = await tx.select().from(entries).where(eq(entries.userId, userId));
          entriesProcessed = allEntries.length;

          // Always check for enc: fields inside the lock — even if settings already say
          // disabled. This catches the mixed-state where a prior run encrypted entries
          // but failed to update settings.
          const encryptedRows = await tx
            .select({ id: entries.id })
            .from(entries)
            .where(sql`${entries.userId} = ${userId} AND ${encPrefixCondition}`);

          if (encryptedRows.length > 0) {
            if (!lockedSettings?.encodingEnabled || !lockedSettings.encryptionKey || !lockedSettings.encryptionSalt) {
              // Entries are encrypted but we have no key to decrypt them.
              const err = new Error("MIXED_KEY_STATE") as Error & { count: number };
              err.count = encryptedRows.length;
              throw err;
            }

            const kek = deriveKEK(lockedSettings.encryptionSalt);
            const dataKey = unwrapKey(lockedSettings.encryptionKey, kek);

            // Decrypt all entries in the same tx — fully atomic with verification below.
            // decryptEntry is idempotent: plaintext fields (no 'enc:' prefix) are left as-is.
            for (const entry of allEntries) {
              const decrypted = decryptEntry({
                reelTag: entry.reelTag, wireType: entry.wireType, gauge: entry.gauge,
                color: entry.color, manufacturer: entry.manufacturer, notes: entry.notes,
                palletId: entry.palletId, position: entry.position, conductors: entry.conductors,
              }, dataKey);
              await tx.update(entries).set(decrypted).where(eq(entries.id, entry.id));
            }

            // Verification: no enc:-prefixed values may remain.
            const stillEncrypted = await tx
              .select({ id: entries.id })
              .from(entries)
              .where(sql`${entries.userId} = ${userId} AND ${encPrefixCondition}`);
            if (stillEncrypted.length > 0) {
              const err = new Error("VERIFICATION_FAILED") as Error & { remaining: number };
              err.remaining = stillEncrypted.length;
              throw err;
            }
          }

          // Settings update atomically paired with the bulk decrypt.
          await tx.insert(userSettings)
            .values({ userId, encodingEnabled: false, encryptionKey: null, encryptionSalt: null })
            .onConflictDoUpdate({
              target: userSettings.userId,
              set: { encodingEnabled: false, encryptionKey: null, encryptionSalt: null, updatedAt: new Date() },
            });
        });

        res.json({ success: true, encodingEnabled: false, entriesDecoded: entriesProcessed });
      }
    } catch (error) {
      if (error instanceof Error && error.message === "MIXED_KEY_STATE") {
        const count = (error as Error & { count?: number }).count ?? 0;
        console.error(`[encoding toggle] mixed key state: ${count} entries already encrypted with a different key`);
        return res.status(409).json({
          success: false,
          error: "mixed_key_state",
          message: `${count} ${count === 1 ? "entry appears" : "entries appear"} to have been partially encrypted from a prior attempt. Please disable encryption first to clear the mixed state, then re-enable.`,
          encryptedCount: count,
        });
      }
      if (error instanceof Error && error.message === "VERIFICATION_FAILED") {
        const remaining = (error as Error & { remaining?: number }).remaining ?? 0;
        console.error(`[encoding toggle] verification failed: ${remaining} entries not fully converted`);
        return res.status(500).json({
          success: false,
          error: "verification_failed",
          message: `Encryption toggle failed: ${remaining} ${remaining === 1 ? "entry" : "entries"} could not be fully converted. No data was changed — please try again.`,
          remainingCount: remaining,
        });
      }
      console.error("Error toggling encoding:", error);
      res.status(500).json({ message: "Failed to toggle encoding" });
    } finally {
      encodingToggleInProgress.delete(userId);
    }
  });

  app.get("/api/external/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const session = access.session;
      const sessionEntries = await storage.getSessionEntries(session.id);
      const sessionPhotos = await storage.getSessionPhotos(session.id);
      const photoStats = await storage.getSessionPhotoStats([session.id]);
      const ps = photoStats.get(session.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
      res.json({
        session: { id: session.id, name: session.name, location: session.location, status: session.status, firstPhotoAt: ps.firstPhotoAt, lastPhotoAt: ps.lastPhotoAt },
        entries: sessionEntries.map(e => ({
          id: e.id, section: e.section, aisle: e.aisle, position: e.position, palletId: e.palletId,
          wireType: e.wireType, gauge: e.gauge, color: e.color, footage: e.footage,
          reelCount: e.reelCount || 1, conductors: e.conductors,
          reelTag: e.reelTag, manufacturer: e.manufacturer, notes: e.notes, createdAt: e.createdAt,
        })),
        photos: sessionPhotos.map(p => ({ id: p.id, section: p.section, aisle: p.aisle })),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch session data" });
    }
  });

  // Stats
  app.get("/api/stats", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const [stats, sharedPerformance, roleComparison] = await Promise.all([
        storage.getUserStats(userId),
        storage.getSharedSessionPerformance(userId),
        storage.getRoleComparisonStats(userId),
      ]);

      const userSessions = await db.select({ id: countingSessions.id })
        .from(countingSessions)
        .where(eq(countingSessions.userId, userId));
      const sessionIds = userSessions.map(s => s.id);

      const enhancedStats = await storage.getEnhancedStats(userId, sessionIds);

      res.json({ ...stats, sharedPerformance, roleComparison, currentUserId: userId, ...enhancedStats });
    } catch (error) {
      res.status(500).json({ message: "Failed to get stats" });
    }
  });

  // Activity logs
  app.get("/api/sessions/:id/activity", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const filterUserId = typeof req.query.userId === "string" ? req.query.userId : undefined;
      const { logs, total } = await storage.getSessionActivityLogs(sessionId, limit, offset, filterUserId);
      res.json({ logs, total, limit, offset });
    } catch (error) {
      res.status(500).json({ message: "Failed to get activity logs" });
    }
  });

  app.get("/api/sessions/:id/activity-users", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const users = await storage.getSessionActivityUsers(sessionId);
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Failed to get activity users" });
    }
  });

  // Comments
  app.get("/api/sessions/:id/comments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const allComments = await storage.getSessionComments(sessionId);
      res.json(allComments);
    } catch (error) {
      res.status(500).json({ message: "Failed to get comments" });
    }
  });

  const createCommentBody = z.object({
    text: z.string().trim().min(1, "Comment text required"),
    entryId: z.number().int().positive().optional().nullable(),
    photoId: z.number().int().positive().optional().nullable(),
    parentCommentId: z.number().int().positive().optional().nullable(),
  });

  app.post("/api/sessions/:id/comments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "View-only access" });
      const commentParse = createCommentBody.safeParse(req.body ?? {});
      if (!commentParse.success) return res.status(400).json({ message: "Invalid request body", errors: commentParse.error.flatten().fieldErrors });
      const { text, entryId, photoId, parentCommentId } = commentParse.data;
      const username = (req as AuthenticatedRequest).user.claims.first_name || (req as AuthenticatedRequest).user.claims.email || userId;
      const comment = await storage.createComment({
        sessionId, userId, username,
        text: text.trim(),
        entryId: entryId || null,
        photoId: photoId || null,
        parentCommentId: parentCommentId || null,
      });
      await logActivity(sessionId, userId, username, "comment_added", "comment", comment.id, text.trim().substring(0, 100));
      broadcastToSession(sessionId, { type: "comment", action: "created", comment });
      res.status(201).json(comment);
    } catch (error) {
      res.status(500).json({ message: "Failed to create comment" });
    }
  });

  app.patch("/api/comments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const commentId = parseInt(req.params.id);
      const comment = await storage.getComment(commentId);
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      if (comment.userId !== userId) return res.status(403).json({ message: "Not authorized" });
      const { text } = (req.body ?? {}) as any;
      if (!text || !text.trim()) return res.status(400).json({ message: "Comment text required" });
      const updated = await storage.updateComment(commentId, { text: text.trim() });
      broadcastToSession(comment.sessionId, { type: "comment", action: "updated", comment: updated });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update comment" });
    }
  });

  app.delete("/api/comments/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const commentId = parseInt(req.params.id);
      const comment = await storage.getComment(commentId);
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      const access = await verifySessionAccess(comment.sessionId, userId, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (comment.userId !== userId && !isOwner(access.role)) return res.status(403).json({ message: "Not authorized" });
      await storage.deleteComment(commentId);
      broadcastToSession(comment.sessionId, { type: "comment", action: "deleted", commentId });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete comment" });
    }
  });

  app.get("/api/sessions/:id/online", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, (req as AuthenticatedRequest).user.claims.sub, getTesterOwner(req as AuthenticatedRequest));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const users = getOnlineUsers(sessionId);
      res.json(users);
    } catch {
      res.json([]);
    }
  });

  // Feedback
  app.get("/api/wire-catalogs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const catalogs = await storage.getUserWireCatalogs(userId);
      res.json(catalogs);
    } catch (error) {
      console.error("Error fetching wire catalogs:", error);
      res.status(500).json({ message: "Failed to fetch wire catalogs" });
    }
  });

  app.post("/api/wire-catalogs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const parsed = insertUserWireCatalogSchema.safeParse({ ...req.body, userId });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid wire catalog data", details: parsed.error.flatten() });
      }
      const entry = await storage.createUserWireCatalog(parsed.data);
      res.status(201).json(entry);
    } catch (error) {
      console.error("Error creating wire catalog:", error);
      res.status(500).json({ message: "Failed to create wire catalog" });
    }
  });

  app.post("/api/wire-catalogs/bulk", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req as AuthenticatedRequest);
      const { catalogs } = (req.body ?? {}) as any;
      if (!Array.isArray(catalogs) || catalogs.length === 0) {
        return res.status(400).json({ error: "catalogs must be a non-empty array" });
      }
      if (catalogs.length > 500) {
        return res.status(400).json({ error: "Maximum 500 catalogs per import" });
      }
      const validated: any[] = [];
      const errors: { index: number; errors: any }[] = [];
      for (let i = 0; i < catalogs.length; i++) {
        const parsed = insertUserWireCatalogSchema.safeParse({ ...catalogs[i], userId });
        if (parsed.success) {
          validated.push(parsed.data);
        } else {
          errors.push({ index: i, errors: parsed.error.flatten() });
        }
      }
      if (errors.length > 0) {
        return res.status(400).json({ error: "Some catalogs failed validation", errors, validCount: validated.length });
      }
      const results = await storage.createUserWireCatalogsBulk(validated);
      res.status(201).json(results);
    } catch (error) {
      console.error("Error bulk creating wire catalogs:", error);
      res.status(500).json({ message: "Failed to bulk import wire catalogs" });
    }
  });

  app.delete("/api/wire-catalogs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const userId = resolveUserId(req as AuthenticatedRequest);
      await storage.deleteUserWireCatalog(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting wire catalog:", error);
      res.status(500).json({ message: "Failed to delete wire catalog" });
    }
  });

  app.post("/api/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = insertFeedbackSchema.safeParse({ ...req.body, userId: (req as AuthenticatedRequest).user.claims.sub });
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid feedback data", details: parsed.error.flatten() });
      }
      const row = await storage.createFeedback(parsed.data);
      return res.status(201).json(row);
    } catch (error) {
      console.error("Error creating feedback:", error);
      return res.status(500).json({ error: "Failed to submit feedback" });
    }
  });

  app.get("/api/feedback", isAuthenticated, ownerOnly, async (_req: any, res) => {
    try {
      const rows = await storage.listFeedback();
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      return res.json(rows
        .filter((row) => new Date(row.createdAt).getTime() >= cutoff)
        .slice(0, 100)
        .map(({ userId: _userId, ...row }) => row));
    } catch (error) {
      console.error("Error listing feedback:", error);
      return res.status(500).json({ error: "Failed to list feedback" });
    }
  });

  app.get("/api/admin/feedback", isAuthenticated, async (_req: any, res) => {
    try {
      const rows = await storage.listFeedback();
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      return res.json(rows
        .filter((row) => new Date(row.createdAt).getTime() >= cutoff)
        .slice(0, 100)
        .map(({ userId: _userId, ...row }) => row));
    } catch (error) {
      console.error("Error listing admin feedback:", error);
      return res.status(500).json({ error: "Failed to list feedback" });
    }
  });

  const HELP_SYSTEM_PROMPT = `You are a helpful assistant for "Master Reel Counter," a warehouse wire reel counting application. Answer questions clearly and concisely based on the following app knowledge. If you don't know, say so honestly.

## App Overview
Master Reel Counter helps users photograph pallet sections in warehouses, annotate reels with pins, enter wire catalog details (catalog, vendor code, footage), and export professional inventory reports (CSV, PDF, email).

## Dashboard
- **Sessions**: Create, rename, duplicate, lock/unlock, mark complete/reopen, delete sessions. Each card shows name, location, reel count, total footage, photo count, and thumbnail.
- **Folders**: Organize sessions into folders. Folders can be nested. Deleting a folder moves sessions back to root (sessions are never deleted).
- **Sorting & Search**: Sort by date, name, reels, or footage. Search filters by name or location across owned and shared sessions.
- **Shared Sessions**: Sessions shared by others appear in a separate section showing owner name and your role (Editor or Viewer).
- **Header Bar**: Theme toggle (dark/light), Help, Summary Stats page (key metrics, role-based comparison charts with bar and pie graphs), Settings (profile avatar, display name, encryption keys, preferences), Sign Out.

## Session — Full Mode (Desktop)
- **Session Header**: Back arrow, editable name/location/description, lock/unlock, undo/redo, online user avatars, Team button (invite by username/link/email, set roles), Activity Log, Export, dark/light toggle, auto-save indicator.
- **Section Photo Tab**: Upload/capture photos tagged with aisle & section. Navigate photos with prev/next or type a number. "Next Reel" button jumps to photos with incomplete pins. Zoom (up to 5x), pan, reset, pin placement mode.
- **Pins**: Click photo in pin mode to place numbered pins. Drag to reposition. Delete with × button. Committed pins show "P" prefix. Draft pins auto-save.
- **Reel Crop Preview**: Tap a pin to see zoomed crop. Image on the left with vertical button column on the right (Close-up, Wide, Zoom +/-, Rotate, Close). Toggle close-up vs wide view.
- **Entry Details Table**: Catalog input searches ~300 catalog entries (arrow keys + Enter to select, auto-fills vendor & footage). Vendor code dropdown (COP, ALU, COR, ALF). Footage field. Clear row, flag for re-shoot (with optional reason), commit pins as entries.
- **Photo Notes & Detail Shots**: Add notes to photos (auto-save). Mark as detail/close-up shot linked to parent photo.
- **Nearby Photo Strip**: Horizontal strip of photos sorted by location. Orange badge shows incomplete pin count.
- **Quick Entry Panel**: Create entries without pins. Auto-fills aisle/section from current photo. Catalog autocomplete. "On Floor / In Front Of" checkbox. Receiving mode auto-increments sections.
- **Flagged Tab**: Shows all flagged reels with reason. Photo preview with orange pulsing ring. Re-shoot captures detail shot. Edit inline (wire details, notes, flag reason). Un-flag to remove. Shareable link. Duplicate detection highlights entries with matching details — dismiss false positives (persisted across browsers/devices). "Entries Without Photos" issues section.
- **Photos Reel Tab**: Visual grid of all photos grouped by aisle/section. Sequence badge, duplicate, delete, jump-to-photo buttons. Back to Top button.
- **AI Scanner Tab**: AI vision reads wire reel labels from photo crops. Select photos, preview crops, batch analyze (up to 20 per request), review raw text + matched catalog results, apply to entries. All Photos mode vs Single Photo mode. Receiving pooling for batch efficiency. Real-time sync via WebSocket.
- **Table View**: All committed entries grouped by aisle/section. Clickable pin # jumps to photo. Collapsible sections. Photo viewer with pin highlight. Edit/delete entries. Validation warnings for missing data. Total footage footer.
- **Activity Log**: Timestamped feed of all session changes with user filter dropdown and close button. Tracks entries created/edited/deleted, photos uploaded/deleted/duplicated, pins flagged/unflagged/deleted, collaborators added/removed/role changes, invite links, exports, session lock/unlock.
- **Collaboration**: Invite by username, share link (7-day auto-expiry with join count tracking), or email. Editor/Viewer roles. Testers get Editor access (not Owner). Real-time presence with green dots. Session locking freezes all edits.
- **Export**: CSV (spreadsheet), Excel (.xlsx with formatted metadata, grouped entries, indented pins, centered columns), PDF (full quality or standard, parallel generation), email sharing.

## Session — Mobile Flow
- **Capturing**: Set aisle & section (aisle required), section stepper +/- buttons, take photo or upload from gallery, Receiving checkbox auto-increments sections.
- **Upload Queue & Offline**: Background upload with counter. Failed uploads show retry/dismiss. Offline mode saves to IndexedDB, auto-syncs on reconnect.
- **Photo Review**: Navigate with prev/next. Sort by aisle or latest. Add notes, mark as detail shot, delete photos. Location labels shown.

## Tips
- Type a few letters of wire catalog + arrow down + Enter for rapid data entry.
- Use "Next Reel" button to jump through incomplete photos.
- Type "rec" in aisle to auto-fill "Receiving".
- Flag reels you can't read and share the Flagged tab link with someone who can re-photograph.
- All entry creates/edits/deletes can be undone with undo/redo.
- Mobile: Set aisle, rapidly tap "Take Photo" — uploads happen in background.
- Mobile is for capturing; switch to Full Mode on desktop for detailed work.`;

  app.post(
    "/api/help-chat",
    isAuthenticated,
    helpChatRateLimiter,
    createHelpChatHandler(getPoeProvider(), HELP_SYSTEM_PROMPT),
  );

  // WebSocket
  const wss = new WebSocketServer({ noServer: true });
  attachWebSocketServerAtPath(httpServer, wss, "/ws");

  const wsAlive = new WeakMap<WebSocket, boolean>();

  const cleanupWs = (ws: WebSocket) => {
    const info = wsUserMap.get(ws);
    if (info?.sessionId !== null && info?.sessionId !== undefined) {
      const room = sessionRooms.get(info.sessionId);
      if (room) { room.delete(ws); if (room.size === 0) sessionRooms.delete(info.sessionId); }
      broadcastPresence(info.sessionId);
    }
    wsUserMap.delete(ws);
    wsAlive.delete(ws);
  };

  const processWsMessage = async (ws: WebSocket, raw: Buffer | string) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (msg.type === "join" && typeof msg.sessionId === "number") {
        const info = wsUserMap.get(ws)!;
        if (!info.userId) {
          ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
          ws.close(1008, "Authentication required");
          return;
        }
        const access = await realtimeAuthorization.authorizeConsistently(
          msg.sessionId,
          () => verifySessionAccess(msg.sessionId, info.userId!, info.testerOwnerUserId ?? undefined),
        );
        if (!access) {
          ws.send(JSON.stringify({
            type: "authorization_changed",
            outcome: "denied_join",
            message: "You are not authorized to join this session.",
          }));
          ws.close(1008, "Session access denied");
          return;
        }
        const prevSessionId = info.sessionId;
        if (prevSessionId !== null) {
          const prev = sessionRooms.get(prevSessionId);
          if (prev) { prev.delete(ws); if (prev.size === 0) sessionRooms.delete(prevSessionId); }
          broadcastPresence(prevSessionId);
        }
        info.sessionId = msg.sessionId;
        info.role = access.role;
        if (!sessionRooms.has(msg.sessionId)) sessionRooms.set(msg.sessionId, new Set());
        sessionRooms.get(msg.sessionId)!.add(ws);
        ws.send(JSON.stringify({ type: "joined", sessionId: msg.sessionId }));
        broadcastPresence(msg.sessionId);
      }
    } catch (err) {
      console.error("processWsMessage error:", err);
      try { ws.send(JSON.stringify({ type: "error", message: "Internal error" })); } catch {}
    }
  };

  wss.on("connection", (ws, req: any) => {
    wsUserMap.set(ws, { sessionId: null, userId: null, username: null, role: null, testerOwnerUserId: null });
    wsAlive.set(ws, true);

    let authDone = false;
    const pendingMessages: (Buffer | string)[] = [];
    let revalidateTimer: ReturnType<typeof setInterval> | null = null;

    const loadSocketIdentity = async () => {
      await new Promise<void>((resolve, reject) =>
        sessionParser(req, {} as any, (error?: unknown) => error ? reject(error) : resolve()),
      );
      return authenticateWebSocketRequest(req);
    };

    loadSocketIdentity().then(async (user) => {
      const outcome = await getIdentityAuthorizationOutcome(user);
      if (!user || outcome !== "approved") {
        ws.send(JSON.stringify({
          type: "authorization_changed",
          outcome,
          message: outcome === "rejected"
            ? "Your account access was rejected."
            : outcome === "identity_changed"
              ? "Your signed-in identity changed."
              : "Your account is waiting for approval.",
        }));
        ws.close(1008, "Authorization required");
        return;
      }
      const connUserId = user.claims.sub;
      const connTesterOwnerUserId = user.isTester ? (user.claims.testerOwnerUserId ?? null) : null;
      const connUsername = user.claims.username || user.claims.firstName || connUserId;
      wsUserMap.set(ws, { sessionId: null, userId: connUserId, username: connUsername, role: null, testerOwnerUserId: connTesterOwnerUserId });
      authDone = true;
      for (const buffered of pendingMessages) processWsMessage(ws, buffered);
      pendingMessages.length = 0;

      // Re-read Clerk/tester cookies; never trust the identity captured at
      // upgrade time after a long-lived socket has been established.
      const WS_REVALIDATE_MS = 10 * 60 * 1000;
      revalidateTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          if (revalidateTimer) { clearInterval(revalidateTimer); revalidateTimer = null; }
          return;
        }
        loadSocketIdentity().then(async (freshUser) => {
          const freshOutcome = await getIdentityAuthorizationOutcome(freshUser);
          if (
            freshOutcome !== "approved" ||
            !(await isWebSocketIdentityAuthorized(freshUser, user))
          ) {
            try {
              ws.send(JSON.stringify({
                type: "authorization_changed",
                outcome: freshOutcome,
                message: freshOutcome === "identity_changed"
                  ? "Your signed-in identity changed."
                  : "Your realtime access changed.",
              }));
            } catch {}
            ws.close(1008, "Authorization changed");
            if (revalidateTimer) { clearInterval(revalidateTimer); revalidateTimer = null; }
          }
        }).catch(() => {
          ws.close(1008, "Session expired");
          if (revalidateTimer) { clearInterval(revalidateTimer); revalidateTimer = null; }
        });
      }, WS_REVALIDATE_MS);
    }).catch(() => {
      ws.close(1008, "Authentication required");
    });

    ws.on("pong", () => { wsAlive.set(ws, true); });
    ws.on("error", () => {
      try { ws.terminate(); } catch {}
      cleanupWs(ws);
    });

    ws.on("message", (raw) => {
      if (!authDone) {
        pendingMessages.push(raw as Buffer | string);
      } else {
        processWsMessage(ws, raw as Buffer | string);
      }
    });

    ws.on("close", () => {
      if (revalidateTimer) { clearInterval(revalidateTimer); revalidateTimer = null; }
      cleanupWs(ws);
    });
  });

  const WS_HEARTBEAT_INTERVAL_MS = 20_000;
  const wsHeartbeat = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      if (wsAlive.get(ws) === false) {
        try { ws.terminate(); } catch {}
        cleanupWs(ws);
        return;
      }
      wsAlive.set(ws, false);
      try { ws.ping(); } catch {
        try { ws.terminate(); } catch {}
        cleanupWs(ws);
      }
    });
  }, WS_HEARTBEAT_INTERVAL_MS);
  wsHeartbeat.unref();
  wss.on("close", () => { clearInterval(wsHeartbeat); });

  // Defensive ghost-entry pruner: walks sessionRooms and wsUserMap every
  // 5 minutes and removes any socket whose readyState is CLOSED or CLOSING.
  // The heartbeat already terminates dead connections, but this acts as a
  // safety net in case a socket slips through (e.g. terminated before pong
  // could be registered) and leaves an orphaned entry in either map.
  const WS_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
  const wsGhostPruner = setInterval(() => {
    // Prune sessionRooms — remove dead sockets from each room set.
    for (const [roomSessionId, room] of sessionRooms) {
      for (const ws of room) {
        if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          room.delete(ws);
          wsUserMap.delete(ws);
        }
      }
      if (room.size === 0) sessionRooms.delete(roomSessionId);
    }
    // Prune wsUserMap — remove any dead socket not already caught above.
    for (const [ws] of wsUserMap) {
      if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        wsUserMap.delete(ws);
      }
    }
  }, WS_PRUNE_INTERVAL_MS);
  wsGhostPruner.unref();
  wss.on("close", () => { clearInterval(wsGhostPruner); });

  const TRASH_PURGE_INTERVAL_MS = 60 * 60 * 1000;
  const TRASH_MAX_AGE_DAYS = 30;
  // Configurable via env; defaults to 24 hours. Increase for slower networks
  // or longer retry windows; decrease in test environments.
  const ORPHAN_INTENT_MAX_AGE_MS = parseInt(process.env.ORPHAN_INTENT_MAX_AGE_MS ?? "") || 24 * 60 * 60 * 1000;

  async function purgeOrphanedUploads() {
    try {
      const expired = await storage.getExpiredUploadIntents(ORPHAN_INTENT_MAX_AGE_MS);
      if (expired.length === 0) return;
      const purged: number[] = [];
      for (const intent of expired) {
        const key = intent.objectPath;
        const filename = key.startsWith("/uploads/") ? key.slice("/uploads/".length) : key.replace(/^\/objects\/uploads\//, "");
        let gcsOk = false;
        try {
          await objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(key)).delete({ ignoreNotFound: true });
          gcsOk = true;
        } catch (err) {
          console.warn(`Orphan purge: GCS delete failed for ${key} — will retry next cycle:`, (err as Error).message);
        }
        if (!gcsOk) continue; // leave intent row so next run retries
        // Local-disk fallback cleanup is best-effort: missing files are fine.
        await fs.unlink(path.join(UPLOADS_DIR, filename)).catch(() => {});
        purged.push(intent.id);
      }
      if (purged.length > 0) {
        await storage.deleteUploadIntents(purged);
        console.log(`Orphan upload purge: removed ${purged.length} stranded file(s)`);
      }
    } catch (err) {
      console.error("Orphan upload purge error:", err);
    }
  }

  async function purgeExpiredTrash() {
    try {
      const expiredSessions = await storage.getExpiredTrashSessions(TRASH_MAX_AGE_DAYS);
      for (const session of expiredSessions) {
        try {
          const sessionPhotos = await storage.getSessionPhotos(session.id);
          for (const photo of sessionPhotos) {
            try {
              const shared = await storage.isObjectKeyShared(photo.objectStorageKey, photo.id);
              if (!shared) {
                const key = photo.objectStorageKey;
                const filename = key.startsWith("/uploads/") ? key.slice("/uploads/".length) : key.replace(/^\/objects\/uploads\//, "");
                const filePath = path.join(UPLOADS_DIR, filename);
                await objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(key)).delete({ ignoreNotFound: true }).catch(() => {});
                await fs.unlink(filePath).catch(() => {});
              }
            } catch (err) {
              console.warn("Could not delete photo file during trash purge:", err);
            }
          }
          await storage.deleteSession(session.id);
          evictAllSessionSockets(session.id, "Session deleted");
          console.log(`Purged expired trashed session ${session.id} (${session.name})`);
        } catch (err) {
          console.error(`Failed to purge trashed session ${session.id}:`, err);
        }
      }
      if (expiredSessions.length > 0) {
        console.log(`Trash purge complete: ${expiredSessions.length} session(s) permanently deleted`);
      }

      // Auto-purge folders that have been in trash longer than TRASH_MAX_AGE_DAYS.
      // Sessions were already unlinked during soft-delete; no file cleanup needed.
      try {
        const expiredFolders = await storage.getExpiredTrashFolders(TRASH_MAX_AGE_DAYS);
        for (const folder of expiredFolders) {
          try {
            await storage.permanentDeleteFolder(folder.id);
            console.log(`Purged expired trashed folder ${folder.id} (${folder.name})`);
          } catch (err) {
            console.error(`Failed to purge trashed folder ${folder.id}:`, err);
          }
        }
        if (expiredFolders.length > 0) {
          console.log(`Folder purge complete: ${expiredFolders.length} folder(s) permanently deleted`);
        }
      } catch (err) {
        console.error("Folder trash purge error:", err);
      }

      // Also sweep orphaned uploads on every trash-purge cycle.
      await purgeOrphanedUploads();
    } catch (err) {
      console.error("Trash purge error:", err);
    }
  }

  // Admin endpoint: manually trigger orphan upload cleanup.
  app.post("/api/admin/purge-orphaned-uploads", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Admin only" });
    }
    try {
      await purgeOrphanedUploads();
      res.json({ message: "Orphan upload purge triggered" });
    } catch (err) {
      res.status(500).json({ message: "Purge failed" });
    }
  });

  // Admin endpoint: one-time sweep for legacy orphaned files that predate the
  // upload_intents table and will never be caught by the normal purge job.
  // Cross-references every /uploads/* GCS key against all DB-referenced keys
  // (photos, company logos, user avatars). Files older than `minAgeDays` (default 7)
  // with no DB reference are deleted.
  //
  // Pagination: each call processes up to 500 GCS objects. If there are more,
  // the response includes `nextPageToken`. Pass it in the request body as
  // `{ pageToken: "..." }` to continue from where the previous call left off.
  // Keep calling until `nextPageToken` is null.
  app.post("/api/admin/sweep-legacy-orphans", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const SWEEP_MAX_FILES = 500;
    const minAgeDays = Math.min(365, Math.max(1, parseInt(req.body?.minAgeDays ?? (req.query as any).minAgeDays) || 7));
    const cutoff = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000);
    const pageToken: string | undefined = req.body?.pageToken || undefined;

    // Normalize any key to canonical "/uploads/<filename>" form so that legacy
    // "/objects/uploads/<filename>" DB values match the GCS-derived key.
    const normalizeKey = (key: string) =>
      key.startsWith("/objects/uploads/") ? key.slice("/objects".length) : key;

    try {
      // Build set of all DB-referenced storage keys (photos + logos, already normalized)
      const knownKeys = await storage.getAllKnownStorageKeys();
      // Augment with user avatar keys (stored in the auth users table)
      const allUsers = await authStorage.getAllUsers();
      for (const u of allUsers) {
        if (u.customAvatarKey) knownKeys.add(normalizeKey(u.customAvatarKey));
      }

      // Compute the GCS prefix for the uploads directory
      const dirPart = privateDir.replace(/^\/[^/]+\/?/, "");
      const uploadsPrefix = dirPart ? `${dirPart}/uploads/` : "uploads/";

      // Paginated GCS listing — exactly SWEEP_MAX_FILES objects per call.
      // nextQuery contains the pageToken for the following page (if any).
      const [files, nextQuery] = await objectStorageClient.bucket(BUCKET_NAME).getFiles({
        prefix: uploadsPrefix,
        maxResults: SWEEP_MAX_FILES,
        pageToken,
      });
      const nextPageToken: string | null = (nextQuery as any)?.pageToken ?? null;

      let scanned = 0;
      let deleted = 0;
      let skipped = 0;
      let errors = 0;

      for (const file of files) {
        scanned++;

        // Skip files newer than the age threshold
        const created = new Date((file.metadata as any).timeCreated as string);
        if (created > cutoff) { skipped++; continue; }

        // Convert GCS name → canonical DB key
        // e.g. "mydir/uploads/foo.jpg" → "/uploads/foo.jpg"
        const rawKey = "/" + file.name.slice(dirPart ? dirPart.length + 1 : 0);
        const dbKey = normalizeKey(rawKey);

        if (knownKeys.has(dbKey)) { skipped++; continue; }

        // Orphaned — delete from GCS and attempt local disk cleanup
        try {
          await file.delete({ ignoreNotFound: true });
          const filename = file.name.slice(uploadsPrefix.length);
          await fs.unlink(path.join(UPLOADS_DIR, filename)).catch(() => {});
          deleted++;
          console.log(`Legacy orphan sweep: deleted ${dbKey}`);
        } catch (err) {
          errors++;
          console.warn(`Legacy orphan sweep: failed to delete ${dbKey}:`, (err as Error).message);
        }
      }

      res.json({ scanned, deleted, skipped, errors, nextPageToken, minAgeDays });
    } catch (err) {
      console.error("Legacy orphan sweep error:", err);
      res.status(500).json({ message: "Sweep failed" });
    }
  });

  // Admin endpoint: scan photo DB rows for orphans where the object-storage
  // file no longer exists.  This catches rows left behind by old deletions that
  // removed the file first and then failed during the DB cascade.
  //
  // Query params:
  //   limit  – how many photo rows to check per call (default 100, max 500)
  //   offset – starting row for pagination (default 0)
  //
  // Response:
  //   { scanned, orphans: [{ id, objectStorageKey, sessionId, createdAt }],
  //     total, nextOffset }
  //
  // Call repeatedly, advancing `offset` by `limit` each time, until
  // `nextOffset` >= `total` (or `scanned` < `limit`).
  app.get("/api/admin/orphaned-photo-rows", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const MAX_LIMIT = 500;
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt((req.query as any).limit) || 100));
    const offset = Math.max(0, parseInt((req.query as any).offset) || 0);

    // Normalize legacy "/objects/uploads/<file>" keys → "/uploads/<file>"
    // so that toStorageObjectName produces the correct GCS path regardless
    // of which format was stored when the photo was originally uploaded.
    const normalizeKey = (key: string) =>
      key.startsWith("/objects/uploads/") ? key.slice("/objects".length) : key;

    try {
      const { photos: batch, total } = await storage.getAllPhotosPaginated(limit, offset);

      // Check each photo's storage key for existence, up to CONCURRENCY at a time.
      const CONCURRENCY = 10;
      const orphans: Array<{ id: number; objectStorageKey: string; sessionId: number; createdAt: Date | null }> = [];
      let storageCheckErrors = 0;

      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (photo) => {
          const objectName = toStorageObjectName(normalizeKey(photo.objectStorageKey));
          try {
            const [exists] = await objectStorageClient.bucket(BUCKET_NAME).file(objectName).exists();
            if (!exists) {
              orphans.push({
                id: photo.id,
                objectStorageKey: photo.objectStorageKey,
                sessionId: photo.sessionId,
                createdAt: photo.createdAt,
              });
            }
          } catch {
            // If we can't reach storage for this file, skip it rather than
            // falsely flagging it as an orphan; surface count to the caller
            // so they know results may be partial.
            storageCheckErrors++;
          }
        }));
      }

      const nextOffset = offset + batch.length;
      res.json({
        scanned: batch.length,
        orphans,
        storageCheckErrors,
        total,
        nextOffset: nextOffset < total ? nextOffset : null,
      });
    } catch (err) {
      console.error("Orphaned photo row scan error:", err);
      res.status(500).json({ message: "Scan failed" });
    }
  });

  // Admin endpoint: delete specific photo rows whose object-storage files are
  // confirmed missing.  Accepts { photoIds: number[] } and runs the normal
  // deletePhoto cascade for each, leaving no dangling entry/pin references.
  //
  // The caller is responsible for confirming the IDs are genuinely orphaned
  // (e.g. via the GET endpoint above) before sending this request.
  app.delete("/api/admin/orphaned-photo-rows", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Admin only" });
    }

    const body = req.body ?? {};
    if (!Array.isArray(body.photoIds) || body.photoIds.length === 0) {
      return res.status(400).json({ message: "photoIds must be a non-empty array" });
    }
    // Cap to avoid accidentally nuking huge sets in one call.
    const MAX_BATCH = 200;
    if (body.photoIds.length > MAX_BATCH) {
      return res.status(400).json({ message: `photoIds must contain at most ${MAX_BATCH} entries per request` });
    }
    const photoIds: number[] = body.photoIds.filter((id: unknown) => typeof id === "number" && Number.isInteger(id) && id > 0);
    if (photoIds.length === 0) {
      return res.status(400).json({ message: "photoIds must be positive integers" });
    }

    // Normalize legacy "/objects/uploads/<file>" keys → "/uploads/<file>"
    // so toStorageObjectName derives the correct GCS path.
    const normalizeKey = (key: string) =>
      key.startsWith("/objects/uploads/") ? key.slice("/objects".length) : key;

    let deleted = 0;
    let notFound = 0;
    let errors = 0;

    for (const photoId of photoIds) {
      const photo = await storage.getPhoto(photoId).catch(() => undefined);
      if (!photo) { notFound++; continue; }

      // Double-check the storage object is still missing before removing the row.
      try {
        const objectName = toStorageObjectName(normalizeKey(photo.objectStorageKey));
        const [exists] = await objectStorageClient.bucket(BUCKET_NAME).file(objectName).exists();
        if (exists) {
          // File was restored or this photo is not actually orphaned; skip it.
          errors++;
          console.warn(`orphaned-photo-rows DELETE: photo ${photoId} has a live storage object — skipping`);
          continue;
        }
      } catch {
        // Storage unreachable; skip rather than delete a potentially valid row.
        errors++;
        continue;
      }

      try {
        await storage.deletePhoto(photoId);
        deleted++;
        console.log(`orphaned-photo-rows DELETE: removed stale photo row ${photoId} (key: ${photo.objectStorageKey})`);
      } catch (err) {
        errors++;
        console.warn(`orphaned-photo-rows DELETE: failed to delete photo row ${photoId}:`, (err as Error).message);
      }
    }

    res.json({ deleted, notFound, errors });
  });

  // Admin endpoint: returns the full crash history (up to 10 records) including
  // stack traces and error messages. The public /api/health endpoint only surfaces
  // a redacted summary of the most recent crash; this endpoint gives operators
  // the complete picture for post-incident analysis.
  app.get("/api/admin/crashes", isAuthenticated, (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Admin only" });
    }
    const history = taskTracker.crashHistory();
    const buckets = getPinRetryBuckets();
    res.json({
      count: history.length,
      crashes: history,
      pinRetryStats: {
        commitRetries: pinRetryStats.commitRetries,
        draftRetries: pinRetryStats.draftRetries,
        total: pinRetryStats.commitRetries + pinRetryStats.draftRetries,
        since: pinRetryStats.since,
        // Per-minute buckets (up to 60 = 1 hour), newest last.
        // Allows the UI to render a contention trend table/chart.
        buckets: buckets.map(b => ({
          minute: b.minute,
          commitRetries: b.commitRetries,
          draftRetries: b.draftRetries,
          total: b.commitRetries + b.draftRetries,
        })),
      },
    });
  });

  // Admin endpoint: force-clear stalled upload intents (older than 1 hour) for a
  // specific user. Allows admins to clean up per-user stalls directly from the
  // Settings storage dashboard without waiting for the hourly purge job.
  app.delete("/api/admin/stalled-intents/:userId", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { userId } = req.params;
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ message: "userId required" });
    }
    try {
      const cleared = await storage.clearStalledIntentsForUser(userId);
      res.json({ cleared });
    } catch (err) {
      console.error("Error clearing stalled intents for user:", err);
      res.status(500).json({ message: "Failed to clear stalled intents" });
    }
  });

  // Admin endpoint: clears the in-memory crash history ring buffer and the
  // persisted crash log file so operators can acknowledge investigated incidents.
  app.delete("/api/admin/crashes", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Admin only" });
    }
    taskTracker.clearCrashHistory();
    const crashLogPath = path.join(process.cwd(), ".crash_log.json");
    try {
      await fs.writeFile(crashLogPath, "[]", "utf8");
    } catch {
      // Best-effort — don't fail the request if the file write fails.
    }
    res.json({ cleared: true });
  });

  // Admin endpoint: data-consistency integrity checks. Returns one row per check
  // with a count of anomalous rows (0 = healthy). Useful for catching regressions
  // from folder/trash workflow bugs (e.g. tasks #297 and #336).
  app.get("/api/admin/integrity-checks", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const [mismatch] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM counting_sessions
            WHERE trashed_from_folder_id IS NOT NULL
              AND folder_id IS NOT NULL
              AND folder_id != trashed_from_folder_id`
      )).rows as [{ count: number }];

      const [stale] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM counting_sessions
            WHERE trashed_from_folder_id IS NOT NULL
              AND deleted_at IS NULL`
      )).rows as [{ count: number }];

      const [orphanedFolder] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM counting_sessions cs
            JOIN folders f ON cs.folder_id = f.id
            WHERE f.deleted_at IS NOT NULL
              AND cs.deleted_at IS NULL`
      )).rows as [{ count: number }];

      const [zeroFootage] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM entries
            WHERE footage IS NULL OR footage <= 0`
      )).rows as [{ count: number }];

      const [stalePins] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM pins p
            JOIN photos ph ON p.photo_id = ph.id
            JOIN counting_sessions cs ON ph.session_id = cs.id
            WHERE p.entry_id IS NULL
              AND cs.created_at < NOW() - INTERVAL '7 days'
              AND cs.deleted_at IS NULL`
      )).rows as [{ count: number }];

      const [staleIntents] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM upload_intents
            WHERE created_at < NOW() - INTERVAL '48 hours'`
      )).rows as [{ count: number }];

      res.json({
        checks: [
          {
            id: "trashed_from_folder_mismatch",
            label: "trashedFromFolderId / folderId mismatch",
            description: "Sessions where both folder_id and trashed_from_folder_id are set but differ",
            count: Number(mismatch.count),
            fixable: true,
          },
          {
            id: "stale_trashed_from_folder",
            label: "Stale trashedFromFolderId on active sessions",
            description: "Sessions with trashed_from_folder_id set but not currently trashed (deleted_at IS NULL)",
            count: Number(stale.count),
            fixable: true,
          },
          {
            id: "session_in_deleted_folder",
            label: "Active sessions inside a trashed folder",
            description: "Non-trashed sessions whose folder_id points to a soft-deleted folder",
            count: Number(orphanedFolder.count),
            fixable: true,
          },
          {
            id: "entries_zero_footage",
            label: "Entries with zero or missing footage",
            description: "Committed entries where footage is NULL or 0 — likely a data entry error",
            count: Number(zeroFootage.count),
            fixable: false,
          },
          {
            id: "uncommitted_pins_stale",
            label: "Stale uncommitted pins (>7 days old)",
            description: "Draft pins with no linked entry on sessions active for over 7 days",
            count: Number(stalePins.count),
            fixable: true,
          },
          {
            id: "stale_upload_intents",
            label: "Stale upload intents (>48 hours old)",
            description: "Upload intent records that were never completed and are older than 48 hours",
            count: Number(staleIntents.count),
            fixable: true,
          },
        ],
      });
    } catch (err) {
      console.error("[integrity-checks]", err);
      res.status(500).json({ message: "Internal error" });
    }
  });

  // Admin endpoint: one-click repair for flagged integrity issues.
  // Runs a targeted UPDATE for the given checkId and returns { fixed } row count.
  app.post("/api/admin/integrity-fix/:checkId", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { checkId } = req.params;
    try {
      let result;
      if (checkId === "trashed_from_folder_mismatch") {
        result = await db.execute(
          sql`UPDATE counting_sessions
              SET trashed_from_folder_id = NULL
              WHERE trashed_from_folder_id IS NOT NULL
                AND folder_id IS NOT NULL
                AND folder_id != trashed_from_folder_id`
        );
      } else if (checkId === "stale_trashed_from_folder") {
        result = await db.execute(
          sql`UPDATE counting_sessions
              SET trashed_from_folder_id = NULL
              WHERE trashed_from_folder_id IS NOT NULL
                AND deleted_at IS NULL`
        );
      } else if (checkId === "session_in_deleted_folder") {
        result = await db.execute(
          sql`UPDATE counting_sessions
              SET folder_id = NULL
              WHERE folder_id IN (SELECT id FROM folders WHERE deleted_at IS NOT NULL)
                AND deleted_at IS NULL`
        );
      } else if (checkId === "uncommitted_pins_stale") {
        result = await db.execute(
          sql`DELETE FROM pins
              WHERE entry_id IS NULL
                AND photo_id IN (
                  SELECT ph.id FROM photos ph
                  JOIN counting_sessions cs ON ph.session_id = cs.id
                  WHERE cs.created_at < NOW() - INTERVAL '7 days'
                    AND cs.deleted_at IS NULL
                )`
        );
      } else if (checkId === "stale_upload_intents") {
        result = await db.execute(
          sql`DELETE FROM upload_intents
              WHERE created_at < NOW() - INTERVAL '48 hours'`
        );
      } else {
        return res.status(400).json({ message: "Unknown checkId" });
      }
      const fixed = result.rowCount ?? 0;
      console.log(`[integrity-fix] ${checkId}: fixed ${fixed} row(s)`);
      res.json({ fixed });
    } catch (err) {
      console.error("[integrity-fix]", err);
      res.status(500).json({ message: "Fix failed" });
    }
  });

  // Admin endpoint: current PDF export job stats (owner-only).
  // Returns active/completed job counts, total buffer memory, oldest job age,
  // and the individual job list so operators can cancel stuck jobs.
  app.get("/api/admin/pdf-jobs", isAuthenticated, (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const now = Date.now();
    let activeCount = 0;
    let completedCount = 0;
    let totalBufferBytes = 0;
    let oldestJobAgeMs: number | null = null;
    const jobs: Array<{ id: string; createdAt: number; complete: boolean; completedAt?: number }> = [];
    for (const [id, job] of pdfJobs.entries()) {
      if (job.complete) {
        completedCount++;
      } else {
        activeCount++;
      }
      if (job.buffer) {
        totalBufferBytes += job.buffer.length;
      }
      const ageMs = now - job.createdAt;
      if (oldestJobAgeMs === null || ageMs > oldestJobAgeMs) {
        oldestJobAgeMs = ageMs;
      }
      jobs.push({ id, createdAt: job.createdAt, complete: job.complete, completedAt: job.completedAt });
    }
    res.json({ activeCount, completedCount, totalBufferBytes, oldestJobAgeMs, jobs });
  });

  // Admin endpoint: force-remove a single PDF export job (owner-only).
  // Removes the job from the in-memory map regardless of its current state,
  // freeing any buffer memory immediately without requiring a server restart.
  app.delete("/api/admin/pdf-jobs/:jobId", isAuthenticated, (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { jobId } = req.params;
    if (!pdfJobs.has(jobId)) {
      return res.status(404).json({ message: "Job not found" });
    }
    pdfJobs.delete(jobId);
    res.json({ ok: true, jobId });
  });

  // Public endpoint: fire-and-forget page view tracking.
  // Hashes the client IP for privacy-safe visitor counting; never blocks the response.
  app.post("/api/track/pageview", pageviewRateLimiter, async (req: any, res) => {
    try {
      const { path } = req.body ?? {};
      if (!path || typeof path !== "string" || path.length > 500) {
        return res.status(400).json({ ok: false });
      }
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      const salt = process.env.SESSION_SECRET || "pv-salt";
      const hash = createHash("sha256").update(ip + salt).digest("hex").slice(0, 16);
      const dedupeKey = `${hash}:${path.slice(0, 200)}`;
      const now = Date.now();
      const previous = recentPageViews.get(dedupeKey);
      if (previous && now - previous < 30_000) {
        return res.json({ ok: true, deduplicated: true });
      }
      recentPageViews.set(dedupeKey, now);
      if (recentPageViews.size > 10_000) {
        for (const [key, timestamp] of recentPageViews) {
          if (now - timestamp >= 30_000) recentPageViews.delete(key);
        }
      }
      db.execute(sql`
        INSERT INTO page_views (path, visitor_hash, created_at)
        VALUES (${path.slice(0, 200)}, ${hash}, NOW())
      `).catch(() => {});
      res.json({ ok: true });
    } catch {
      res.json({ ok: false });
    }
  });

  // Admin endpoint: high-level aggregate app stats (owner-only).
  app.get("/api/admin/summary", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) return res.status(403).json({ message: "Forbidden" });
    try {
      const [totalUsers] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM users WHERE NOT is_tester`
      )).rows as [{ count: number }];
      const [newUsersWeek] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM users WHERE NOT is_tester AND created_at > NOW() - INTERVAL '7 days'`
      )).rows as [{ count: number }];
      const [newUsersMonth] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM users WHERE NOT is_tester AND created_at > NOW() - INTERVAL '30 days'`
      )).rows as [{ count: number }];
      const [totalSessions] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM counting_sessions WHERE deleted_at IS NULL`
      )).rows as [{ count: number }];
      const [totalEntries] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM entries`
      )).rows as [{ count: number }];
      const [totalPhotos] = (await db.execute(
        sql`SELECT COUNT(*)::int AS count FROM photos`
      )).rows as [{ count: number }];
      res.json({
        totalUsers: Number(totalUsers.count),
        newUsersWeek: Number(newUsersWeek.count),
        newUsersMonth: Number(newUsersMonth.count),
        totalSessions: Number(totalSessions.count),
        totalEntries: Number(totalEntries.count),
        totalPhotos: Number(totalPhotos.count),
      });
    } catch (err) {
      console.error("[admin-summary]", err);
      res.status(500).json({ message: "Internal error" });
    }
  });

  // Admin endpoint: AI API usage statistics (owner-only).
  app.get("/api/admin/ai-usage", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) return res.status(403).json({ message: "Forbidden" });
    try {
      const [totals] = (await db.execute(sql`
        SELECT
          COUNT(*)::int AS total_requests,
          COALESCE(SUM(prompt_tokens), 0)::int AS total_prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)::int AS total_completion_tokens
        FROM ai_usage_logs
        WHERE created_at > NOW() - INTERVAL '30 days'
      `)).rows as [{ total_requests: number; total_prompt_tokens: number; total_completion_tokens: number }];

      const byFeatureRows = (await db.execute(sql`
        SELECT feature,
          COUNT(*)::int AS requests,
          COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens
        FROM ai_usage_logs
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY feature
        ORDER BY requests DESC
      `)).rows as Array<{ feature: string; requests: number; prompt_tokens: number; completion_tokens: number }>;

      const byUserRows = (await db.execute(sql`
        SELECT al.user_id,
          COALESCE(
            NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),
            u.username,
            al.user_id,
            'Unknown'
          ) AS display_name,
          COUNT(*)::int AS requests,
          COALESCE(SUM(al.prompt_tokens + al.completion_tokens), 0)::int AS tokens
        FROM ai_usage_logs al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE al.created_at > NOW() - INTERVAL '30 days'
        GROUP BY al.user_id, display_name
        ORDER BY requests DESC
        LIMIT 20
      `)).rows as Array<{ user_id: string | null; display_name: string; requests: number; tokens: number }>;

      const dailyRows = (await db.execute(sql`
        SELECT DATE(created_at)::text AS date, COUNT(*)::int AS requests
        FROM ai_usage_logs
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `)).rows as Array<{ date: string; requests: number }>;

      const providerRows = (await db.execute(sql`
        SELECT provider, endpoint, route, status,
          COUNT(*)::int AS requests,
          COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
          COALESCE(AVG(latency_ms), 0)::int AS average_latency_ms,
          COALESCE(SUM(retry_count), 0)::int AS retries
        FROM ai_usage_logs
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY provider, endpoint, route, status
        ORDER BY requests DESC
      `)).rows as Array<{
        provider: string;
        endpoint: string | null;
        route: string | null;
        status: string;
        requests: number;
        prompt_tokens: number;
        completion_tokens: number;
        average_latency_ms: number;
        retries: number;
      }>;

      res.json({
        totalRequests: Number(totals.total_requests),
        totalPromptTokens: Number(totals.total_prompt_tokens),
        totalCompletionTokens: Number(totals.total_completion_tokens),
        byFeature: byFeatureRows.map(r => ({
          feature: r.feature,
          requests: Number(r.requests),
          promptTokens: Number(r.prompt_tokens),
          completionTokens: Number(r.completion_tokens),
        })),
        byUser: byUserRows.map(r => ({
          // Keep analytics aggregate-only; stable user identifiers are not
          // useful to this chart and would increase disclosure risk.
          userId: null,
          displayName: r.display_name,
          requests: Number(r.requests),
          tokens: Number(r.tokens),
        })),
        dailyTrend: dailyRows.map(r => ({ date: r.date, requests: Number(r.requests) })),
        byProvider: providerRows.map(r => ({
          provider: r.provider,
          endpoint: r.endpoint,
          route: r.route,
          status: r.status,
          requests: Number(r.requests),
          promptTokens: Number(r.prompt_tokens),
          completionTokens: Number(r.completion_tokens),
          averageLatencyMs: Number(r.average_latency_ms),
          retries: Number(r.retries),
        })),
      });
    } catch (err) {
      console.error("[admin-ai-usage]", err);
      res.status(500).json({ message: "Internal error" });
    }
  });

  // Admin endpoint: page view statistics (owner-only).
  app.get("/api/admin/page-views", isAuthenticated, async (req: any, res) => {
    if (!isOwnerIdentity((req as AuthenticatedRequest).user)) return res.status(403).json({ message: "Forbidden" });
    try {
      const [totals] = (await db.execute(sql`
        SELECT COUNT(*)::int AS total_views
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '30 days'
      `)).rows as [{ total_views: number }];

      const [uniqueToday] = (await db.execute(sql`
        SELECT COUNT(DISTINCT visitor_hash)::int AS unique_visitors
        FROM page_views
        WHERE created_at >= CURRENT_DATE
      `)).rows as [{ unique_visitors: number }];

      const byPathRows = (await db.execute(sql`
        SELECT path, COUNT(*)::int AS views
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY path
        ORDER BY views DESC
        LIMIT 15
      `)).rows as Array<{ path: string; views: number }>;

      const dailyRows = (await db.execute(sql`
        SELECT DATE(created_at)::text AS date, COUNT(*)::int AS views
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `)).rows as Array<{ date: string; views: number }>;

      res.json({
        totalViews: Number(totals.total_views),
        uniqueVisitorsToday: Number(uniqueToday.unique_visitors),
        byPath: byPathRows.map(r => ({ path: r.path, views: Number(r.views) })),
        dailyTrend: dailyRows.map(r => ({ date: r.date, views: Number(r.views) })),
      });
    } catch (err) {
      console.error("[admin-page-views]", err);
      res.status(500).json({ message: "Internal error" });
    }
  });

  // ── Dev-only test seeding endpoint ──────────────────────────────────────────
  // Sets (or overwrites) the tester password for the first non-tester owner so
  // that the Playwright global-setup can authenticate without a real OAuth flow.
  // Strictly unavailable in production.
  if (process.env.NODE_ENV !== "production") {
    app.post("/api/__test__/owner-login", async (req: any, res) => {
      try {
        const allUsers = await authStorage.getAllUsers();
        const owners = allUsers.filter((u: any) => !u.isTester);
        if (owners.length === 0) {
          return res.status(404).json({ message: "No owner found. Sign in with Clerk once first." });
        }
        const owner = owners[0];
        const ownerUser = {
          claims: {
            sub: owner.id,
            firstName: owner.firstName || "TestOwner",
            username: owner.firstName || "TestOwner",
          },
          expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          isTester: false,
          isOwner: true,
          isTestOwner: true,
        };
        // This development-only compatibility identity exercises owner-only
        // application behavior without weakening production Clerk checks.
        await establishTesterSession(req, ownerUser);
        res.json({ ok: true, userId: owner.id });
      } catch (err) {
        console.error("[test-owner-login] error:", err);
        res.status(500).json({ message: "Failed to create owner session" });
      }
    });

    app.post("/api/__test__/seed-tester-password", async (req: any, res) => {
      try {
        authRateLimiter.resetKey(ipKeyGenerator(req.ip));
        const { password } = req.body ?? {};
        if (!password || typeof password !== "string") {
          return res.status(400).json({ message: "password required" });
        }
        const allUsers = await authStorage.getAllUsers();
        const owners = allUsers.filter((u: any) => !u.isTester);
        if (owners.length === 0) {
          return res.status(404).json({
            message: "No owner users found. Sign in with Clerk once first.",
          });
        }
        const owner = owners[0];
        const hashed = await bcrypt.hash(password, 10);
        await storage.upsertUserSettings(owner.id, { testerPassword: hashed });
        return res.json({ ok: true, ownerUserId: owner.id });
      } catch (err) {
        console.error("[test-seed] error:", err);
        return res.status(500).json({ message: "seed failed" });
      }
    });
  }

  const trashPurgeTimer = setInterval(purgeExpiredTrash, TRASH_PURGE_INTERVAL_MS);
  trashPurgeTimer.unref();
  const initialTrashPurgeTimer = setTimeout(purgeExpiredTrash, 30000);
  initialTrashPurgeTimer.unref();

  return httpServer;
}

export async function verifyTesterCredentials(
  ownerUserId: string,
  password: string,
  getUserSettings: (userId: string) => Promise<UserSettings | undefined> = (userId) => storage.getUserSettings(userId),
  comparePassword: (password: string, hash: string) => Promise<boolean> = bcrypt.compare,
): Promise<UserSettings | undefined> {
  const ownerSettings = await getUserSettings(ownerUserId);
  const testerPasswordHash = ownerSettings?.testerPassword ?? TESTER_LOGIN_DUMMY_HASH;
  const matches = await comparePassword(password.trim(), testerPasswordHash);
  return ownerSettings?.testerPassword && matches ? ownerSettings : undefined;
}

export function respondWithScanResultsPersistenceFailure(
  res: Pick<ExpressResponse, "status">,
): ReturnType<ExpressResponse["status"]> {
  return res.status(503).json(SCAN_RESULTS_PERSISTENCE_ERROR);
}
