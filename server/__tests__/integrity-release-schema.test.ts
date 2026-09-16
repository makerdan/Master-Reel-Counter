import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";
import {
  DELETE_STALE_UNCOMMITTED_PINS_QUERY,
  STALE_UNCOMMITTED_PINS_QUERY,
} from "../admin-integrity";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const schema = `integrity_release_${process.pid}_${randomUUID().replaceAll("-", "")}`;

before(async () => {
  const releaseSchema = execFileSync(
    "npx",
    [
      "drizzle-kit",
      "export",
      "--sql",
      "--dialect",
      "postgresql",
      "--schema",
      "./shared/schema.ts",
    ],
    { encoding: "utf8" },
  ).replaceAll('"public".', `"${schema}".`);

  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(releaseSchema);
  } finally {
    client.release();
  }
});

after(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
});

test("stale uncommitted-pin queries execute against the release schema", async () => {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schema}"`);
    const userId = `integrity-${randomUUID()}`;
    await client.query(
      `INSERT INTO users (id, approved, role) VALUES ($1, true, 'Admin')`,
      [userId],
    );
    const sessions = await client.query(
      `INSERT INTO counting_sessions (user_id, name, started_at)
       VALUES ($1, 'old', NOW() - INTERVAL '8 days'),
              ($1, 'recent', NOW() - INTERVAL '6 days')
       RETURNING id`,
      [userId],
    );
    const photos = await client.query(
      `INSERT INTO photos (session_id, user_id, object_storage_key)
       VALUES ($1, $3, '/old.jpg'), ($2, $3, '/recent.jpg')
       RETURNING id`,
      [sessions.rows[0].id, sessions.rows[1].id, userId],
    );
    await client.query(
      `INSERT INTO pins (photo_id, x_percent, y_percent, label)
       VALUES ($1, 0, 0, 'old'), ($2, 0, 0, 'recent')`,
      [photos.rows[0].id, photos.rows[1].id],
    );

    const count = await client.query(STALE_UNCOMMITTED_PINS_QUERY);
    assert.equal(count.rows[0].count, 1);

    const deleted = await client.query(DELETE_STALE_UNCOMMITTED_PINS_QUERY);
    assert.equal(deleted.rowCount, 1);
    const remaining = await client.query("SELECT label FROM pins ORDER BY label");
    assert.deepEqual(remaining.rows, [{ label: "recent" }]);
  } finally {
    client.release();
  }
});