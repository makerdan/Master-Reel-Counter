import { db } from "./db";
import { eq, and, desc, asc, inArray, sql, count, sum, min, max, ilike, or, isNull, isNotNull, lt } from "drizzle-orm";
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
  dismissedDuplicates,
  type DismissedDuplicate,
  userWireCategories,
  type UserWireCategory,
  type InsertUserWireCategory,
  reviewResponses,
  type ReviewResponse,
  type InsertReviewResponse,
} from "@shared/schema";

export interface IStorage {
  createSession(session: InsertSession): Promise<Session>;
  getSession(id: number): Promise<Session | undefined>;
  getUserSessions(userId: string, options?: { trash?: boolean; limit?: number; offset?: number }): Promise<{ sessions: Session[]; total: number }>;
  updateSession(id: number, data: Partial<Session>): Promise<Session | undefined>;
  softDeleteSession(id: number): Promise<void>;
  restoreSession(id: number): Promise<void>;
  deleteSession(id: number): Promise<void>;
  getExpiredTrashSessions(olderThanDays: number): Promise<Session[]>;

  createPhoto(photo: InsertPhoto): Promise<Photo>;
  getPhoto(id: number): Promise<Photo | undefined>;
  getPhotoByStorageKey(key: string): Promise<Photo | undefined>;
  getSessionPhotos(sessionId: number): Promise<Photo[]>;
  getSessionPhotosPaginated(sessionId: number, limit: number, offset: number): Promise<{ photos: Photo[]; total: number }>;
  updatePhoto(id: number, data: Partial<Photo>): Promise<Photo | undefined>;
  deletePhoto(id: number): Promise<void>;
  isObjectKeyShared(key: string, excludePhotoId: number): Promise<boolean>;

  createEntry(entry: InsertEntry): Promise<Entry>;
  getEntry(id: number): Promise<Entry | undefined>;
  getSessionEntries(sessionId: number): Promise<Entry[]>;
  getSessionEntriesPaginated(sessionId: number, limit: number, offset: number): Promise<{ entries: Entry[]; total: number }>;
  updateEntry(id: number, data: Partial<Entry>): Promise<Entry | undefined>;
  deleteEntry(id: number): Promise<void>;

  createPin(pin: InsertPin): Promise<Pin>;
  getPin(id: number): Promise<Pin | undefined>;
  getPhotoPins(photoId: number): Promise<Pin[]>;
  getSessionPins(sessionId: number): Promise<Pin[]>;
  getSessionPinsPaginated(sessionId: number, limit: number, offset: number): Promise<{ pins: Pin[]; total: number }>;
  updatePin(id: number, data: Partial<Pin>): Promise<Pin | undefined>;
  deletePin(id: number): Promise<void>;

  getSessionIncompletePins(sessionId: number): Promise<{ photoId: number; incompleteCount: number }[]>;
  resolveParentPinForDetailShot(detailPhotoId: number, entryId: number): Promise<void>;
  getSessionFlaggedPins(sessionId: number): Promise<Pin[]>;
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  findSettingsByTesterPassword(password: string): Promise<UserSettings | undefined>;
  getAllSettingsWithTesterPassword(): Promise<UserSettings[]>;
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
  duplicateSession(sessionId: number, userId: string, targetFolderId: number | null, name?: string, copyFileCallback?: (srcKey: string) => Promise<string>): Promise<Session>;
  resetSessionToPhotos(sessionId: number): Promise<void>;
  searchUserSessions(userId: string, query: string, searchInside: boolean, filters?: {
    status?: string;
    collaborator?: string;
    minFootage?: number;
    dateMonth?: number;
    dateYear?: number;
    wireType?: string;
  }): Promise<{ ownedIds: number[]; sharedIds: number[]; reasons: Record<number, string[]>; entrySnippets?: Record<number, { field: string; preview: string }[]> }>;
  searchSessionEntries(sessionId: number, query: string): Promise<{ entryId: number; field: string; preview: string }[]>;

  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  getSessionActivityLogs(sessionId: number, limit?: number, offset?: number, userId?: string): Promise<{ logs: ActivityLog[]; total: number }>;
  getSessionActivityUsers(sessionId: number): Promise<Array<{ userId: string; username: string | null }>>;

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

  createUserWireCategory(data: InsertUserWireCategory): Promise<UserWireCategory>;
  createUserWireCategoriesBulk(data: InsertUserWireCategory[]): Promise<UserWireCategory[]>;
  getUserWireCategories(userId: string): Promise<UserWireCategory[]>;
  deleteUserWireCategory(id: number, userId: string): Promise<void>;

  getDismissedDuplicates(sessionId: number): Promise<string[]>;
  addDismissedDuplicate(sessionId: number, key: string): Promise<DismissedDuplicate>;
  addDismissedDuplicatesBulk(sessionId: number, keys: string[]): Promise<void>;
  removeDismissedDuplicate(sessionId: number, key: string): Promise<void>;

  getSessionReviewResponses(sessionId: number): Promise<ReviewResponse[]>;
  upsertReviewResponse(data: InsertReviewResponse): Promise<ReviewResponse>;
  deleteReviewResponse(sessionId: number, entryId: number, userId: string): Promise<void>;
  resolveReviewResponsesByEntry(sessionId: number, entryId: number): Promise<void>;

  getRoleComparisonStats(userId: string): Promise<{
    Owner: { entries: number; footage: number; reels: number; photos: number };
    Editor: { entries: number; footage: number; reels: number; photos: number };
    Tester: { entries: number; footage: number; reels: number; photos: number };
    Viewer: { entries: number; footage: number; reels: number; photos: number };
    currentUserRoles: string[];
  }>;

  getStorageUsageForUser(userId: string): Promise<{
    userBytes: number;
    userPhotoCount: number;
    userSessionCount: number;
    unknownSizeCount: number;
  }>;

  getGlobalStorageUsage(): Promise<{
    totalBytes: number;
    totalPhotoCount: number;
    distinctUserCount: number;
  }>;

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

