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
import { buildPublishableKey, parsePublishableKey } from "@clerk/shared/keys";
import pg from "pg";

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
  const configuredPublishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY;
  const clerkFrontendHost =
    process.env.VITE_CLERK_PUBLIC_HOST ??
    parsePublishableKey(configuredPublishableKey)?.frontendApi;
  if (
    !process.env.CLERK_SECRET_KEY ||
    !process.env.DATABASE_URL ||
    !clerkFrontendHost
  ) {
    throw new Error(
      "Clerk browser setup requires CLERK_SECRET_KEY, DATABASE_URL, and a valid Clerk publishable key or frontend host",
    );
  }
  const clerkPublishableKey =
    configuredPublishableKey ?? buildPublishableKey(clerkFrontendHost);

  const localUserId = `e2e-clerk-${randomUUID()}`;
  const email = `e2e-clerk+${randomUUID()}@example.com`;
  const password = `E2e-${randomUUID()}!9`;
  process.env.E2E_CLERK_EMAIL = email;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  const clerkUser = await clerk.users.createUser({
    externalId: localUserId,
    emailAddress: [email],
    password,
    firstName: "Playwright",
    lastName: "Owner",
    skipLegalChecks: true,
  });
  await database.query(
    `INSERT INTO users (id, email, first_name, last_name, approved, rejected, role)
     VALUES ($1, $2, 'Playwright', 'Owner', true, false, 'Admin')
     ON CONFLICT (id) DO UPDATE SET approved = true, rejected = false, role = 'Admin'`,
    [clerkUser.id, email],
  );
  await database.end();

  const chromiumExecutable = findChromium();
  const browser = await chromium.launch(
    chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
  );
  const context = await browser.newContext();
  const page = await context.newPage();
  await clerkSetup({
    publishableKey: clerkPublishableKey,
    secretKey: process.env.CLERK_SECRET_KEY,
    frontendApiUrl: clerkFrontendHost,
  });
  await setupClerkTestingToken({
    context,
    options: { frontendApiUrl: clerkFrontendHost },
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

  await mkdir("tests/.auth", { recursive: true });
  await context.storageState({ path: "tests/.auth/user.json" });
  await browser.close();
}

export default globalSetup;
