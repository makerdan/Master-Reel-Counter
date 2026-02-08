import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replit_integrations/auth";
import { registerAuthRoutes } from "./replit_integrations/auth/routes";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage/routes";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { openai } from "./replit_integrations/image/client";
import { insertSessionSchema, insertEntrySchema, insertPinSchema } from "@shared/schema";

async function verifySessionOwnership(sessionId: number, userId: string) {
  const session = await storage.getSession(sessionId);
  if (!session || session.userId !== userId) return null;
  return session;
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
      res.json(sessions);
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
      res.json(session);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch session" });
    }
  });

  app.patch("/api/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const session = await verifySessionOwnership(parseInt(req.params.id), req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const updated = await storage.updateSession(session.id, req.body);
      res.json(updated);
    } catch (error) {
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
      const photo = await storage.createPhoto({
        ...req.body,
        sessionId: session.id,
        userId,
      });
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
      const updated = await storage.updatePhoto(photo.id, req.body);
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
      await storage.deletePhoto(photo.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete photo" });
    }
  });

  // Entries CRUD - all operations verify session ownership
  app.get("/api/sessions/:sessionId/entries", isAuthenticated, async (req: any, res) => {
    try {
      const session = await verifySessionOwnership(parseInt(req.params.sessionId), req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const entries = await storage.getSessionEntries(session.id);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch entries" });
    }
  });

  app.post("/api/sessions/:sessionId/entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const session = await verifySessionOwnership(parseInt(req.params.sessionId), userId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const data = insertEntrySchema.parse({ ...req.body, sessionId: session.id, userId });
      const entry = await storage.createEntry(data);
      await storage.updateSession(session.id, {});
      res.json(entry);
    } catch (error) {
      console.error("Error creating entry:", error);
      res.status(500).json({ message: "Failed to create entry" });
    }
  });

  app.patch("/api/entries/:id", isAuthenticated, async (req: any, res) => {
    try {
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const session = await verifySessionOwnership(entry.sessionId, req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Entry not found" });
      const updated = await storage.updateEntry(entry.id, req.body);
      res.json(updated);
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

  // Export session data (authenticated)
  app.get("/api/sessions/:id/export", isAuthenticated, async (req: any, res) => {
    try {
      const session = await verifySessionOwnership(parseInt(req.params.id), req.user.claims.sub);
      if (!session) return res.status(404).json({ message: "Session not found" });
      const sessionEntries = await storage.getSessionEntries(session.id);
      const sessionPhotos = await storage.getSessionPhotos(session.id);
      res.json({ session, entries: sessionEntries, photos: sessionPhotos });
    } catch (error) {
      res.status(500).json({ message: "Failed to export session" });
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
      res.json({
        session: { id: session.id, name: session.name, location: session.location, status: session.status, startedAt: session.startedAt },
        entries: sessionEntries.map(e => ({
          id: e.id, section: e.section, aisle: e.aisle, palletNumber: e.palletNumber,
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