  getEnhancedStats(userId: string, sessionIds: number[]): Promise<{
    dataQuality: {
      totalFlaggedPins: number;
      totalPins: number;
      flagRate: number;
      totalReviewResponses: number;
      approvedCount: number;
      flaggedCount: number;
      dismissedDuplicateCount: number;
    };
    aiScanner: {
      totalScans: number;
      readableCount: number;
      unreadableCount: number;
    } | null;
    photoInsights: {
      totalDetailShots: number;
      totalRegularPhotos: number;
      avgPhotosPerSession: number;
      photosWithLinkedPins: number;
    };
    wireBreakdown: {
      topWireTypes: { wireType: string; count: number; footage: number }[];
      topGauges: { gauge: string; count: number; footage: number }[];
    };
    dailyActivity: { date: string; count: number }[];
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

  async getUserSessions(userId: string, options?: { trash?: boolean; limit?: number; offset?: number }): Promise<{ sessions: Session[]; total: number }> {
    const trash = options?.trash ?? false;
    const deletedCondition = trash
      ? isNotNull(countingSessions.deletedAt)
      : isNull(countingSessions.deletedAt);
    const conditions = and(eq(countingSessions.userId, userId), deletedCondition);

    const [totalResult] = await db.select({ count: count() }).from(countingSessions).where(conditions);
    const total = totalResult?.count ?? 0;

    let query = db.select().from(countingSessions)
      .where(conditions)
      .orderBy(trash ? desc(countingSessions.deletedAt) : desc(countingSessions.lastUpdatedAt));

    if (options?.limit) {
      query = query.limit(options.limit) as any;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as any;
    }

    const sessions = await query;
    return { sessions, total };
  }

  async updateSession(id: number, data: Partial<Session>): Promise<Session | undefined> {
    const [result] = await db.update(countingSessions)
      .set({ ...data, lastUpdatedAt: new Date() })
      .where(eq(countingSessions.id, id))
      .returning();
    return result;
  }

  async deleteSession(id: number): Promise<void> {
    await db.delete(countingSessions).where(eq(countingSessions.id, id));
  }

  async softDeleteSession(id: number): Promise<void> {
    await db.update(countingSessions)
      .set({ deletedAt: new Date() })
      .where(eq(countingSessions.id, id));
  }

  async restoreSession(id: number): Promise<void> {
    await db.update(countingSessions)
      .set({ deletedAt: null })
      .where(eq(countingSessions.id, id));
  }

  async getExpiredTrashSessions(olderThanDays: number): Promise<Session[]> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    return db.select().from(countingSessions)
      .where(and(
        isNotNull(countingSessions.deletedAt),
        lt(countingSessions.deletedAt, cutoff)
      ));
  }

  async createPhoto(photo: InsertPhoto): Promise<Photo> {
    const [result] = await db.insert(photos).values(photo).returning();
    return result;
  }

  async getPhoto(id: number): Promise<Photo | undefined> {
    const [result] = await db.select().from(photos).where(eq(photos.id, id));
    return result;
  }

  async getPhotoByStorageKey(key: string): Promise<Photo | undefined> {
    const [result] = await db.select().from(photos).where(eq(photos.objectStorageKey, key));
    return result;
  }

  async getSessionPhotos(sessionId: number): Promise<Photo[]> {
    return db.select().from(photos)
      .where(eq(photos.sessionId, sessionId))
      .orderBy(desc(photos.createdAt));
  }

