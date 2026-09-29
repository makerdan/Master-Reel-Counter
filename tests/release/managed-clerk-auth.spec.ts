import { expect, test } from "@playwright/test";
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
import { resolveClerkEnvironmentPublishableKey } from "../../shared/clerk-config";

const { Client } = pg;
const SMOKE_ID_PREFIX = "release-smoke-";
const STALE_SMOKE_AGE_MS = 60 * 60 * 1000;
const CLIENT_TRUST_TIMEOUT_MS = 10_000;
const internalCandidate = process.env.RELEASE_SMOKE_INTERNAL_CANDIDATE === "1";

const requiredEnvironment = [
  "PRODUCTION_BASE_URL",
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "RELEASE_SMOKE_DATABASE_URL",
  "RELEASE_PUBLICATION_DATABASE_URL",
] as const;

function requireReleaseEnvironment(): void {
  const missing: string[] = requiredEnvironment.filter((name) => !process.env[name]);
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

function safeDiagnosticPath(rawUrl: string): string {
  const path = safeBrowserPath(rawUrl);
  const containsCredential =
    /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]+/.test(path) ||
    /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(path);
  return containsCredential ? "/[REDACTED-INVALID-PATH]" : path;
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
  page: import("@playwright/test").Page,
  routeStates: string[],
): Promise<void> {
  const deadline = Date.now() + 30_000;

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
    // The testing helper sets the session directly. It does not submit the
    // SignIn component's form or trigger its fallback redirect.
    if (clerkState.loaded && clerkState.hasActiveSession) {
      return;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(
    `Managed Clerk sign-in did not reach a loaded Clerk instance with an active session from ${safeDiagnosticPath(
      page.url(),
    )}`,
  );
}

async function assertProviderUserAbsent(
  clerk: ReturnType<typeof createClerkClient>,
  localUserId: string,
): Promise<void> {
  const users = await clerk.users.getUserList({
    externalId: [localUserId],
    limit: 10,
  });
  if (users.data.some((user) => user.externalId === localUserId)) {
    throw new Error("Disposable Clerk smoke user remains after cleanup");
  }
}

async function assertLocalUserAbsent(
  database: InstanceType<typeof Client>,
  localUserId: string,
): Promise<void> {
  const result = await database.query("SELECT id FROM users WHERE id = $1", [localUserId]);
  if (result.rowCount !== 0) {
    throw new Error("Disposable local smoke user remains after cleanup");
  }
}

async function cleanupBrowserSession(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const clerk = (
      window as typeof window & {
        Clerk?: {
          session?: { id?: string } | null;
          signOut?: () => Promise<void>;
        };
      }
    ).Clerk;
    if (clerk?.session?.id) await clerk.signOut?.();
  });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const signedOutStatus = await page.evaluate(async () => {
    const response = await fetch("/api/auth/user", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    return response.status;
  });
  if (signedOutStatus !== 401) {
    throw new Error("Managed Clerk browser session remains authenticated during cleanup");
  }
  const context = page.context();
  await context.clearCookies();
  await context.close();
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
  if (!internalCandidate) {
    throw new Error("Fixture-writing managed Clerk smoke may run only against an internal candidate");
  }
  requireReleaseEnvironment();

  const baseURL = new URL(process.env.PRODUCTION_BASE_URL!).origin;
  const smokeDatabaseUrl = process.env.RELEASE_SMOKE_DATABASE_URL!;
  assertIsolatedReleaseDatabase({
    releaseDatabaseUrl: smokeDatabaseUrl,
    publicationDatabaseUrl: process.env.RELEASE_PUBLICATION_DATABASE_URL!,
  });
  const localUserId = `release-smoke-${randomUUID()}`;
  const email = `release-smoke+${randomUUID()}@example.com`;
  const password = `Rls-${randomBytes(18).toString("base64url")}!9`;
  resolveClerkEnvironmentPublishableKey({
    serverPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    clientPublishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY,
  });
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const database = new Client({
    connectionString: smokeDatabaseUrl,
  });
  let clerkUserId: string | undefined;
  let localUserCreated = false;
  const proxyRequests: string[] = [];
  const clerkScriptResponses: Array<{
    origin: string;
    path: string;
    status: number;
    contentType: string;
  }> = [];
  const routeStates: string[] = [];
  const requestFailures: string[] = [];
  const pageErrors: string[] = [];
  let databaseConnected = false;

  page.on("requestfailed", (request) => {
    requestFailures.push(
      `${request.method()} ${safeDiagnosticPath(request.url())} ${normalizedFailureClass(request.failure()?.errorText)}`,
    );
  });
  page.on("response", (response) => {
    const request = response.request();
    const url = new URL(response.url());
    if (url.origin === baseURL && url.pathname.startsWith(CLERK_PROXY_PATH)) {
      proxyRequests.push(
        `${request.method()} ${safeDiagnosticPath(response.url())} ${response.status()}`,
      );
    }
    if (url.pathname.endsWith("/dist/clerk.browser.js")) {
      clerkScriptResponses.push({
        origin: url.origin,
        path: url.pathname,
        status: response.status(),
        contentType: response.headers()["content-type"] ?? "",
      });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(normalizedPageError(error));
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      const path = safeBrowserPath(frame.url());
      if (routeStates.at(-1) !== path) routeStates.push(path);
    }
  });

  await database.connect();
  databaseConnected = true;
  let primaryError: unknown;
  const cleanupErrors: Error[] = [];
  try {
    await assertReleaseSchema(database);
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
      `INSERT INTO users (id, email, first_name, last_name, approved, rejected, role)
       VALUES ($1, $2, 'Release', 'Smoke', true, false, 'Admin')`,
      [localUserId, email],
    );
    localUserCreated = true;

    const testingToken = await clerk.testingTokens.createTestingToken();
    process.env.CLERK_TESTING_TOKEN = testingToken.token;
    await setupCandidateClerkTestingToken({
      page,
      candidateOrigin: baseURL,
      localCandidateOrigin: process.env.RELEASE_SMOKE_CANDIDATE_APP_ORIGIN,
    });
    await page.goto("/settings")
      .catch(() => {
        throw new Error("Managed Clerk protected entry page failed to load");
      });
    await page.getByTestId("button-login").click();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    expect(new URL(page.url()).searchParams.get("redirect_url")).toBe("/settings");
    const expectedCandidateId = process.env.RELEASE_SMOKE_CANDIDATE_ID;
    if (expectedCandidateId) {
      const candidateId = await page.evaluate(async () => {
        const response = await fetch("/api/healthz", { credentials: "same-origin" });
        const body = await response.json();
        return body.candidateId;
      });
      expect(candidateId).toBe(expectedCandidateId);
    }
    await clerkTesting.signIn({
      page,
      emailAddress: email,
      setupClerkTestingTokenOptions: {
        frontendApiUrl: new URL(CLERK_TESTING_FRONTEND_API_ORIGIN).host,
      },
    });

    await waitForCompletedSignIn(page, routeStates);
    await page.goto("/settings");
    await expect(page).toHaveURL(`${baseURL}/settings`);
    await expect(page.getByTestId("text-settings-title")).toBeVisible({ timeout: 30_000 });
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
              role: user.role,
            }
          : null,
      };
    });
    expect(
      authResponse.status,
      `Post-sign-in local authorization failed at ${safeDiagnosticPath(page.url())}`,
    ).toBe(200);
    const appUser = authResponse.user;
    expect(appUser).toMatchObject({
      id: localUserId,
      email,
      approved: true,
      rejected: false,
      role: "Admin",
    });
    await expect(page.getByTestId("text-settings-title")).toBeVisible({ timeout: 30_000 });
    expect(proxyRequests.length, "Clerk browser traffic must pass through the production proxy").toBeGreaterThan(0);
    const loadedClerkScripts = clerkScriptResponses.filter(
      (response) => response.status === 200,
    );
    expect(loadedClerkScripts, "Clerk JavaScript must load once from the exact candidate proxy").toHaveLength(1);
    expect(loadedClerkScripts[0]).toMatchObject({
      origin: baseURL,
    });
    expect(loadedClerkScripts[0].path).toMatch(
      new RegExp(`^${CLERK_PROXY_PATH}/npm/@clerk/clerk-js@[^/]+/dist/clerk\\.browser\\.js$`),
    );
    expect(loadedClerkScripts[0].contentType).toMatch(
      /^(?:application|text)\/javascript\b/i,
    );

    const authorization = await database.query(
      "SELECT approved, rejected, role FROM users WHERE id = $1",
      [localUserId],
    );
    expect(authorization.rows).toEqual([
      { approved: true, rejected: false, role: "Admin" },
    ]);

    await page.goto("/stats");
    await expect(page.getByTestId("text-stats-title")).toBeVisible();

    await page.goto("/");
    await expect(page.getByTestId("text-dashboard-title")).toBeVisible();
    await page.evaluate((id) => {
      const suffix = encodeURIComponent(id);
      localStorage.setItem(`reel-counter-recent-searches:${suffix}`, JSON.stringify(["prior-user-term"]));
      localStorage.setItem(`reel-counter-last-session:${suffix}`, "123");
      localStorage.setItem("reel-counter-recent-searches", JSON.stringify(["legacy-term"]));
      sessionStorage.setItem(`dash:searchQuery:${suffix}`, "prior-user-query");
      sessionStorage.setItem(`dash:filterStatus:${suffix}`, "active");
      sessionStorage.setItem(`dash:openFolders:${suffix}`, "[123]");
      sessionStorage.setItem("dash:searchQuery", "legacy-query");
    }, localUserId);
    await page.getByTestId("button-logout").click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByTestId("button-login")).toBeVisible();
    const clearedBrowserState = await page.evaluate((id) => {
      const suffix = encodeURIComponent(id);
      return {
        recentSearches: localStorage.getItem(`reel-counter-recent-searches:${suffix}`),
        lastSession: localStorage.getItem(`reel-counter-last-session:${suffix}`),
        legacySearches: localStorage.getItem("reel-counter-recent-searches"),
        searchQuery: sessionStorage.getItem(`dash:searchQuery:${suffix}`),
        filterStatus: sessionStorage.getItem(`dash:filterStatus:${suffix}`),
        openFolders: sessionStorage.getItem(`dash:openFolders:${suffix}`),
        legacyQuery: sessionStorage.getItem("dash:searchQuery"),
      };
    }, localUserId);
    expect(clearedBrowserState).toEqual({
      recentSearches: null,
      lastSession: null,
      legacySearches: null,
      searchQuery: null,
      filterStatus: null,
      openFolders: null,
      legacyQuery: null,
    });
    const signedOutStatus = await page.evaluate(async () => {
      const response = await fetch("/api/auth/user", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      return response.status;
    });
    expect(signedOutStatus).toBe(401);
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupBrowser = async () => {
      try {
        await cleanupBrowserSession(page);
      } catch (error) {
        cleanupErrors.push(
          error instanceof Error
            ? error
            : new Error("Managed Clerk browser session cleanup failed"),
        );
      }
    };

    delete process.env.CLERK_TESTING_TOKEN;
    const browserDiagnostic = {
      finalPath: safeDiagnosticPath(page.url()),
      routeStates: routeStates.slice(-20).map((path) =>
        safeDiagnosticPath(new URL(path, baseURL).href),
      ),
      clerkRequests: proxyRequests.slice(-50),
      requestFailures: requestFailures.slice(-20),
      pageErrors: pageErrors.slice(-20),
    };
    try {
      await mkdir("test-results/release-diagnostics", { recursive: true });
      await writeFile(
        "test-results/release-diagnostics/browser.json",
        JSON.stringify(browserDiagnostic, null, 2),
        { encoding: "utf8", mode: 0o600 },
      );
    } catch (error) {
      cleanupErrors.push(
        error instanceof Error
          ? error
          : new Error("Release browser diagnostic write failed"),
      );
    }
    // Native Playwright traces retain cookies and request payloads. This bounded
    // path-only trace is safe to upload when the workflow fails.
    try {
      await testInfo.attach("managed-clerk-browser-trace", {
        body: Buffer.from(JSON.stringify(browserDiagnostic, null, 2)),
        contentType: "application/json",
      });
    } catch (error) {
      cleanupErrors.push(
        error instanceof Error
          ? error
          : new Error("Release browser diagnostic attachment failed"),
      );
    }
    await cleanupBrowser();
    if (localUserCreated && databaseConnected) {
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
    if (clerkUserId) {
      try {
        await assertProviderUserAbsent(clerk, localUserId);
      } catch (error) {
        cleanupErrors.push(
          error instanceof Error
            ? error
            : new Error("Disposable Clerk smoke user absence check failed"),
        );
      }
    }
    if (localUserCreated && databaseConnected) {
      try {
        await assertLocalUserAbsent(database, localUserId);
      } catch (error) {
        cleanupErrors.push(
          error instanceof Error
            ? error
            : new Error("Disposable local smoke user absence check failed"),
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
  }
  if (primaryError) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [primaryError, ...cleanupErrors],
        "Managed Clerk release smoke failed and cleanup also failed",
      );
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Managed Clerk release smoke cleanup failed");
  }
});
