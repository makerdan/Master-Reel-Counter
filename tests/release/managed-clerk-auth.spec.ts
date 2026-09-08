import { expect, test } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { fillSecret } from "../support/secret-safe-actions";

const { Client } = pg;
const SMOKE_ID_PREFIX = "release-smoke-";
const STALE_SMOKE_AGE_MS = 60 * 60 * 1000;

const requiredEnvironment = [
  "PRODUCTION_BASE_URL",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
] as const;

function requireReleaseEnvironment(): void {
  const missing = requiredEnvironment.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Managed Clerk release smoke is missing required environment variables: ${missing.join(", ")}`,
    );
  }
}

async function removeStaleSmokeUsers(
  clerk: ReturnType<typeof createClerkClient>,
  database: InstanceType<typeof Client>,
): Promise<void> {
  const cutoff = Date.now() - STALE_SMOKE_AGE_MS;
  const users = await clerk.users.getUserList({
    query: "release-smoke",
    createdAtBefore: cutoff,
    limit: 100,
  });
  if (users.totalCount > users.data.length) {
    throw new Error("More than 100 stale Clerk smoke users require cleanup");
  }

  for (const user of users.data) {
    const externalId = user.externalId;
    const isDisposable =
      externalId?.startsWith(SMOKE_ID_PREFIX) &&
      user.emailAddresses.some(
        ({ emailAddress }) =>
          emailAddress.startsWith("release-smoke+") &&
          emailAddress.endsWith("@example.com"),
      );
    if (!isDisposable) continue;
    await clerk.users.deleteUser(user.id);
    await database.query("DELETE FROM users WHERE id = $1", [externalId]);
  }

  await database.query(
    `DELETE FROM users
     WHERE id LIKE 'release-smoke-%'
       AND email LIKE 'release-smoke+%@example.com'
       AND created_at < $1`,
    [new Date(cutoff)],
  );
}

test("managed Clerk sign-in preserves local authorization and protected navigation", async ({ page }) => {
  requireReleaseEnvironment();

  const baseURL = new URL(process.env.PRODUCTION_BASE_URL!).origin;
  const localUserId = `release-smoke-${randomUUID()}`;
  const email = `release-smoke+${randomUUID()}@example.com`;
  const password = `Rls-${randomBytes(18).toString("base64url")}!9`;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const database = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  let clerkUserId: string | undefined;
  let localUserCreated = false;

  await database.connect();
  try {
    await removeStaleSmokeUsers(clerk, database);

    const clerkUser = await clerk.users.createUser({
      externalId: localUserId,
      emailAddress: [email],
      password,
      firstName: "Release",
      lastName: "Smoke",
      skipLegalChecks: true,
    });
    clerkUserId = clerkUser.id;

    await database.query(
      `INSERT INTO users (id, email, first_name, last_name, approved, rejected, is_tester)
       VALUES ($1, $2, 'Release', 'Smoke', true, false, false)`,
      [localUserId, email],
    );
    localUserCreated = true;

    const testingToken = await clerk.testingTokens.createTestingToken();
    const proxyRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === baseURL && url.pathname.startsWith("/api/__clerk")) {
        proxyRequests.push(url.pathname);
      }
    });

    await page
      .goto(`/sign-in?__clerk_testing_token=${encodeURIComponent(testingToken.token)}`)
      .catch(() => {
        throw new Error("Managed Clerk sign-in page failed to load");
      });
    await page.evaluate(() => {
      history.replaceState(null, "", `${location.pathname}${location.hash}`);
    });
    const expectedCandidateId = process.env.RELEASE_SMOKE_CANDIDATE_ID;
    if (expectedCandidateId) {
      const candidateId = await page.evaluate(async () => {
        const response = await fetch("/api/healthz", { credentials: "same-origin" });
        const body = await response.json();
        return body.candidateId;
      });
      expect(candidateId).toBe(expectedCandidateId);
    }
    await page.locator('input[name="identifier"]').fill(email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await fillSecret(
      page.locator('input[name="password"]'),
      password,
      "Managed Clerk password field could not be completed",
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(page.getByTestId("text-dashboard-title")).toBeVisible({ timeout: 30_000 });
    expect(proxyRequests.length, "Clerk browser traffic must pass through the production proxy").toBeGreaterThan(0);

    const authResponse = await page.evaluate(async () => {
      const response = await fetch("/api/auth/user", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const user = response.ok ? await response.json() : null;
      return {
        status: response.status,
        user: user
          ? {
              id: user.id,
              email: user.email,
              approved: user.approved,
              rejected: user.rejected,
              isTester: user.isTester,
            }
          : null,
      };
    });
    expect(authResponse.status).toBe(200);
    const appUser = authResponse.user;
    expect(appUser).toMatchObject({
      id: localUserId,
      email,
      approved: true,
      rejected: false,
      isTester: false,
    });

    const authorization = await database.query(
      "SELECT approved, rejected, is_tester FROM users WHERE id = $1",
      [localUserId],
    );
    expect(authorization.rows).toEqual([
      { approved: true, rejected: false, is_tester: false },
    ]);

    await page.goto("/settings");
    await expect(page.getByTestId("text-settings-title")).toBeVisible();
    await page.goto("/stats");
    await expect(page.getByTestId("text-stats-title")).toBeVisible();

    await page.goto("/");
    await page.getByTestId("button-logout").click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByTestId("button-login")).toBeVisible();
    const signedOutStatus = await page.evaluate(async () => {
      const response = await fetch("/api/auth/user", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      return response.status;
    });
    expect(signedOutStatus).toBe(401);
  } finally {
    const cleanupErrors: Error[] = [];
    if (localUserCreated) {
      try {
        const deleted = await database.query(
          "DELETE FROM users WHERE id = $1 RETURNING id",
          [localUserId],
        );
        if (deleted.rowCount !== 1) {
          cleanupErrors.push(new Error("Disposable local smoke user was not deleted"));
        }
      } catch (error) {
        cleanupErrors.push(
          error instanceof Error ? error : new Error("Disposable local user cleanup failed"),
        );
      }
    }
    if (clerkUserId) {
      try {
        await clerk.users.deleteUser(clerkUserId);
      } catch (error) {
        cleanupErrors.push(
          error instanceof Error ? error : new Error("Disposable Clerk user cleanup failed"),
        );
      }
    }
    try {
      await database.end();
    } catch (error) {
      cleanupErrors.push(
        error instanceof Error ? error : new Error("Smoke database connection cleanup failed"),
      );
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "Managed Clerk release smoke cleanup failed");
    }
  }
});