  async getSessionPhotosPaginated(sessionId: number, limit: number, offset: number): Promise<{ photos: Photo[]; total: number }> {
    const [totalResult] = await db.select({ count: count() }).from(photos).where(eq(photos.sessionId, sessionId));
    const total = totalResult?.count ?? 0;
    const result = await db.select().from(photos)
      .where(eq(photos.sessionId, sessionId))
      .orderBy(desc(photos.createdAt))
      .limit(limit)
      .offset(offset);
    return { photos: result, total };
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
      await tx.update(photos).set({ isDetailShot: false }).where(eq(photos.parentPhotoId, id));
      const committedPinRows = await tx.select({ entryId: pins.entryId }).from(pins)
        .where(and(eq(pins.photoId, id), sql`${pins.entryId} IS NOT NULL`));
      const pinnedEntryIds = committedPinRows.map(r => r.entryId as number);
      if (pinnedEntryIds.length > 0) {
        await tx.delete(entries).where(inArray(entries.id, pinnedEntryIds));
      }
      await tx.delete(entries).where(eq(entries.photoId, id));
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

  async getSessionEntriesPaginated(sessionId: number, limit: number, offset: number): Promise<{ entries: Entry[]; total: number }> {
    const [totalResult] = await db.select({ count: count() }).from(entries).where(eq(entries.sessionId, sessionId));
    const total = totalResult?.count ?? 0;
    const result = await db.select().from(entries)
      .where(eq(entries.sessionId, sessionId))
      .orderBy(desc(entries.createdAt))
      .limit(limit)
      .offset(offset);
    return { entries: result, total };
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
      await tx.delete(pins).where(eq(pins.entryId, id));
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

  async getSessionPinsPaginated(sessionId: number, limit: number, offset: number): Promise<{ pins: Pin[]; total: number }> {
    const sessionPhotos = await db.select({ id: photos.id }).from(photos).where(eq(photos.sessionId, sessionId));
    if (sessionPhotos.length === 0) return { pins: [], total: 0 };
    const photoIds = sessionPhotos.map(p => p.id);
    const [totalResult] = await db.select({ count: count() }).from(pins).where(inArray(pins.photoId, photoIds));
    const total = totalResult?.count ?? 0;
    const result = await db.select().from(pins)
      .where(inArray(pins.photoId, photoIds))
      .orderBy(pins.id)
      .limit(limit)
      .offset(offset);
    return { pins: result, total };
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

  async resolveParentPinForDetailShot(detailPhotoId: number, entryId: number): Promise<void> {
    const [detailPhoto] = await db.select().from(photos).where(eq(photos.id, detailPhotoId)).limit(1);
    if (!detailPhoto?.isDetailShot || !detailPhoto.parentPhotoId || !detailPhoto.linkedPinLabel) return;
    await db
      .update(pins)
      .set({ entryId })
      .where(
        and(
          eq(pins.photoId, detailPhoto.parentPhotoId),
          eq(pins.label, detailPhoto.linkedPinLabel),
          isNull(pins.entryId)
        )
      );
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

  async findSettingsByTesterPassword(_password: string): Promise<UserSettings | undefined> {
    const results = await db.select().from(userSettings)
      .where(sql`${userSettings.testerPassword} IS NOT NULL`);
    return results[0];
  }

  async getAllSettingsWithTesterPassword(): Promise<UserSettings[]> {
    return db.select().from(userSettings)
      .where(sql`${userSettings.testerPassword} IS NOT NULL`);
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

  async transferSessionOwnership(sessionId: number, newOwnerId: string, _newOwnerUsername: string): Promise<void> {
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
      .where(and(inArray(countingSessions.id, sessionIds), isNull(countingSessions.deletedAt)))
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

  async duplicateSession(sessionId: number, userId: string, targetFolderId: number | null, name?: string, copyFileCallback?: (srcKey: string) => Promise<string>): Promise<Session> {
    const original = await this.getSession(sessionId);
    if (!original) throw new Error("Session not found");

    const [newSession] = await db.insert(countingSessions).values({
      userId,
      folderId: targetFolderId,
      name: name || `${original.name} (Copy)`,
      location: original.location,
      status: "active",
    }).returning();

    const originalPhotos = await this.getSessionPhotos(sessionId);
    const photoIdMap = new Map<number, number>();

    for (const photo of originalPhotos) {
      let newKey = photo.objectStorageKey;
      if (copyFileCallback) {
        try {
          newKey = await copyFileCallback(photo.objectStorageKey);
        } catch {
          newKey = photo.objectStorageKey;
        }
      }
      const { id: oldPhotoId, createdAt, ...photoRest } = photo;
      const [newPhoto] = await db.insert(photos).values({
        ...photoRest,
        sessionId: newSession.id,
        userId,
        objectStorageKey: newKey,
      }).returning();
      photoIdMap.set(oldPhotoId, newPhoto.id);
    }

    for (const [, newId] of photoIdMap) {
      const newPhoto = await this.getPhoto(newId);
      if (newPhoto && newPhoto.parentPhotoId && photoIdMap.has(newPhoto.parentPhotoId)) {
        await db.update(photos).set({ parentPhotoId: photoIdMap.get(newPhoto.parentPhotoId)! }).where(eq(photos.id, newId));
      }
    }

    const originalEntries = await this.getSessionEntries(sessionId);
    const entryIdMap = new Map<number, number>();
    for (const entry of originalEntries) {
      const { id: oldEntryId, sessionId: _, createdAt, updatedAt, ...rest } = entry;
      const newPhotoId = rest.photoId && photoIdMap.has(rest.photoId) ? photoIdMap.get(rest.photoId)! : rest.photoId;
      const [newEntry] = await db.insert(entries).values({ ...rest, photoId: newPhotoId, sessionId: newSession.id }).returning();
      entryIdMap.set(oldEntryId, newEntry.id);
    }

    const originalPins = await this.getSessionPins(sessionId);
    const pinIdMap = new Map<number, number>();
    for (const pin of originalPins) {
      const { id: oldPinId, ...pinRest } = pin;
      const newPhotoId = photoIdMap.has(pinRest.photoId) ? photoIdMap.get(pinRest.photoId)! : pinRest.photoId;
      const newEntryId = pinRest.entryId && entryIdMap.has(pinRest.entryId) ? entryIdMap.get(pinRest.entryId)! : pinRest.entryId;
      const [newPin] = await db.insert(pins).values({ ...pinRest, photoId: newPhotoId, entryId: newEntryId }).returning();
      pinIdMap.set(oldPinId, newPin.id);
    }

    const originalComments = await this.getSessionComments(sessionId);
    const commentIdMap = new Map<number, number>();
    for (const comment of originalComments) {
      const { id: oldId, createdAt, updatedAt, ...commentRest } = comment;
      const newEntryId = commentRest.entryId && entryIdMap.has(commentRest.entryId) ? entryIdMap.get(commentRest.entryId)! : commentRest.entryId;
      const newPhotoId = commentRest.photoId && photoIdMap.has(commentRest.photoId) ? photoIdMap.get(commentRest.photoId)! : commentRest.photoId;
      const [newComment] = await db.insert(comments).values({
        ...commentRest,
        sessionId: newSession.id,
        entryId: newEntryId,
        photoId: newPhotoId,
        parentCommentId: null,
      }).returning();
      commentIdMap.set(oldId, newComment.id);
    }
    for (const comment of originalComments) {
      if (comment.parentCommentId && commentIdMap.has(comment.parentCommentId)) {
        const newId = commentIdMap.get(comment.id)!;
        const newParentId = commentIdMap.get(comment.parentCommentId)!;
        await db.update(comments).set({ parentCommentId: newParentId }).where(eq(comments.id, newId));
      }
    }

    const originalScanResults = await this.getSessionScanResults(sessionId);
    for (const scan of originalScanResults) {
      const { id, createdAt, updatedAt, ...scanRest } = scan;
      const newPhotoId = photoIdMap.has(scanRest.photoId) ? photoIdMap.get(scanRest.photoId)! : scanRest.photoId;
      const newPinId = pinIdMap.has(scanRest.pinId) ? pinIdMap.get(scanRest.pinId)! : scanRest.pinId;
      await db.insert(scanResults).values({ ...scanRest, sessionId: newSession.id, photoId: newPhotoId, pinId: newPinId });
    }

    const dismissedKeys = await this.getDismissedDuplicates(sessionId);
    if (dismissedKeys.length > 0) {
      await db.insert(dismissedDuplicates).values(dismissedKeys.map(key => ({ sessionId: newSession.id, key })));
    }

    return newSession;
  }

  async resetSessionToPhotos(sessionId: number): Promise<void> {
    await db.transaction(async (tx) => {
      const sessionPhotos = await tx.select({ id: photos.id }).from(photos).where(eq(photos.sessionId, sessionId));
      if (sessionPhotos.length > 0) {
        const photoIds = sessionPhotos.map(p => p.id);
        await tx.delete(scanResults).where(eq(scanResults.sessionId, sessionId));
        await tx.delete(pins).where(inArray(pins.photoId, photoIds));
      }
      await tx.delete(comments).where(eq(comments.sessionId, sessionId));
      await tx.delete(entries).where(eq(entries.sessionId, sessionId));
      await tx.delete(dismissedDuplicates).where(eq(dismissedDuplicates.sessionId, sessionId));
      await tx.delete(reviewResponses).where(eq(reviewResponses.sessionId, sessionId));
      await tx.delete(activityLogs).where(eq(activityLogs.sessionId, sessionId));
      await tx.update(photos).set({ pinScale: 1, isDetailShot: false, parentPhotoId: null, linkedPinLabel: null }).where(eq(photos.sessionId, sessionId));
      await tx.update(countingSessions).set({ status: "active" }).where(eq(countingSessions.id, sessionId));
    });
  }

  async searchSessionEntries(sessionId: number, query: string): Promise<{ entryId: number; field: string; preview: string }[]> {
    const pattern = `%${query}%`;
    const lowerQuery = query.toLowerCase();
    const matchingEntries = await db.select().from(entries)
      .where(and(
        eq(entries.sessionId, sessionId),
        or(
          ilike(sql`COALESCE(${entries.reelTag}, '')`, pattern),
          ilike(sql`COALESCE(${entries.wireType}, '')`, pattern),
          ilike(sql`COALESCE(${entries.gauge}, '')`, pattern),
          ilike(sql`COALESCE(${entries.color}, '')`, pattern),
          ilike(sql`COALESCE(${entries.manufacturer}, '')`, pattern),
          ilike(sql`COALESCE(${entries.notes}, '')`, pattern),
          ilike(sql`COALESCE(${entries.aisle}, '')`, pattern),
          ilike(sql`COALESCE(${entries.section}, '')`, pattern),
        )
      ));
    const results: { entryId: number; field: string; preview: string }[] = [];
    const fieldOrder: { field: string; val: (e: typeof matchingEntries[0]) => string | null }[] = [
      { field: "Reel Tag", val: e => e.reelTag },
      { field: "Wire Type", val: e => e.wireType },
      { field: "Gauge", val: e => e.gauge },
      { field: "Color", val: e => e.color },
      { field: "Manufacturer", val: e => e.manufacturer },
      { field: "Notes", val: e => e.notes },
      { field: "Aisle", val: e => e.aisle },
      { field: "Section", val: e => e.section },
    ];
    for (const entry of matchingEntries) {
      for (const { field, val } of fieldOrder) {
        const v = val(entry);
        if (v && v.toLowerCase().includes(lowerQuery)) {
          const idx = v.toLowerCase().indexOf(lowerQuery);
          const start = Math.max(0, idx - 20);
          const end = Math.min(v.length, idx + query.length + 20);
          const preview = (start > 0 ? "…" : "") + v.slice(start, end) + (end < v.length ? "…" : "");
          results.push({ entryId: entry.id, field, preview });
          break;
        }
      }
    }
    return results;
  }

  async searchUserSessions(userId: string, query: string, searchInside: boolean, filters?: {
    status?: string;
    collaborator?: string;
    minFootage?: number;
    dateMonth?: number;
    dateYear?: number;
    wireType?: string;
  }): Promise<{
    ownedIds: number[];
    sharedIds: number[];
    reasons: Record<number, string[]>;
    entrySnippets?: Record<number, { field: string; preview: string }[]>;
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

    let dateMonth: number | null = filters?.dateMonth ?? null;
    let dateYear: number | null = filters?.dateYear ?? null;
    if (!dateMonth && !dateYear) {
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
    }

    let statusFilter: string | null = filters?.status ?? null;
    if (!statusFilter && (lowerQuery === "active" || lowerQuery === "completed")) {
      statusFilter = lowerQuery;
    }

    let footageMin: number | null = filters?.minFootage ?? null;
    if (footageMin === null) {
      const footageMatch = lowerQuery.match(/^[>]?\s*(\d+)\+?\s*(ft|feet|footage)?$/);
      if (footageMatch && parseInt(footageMatch[1]) >= 100) {
        footageMin = parseInt(footageMatch[1]);
      }
    }

    let reelMin: number | null = null;
    const reelMatch = lowerQuery.match(/^[>]?\s*(\d+)\+?\s*reels?$/);
    if (reelMatch) {
      reelMin = parseInt(reelMatch[1]);
    }

    const collaboratorFilter = filters?.collaborator?.trim().toLowerCase() ?? null;
    const wireTypeFilter = filters?.wireType?.trim().toLowerCase() ?? null;

    const hasStructuredFilters = !!(statusFilter || dateMonth || dateYear || footageMin || collaboratorFilter || wireTypeFilter);

    const matchesStructuredFilters = async (sessionIds: number[], sessionList: (typeof countingSessions.$inferSelect)[]): Promise<Set<number>> => {
      if (!hasStructuredFilters) return new Set(sessionIds);

      let eligible = new Set(sessionIds);

      if (statusFilter) {
        eligible = new Set([...eligible].filter(id => {
          const s = sessionList.find(s => s.id === id);
          return s && s.status === statusFilter;
        }));
      }

      if (dateMonth || dateYear) {
        eligible = new Set([...eligible].filter(id => {
          const s = sessionList.find(s => s.id === id);
          if (!s) return false;
          const d = new Date(s.startedAt);
          const mMatch = dateMonth ? d.getMonth() + 1 === dateMonth : true;
          const yMatch = dateYear ? d.getFullYear() === dateYear : true;
          return mMatch && yMatch;
        }));
      }

      if ((footageMin !== null || reelMin !== null) && eligible.size > 0) {
        const eligibleArr = Array.from(eligible);
        const stats = await this.getSessionStats(eligibleArr);
        if (footageMin !== null) {
          eligible = new Set([...eligible].filter(id => {
            const stat = stats.get(id);
            return stat && stat.totalFootage >= footageMin!;
          }));
        }
        if (reelMin !== null) {
          eligible = new Set([...eligible].filter(id => {
            const stat = stats.get(id);
            return stat && stat.entryCount >= reelMin!;
          }));
        }
      }

      if (collaboratorFilter && eligible.size > 0) {
        const eligibleArr = Array.from(eligible);
        const collabPattern = `%${collaboratorFilter}%`;
        const collabMatches = await db.select({ sessionId: sessionCollaborators.sessionId })
          .from(sessionCollaborators)
          .where(and(
            inArray(sessionCollaborators.sessionId, eligibleArr),
            ilike(sql`COALESCE(${sessionCollaborators.username}, '')`, collabPattern),
          ))
          .groupBy(sessionCollaborators.sessionId);
        const withCollab = new Set(collabMatches.map(m => m.sessionId));
        eligible = new Set([...eligible].filter(id => withCollab.has(id)));
      }

      if (wireTypeFilter && eligible.size > 0) {
        const eligibleArr = Array.from(eligible);
        const wirePattern = `%${wireTypeFilter}%`;
        const wireMatches = await db.select({ sessionId: entries.sessionId })
          .from(entries)
          .where(and(
            inArray(entries.sessionId, eligibleArr),
            ilike(sql`COALESCE(${entries.wireType}, '')`, wirePattern),
          ))
          .groupBy(entries.sessionId);
        const withWire = new Set(wireMatches.map(m => m.sessionId));
        eligible = new Set([...eligible].filter(id => withWire.has(id)));
      }

      return eligible;
    };

    const buildSnippets = (matchingEntries: (typeof entries.$inferSelect)[], targetSet: Set<number>) => {
      const snippets: Record<number, { field: string; preview: string }[]> = {};
      const sessionSnippetCount: Record<number, number> = {};
      for (const entry of matchingEntries) {
        if (!targetSet.has(entry.sessionId)) continue;
        const count = sessionSnippetCount[entry.sessionId] ?? 0;
        if (count >= 2) continue;
        const fieldValues: { field: string; val: string | null }[] = [
          { field: "Notes", val: entry.notes },
          { field: "Wire Type", val: entry.wireType },
          { field: "Reel Tag", val: entry.reelTag },
          { field: "Gauge", val: entry.gauge },
          { field: "Color", val: entry.color },
          { field: "Manufacturer", val: entry.manufacturer },
          { field: "Aisle", val: entry.aisle },
          { field: "Section", val: entry.section },
        ];
        for (const { field, val } of fieldValues) {
          if (val && val.toLowerCase().includes(lowerQuery)) {
            const idx = val.toLowerCase().indexOf(lowerQuery);
            const start = Math.max(0, idx - 20);
            const end = Math.min(val.length, idx + query.length + 20);
            const preview = (start > 0 ? "…" : "") + val.slice(start, end) + (end < val.length ? "…" : "");
            if (!snippets[entry.sessionId]) snippets[entry.sessionId] = [];
            snippets[entry.sessionId].push({ field, preview });
            sessionSnippetCount[entry.sessionId] = count + 1;
            break;
          }
        }
      }
      return snippets;
    };

    const allUserSessions = await db.select().from(countingSessions)
      .where(and(eq(countingSessions.userId, userId), isNull(countingSessions.deletedAt)));
    const allSessionIds = allUserSessions.map(s => s.id);

    const textMatchedOwned = new Set<number>();
    if (lowerQuery) {
      for (const s of allUserSessions) {
        if (s.name.toLowerCase().includes(lowerQuery)) { textMatchedOwned.add(s.id); addReason(s.id, "name"); }
        if (s.location && s.location.toLowerCase().includes(lowerQuery)) { textMatchedOwned.add(s.id); addReason(s.id, "location"); }
      }
    }

    if (allSessionIds.length > 0 && lowerQuery) {
      const collabMatches = await db.select({ sessionId: sessionCollaborators.sessionId })
        .from(sessionCollaborators)
        .where(and(
          inArray(sessionCollaborators.sessionId, allSessionIds),
          ilike(sql`COALESCE(${sessionCollaborators.username}, '')`, pattern),
        ))
        .groupBy(sessionCollaborators.sessionId);
      for (const m of collabMatches) { textMatchedOwned.add(m.sessionId); addReason(m.sessionId, "collaborator"); }
    }

    let entryMatchedOwned = new Set<number>();
    let ownedEntryMatches: (typeof entries.$inferSelect)[] = [];
    if (searchInside && allSessionIds.length > 0 && lowerQuery) {
      ownedEntryMatches = await db.select().from(entries)
        .where(and(
          inArray(entries.sessionId, allSessionIds),
          or(
            ilike(sql`COALESCE(${entries.reelTag}, '')`, pattern),
            ilike(sql`COALESCE(${entries.wireType}, '')`, pattern),
            ilike(sql`COALESCE(${entries.gauge}, '')`, pattern),
            ilike(sql`COALESCE(${entries.color}, '')`, pattern),
            ilike(sql`COALESCE(${entries.manufacturer}, '')`, pattern),
            ilike(sql`COALESCE(${entries.notes}, '')`, pattern),
            ilike(sql`COALESCE(${entries.aisle}, '')`, pattern),
            ilike(sql`COALESCE(${entries.section}, '')`, pattern),
          )
        ));
      for (const entry of ownedEntryMatches) { entryMatchedOwned.add(entry.sessionId); addReason(entry.sessionId, "entries"); }
    }

    const textMatched = new Set([...textMatchedOwned, ...entryMatchedOwned]);

    let eligibleOwned: Set<number>;
    if (hasStructuredFilters) {
      eligibleOwned = await matchesStructuredFilters(allSessionIds, allUserSessions);
      if (lowerQuery) {
        eligibleOwned = new Set([...eligibleOwned].filter(id => textMatched.has(id)));
      }
    } else {
      eligibleOwned = textMatched;
    }

    for (const s of allUserSessions) {
      if (!eligibleOwned.has(s.id)) {
        delete reasons[s.id];
      } else if (!reasons[s.id] || reasons[s.id].length === 0) {
        if (statusFilter) addReason(s.id, "status");
        if (dateMonth || dateYear) addReason(s.id, "date");
        if (footageMin !== null) addReason(s.id, "footage");
        if (collaboratorFilter) addReason(s.id, "collaborator");
        if (wireTypeFilter) addReason(s.id, "wire_type");
      }
    }

    const entrySnippets: Record<number, { field: string; preview: string }[]> = {};
    if (searchInside && ownedEntryMatches.length > 0) {
      const snippets = buildSnippets(ownedEntryMatches, eligibleOwned);
      Object.assign(entrySnippets, snippets);
    }

    const ownedMatched = eligibleOwned;

    const sharedMatched = new Set<number>();
    const collabs = await db.select().from(sessionCollaborators)
      .where(eq(sessionCollaborators.userId, userId));
    if (collabs.length > 0) {
      const sharedSessionIds = collabs.map(c => c.sessionId);
      const sharedSessions = await db.select().from(countingSessions)
        .where(inArray(countingSessions.id, sharedSessionIds));

      const textMatchedShared = new Set<number>();
      if (lowerQuery) {
        for (const s of sharedSessions) {
          if (s.name.toLowerCase().includes(lowerQuery)) { textMatchedShared.add(s.id); addReason(s.id, "name"); }
          if (s.location && s.location.toLowerCase().includes(lowerQuery)) { textMatchedShared.add(s.id); addReason(s.id, "location"); }
        }
      }

      let sharedEntryMatches: (typeof entries.$inferSelect)[] = [];
      const entryMatchedShared = new Set<number>();
      if (searchInside && sharedSessionIds.length > 0 && lowerQuery) {
        sharedEntryMatches = await db.select().from(entries)
          .where(and(
            inArray(entries.sessionId, sharedSessionIds),
            or(
              ilike(sql`COALESCE(${entries.reelTag}, '')`, pattern),
              ilike(sql`COALESCE(${entries.wireType}, '')`, pattern),
              ilike(sql`COALESCE(${entries.gauge}, '')`, pattern),
              ilike(sql`COALESCE(${entries.color}, '')`, pattern),
              ilike(sql`COALESCE(${entries.manufacturer}, '')`, pattern),
              ilike(sql`COALESCE(${entries.notes}, '')`, pattern),
              ilike(sql`COALESCE(${entries.aisle}, '')`, pattern),
              ilike(sql`COALESCE(${entries.section}, '')`, pattern),
            )
          ));
        for (const entry of sharedEntryMatches) { entryMatchedShared.add(entry.sessionId); addReason(entry.sessionId, "entries"); }
      }

      const textMatchedSharedAll = new Set([...textMatchedShared, ...entryMatchedShared]);

      let eligibleShared: Set<number>;
      if (hasStructuredFilters) {
        eligibleShared = await matchesStructuredFilters(sharedSessionIds, sharedSessions);
        if (lowerQuery) {
          eligibleShared = new Set([...eligibleShared].filter(id => textMatchedSharedAll.has(id)));
        }
      } else {
        eligibleShared = textMatchedSharedAll;
      }

      for (const s of sharedSessions) {
        if (!eligibleShared.has(s.id)) {
          delete reasons[s.id];
        } else if (!reasons[s.id] || reasons[s.id].length === 0) {
          if (statusFilter) addReason(s.id, "status");
          if (dateMonth || dateYear) addReason(s.id, "date");
          if (footageMin !== null) addReason(s.id, "footage");
          if (collaboratorFilter) addReason(s.id, "collaborator");
          if (wireTypeFilter) addReason(s.id, "wire_type");
        }
      }

      for (const id of eligibleShared) sharedMatched.add(id);

      if (searchInside && sharedEntryMatches.length > 0) {
        const snippets = buildSnippets(sharedEntryMatches, eligibleShared);
        Object.assign(entrySnippets, snippets);
      }
    }

    return {
      ownedIds: Array.from(ownedMatched),
      sharedIds: Array.from(sharedMatched),
      reasons,
      entrySnippets,
    };
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const [result] = await db.insert(activityLogs).values(log).returning();
    return result;
  }

  async getSessionActivityLogs(sessionId: number, limit = 50, offset = 0, userId?: string): Promise<{ logs: ActivityLog[]; total: number }> {
    const conditions = [eq(activityLogs.sessionId, sessionId)];
    if (userId) conditions.push(eq(activityLogs.userId, userId));
    const [totalResult] = await db.select({ count: count() }).from(activityLogs).where(and(...conditions));
    const total = totalResult?.count ?? 0;
    const logs = await db.select().from(activityLogs)
      .where(and(...conditions))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit)
      .offset(offset);
    return { logs, total };
  }

  async getSessionActivityUsers(sessionId: number): Promise<Array<{ userId: string; username: string | null }>> {
    const rows = await db.selectDistinctOn([activityLogs.userId], {
      userId: activityLogs.userId,
      username: activityLogs.username,
    }).from(activityLogs)
      .where(eq(activityLogs.sessionId, sessionId))
      .orderBy(activityLogs.userId);
    return rows;
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

  async getEnhancedStats(_userId: string, sessionIds: number[]): Promise<{
    dataQuality: {
      totalFlaggedPins: number;
      totalPins: number;
      flagRate: number;
      totalReviewResponses: number;
      approvedCount: number;
      flaggedCount: number;
      dismissedDuplicateCount: number;
    };
    aiScanner: {
      totalScans: number;
      readableCount: number;
      unreadableCount: number;
    } | null;
    photoInsights: {
      totalDetailShots: number;
      totalRegularPhotos: number;
      avgPhotosPerSession: number;
      photosWithLinkedPins: number;
    };
    wireBreakdown: {
      topWireTypes: { wireType: string; count: number; footage: number }[];
      topGauges: { gauge: string; count: number; footage: number }[];
    };
    dailyActivity: { date: string; count: number }[];
  }> {
    if (sessionIds.length === 0) {
      return {
        dataQuality: { totalFlaggedPins: 0, totalPins: 0, flagRate: 0, totalReviewResponses: 0, approvedCount: 0, flaggedCount: 0, dismissedDuplicateCount: 0 },
        aiScanner: null,
        photoInsights: { totalDetailShots: 0, totalRegularPhotos: 0, avgPhotosPerSession: 0, photosWithLinkedPins: 0 },
        wireBreakdown: { topWireTypes: [], topGauges: [] },
        dailyActivity: [],
      };
    }

    const sessionPhotoIds = db.select({ id: photos.id }).from(photos).where(inArray(photos.sessionId, sessionIds));

    const [pinStats] = await db.select({
      totalPins: count(),
      flaggedPins: sql<number>`count(*) filter (where ${pins.flagged} = true)`,
    }).from(pins).where(inArray(pins.photoId, sessionPhotoIds));

    const totalPins = Number(pinStats.totalPins) || 0;
    const totalFlaggedPins = Number(pinStats.flaggedPins) || 0;
    const flagRate = totalPins > 0 ? Math.round((totalFlaggedPins / totalPins) * 1000) / 10 : 0;

    const [reviewStats] = await db.select({
      total: count(),
      approved: sql<number>`count(*) filter (where ${reviewResponses.verdict} = 'approved')`,
      flagged: sql<number>`count(*) filter (where ${reviewResponses.verdict} = 'flagged')`,
    }).from(reviewResponses).where(inArray(reviewResponses.sessionId, sessionIds));

    const [dismissedStats] = await db.select({
      total: count(),
    }).from(dismissedDuplicates).where(inArray(dismissedDuplicates.sessionId, sessionIds));

    const [scanStats] = await db.select({
      total: count(),
      readable: sql<number>`count(*) filter (where ${scanResults.readable} = true)`,
    }).from(scanResults).where(inArray(scanResults.sessionId, sessionIds));

    const totalScans = Number(scanStats.total) || 0;
    const aiScanner = totalScans > 0 ? {
      totalScans,
      readableCount: Number(scanStats.readable) || 0,
      unreadableCount: totalScans - (Number(scanStats.readable) || 0),
    } : null;

    const [photoInsightsRaw] = await db.select({
      totalDetailShots: sql<number>`count(*) filter (where ${photos.isDetailShot} = true)`,
      totalRegularPhotos: sql<number>`count(*) filter (where ${photos.isDetailShot} = false or ${photos.isDetailShot} is null)`,
      totalPhotos: count(),
    }).from(photos).where(inArray(photos.sessionId, sessionIds));

    const totalPhotosCount = Number(photoInsightsRaw.totalPhotos) || 0;
    const avgPhotosPerSession = sessionIds.length > 0 ? Math.round((totalPhotosCount / sessionIds.length) * 10) / 10 : 0;

    const [linkedPinPhotos] = await db.select({
      count: sql<number>`count(distinct ${pins.photoId})`,
    }).from(pins)
      .innerJoin(photos, eq(pins.photoId, photos.id))
      .where(and(inArray(photos.sessionId, sessionIds), isNotNull(pins.entryId)));

    const topWireTypesRaw = await db.select({
      wireType: entries.wireType,
      count: count(),
      footage: sum(entries.footage),
    }).from(entries)
      .where(and(inArray(entries.sessionId, sessionIds), sql`${entries.wireType} IS NOT NULL AND ${entries.wireType} != ''`))
      .groupBy(entries.wireType)
      .orderBy(desc(count()))
      .limit(10);

    const topGaugesRaw = await db.select({
      gauge: entries.gauge,
      count: count(),
      footage: sum(entries.footage),
    }).from(entries)
      .where(and(inArray(entries.sessionId, sessionIds), sql`${entries.gauge} IS NOT NULL AND ${entries.gauge} != ''`))
      .groupBy(entries.gauge)
      .orderBy(desc(count()))
      .limit(10);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyActivityRaw = await db.select({
      date: sql<string>`to_char(${entries.createdAt}::date, 'YYYY-MM-DD')`,
      count: count(),
    }).from(entries)
      .where(and(
        inArray(entries.sessionId, sessionIds),
        sql`${entries.createdAt} >= ${thirtyDaysAgo.toISOString()}`,
      ))
      .groupBy(sql`${entries.createdAt}::date`)
      .orderBy(sql`${entries.createdAt}::date`);

    return {
      dataQuality: {
        totalFlaggedPins,
        totalPins,
        flagRate,
        totalReviewResponses: Number(reviewStats.total) || 0,
        approvedCount: Number(reviewStats.approved) || 0,
        flaggedCount: Number(reviewStats.flagged) || 0,
        dismissedDuplicateCount: Number(dismissedStats.total) || 0,
      },
      aiScanner,
      photoInsights: {
        totalDetailShots: Number(photoInsightsRaw.totalDetailShots) || 0,
        totalRegularPhotos: Number(photoInsightsRaw.totalRegularPhotos) || 0,
        avgPhotosPerSession,
        photosWithLinkedPins: Number(linkedPinPhotos.count) || 0,
      },
      wireBreakdown: {
        topWireTypes: topWireTypesRaw.map(w => ({
          wireType: w.wireType!,
          count: Number(w.count),
          footage: Number(w.footage) || 0,
        })),
        topGauges: topGaugesRaw.map(g => ({
          gauge: g.gauge!,
          count: Number(g.count),
          footage: Number(g.footage) || 0,
        })),
      },
      dailyActivity: dailyActivityRaw.map(d => ({
        date: d.date,
        count: Number(d.count),
      })),
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

  async getRoleComparisonStats(userId: string): Promise<{
    Owner: { entries: number; footage: number; reels: number; photos: number };
    Editor: { entries: number; footage: number; reels: number; photos: number };
    Tester: { entries: number; footage: number; reels: number; photos: number };
    Viewer: { entries: number; footage: number; reels: number; photos: number };
    currentUserRoles: string[];
  }> {
    const emptyResult = {
      Owner: { entries: 0, footage: 0, reels: 0, photos: 0 },
      Editor: { entries: 0, footage: 0, reels: 0, photos: 0 },
      Tester: { entries: 0, footage: 0, reels: 0, photos: 0 },
      Viewer: { entries: 0, footage: 0, reels: 0, photos: 0 },
      currentUserRoles: [] as string[],
    };

    const ownedSessions = await db.select({ id: countingSessions.id, ownerId: countingSessions.userId })
      .from(countingSessions)
      .where(eq(countingSessions.userId, userId));

    const collabRows = await db.select({ sessionId: sessionCollaborators.sessionId })
      .from(sessionCollaborators)
      .where(eq(sessionCollaborators.userId, userId));

    const collabSessionIds = collabRows.map(c => c.sessionId);
    let collabSessions: { id: number; ownerId: string }[] = [];
    if (collabSessionIds.length > 0) {
      collabSessions = await db.select({ id: countingSessions.id, ownerId: countingSessions.userId })
        .from(countingSessions)
        .where(inArray(countingSessions.id, collabSessionIds));
    }

    const allSessionMap = new Map<number, { id: number; ownerId: string }>();
    for (const s of ownedSessions) allSessionMap.set(s.id, s);
    for (const s of collabSessions) allSessionMap.set(s.id, s);

    const allSessionIds = Array.from(allSessionMap.keys());
    if (allSessionIds.length === 0) return emptyResult;

    const allCollabs = await db.select({
      sessionId: sessionCollaborators.sessionId,
      odUserId: sessionCollaborators.userId,
      role: sessionCollaborators.role,
    }).from(sessionCollaborators)
      .where(inArray(sessionCollaborators.sessionId, allSessionIds));

    const collabRoleMap = new Map<string, string>();
    for (const c of allCollabs) {
      collabRoleMap.set(`${c.sessionId}:${c.odUserId}`, c.role);
    }

    const determineRole = (contributorUserId: string, sessionId: number): "Owner" | "Editor" | "Tester" | "Viewer" => {
      const session = allSessionMap.get(sessionId);
      if (session && contributorUserId === session.ownerId) return "Owner";
      if (contributorUserId.startsWith("tester-")) return "Tester";
      const collabRole = collabRoleMap.get(`${sessionId}:${contributorUserId}`);
      if (collabRole === "viewer") return "Viewer";
      return "Editor";
    };

    const currentUserRolesSet = new Set<string>();
    for (const sId of allSessionIds) {
      currentUserRolesSet.add(determineRole(userId, sId));
    }

    const result = {
      Owner: { entries: 0, footage: 0, reels: 0, photos: 0 },
      Editor: { entries: 0, footage: 0, reels: 0, photos: 0 },
      Tester: { entries: 0, footage: 0, reels: 0, photos: 0 },
      Viewer: { entries: 0, footage: 0, reels: 0, photos: 0 },
      currentUserRoles: Array.from(currentUserRolesSet),
    };

    const entryAgg = await db.select({
      sessionId: entries.sessionId,
      eUserId: entries.userId,
      entryCount: count(),
      reelCount: sum(entries.reelCount),
      footage: sum(entries.footage),
    }).from(entries)
      .where(inArray(entries.sessionId, allSessionIds))
      .groupBy(entries.sessionId, entries.userId);

    for (const e of entryAgg) {
      const role = determineRole(e.eUserId, e.sessionId);
      result[role].entries += Number(e.entryCount) || 0;
      result[role].reels += Number(e.reelCount) || 0;
      result[role].footage += Number(e.footage) || 0;
    }

    const photoAgg = await db.select({
      sessionId: photos.sessionId,
      pUserId: photos.userId,
      photoCount: count(),
    }).from(photos)
      .where(inArray(photos.sessionId, allSessionIds))
      .groupBy(photos.sessionId, photos.userId);

    for (const p of photoAgg) {
      const role = determineRole(p.pUserId, p.sessionId);
      result[role].photos += Number(p.photoCount) || 0;
    }

    return result;
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

  async getStorageUsageForUser(userId: string): Promise<{
    userBytes: number;
    userPhotoCount: number;
    userSessionCount: number;
    unknownSizeCount: number;
  }> {
    const userSessionRows = await db.select({ id: countingSessions.id })
      .from(countingSessions)
      .where(eq(countingSessions.userId, userId));
    const userSessionIds = userSessionRows.map(r => r.id);

    let userBytes = 0;
    let userPhotoCount = 0;
    let unknownSizeCount = 0;
    if (userSessionIds.length > 0) {
      const userResult = await db.select({
        totalSize: sql<string>`coalesce(sum(${photos.fileSize}), 0)`,
        photoCount: sql<string>`count(*)`,
        unknownCount: sql<string>`count(*) filter (where ${photos.fileSize} is null)`,
      })
        .from(photos)
        .where(inArray(photos.sessionId, userSessionIds));
      userBytes = parseInt(userResult[0]?.totalSize || "0", 10);
      userPhotoCount = parseInt(userResult[0]?.photoCount || "0", 10);
      unknownSizeCount = parseInt(userResult[0]?.unknownCount || "0", 10);
    }

    return {
      userBytes,
      userPhotoCount,
      userSessionCount: userSessionIds.length,
      unknownSizeCount,
    };
  }

  async getGlobalStorageUsage(): Promise<{
    totalBytes: number;
    totalPhotoCount: number;
    distinctUserCount: number;
  }> {
    const result = await db.select({
      totalSize: sql<string>`coalesce(sum(${photos.fileSize}), 0)`,
      photoCount: sql<string>`count(*)`,
      userCount: sql<string>`count(distinct ${countingSessions.userId})`,
    })
      .from(photos)
      .innerJoin(countingSessions, eq(photos.sessionId, countingSessions.id));

    return {
      totalBytes: parseInt(result[0]?.totalSize || "0", 10),
      totalPhotoCount: parseInt(result[0]?.photoCount || "0", 10),
      distinctUserCount: parseInt(result[0]?.userCount || "0", 10),
    };
  }

  async createUserWireCategory(data: InsertUserWireCategory): Promise<UserWireCategory> {
    const [result] = await db.insert(userWireCategories).values(data).returning();
    return result;
  }

  async createUserWireCategoriesBulk(data: InsertUserWireCategory[]): Promise<UserWireCategory[]> {
    if (data.length === 0) return [];
    return db.insert(userWireCategories).values(data).returning();
  }

  async getUserWireCategories(userId: string): Promise<UserWireCategory[]> {
    return db.select().from(userWireCategories).where(eq(userWireCategories.userId, userId));
  }

  async deleteUserWireCategory(id: number, userId: string): Promise<void> {
    await db.delete(userWireCategories).where(and(eq(userWireCategories.id, id), eq(userWireCategories.userId, userId)));
  }

  async getDismissedDuplicates(sessionId: number): Promise<string[]> {
    const rows = await db.select({ key: dismissedDuplicates.key })
      .from(dismissedDuplicates)
      .where(eq(dismissedDuplicates.sessionId, sessionId));
    return rows.map(r => r.key);
  }

  async addDismissedDuplicate(sessionId: number, key: string): Promise<DismissedDuplicate> {
    const existing = await db.select().from(dismissedDuplicates)
      .where(and(eq(dismissedDuplicates.sessionId, sessionId), eq(dismissedDuplicates.key, key)));
    if (existing.length > 0) return existing[0];
    const [result] = await db.insert(dismissedDuplicates).values({ sessionId, key }).returning();
    return result;
  }

  async addDismissedDuplicatesBulk(sessionId: number, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const existing = await db.select({ key: dismissedDuplicates.key })
      .from(dismissedDuplicates)
      .where(and(eq(dismissedDuplicates.sessionId, sessionId), inArray(dismissedDuplicates.key, keys)));
    const existingSet = new Set(existing.map(r => r.key));
    const newKeys = keys.filter(k => !existingSet.has(k));
    if (newKeys.length === 0) return;
    await db.insert(dismissedDuplicates).values(newKeys.map(key => ({ sessionId, key })));
  }

  async removeDismissedDuplicate(sessionId: number, key: string): Promise<void> {
    await db.delete(dismissedDuplicates)
      .where(and(eq(dismissedDuplicates.sessionId, sessionId), eq(dismissedDuplicates.key, key)));
  }

  async getSessionReviewResponses(sessionId: number): Promise<ReviewResponse[]> {
    return db.select().from(reviewResponses)
      .where(eq(reviewResponses.sessionId, sessionId))
      .orderBy(desc(reviewResponses.createdAt));
  }

  async upsertReviewResponse(data: InsertReviewResponse): Promise<ReviewResponse> {
    const existing = await db.select().from(reviewResponses)
      .where(and(
        eq(reviewResponses.sessionId, data.sessionId),
        eq(reviewResponses.entryId, data.entryId),
        eq(reviewResponses.userId, data.userId),
      ));
    if (existing.length > 0) {
      const [result] = await db.update(reviewResponses)
        .set({ verdict: data.verdict, flagReason: data.flagReason ?? null, username: data.username ?? null })
        .where(eq(reviewResponses.id, existing[0].id))
        .returning();
      return result;
    }
    const [result] = await db.insert(reviewResponses).values(data).returning();
    return result;
  }

  async deleteReviewResponse(sessionId: number, entryId: number, userId: string): Promise<void> {
    await db.delete(reviewResponses)
      .where(and(
        eq(reviewResponses.sessionId, sessionId),
        eq(reviewResponses.entryId, entryId),
        eq(reviewResponses.userId, userId),
      ));
  }

  async resolveReviewResponsesByEntry(sessionId: number, entryId: number): Promise<void> {
    await db.update(reviewResponses)
      .set({ verdict: "approved", flagReason: null })
      .where(and(
        eq(reviewResponses.sessionId, sessionId),
        eq(reviewResponses.entryId, entryId),
        eq(reviewResponses.verdict, "flagged"),
      ));
  }
}

export const storage = new DatabaseStorage();
