/**
 * One-time cleanup script: remove duplicate review_responses rows.
 *
 * For each (session_id, entry_id, user_id) group that has more than one row,
 * keep only the row with the highest `id` (most recently inserted) and delete
 * the rest.  This unblocks the application of the unique index
 * "review_responses_session_entry_user_idx" via `npm run db:push`.
 *
 * ## Execution order (run once per environment, e.g. production)
 *
 *   Step 1 — Verify duplicate rows exist (optional):
 *     SELECT session_id, entry_id, user_id, count(*), array_agg(id ORDER BY id DESC)
 *     FROM review_responses
 *     GROUP BY session_id, entry_id, user_id
 *     HAVING count(*) > 1;
 *
 *   Step 2 — Run this script to delete the older duplicates:
 *     DATABASE_URL=<prod_url> npx tsx scripts/cleanup-review-response-duplicates.ts
 *
 *   Step 3 — Apply the unique constraint now that duplicates are gone:
 *     DATABASE_URL=<prod_url> npm run db:push
 *
 * The script is idempotent: if no duplicates are found it exits without
 * making any changes.
 *
 * Known production duplicates at time of task creation:
 *   entries #39 and #41 — each had two "approved" rows for the same user.
 */

import { sql } from "drizzle-orm";
import { db } from "../server/db";

async function cleanupDuplicates() {
  // Find all groups with duplicates.
  const dupes = await db.execute<{
    session_id: number;
    entry_id: number;
    user_id: string;
    ids: number[];
    cnt: number;
  }>(sql`
    SELECT
      session_id,
      entry_id,
      user_id,
      array_agg(id ORDER BY id DESC) AS ids,
      count(*) AS cnt
    FROM review_responses
    GROUP BY session_id, entry_id, user_id
    HAVING count(*) > 1
  `);

  if (dupes.rows.length === 0) {
    console.log("No duplicate review_responses rows found. Nothing to do.");
    return;
  }

  console.log(`Found ${dupes.rows.length} duplicate group(s):`);
  for (const row of dupes.rows) {
    const ids: number[] = row.ids as unknown as number[];
    const keepId = ids[0];
    const deleteIds = ids.slice(1);
    console.log(
      `  session_id=${row.session_id} entry_id=${row.entry_id} user_id=${row.user_id} — keeping id=${keepId}, deleting ids=[${deleteIds.join(", ")}]`
    );
    await db.execute(sql`DELETE FROM review_responses WHERE id = ANY(${deleteIds}::int[])`);
  }

  console.log("Cleanup complete. Run `npm run db:push` next to enforce the unique constraint.");
}

cleanupDuplicates()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  });
