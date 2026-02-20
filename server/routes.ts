import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth";
import { registerAuthRoutes } from "./replit_integrations/auth/routes";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage/routes";
import { insertSessionSchema, insertEntrySchema, insertPinSchema } from "@shared/schema";
import { generateSalt, generateDataKey, deriveKEK, wrapKey, unwrapKey, encryptEntry, decryptEntry } from "./encryption";
import multer from "multer";
import PDFDocument from "pdfkit";
import { randomUUID, randomBytes } from "crypto";
import path from "path";
import fs from "fs/promises";

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

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  app.post("/api/uploads/direct", isAuthenticated, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      await fs.mkdir(UPLOADS_DIR, { recursive: true });

      const ext = path.extname(req.file.originalname) || "";
      const objectId = `${randomUUID()}${ext}`;
      const filePath = path.join(UPLOADS_DIR, objectId);

      await fs.writeFile(filePath, req.file.buffer);

      const objectPath = `/uploads/${objectId}`;
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
      const filePath = path.join(UPLOADS_DIR, filename);
      try {
        await fs.access(filePath);
      } catch {
        return res.status(404).json({ error: "File not found" });
      }
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic",
        ".heif": "image/heif", ".bmp": "image/bmp", ".tiff": "image/tiff",
      };
      res.set({
        "Content-Type": mimeTypes[ext] || "application/octet-stream",
        "Cache-Control": "private, max-age=86400",
      });
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
      const [stats, photoStats] = await Promise.all([
        storage.getSessionStats(sessionIds),
        storage.getSessionPhotoStats(sessionIds),
      ]);
      const sessionsWithStats = sessions.map(s => {
        const st = stats.get(s.id) || { entryCount: 0, totalFootage: 0, sectionCount: 0 };
        const ps = photoStats.get(s.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
        return { ...s, ...st, ...ps };
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
      const [stats, photoStats] = await Promise.all([
        storage.getSessionStats(sessionIds),
        storage.getSessionPhotoStats(sessionIds),
      ]);
      const result = sharedSessions.map(s => {
        const st = stats.get(s.id) || { entryCount: 0, totalFootage: 0, sectionCount: 0 };
        const ps = photoStats.get(s.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
        return { ...s, ...st, ...ps };
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
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can edit session details" });
      const data: any = { ...req.body };
      if (data.completedAt) data.completedAt = new Date(data.completedAt);
      else if (data.completedAt === null) data.completedAt = null;
      const updated = await storage.updateSession(access.session.id, data);
      res.json(updated);
    } catch (error: any) {
      console.error("Failed to update session:", error?.message || error);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  app.delete("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const access = await verifySessionAccess(parseInt(req.params.id), req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Session not found" });
      if (!isOwner(access.role)) return res.status(403).json({ message: "Only the session owner can delete sessions" });
      await storage.deleteSession(access.session.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete session" });
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
      const displayName = req.user.claims.first_name
        ? `${req.user.claims.first_name} ${req.user.claims.last_name || ""}`.trim()
        : req.user.claims.email || userId;
      const photo = await storage.createPhoto({
        ...req.body,
        sessionId: access.session.id,
        userId,
        uploadedBy: displayName,
      });
      console.log(`Photo uploaded: id=${photo.id}, by="${displayName}" (${userId}), session=${access.session.id}, at=${photo.createdAt.toISOString()}`);
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
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update photo" });
    }
  });

  app.delete("/api/photos/:id", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.id));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const access = await verifySessionAccess(photo.sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Photo not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete photos" });
      try {
        const key = photo.objectStorageKey;
        const filename = key.startsWith("/uploads/") ? key.slice("/uploads/".length) : key.replace(/^\/objects\/uploads\//, "");
        const filePath = path.join(UPLOADS_DIR, filename);
        await fs.unlink(filePath);
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
      let entryData = { ...req.body, sessionId: access.session.id, userId };
      const encKey = await getEncryptionKey(access.session.userId);
      if (encKey) entryData = encryptEntry(entryData, encKey) as any;
      const data = insertEntrySchema.parse(entryData);
      const entry = await storage.createEntry(data);
      await storage.updateSession(access.session.id, {});
      const result = encKey ? decryptEntry(entry, encKey) : entry;
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
      const encKey = await getEncryptionKey(access.session.userId);
      let updateData = req.body;
      if (encKey) updateData = encryptEntry(updateData, encKey) as any;
      const updated = await storage.updateEntry(entry.id, updateData);
      const result = encKey && updated ? decryptEntry(updated, encKey) : updated;
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to update entry" });
    }
  });

  app.delete("/api/entries/:id", isAuthenticated, async (req: any, res) => {
    try {
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const access = await verifySessionAccess(entry.sessionId, req.user.claims.sub);
      if (!access) return res.status(404).json({ message: "Entry not found" });
      if (!canEdit(access.role)) return res.status(403).json({ message: "You don't have permission to delete entries" });
      await storage.deleteEntry(entry.id);
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
      const data = insertPinSchema.parse({ ...req.body, photoId: photo.id });
      const pin = await storage.createPin(data);
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
      const updated = await storage.updatePin(pin.id, req.body);
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
        expiresAt: null,
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

      const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36 });
      const filename = `${session.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_report.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      doc.pipe(res);

      const accentHex = "#ea580c";
      const headerBg = "#f5f0eb";
      const borderColor = "#cccccc";

      doc.fontSize(18).fillColor(accentHex).text("Master Reel Counter", 36, 36);
      doc.fontSize(14).fillColor("#333333").text(session.name, 36, 58);
      doc.fontSize(9).fillColor("#666666");
      doc.text(`Location: ${session.location || "N/A"}  |  Status: ${session.status}  |  Entries: ${sessionEntries.length}  |  Total Footage: ${totalFootage.toLocaleString()} ft`, 36, 78);
      if (pt.firstPhotoAt) {
        doc.text(`Session time: ${new Date(pt.firstPhotoAt).toLocaleString()} to ${pt.lastPhotoAt ? new Date(pt.lastPhotoAt).toLocaleString() : "ongoing"}`, 36, 92);
      }

      const tableLeft = 36;
      const pageWidth = doc.page.width - 72;
      const rowHeight = 16;
      const headerHeight = 18;
      let currentY = pt.firstPhotoAt ? 112 : 100;
      const maxY = doc.page.height - 80;

      const formatCT = (d: Date): string => {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Chicago',
          month: '2-digit', day: '2-digit', year: 'numeric',
          hour: 'numeric', minute: '2-digit', second: '2-digit',
          hour12: false,
        }).formatToParts(d);
        const get = (type: string) => parts.find(p => p.type === type)?.value || '';
        let hour = get('hour');
        if (hour.startsWith('0') && hour.length > 1) hour = hour.slice(1);
        if (hour === '24') hour = '0';
        return `${get('month')}-${get('day')}-${get('year')} at ${hour}:${get('minute')}:${get('second')} CT`;
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
          if (a.aisle < b.aisle) return -1;
          if (a.aisle > b.aisle) return 1;
          const aN = parseInt(a.section) || 0;
          const bN = parseInt(b.section) || 0;
          return aN - bN;
        });

      const secEntryCols = [
        { header: "Vendor:", width: 90 },
        { header: "Category:", width: 130 },
        { header: "# of Reels:", width: 55 },
        { header: "Total Footage:", width: 75 },
        { header: "Notes:", width: 150 },
      ];
      const secTotalW = secEntryCols.reduce((s, c) => s + c.width, 0);
      const secScale = pageWidth / secTotalW;
      const secScaled = secEntryCols.map(c => ({ ...c, width: Math.floor(c.width * secScale) }));

      const drawSecEntryHeader = (y: number) => {
        doc.rect(tableLeft, y, pageWidth, headerHeight).fill(headerBg);
        doc.font('Helvetica-Bold').fontSize(7).fillColor("#333333");
        let x = tableLeft;
        for (const col of secScaled) {
          doc.text(col.header, x + 3, y + 4, { width: col.width - 6, lineBreak: false });
          const tw = doc.widthOfString(col.header);
          doc.save().moveTo(x + 3, y + 13).lineTo(x + 3 + tw, y + 13).lineWidth(0.4).strokeColor("#333333").stroke().restore();
          x += col.width;
        }
        doc.font('Helvetica');
        doc.rect(tableLeft, y, pageWidth, headerHeight).stroke(borderColor);
        return y + headerHeight;
      };

      const drawCommittedPin = (pin: any, imgX: number, imgY: number, imgW: number, imgH: number, imgOrigW: number, pinScale: number) => {
        const pinCenterX = imgX + (pin.xPercent / 100) * imgW;
        const pinCenterY = imgY + (pin.yPercent / 100) * imgH;
        const baseW = 82;
        const baseH = 61;
        const cssToImgRatio = imgW / imgOrigW;
        const pw = baseW * cssToImgRatio * pinScale;
        const ph = baseH * cssToImgRatio * pinScale;
        const px = pinCenterX - pw / 2;
        const py = pinCenterY - ph / 2;

        doc.save();
        doc.rect(px, py, pw, ph)
          .strokeColor(accentHex)
          .lineWidth(1.5)
          .stroke();

        if (pin.label) {
          const labelFontSize = Math.max(4, 7 * cssToImgRatio * pinScale);
          const labelText = `P${pin.label}`;
          const labelPadX = 2 * cssToImgRatio * pinScale;
          const labelH = labelFontSize + 3 * cssToImgRatio * pinScale;
          const labelW = labelText.length * labelFontSize * 0.65 + labelPadX * 2;
          let tabX = pinCenterX - labelW / 2;
          const reelCount = pin.reelCount || 1;
          let badgeW = 0;
          if (reelCount >= 2) {
            const badgeText = `X${reelCount}`;
            badgeW = badgeText.length * labelFontSize * 0.65 + labelPadX * 2;
          }
          const totalTopW = labelW + badgeW;
          tabX = pinCenterX - totalTopW / 2;

          const tabY = py - labelH;
          doc.rect(tabX, tabY, labelW, labelH).fill(accentHex);
          doc.font('Helvetica-Bold').fontSize(labelFontSize).fillColor("#ffffff")
            .text(labelText, tabX, tabY + 1, { width: labelW, align: "center", lineBreak: false });

          if (reelCount >= 2) {
            const badgeText = `X${reelCount}`;
            const badgeX = tabX + labelW;
            doc.rect(badgeX, tabY, badgeW, labelH).fill(accentHex);
            doc.font('Helvetica-Bold').fontSize(labelFontSize).fillColor("#ffffff")
              .text(badgeText, badgeX, tabY + 1, { width: badgeW, align: "center", lineBreak: false });
          }
          doc.font('Helvetica');
        }
        doc.restore();
      };

      for (const sec of sortedSections) {
        doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
        currentY = 36;

        doc.rect(tableLeft, currentY, pageWidth, 24).fill("#e8e0d8");
        doc.fontSize(12).fillColor(accentHex).text(
          `Aisle ${sec.aisle || "—"}  /  Section ${sec.section || "—"}`,
          tableLeft + 8, currentY + 5, { width: pageWidth - 100, lineBreak: false }
        );
        const secFootage = sec.entries.reduce((s: number, e: any) => s + (e.footage || 0), 0);
        const secReels = sec.entries.reduce((s: number, e: any) => s + (e.reelCount || 1), 0);
        doc.fontSize(8).fillColor("#666666").text(
          `${sec.entries.length} entries  |  ${secReels} reels  |  ${secFootage.toLocaleString()} ft`,
          tableLeft + pageWidth - 250, currentY + 7, { width: 240, align: "right", lineBreak: false }
        );
        doc.rect(tableLeft, currentY, pageWidth, 24).stroke(borderColor);
        currentY += 32;

        const fullPhotos = sec.photos.filter((p: any) => !p.isDetailShot);
        const detailPhotos = sec.photos.filter((p: any) => p.isDetailShot);

        type PhotoLayout = { photo: any; buffer: Buffer; imgW: number; imgH: number; origW: number; origH: number };
        const loadPhoto = async (photo: any): Promise<PhotoLayout | null> => {
          const photoKey = photo.objectStorageKey;
          const photoFilename = photoKey.replace("/uploads/", "");
          const photoPath = path.join(UPLOADS_DIR, photoFilename);
          try {
            await fs.access(photoPath);
            const imgBuffer = await fs.readFile(photoPath);
            const img = doc.openImage(imgBuffer);
            return { photo, buffer: imgBuffer, imgW: img.width, imgH: img.height, origW: img.width, origH: img.height };
          } catch {
            return null;
          }
        };

        const renderPhoto = (pl: PhotoLayout, x: number, y: number, maxW: number, maxH: number) => {
          const aspect = pl.origW / pl.origH;
          let w: number, h: number;
          w = maxW;
          h = maxW / aspect;
          if (h > maxH) {
            h = maxH;
            w = maxH * aspect;
          }
          const imgX = x + (maxW - w) / 2;
          doc.image(pl.buffer, imgX, y, { width: w, height: h });

          const photoPins = allPinsMap.get(pl.photo.id) || [];
          const pinScale = pl.photo.pinScale || 1;
          for (const pin of photoPins) {
            drawCommittedPin(pin, imgX, y, w, h, pl.origW, pinScale);
          }

          doc.rect(imgX, y, w, h).strokeColor(borderColor).lineWidth(0.5).stroke();
          return { renderedW: w, renderedH: h, imgX };
        };

        const renderPhotoWithCaption = async (photo: any, maxW: number, maxH: number) => {
          if (maxH < 60) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
            maxH = Math.min(photoMaxH, maxY - currentY - 60);
          }
          const pl = await loadPhoto(photo);
          const photoFilename = photo.objectStorageKey.replace("/uploads/", "");
          if (!pl) {
            if (currentY + 20 > maxY) {
              doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
              currentY = 36;
            }
            doc.fontSize(7).fillColor("#999999").text(`[Photo unavailable: ${photo.originalFilename || photoFilename}]`, tableLeft, currentY);
            currentY += 14;
            return;
          }

          const aspect = pl.origW / pl.origH;
          const fitH = Math.min(maxH, maxW / aspect);
          if (currentY + fitH + 16 > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
            maxH = Math.min(photoMaxH, maxY - currentY - 60);
          }

          const { renderedH } = renderPhoto(pl, tableLeft, currentY, maxW, maxH);
          currentY += renderedH + 4;
          doc.fontSize(6).fillColor("#999999").text(
            photo.originalFilename || photoFilename,
            tableLeft, currentY, { width: pageWidth, align: "center" }
          );
          currentY += 12;
        };

        const renderPhotoPair = async (photos: any[], maxW: number, maxH: number) => {
          const loaded: (PhotoLayout | null)[] = [];
          for (const p of photos) {
            loaded.push(await loadPhoto(p));
          }
          const valid = loaded.filter(Boolean) as PhotoLayout[];
          if (valid.length === 0) return;

          const gap = 8;
          const halfW = (maxW - gap) / 2;

          let tallestH = 0;
          for (const pl of valid) {
            const aspect = pl.origW / pl.origH;
            const h = Math.min(maxH, halfW / aspect);
            if (h > tallestH) tallestH = h;
          }

          if (currentY + tallestH + 16 > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
          }

          for (let idx = 0; idx < valid.length; idx++) {
            const xOffset = tableLeft + idx * (halfW + gap);
            renderPhoto(valid[idx], xOffset, currentY, halfW, maxH);
          }
          currentY += tallestH + 4;

          const captions = valid.map(pl => pl.photo.originalFilename || pl.photo.objectStorageKey.replace("/uploads/", ""));
          doc.fontSize(6).fillColor("#999999").text(
            captions.join("     "),
            tableLeft, currentY, { width: pageWidth, align: "center" }
          );
          currentY += 12;
        };

        const photoMaxH = 350;
        for (const photo of fullPhotos) {
          await renderPhotoWithCaption(photo, pageWidth, Math.min(photoMaxH, maxY - currentY - 60));
        }

        if (detailPhotos.length > 0) {
          const pairs: any[][] = [];
          for (let i = 0; i < detailPhotos.length; i += 2) {
            if (i + 1 < detailPhotos.length) {
              pairs.push([detailPhotos[i], detailPhotos[i + 1]]);
            } else {
              pairs.push([detailPhotos[i]]);
            }
          }
          for (const pair of pairs) {
            if (pair.length === 2) {
              await renderPhotoPair(pair, pageWidth, 250);
            } else {
              await renderPhotoWithCaption(pair[0], pageWidth, Math.min(photoMaxH, maxY - currentY - 60));
            }
          }
        }

        if (sec.entries.length > 0) {
          const minTableSpace = headerHeight + rowHeight + 18;
          if (currentY + minTableSpace > maxY) {
            doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
            currentY = 36;
          }
          currentY += 4;
          doc.fontSize(9).fillColor("#333333").text("Reels Found", tableLeft, currentY);
          currentY += 14;
          currentY = drawSecEntryHeader(currentY);

          for (let i = 0; i < sec.entries.length; i++) {
            if (currentY + rowHeight > maxY) {
              doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
              currentY = drawSecEntryHeader(36);
            }
            const e: any = sec.entries[i];
            if (i % 2 === 1) doc.rect(tableLeft, currentY, pageWidth, rowHeight).fill("#fafaf8");
            doc.font('Helvetica-Bold').fontSize(6.5).fillColor("#333333");
            let x = tableLeft;
            const vals = [
              e.manufacturer || "",
              e.reelTag || "",
              String(e.reelCount || 1),
              e.footage ? `${e.footage.toLocaleString()} ft` : "",
              e.notes || "",
            ];
            for (let j = 0; j < secScaled.length; j++) {
              doc.text(vals[j], x + 3, currentY + 4, { width: secScaled[j].width - 6, lineBreak: false });
              x += secScaled[j].width;
            }
            doc.font('Helvetica');
            doc.rect(tableLeft, currentY, pageWidth, rowHeight).stroke(borderColor);
            currentY += rowHeight;
          }
        }
      }

      // --- Summary Totals Page ---
      doc.addPage({ size: "LETTER", layout: "landscape", margin: 36 });
      currentY = 36;

      doc.fontSize(18).fillColor(accentHex).text("Summary Totals", 36, currentY);
      currentY += 24;
      doc.fontSize(9).fillColor("#666666").text(`${session.name}  |  ${session.location || "N/A"}  |  ${sessionEntries.length} entries  |  ${totalFootage.toLocaleString()} ft total`, 36, currentY);
      currentY += 20;

      const categoryMap = new Map<string, { vendorCode: string; totalFootage: number; reelCount: number; locations: string[] }>();
      for (const e of sessionEntries as any[]) {
        const cat = e.reelTag || e.wireType || "Uncategorized";
        const vendor = e.manufacturer || "";
        const groupKey = `${cat}|||${vendor}`;
        const existing = categoryMap.get(groupKey);
        const loc = [e.aisle, e.section, e.position].filter(Boolean).join("-");
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

      allCategories.sort((a, b) => {
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
          doc.text(vals[j], x + 3, currentY + 4, { width: sumScaled[j].width - 6, lineBreak: false, align: aligns[j] });
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

      doc.end();
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

  // User Settings
  app.get("/api/settings", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const settings = await storage.getUserSettings(userId);
      res.json(settings || { userId, encodingEnabled: false });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings/encoding", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { enabled } = req.body;

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
        if (entriesToUpdate.length > 0) {
          await storage.bulkUpdateEntries(entriesToUpdate);
        }
        await storage.upsertUserSettings(userId, {
          encodingEnabled: true,
          encryptionKey: wrappedKey,
          encryptionSalt: salt,
        });
        res.json({ success: true, encodingEnabled: true, entriesEncoded: entriesToUpdate.length });
      } else {
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
        res.json({ success: true, encodingEnabled: false, entriesDecoded: allEntries.length });
      }
    } catch (error) {
      console.error("Error toggling encoding:", error);
      res.status(500).json({ message: "Failed to toggle encoding" });
    }
  });

  // External API for Power Apps - read-only, limited data exposure
  app.get("/api/external/sessions/:id", async (req, res) => {
    try {
      const session = await storage.getSession(parseInt(req.params.id));
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
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

  return httpServer;
}
