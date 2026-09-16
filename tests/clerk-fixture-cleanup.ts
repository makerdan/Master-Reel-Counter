import { createClerkClient } from "@clerk/backend";
import { readFile, rm, writeFile } from "node:fs/promises";
import type pg from "pg";

const MARKER_PATH = "tests/.auth/clerk-fixture.json";

export type ClerkBrowserFixture = {
  clerkUserId: string;
  localUserId: string;
};

export function assertDisposableClerkTenant(secretKey: string): void {
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error(
      "Browser fixture cleanup requires a Clerk development tenant",
    );
  }
}

export async function readClerkBrowserFixture(): Promise<ClerkBrowserFixture | null> {
  try {
    const fixture = JSON.parse(await readFile(MARKER_PATH, "utf8")) as unknown;
    if (
      typeof fixture !== "object" ||
      fixture === null ||
      !("clerkUserId" in fixture) ||
      !("localUserId" in fixture) ||
      typeof fixture.clerkUserId !== "string" ||
      typeof fixture.localUserId !== "string" ||
      !fixture.clerkUserId.startsWith("user_") ||
      !fixture.localUserId.startsWith("e2e-clerk-")
    ) {
      throw new Error("Browser Clerk fixture marker is malformed");
    }
    return fixture as ClerkBrowserFixture;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeClerkBrowserFixture(
  fixture: ClerkBrowserFixture,
): Promise<void> {
  await writeFile(MARKER_PATH, `${JSON.stringify(fixture)}\n`, {
    mode: 0o600,
  });
}

export async function removeClerkBrowserFixtureMarker(): Promise<void> {
  await rm(MARKER_PATH, { force: true });
}

export async function cleanupClerkBrowserFixture(
  clerk: ReturnType<typeof createClerkClient>,
  database: pg.Client,
  fixture: ClerkBrowserFixture,
): Promise<{ clerkUsers: number; localUsers: number }> {
  let localUsers = 0;
  let databaseError: unknown;
  try {
    await database.query("BEGIN");
    await database.query("DELETE FROM counting_sessions WHERE user_id = $1", [
      fixture.localUserId,
    ]);
    await database.query("DELETE FROM folders WHERE user_id = $1", [
      fixture.localUserId,
    ]);
    await database.query("DELETE FROM session_collaborators WHERE user_id = $1", [
      fixture.localUserId,
    ]);
    for (const table of [
      "user_settings",
      "upload_intents",
      "conversations",
      "user_wire_categories",
      "ai_usage_logs",
      "feedback",
      "comments",
      "review_responses",
      "activity_logs",
    ]) {
      await database.query(`DELETE FROM "${table}" WHERE user_id = $1`, [
        fixture.localUserId,
      ]);
    }
    const result = await database.query("DELETE FROM users WHERE id = $1", [
      fixture.localUserId,
    ]);
    localUsers = result.rowCount ?? 0;
    await database.query("COMMIT");
  } catch (error) {
    databaseError = error;
    await database.query("ROLLBACK").catch(() => {});
  }

  let clerkUsers = 0;
  try {
    await clerk.users.deleteUser(fixture.clerkUserId);
    clerkUsers = 1;
  } catch (error) {
    if ((error as { status?: number }).status !== 404 && !databaseError) {
      throw error;
    }
  }

  if (databaseError) throw databaseError;
  return { clerkUsers, localUsers };
}