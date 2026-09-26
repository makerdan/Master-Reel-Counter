import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export function localActivityTimestamp(createdAt: SQLWrapper, timezone: string): SQL {
  // Entry timestamps are stored as UTC values in timestamp-without-time-zone
  // columns. Convert to an instant first, then project into the saved timezone.
  return sql`(${createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}`;
}

export function localActivityDate(createdAt: SQLWrapper, timezone: string): SQL {
  return sql`(${localActivityTimestamp(createdAt, timezone)})::date`;
}

export function dateKeyInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateKeyOrdinal(dateKey: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Invalid activity date key: ${dateKey}`);

  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (new Date(timestamp).toISOString().slice(0, 10) !== dateKey) {
    throw new Error(`Invalid activity date key: ${dateKey}`);
  }
  return timestamp / 86_400_000;
}

export function calculateActivityStreaks(
  activityDateKeys: string[],
  todayDateKey: string,
): { currentStreak: number; longestStreak: number } {
  const dates = [...new Set(activityDateKeys)].sort((a, b) => b.localeCompare(a));
  if (dates.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const ordinals = dates.map(dateKeyOrdinal);
  const todayOrdinal = dateKeyOrdinal(todayDateKey);
  let longestStreak = 1;
  let streak = 1;
  for (let index = 1; index < ordinals.length; index++) {
    if (ordinals[index - 1] - ordinals[index] === 1) {
      streak++;
    } else {
      longestStreak = Math.max(longestStreak, streak);
      streak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, streak);

  let currentStreak = 0;
  if (todayOrdinal - ordinals[0] <= 1 && todayOrdinal >= ordinals[0]) {
    currentStreak = 1;
    for (let index = 1; index < ordinals.length; index++) {
      if (ordinals[index - 1] - ordinals[index] !== 1) break;
      currentStreak++;
    }
  }

  return { currentStreak, longestStreak };
}

export async function getTimezoneConsistentStats<TStats, TEnhanced>(
  userId: string,
  sessionIds: number[],
  timezone: string,
  repository: {
    getUserStats(userId: string, timezone: string): Promise<TStats>;
    getEnhancedStats(userId: string, sessionIds: number[], timezone: string): Promise<TEnhanced>;
  },
): Promise<{ stats: TStats; enhancedStats: TEnhanced }> {
  const [stats, enhancedStats] = await Promise.all([
    repository.getUserStats(userId, timezone),
    repository.getEnhancedStats(userId, sessionIds, timezone),
  ]);
  return { stats, enhancedStats };
}