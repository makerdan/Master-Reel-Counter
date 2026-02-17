import { db } from "./db";
import { eq, and, desc, inArray, sql, count, sum, min, max } from "drizzle-orm";
import {
  countingSessions,
  photos,
  entries,
  pins,
  userSettings,
  sessionCollaborators,
  sessionInviteLinks,
  type InsertSession,
  type Session,
  type InsertPhoto,
  type Photo,
  type InsertEntry,
  type Entry,
  type InsertPin,
  type Pin,
  type UserSettings,
  type InsertCollaborator,
  type Collaborator,
  type InsertInviteLink,
  type InviteLink,
} from "@shared/schema";

export interface IStorage {
  createSession(session: InsertSession): Promise<Session>;
  getSession(id: number): Promise<Session | undefined>;
  getUserSessions(userId: string): Promise<Session[]>;
  updateSession(id: number, data: Partial<Session>): Promise<Session | undefined>;
  deleteSession(id: number): Promise<void>;

  createPhoto(photo: InsertPhoto): Promise<Photo>;
  getPhoto(id: number): Promise<Photo | undefined>;
  getSessionPhotos(sessionId: number): Promise<Photo[]>;
  updatePhoto(id: number, data: Partial<Photo>): Promise<Photo | undefined>;
  deletePhoto(id: number): Promise<void>;

  createEntry(entry: InsertEntry): Promise<Entry>;
  getEntry(id: number): Promise<Entry | undefined>;
  getSessionEntries(sessionId: number): Promise<Entry[]>;
  updateEntry(id: number, data: Partial<Entry>): Promise<Entry | undefined>;
  deleteEntry(id: number): Promise<void>;

  createPin(pin: InsertPin): Promise<Pin>;
  getPin(id: number): Promise<Pin | undefined>;
  getPhotoPins(photoId: number): Promise<Pin[]>;
  getSessionPins(sessionId: number): Promise<Pin[]>;
  updatePin(id: number, data: Partial<Pin>): Promise<Pin | undefined>;
  deletePin(id: number): Promise<void>;

  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  upsertUserSettings(userId: string, data: Partial<UserSettings>): Promise<UserSettings>;
  getAllUserEntries(userId: string): Promise<Entry[]>;
  bulkUpdateEntries(entriesToUpdate: { id: number; data: Partial<Entry> }[]): Promise<void>;
  getSessionStats(sessionIds: number[]): Promise<Map<number, { entryCount: number; totalFootage: number; sectionCount: number }>>;
  getSessionPhotoStats(sessionIds: number[]): Promise<Map<number, { photoCount: number; firstPhotoAt: Date | null; lastPhotoAt: Date | null }>>;

  addCollaborator(data: InsertCollaborator): Promise<Collaborator>;
  getSessionCollaborators(sessionId: number): Promise<Collaborator[]>;
  getCollaborator(sessionId: number, userId: string): Promise<Collaborator | undefined>;
  removeCollaborator(id: number): Promise<void>;
  removeCollaboratorBySessionAndUser(sessionId: number, userId: string): Promise<void>;
  getSharedSessions(userId: string): Promise<(Session & { role: string; ownerUsername?: string })[]>;

