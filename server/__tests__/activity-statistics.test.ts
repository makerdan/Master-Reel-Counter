import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql } from "drizzle-orm";
import { db, pool } from "../db.js";
import {
  calculateActivityStreaks,
  dateKeyInTimezone,
  getTimezoneConsistentStats,
  localActivityDate,
  localActivityTimestamp,
} from "../activity-statistics.js";

after(async () => {
  await pool.end().catch(() => {});
});

test("local dates and week boundaries follow the saved timezone across DST", async () => {
  const timezone = "America/Chicago";
  const localTimestamp = localActivityTimestamp(sql`activity.created_at`, timezone);
  const localDate = localActivityDate(sql`activity.created_at`, timezone);
  const result = await db.execute(sql`
    SELECT
      activity.created_at::text AS utc_timestamp,
      to_char(${localDate}, 'YYYY-MM-DD') AS local_day,
      to_char(date_trunc('week', ${localTimestamp}), 'YYYY-MM-DD') AS local_week,
      extract(dow FROM ${localTimestamp})::int AS local_weekday
    FROM (VALUES
      ('2024-01-15 05:59:00'::timestamp),
      ('2024-01-15 06:00:00'::timestamp),
      ('2024-03-11 04:59:59'::timestamp),
      ('2024-03-11 05:00:00'::timestamp)
    ) AS activity(created_at)
    ORDER BY activity.created_at
  `);

  assert.deepEqual(
    result.rows.map((row) => ({
      utcTimestamp: row.utc_timestamp,
      localDay: row.local_day,
      localWeek: row.local_week,
      localWeekday: Number(row.local_weekday),
    })),
    [
      { utcTimestamp: "2024-01-15 05:59:00", localDay: "2024-01-14", localWeek: "2024-01-08", localWeekday: 0 },
      { utcTimestamp: "2024-01-15 06:00:00", localDay: "2024-01-15", localWeek: "2024-01-15", localWeekday: 1 },
      { utcTimestamp: "2024-03-11 04:59:59", localDay: "2024-03-10", localWeek: "2024-03-04", localWeekday: 0 },
      { utcTimestamp: "2024-03-11 05:00:00", localDay: "2024-03-11", localWeek: "2024-03-11", localWeekday: 1 },
    ],
  );
});

test("streaks remain consecutive by local calendar day across the DST change", () => {
  assert.deepEqual(
    calculateActivityStreaks(
      ["2024-03-11", "2024-03-10", "2024-03-09", "2024-03-07"],
      "2024-03-11",
    ),
    { currentStreak: 3, longestStreak: 3 },
  );
});

test("the current-streak anchor date is the user's local date near midnight", () => {
  assert.equal(
    dateKeyInTimezone(new Date("2024-01-15T05:59:00Z"), "America/Chicago"),
    "2024-01-14",
  );
});

test("daily and enhanced stats receive the same saved timezone", async () => {
  const calls: Array<[string, string, number[]?]> = [];
  const repository = {
    async getUserStats(userId: string, timezone: string) {
      calls.push(["daily-weekly-streak", `${userId}:${timezone}`]);
      return "stats";
    },
    async getEnhancedStats(userId: string, sessionIds: number[], timezone: string) {
      calls.push(["enhanced", `${userId}:${timezone}`, sessionIds]);
      return "enhanced";
    },
  };

  const result = await getTimezoneConsistentStats(
    "user-1",
    [12, 34],
    "America/Chicago",
    repository,
  );

  assert.deepEqual(result, { stats: "stats", enhancedStats: "enhanced" });
  assert.deepEqual(calls, [
    ["daily-weekly-streak", "user-1:America/Chicago"],
    ["enhanced", "user-1:America/Chicago", [12, 34]],
  ]);
});