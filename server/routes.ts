import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth";
import { registerAuthRoutes } from "./replit_integrations/auth/routes";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage/routes";
import { insertSessionSchema, insertEntrySchema, insertPinSchema } from "@shared/schema";
import { generateSalt, generateDataKey, deriveKEK, wrapKey, unwrapKey, encryptEntry, decryptEntry } from "./encryption";
import multer from "multer";
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
      const { aisle, section, rotation, notes, isDetailShot, parentPhotoId } = req.body;
      const safeUpdate: Record<string, any> = {};
      if (aisle !== undefined) safeUpdate.aisle = aisle;
      if (section !== undefined) safeUpdate.section = section;
      if (rotation !== undefined) safeUpdate.rotation = rotation;
      if (notes !== undefined) safeUpdate.notes = notes;
      if (isDetailShot !== undefined) safeUpdate.isDetailShot = isDetailShot;
      if (parentPhotoId !== undefined) safeUpdate.parentPhotoId = parentPhotoId;
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
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const rowsHtml = sessionEntries.map((e: any, i: number) => {
        const photo = e.photoId ? photoMap.get(e.photoId) : null;
        const parentPhoto = photo?.parentPhotoId ? photoMap.get(photo.parentPhotoId) : null;
        return `
        <tr>
          <td>${i + 1}</td><td>${esc(e.aisle || "")}</td><td>${esc(e.section || "")}</td><td>${esc(e.position || "")}</td>
          <td>${esc(e.palletId || "")}</td><td>${esc(e.reelTag || "")}</td><td>${esc(e.wireType || "")}</td>
          <td>${esc(e.gauge || "")}</td><td>${e.footage || ""}</td><td>${e.reelCount || 1}</td><td>${esc(e.color || "")}</td>
          <td>${esc(e.manufacturer || "")}</td><td>${esc(e.notes || "")}</td>
          <td>${esc(photo?.originalFilename || "")}</td>
          <td>${esc(photo?.notes || "")}${photo?.isDetailShot ? ' <span class="detail">[Detail]</span>' : ""}</td>
        </tr>`;
      }).join("");
      const html = `<!DOCTYPE html><html><head><title>${session.name} - Audit Report</title>
        <style>
          body{font-family:Arial,sans-serif;padding:24px;color:#333}
          table{border-collapse:collapse;width:100%;margin-top:16px}
          th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:11px}
          th{background:#f5f0eb;font-weight:600}
          .detail{color:#ea580c;font-weight:600;font-size:10px}
          h1{font-size:20px;margin:0}
          .meta{font-size:12px;color:#666;margin-top:4px}
          .photo-summary{margin-top:24px}
          .photo-summary h2{font-size:14px;margin:0 0 8px}
          .photo-summary table{font-size:10px}
          .audit{margin-top:24px;padding-top:12px;border-top:2px solid #ea580c;font-size:10px;color:#666}
          .audit strong{color:#333}
          .stamp{display:inline-block;border:2px solid #ea580c;padding:4px 12px;border-radius:4px;font-size:10px;font-weight:600;color:#ea580c;margin-top:8px}
        </style>
      </head><body>
        <h1>Master Reel Counter - ${session.name}</h1>
        <div class="meta">
          Location: ${session.location || "N/A"}<br>
          Status: ${session.status} | Entries: ${sessionEntries.length} | Total Footage: ${totalFootage.toLocaleString()} ft<br>
          ${pt.firstPhotoAt ? `Session time: ${new Date(pt.firstPhotoAt).toISOString()} to ${pt.lastPhotoAt ? new Date(pt.lastPhotoAt).toISOString() : "ongoing"}` : "No photos uploaded"}
        </div>
        <table>
          <thead><tr>
            <th>#</th><th>Aisle</th><th>Section</th><th>Position</th><th>Pallet ID</th>
            <th>Reel Tag</th><th>Wire Type</th><th>Gauge</th><th>Footage</th><th>Reel Count</th><th>Color</th>
            <th>Manufacturer</th><th>Notes</th><th>Photo</th><th>Photo Notes</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${sessionPhotos.filter(p => p.notes || p.isDetailShot).length > 0 ? `
        <div class="photo-summary">
          <h2>Photo Annotations</h2>
          <table>
            <thead><tr><th>Photo</th><th>Section</th><th>Type</th><th>Parent Photo</th><th>Notes</th></tr></thead>
            <tbody>${sessionPhotos.filter(p => p.notes || p.isDetailShot).map(p => {
              const parent = p.parentPhotoId ? photoMap.get(p.parentPhotoId) : null;
              return `<tr>
                <td>${esc(p.originalFilename || "")}</td>
                <td>${esc(p.section || "")}</td>
                <td>${p.isDetailShot ? '<span class="detail">Detail Shot</span>' : "Overview"}</td>
                <td>${parent ? esc(parent.originalFilename || "") : ""}</td>
                <td>${esc(p.notes || "")}</td>
              </tr>`;
            }).join("")}</tbody>
          </table>
        </div>` : ""}
        <div class="audit">
          <strong>Audit Trail</strong><br>
          Report generated: ${generatedAt}<br>
          First photo: ${pt.firstPhotoAt ? new Date(pt.firstPhotoAt).toISOString() : "N/A"}<br>
          Last photo: ${pt.lastPhotoAt ? new Date(pt.lastPhotoAt).toISOString() : "N/A"}<br>
          ${session.completedAt ? `Completed: ${new Date(session.completedAt).toISOString()}<br>` : ""}
          Entry count at generation: ${sessionEntries.length}<br>
          Data encoding: ${key ? "Active (entries decrypted for export)" : "Off"}<br>
          <div class="stamp">VERIFIED EXPORT - ${generatedAt}</div>
        </div>
        <script>setTimeout(()=>window.print(),500)</script>
      </body></html>`;
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `inline; filename="${session.name.replace(/\s+/g, "_")}_report.html"`);
      res.send(html);
    } catch (error) {
      console.error("Error generating PDF:", error);
      res.status(500).json({ message: "Failed to generate report" });
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
          reelCount: e.reelCount || 1,
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
