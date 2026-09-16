import { createClerkClient } from "@clerk/backend";
import pg from "pg";
import {
  assertDisposableClerkTenant,
  cleanupClerkBrowserFixture,
  readClerkBrowserFixture,
  removeClerkBrowserFixtureMarker,
} from "./clerk-fixture-cleanup";

export default async function globalTeardown() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!secretKey || !databaseUrl) return;
  assertDisposableClerkTenant(secretKey);
  const fixture = await readClerkBrowserFixture();
  if (!fixture) return;

  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const removed = await cleanupClerkBrowserFixture(
      createClerkClient({ secretKey }),
      database,
      fixture,
    );
    console.log(
      `[clerk-fixtures] Removed ${removed.clerkUsers} provider and ${removed.localUsers} local browser fixture(s).`,
    );
    await removeClerkBrowserFixtureMarker();
  } finally {
    await database.end();
  }
}