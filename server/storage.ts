import { db } from "./db";
import { eq, and, desc, asc, inArray, sql, count, sum, min, max, ilike, or, isNull } from "drizzle-orm";
import {
  countingSessions,
  photos,
  entries,
  pins,
  userSettings,
  sessionCollaborators,
  sessionInviteLinks,
  folders,
  activityLogs,
  comments,
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
  type InsertFolder,
  type Folder,
  type InsertActivityLog,
  type ActivityLog,
  type InsertComment,
  type Comment,
  feedback,
  type Feedback,
  type InsertFeedback,
  scanResults,
  type ScanResult,
  type InsertScanResult,
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
  isObjectKeyShared(key: string, excludePhotoId: number): Promise<boolean>;

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

  getSessionIncompletePins(sessionId: number): Promise<{ photoId: number; incompleteCount: number }[]>;
  getSessionFlaggedPins(sessionId: number): Promise<Pin[]>;
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  upsertUserSettings(userId: string, data: Partial<UserSettings>): Promise<UserSettings>;
  getAllUserEntries(userId: string): Promise<Entry[]>;
  bulkUpdateEntries(entriesToUpdate: { id: number; data: Partial<Entry> }[]): Promise<void>;
  getSessionStats(sessionIds: number[]): Promise<Map<number, { entryCount: number; totalFootage: number; sectionCount: number }>>;
  getSessionPhotoStats(sessionIds: number[]): Promise<Map<number, { photoCount: number; firstPhotoAt: Date | null; lastPhotoAt: Date | null }>>;
  getSessionThumbnails(sessionIds: number[]): Promise<Map<number, string>>;
  getSessionCollaboratorUsernames(sessionIds: number[]): Promise<Map<number, string[]>>;

  addCollaborator(data: InsertCollaborator): Promise<Collaborator>;
  getSessionCollaborators(sessionId: number): Promise<Collaborator[]>;
  getCollaborator(sessionId: number, userId: string): Promise<Collaborator | undefined>;
  removeCollaborator(id: number): Promise<void>;
  removeCollaboratorBySessionAndUser(sessionId: number, userId: string): Promise<void>;
  updateCollaboratorRole(id: number, role: string): Promise<Collaborator | undefined>;
  transferSessionOwnership(sessionId: number, newOwnerId: string, newOwnerUsername: string): Promise<void>;
  getSharedSessions(userId: string): Promise<(Session & { role: string; ownerUsername?: string })[]>;

  createInviteLink(data: InsertInviteLink): Promise<InviteLink>;
  getInviteLinkById(id: number): Promise<InviteLink | undefined>;
  getInviteLinkByToken(token: string): Promise<InviteLink | undefined>;
  getSessionInviteLinks(sessionId: number): Promise<InviteLink[]>;
  revokeInviteLink(id: number): Promise<void>;
  incrementInviteLinkUsedCount(id: number): Promise<void>;

  createFolder(folder: InsertFolder): Promise<Folder>;
  getUserFolders(userId: string): Promise<Folder[]>;
  getFolder(id: number): Promise<Folder | undefined>;
  updateFolder(id: number, data: Partial<Folder>): Promise<Folder | undefined>;
  deleteFolder(id: number): Promise<void>;
  duplicateSession(sessionId: number, userId: string, targetFolderId: number | null): Promise<Session>;
  searchUserSessions(userId: string, query: string, searchInside: boolean): Promise<{ ownedIds: number[]; sharedIds: number[]; reasons: Record<number, string[]> }>;

  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getSessionActivityLogs(sessionId: number, limit?: number, offset?: number): Promise<ActivityLog[]>;

  createComment(comment: InsertComment): Promise<Comment>;
  getSessionComments(sessionId: number): Promise<Comment[]>;
  getComment(id: number): Promise<Comment | undefined>;
  updateComment(id: number, data: Partial<Comment>): Promise<Comment | undefined>;
  deleteComment(id: number): Promise<void>;

  createFeedback(data: InsertFeedback): Promise<Feedback>;
  listFeedback(): Promise<Feedback[]>;

  upsertScanResults(results: InsertScanResult[]): Promise<ScanResult[]>;
  getSessionScanResults(sessionId: number): Promise<ScanResult[]>;
  deleteSessionScanResults(sessionId: number): Promise<void>;


  getUserStats(userId: string): Promise<{
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    totalEntries: number;
    totalReels: number;
    totalFootage: number;
    totalPhotos: number;
    topCategories: { category: string; count: number; footage: number }[];
    topManufacturers: { manufacturer: string; count: number }[];
    weeklyStats: { week: string; entries: number; footage: number }[];
    bestSessionFootage: number;
    currentStreak: number;
    longestStreak: number;
    busiestDay: string | null;
  }>;

  getSharedSessionPerformance(userId: string): Promise<{
    sessionId: number;
    sessionName: string;
    contributors: {
      userId: string;
      username: string;
      entryCount: number;
      photoCount: number;
      reelCount: number;
      footage: number;
    }[];
  }[]>;
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
    await db.transaction(async (tx) => {
      const sessionPhotos = await tx.select({ id: photos.id }).from(photos).where(eq(photos.sessionId, id));
      if (sessionPhotos.length > 0) {
        const photoIds = sessionPhotos.map(p => p.id);
        await tx.delete(pins).where(inArray(pins.photoId, photoIds));
      }
      await tx.delete(entries).where(eq(entries.sessionId, id));
      await tx.delete(photos).where(eq(photos.sessionId, id));
      await tx.delete(sessionCollaborators).where(eq(sessionCollaborators.sessionId, id));
      await tx.delete(sessionInviteLinks).where(eq(sessionInviteLinks.sessionId, id));
      await tx.delete(activityLogs).where(eq(activityLogs.sessionId, id));
      await tx.delete(comments).where(eq(comments.sessionId, id));
      await tx.delete(countingSessions).where(eq(countingSessions.id, id));
    });
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

  async isObjectKeyShared(key: string, excludePhotoId: number): Promise<boolean> {
    const rows = await db.select({ id: photos.id }).from(photos)
      .where(and(eq(photos.objectStorageKey, key), sql`${photos.id} != ${excludePhotoId}`));
    return rows.length > 0;
  }

  async deletePhoto(id: number): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(photos).set({ parentPhotoId: null, isDetailShot: false }).where(eq(photos.parentPhotoId, id));
      await tx.delete(comments).where(eq(comments.photoId, id));
      const committedPinRows = await tx.select({ entryId: pins.entryId }).from(pins)
        .where(and(eq(pins.photoId, id), sql`${pins.entryId} IS NOT NULL`));
      const pinnedEntryIds = committedPinRows.map(r => r.entryId as number);
      if (pinnedEntryIds.length > 0) {
        await tx.delete(comments).where(inArray(comments.entryId, pinnedEntryIds));
        await tx.delete(entries).where(inArray(entries.id, pinnedEntryIds));
      }
      await tx.delete(entries).where(eq(entries.photoId, id));
      await tx.delete(pins).where(eq(pins.photoId, id));
      await tx.delete(photos).where(eq(photos.id, id));
    });
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
    await db.transaction(async (tx) => {
      await tx.delete(comments).where(eq(comments.entryId, id));
      await tx.update(pins).set({ entryId: null }).where(eq(pins.entryId, id));
      await tx.delete(entries).where(eq(entries.id, id));
    });
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

  async getSessionIncompletePins(sessionId: number): Promise<{ photoId: number; incompleteCount: number }[]> {
    const sessionPhotos = await db.select({ id: photos.id }).from(photos).where(eq(photos.sessionId, sessionId));
    if (sessionPhotos.length === 0) return [];
    const photoIds = sessionPhotos.map(p => p.id);
    const results = await db
      .select({
        photoId: pins.photoId,
        incompleteCount: count(),
      })
      .from(pins)
      .where(
        and(
          inArray(pins.photoId, photoIds),
          sql`${pins.entryId} IS NULL`
        )
      )
      .groupBy(pins.photoId);
    return results.map(r => ({ photoId: r.photoId, incompleteCount: Number(r.incompleteCount) }));
  }

  async getSessionFlaggedPins(sessionId: number): Promise<Pin[]> {
    const sessionPhotos = await db.select({ id: photos.id }).from(photos).where(eq(photos.sessionId, sessionId));
    if (sessionPhotos.length === 0) return [];
    const photoIds = sessionPhotos.map(p => p.id);
    return db.select().from(pins).where(
      and(
        inArray(pins.photoId, photoIds),
        eq(pins.flagged, true),
        isNull(pins.entryId)
      )
    );
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
    await db.transaction(async (tx) => {
      for (const { id, data } of entriesToUpdate) {
        await tx.update(entries).set(data).where(eq(entries.id, id));
      }
    });
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

  async getSessionThumbnails(sessionIds: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (sessionIds.length === 0) return result;
    const rows = await db
      .select({ sessionId: photos.sessionId, objectStorageKey: photos.objectStorageKey })
      .from(photos)
      .where(inArray(photos.sessionId, sessionIds))
      .orderBy(asc(photos.sessionId), asc(photos.id));
    const seen = new Set<number>();
    for (const row of rows) {
      if (!seen.has(row.sessionId)) {
        seen.add(row.sessionId);
        result.set(row.sessionId, row.objectStorageKey);
      }
    }
    return result;
  }

  async getSessionCollaboratorUsernames(sessionIds: number[]): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>();
    if (sessionIds.length === 0) return result;
    const rows = await db.select({
      sessionId: sessionCollaborators.sessionId,
      username: sessionCollaborators.username,
    }).from(sessionCollaborators)
      .where(inArray(sessionCollaborators.sessionId, sessionIds));
    for (const row of rows) {
      const existing = result.get(row.sessionId) || [];
      existing.push(row.username || "?");
      result.set(row.sessionId, existing);
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

  async updateCollaboratorRole(id: number, role: string): Promise<Collaborator | undefined> {
    const [result] = await db.update(sessionCollaborators)
      .set({ role })
      .where(eq(sessionCollaborators.id, id))
      .returning();
    return result;
  }

  async transferSessionOwnership(sessionId: number, newOwnerId: string, newOwnerUsername: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error("Session not found");
    const oldOwnerId = session.userId;
    await db.update(countingSessions)
      .set({ userId: newOwnerId })
      .where(eq(countingSessions.id, sessionId));
    await this.removeCollaboratorBySessionAndUser(sessionId, newOwnerId);
    await db.insert(sessionCollaborators).values({
      sessionId,
      userId: oldOwnerId,
      username: null,
      role: "editor",
    });
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

  async incrementInviteLinkUsedCount(id: number): Promise<void> {
    await db.update(sessionInviteLinks)
      .set({ usedCount: sql`used_count + 1` })
      .where(eq(sessionInviteLinks.id, id));
  }

  async createFolder(folder: InsertFolder): Promise<Folder> {
    const [result] = await db.insert(folders).values(folder).returning();
    return result;
  }

  async getUserFolders(userId: string): Promise<Folder[]> {
    return db.select().from(folders)
      .where(eq(folders.userId, userId))
      .orderBy(asc(folders.sortOrder), asc(folders.createdAt));
  }

  async getFolder(id: number): Promise<Folder | undefined> {
    const [result] = await db.select().from(folders).where(eq(folders.id, id));
    return result;
  }

  async updateFolder(id: number, data: Partial<Folder>): Promise<Folder | undefined> {
    const [result] = await db.update(folders)
      .set(data)
      .where(eq(folders.id, id))
      .returning();
    return result;
  }

  async deleteFolder(id: number): Promise<void> {
    await db.update(countingSessions)
      .set({ folderId: null })
      .where(eq(countingSessions.folderId, id));
    await db.delete(folders).where(eq(folders.id, id));
  }

  async duplicateSession(sessionId: number, userId: string, targetFolderId: number | null): Promise<Session> {
    const original = await this.getSession(sessionId);
    if (!original) throw new Error("Session not found");
    const [newSession] = await db.insert(countingSessions).values({
      userId,
      folderId: targetFolderId,
      name: `${original.name} (Copy)`,
      location: original.location,
      status: "active",
    }).returning();
    const originalEntries = await this.getSessionEntries(sessionId);
    for (const entry of originalEntries) {
      const { id, sessionId: _, createdAt, updatedAt, ...rest } = entry;
      await db.insert(entries).values({ ...rest, sessionId: newSession.id });
    }
    return newSession;
  }

  async searchUserSessions(userId: string, query: string, searchInside: boolean): Promise<{
    ownedIds: number[];
    sharedIds: number[];
    reasons: Record<number, string[]>;
  }> {
    const lowerQuery = query.trim().toLowerCase();
    const pattern = `%${query}%`;
    const reasons: Record<number, string[]> = {};
    const addReason = (id: number, reason: string) => {
      if (!reasons[id]) reasons[id] = [];
      if (!reasons[id].includes(reason)) reasons[id].push(reason);
    };

    const monthNames: Record<string, number> = {
      january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
      july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
      jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };

    let dateMonth: number | null = null;
    let dateYear: number | null = null;
    const mmyyyyMatch = lowerQuery.match(/^(\d{1,2})[\/\-](\d{4})$/);
    if (mmyyyyMatch) {
      dateMonth = parseInt(mmyyyyMatch[1]);
      dateYear = parseInt(mmyyyyMatch[2]);
    } else {
      const parts = lowerQuery.split(/[\s,/\-]+/);
      for (const part of parts) {
        if (monthNames[part] !== undefined) dateMonth = monthNames[part];
        else if (/^\d{4}$/.test(part)) dateYear = parseInt(part);
      }
    }

    let statusMatch: string | null = null;
    if (lowerQuery === "active" || lowerQuery === "completed") {
      statusMatch = lowerQuery;
    }

    let footageMin: number | null = null;
    const footageMatch = lowerQuery.match(/^[>]?\s*(\d+)\+?\s*(ft|feet|footage)?$/);
    if (footageMatch && parseInt(footageMatch[1]) >= 100) {
      footageMin = parseInt(footageMatch[1]);
    }

    let reelMin: number | null = null;
    const reelMatch = lowerQuery.match(/^[>]?\s*(\d+)\+?\s*reels?$/);
    if (reelMatch) {
      reelMin = parseInt(reelMatch[1]);
    }

    const allUserSessions = await db.select().from(countingSessions)
      .where(eq(countingSessions.userId, userId));
    const allSessionIds = allUserSessions.map(s => s.id);
    const ownedMatched = new Set<number>();

    for (const s of allUserSessions) {
      if (s.name.toLowerCase().includes(lowerQuery)) {
        ownedMatched.add(s.id);
        addReason(s.id, "name");
      }
      if (s.location && s.location.toLowerCase().includes(lowerQuery)) {
        ownedMatched.add(s.id);
        addReason(s.id, "location");
      }
      if (statusMatch && s.status === statusMatch) {
        ownedMatched.add(s.id);
        addReason(s.id, "status");
      }
      if (dateMonth || dateYear) {
        const d = new Date(s.startedAt);
        const mMatch = dateMonth ? d.getMonth() + 1 === dateMonth : true;
        const yMatch = dateYear ? d.getFullYear() === dateYear : true;
        if (mMatch && yMatch) {
          ownedMatched.add(s.id);
          addReason(s.id, "date");
        }
      }
    }

    if ((footageMin !== null || reelMin !== null) && allSessionIds.length > 0) {
      const stats = await this.getSessionStats(allSessionIds);
      for (const [sid, stat] of stats) {
        if (footageMin !== null && stat.totalFootage >= footageMin) {
          ownedMatched.add(sid);
          addReason(sid, "footage");
        }
        if (reelMin !== null && stat.entryCount >= reelMin) {
          ownedMatched.add(sid);
          addReason(sid, "reels");
        }
      }
    }

    if (allSessionIds.length > 0) {
      const collabMatches = await db.select({ sessionId: sessionCollaborators.sessionId })
        .from(sessionCollaborators)
        .where(and(
          inArray(sessionCollaborators.sessionId, allSessionIds),
          ilike(sql`COALESCE(${sessionCollaborators.username}, '')`, pattern),
        ))
        .groupBy(sessionCollaborators.sessionId);
      for (const m of collabMatches) {
        ownedMatched.add(m.sessionId);
        addReason(m.sessionId, "collaborator");
      }
    }

    if (searchInside && allSessionIds.length > 0) {
      const entryMatches = await db.select({ sessionId: entries.sessionId })
        .from(entries)
        .where(and(
          inArray(entries.sessionId, allSessionIds),
          or(
            ilike(sql`COALESCE(${entries.reelTag}, '')`, pattern),
            ilike(sql`COALESCE(${entries.wireType}, '')`, pattern),
            ilike(sql`COALESCE(${entries.manufacturer}, '')`, pattern),
            ilike(sql`COALESCE(${entries.notes}, '')`, pattern),
            ilike(sql`COALESCE(${entries.aisle}, '')`, pattern),
            ilike(sql`COALESCE(${entries.section}, '')`, pattern),
          )
        ))
        .groupBy(entries.sessionId);
      for (const m of entryMatches) {
        ownedMatched.add(m.sessionId);
        addReason(m.sessionId, "entries");
      }
    }

    const sharedMatched = new Set<number>();
    const collabs = await db.select().from(sessionCollaborators)
      .where(eq(sessionCollaborators.userId, userId));
    if (collabs.length > 0) {
      const sharedSessionIds = collabs.map(c => c.sessionId);
      const sharedSessions = await db.select().from(countingSessions)
        .where(inArray(countingSessions.id, sharedSessionIds));
      for (const s of sharedSessions) {
        if (s.name.toLowerCase().includes(lowerQuery)) {
          sharedMatched.add(s.id);
          addReason(s.id, "name");
        }
        if (s.location && s.location.toLowerCase().includes(lowerQuery)) {
          sharedMatched.add(s.id);
          addReason(s.id, "location");
        }
        if (statusMatch && s.status === statusMatch) {
          sharedMatched.add(s.id);
          addReason(s.id, "status");
        }
        if (dateMonth || dateYear) {
          const d = new Date(s.startedAt);
          const mMatch = dateMonth ? d.getMonth() + 1 === dateMonth : true;
          const yMatch = dateYear ? d.getFullYear() === dateYear : true;
          if (mMatch && yMatch) {
            sharedMatched.add(s.id);
            addReason(s.id, "date");
          }
        }
      }

      if (searchInside && sharedSessionIds.length > 0) {
        const entryMatches = await db.select({ sessionId: entries.sessionId })
          .from(entries)
          .where(and(
            inArray(entries.sessionId, sharedSessionIds),
            or(
              ilike(sql`COALESCE(${entries.reelTag}, '')`, pattern),
              ilike(sql`COALESCE(${entries.wireType}, '')`, pattern),
              ilike(sql`COALESCE(${entries.manufacturer}, '')`, pattern),
              ilike(sql`COALESCE(${entries.notes}, '')`, pattern),
              ilike(sql`COALESCE(${entries.aisle}, '')`, pattern),
              ilike(sql`COALESCE(${entries.section}, '')`, pattern),
            )
          ))
          .groupBy(entries.sessionId);
        for (const m of entryMatches) {
          sharedMatched.add(m.sessionId);
          addReason(m.sessionId, "entries");
        }
      }
    }

    return {
      ownedIds: Array.from(ownedMatched),
      sharedIds: Array.from(sharedMatched),
      reasons,
    };
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [result] = await db.insert(activityLogs).values(log).returning();
    return result;
  }

  async getSessionActivityLogs(sessionId: number, limit = 50, offset = 0): Promise<ActivityLog[]> {
    return db.select().from(activityLogs)
      .where(eq(activityLogs.sessionId, sessionId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async createComment(comment: InsertComment): Promise<Comment> {
    const [result] = await db.insert(comments).values(comment).returning();
    return result;
  }

  async getSessionComments(sessionId: number): Promise<Comment[]> {
    return db.select().from(comments)
      .where(eq(comments.sessionId, sessionId))
      .orderBy(asc(comments.createdAt));
  }

  async getComment(id: number): Promise<Comment | undefined> {
    const [result] = await db.select().from(comments).where(eq(comments.id, id));
    return result;
  }

  async updateComment(id: number, data: Partial<Comment>): Promise<Comment | undefined> {
    const [result] = await db.update(comments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(comments.id, id))
      .returning();
    return result;
  }

  async deleteComment(id: number): Promise<void> {
    await db.delete(comments).where(eq(comments.parentCommentId, id));
    await db.delete(comments).where(eq(comments.id, id));
  }

  async getUserStats(userId: string): Promise<{
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    totalEntries: number;
    totalReels: number;
    totalFootage: number;
    totalPhotos: number;
    topCategories: { category: string; count: number; footage: number }[];
    topManufacturers: { manufacturer: string; count: number }[];
    weeklyStats: { week: string; entries: number; footage: number }[];
    bestSessionFootage: number;
    currentStreak: number;
    longestStreak: number;
    busiestDay: string | null;
  }> {
    const userSessions = await db.select({ id: countingSessions.id, status: countingSessions.status })
      .from(countingSessions)
      .where(eq(countingSessions.userId, userId));

    const sessionIds = userSessions.map(s => s.id);
    const totalSessions = userSessions.length;
    const activeSessions = userSessions.filter(s => s.status === "active").length;
    const completedSessions = userSessions.filter(s => s.status === "completed").length;

    if (sessionIds.length === 0) {
      return {
        totalSessions: 0, activeSessions: 0, completedSessions: 0,
        totalEntries: 0, totalReels: 0, totalFootage: 0, totalPhotos: 0,
        topCategories: [], topManufacturers: [], weeklyStats: [],
        bestSessionFootage: 0, currentStreak: 0, longestStreak: 0, busiestDay: null,
      };
    }

    const [entryStats] = await db.select({
      totalEntries: count(),
      totalReels: sum(entries.reelCount),
      totalFootage: sum(entries.footage),
    }).from(entries).where(inArray(entries.sessionId, sessionIds));

    const [photoStats] = await db.select({
      totalPhotos: count(),
    }).from(photos).where(inArray(photos.sessionId, sessionIds));

    const topCategoriesRaw = await db.select({
      category: entries.reelTag,
      count: count(),
      footage: sum(entries.footage),
    }).from(entries)
      .where(and(inArray(entries.sessionId, sessionIds), sql`${entries.reelTag} IS NOT NULL AND ${entries.reelTag} != ''`))
      .groupBy(entries.reelTag)
      .orderBy(desc(count()))
      .limit(10);

    const topManufacturersRaw = await db.select({
      manufacturer: entries.manufacturer,
      count: count(),
    }).from(entries)
      .where(and(inArray(entries.sessionId, sessionIds), sql`${entries.manufacturer} IS NOT NULL AND ${entries.manufacturer} != ''`))
      .groupBy(entries.manufacturer)
      .orderBy(desc(count()))
      .limit(10);

    const weeklyStatsRaw = await db.select({
      week: sql<string>`to_char(date_trunc('week', ${entries.createdAt}), 'YYYY-MM-DD')`,
      entries: count(),
      footage: sum(entries.footage),
    }).from(entries)
      .where(inArray(entries.sessionId, sessionIds))
      .groupBy(sql`date_trunc('week', ${entries.createdAt})`)
      .orderBy(sql`date_trunc('week', ${entries.createdAt})`)
      .limit(12);

    const bestSessionRows = await db.select({
      totalFootage: sum(entries.footage),
    }).from(entries)
      .where(inArray(entries.sessionId, sessionIds))
      .groupBy(entries.sessionId)
      .orderBy(desc(sum(entries.footage)))
      .limit(1);
    const bestSessionFootage = bestSessionRows.length > 0 ? Number(bestSessionRows[0].totalFootage) || 0 : 0;

    const entryDatesRaw = await db.select({
      day: sql<string>`to_char(${entries.createdAt}::date, 'YYYY-MM-DD')`,
    }).from(entries)
      .where(inArray(entries.sessionId, sessionIds))
      .groupBy(sql`${entries.createdAt}::date`)
      .orderBy(desc(sql`${entries.createdAt}::date`));

    let currentStreak = 0;
    let longestStreak = 0;
    if (entryDatesRaw.length > 0) {
      const dates = entryDatesRaw.map(d => d.day);
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);

      let streak = 0;
      let isCurrent = true;
      let prevDate: Date | null = null;
      for (const dateStr of dates) {
        const d = new Date(dateStr + "T00:00:00Z");
        if (prevDate === null) {
          if (dateStr === todayStr || dateStr === yesterdayStr) {
            streak = 1;
          } else {
            isCurrent = false;
            streak = 1;
          }
        } else {
          const diff = (prevDate.getTime() - d.getTime()) / 86400000;
          if (diff === 1) {
            streak++;
          } else {
            if (isCurrent) currentStreak = streak;
            longestStreak = Math.max(longestStreak, streak);
            isCurrent = false;
            streak = 1;
          }
        }
        prevDate = d;
      }
      if (isCurrent) currentStreak = streak;
      longestStreak = Math.max(longestStreak, streak);
    }

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const busiestDayRaw = await db.select({
      dow: sql<number>`EXTRACT(dow FROM ${entries.createdAt})`,
      cnt: count(),
    }).from(entries)
      .where(inArray(entries.sessionId, sessionIds))
      .groupBy(sql`EXTRACT(dow FROM ${entries.createdAt})`)
      .orderBy(desc(count()))
      .limit(1);
    const busiestDay = busiestDayRaw.length > 0 ? dayNames[Number(busiestDayRaw[0].dow)] || null : null;

    return {
      totalSessions,
      activeSessions,
      completedSessions,
      totalEntries: Number(entryStats.totalEntries) || 0,
      totalReels: Number(entryStats.totalReels) || 0,
      totalFootage: Number(entryStats.totalFootage) || 0,
      totalPhotos: Number(photoStats.totalPhotos) || 0,
      topCategories: topCategoriesRaw.map(c => ({
        category: c.category!,
        count: Number(c.count),
        footage: Number(c.footage) || 0,
      })),
      topManufacturers: topManufacturersRaw.map(m => ({
        manufacturer: m.manufacturer!,
        count: Number(m.count),
      })),
      weeklyStats: weeklyStatsRaw.map(w => ({
        week: w.week,
        entries: Number(w.entries),
        footage: Number(w.footage) || 0,
      })),
      bestSessionFootage,
      currentStreak,
      longestStreak,
      busiestDay,
    };
  }

  async getSharedSessionPerformance(userId: string): Promise<{
    sessionId: number;
    sessionName: string;
    contributors: {
      userId: string;
      username: string;
      entryCount: number;
      photoCount: number;
      reelCount: number;
      footage: number;
    }[];
  }[]> {
    const ownedSessions = await db.select({ id: countingSessions.id, name: countingSessions.name, ownerId: countingSessions.userId })
      .from(countingSessions)
      .where(eq(countingSessions.userId, userId));

    const collabRows = await db.select({
      sessionId: sessionCollaborators.sessionId,
    }).from(sessionCollaborators)
      .where(eq(sessionCollaborators.userId, userId));

    const collabSessionIds = collabRows.map(c => c.sessionId);
    let collabSessions: { id: number; name: string; ownerId: string }[] = [];
    if (collabSessionIds.length > 0) {
      const rows = await db.select({ id: countingSessions.id, name: countingSessions.name, ownerId: countingSessions.userId })
        .from(countingSessions)
        .where(inArray(countingSessions.id, collabSessionIds));
      collabSessions = rows;
    }

    const allSessionMap = new Map<number, { id: number; name: string; ownerId: string }>();
    for (const s of ownedSessions) allSessionMap.set(s.id, s);
    for (const s of collabSessions) allSessionMap.set(s.id, s);

    const allSessionIds = Array.from(allSessionMap.keys());
    if (allSessionIds.length === 0) return [];

    const collabCountRows = await db.select({
      sessionId: sessionCollaborators.sessionId,
      cnt: count(),
    }).from(sessionCollaborators)
      .where(inArray(sessionCollaborators.sessionId, allSessionIds))
      .groupBy(sessionCollaborators.sessionId);

    const sharedSessionIds = collabCountRows
      .filter(r => Number(r.cnt) > 0)
      .map(r => r.sessionId);

    if (sharedSessionIds.length === 0) return [];

    const allCollabs = await db.select().from(sessionCollaborators)
      .where(inArray(sessionCollaborators.sessionId, sharedSessionIds));

    const usernameMap = new Map<string, string>();
    for (const c of allCollabs) {
      if (c.username && !usernameMap.has(c.userId)) {
        usernameMap.set(c.userId, c.username);
      }
    }

    const ownerIds = Array.from(allSessionMap.values())
      .filter(s => sharedSessionIds.includes(s.id))
      .map(s => s.ownerId)
      .filter(uid => !usernameMap.has(uid));
    if (ownerIds.length > 0) {
      const uniqueOwnerIds = [...new Set(ownerIds)];
      const ownerPhotos = await db.select({ userId: photos.userId, uploadedBy: photos.uploadedBy })
        .from(photos)
        .where(and(inArray(photos.userId, uniqueOwnerIds), sql`${photos.uploadedBy} IS NOT NULL AND ${photos.uploadedBy} != ''`))
        .limit(uniqueOwnerIds.length);
      for (const p of ownerPhotos) {
        if (p.uploadedBy && !usernameMap.has(p.userId)) {
          usernameMap.set(p.userId, p.uploadedBy);
        }
      }
    }

    const entryContribs = await db.select({
      sessionId: entries.sessionId,
      eUserId: entries.userId,
      entryCount: count(),
      reelCount: sum(entries.reelCount),
      footage: sum(entries.footage),
    }).from(entries)
      .where(inArray(entries.sessionId, sharedSessionIds))
      .groupBy(entries.sessionId, entries.userId);

    const photoContribs = await db.select({
      sessionId: photos.sessionId,
      pUserId: photos.userId,
      photoCount: count(),
    }).from(photos)
      .where(inArray(photos.sessionId, sharedSessionIds))
      .groupBy(photos.sessionId, photos.userId);

    const results: {
      sessionId: number;
      sessionName: string;
      contributors: {
        userId: string;
        username: string;
        entryCount: number;
        photoCount: number;
        reelCount: number;
        footage: number;
      }[];
    }[] = [];

    for (const sId of sharedSessionIds) {
      const session = allSessionMap.get(sId);
      if (!session) continue;

      const contribMap = new Map<string, { userId: string; entryCount: number; photoCount: number; reelCount: number; footage: number }>();

      const addUser = (uid: string) => {
        if (!contribMap.has(uid)) {
          contribMap.set(uid, { userId: uid, entryCount: 0, photoCount: 0, reelCount: 0, footage: 0 });
        }
        return contribMap.get(uid)!;
      };

      addUser(session.ownerId);
      for (const c of allCollabs) {
        if (c.sessionId === sId) addUser(c.userId);
      }

      for (const e of entryContribs) {
        if (e.sessionId === sId) {
          const u = addUser(e.eUserId);
          u.entryCount = Number(e.entryCount);
          u.reelCount = Number(e.reelCount) || 0;
          u.footage = Number(e.footage) || 0;
        }
      }

      for (const p of photoContribs) {
        if (p.sessionId === sId) {
          const u = addUser(p.pUserId);
          u.photoCount = Number(p.photoCount);
        }
      }

      const contributors = Array.from(contribMap.values())
        .map(c => ({
          ...c,
          username: usernameMap.get(c.userId) || c.userId.slice(0, 8),
        }))
        .sort((a, b) => b.entryCount - a.entryCount || b.footage - a.footage);

      results.push({
        sessionId: sId,
        sessionName: session.name,
        contributors,
      });
    }

    return results;
  }

  async createFeedback(data: InsertFeedback): Promise<Feedback> {
    const [result] = await db.insert(feedback).values(data).returning();
    return result;
  }

  async listFeedback(): Promise<Feedback[]> {
    return db.select().from(feedback).orderBy(desc(feedback.createdAt));
  }

  async upsertScanResults(results: InsertScanResult[]): Promise<ScanResult[]> {
    if (!results.length) return [];
    const inserted: ScanResult[] = [];
    for (const r of results) {
      const [row] = await db.insert(scanResults)
        .values(r)
        .onConflictDoUpdate({
          target: scanResults.pinId,
          set: {
            rawText: r.rawText,
            readable: r.readable,
            pinLabel: r.pinLabel,
            scannedBy: r.scannedBy,
            updatedAt: new Date(),
          },
        })
        .returning();
      inserted.push(row);
    }
    return inserted;
  }

  async getSessionScanResults(sessionId: number): Promise<ScanResult[]> {
    return db.select().from(scanResults)
      .where(eq(scanResults.sessionId, sessionId))
      .orderBy(desc(scanResults.createdAt));
  }

  async deleteSessionScanResults(sessionId: number): Promise<void> {
    await db.delete(scanResults).where(eq(scanResults.sessionId, sessionId));
  }

}

export const storage = new DatabaseStorage();
