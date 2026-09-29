import { chromium } from "@playwright/test";
import { mkdir } from "fs/promises";
import { execSync } from "child_process";
import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import {
  clerk as clerkTesting,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { resolveClerkBootstrapConfig } from "../shared/clerk-config";
import pg from "pg";
import { assertReleaseSchema } from "../scripts/release-schema-preflight.mjs";
import { assertClerkTestPermissions } from "./support/clerk-test-permissions";
import {
  assertDisposableClerkTenant,
  cleanupClerkBrowserFixture,
  readClerkBrowserFixture,
  removeClerkBrowserFixtureMarker,
  writeClerkBrowserFixture,
  type ClerkBrowserFixture,
} from "./clerk-fixture-cleanup";

function findChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    return execSync("which chromium", { encoding: "utf-8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5000";

async function waitForServer(url: string, maxMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server at ${url} did not become ready within ${maxMs}ms`);
}

async function globalSetup() {
  // The lock-collision check intentionally selects no browser tests. It must
  // not require tenant-specific Clerk configuration just to start Playwright.
  if (process.env.CI_SMOKE_TEST === "1") return;

  await waitForServer(`${BASE_URL}/api/healthz`);
  const missing = ["CLERK_SECRET_KEY", "DATABASE_URL"].filter(
    (field) => !process.env[field],
  );
  if (missing.length > 0) {
    throw new Error(`Clerk browser setup is missing fields: ${missing.join(", ")}`);
  }
  const secretKey = process.env.CLERK_SECRET_KEY!;
  const databaseUrl = process.env.DATABASE_URL!;
  const clerkConfig = resolveClerkBootstrapConfig({
    publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY,
    runtimeHostname: new URL(BASE_URL).hostname,
  });

  assertDisposableClerkTenant(secretKey);
  const clerk = createClerkClient({ secretKey });
  await assertClerkTestPermissions(clerk);

  const localUserId = `e2e-clerk-${randomUUID()}`;
  // Clerk's reserved development test-email subaddress accepts verification
  // code 424242 without a dashboard allowlist or a real mailbox.
  const email = `e2e-clerk-${randomUUID()}+clerk_test@example.com`;
  const password = `E2e-${randomUUID()}!9`;
  process.env.E2E_CLERK_EMAIL = email;
  process.env.E2E_CLERK_PASSWORD = password;
  const database = new pg.Client({ connectionString: databaseUrl });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let createdFixture: ClerkBrowserFixture | null = null;
  try {
    await database.connect();
    // Read-only schema validation must precede both provider and database
    // fixture writes. In particular, do not create a Clerk user and then
    // discover that an unmigrated database cannot persist its role.
    await assertReleaseSchema(database);
    await mkdir("tests/.auth", { recursive: true });
    const previousFixture = await readClerkBrowserFixture();
    if (previousFixture) {
      await cleanupClerkBrowserFixture(clerk, database, previousFixture);
      await removeClerkBrowserFixtureMarker();
    }
    const clerkUser = await clerk.users.createUser({
      externalId: localUserId,
      emailAddress: [email],
      password,
      firstName: "Playwright",
      lastName: "Owner",
      skipLegalChecks: true,
    });
    createdFixture = {
      clerkUserId: clerkUser.id,
      localUserId,
    };
    // Persist the marker before the local insert so a setup failure can be
    // recovered both in this process and by the next run.
    await writeClerkBrowserFixture(createdFixture);
    await database.query(
      `INSERT INTO users (
         id, clerk_user_id, email, first_name, last_name, approved, rejected, role
       )
       VALUES ($1, $2, $3, 'Playwright', 'Owner', true, false, 'Admin')
       ON CONFLICT (id) DO UPDATE
       SET clerk_user_id = EXCLUDED.clerk_user_id,
           approved = true,
           rejected = false,
           role = 'Admin'`,
      [localUserId, clerkUser.id, email],
    );
    const chromiumExecutable = findChromium();
    browser = await chromium.launch(
      chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await clerkSetup({
      publishableKey: clerkConfig.publishableKey,
      secretKey,
      frontendApiUrl: clerkConfig.frontendApiHost,
    });
    await setupClerkTestingToken({
      context,
      options: { frontendApiUrl: clerkConfig.frontendApiHost },
    });
    await page.goto(`${BASE_URL}/sign-in`);
    await clerkTesting.signIn({ page, emailAddress: email });
    const authenticatedUser = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/user") && response.status() === 200,
      { timeout: 30_000 },
    );
    await page.goto(`${BASE_URL}/`);
    await authenticatedUser;

    await context.storageState({ path: "tests/.auth/user.json" });
  } catch (error) {
    if (createdFixture) {
      try {
        await cleanupClerkBrowserFixture(clerk, database, createdFixture);
        await removeClerkBrowserFixtureMarker();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Browser fixture setup and cleanup both failed",
        );
      }
    }
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await database.end().catch(() => {});
  }
}

export default globalSetup;
