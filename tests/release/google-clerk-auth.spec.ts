import { expect, test, type Page } from "@playwright/test";
import { createClerkClient } from "@clerk/backend";
import { clerk as clerkTesting } from "@clerk/testing/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import {
  CLERK_TESTING_FRONTEND_API_ORIGIN,
  setupCandidateClerkTestingToken,
} from "../support/clerk-candidate-testing";
import { CLERK_PROXY_PATH } from "../../shared/clerk-config";
import {
  assertIsolatedReleaseDatabase,
  assertReleaseSchema,
} from "../../scripts/release-schema-preflight.mjs";
import { assertClerkTestPermissions } from "../support/clerk-test-permissions";

const { Client } = pg;
const SMOKE_ID_PREFIX = "google-release-smoke-";
const STALE_SMOKE_AGE_MS = 60 * 60 * 1000;
const CLIENT_TRUST_TIMEOUT_MS = 10_000;
const internalCandidate = process.env.RELEASE_SMOKE_INTERNAL_CANDIDATE === "1";

const requiredEnvironment = [
  "PRODUCTION_BASE_URL",
  "CLERK_SECRET_KEY",
  "RELEASE_SMOKE_DATABASE_URL",
  "RELEASE_PUBLICATION_DATABASE_URL",
] as const;

const roleCases = [
  { role: "Admin", label: "approved Admin" },
  { role: "User", label: "approved User" },
] as const;

