import { db } from "./db";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  countingSessions,
  photos,
  entries,
  pins,
  type InsertSession,
  type Session,
  type InsertPhoto,
  type Photo,
  type InsertEntry,
  type Entry,
  type InsertPin,
  type Pin,
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
  updatePin(id: number, data: Partial<Pin>): Promise<Pin | undefined>;
  deletePin(id: number): Promise<void>;
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
}

export const storage = new DatabaseStorage();
