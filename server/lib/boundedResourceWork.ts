import type { Request, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { and, eq, gt, isNull, desc } from "drizzle-orm";
import { entries, photos, pins, countingSessions } from "@shared/schema";
import type { db } from "../db";

export const RESOURCE_WORK_LIMITS = {
  excelEntries: 5_000,
  excelPhotos: 2_000,
  excelPins: 10_000,
  backfillPhotos: 100,
  backfillBudgetMs: 15_000,
  metadataTimeoutMs: 3_000,
} as const;

export class ExportWorkLimitError extends Error {
  constructor() {
    super("Session exceeds the Excel export limit (5,000 entries, 2,000 photos or 10,000 pins). Export a smaller session.");
  }
}

// Limit in SQL, not after materializing an unbounded session. The extra row
// detects overflow without silently truncating an inventory report.
export async function loadBoundedExcelData(database: typeof db, sessionId: number) {
  const rawEntries = await database.select().from(entries)
    .where(eq(entries.sessionId, sessionId)).orderBy(desc(entries.createdAt))
    .limit(RESOURCE_WORK_LIMITS.excelEntries + 1);
  if (rawEntries.length > RESOURCE_WORK_LIMITS.excelEntries) throw new ExportWorkLimitError();
  const sessionPhotos = await database.select().from(photos)
    .where(eq(photos.sessionId, sessionId))
    .limit(RESOURCE_WORK_LIMITS.excelPhotos + 1);
  if (sessionPhotos.length > RESOURCE_WORK_LIMITS.excelPhotos) throw new ExportWorkLimitError();
  const pinRows = await database.select({ pin: pins }).from(pins)
    .innerJoin(photos, eq(pins.photoId, photos.id))
    .where(eq(photos.sessionId, sessionId)).orderBy(pins.id)
    .limit(RESOURCE_WORK_LIMITS.excelPins + 1);
  if (pinRows.length > RESOURCE_WORK_LIMITS.excelPins) throw new ExportWorkLimitError();
  return { rawEntries, sessionPhotos, sessionPins: pinRows.map(row => row.pin) };
}

// Join directly to ownership rather than loading every session ID first.
export function selectBackfillBatch(database: typeof db, userId: string, afterPhotoId = 0) {
  return database.select({ id: photos.id, objectStorageKey: photos.objectStorageKey })
    .from(photos).innerJoin(countingSessions, eq(photos.sessionId, countingSessions.id))
    .where(and(eq(countingSessions.userId, userId), isNull(countingSessions.deletedAt),
      isNull(photos.fileSize), gt(photos.id, afterPhotoId)))
    // One lookahead row determines continuation; it never triggers cloud work.
    .orderBy(photos.id).limit(RESOURCE_WORK_LIMITS.backfillPhotos + 1);
}

export function sectionKey(aisle: string | null, section: string | null): string {
  // Tuple encoding prevents user-supplied delimiters from merging locations.
  return JSON.stringify([aisle || "", section || ""]);
}

export function aggregateSections(input: Iterable<{
  aisle: string | null; section: string | null; reelCount: number | null; footage: number | null;
}>) {
  const totals = new Map<string, { entries: number; reels: number; footage: number }>();
  for (const entry of input) {
    const key = sectionKey(entry.aisle, entry.section);
    const total = totals.get(key) ?? { entries: 0, reels: 0, footage: 0 };
    total.entries++;
    total.reels += entry.reelCount || 1;
    total.footage += entry.footage || 0;
    totals.set(key, total);
  }
  return totals;
}

export function createResourceProtection(
  userKey: (req: Request) => string,
  requests: number,
  maxConcurrent: number,
) {
  const activeUsers = new Set<string>();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: requests,
    keyGenerator: userKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests. Please wait a minute before trying again." },
  });
  return {
    limiter,
    wrap(handler: RequestHandler): RequestHandler {
      return async (req, res, next) => {
        const userId = userKey(req);
        if (activeUsers.has(userId) || activeUsers.size >= maxConcurrent) {
          res.setHeader("Retry-After", "60");
          res.status(429).json({ message: "Resource operation already running or server busy. Please try again later." });
          return;
        }
        activeUsers.add(userId);
        try {
          await handler(req, res, next);
        } finally {
          // A disconnected client must not free a slot while work still runs.
          activeUsers.delete(userId);
        }
      };
    },
  };
}
