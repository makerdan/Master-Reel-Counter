import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import passport from "passport";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth";
import { registerAuthRoutes, isApproved } from "./replit_integrations/auth/routes";
import { authStorage } from "./replit_integrations/auth/storage";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage/routes";
import { objectStorageClient } from "./replit_integrations/object_storage/objectStorage";
import { insertSessionSchema, insertEntrySchema, insertPinSchema, photos, pins, insertFeedbackSchema, insertUserWireCatalogSchema, countingSessions, type Session } from "@shared/schema";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { generateSalt, generateDataKey, deriveKEK, wrapKey, unwrapKey, encryptEntry, decryptEntry } from "./encryption";
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
import { openai } from "./replit_integrations/image/client";
import { taskTracker } from "./lib/taskTracker";

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
const wsUserMap = new Map<WebSocket, { sessionId: number | null; userId: string | null; username: string | null; role: string | null }>();

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

function canEdit(role: string): boolean {
  return role === "owner" || role === "editor";
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

function resolveUserId(req: any): string {
  const user = req.user as any;
  if (user?.isTester && user?.claims?.testerOwnerUserId) {
    return user.claims.testerOwnerUserId;
  }
  return user?.claims?.sub;
}

function getTesterOwner(req: any): string | undefined {
  const user = req.user as any;
  if (user?.isTester && user?.claims?.testerOwnerUserId) {
    return user.claims.testerOwnerUserId;
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
  keyGenerator: (req: any) => req.user?.claims?.sub ?? req.ip,
  message: { message: "Too many scan requests. Please wait a moment before trying again." },
});

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
  registerAuthRoutes(app);
  registerObjectStorageRoutes(app);

  app.use("/api", (req, res, next) => {
    const skipPaths = [
      "/api/login", "/api/callback", "/api/logout",
      "/api/auth/user", "/api/auth/tester-login", "/api/auth/tester-logout",
    ];
    const matchesSkip = skipPaths.some(p => req.originalUrl === p || req.originalUrl.startsWith(p + "/") || req.originalUrl.startsWith(p + "?"));
    if (matchesSkip) return next();
    isApproved(req, res, next);
  });

  app.post("/api/auth/tester-login", authRateLimiter, async (req: any, res) => {
    try {
      const { displayName, password } = req.body;
      if (!displayName || !password) {
        return res.status(400).json({ message: "Display name and password are required" });
      }
      const candidates = await storage.getAllSettingsWithTesterPassword();
      let ownerSettings = null;
      for (const candidate of candidates) {
        if (candidate.testerPassword && await bcrypt.compare(password.trim(), candidate.testerPassword)) {
          ownerSettings = candidate;
          break;
        }
      }
      if (!ownerSettings) {
        return res.status(401).json({ message: "Invalid tester password" });
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
      req.login(testerUser, (err: any) => {
        if (err) {
          console.error("Tester login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }
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
      });
    } catch (error) {
      console.error("Tester login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.get("/api/auth/tester-logout", (req: any, res) => {
    req.logout(() => {
      res.redirect("/");
    });
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
    try {
      if (!req.file) {
        if (req._rejectedMimetype) {
          return res.status(400).json({ error: `Invalid file type: ${req._rejectedMimetype}. Allowed: image/jpeg, image/png, image/webp.` });
        }
        return res.status(400).json({ error: "No file provided" });
      }

      const ext = path.extname(req.file.originalname) || "";
      const objectId = `${randomUUID()}${ext}`;
      const objectPath = `/uploads/${objectId}`;
      const objectName = toStorageObjectName(objectPath);
      const localFallback = path.join(UPLOADS_DIR, objectId);
      await putToObjectStorage(BUCKET_NAME, objectName, req.file.buffer, req.file.mimetype, localFallback);
      console.log(`Upload success: file="${objectId}", size=${req.file.size}, type=${req.file.mimetype}`);

      res.json({
        objectPath,
        metadata: {
          name: req.file.originalname,
          size: req.file.size,
          contentType: req.file.mimetype,
        },
      });
    } catch (error: any) {
      console.error("Error uploading file:", error?.message || error, error?.stack);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });

  app.get("/uploads/:filename", isAuthenticated, async (req: any, res) => {
    try {
      const filename = req.params.filename;
      if (typeof filename !== "string" || !/^[A-Za-z0-9._-]+$/.test(filename) || filename.length > 255 || filename === "." || filename === "..") {
        return res.status(400).json({ error: "Invalid filename" });
      }

      const storageKey = `/uploads/${filename}`;
      const requestingUserId = req.user.claims.sub;
      const photo = await storage.getPhotoByStorageKey(storageKey);
      if (photo) {
        const testerOwner = getTesterOwner(req);
        const access = await verifySessionAccess(photo.sessionId, requestingUserId, testerOwner);
        if (!access) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else {
        const ownerUserId = getTesterOwner(req) ?? requestingUserId;
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
        "Cache-Control": "private, max-age=86400",
      };
      let servedFromGcs = false;
      try {
        const gcsFile = objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(`/uploads/${filename}`));
        const [existsInGcs] = await Promise.race([
          gcsFile.exists(),
          new Promise<[boolean]>(resolve => setTimeout(() => resolve([false]), 2000)),
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
        return res.status(404).json({ error: "File not found" });
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
      const userId = resolveUserId(req);
      const trash = req.query.trash === "true";
      const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset) : undefined;
      const { sessions, total } = await storage.getUserSessions(userId, { trash, limit, offset });
      const sessionIds = sessions.map(s => s.id);
      const [stats, photoStats, thumbnails, collabUsernames] = await Promise.all([
        storage.getSessionStats(sessionIds),
        storage.getSessionPhotoStats(sessionIds),
        storage.getSessionThumbnails(sessionIds),
        storage.getSessionCollaboratorUsernames(sessionIds),
      ]);
      const sessionsWithStats = sessions.map(s => {
        const st = stats.get(s.id) || { entryCount: 0, totalFootage: 0, sectionCount: 0 };
        const ps = photoStats.get(s.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
        const thumbnailKey = thumbnails.get(s.id) || null;
        const collaboratorUsernames = collabUsernames.get(s.id) || [];
        return { ...s, ...st, ...ps, thumbnailKey, collaboratorUsernames };
      });
      res.json({ sessions: sessionsWithStats, total, limit, offset: offset || 0 });
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ message: "Failed to fetch sessions" });
    }
  });

  app.post("/api/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
      const sharedSessions = await storage.getSharedSessions(userId);
      const sessionIds = sharedSessions.map(s => s.id);
      const [stats, photoStats, thumbnails, collabUsernames] = await Promise.all([
        storage.getSessionStats(sessionIds),
        storage.getSessionPhotoStats(sessionIds),
        storage.getSessionThumbnails(sessionIds),
        storage.getSessionCollaboratorUsernames(sessionIds),
      ]);
      const result = sharedSessions.map(s => {
        const st = stats.get(s.id) || { entryCount: 0, totalFootage: 0, sectionCount: 0 };
        const ps = photoStats.get(s.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
        const thumbnailKey = thumbnails.get(s.id) || null;
        const collaboratorUsernames = collabUsernames.get(s.id) || [];
        return { ...s, ...st, ...ps, thumbnailKey, collaboratorUsernames };
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching shared sessions:", error);
      res.status(500).json({ message: "Failed to fetch shared sessions" });
    }
  });

  app.get("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const { expectedLastUpdatedAt, completedAt, ...rest } = parsed.data;
      const data: Partial<Session> = { ...rest };
      if (completedAt !== undefined) {
        data.completedAt = completedAt === null ? null : new Date(completedAt);
      }
      // IDOR guard: if the caller is moving the session to a folder, verify
      // that folder belongs to the requesting user before proceeding.
      if (data.folderId != null) {
        const userId = resolveUserId(req);
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
        logActivity(access.session.id, req.user.claims.sub, req.user.claims.username, "session_updated", "session", access.session.id, changedFields);
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Failed to update session:", error?.message || error);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  app.post("/api/sessions/:id/lock", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can lock/unlock sessions" });
      if (typeof req.body?.locked !== "boolean") return res.status(400).json({ message: "locked must be a boolean" });
      const { locked } = req.body;
      const updated = await storage.updateSession(access.session.id, { isLocked: !!locked });
      await logActivity(access.session.id, req.user.claims.sub, req.user.claims.username, locked ? "locked_session" : "unlocked_session", "session", access.session.id);
      broadcastToSession(access.session.id, { type: "session_lock", locked: !!locked });
      res.json(updated);
    } catch (error: any) {
      console.error("Failed to toggle session lock:", error?.message || error);
      res.status(500).json({ message: "Failed to toggle session lock" });
    }
  });


  app.delete("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can delete sessions" });
      await storage.softDeleteSession(access.session.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete session" });
    }
  });

  app.post("/api/sessions/:id/restore", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req), true);
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req), true);
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
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to permanently delete session" });
    }
  });

  app.post("/api/sessions/bulk/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const { ids, status } = req.body;
      if (!Array.isArray(ids) || !ids.length || !["active", "completed"].includes(status)) {
        return res.status(400).json({ message: "Invalid request" });
      }
      const results = [];
      for (const id of ids) {
        const access = await verifySessionAccess(id, userId, getTesterOwner(req));
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
      const userId = resolveUserId(req);
      const { ids, folderId } = req.body;
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
        const access = await verifySessionAccess(id, userId, getTesterOwner(req));
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
      const userId = resolveUserId(req);
      const { ids } = req.body;
      if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({ message: "Invalid request" });
      }
      const results = [];
      for (const id of ids) {
        const access = await verifySessionAccess(id, userId, getTesterOwner(req));
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
      const userId = resolveUserId(req);
      const userFolders = await storage.getUserFolders(userId);
      res.json(userFolders);
    } catch (error) {
      res.status(500).json({ message: "Failed to get folders" });
    }
  });

  app.post("/api/folders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const { name } = req.body;
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
      const userId = resolveUserId(req);
      const folder = await storage.getFolder(parseInt(req.params.id));
      if (!folder || folder.userId !== userId) return res.status(404).json({ message: "Folder not found" });
      if (folder.deletedAt) return res.status(400).json({ message: "Cannot modify a trashed folder" });
      const { name, sortOrder, parentFolderId } = req.body;
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
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
      const folder = await storage.getFolder(parseInt(req.params.id));
      if (!folder || folder.userId !== userId) return res.status(404).json({ message: "Folder not found" });
      await storage.restoreFolder(folder.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to restore folder" });
    }
  });

  app.delete("/api/folders/:id/permanent", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
      const trashedFolders = await storage.getTrashedFolders(userId);
      res.json(trashedFolders);
    } catch (error) {
      res.status(500).json({ message: "Failed to get trashed folders" });
    }
  });

  app.post("/api/folders/reorder", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const { folderIds } = req.body;
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
      const userId = resolveUserId(req);
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== userId) return res.status(404).json({ message: "Session not found" });
      const { folderId } = req.body;
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
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (getTesterOwner(req)) return res.status(403).json({ message: "Testers cannot duplicate sessions" });
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
      const userId = resolveUserId(req);
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== userId) return res.status(403).json({ message: "Only the session owner can reset" });
      await storage.resetSessionToPhotos(session.id);
      const displayName = req.user.claims.name || req.user.claims.username || userId;
      await logActivity(session.id, userId, displayName, "session_reset_to_photos", "session", session.id);
      broadcastToSession(session.id, { type: "sync", entity: "session", sessionId: session.id });
      res.json({ message: "Session reset to photos only" });
    } catch (error) {
      res.status(500).json({ message: "Failed to reset session" });
    }
  });

  app.get("/api/search/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req));
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
      const access = await verifySessionAccess(parseInt(req.params.sessionId), req.user.claims.sub, getTesterOwner(req));
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
    try {
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to add photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const displayName = req.user.claims.first_name
        ? `${req.user.claims.first_name} ${req.user.claims.last_name || ""}`.trim()
        : req.user.claims.email || userId;
      const ext = (req.body.originalFilename || "photo.jpg").match(/\.[^.]+$/)?.[0] || ".jpg";
      const photo = await storage.atomicCreatePhoto({
        ...req.body,
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

  app.patch("/api/photos/:id", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.id));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit photos" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }

      const { aisle, section, rotation, notes, isDetailShot, parentPhotoId, pinScale, linkReason, linkedPinLabel } = req.body;
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
  });

  app.post("/api/photos/:id/duplicate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const original = await storage.getPhoto(parseInt(req.params.id));
      if (!original) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(original.sessionId, userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to duplicate photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });
      const displayName = req.user.claims.name || req.user.claims.username || userId;

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

      let copiedKey = newObjectPath;
      try {
        // Server-side GCS copy — no bandwidth cost, works even for large files
        await objectStorageClient.bucket(BUCKET_NAME).file(srcObjectName)
          .copy(objectStorageClient.bucket(BUCKET_NAME).file(destObjectName));
      } catch {
        // Fall back to local-disk copy if GCS is unavailable
        try {
          await fs.copyFile(localSrcPath, localDestPath);
        } catch {
          // If neither works, keep the original key (shared reference) so the duplicate at least shows the photo
          copiedKey = original.objectStorageKey!;
        }
      }

      const [newPhoto] = await db.insert(photos).values({
        sessionId:        original.sessionId,
        userId:           userId,
        uploadedBy:       original.uploadedBy,
        objectStorageKey: copiedKey,
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const keepFile = req.query.keepFile === "1";
      if (!keepFile) {
        try {
          const key = photo.objectStorageKey;
          const shared = await storage.isObjectKeyShared(key, photo.id);
          if (!shared) {
            const filename = key.startsWith("/uploads/") ? key.slice("/uploads/".length) : key.replace(/^\/objects\/uploads\//, "");
            const filePath = path.join(UPLOADS_DIR, filename);
            await objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(key)).delete({ ignoreNotFound: true }).catch(() => {});
            await fs.unlink(filePath).catch(() => {});
          }
        } catch (err) {
          console.warn("Could not delete uploaded file:", err);
        }
      }
      await storage.deletePhoto(photo.id);
      logActivity(photo.sessionId, req.user.claims.sub, req.user.claims.username, "photo_deleted", "photo", photo.id, photo.originalFilename || undefined);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete photo" });
    }
  });

  app.post("/api/sessions/:id/photos/restore", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req));
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

      const photo = await storage.createPhoto(safePhotoData);

      const oldPhotoId = body.oldPhotoId ? parseInt(body.oldPhotoId) : null;
      const encKey = await getEncryptionKey(access.session.userId);

      const entryIdMap = new Map<number, number>();
      if (body.entries && Array.isArray(body.entries)) {
        for (const entryData of body.entries) {
          const { id: oldId, createdAt: _ca, updatedAt: _ua, ...entryFields } = entryData;
          let safeEntryData: any = {
            ...entryFields,
            sessionId: access.session.id,
            userId,
            photoId: (oldPhotoId && entryFields.photoId === oldPhotoId) ? photo.id : (entryFields.photoId || null),
          };
          if (encKey) safeEntryData = encryptEntry(safeEntryData, encKey) as any;
          const parsed = insertEntrySchema.parse(safeEntryData);
          const newEntry = await storage.createEntry(parsed);
          if (oldId) entryIdMap.set(oldId, newEntry.id);
        }
      }

      if (body.pins && Array.isArray(body.pins)) {
        for (const pinData of body.pins) {
          const { id: _id, createdAt: _ca, ...pinFields } = pinData;
          const restoredEntryId = pinFields.entryId ? (entryIdMap.get(pinFields.entryId) ?? null) : null;
          await storage.createPin({ ...pinFields, photoId: photo.id, entryId: restoredEntryId });
        }
      }

      res.json(photo);
    } catch (error) {
      res.status(500).json({ message: "Failed to restore photo" });
    }
  });

  app.get("/api/sessions/:sessionId/pins", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId, getTesterOwner(req));
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
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const encKey = isOwner(access.role) ? await getEncryptionKey(userId) : await getEncryptionKey(access.session.userId);
      if (req.query.limit) {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const { entries: rawEntries, total } = await storage.getSessionEntriesPaginated(access.session.id, limit, offset);
        const result = encKey ? rawEntries.map(e => decryptEntry(e, encKey) as any) : rawEntries;
        res.json({ entries: result, total, limit, offset });
      } else {
        const rawEntries = await storage.getSessionEntries(access.session.id);
        const result = encKey ? rawEntries.map(e => decryptEntry(e, encKey) as any) : rawEntries;
        res.json(result);
      }
    } catch (error) {
      console.error("Error fetching entries:", error);
      res.status(500).json({ message: "Failed to fetch entries" });
    }
  });

  app.post("/api/sessions/:sessionId/entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to add entries" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      let entryData = { ...req.body, sessionId: access.session.id, userId };
      const encKey = await getEncryptionKey(access.session.userId);
      if (encKey) entryData = encryptEntry(entryData, encKey) as any;
      const data = insertEntrySchema.parse(entryData);
      const entry = await storage.createEntry(data);
      if (data.photoId) {
        try {
          await storage.resolveParentPinForDetailShot(data.photoId, entry.id);
        } catch (resolveErr) {
          console.error("Non-fatal: failed to resolve parent pin for detail shot", resolveErr);
        }
      }
      await storage.updateSession(access.session.id, {});
      const result = encKey ? decryptEntry(entry, encKey) : entry;
      const username = req.user.claims.first_name || req.user.claims.email || userId;
      logActivity(access.session.id, userId, username, "entry_created", "entry", entry.id, result.reelTag || undefined);
      broadcastToSession(access.session.id, { type: "sync", entity: "entries", sessionId: access.session.id });
      res.json(result);
    } catch (error) {
      console.error("Error creating entry:", error);
      res.status(500).json({ message: "Failed to create entry" });
    }
  });

  app.patch("/api/entries/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const access = await verifySessionAccess(entry.sessionId, userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Entry not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit entries" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const serverUpdatedAt = req.body?.serverUpdatedAt;
      if (serverUpdatedAt) {
        const current = new Date(entry.updatedAt).toISOString();
        const expected = new Date(serverUpdatedAt).toISOString();
        if (current !== expected) {
          return res.status(409).json({ message: "This entry was modified by another user — undo skipped." });
        }
      }

      const allowedEntryFields = ['aisle', 'section', 'position', 'palletId', 'reelTag', 'wireType', 'gauge', 'footage', 'reelCount', 'color', 'manufacturer', 'notes', 'conductors', 'photoId'];
      const safeBody: Record<string, any> = {};
      for (const key of allowedEntryFields) {
        if (req.body[key] !== undefined) safeBody[key] = req.body[key];
      }
      const encKey = await getEncryptionKey(access.session.userId);
      let updateData: any = safeBody;
      if (encKey) updateData = encryptEntry(updateData, encKey) as any;
      const updated = await storage.updateEntry(entry.id, updateData);
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
            if (req.body.section !== undefined) photoUpdate.section = req.body.section;
            if (req.body.aisle !== undefined) photoUpdate.aisle = req.body.aisle;
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

      const username = req.user.claims.first_name || req.user.claims.email || userId;
      logActivity(entry.sessionId, userId, username, "entry_updated", "entry", entry.id);
      broadcastToSession(entry.sessionId, { type: "sync", entity: "entries", sessionId: entry.sessionId });
      res.json(result);
    } catch (error) {
      console.error("Error updating entry:", error);
      res.status(500).json({ message: "Failed to update entry" });
    }
  });

  app.delete("/api/entries/:id", isAuthenticated, async (req: any, res) => {
    try {
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(entry.sessionId, userId, getTesterOwner(req));
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
      const username = req.user.claims.first_name || req.user.claims.email || userId;
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
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
      const access = await verifySessionAccess(entry.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Entry not found" });
      const sessionPins = await storage.getSessionPins(entry.sessionId);
      const pin = sessionPins.find(p => p.entryId === entryId);
      if (!pin) return res.status(404).json({ message: "No pin linked to this entry" });
      res.json(pin);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch entry pin" });
    }
  });

  app.patch("/api/pins/:pinId/flag", isAuthenticated, async (req: any, res) => {
    try {
      const pin = await storage.getPin(parseInt(req.params.pinId));
      if (!pin) return res.status(404).json({ message: "Pin not found" });
      const photo = await storage.getPhoto(pin.photoId);
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Pin not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to flag pins" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }

      const { flagged, flagReason, serverUpdatedAt: flagToken } = req.body;
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
      logActivity(photo.sessionId, req.user.claims.sub, req.user.claims.username, flagged ? "pin_flagged" : "pin_unflagged", "pin", pin.id, flagReason || undefined);
      broadcastToSessionOwners(photo.sessionId, { type: flagged ? "pin_flagged" : "pin_unflagged", pinId: pin.id, flagged: !!flagged, flagReason: flagged ? (flagReason || null) : null });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pin flag" });
    }
  });

  app.get("/api/sessions/:id/dismissed-duplicates", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const keys = await storage.getDismissedDuplicates(access.session.id);
      res.json(keys);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dismissed duplicates" });
    }
  });

  app.post("/api/sessions/:id/dismissed-duplicates", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }
      const { key, keys } = req.body;
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }
      const { key } = req.body;
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      const pins = await storage.getPhotoPins(photo.id);
      res.json(pins);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pins" });
    }
  });

  app.post("/api/photos/:photoId/pins", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.photoId));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to add pins" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });

      const data = insertPinSchema.parse({ ...req.body, photoId: photo.id });

      // atomicCreatePin enforces (photoId, label) uniqueness at the DB level,
      // preventing duplicates from double-clicks or concurrent collaborator inserts.
      const pin = await storage.atomicCreatePin(data);
      broadcastToSession(photo.sessionId, { type: "sync", entity: "pins", sessionId: photo.sessionId });
      res.json(pin);
    } catch (error) {
      console.error("Error creating pin:", error);
      res.status(500).json({ message: "Failed to create pin" });
    }
  });

  app.patch("/api/pins/:id", isAuthenticated, async (req: any, res) => {
    try {
      const pin = await storage.getPin(parseInt(req.params.id));
      if (!pin) return res.status(404).json({ message: "Pin not found" });
      const photo = await storage.getPhoto(pin.photoId);
      if (!photo) return res.status(404).json({ message: "Pin not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Pin not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit pins" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }

      const { serverUpdatedAt: pinToken } = req.body || {};
      if (pinToken && pin.updatedAt) {
        const current = new Date(pin.updatedAt).toISOString();
        const expected = new Date(pinToken).toISOString();
        if (current !== expected) {
          return res.status(409).json({ message: "This pin was modified by another user — undo skipped." });
        }
      }

      const allowedPinFields = ['xPercent', 'yPercent', 'label', 'reelCount', 'wireDetails', 'vendorCode', 'footage', 'entryId', 'flagged'];
      const safeUpdate: Record<string, any> = {};
      for (const key of allowedPinFields) {
        if (req.body[key] !== undefined) safeUpdate[key] = req.body[key];
      }
      const updated = await storage.updatePin(pin.id, safeUpdate);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pin" });
    }
  });

  app.delete("/api/pins/:id", isAuthenticated, async (req: any, res) => {
    try {
      const pin = await storage.getPin(parseInt(req.params.id));
      if (!pin) return res.status(404).json({ message: "Pin not found" });
      const photo = await storage.getPhoto(pin.photoId);
      if (!photo) return res.status(404).json({ message: "Pin not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
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
      logActivity(photo.sessionId, req.user.claims.sub, req.user.claims.username, "pin_deleted", "pin", pin.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete pin" });
    }
  });

  app.put("/api/photos/:photoId/draft-pins", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.photoId));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit pins" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }

      const { pins: pinData, deletedClientIds } = req.body;
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
        new Promise<[boolean]>(resolve => setTimeout(() => resolve([false]), 2000)),
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to analyze labels" });
      _sid = photo.sessionId;
      taskTracker.startSession(_sid, "scan");

      const { pins: pinData } = req.body;
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

      for (let i = 0; i < pinData.length; i += MAX_BATCH) {
        const batch = pinData.slice(i, i + MAX_BATCH);
        try {
          const { results: crops, truncated: batchTruncated } = await cropPhoto(orientedBuffer, batch.map((p: any) => ({
            pinId: p.pinId,
            x: p.x,
            y: p.y,
            zoomLevel: p.zoomLevel ?? 1,
          })));
          if (batchTruncated) {
            console.warn(`[analyze-labels] cropPhoto output truncated at 50 MB for photoId=${photoId}, batch i=${i}`);
          }

          const imageMessages = crops.map((crop) => ({
            type: "image_url" as const,
            image_url: { url: `data:image/jpeg;base64,${crop.base64}`, detail: "high" as const },
          }));

          const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: "You are reading wire reel labels in a warehouse. The labels may be printed on curved cylindrical reel surfaces, at various angles, upside down, or partially obscured. Read all visible text regardless of orientation. For each image, read all text visible on the label exactly as printed. Do not interpret, reformat, or infer anything. Return a JSON object with a \"labels\" key containing an array of strings in the same order as the images. If a label is unreadable, return null for that entry.",
              },
              {
                role: "user",
                content: [
                  { type: "text", text: `Read the text on each of these ${crops.length} wire reel label images. Return the result as a JSON object: {"labels": ["text from image 1", "text from image 2", ...]}` },
                  ...imageMessages,
                ],
              },
            ],
            max_tokens: 2000,
          });

          const content = response.choices?.[0]?.message?.content ?? "{}";
          let parsed: { labels?: (string | null)[] } = {};
          let parseFailed = false;
          try {
            parsed = JSON.parse(content);
          } catch {
            parseFailed = true;
            console.error("[analyze-labels] Failed to parse OpenAI response:", content);
          }

          const labels = parseFailed ? [] : (parsed.labels ?? []);
          for (let j = 0; j < batch.length; j++) {
            const rawText = parseFailed ? null : (labels[j] ?? null);
            allResults.push({
              pinId: batch[j].pinId,
              pinLabel: batch[j].pinLabel || `P${String(j + i + 1).padStart(3, "0")}`,
              rawText,
              readable: rawText !== null,
            });
          }
        } catch (subErr) {
          console.error(`[analyze-labels] sub-batch starting at ${i} failed:`, subErr);
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
      labelResultsCache.set(photoId, cacheEntry);

      try {
        const scanResultRows = allResults.map((r) => ({
          sessionId: photo.sessionId,
          photoId,
          pinId: r.pinId,
          pinLabel: r.pinLabel,
          rawText: r.rawText,
          readable: r.readable,
          scannedBy: req.user?.claims?.sub || null,
        }));
        await storage.upsertScanResults(scanResultRows);
        broadcastToSession(photo.sessionId, { type: "sync", entity: "scan_results", sessionId: photo.sessionId });
      } catch (e) {
        console.error("[analyze-labels] Failed to persist scan results:", e);
      }

      res.json(cacheEntry);
    } catch (error) {
      console.error("Error analyzing labels:", error);
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to analyze labels" });
      taskTracker.startSession(_sid, "scan");

      const { pins: pinData } = req.body;
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
            const { results: photoCrops, truncated: photoTruncated } = await cropPhoto(buf, items.map((it) => ({
              pinId: it.pinId,
              x: it.x,
              y: it.y,
              zoomLevel: it.zoomLevel,
            })));
            if (photoTruncated) {
              console.warn(`[session-analyze-labels] cropPhoto output truncated at 50 MB for photoId=${photoId}, batch i=${i}`);
            }
            crops.push(...photoCrops);
          }

          const cropOrder = batch.map((b) => b.pinId);
          const orderedCrops = cropOrder.map((pid) => crops.find((c) => c.pinId === pid)!).filter(Boolean);

          const imageMessages = orderedCrops.map((crop) => ({
            type: "image_url" as const,
            image_url: { url: `data:image/jpeg;base64,${crop.base64}`, detail: "high" as const },
          }));

          const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: "You are reading wire reel labels in a warehouse. The labels may be printed on curved cylindrical reel surfaces, at various angles, upside down, or partially obscured. Read all visible text regardless of orientation. For each image, read all text visible on the label exactly as printed. Do not interpret, reformat, or infer anything. Return a JSON object with a \"labels\" key containing an array of strings in the same order as the images. If a label is unreadable, return null for that entry.",
              },
              {
                role: "user",
                content: [
                  { type: "text", text: `Read the text on each of these ${orderedCrops.length} wire reel label images. Return the result as a JSON object: {"labels": ["text from image 1", "text from image 2", ...]}` },
                  ...imageMessages,
                ],
              },
            ],
            max_tokens: 2000,
          });

          const content = response.choices?.[0]?.message?.content ?? "{}";
          let parsed: { labels?: (string | null)[] } = {};
          let parseFailed = false;
          try {
            parsed = JSON.parse(content);
          } catch {
            parseFailed = true;
            console.error("[session-analyze-labels] Failed to parse OpenAI response:", content);
          }

          const labels = parseFailed ? [] : (parsed.labels ?? []);
          for (let j = 0; j < batch.length; j++) {
            const rawText = parseFailed ? null : (labels[j] ?? null);
            allResults.push({
              pinId: batch[j].pinId,
              pinLabel: batch[j].pinLabel,
              rawText,
              readable: rawText !== null,
            });
          }
        } catch (subErr) {
          console.error(`[session-analyze-labels] sub-batch starting at ${i} failed:`, subErr);
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
            scannedBy: req.user?.claims?.sub || null,
          };
        });
        await storage.upsertScanResults(scanResultRows);
        broadcastToSession(sessionId, { type: "sync", entity: "scan_results", sessionId });
      } catch (e) {
        console.error("[session-analyze-labels] Failed to persist scan results:", e);
      }

      res.json({ results: allResults, totalBatches });
    } catch (error) {
      console.error("Error analyzing session labels:", error);
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Photo not found" });

      const { xPercent, yPercent } = req.body;
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });

      // If already anchored, return the existing cohort.
      if (access.session.reviewCohort) {
        return res.json({ cohort: JSON.parse(access.session.reviewCohort) });
      }

      const userId = req.user.claims.sub;
      const username = req.user.claims.firstName || req.user.claims.username || userId;
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const { entryId, verdict, flagReason } = req.body;
      if (!entryId || !verdict || !["approved", "flagged"].includes(verdict)) {
        return res.status(400).json({ message: "entryId and verdict (approved|flagged) are required" });
      }
      const entry = await storage.getEntry(entryId);
      if (!entry || entry.sessionId !== sessionId) {
        return res.status(400).json({ message: "Entry does not belong to this session" });
      }
      const userId = req.user.claims.sub;
      const username = req.user.claims.firstName || req.user.claims.username || userId;
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const userId = req.user.claims.sub;
      await storage.deleteReviewResponse(sessionId, entryId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete review response" });
    }
  });

  app.post("/api/sessions/:id/review-responses/resolve", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to resolve review flags" });
      const { entryId } = req.body;
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub, getTesterOwner(req));
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const collaborators = await storage.getSessionCollaborators(access.session.id);
      res.json({ collaborators, owner: { userId: access.session.userId } });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch collaborators" });
    }
  });

  app.post("/api/sessions/:id/collaborators", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can add collaborators" });
      const { username, role = "editor" } = req.body;
      if (!username) return res.status(400).json({ message: "Username is required" });
      if (username === req.user.claims.username) return res.status(400).json({ message: "You cannot add yourself as a collaborator" });
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
      logActivity(access.session.id, req.user.claims.sub, req.user.claims.username, "collaborator_added", "collaborator", collaborator.id, `${username} as ${role}`);
      res.json(collaborator);
    } catch (error) {
      console.error("Error adding collaborator:", error);
      res.status(500).json({ message: "Failed to add collaborator" });
    }
  });

  app.delete("/api/sessions/:id/collaborators/:collabId", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can remove collaborators" });
      const collabId = parseInt(req.params.collabId);
      await storage.removeCollaborator(collabId, access.session.id);
      logActivity(access.session.id, req.user.claims.sub, req.user.claims.username, "collaborator_removed", "collaborator", collabId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove collaborator" });
    }
  });

  app.patch("/api/sessions/:id/collaborators/:collabId", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can change roles" });
      const { role } = req.body;
      if (!role || !["editor", "viewer"].includes(role)) return res.status(400).json({ message: "Role must be editor or viewer" });
      const updated = await storage.updateCollaboratorRole(parseInt(req.params.collabId), access.session.id, role);
      if (!updated) return res.status(404).json({ message: "Collaborator not found" });
      await logActivity(access.session.id, req.user.claims.sub, req.user.claims.username, "changed_role", "collaborator", updated.id, `Changed to ${role}`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update collaborator role" });
    }
  });

  app.post("/api/sessions/:id/transfer-ownership", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can transfer ownership" });
      const { collaboratorId } = req.body;
      if (!collaboratorId) return res.status(400).json({ message: "collaboratorId is required" });
      const collaborators = await storage.getSessionCollaborators(access.session.id);
      const targetCollab = collaborators.find(c => c.id === collaboratorId);
      if (!targetCollab) return res.status(404).json({ message: "Collaborator not found" });
      await storage.transferSessionOwnership(access.session.id, targetCollab.userId, targetCollab.username || "");
      await logActivity(access.session.id, req.user.claims.sub, req.user.claims.username, "transferred_ownership", "session", access.session.id, `Transferred to ${targetCollab.username || targetCollab.userId}`);
      broadcastToSession(access.session.id, { type: "ownership_transfer" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error transferring ownership:", error?.message || error);
      res.status(500).json({ message: "Failed to transfer ownership" });
    }
  });

  app.post("/api/sessions/:id/leave", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const sessionId = parseInt(req.params.id);
      const collab = await storage.getCollaborator(sessionId, userId);
      if (!collab) return res.status(404).json({ message: "Not a collaborator of this session" });
      await storage.removeCollaboratorBySessionAndUser(sessionId, userId);
      logActivity(sessionId, userId, req.user?.claims?.username, "collaborator_left", "session", sessionId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to leave session" });
    }
  });

  // Invite links
  app.get("/api/sessions/:id/invite-links", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can manage invite links" });
      const links = await storage.getSessionInviteLinks(access.session.id);
      res.json(links);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch invite links" });
    }
  });

  app.post("/api/sessions/:id/invite-links", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can create invite links" });
      const token = randomBytes(24).toString("hex");
      const link = await storage.createInviteLink({
        sessionId: access.session.id,
        token,
        createdBy: req.user.claims.sub,
        isActive: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      logActivity(access.session.id, req.user.claims.sub, req.user.claims.username, "invite_created", "invite_link", link.id);
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
      const access = await verifySessionAccess(link.sessionId, req.user.claims.sub, getTesterOwner(req));
      if (!access || !isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can revoke invite links" });
      await storage.revokeInviteLink(link.id);
      logActivity(link.sessionId, req.user.claims.sub, req.user.claims.username, "invite_deactivated", "invite_link", link.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to revoke invite link" });
    }
  });

  // Join via invite token
  app.post("/api/join/:token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const username = req.user.claims.username || req.user.claims.first_name || userId;
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
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      res.json(taskTracker.getSessionTasks(sessionId));
    } catch {
      res.status(500).json({ message: "Failed to get active tasks" });
    }
  });

  app.get("/api/sessions/:id/export/pdf", isAuthenticated, resourceRateLimiter, async (req: any, res) => {
    const _sid = parseInt(req.params.id);
    taskTracker.increment();
    try {
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      taskTracker.startSession(_sid, "pdf");
      const session = access.session;
      const rawEntries = await storage.getSessionEntries(session.id);
      const key = await getEncryptionKey(userId);
      const sessionEntries = correctEntryFootage(key ? rawEntries.map(e => decryptEntry(e, key) as any) : rawEntries);
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
          const header = pinLabel ? `${formatPinLabel(String(pinLabel))} — ${e.reelTag || e.wireType || "Entry"}` : (e.reelTag || e.wireType || "Entry");
          entryLines.push({ text: header, fontSize: 6.5, color: accentHex, font: 'Helvetica-Bold', indent: false });

          const details: string[] = [];
          if (e.manufacturer) details.push(`Vendor: ${e.manufacturer}`);
          if (e.reelCount && e.reelCount > 1) details.push(`Reels: ${e.reelCount}`);
          if (e.footage) details.push(`Footage: ${fmtFootage(e.footage)} ${pdfULabel}`);
          if (e.gauge) details.push(`Gauge: ${e.gauge}`);
          if (e.color) details.push(`Color: ${e.color}`);
          if (e.conductors) details.push(`Conductors: ${e.conductors}`);

          const line1 = details.slice(0, 3).join("  •  ");
          const line2 = details.slice(3).join("  •  ");
          if (line1) entryLines.push({ text: line1, fontSize: 5.5, color: "#333333", font: 'Helvetica', indent: true });
          if (line2) entryLines.push({ text: line2, fontSize: 5.5, color: "#333333", font: 'Helvetica', indent: true });
          if (e.notes) entryLines.push({ text: `Notes: ${e.notes}`, fontSize: 5, color: "#666666", font: 'Helvetica', indent: true });

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
          const notesText = e.notes || "";
          doc.font('Helvetica-Bold').fontSize(fontSize);
          const measuredNotesH = notesText ? doc.heightOfString(notesText, { width: notesColWidth - 4 }) : 0;
          const actualRowH = Math.max(rH, measuredNotesH + 6);
          if (tblY + actualRowH > maxY) break;
          if (i % 2 === 1) doc.rect(tblX, tblY, tblW, actualRowH).fill("#fafaf8");
          doc.font('Helvetica-Bold').fontSize(fontSize).fillColor("#333333");
          let x = tblX;
          const baseVals = [
            e.reelTag || "",
            e.manufacturer || "",
            String(e.reelCount || 1),
            e.footage ? `${fmtFootage(e.footage)} ${pdfULabel}` : "",
            notesText,
          ];
          const vals = pinMap
            ? [pinMap.get(e.id) || "", ...baseVals]
            : baseVals;
          const cellTextY = tblY + Math.max(1, (actualRowH - fontSize) / 2);
          for (let j = 0; j < allCols.length; j++) {
            const isNotesCol = j === notesColIdx;
            const isPinCol = pinMap !== undefined && j === 0;
            const col = allCols[j] as { header: string; width: number; centered?: boolean };
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
            x += col.width;
          }
          doc.font('Helvetica');
          doc.rect(tblX, tblY, tblW, actualRowH).stroke(borderColor);
          tblY += actualRowH;
        }
        return tblY;
      };

      const deferredUnmatchedSections: { aisle: string; section: string; entries: any[] }[] = [];

      // Pre-load ALL photos from all sections in one parallel batch
      const t0 = Date.now();
      const allPhotosFlat = sortedSections.flatMap((sec: any) => sec.photos || []);
      const tLoad = Date.now();
      const allLoadedResults = await Promise.all(allPhotosFlat.map((photo: any) => loadPhoto(photo)));
      const photoLayoutMap = new Map<number, PhotoLayout>();
      allPhotosFlat.forEach((photo: any, i: number) => {
        const pl = allLoadedResults[i];
        if (pl) photoLayoutMap.set(photo.id, pl);
      });
      console.log(`[pdf] preloaded ${photoLayoutMap.size}/${allPhotosFlat.length} photos in ${Date.now() - tLoad}ms`);

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

      let tocSecIdx = 0;
      for (const sec of sortedSections) {
        const allPhotos = sec.photos || [];
        const secFootage = sec.entries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
        const secReels = sec.entries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);

        const loadedPhotos: PhotoLayout[] = allPhotos
          .map((photo: any) => photoLayoutMap.get(photo.id))
          .filter((pl: PhotoLayout | undefined): pl is PhotoLayout => pl !== undefined);

        if (loadedPhotos.length === 0 && sec.entries.length === 0) continue;

        const gap = 10;
        const minPhotoH = 120;

        const matchedEntryIds = new Set<number>();
        const photosWithEntries: { pl: PhotoLayout; entries: any[] }[] = [];
        const photosWithoutEntries: PhotoLayout[] = [];

        for (const pl of loadedPhotos) {
          const photoPins = allPinsMap.get(pl.photo.id) || [];
          const pinEntryIds = new Set(photoPins.map((p: any) => p.entryId).filter(Boolean));
          const photoEntries = sec.entries.filter((e: any) => pinEntryIds.has(e.id));
          if (photoEntries.length > 0) {
            const pinLabelForEntry = (e: any) => {
              const pin = photoPins.find((p: any) => p.entryId === e.id);
              return pin?.label ?? 999;
            };
            photoEntries.sort((a: any, b: any) => pinLabelForEntry(a) - pinLabelForEntry(b));
            photosWithEntries.push({ pl, entries: photoEntries });
            photoEntries.forEach((e: any) => matchedEntryIds.add(e.id));
          } else {
            photosWithoutEntries.push(pl);
          }
        }

        const unmatchedEntries = sec.entries.filter((e: any) => !matchedEntryIds.has(e.id));

        if (unmatchedEntries.length > 0) {
          deferredUnmatchedSections.push({ aisle: sec.aisle, section: sec.section, entries: unmatchedEntries });
        }

        const hasPhotoContent = loadedPhotos.length > 0;
        if (!hasPhotoContent && unmatchedEntries.length === sec.entries.length) continue;

        const isReceivingSection = (sec.aisle || "").toLowerCase() === "receiving";

        const detailShotsByParent = new Map<number, { pl: PhotoLayout; entries: any[] }[]>();
        const detailShotsWithoutEntriesByParent = new Map<number, PhotoLayout[]>();

        const compactPhotos: { pl: PhotoLayout; entries: any[] }[] = [];
        const standardPhotos: { pl: PhotoLayout; entries: any[] }[] = [];
        for (const item of photosWithEntries) {
          if (item.pl.photo.isDetailShot && item.pl.photo.parentPhotoId) {
            const parentId = item.pl.photo.parentPhotoId;
            if (!detailShotsByParent.has(parentId)) detailShotsByParent.set(parentId, []);
            detailShotsByParent.get(parentId)!.push(item);
          } else {
            const isCompact = isReceivingSection;
            if (isCompact) {
              compactPhotos.push(item);
            } else {
              standardPhotos.push(item);
            }
          }
        }

        const compactWithoutEntries: PhotoLayout[] = [];
        const standardWithoutEntries: PhotoLayout[] = [];
        for (const pl of photosWithoutEntries) {
          if (pl.photo.isDetailShot && pl.photo.parentPhotoId) {
            const parentId = pl.photo.parentPhotoId;
            if (!detailShotsWithoutEntriesByParent.has(parentId)) detailShotsWithoutEntriesByParent.set(parentId, []);
            detailShotsWithoutEntriesByParent.get(parentId)!.push(pl);
          } else {
            const isCompact = isReceivingSection;
            if (isCompact) {
              compactWithoutEntries.push(pl);
            } else {
              standardWithoutEntries.push(pl);
            }
          }
        }

        const isReceivingCompactSingle = isReceivingSection
          && compactPhotos.length === 1
          && compactWithoutEntries.length === 0
          && standardPhotos.length === 0
          && standardWithoutEntries.length === 0
          && detailShotsByParent.size === 0
          && detailShotsWithoutEntriesByParent.size === 0;

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
        const photoLabel = loadedPhotos.length > 0 ? `${loadedPhotos.length} photo${loadedPhotos.length !== 1 ? "s" : ""}` : undefined;
        drawSectionHeader(sec.aisle, sec.section, sec.entries.length, secReels, secFootage, photoLabel);

        const ensureSpace = (needed: number) => {
          if (currentY + needed > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
            drawSectionHeader(sec.aisle, sec.section, sec.entries.length, secReels, secFootage, undefined, " (Continued)");
          }
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

        const renderDetailShotsForParent = (parentPhotoId: number) => {
          const detailWithEntries = detailShotsByParent.get(parentPhotoId) || [];
          const detailWithout = detailShotsWithoutEntriesByParent.get(parentPhotoId) || [];
          const detailMinH = 90;
          for (const { pl, entries: photoEntries } of detailWithEntries) {
            ensureSpace(detailMinH);
            const availH = Math.min(maxY - currentY, 200);
            const result = renderDetailShotColumnList(pl, photoEntries, tableLeft, currentY, pageWidth, availH);
            currentY += result.renderedH + gap;
          }
          for (const pl of detailWithout) {
            ensureSpace(detailMinH);
            const availH = Math.min(maxY - currentY, 200);
            const result = renderDetailShotColumnList(pl, [], tableLeft, currentY, pageWidth, availH);
            currentY += result.renderedH + gap;
          }
        };

        if (compactPhotos.length > 0) {
          const compactMinH = 80;
          for (const { pl, entries: photoEntries } of compactPhotos) {
            ensureSpace(compactMinH);
            const availH = Math.min(maxY - currentY, 180);
            const result = renderCompactPhotoWithEntries(pl, photoEntries, tableLeft, currentY, pageWidth, availH);
            currentY += result.renderedH + gap;
            renderDetailShotsForParent(pl.photo.id);
          }
        }

        if (compactWithoutEntries.length > 0) {
          let idx = 0;
          while (idx < compactWithoutEntries.length) {
            const remaining = compactWithoutEntries.length - idx;
            const perRow = Math.min(4, remaining);
            const cellW = (pageWidth - gap * (perRow - 1)) / perRow;
            const rowAspects = [];
            for (let c = 0; c < perRow; c++) {
              const pl = compactWithoutEntries[idx + c];
              rowAspects.push(pl.origW / pl.origH);
            }
            const estimatedH = Math.max(...rowAspects.map(a => cellW / a)) + 14;
            ensureSpace(Math.min(estimatedH, 200));
            const availH = maxY - currentY;
            let maxRowH = 0;
            for (let c = 0; c < perRow; c++) {
              const pl = compactWithoutEntries[idx + c];
              const x = tableLeft + c * (cellW + gap);
              const result = renderPhoto(pl, x, currentY, cellW, availH);
              if (result.renderedH > maxRowH) maxRowH = result.renderedH;
            }
            currentY += maxRowH + gap;
            for (let c = 0; c < perRow; c++) {
              renderDetailShotsForParent(compactWithoutEntries[idx + c].photo.id);
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

        for (const item of standardPhotos) {
          ensureSpace(minPhotoH);
          const photoW = pageWidth * 0.45;
          const tblW = pageWidth - photoW - gap;
          const r = renderStandardPhotoAt(item, tableLeft, photoW, tblW, currentY, maxY - currentY);
          currentY = r.bottomY + gap;
          renderDetailShotsForParent(item.pl.photo.id);
        }

        if (standardWithoutEntries.length > 0) {
          let idx = 0;
          while (idx < standardWithoutEntries.length) {
            const remaining = standardWithoutEntries.length - idx;

            if (remaining === 1) {
              ensureSpace(minPhotoH);
              const pl = standardWithoutEntries[idx];
              const maxW = pageWidth * 0.6;
              const availH = maxY - currentY;
              const centeredX = tableLeft + (pageWidth - maxW) / 2;
              const result = renderPhoto(pl, centeredX, currentY, maxW, availH);
              currentY += result.renderedH + gap;
              renderDetailShotsForParent(pl.photo.id);
              idx++;
            } else {
              ensureSpace(minPhotoH);
              const cellW = (pageWidth - gap) / 2;
              const availH = maxY - currentY;
              const photosInRow = Math.min(2, remaining);
              let maxRowH = 0;

              for (let c = 0; c < photosInRow; c++) {
                const pl = standardWithoutEntries[idx + c];
                const x = tableLeft + c * (cellW + gap);
                const result = renderPhoto(pl, x, currentY, cellW, availH);
                if (result.renderedH > maxRowH) maxRowH = result.renderedH;
              }

              currentY += maxRowH + gap;
              for (let c = 0; c < photosInRow; c++) {
                renderDetailShotsForParent(standardWithoutEntries[idx + c].photo.id);
              }
              idx += photosInRow;
            }
          }
        }

        const orphanDetailWithEntries = [...detailShotsByParent.entries()].filter(([parentId]) => !loadedPhotos.some(p => p.photo.id === parentId));
        const orphanDetailWithout = [...detailShotsWithoutEntriesByParent.entries()].filter(([parentId]) => !loadedPhotos.some(p => p.photo.id === parentId));
        for (const [, items] of orphanDetailWithEntries) {
          for (const { pl, entries: photoEntries } of items) {
            ensureSpace(80);
            const availH = Math.min(maxY - currentY, 180);
            const result = renderCompactPhotoWithEntries(pl, photoEntries, tableLeft, currentY, pageWidth, availH);
            currentY += result.renderedH + gap;
          }
        }
        for (const [, items] of orphanDetailWithout) {
          for (const pl of items) {
            ensureSpace(80);
            const availH = Math.min(maxY - currentY, 180);
            const result = renderPhoto(pl, tableLeft, currentY, pageWidth * 0.35, availH);
            currentY += result.renderedH + gap;
          }
        }
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

          const pl = photoLayoutMap.get(item.pin.photoId);
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

          const infoLines: [string, string][] = [
            ["Catalog:", e.reelTag || "Unknown"],
            ["Vendor:", e.manufacturer || "Unknown"],
            ["Reels:", String(e.reelCount || 1)],
            ["Footage:", e.footage ? `${fmtFootage(e.footage)} ${pdfULabel}` : `0 ${pdfULabel}`],
          ];
          if (e.notes) infoLines.push(["Notes:", e.notes]);

          for (const [label, value] of infoLines) {
            doc.font('Helvetica-Bold').fontSize(7).fillColor("#555555")
              .text(label, infoX, infoY, { width: 55, lineBreak: false });
            doc.font('Helvetica').fontSize(7).fillColor("#333333")
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
        const cat = e.reelTag || e.wireType || "Uncataloged";
        const vendor = e.manufacturer || "";
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
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      logActivity(session.id, userId, req.user?.claims?.username, "exported_pdf", "session", session.id);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating PDF:", error);
      if (!res.headersSent) res.status(500).json({ message: "Failed to generate report" });
    } finally {
      taskTracker.decrement();
      taskTracker.endSession(_sid, "pdf");
    }
  });

  // Export session data (authenticated, decrypted)
  app.get("/api/sessions/:id/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const session = access.session;
      const rawEntries = await storage.getSessionEntries(session.id);
      const key = await getEncryptionKey(userId);
      const sessionEntries = key ? rawEntries.map(e => decryptEntry(e, key) as any) : rawEntries;
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
      const userId = resolveUserId(req);
      const access = await verifySessionAccess(parseInt(req.params.id), userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      taskTracker.startSession(_sid, "excel");
      const session = access.session;
      const rawEntries = await storage.getSessionEntries(session.id);
      const key = await getEncryptionKey(userId);
      const sessionEntries = correctEntryFootage(key ? rawEntries.map(e => decryptEntry(e, key) as any) : rawEntries);
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
        const vals = [
          pinLabel, safeStr(e.aisle), safeStr(e.section),
          safeStr(e.reelTag), safeStr(e.manufacturer),
          e.reelCount || 1, xlFmt(e.footage || 0),
          safeStr(e.color),
          safeStr(e.notes),
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
          cell.font = { size: 8.5, color: { argb: isFlagged ? "CC4400" : "333333" } };
          cell.border = thinBorder;
          cell.alignment = { vertical: "middle", wrapText: i === 8, horizontal: centeredCols.has(i) ? "center" : undefined, indent: i === 0 ? 2 : undefined };
          if (i === 0 && pinLabel) cell.font = { size: 8.5, bold: true, color: { argb: accentHex } };
          if (i === 6 && typeof v === "number" && v > 0) cell.numFmt = `#,##0" ${xlULabel}"`;
          if (isFlagged) {
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
        const cat = e.reelTag || e.wireType || "Uncataloged";
        const vendor = e.manufacturer || "";
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
      logActivity(session.id, userId, req.user?.claims?.username, "exported_excel", "session", session.id);
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
      const userId = resolveUserId(req);
      const { firstName, lastName } = req.body;
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
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
      const usage = await storage.getStorageUsageForUser(userId);
      res.json(usage);
    } catch (error) {
      console.error("Error getting storage usage:", error);
      res.status(500).json({ message: "Failed to get storage usage" });
    }
  });

  app.get("/api/storage/global-usage", isAuthenticated, async (req: any, res) => {
    try {
      const replOwner = process.env.REPL_OWNER;
      const username = req.user.claims.username;
      if (!replOwner || username !== replOwner) {
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
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
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
          photoQuality: 85,
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
        };
      res.json(response);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      if (req.user?.isTester) {
        return res.status(403).json({ message: "Testers cannot modify settings" });
      }
      const userId = resolveUserId(req);
      const allowedFields = [
        "defaultExportFormat", "companyName", "exportFooterText",
        "photoQuality", "useReceivingQuality", "receivingPhotoQuality",
        "useOnFloorQuality", "onFloorPhotoQuality",
        "defaultAislePrefix", "sectionAdvanceStep", "defaultUnit",
        "defaultTheme", "thumbnailSize", "largerTouchTargets", "textSize", "timezone",
        "customVendorCodes", "testerPassword",
      ];
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }
      if (updates.testerPassword !== undefined) {
        if (updates.testerPassword && typeof updates.testerPassword === "string" && updates.testerPassword.trim()) {
          updates.testerPassword = await bcrypt.hash(updates.testerPassword.trim(), 10);
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

  app.post("/api/settings/encoding", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const { enabled } = req.body;
      const { db: txDb } = await import("./db");

      const currentSettings = await storage.getUserSettings(userId);
      const allEntries = await storage.getAllUserEntries(userId);

      if (enabled) {
        const salt = generateSalt();
        const dataKey = generateDataKey();
        const kek = deriveKEK(salt);
        const wrappedKey = wrapKey(dataKey, kek);
        const entriesToUpdate = allEntries.map(entry => ({
          id: entry.id,
          data: encryptEntry({
            reelTag: entry.reelTag,
            wireType: entry.wireType,
            gauge: entry.gauge,
            color: entry.color,
            manufacturer: entry.manufacturer,
            notes: entry.notes,
            palletId: entry.palletId,
            position: entry.position,
          }, dataKey),
        }));
        await txDb.transaction(async () => {
          if (entriesToUpdate.length > 0) {
            await storage.bulkUpdateEntries(entriesToUpdate);
          }
          await storage.upsertUserSettings(userId, {
            encodingEnabled: true,
            encryptionKey: wrappedKey,
            encryptionSalt: salt,
          });
        });
        res.json({ success: true, encodingEnabled: true, entriesEncoded: entriesToUpdate.length });
      } else {
        await txDb.transaction(async () => {
          if (currentSettings?.encodingEnabled && currentSettings.encryptionKey && currentSettings.encryptionSalt) {
            const kek = deriveKEK(currentSettings.encryptionSalt);
            const dataKey = unwrapKey(currentSettings.encryptionKey, kek);
            const entriesToUpdate = allEntries.map(entry => ({
              id: entry.id,
              data: decryptEntry({
                reelTag: entry.reelTag,
                wireType: entry.wireType,
                gauge: entry.gauge,
                color: entry.color,
                manufacturer: entry.manufacturer,
                notes: entry.notes,
                palletId: entry.palletId,
                position: entry.position,
              }, dataKey),
            }));
            if (entriesToUpdate.length > 0) {
              await storage.bulkUpdateEntries(entriesToUpdate);
            }
          }
          await storage.upsertUserSettings(userId, {
            encodingEnabled: false,
            encryptionKey: null,
            encryptionSalt: null,
          });
        });
        res.json({ success: true, encodingEnabled: false, entriesDecoded: allEntries.length });
      }
    } catch (error) {
      console.error("Error toggling encoding:", error);
      res.status(500).json({ message: "Failed to toggle encoding" });
    }
  });

  app.get("/api/external/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub, getTesterOwner(req));
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
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req));
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
      const userId = resolveUserId(req);
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req));
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
      const userId = resolveUserId(req);
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      const allComments = await storage.getSessionComments(sessionId);
      res.json(allComments);
    } catch (error) {
      res.status(500).json({ message: "Failed to get comments" });
    }
  });

  app.post("/api/sessions/:id/comments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId, getTesterOwner(req));
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "View-only access" });
      const { text, entryId, photoId, parentCommentId } = req.body;
      if (!text || !text.trim()) return res.status(400).json({ message: "Comment text required" });
      const username = req.user.claims.first_name || req.user.claims.email || userId;
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
      const userId = resolveUserId(req);
      const commentId = parseInt(req.params.id);
      const comment = await storage.getComment(commentId);
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      if (comment.userId !== userId) return res.status(403).json({ message: "Not authorized" });
      const { text } = req.body;
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
      const userId = resolveUserId(req);
      const commentId = parseInt(req.params.id);
      const comment = await storage.getComment(commentId);
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      const access = await verifySessionAccess(comment.sessionId, userId, getTesterOwner(req));
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub, getTesterOwner(req));
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
      const userId = resolveUserId(req);
      const catalogs = await storage.getUserWireCatalogs(userId);
      res.json(catalogs);
    } catch (error) {
      console.error("Error fetching wire catalogs:", error);
      res.status(500).json({ message: "Failed to fetch wire catalogs" });
    }
  });

  app.post("/api/wire-catalogs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = resolveUserId(req);
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
      const userId = resolveUserId(req);
      const { catalogs } = req.body;
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
      const userId = resolveUserId(req);
      await storage.deleteUserWireCatalog(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting wire catalog:", error);
      res.status(500).json({ message: "Failed to delete wire catalog" });
    }
  });

  app.post("/api/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const parsed = insertFeedbackSchema.safeParse({ ...req.body, userId: req.user.id });
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

  app.get("/api/feedback", isAuthenticated, async (req: any, res) => {
    if (req.user.id !== "52270193") {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const rows = await storage.listFeedback();
      return res.json(rows);
    } catch (error) {
      console.error("Error listing feedback:", error);
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

  app.post("/api/help-chat", isAuthenticated, async (req: any, res) => {
    try {
      const { messages } = req.body;
      if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
        return res.status(400).json({ error: "messages must be a non-empty array (max 50)" });
      }

      const validRoles = new Set(["user", "assistant"]);
      const sanitized: { role: "user" | "assistant"; content: string }[] = [];
      for (const m of messages) {
        if (!m || typeof m.content !== "string" || !validRoles.has(m.role)) {
          return res.status(400).json({ error: "Each message must have role (user/assistant) and content (string)" });
        }
        const content = m.content.trim().slice(0, 2000);
        if (!content) {
          return res.status(400).json({ error: "Message content cannot be empty" });
        }
        sanitized.push({ role: m.role as "user" | "assistant", content });
      }

      const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: HELP_SYSTEM_PROMPT },
        ...sanitized,
      ];

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let aborted = false;
      req.on("close", () => { aborted = true; });

      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: chatMessages,
        stream: true,
        max_completion_tokens: 1024,
      });

      for await (const chunk of stream) {
        if (aborted) {
          stream.controller.abort();
          break;
        }
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      if (!aborted) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    } catch (error) {
      console.error("Error in help chat:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to get response" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to get response" });
      }
    }
  });

  // WebSocket
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

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
      if (msg.type === "join" && typeof msg.sessionId === "number") {
        const info = wsUserMap.get(ws)!;
        if (!info.userId) {
          ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
          ws.close(1008, "Authentication required");
          return;
        }
        const access = await verifySessionAccess(msg.sessionId, info.userId);
        if (!access) {
          ws.send(JSON.stringify({ type: "error", message: "Access denied" }));
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
    } catch {}
  };

  wss.on("connection", (ws, req: any) => {
    wsUserMap.set(ws, { sessionId: null, userId: null, username: null, role: null });
    wsAlive.set(ws, true);

    let authDone = false;
    const pendingMessages: (Buffer | string)[] = [];

    sessionParser(req, {} as any, () => {
      passport.initialize()(req, {} as any, () => {
        passport.session()(req, {} as any, () => {
          const user = req.user as any;
          const now = Math.floor(Date.now() / 1000);
          const isAuth = user && user.expires_at && now <= user.expires_at;
          if (!isAuth) {
            ws.send(JSON.stringify({ type: "error", message: "Authentication required" }));
            ws.close(1008, "Authentication required");
            return;
          }
          const connUserId: string = user.isTester
            ? (user.claims?.testerOwnerUserId ?? user.claims?.sub)
            : user.claims?.sub;
          const connUsername: string = user.claims?.username || user.claims?.name || connUserId;
          wsUserMap.set(ws, { sessionId: null, userId: connUserId, username: connUsername, role: null });
          authDone = true;
          for (const buffered of pendingMessages) {
            processWsMessage(ws, buffered);
          }
          pendingMessages.length = 0;
        });
      });
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
      cleanupWs(ws);
    });
  });

  const WS_HEARTBEAT_INTERVAL_MS = 30_000;
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
  wss.on("close", () => { clearInterval(wsGhostPruner); });

  const TRASH_PURGE_INTERVAL_MS = 60 * 60 * 1000;
  const TRASH_MAX_AGE_DAYS = 30;

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
          console.log(`Purged expired trashed session ${session.id} (${session.name})`);
        } catch (err) {
          console.error(`Failed to purge trashed session ${session.id}:`, err);
        }
      }
      if (expiredSessions.length > 0) {
        console.log(`Trash purge complete: ${expiredSessions.length} session(s) permanently deleted`);
      }
    } catch (err) {
      console.error("Trash purge error:", err);
    }
  }

  setInterval(purgeExpiredTrash, TRASH_PURGE_INTERVAL_MS);
  setTimeout(purgeExpiredTrash, 30000);

  return httpServer;
}
