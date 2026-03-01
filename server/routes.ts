import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth";
import { registerAuthRoutes } from "./replit_integrations/auth/routes";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage/routes";
import { objectStorageClient } from "./replit_integrations/object_storage/objectStorage";
import { insertSessionSchema, insertEntrySchema, insertPinSchema, photos, insertFeedbackSchema } from "@shared/schema";
import { db } from "./db";
import { generateSalt, generateDataKey, deriveKEK, wrapKey, unwrapKey, encryptEntry, decryptEntry } from "./encryption";
import multer from "multer";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { randomUUID, randomBytes } from "crypto";
import path from "path";
import fs from "fs/promises";
import { PassThrough } from "stream";

const sessionRooms = new Map<number, Set<WebSocket>>();
const wsUserMap = new Map<WebSocket, { sessionId: number | null; userId: string | null; username: string | null }>();

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
  } catch {}
}

async function verifySessionAccess(sessionId: number, userId: string): Promise<{ session: any; role: "owner" | "editor" | "viewer" } | null> {
  const session = await storage.getSession(sessionId);
  if (!session) return null;
  if (session.userId === userId) return { session, role: "owner" };
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

async function getEncryptionKey(userId: string): Promise<Buffer | null> {
  const settings = await storage.getUserSettings(userId);
  if (!settings?.encodingEnabled || !settings.encryptionKey || !settings.encryptionSalt) return null;
  const kek = deriveKEK(settings.encryptionSalt);
  return unwrapKey(settings.encryptionKey, kek);
}

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

  await setupAuth(app);
  registerAuthRoutes(app);
  registerObjectStorageRoutes(app);

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
      const signRes = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket_name: bucketName,
          object_name: objectName,
          method: "PUT",
          expires_at: new Date(Date.now() + 900_000).toISOString(),
        }),
      });
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

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  app.post("/api/uploads/direct", isAuthenticated, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) {
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
      if (filename.includes("..") || filename.includes("/")) {
        return res.status(400).json({ error: "Invalid filename" });
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
        const [existsInGcs] = await gcsFile.exists();
        if (existsInGcs) {
          res.set(headers);
          gcsFile.createReadStream().pipe(res);
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
      createReadStream(filePath).pipe(res);
    } catch (error) {
      console.error("Error serving file:", error);
      res.status(500).json({ error: "Failed to serve file" });
    }
  });

  // Sessions CRUD
  app.get("/api/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sessions = await storage.getUserSessions(userId);
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
      res.json(sessionsWithStats);
    } catch (error) {
      console.error("Error fetching sessions:", error);
      res.status(500).json({ message: "Failed to fetch sessions" });
    }
  });

  app.post("/api/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const data: any = { ...req.body };
      const isLastPhotoIndexOnly = Object.keys(data).length === 1 && "lastPhotoIndex" in data;
      if (!isLastPhotoIndexOnly && !isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can edit session details" });
      if (data.completedAt) data.completedAt = new Date(data.completedAt);
      else if (data.completedAt === null) data.completedAt = null;
      const updated = await storage.updateSession(access.session.id, data);
      res.json(updated);
    } catch (error: any) {
      console.error("Failed to update session:", error?.message || error);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  app.post("/api/sessions/:id/lock", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can delete sessions" });
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
      res.status(500).json({ message: "Failed to delete session" });
    }
  });

  app.post("/api/sessions/bulk/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { ids, status } = req.body;
      if (!Array.isArray(ids) || !ids.length || !["active", "completed"].includes(status)) {
        return res.status(400).json({ message: "Invalid request" });
      }
      const results = [];
      for (const id of ids) {
        const access = await verifySessionAccess(id, userId);
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
      const userId = req.user.claims.sub;
      const { ids, folderId } = req.body;
      if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({ message: "Invalid request" });
      }
      if (folderId !== null && folderId !== undefined) {
        const folder = await storage.getFolder(folderId);
        if (!folder || folder.userId !== userId) {
          return res.status(404).json({ message: "Folder not found" });
        }
      }
      const results = [];
      for (const id of ids) {
        const access = await verifySessionAccess(id, userId);
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
      const userId = req.user.claims.sub;
      const { ids } = req.body;
      if (!Array.isArray(ids) || !ids.length) {
        return res.status(400).json({ message: "Invalid request" });
      }
      const results = [];
      for (const id of ids) {
        const access = await verifySessionAccess(id, userId);
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
      const userId = req.user.claims.sub;
      const userFolders = await storage.getUserFolders(userId);
      res.json(userFolders);
    } catch (error) {
      res.status(500).json({ message: "Failed to get folders" });
    }
  });

  app.post("/api/folders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const folder = await storage.getFolder(parseInt(req.params.id));
      if (!folder || folder.userId !== userId) return res.status(404).json({ message: "Folder not found" });
      const { name, sortOrder, parentFolderId } = req.body;
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      if (parentFolderId !== undefined) {
        if (parentFolderId !== null) {
          if (parentFolderId === folder.id) return res.status(400).json({ message: "Cannot move folder into itself" });
          const parentFolder = await storage.getFolder(parentFolderId);
          if (!parentFolder || parentFolder.userId !== userId) return res.status(400).json({ message: "Parent folder not found" });
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
      const userId = req.user.claims.sub;
      const folder = await storage.getFolder(parseInt(req.params.id));
      if (!folder || folder.userId !== userId) return res.status(404).json({ message: "Folder not found" });
      await storage.deleteFolder(folder.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });

  app.post("/api/folders/reorder", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { folderIds } = req.body;
      if (!Array.isArray(folderIds)) return res.status(400).json({ message: "folderIds array required" });
      const userFolders = await storage.getUserFolders(userId);
      const ownedIds = new Set(userFolders.map(f => f.id));
      for (let i = 0; i < folderIds.length; i++) {
        if (!ownedIds.has(folderIds[i])) continue;
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
      const userId = req.user.claims.sub;
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session || session.userId !== userId) return res.status(404).json({ message: "Session not found" });
      const { folderId } = req.body;
      if (folderId !== null && folderId !== undefined) {
        const folder = await storage.getFolder(folderId);
        if (!folder || folder.userId !== userId) return res.status(400).json({ message: "Folder not found" });
      }
      const updated = await storage.updateSession(session.id, { folderId: folderId ?? null });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to move session" });
    }
  });

  app.post("/api/sessions/:id/duplicate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const access = await verifySessionAccess(parseInt(req.params.id), userId);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const { folderId } = req.body || {};
      const targetFolderId = folderId ?? access.session.folderId ?? null;
      if (targetFolderId) {
        const folder = await storage.getFolder(targetFolderId);
        if (!folder || folder.userId !== userId) return res.status(400).json({ message: "Invalid folder" });
      }
      const newSession = await storage.duplicateSession(access.session.id, userId, targetFolderId);
      res.json(newSession);
    } catch (error) {
      res.status(500).json({ message: "Failed to duplicate session" });
    }
  });

  app.get("/api/search/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const query = String(req.query.q || "");
      const searchInside = req.query.inside === "true";
      if (!query.trim()) return res.json({ ownedIds: [], sharedIds: [], reasons: {} });
      const result = await storage.searchUserSessions(userId, query, searchInside);
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Search failed" });
    }
  });

  // Photos - all operations verify session access
  app.get("/api/sessions/:sessionId/photos", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.sessionId), req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const photos = await storage.getSessionPhotos(access.session.id);
      res.json(photos);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch photos" });
    }
  });

  app.post("/api/sessions/:sessionId/photos", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId);
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to add photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });
      const displayName = req.user.claims.first_name
        ? `${req.user.claims.first_name} ${req.user.claims.last_name || ""}`.trim()
        : req.user.claims.email || userId;
      const photo = await storage.createPhoto({
        ...req.body,
        sessionId: access.session.id,
        userId,
        uploadedBy: displayName,
      });
      const ext = (req.body.originalFilename || "photo.jpg").match(/\.[^.]+$/)?.[0] || ".jpg";
      const uniqueFilename = `S${access.session.id}_P${String(photo.id).padStart(4, "0")}${ext}`;
      await storage.updatePhoto(photo.id, { originalFilename: uniqueFilename });
      photo.originalFilename = uniqueFilename;
      console.log(`Photo uploaded: id=${photo.id}, by="${displayName}" (${userId}), session=${access.session.id}, filename="${uniqueFilename}", at=${photo.createdAt.toISOString()}`);
      logActivity(access.session.id, userId, displayName, "photo_uploaded", "photo", photo.id, uniqueFilename);
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit photos" });
      const { aisle, section, rotation, notes, isDetailShot, parentPhotoId, pinScale } = req.body;
      const safeUpdate: Record<string, any> = {};
      if (aisle !== undefined) safeUpdate.aisle = aisle;
      if (section !== undefined) safeUpdate.section = section;
      if (rotation !== undefined) safeUpdate.rotation = rotation;
      if (notes !== undefined) safeUpdate.notes = notes;
      if (isDetailShot !== undefined) safeUpdate.isDetailShot = isDetailShot;
      if (parentPhotoId !== undefined) safeUpdate.parentPhotoId = parentPhotoId;
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
      const userId = req.user.claims.sub;
      const original = await storage.getPhoto(parseInt(req.params.id));
      if (!original) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(original.sessionId, userId);
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to duplicate photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });
      const displayName = req.user.claims.name || req.user.claims.username || userId;
      const [newPhoto] = await db.insert(photos).values({
        sessionId:        original.sessionId,
        userId:           userId,
        uploadedBy:       original.uploadedBy,
        objectStorageKey: original.objectStorageKey,
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
        createdAt:        original.createdAt,
      }).returning();
      res.json(newPhoto);
      broadcastToSession(original.sessionId, { type: "sync", entity: "photos", sessionId: original.sessionId });
      logActivity(original.sessionId, userId, displayName, "photo_uploaded", "photo", newPhoto.id, (original.originalFilename || "") + " (duplicate)");
    } catch (error) {
      res.status(500).json({ message: "Failed to duplicate photo" });
    }
  });

  app.delete("/api/photos/:id", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.id));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete photos" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });
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
      await storage.deletePhoto(photo.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete photo" });
    }
  });

  app.get("/api/sessions/:sessionId/pins", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const sessionPins = await storage.getSessionPins(access.session.id);
      res.json(sessionPins);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pins" });
    }
  });

  // Entries CRUD - all operations verify session access + encoding
  app.get("/api/sessions/:sessionId/entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const rawEntries = await storage.getSessionEntries(access.session.id);
      const encKey = isOwner(access.role) ? await getEncryptionKey(userId) : await getEncryptionKey(access.session.userId);
      const result = encKey ? rawEntries.map(e => decryptEntry(e, encKey) as any) : rawEntries;
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch entries" });
    }
  });

  app.post("/api/sessions/:sessionId/entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const access = await verifySessionAccess(parseInt(req.params.sessionId), userId);
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to add entries" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });
      let entryData = { ...req.body, sessionId: access.session.id, userId };
      const encKey = await getEncryptionKey(access.session.userId);
      if (encKey) entryData = encryptEntry(entryData, encKey) as any;
      const data = insertEntrySchema.parse(entryData);
      const entry = await storage.createEntry(data);
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
      const userId = req.user.claims.sub;
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const access = await verifySessionAccess(entry.sessionId, userId);
      if (!access) return res.status(404).json({ message: "Entry not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit entries" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });
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
      res.status(500).json({ message: "Failed to update entry" });
    }
  });

  app.delete("/api/entries/:id", isAuthenticated, async (req: any, res) => {
    try {
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const userId = req.user.claims.sub;
      const access = await verifySessionAccess(entry.sessionId, userId);
      if (!access) return res.status(404).json({ message: "Entry not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete entries" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });
      await storage.deleteEntry(entry.id);
      const username = req.user.claims.first_name || req.user.claims.email || userId;
      logActivity(entry.sessionId, userId, username, "entry_deleted", "entry", entry.id);
      broadcastToSession(entry.sessionId, { type: "sync", entity: "entries", sessionId: entry.sessionId });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete entry" });
    }
  });

  app.get("/api/sessions/:id/incomplete-pins", isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, req.user.claims.sub);
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const flaggedPins = await storage.getSessionFlaggedPins(sessionId);
      const sessionPhotos = await storage.getSessionPhotos(sessionId);
      const photoMap = new Map(sessionPhotos.map(p => [p.id, p]));
      const enriched = flaggedPins.map(pin => {
        const photo = photoMap.get(pin.photoId);
        let photoUrl: string | null = null;
        if (photo?.objectStorageKey) {
          const key = photo.objectStorageKey;
          photoUrl = key.startsWith("/uploads/") ? key : key.startsWith("/objects/") ? key : `/uploads/${key}`;
        }
        return {
          ...pin,
          photoUrl,
          photoFilename: photo?.originalFilename || null,
          photoAisle: photo?.aisle || null,
          photoSection: photo?.section || null,
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
      const access = await verifySessionAccess(entry.sessionId, req.user.claims.sub);
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Pin not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to flag pins" });
      const { flagged } = req.body;
      const updated = await storage.updatePin(pin.id, { flagged: !!flagged });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update pin flag" });
    }
  });

  // Pins - verify access through photo -> session chain
  app.get("/api/photos/:photoId/pins", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.photoId));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to add pins" });
      const lockMsg = checkLocked(access.session, access.role);
      if (lockMsg) return res.status(403).json({ message: lockMsg });
      const data = insertPinSchema.parse({ ...req.body, photoId: photo.id });
      const pin = await storage.createPin(data);
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Pin not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit pins" });
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
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
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
      res.status(500).json({ message: "Failed to delete pin" });
    }
  });

  app.put("/api/photos/:photoId/draft-pins", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.photoId));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to edit pins" });
      { const lockMsg = checkLocked(access.session, access.role); if (lockMsg) return res.status(403).json({ message: lockMsg }); }
      const { pins: pinData } = req.body;
      if (!Array.isArray(pinData)) return res.status(400).json({ message: "pins must be an array" });
      const existing = await storage.getPhotoPins(photo.id);
      const draftIds = existing.filter(p => !p.entryId).map(p => p.id);
      if (draftIds.length > 0) {
        for (const id of draftIds) {
          await storage.deletePin(id);
        }
      }
      const saved = [];
      for (const p of pinData) {
        const pin = await storage.createPin({
          photoId: photo.id,
          xPercent: p.xPercent,
          yPercent: p.yPercent,
          label: p.label || null,
          reelCount: p.reelCount || 1,
          wireDetails: p.wireDetails || null,
          vendorCode: p.vendorCode || null,
          footage: p.footage || null,
          flagged: p.flagged || false,
        });
        saved.push(pin);
      }
      res.json(saved);
    } catch (error) {
      console.error("Error saving draft pins:", error);
      res.status(500).json({ message: "Failed to save draft pins" });
    }
  });

  app.delete("/api/pins/:pinId", isAuthenticated, async (req: any, res) => {
    try {
      const pin = await storage.getPin(parseInt(req.params.pinId));
      if (!pin) return res.status(404).json({ message: "Pin not found" });
      const photo = await storage.getPhoto(pin.photoId);
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const collaborators = await storage.getSessionCollaborators(access.session.id);
      res.json({ collaborators, owner: { userId: access.session.userId } });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch collaborators" });
    }
  });

  app.post("/api/sessions/:id/collaborators", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
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
      res.json(collaborator);
    } catch (error) {
      console.error("Error adding collaborator:", error);
      res.status(500).json({ message: "Failed to add collaborator" });
    }
  });

  app.delete("/api/sessions/:id/collaborators/:collabId", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can remove collaborators" });
      await storage.removeCollaborator(parseInt(req.params.collabId));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove collaborator" });
    }
  });

  app.patch("/api/sessions/:id/collaborators/:collabId", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can change roles" });
      const { role } = req.body;
      if (!role || !["editor", "viewer"].includes(role)) return res.status(400).json({ message: "Role must be editor or viewer" });
      const updated = await storage.updateCollaboratorRole(parseInt(req.params.collabId), role);
      if (!updated) return res.status(404).json({ message: "Collaborator not found" });
      await logActivity(access.session.id, req.user.claims.sub, req.user.claims.username, "changed_role", "collaborator", updated.id, `Changed to ${role}`);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update collaborator role" });
    }
  });

  app.post("/api/sessions/:id/transfer-ownership", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
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
      const userId = req.user.claims.sub;
      const sessionId = parseInt(req.params.id);
      await storage.removeCollaboratorBySessionAndUser(sessionId, userId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to leave session" });
    }
  });

  // Invite links
  app.get("/api/sessions/:id/invite-links", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
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
      const access = await verifySessionAccess(link.sessionId, req.user.claims.sub);
      if (!access || !isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can revoke invite links" });
      await storage.revokeInviteLink(link.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to revoke invite link" });
    }
  });

  // Join via invite token
  app.post("/api/join/:token", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  app.get("/api/sessions/:id/export/pdf", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const access = await verifySessionAccess(parseInt(req.params.id), userId);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const session = access.session;
      const rawEntries = await storage.getSessionEntries(session.id);
      const key = await getEncryptionKey(userId);
      const sessionEntries = key ? rawEntries.map(e => decryptEntry(e, key) as any) : rawEntries;
      const totalFootage = sessionEntries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
      const generatedAt = new Date().toISOString();
      const photoStats = await storage.getSessionPhotoStats([session.id]);
      const pt = photoStats.get(session.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
      const sessionPhotos = await storage.getSessionPhotos(session.id);
      const photoMap = new Map(sessionPhotos.map(p => [p.id, p]));

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

      const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36, bufferPages: true });
      const filename = buildExportFilename("pdf");
      const bufferStream = new PassThrough();
      const pdfChunks: Buffer[] = [];
      bufferStream.on("data", (chunk: Buffer) => pdfChunks.push(chunk));
      doc.pipe(bufferStream);

      const companyName = typeof req.query.companyName === "string" ? req.query.companyName : null;
      const footerText = typeof req.query.footerText === "string" ? req.query.footerText : null;

      const accentHex = "#ea580c";
      const headerBg = "#f5f0eb";
      const borderColor = "#cccccc";

      let titleY = 36;
      if (companyName) {
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
      const coverLabelColor = "#888888";
      const coverValueColor = "#222222";
      const totalReels = (sessionEntries as any[]).reduce((s: number, e: any) => s + (e.reelCount || 1), 0);

      const coverRows: [string, string][] = [
        ["Location:", session.location || "N/A"],
        ["Status:", (session.status.charAt(0).toUpperCase() + session.status.slice(1))],
        ["Entries:", sessionEntries.length.toLocaleString()],
        ["Total Reels:", totalReels.toLocaleString()],
        ["Total Footage:", `${totalFootage.toLocaleString()} ft`],
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
          if (totalMin < 60) { elapsedStr = `${totalMin}m`; }
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
          const tocLabel = `Aisle ${sec.aisle || "—"} / Section ${sec.section || "—"} — ${sec.entries.length} entries, ${secReels} reels, ${secFootage.toLocaleString()} ft`;
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
        { header: "Vendor:", width: 70 },
        { header: "Category:", width: 110 },
        { header: "# of Reels:", width: 45 },
        { header: "Total Footage:", width: 65 },
        { header: "Notes:", width: 110 },
      ];

      const scaleSecCols = (tblW: number) => {
        const secTotalW = secEntryCols.reduce((s, c) => s + c.width, 0);
        const secScale = tblW / secTotalW;
        return secEntryCols.map(c => ({ ...c, width: Math.floor(c.width * secScale) }));
      };

      const drawSecEntryHeader = (y: number, tblX: number, tblW: number, cols: { header: string; width: number }[]) => {
        doc.rect(tblX, y, tblW, headerHeight).fill(headerBg);
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor("#333333");
        let x = tblX;
        for (const col of cols) {
          doc.text(col.header, x + 2, y + 4, { width: col.width - 4, lineBreak: false });
          const tw = doc.widthOfString(col.header);
          doc.save().moveTo(x + 2, y + 13).lineTo(x + 2 + tw, y + 13).lineWidth(0.4).strokeColor("#333333").stroke().restore();
          x += col.width;
        }
        doc.font('Helvetica');
        doc.rect(tblX, y, tblW, headerHeight).stroke(borderColor);
        return y + headerHeight;
      };

      const drawCommittedPin = (pin: any, imgX: number, imgY: number, imgW: number, imgH: number, _imgOrigW: number, pinScale: number) => {
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
          .strokeColor(accentHex)
          .lineWidth(borderW)
          .stroke();

        if (pin.label) {
          const labelFontSize = Math.max(4, 10 * sf);
          const labelPadX = Math.max(1, 3 * sf);
          const labelPadY = Math.max(0.5, 1 * sf);
          const tabCornerR = Math.max(0.5, 3 * sf);

          const labelText = `P${pin.label}`;
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
            .fill(accentHex);
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
              .fill(accentHex);
            doc.fillColor("#ffffff").fontSize(labelFontSize)
              .text(badgeText, badgeX + labelPadX, tabY + labelPadY, { lineBreak: false });
            doc.restore();
          }
          doc.restore();
          doc.font('Helvetica');
        }
        doc.restore();
      };

      type PhotoLayout = { photo: any; buffer: Buffer; imgW: number; imgH: number; origW: number; origH: number };
      const loadPhoto = async (photo: any): Promise<PhotoLayout | null> => {
        const photoKey = photo.objectStorageKey;
        const photoFilename = photoKey.replace("/uploads/", "");
        const photoPath = path.join(UPLOADS_DIR, photoFilename);
        try {
          let rawBuffer: Buffer;
          let loadedFromGcs = false;
          try {
            const gcsFile = objectStorageClient.bucket(BUCKET_NAME).file(toStorageObjectName(photoKey));
            const [existsInGcs] = await gcsFile.exists();
            if (existsInGcs) {
              const [downloaded] = await gcsFile.download();
              rawBuffer = downloaded;
              loadedFromGcs = true;
            }
          } catch {
            // GCS unavailable (e.g. dev environment) — fall through to local disk
          }
          if (!loadedFromGcs) {
            rawBuffer = await fs.readFile(photoPath);
          }
          const { data: orientedBuffer, info } = await sharp(rawBuffer!)
            .rotate()
            .resize(1600, 1200, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 82 })
            .toBuffer({ resolveWithObject: true });
          const img = doc.openImage(orientedBuffer);
          return { photo, buffer: orientedBuffer, imgW: img.width, imgH: img.height, origW: info.width, origH: info.height };
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
          drawCommittedPin(pin, imgX, y, w, h, pl.origW, pinScale);
        }

        doc.rect(imgX, y, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();

        const photoName = pl.photo.originalFilename || `Photo ${pl.photo.id}`;
        const reelTotal = photoEntries
          ? photoEntries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0)
          : photoPins.reduce((s: number, p: any) => s + (p.reelCount || 1), 0);
        const captionParts: string[] = [photoName];
        if (pl.photo.aisle || pl.photo.section) {
          captionParts.push(`Aisle ${pl.photo.aisle || "—"}, Sec ${pl.photo.section || "—"}`);
        }
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
          drawCommittedPin(pin, x, y, w, h, pl.origW, pinScale);
        }
        doc.rect(x, y, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();

        const photoName = pl.photo.originalFilename || `Photo ${pl.photo.id}`;
        const reelTotal = entries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);
        const compactCaptionParts: string[] = [photoName];
        if (pl.photo.aisle || pl.photo.section) {
          compactCaptionParts.push(`Aisle ${pl.photo.aisle || "—"}, Sec ${pl.photo.section || "—"}`);
        }
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
          const header = pinLabel ? `P${String(pinLabel).padStart(3, "0")} — ${e.reelTag || e.wireType || "Entry"}` : (e.reelTag || e.wireType || "Entry");
          entryLines.push({ text: header, fontSize: 6.5, color: accentHex, font: 'Helvetica-Bold', indent: false });

          const details: string[] = [];
          if (e.manufacturer) details.push(`Vendor: ${e.manufacturer}`);
          if (e.reelCount && e.reelCount > 1) details.push(`Reels: ${e.reelCount}`);
          if (e.footage) details.push(`Footage: ${e.footage.toLocaleString()} ft`);
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

      const drawSectionHeader = (aisle: string, section: string, entryCount: number, reelCount: number, footage: number, photoLabel?: string) => {
        doc.rect(tableLeft, currentY, pageWidth, 22).fill("#e8e0d8");
        doc.fontSize(11).fillColor(accentHex).text(
          `Aisle ${aisle || "—"}  /  Section ${section || "—"}`,
          tableLeft + 6, currentY + 4, { width: pageWidth - 100, lineBreak: false }
        );
        doc.fontSize(7).fillColor("#666666").text(
          `${entryCount} entries  |  ${reelCount} reels  |  ${footage.toLocaleString()} ft`,
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
            e.manufacturer || "",
            e.reelTag || "",
            String(e.reelCount || 1),
            e.footage ? `${e.footage.toLocaleString()} ft` : "",
            notesText,
          ];
          const vals = pinMap
            ? [pinMap.get(e.id) || "", ...baseVals]
            : baseVals;
          for (let j = 0; j < allCols.length; j++) {
            const isNotesCol = j === notesColIdx;
            if (isNotesCol) {
              doc.text(vals[j], x + 2, tblY + 3, { width: allCols[j].width - 4, lineBreak: true, height: actualRowH - 4 });
            } else {
              doc.text(vals[j], x + 2, tblY + 3, { width: allCols[j].width - 4, lineBreak: false });
            }
            x += allCols[j].width;
          }
          doc.font('Helvetica');
          doc.rect(tblX, tblY, tblW, actualRowH).stroke(borderColor);
          tblY += actualRowH;
        }
        return tblY;
      };

      const deferredUnmatchedSections: { aisle: string; section: string; entries: any[] }[] = [];

      let tocSecIdx = 0;
      for (const sec of sortedSections) {
        const allPhotos = sec.photos || [];
        const secFootage = sec.entries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
        const secReels = sec.entries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);

        const loadedPhotos: PhotoLayout[] = (
          await Promise.all(allPhotos.map((photo: any) => loadPhoto(photo)))
        ).filter((pl): pl is PhotoLayout => pl !== null);

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

        doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
        doc.addNamedDestination(`sec-${tocSecIdx}`);
        tocSecIdx++;
        currentY = 36;
        const photoLabel = loadedPhotos.length > 0 ? `${loadedPhotos.length} photo${loadedPhotos.length !== 1 ? "s" : ""}` : undefined;
        drawSectionHeader(sec.aisle, sec.section, sec.entries.length, secReels, secFootage, photoLabel);

        const ensureSpace = (needed: number) => {
          if (currentY + needed > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
            drawSectionHeader(sec.aisle, sec.section, sec.entries.length, secReels, secFootage, `(cont.)`);
          }
        };

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

        const renderDetailShotColumnList = (pl: PhotoLayout, photoEntries: any[], x: number, y: number, maxW: number, maxH: number) => {
          const imgW = Math.min(maxW * 0.38, 220);
          const captionH = 10;
          const aspect = pl.origW / pl.origH;
          let w = imgW;
          let h = imgW / aspect;
          const availImgH = maxH - captionH;
          if (h > availImgH) { h = availImgH; w = h * aspect; if (w > imgW) { w = imgW; h = imgW / aspect; } }

          doc.image(pl.buffer, x, y, { width: w, height: h });
          const photoPins = allPinsMap.get(pl.photo.id) || [];
          const pinScale = pl.photo.pinScale || 1;
          for (const pin of photoPins) {
            drawCommittedPin(pin, x, y, w, h, pl.origW, pinScale);
          }
          doc.rect(x, y, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();

          const photoName = pl.photo.originalFilename || `Photo ${pl.photo.id}`;
          const reelTotal = photoEntries.length > 0 ? photoEntries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0) : photoPins.reduce((s: number, p: any) => s + (p.reelCount || 1), 0);
          const capParts: string[] = [photoName];
          if (pl.photo.aisle || pl.photo.section) capParts.push(`Aisle ${pl.photo.aisle || "—"}, Sec ${pl.photo.section || "—"}`);
          capParts.push(`${reelTotal} reel${reelTotal !== 1 ? "s" : ""}`);
          if (pl.photo.createdAt) capParts.push(formatCT(new Date(pl.photo.createdAt)));
          doc.font('Helvetica').fontSize(5.5).fillColor("#666666")
            .text(capParts.join("  |  "), x, y + h + 1, { width: w, align: "center", lineBreak: false });

          const listX = x + w + 10;
          const listW = maxW - w - 10;
          let listY = y;
          const fieldLineH = 10;
          const entryGap = 6;
          const fieldLabelW = 72;
          const fieldValueX = listX + fieldLabelW;
          const fieldValueW = listW - fieldLabelW;

          for (const e of photoEntries) {
            const pinLabel = photoPins.find((p: any) => p.entryId === e.id)?.label;
            const fields: [string, string][] = [
              ["Pin #:", pinLabel ? String(pinLabel).padStart(3, "0") : "—"],
              ["Category:", e.reelTag || e.wireType || "—"],
              ["Vendor Code:", e.manufacturer || "—"],
              ["# of Reels:", String(e.reelCount || 1)],
              ["Total Footage:", e.footage ? `${e.footage.toLocaleString()} ft` : "—"],
              ["Notes:", e.notes || "—"],
            ];
            const entryH = fields.length * fieldLineH + entryGap;
            if (listY + entryH > y + maxH) break;
            for (const [label, value] of fields) {
              doc.font('Helvetica-Bold').fontSize(6).fillColor("#666666")
                .text(label, listX, listY, { width: fieldLabelW, lineBreak: false });
              doc.font('Helvetica').fontSize(6).fillColor("#222222")
                .text(value, fieldValueX, listY, { width: fieldValueW, lineBreak: false });
              listY += fieldLineH;
            }
            listY += entryGap;
            if (photoEntries.indexOf(e) < photoEntries.length - 1) {
              doc.moveTo(listX, listY - entryGap / 2).lineTo(listX + listW, listY - entryGap / 2)
                .lineWidth(0.3).strokeColor("#dddddd").stroke();
            }
          }

          const totalH = Math.max(h + captionH, listY - y);
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

        for (const { pl, entries: photoEntries } of standardPhotos) {
          ensureSpace(minPhotoH);
          const availH = maxY - currentY;
          const photoW = pageWidth * 0.45;
          const result = renderPhoto(pl, tableLeft, currentY, photoW, availH, photoEntries);

          const tblX = tableLeft + photoW + gap;
          const tblW = pageWidth - photoW - gap;
          let tblEndY = currentY;
          if (photoEntries.length > 0) {
            const photoPins = allPinsMap.get(pl.photo.id) || [];
            const entryPinMap = new Map<number, string>();
            for (const pin of photoPins) {
              if (pin.entryId && pin.label) {
                entryPinMap.set(pin.entryId, `P${String(pin.label).padStart(3, "0")}`);
              }
            }
            tblEndY = drawEntriesTable(photoEntries, tblX, tblW, currentY, 5.5, 14, entryPinMap.size > 0 ? entryPinMap : undefined);
          }

          const photoEndY = currentY + result.renderedH;
          currentY = Math.max(photoEndY, tblEndY) + gap;
          renderDetailShotsForParent(pl.photo.id);
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
            `${ums.entries.length} entries  |  ${unmatchedReels} reels  |  ${unmatchedFootage.toLocaleString()} ft`,
            tableLeft + pageWidth - 220, currentY + 6, { width: 210, align: "right", lineBreak: false }
          );
          doc.rect(tableLeft, currentY, pageWidth, 22).stroke(borderColor);
          currentY += 26;
          const afterTable = drawEntriesTable(ums.entries, tableLeft, pageWidth, currentY, 6.5, rowHeight);
          currentY = afterTable + 12;
        }
      }

      // --- Summary Totals Page ---
      doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
      currentY = 36;

      doc.fontSize(18).fillColor(accentHex).text("Summary Totals", 36, currentY);
      currentY += 24;
      doc.fontSize(9).fillColor("#666666").text(`${session.name}  |  ${session.location || "N/A"}  |  ${sessionEntries.length} entries  |  ${totalFootage.toLocaleString()} ft total`, 36, currentY);
      currentY += 20;

      const entryPinLabelMap = new Map<number, string>();
      for (const [, pins] of allPinsMap) {
        for (const pin of pins) {
          if (pin.entryId && pin.label) {
            entryPinLabelMap.set(pin.entryId, `P${String(pin.label).padStart(3, "0")}`);
          }
        }
      }

      const categoryMap = new Map<string, { vendorCode: string; totalFootage: number; reelCount: number; locations: string[] }>();
      for (const e of sessionEntries as any[]) {
        const cat = e.reelTag || e.wireType || "Uncategorized";
        const vendor = e.manufacturer || "";
        const groupKey = `${cat}|||${vendor}`;
        const existing = categoryMap.get(groupKey);
        const pinLabel = entryPinLabelMap.get(e.id);
        const locParts = [e.aisle, e.section, pinLabel].filter(Boolean);
        const loc = locParts.join("-");
        if (existing) {
          existing.totalFootage += (e.footage || 0);
          existing.reelCount += (e.reelCount || 1);
          if (loc) existing.locations.push(loc);
        } else {
          categoryMap.set(groupKey, {
            vendorCode: vendor,
            totalFootage: e.footage || 0,
            reelCount: e.reelCount || 1,
            locations: loc ? [loc] : [],
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
        return cat.replace(/\d+$/, "");
      };

      const allCategories = Array.from(categoryMap.entries())
        .map(([groupKey, data]) => {
          const category = groupKey.split("|||")[0];
          return { category, wireTypeGroup: extractWireType(category), reelSizeIdx: extractReelSize(category), ...data };
        });

      const wireTypePriority = (wireType: string, vendor: string): number => {
        const wt = wireType.toUpperCase().trim();
        const v = vendor.toUpperCase().trim();
        if (wt === "THHN" && v === "COP") return 0;
        if (wt === "XHHW" && v === "ALU") return 1;
        return 2;
      };
      allCategories.sort((a, b) => {
        const pa = wireTypePriority(a.wireTypeGroup, a.vendorCode);
        const pb = wireTypePriority(b.wireTypeGroup, b.vendorCode);
        if (pa !== pb) return pa - pb;
        if (a.wireTypeGroup < b.wireTypeGroup) return -1;
        if (a.wireTypeGroup > b.wireTypeGroup) return 1;
        return a.reelSizeIdx - b.reelSizeIdx;
      });

      const sortedCategories = allCategories;

      const groupReelCounts = new Map<string, number>();
      for (const cat of sortedCategories) {
        const g = cat.wireTypeGroup;
        groupReelCounts.set(g, (groupReelCounts.get(g) || 0) + cat.reelCount);
      }

      const sumCols = [
        { header: "Category:", width: 140, align: "left" as const },
        { header: "Vendor Code:", width: 100, align: "center" as const },
        { header: "# of Reels:", width: 50, align: "center" as const },
        { header: "Total Footage:", width: 80, align: "center" as const },
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
      for (let i = 0; i < sortedCategories.length; i++) {
        const rowH = 16;
        const cat = sortedCategories[i];

        if (cat.wireTypeGroup !== lastWireTypeGroup) {
          const groupH = 18;
          if (currentY + groupH + rowH > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = drawSumHeader(36);
          }
          doc.rect(tableLeft, currentY, pageWidth, groupH).fill("#e8e0d8");
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor(accentHex).text(cat.wireTypeGroup || "Other", tableLeft + 6, currentY + 5, { width: pageWidth - 160, lineBreak: false });
          const groupCount = groupReelCounts.get(cat.wireTypeGroup) || 0;
          doc.fontSize(7.5).fillColor(accentHex).text(
            `${groupCount} reels`,
            tableLeft + pageWidth - 150, currentY + 5, { width: 140, align: "right", lineBreak: false }
          );
          doc.font('Helvetica');
          doc.rect(tableLeft, currentY, pageWidth, groupH).stroke(borderColor);
          currentY += groupH;
          lastWireTypeGroup = cat.wireTypeGroup;
          altIdx = 0;
        }

        if (currentY + rowH > maxY) {
          doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
          currentY = drawSumHeader(36);
        }
        if (altIdx % 2 === 1) doc.rect(tableLeft, currentY, pageWidth, rowH).fill("#fafaf8");
        doc.fontSize(6.5).fillColor("#333333");
        let x = tableLeft;
        const vals = [
          `    ${cat.category}`,
          cat.vendorCode,
          String(cat.reelCount),
          `${cat.totalFootage.toLocaleString()} ft`,
          cat.locations.join(", "),
        ];
        const aligns: ("left" | "center")[] = ["left", "center", "center", "center", "left"];
        for (let j = 0; j < sumScaled.length; j++) {
          if (j === 3) doc.font('Helvetica-Bold');
          doc.text(vals[j], x + 3, currentY + 4, { width: sumScaled[j].width - 6, lineBreak: false, align: aligns[j] });
          if (j === 3) doc.font('Helvetica');
          x += sumScaled[j].width;
        }
        doc.rect(tableLeft, currentY, pageWidth, rowH).stroke(borderColor);
        currentY += rowH;
        altIdx++;
      }

      currentY += 6;
      doc.rect(tableLeft, currentY, pageWidth, rowHeight).fill(headerBg);
      doc.font('Helvetica-Bold').fontSize(7).fillColor("#333333");
      let tx = tableLeft;
      const totalVals = ["GRAND TOTAL", "", String(sortedCategories.reduce((s, c) => s + c.reelCount, 0)), `${totalFootage.toLocaleString()} ft`, `${sortedCategories.length} categories`];
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
        doc.font('Helvetica').fontSize(7).fillColor("#666666");
        const labelW = doc.widthOfString(label);
        doc.text(label, 36, currentY, { lineBreak: false });
        doc.save().moveTo(36, currentY + 8).lineTo(36 + labelW, currentY + 8).lineWidth(0.4).strokeColor("#666666").stroke().restore();
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
      auditLabel("Entry Count:", String(sessionEntries.length));
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

      const pageCount = doc.bufferedPageRange().count;

      // --- Page Numbers (using buffered pages) ---
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        doc.fontSize(6).fillColor("#999999");
        doc.text(session.name, 36, doc.page.height - 30, { width: pageWidth / 2, lineBreak: false });
        doc.text(`Page ${i + 1} of ${pageCount}`, 36 + pageWidth / 2, doc.page.height - 30, { width: pageWidth / 2, align: 'right', lineBreak: false });
      }

      doc.end();

      await new Promise<void>((resolve, reject) => {
        bufferStream.on("finish", resolve);
        bufferStream.on("error", reject);
      });

      const pdfBuffer = Buffer.concat(pdfChunks);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("Error generating PDF:", error);
      if (!res.headersSent) res.status(500).json({ message: "Failed to generate report" });
    }
  });

  // Export session data (authenticated, decrypted)
  app.get("/api/sessions/:id/export", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const access = await verifySessionAccess(parseInt(req.params.id), userId);
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

  // Update user profile name
  app.patch("/api/user/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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
      if (!req.file) return res.status(400).json({ message: "No file provided" });
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
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

  // User Settings
  app.get("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const settings = await storage.getUserSettings(userId);
      res.json(settings || {
        userId,
        encodingEnabled: false,
        defaultExportFormat: "pdf",
        companyName: null,
        companyLogoKey: null,
        exportFooterText: null,
        photoQuality: 85,
        useReceivingQuality: false,
        receivingPhotoQuality: 50,
        defaultAislePrefix: null,
        sectionAdvanceStep: 1,
        defaultUnit: "feet",
        defaultTheme: "system",
        thumbnailSize: "medium",
        largerTouchTargets: false,
        textSize: "default",
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const allowedFields = [
        "defaultExportFormat", "companyName", "companyLogoKey", "exportFooterText",
        "photoQuality", "useReceivingQuality", "receivingPhotoQuality",
        "defaultAislePrefix", "sectionAdvanceStep", "defaultUnit",
        "defaultTheme", "thumbnailSize", "largerTouchTargets", "textSize", "timezone",
      ];
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
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
      const userId = req.user.claims.sub;
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
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
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
      const userId = req.user.claims.sub;
      const stats = await storage.getUserStats(userId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to get stats" });
    }
  });

  // Activity logs
  app.get("/api/sessions/:id/activity", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const logs = await storage.getSessionActivityLogs(sessionId, limit, offset);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to get activity logs" });
    }
  });

  // Comments
  app.get("/api/sessions/:id/comments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const allComments = await storage.getSessionComments(sessionId);
      res.json(allComments);
    } catch (error) {
      res.status(500).json({ message: "Failed to get comments" });
    }
  });

  app.post("/api/sessions/:id/comments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sessionId = parseInt(req.params.id);
      const access = await verifySessionAccess(sessionId, userId);
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
      const userId = req.user.claims.sub;
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
      const userId = req.user.claims.sub;
      const commentId = parseInt(req.params.id);
      const comment = await storage.getComment(commentId);
      if (!comment) return res.status(404).json({ message: "Comment not found" });
      const access = await verifySessionAccess(comment.sessionId, userId);
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
      const access = await verifySessionAccess(sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Session not found" });
      const users = getOnlineUsers(sessionId);
      res.json(users);
    } catch {
      res.json([]);
    }
  });

  // Feedback
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

  // WebSocket
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    wsUserMap.set(ws, { sessionId: null, userId: null, username: null });

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "join" && typeof msg.sessionId === "number") {
          if (msg.userId) {
            const access = await verifySessionAccess(msg.sessionId, msg.userId);
            if (!access) {
              ws.send(JSON.stringify({ type: "error", message: "Access denied" }));
              return;
            }
          }
          const info = wsUserMap.get(ws)!;
          const prevSessionId = info.sessionId;
          if (prevSessionId !== null) {
            const prev = sessionRooms.get(prevSessionId);
            if (prev) { prev.delete(ws); if (prev.size === 0) sessionRooms.delete(prevSessionId); }
            broadcastPresence(prevSessionId);
          }
          info.sessionId = msg.sessionId;
          info.userId = msg.userId || null;
          info.username = msg.username || null;
          if (!sessionRooms.has(msg.sessionId)) sessionRooms.set(msg.sessionId, new Set());
          sessionRooms.get(msg.sessionId)!.add(ws);
          ws.send(JSON.stringify({ type: "joined", sessionId: msg.sessionId }));
          broadcastPresence(msg.sessionId);
        }
      } catch {}
    });

    ws.on("close", () => {
      const info = wsUserMap.get(ws);
      if (info?.sessionId !== null && info?.sessionId !== undefined) {
        const room = sessionRooms.get(info.sessionId);
        if (room) { room.delete(ws); if (room.size === 0) sessionRooms.delete(info.sessionId); }
        broadcastPresence(info.sessionId);
      }
      wsUserMap.delete(ws);
    });
  });

  return httpServer;
}
