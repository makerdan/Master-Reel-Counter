import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth";
import { registerAuthRoutes } from "./replit_integrations/auth/routes";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage/routes";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { openai } from "./replit_integrations/image/client";
import { insertSessionSchema, insertEntrySchema, insertPinSchema } from "@shared/schema";
import { generateSalt, generateDataKey, deriveKEK, wrapKey, unwrapKey, encryptEntry, decryptEntry } from "./encryption";

async function verifySessionOwnership(sessionId: number, userId: string) {
  const session = await storage.getSession(sessionId);
  if (!session || session.userId !== userId) return null;
  return session;
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
  await setupAuth(app);
  registerAuthRoutes(app);
  registerObjectStorageRoutes(app);

  const objectStorageService = new ObjectStorageService();

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

  app.get("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const session = await verifySessionOwnership(parseInt(req.params.id), req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const photoStats = await storage.getSessionPhotoStats([session.id]);
      const ps = photoStats.get(session.id) || { photoCount: 0, firstPhotoAt: null, lastPhotoAt: null };
      res.json({ ...session, ...ps });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch session" });
    }
  });

  app.patch("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const session = await verifySessionOwnership(parseInt(req.params.id), req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const data: any = { ...req.body };
      if (data.completedAt) data.completedAt = new Date(data.completedAt);
      else if (data.completedAt === null) data.completedAt = null;
      const updated = await storage.updateSession(session.id, data);
      res.json(updated);
    } catch (error: any) {
      console.error("Failed to update session:", error?.message || error);
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  app.delete("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const session = await verifySessionOwnership(parseInt(req.params.id), req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Session not found" });
      await storage.deleteSession(session.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete session" });
    }
  });

  // Photos - all operations verify session ownership
  app.get("/api/sessions/:sessionId/photos", isAuthenticated, async (req: any, res) => {
    try {
      const session = await verifySessionOwnership(parseInt(req.params.sessionId), req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const photos = await storage.getSessionPhotos(session.id);
      res.json(photos);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch photos" });
    }
  });

  app.post("/api/sessions/:sessionId/photos", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const session = await verifySessionOwnership(parseInt(req.params.sessionId), userId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const displayName = req.user.claims.first_name
        ? `${req.user.claims.first_name} ${req.user.claims.last_name || ""}`.trim()
        : req.user.claims.email || userId;
      const photo = await storage.createPhoto({
        ...req.body,
        sessionId: session.id,
        userId,
        uploadedBy: displayName,
      });
      console.log(`Photo uploaded: id=${photo.id}, by="${displayName}" (${userId}), session=${session.id}, at=${photo.createdAt.toISOString()}`);
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
      const session = await verifySessionOwnership(photo.sessionId, req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Photo not found" });
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
      const session = await verifySessionOwnership(photo.sessionId, req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Photo not found" });
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(
          photo.objectStorageKey.startsWith("/objects/") ? photo.objectStorageKey : `/objects/${photo.objectStorageKey}`
        );
        await objectFile.delete();
      } catch (err) {
        console.warn("Could not delete object storage file:", err);
      }
      await storage.deletePhoto(photo.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete photo" });
    }
  });

  // Entries CRUD - all operations verify session ownership + encoding
  app.get("/api/sessions/:sessionId/entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const session = await verifySessionOwnership(parseInt(req.params.sessionId), userId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const rawEntries = await storage.getSessionEntries(session.id);
      const key = await getEncryptionKey(userId);
      const result = key ? rawEntries.map(e => decryptEntry(e, key) as any) : rawEntries;
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch entries" });
    }
  });

  app.post("/api/sessions/:sessionId/entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const session = await verifySessionOwnership(parseInt(req.params.sessionId), userId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      let entryData = { ...req.body, sessionId: session.id, userId };
      const key = await getEncryptionKey(userId);
      if (key) entryData = encryptEntry(entryData, key) as any;
      const data = insertEntrySchema.parse(entryData);
      const entry = await storage.createEntry(data);
      await storage.updateSession(session.id, {});
      const result = key ? decryptEntry(entry, key) : entry;
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
      const session = await verifySessionOwnership(entry.sessionId, userId);
      if (!session) return res.status(404).json({ message: "Entry not found" });
      const key = await getEncryptionKey(userId);
      let updateData = req.body;
      if (key) updateData = encryptEntry(updateData, key) as any;
      const updated = await storage.updateEntry(entry.id, updateData);
      const result = key && updated ? decryptEntry(updated, key) : updated;
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to update entry" });
    }
  });

  app.delete("/api/entries/:id", isAuthenticated, async (req: any, res) => {
    try {
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const session = await verifySessionOwnership(entry.sessionId, req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Entry not found" });
      await storage.deleteEntry(entry.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete entry" });
    }
  });

  // Pins - verify ownership through photo -> session chain
  app.get("/api/photos/:photoId/pins", isAuthenticated, async (req: any, res) => {
    try {
      const photo = await storage.getPhoto(parseInt(req.params.photoId));
      if (!photo) return res.status(404).json({ message: "Photo not found" });
      const session = await verifySessionOwnership(photo.sessionId, req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Photo not found" });
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
      const session = await verifySessionOwnership(photo.sessionId, req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Photo not found" });
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
      const session = await verifySessionOwnership(photo.sessionId, req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Pin not found" });
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
      const session = await verifySessionOwnership(photo.sessionId, req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Pin not found" });
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
      const session = await verifySessionOwnership(photo.sessionId, req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Photo not found" });
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

  // AI Vision endpoint
  app.post("/api/ai/analyze", isAuthenticated, async (req: any, res) => {
    try {
      const { imageUrl, prompt } = req.body;
      if (!imageUrl || !prompt) {
        return res.status(400).json({ message: "imageUrl and prompt are required" });
      }

      let finalImageUrl = imageUrl;
      if (imageUrl.startsWith("/objects/")) {
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(imageUrl);
          const [metadata] = await objectFile.getMetadata();
          const chunks: Buffer[] = [];
          const stream = objectFile.createReadStream();
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString("base64");
          const contentType = metadata.contentType || "image/jpeg";
          finalImageUrl = `data:${contentType};base64,${base64}`;
        } catch (err) {
          console.error("Error reading image from object storage:", err);
          return res.status(400).json({ message: "Failed to read image from storage" });
        }
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: finalImageUrl } },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const result = response.choices[0]?.message?.content || "";
      res.json({ result });
    } catch (error: any) {
      console.error("AI analysis error:", error);
      res.status(500).json({ message: "AI analysis failed: " + (error.message || "Unknown error") });
    }
  });

  app.get("/api/sessions/:id/export/pdf", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const session = await verifySessionOwnership(parseInt(req.params.id), userId);
      if (!session) return res.status(404).json({ message: "Session not found" });
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
          <td>${esc(e.gauge || "")}</td><td>${e.footage || ""}</td><td>${esc(e.color || "")}</td>
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
            <th>Reel Tag</th><th>Wire Type</th><th>Gauge</th><th>Footage</th><th>Color</th>
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
                <td>${esc(p.originalFilename || p.filename)}</td>
                <td>${esc(p.section || "")}</td>
                <td>${p.isDetailShot ? '<span class="detail">Detail Shot</span>' : "Overview"}</td>
                <td>${parent ? esc(parent.originalFilename || parent.filename) : ""}</td>
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
      const session = await verifySessionOwnership(parseInt(req.params.id), userId);
      if (!session) return res.status(404).json({ message: "Session not found" });
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
          id: e.id, section: e.section, aisle: e.aisle, palletId: e.palletId,
          wireType: e.wireType, gauge: e.gauge, color: e.color, footage: e.footage,
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
