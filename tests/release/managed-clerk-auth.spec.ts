import { expect, test } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { setupCandidateClerkTestingToken } from "../support/clerk-candidate-testing";
import { fillSecret } from "../support/secret-safe-actions";

const { Client } = pg;
const SMOKE_ID_PREFIX = "release-smoke-";
const STALE_SMOKE_AGE_MS = 60 * 60 * 1000;
const CLIENT_TRUST_TIMEOUT_MS = 10_000;

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

function safeBrowserPath(rawUrl: string): string {
  const url = new URL(rawUrl);
  return url.pathname;
}

async function waitForCompletedSignIn(
  page: import("@playwright/test").Page,
  routeStates: string[],
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let clientTrustStartedAt: number | undefined;

  while (Date.now() < deadline) {
    const path = safeBrowserPath(page.url());
    if (routeStates.at(-1) !== path) routeStates.push(path);
    const clerkState = await page.evaluate(() => {
      const clerk = (
        window as typeof window & {
          Clerk?: { loaded?: boolean; session?: { id?: string } | null };
        }
      ).Clerk;
      return {
        loaded: clerk?.loaded === true,
        hasActiveSession: Boolean(clerk?.session?.id),
      };
    });
    if (
      !path.startsWith("/sign-in") &&
      clerkState.loaded &&
      clerkState.hasActiveSession
    ) {
      return;
    }

    if (path.startsWith("/sign-in/client-trust")) {
      clientTrustStartedAt ??= Date.now();
      if (Date.now() - clientTrustStartedAt >= CLIENT_TRUST_TIMEOUT_MS) {
        throw new Error(
          "Managed Clerk sign-in did not complete the supported testing-token client-trust step at /sign-in/client-trust",
        );
      }
    }
    await page.waitForTimeout(250);
  }

  throw new Error(
    `Managed Clerk sign-in did not reach a loaded Clerk instance with an active session from ${safeBrowserPath(
      page.url(),
    )}`,
  );
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

test("managed Clerk sign-in preserves local authorization and protected navigation", async ({ page }, testInfo) => {
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
  const proxyRequests: string[] = [];
  const routeStates: string[] = [];
  const requestFailures: string[] = [];

  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    requestFailures.push(
      `${request.method()} ${url.pathname} (${request.failure()?.errorText ?? "unknown failure"})`,
    );
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const path = safeBrowserPath(frame.url());
      if (routeStates.at(-1) !== path) routeStates.push(path);
    }
  });

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
    process.env.CLERK_TESTING_TOKEN = testingToken.token;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === baseURL && url.pathname.startsWith("/api/__clerk")) {
        proxyRequests.push(url.pathname);
      }
    });

    await setupCandidateClerkTestingToken({
      page,
      candidateOrigin: baseURL,
      proxyPath: "/api/__clerk",
      localCandidateOrigin: process.env.RELEASE_SMOKE_CANDIDATE_APP_ORIGIN,
    });
    await page
      .goto("/sign-in")
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

    await waitForCompletedSignIn(page, routeStates);
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
    expect(
      authResponse.status,
      `Post-sign-in local authorization failed at ${page.url()}: ${JSON.stringify(authResponse.user)}`,
    ).toBe(200);
    const appUser = authResponse.user;
    expect(appUser).toMatchObject({
      id: localUserId,
      email,
      approved: true,
      rejected: false,
      isTester: false,
    });
    await expect(page.getByTestId("text-dashboard-title")).toBeVisible({ timeout: 30_000 });
    expect(proxyRequests.length, "Clerk browser traffic must pass through the production proxy").toBeGreaterThan(0);

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
    delete process.env.CLERK_TESTING_TOKEN;
    // Native Playwright traces retain cookies and request payloads. This bounded
    // path-only trace is safe to upload when the workflow fails.
    await testInfo.attach("managed-clerk-browser-trace", {
      body: Buffer.from(
        JSON.stringify(
          {
            finalPath: safeBrowserPath(page.url()),
            routeStates: routeStates.slice(-20),
            proxyRequestPaths: proxyRequests.slice(-50),
            requestFailures: requestFailures.slice(-20),
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
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