function requireReleaseEnvironment(): void {
  const missing: string[] = requiredEnvironment.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Google Clerk release smoke is missing required environment variables: ${missing.join(", ")}`,
    );
  }
}

function safeDiagnosticPath(rawUrl: string): string {
  try {
    const path = new URL(rawUrl).pathname;
    const containsCredential =
      /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]+/.test(path) ||
      /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(path);
    return containsCredential ? "/[REDACTED-INVALID-PATH]" : path;
  } catch {
    return "/[REDACTED-INVALID-URL]";
  }
}

function normalizedFailureClass(errorText: string | undefined): string {
  const match = errorText?.match(/\b(?:net::)?ERR_[A-Z_]+\b/);
  return match?.[0] ?? "REQUEST_FAILED";
}

function normalizedPageError(error: Error): string {
  return error.name && /^[A-Za-z]+Error$/.test(error.name)
    ? error.name
    : "PageError";
}

async function waitForCompletedSignIn(
  page: Page,
  routeStates: string[],
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let clientTrustStartedAt: number | undefined;

  while (Date.now() < deadline) {
    const path = safeDiagnosticPath(page.url());
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
          "Google Clerk boundary did not complete the supported client-trust step",
        );
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error(
    `Google Clerk boundary did not reach an active session from ${safeDiagnosticPath(page.url())}`,
  );
}

async function createDisposableAccount(
  database: InstanceType<typeof Client>,
  clerk: ReturnType<typeof createClerkClient>,
  role: "Admin" | "User",
): Promise<{
  localUserId: string;
  email: string;
  clerkUserId: string;
}> {
  const localUserId = `${SMOKE_ID_PREFIX}${randomUUID()}`;
  const email = `google-release-smoke+${randomUUID()}@example.com`;
  const password = `Rls-${randomBytes(18).toString("base64url")}!9`;
  const clerkUser = await clerk.users.createUser({
    externalId: localUserId,
    emailAddress: [email],
    password,
    firstName: "Google",
    lastName: role,
    skipLegalChecks: true,
  });

  await database.query(
    `INSERT INTO users (id, email, first_name, last_name, approved, rejected, role)
     VALUES ($1, $2, 'Google', $3, true, false, $4)`,
    [localUserId, email, role, role],
  );

  return { localUserId, email, clerkUserId: clerkUser.id };
}

async function removeStaleSmokeUsers(
  database: InstanceType<typeof Client>,
  clerk: ReturnType<typeof createClerkClient>,
): Promise<void> {
  const cutoff = Date.now() - STALE_SMOKE_AGE_MS;
  const users = await clerk.users.getUserList({
    query: "google-release-smoke",
    createdAtBefore: cutoff,
    limit: 100,
  });
  if (users.totalCount > users.data.length) {
    throw new Error("More than 100 stale Google Clerk smoke users require cleanup");
  }

  for (const user of users.data) {
    const externalId = user.externalId;
    const isDisposable =
      externalId?.startsWith(SMOKE_ID_PREFIX) &&
      user.emailAddresses.some(
        ({ emailAddress }) =>
          emailAddress.startsWith("google-release-smoke+") &&
          emailAddress.endsWith("@example.com"),
      );
    if (!isDisposable) continue;
    await clerk.users.deleteUser(user.id);
    await database.query("DELETE FROM users WHERE id = $1", [externalId]);
  }

  await database.query(
    `DELETE FROM users
     WHERE id LIKE 'google-release-smoke-%'
       AND email LIKE 'google-release-smoke+%@example.com'
       AND created_at < $1`,
    [new Date(cutoff)],
  );
}

test.describe("Google-backed Clerk application boundary", () => {
  test.beforeAll(async () => {
    if (!internalCandidate) {
      throw new Error("Fixture-writing Google Clerk smoke may run only against an internal candidate");
    }
    requireReleaseEnvironment();
    assertIsolatedReleaseDatabase({
      releaseDatabaseUrl: process.env.RELEASE_SMOKE_DATABASE_URL,
      publicationDatabaseUrl: process.env.RELEASE_PUBLICATION_DATABASE_URL,
    });
    const database = new Client({
      connectionString: process.env.RELEASE_SMOKE_DATABASE_URL,
    });
    await database.connect();
    try {
      await assertReleaseSchema(database);
    } finally {
      await database.end();
    }
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
    await assertClerkTestPermissions(clerk);
  });

  for (const roleCase of roleCases) {
    test(`preserves the ${roleCase.label} mapping after sign-in`, async ({
      page,
    }, testInfo) => {
      requireReleaseEnvironment();

      const baseURL = new URL(process.env.PRODUCTION_BASE_URL!).origin;
      assertIsolatedReleaseDatabase({
        releaseDatabaseUrl: process.env.RELEASE_SMOKE_DATABASE_URL,
        publicationDatabaseUrl: process.env.RELEASE_PUBLICATION_DATABASE_URL,
      });
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
      const database = new Client({
        connectionString: process.env.RELEASE_SMOKE_DATABASE_URL,
      });
      let account:
        | Awaited<ReturnType<typeof createDisposableAccount>>
        | undefined;
      const proxyRequests: string[] = [];
      const routeStates: string[] = [];
      const requestFailures: string[] = [];
      const pageErrors: string[] = [];

      page.on("requestfailed", (request) => {
        requestFailures.push(
          `${request.method()} ${safeDiagnosticPath(request.url())} ${normalizedFailureClass(request.failure()?.errorText)}`,
        );
      });
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (url.origin === baseURL && url.pathname.startsWith(CLERK_PROXY_PATH)) {
          proxyRequests.push(
            `${response.request().method()} ${safeDiagnosticPath(response.url())} ${response.status()}`,
          );
        }
      });
      page.on("pageerror", (error) => {
        pageErrors.push(normalizedPageError(error));
      });
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) {
          const path = safeDiagnosticPath(frame.url());
          if (routeStates.at(-1) !== path) routeStates.push(path);
        }
      });

      await database.connect();
      try {
        await removeStaleSmokeUsers(database, clerk);
        await page.goto("/settings");
        await page.getByTestId("button-login").click();
        await expect(
          page.getByRole("button", { name: /google/i }),
          "Clerk sign-in must expose the Google provider",
        ).toBeVisible();

        account = await createDisposableAccount(database, clerk, roleCase.role);
        const testingToken = await clerk.testingTokens.createTestingToken();
        process.env.CLERK_TESTING_TOKEN = testingToken.token;
        await setupCandidateClerkTestingToken({
          page,
          candidateOrigin: baseURL,
          localCandidateOrigin: process.env.RELEASE_SMOKE_CANDIDATE_APP_ORIGIN,
        });
        await clerkTesting.signIn({
          page,
          emailAddress: account.email,
          setupClerkTestingTokenOptions: {
            frontendApiUrl: new URL(CLERK_TESTING_FRONTEND_API_ORIGIN).host,
          },
        });

        await waitForCompletedSignIn(page, routeStates);
        expect(proxyRequests.length, "Clerk traffic must use the release proxy").toBeGreaterThan(0);

        const authResponse = await page.evaluate(async () => {
          const response = await fetch("/api/auth/user", {
            credentials: "same-origin",
            headers: { accept: "application/json" },
          });
          const body = response.ok ? await response.json() : null;
          return {
            status: response.status,
            user: body
              ? {
                  id: body.id,
                  approved: body.approved,
                  rejected: body.rejected,
                  role: body.role,
                }
              : null,
          };
        });
        expect(authResponse.status).toBe(200);
        expect(authResponse.user).toEqual({
          id: account.localUserId,
          approved: true,
          rejected: false,
          role: roleCase.role,
        });
        await expect(page.getByTestId("text-settings-title")).toBeVisible();

        const persistedRole = await database.query(
          "SELECT approved, rejected, role FROM users WHERE id = $1",
          [account.localUserId],
        );
        expect(persistedRole.rows).toEqual([
          { approved: true, rejected: false, role: roleCase.role },
        ]);

        if (roleCase.role === "Admin") {
          await expect(page.getByTestId("tab-trigger-admin")).toBeVisible();
          await page.getByTestId("tab-trigger-admin").click();
          await expect(page.getByTestId("tab-trigger-admin")).toHaveAttribute(
            "data-state",
            "active",
          );
        } else {
          await expect(page.getByTestId("tab-trigger-admin")).toHaveCount(0);
          await page.goto("/stats");
          await expect(page.getByTestId("text-stats-title")).toBeVisible();
        }

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
        await mkdir("test-results/release-diagnostics", { recursive: true });
        await writeFile(
          `test-results/release-diagnostics/google-${roleCase.role.toLowerCase()}.json`,
          JSON.stringify(
            {
              finalPath: safeDiagnosticPath(page.url()),
              routeStates: routeStates.slice(-20),
              clerkRequests: proxyRequests.slice(-50),
              requestFailures: requestFailures.slice(-20),
              pageErrors: pageErrors.slice(-20),
            },
            null,
            2,
          ),
          { encoding: "utf8", mode: 0o600 },
        );
        await testInfo.attach(`google-${roleCase.role.toLowerCase()}-diagnostics`, {
          body: Buffer.from(
            JSON.stringify(
              {
                finalPath: safeDiagnosticPath(page.url()),
                routeStates: routeStates.slice(-20),
                clerkRequests: proxyRequests.slice(-50),
                requestFailures: requestFailures.slice(-20),
                pageErrors: pageErrors.slice(-20),
              },
              null,
              2,
            ),
          ),
          contentType: "application/json",
        });

        const cleanupErrors: Error[] = [];
        if (account) {
          try {
            const deleted = await database.query(
              "DELETE FROM users WHERE id = $1 RETURNING id",
              [account.localUserId],
            );
            if (deleted.rowCount !== 1) {
              cleanupErrors.push(new Error("Disposable local Google-role user was not deleted"));
            }
          } catch (error) {
            cleanupErrors.push(
              error instanceof Error
                ? error
                : new Error("Disposable local Google-role cleanup failed"),
            );
          }
          try {
            await clerk.users.deleteUser(account.clerkUserId);
          } catch (error) {
            cleanupErrors.push(
              error instanceof Error
                ? error
                : new Error("Disposable Clerk Google-role user cleanup failed"),
            );
          }
        }
        try {
          await database.end();
        } catch (error) {
          cleanupErrors.push(
            error instanceof Error
              ? error
              : new Error("Google Clerk smoke database cleanup failed"),
          );
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            "Google Clerk release smoke cleanup failed",
          );
        }
      }
    });
  }
});