  createInviteLink(data: InsertInviteLink): Promise<InviteLink>;
  getInviteLinkById(id: number): Promise<InviteLink | undefined>;
  getInviteLinkByToken(token: string): Promise<InviteLink | undefined>;
  getSessionInviteLinks(sessionId: number): Promise<InviteLink[]>;
  revokeInviteLink(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async createSession(session: InsertSession): Promise<Session> {
    const [result] = await db.insert(countingSessions).values(session).returning();
    return result;
  }

  async getSession(id: number): Promise<Session | undefined> {
    const [result] = await db.select().from(countingSessions).where(eq(countingSessions.id, id));
    return result;
  }

  async getUserSessions(userId: string): Promise<Session[]> {
    return db.select().from(countingSessions)
      .where(eq(countingSessions.userId, userId))
      .orderBy(desc(countingSessions.lastUpdatedAt));
  }

  async updateSession(id: number, data: Partial<Session>): Promise<Session | undefined> {
    const [result] = await db.update(countingSessions)
      .set({ ...data, lastUpdatedAt: new Date() })
      .where(eq(countingSessions.id, id))
      .returning();
    return result;
  }

  async deleteSession(id: number): Promise<void> {
    const sessionPhotos = await db.select({ id: photos.id }).from(photos).where(eq(photos.sessionId, id));
    if (sessionPhotos.length > 0) {
      const photoIds = sessionPhotos.map(p => p.id);
      await db.delete(pins).where(inArray(pins.photoId, photoIds));
    }
    await db.delete(entries).where(eq(entries.sessionId, id));
    await db.delete(photos).where(eq(photos.sessionId, id));
    await db.delete(sessionCollaborators).where(eq(sessionCollaborators.sessionId, id));
    await db.delete(sessionInviteLinks).where(eq(sessionInviteLinks.sessionId, id));
    await db.delete(countingSessions).where(eq(countingSessions.id, id));
  }

  async createPhoto(photo: InsertPhoto): Promise<Photo> {
    const [result] = await db.insert(photos).values(photo).returning();
    return result;
  }

  async getPhoto(id: number): Promise<Photo | undefined> {
    const [result] = await db.select().from(photos).where(eq(photos.id, id));
    return result;
  }

  async getSessionPhotos(sessionId: number): Promise<Photo[]> {
    return db.select().from(photos)
      .where(eq(photos.sessionId, sessionId))
      .orderBy(desc(photos.createdAt));
  }

  async updatePhoto(id: number, data: Partial<Photo>): Promise<Photo | undefined> {
    const [result] = await db.update(photos)
      .set(data)
      .where(eq(photos.id, id))
      .returning();
    return result;
  }

  async deletePhoto(id: number): Promise<void> {
    await db.delete(pins).where(eq(pins.photoId, id));
    await db.delete(photos).where(eq(photos.id, id));
  }

  async createEntry(entry: InsertEntry): Promise<Entry> {
    const [result] = await db.insert(entries).values(entry).returning();
    return result;
  }

  async getEntry(id: number): Promise<Entry | undefined> {
    const [result] = await db.select().from(entries).where(eq(entries.id, id));
    return result;
  }

  async getSessionEntries(sessionId: number): Promise<Entry[]> {
    return db.select().from(entries)
      .where(eq(entries.sessionId, sessionId))
      .orderBy(desc(entries.createdAt));
  }

  async updateEntry(id: number, data: Partial<Entry>): Promise<Entry | undefined> {
    const [result] = await db.update(entries)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(entries.id, id))
      .returning();
    return result;
  }

  async deleteEntry(id: number): Promise<void> {
    await db.delete(entries).where(eq(entries.id, id));
  }

  async createPin(pin: InsertPin): Promise<Pin> {
    const [result] = await db.insert(pins).values(pin).returning();
    return result;
  }

  async getPin(id: number): Promise<Pin | undefined> {
    const [result] = await db.select().from(pins).where(eq(pins.id, id));
    return result;
  }

  async getPhotoPins(photoId: number): Promise<Pin[]> {
    return db.select().from(pins).where(eq(pins.photoId, photoId));
  }

  async getSessionPins(sessionId: number): Promise<Pin[]> {
    const sessionPhotos = await db.select({ id: photos.id }).from(photos).where(eq(photos.sessionId, sessionId));
    if (sessionPhotos.length === 0) return [];
    const photoIds = sessionPhotos.map(p => p.id);
    return db.select().from(pins).where(inArray(pins.photoId, photoIds));
  }

  async updatePin(id: number, data: Partial<Pin>): Promise<Pin | undefined> {
    const [result] = await db.update(pins)
      .set(data)
      .where(eq(pins.id, id))
      .returning();
    return result;
  }

  async deletePin(id: number): Promise<void> {
    await db.delete(pins).where(eq(pins.id, id));
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const [result] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return result;
  }

  async upsertUserSettings(userId: string, data: Partial<UserSettings>): Promise<UserSettings> {
    const existing = await this.getUserSettings(userId);
    if (existing) {
      const [result] = await db.update(userSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(userSettings.userId, userId))
        .returning();
      return result;
    }
    const [result] = await db.insert(userSettings)
      .values({ userId, ...data })
      .returning();
    return result;
  }

  async getAllUserEntries(userId: string): Promise<Entry[]> {
    return db.select().from(entries).where(eq(entries.userId, userId));
  }

  async bulkUpdateEntries(entriesToUpdate: { id: number; data: Partial<Entry> }[]): Promise<void> {
    for (const { id, data } of entriesToUpdate) {
      await db.update(entries).set(data).where(eq(entries.id, id));
    }
  }

  async getSessionStats(sessionIds: number[]): Promise<Map<number, { entryCount: number; totalFootage: number; sectionCount: number }>> {
    const result = new Map<number, { entryCount: number; totalFootage: number; sectionCount: number }>();
    if (sessionIds.length === 0) return result;
    const rows = await db
      .select({
        sessionId: entries.sessionId,
        entryCount: count(entries.id),
        totalFootage: sum(entries.footage),
        sectionCount: sql<number>`count(distinct ${entries.section})`,
      })
      .from(entries)
      .where(inArray(entries.sessionId, sessionIds))
      .groupBy(entries.sessionId);
    for (const row of rows) {
      result.set(row.sessionId, {
        entryCount: Number(row.entryCount),
        totalFootage: Number(row.totalFootage) || 0,
        sectionCount: Number(row.sectionCount) || 0,
      });
    }
    return result;
  }

  async getSessionPhotoStats(sessionIds: number[]): Promise<Map<number, { photoCount: number; firstPhotoAt: Date | null; lastPhotoAt: Date | null }>> {
    const result = new Map<number, { photoCount: number; firstPhotoAt: Date | null; lastPhotoAt: Date | null }>();
    if (sessionIds.length === 0) return result;
    const rows = await db
      .select({
        sessionId: photos.sessionId,
        photoCount: count(photos.id),
        firstPhotoAt: min(photos.createdAt),
        lastPhotoAt: max(photos.createdAt),
      })
      .from(photos)
      .where(inArray(photos.sessionId, sessionIds))
      .groupBy(photos.sessionId);
    for (const row of rows) {
      result.set(row.sessionId, {
        photoCount: Number(row.photoCount),
        firstPhotoAt: row.firstPhotoAt ? new Date(row.firstPhotoAt) : null,
        lastPhotoAt: row.lastPhotoAt ? new Date(row.lastPhotoAt) : null,
      });
    }
    return result;
  }

  async addCollaborator(data: InsertCollaborator): Promise<Collaborator> {
    const [result] = await db.insert(sessionCollaborators).values(data).returning();
    return result;
  }

  async getSessionCollaborators(sessionId: number): Promise<Collaborator[]> {
    return db.select().from(sessionCollaborators)
      .where(eq(sessionCollaborators.sessionId, sessionId))
      .orderBy(desc(sessionCollaborators.addedAt));
  }

  async getCollaborator(sessionId: number, userId: string): Promise<Collaborator | undefined> {
    const [result] = await db.select().from(sessionCollaborators)
      .where(and(eq(sessionCollaborators.sessionId, sessionId), eq(sessionCollaborators.userId, userId)));
    return result;
  }

  async removeCollaborator(id: number): Promise<void> {
    await db.delete(sessionCollaborators).where(eq(sessionCollaborators.id, id));
  }

  async removeCollaboratorBySessionAndUser(sessionId: number, userId: string): Promise<void> {
    await db.delete(sessionCollaborators)
      .where(and(eq(sessionCollaborators.sessionId, sessionId), eq(sessionCollaborators.userId, userId)));
  }

  async getSharedSessions(userId: string): Promise<(Session & { role: string; ownerUsername?: string })[]> {
    const collabs = await db.select().from(sessionCollaborators)
      .where(eq(sessionCollaborators.userId, userId));
    if (collabs.length === 0) return [];
    const sessionIds = collabs.map(c => c.sessionId);
    const sessions = await db.select().from(countingSessions)
      .where(inArray(countingSessions.id, sessionIds))
      .orderBy(desc(countingSessions.lastUpdatedAt));
    const roleMap = new Map(collabs.map(c => [c.sessionId, c.role]));
    return sessions.map(s => ({ ...s, role: roleMap.get(s.id) || "editor" }));
  }

  async createInviteLink(data: InsertInviteLink): Promise<InviteLink> {
    const [result] = await db.insert(sessionInviteLinks).values(data).returning();
    return result;
  }

  async getInviteLinkById(id: number): Promise<InviteLink | undefined> {
    const [result] = await db.select().from(sessionInviteLinks)
      .where(eq(sessionInviteLinks.id, id));
    return result;
  }

  async getInviteLinkByToken(token: string): Promise<InviteLink | undefined> {
    const [result] = await db.select().from(sessionInviteLinks)
      .where(eq(sessionInviteLinks.token, token));
    return result;
  }

  async getSessionInviteLinks(sessionId: number): Promise<InviteLink[]> {
    return db.select().from(sessionInviteLinks)
      .where(eq(sessionInviteLinks.sessionId, sessionId))
      .orderBy(desc(sessionInviteLinks.createdAt));
  }

  async revokeInviteLink(id: number): Promise<void> {
    await db.update(sessionInviteLinks)
      .set({ isActive: false })
      .where(eq(sessionInviteLinks.id, id));
  }
}

export const storage = new DatabaseStorage();
