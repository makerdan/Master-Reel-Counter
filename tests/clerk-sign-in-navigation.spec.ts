import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { parsePublishableKey } from "@clerk/shared/keys";
import { clerk as clerkTesting, setupClerkTestingToken } from "@clerk/testing/playwright";
import { buildSignInPath, getReturnPathFromSearch } from "../shared/auth-routing";

async function signedOutContext(browser: Browser, baseURL: string): Promise<BrowserContext> {
  const frontendApiUrl = parsePublishableKey(
    process.env.VITE_CLERK_PUBLISHABLE_KEY,
  )?.frontendApi;
  if (!frontendApiUrl) throw new Error("Browser tests require a valid Clerk frontend API");
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "x-replit-e2e": "1" },
    storageState: { cookies: [], origins: [] },
  });
  await setupClerkTestingToken({ context, options: { frontendApiUrl } });
  return context;
}

async function activateTestSession(page: import("@playwright/test").Page) {
  const emailAddress = process.env.E2E_CLERK_EMAIL;
  if (!emailAddress) throw new Error("Browser fixture did not provide a disposable Clerk account");
  await clerkTesting.signIn({ page, emailAddress });
  await page.waitForFunction(
    () => Boolean((window as typeof window & {
      Clerk?: { loaded?: boolean; session?: { id?: string } | null };
    }).Clerk?.loaded && (window as typeof window & {
      Clerk?: { session?: { id?: string } | null };
    }).Clerk?.session?.id),
    undefined,
    { timeout: 30_000 },
  );
}

async function submitSignInForm(page: import("@playwright/test").Page) {
  const emailAddress = process.env.E2E_CLERK_EMAIL;
  const password = process.env.E2E_CLERK_PASSWORD;
  if (!emailAddress || !password) {
    throw new Error("Browser fixture did not provide disposable Clerk sign-in details");
  }
  await page.getByLabel("Email address").fill(emailAddress);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  const verificationCode = page.getByRole("textbox", { name: "Enter verification code" });
  if (await verificationCode.waitFor({ state: "visible", timeout: 12_000 }).then(() => true, () => false)) {
    // Clerk submits this challenge automatically after the sixth digit.
    await verificationCode.pressSequentially("424242");
  }
}

test("signed-out Settings entry returns to protected Settings after form sign-in", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Browser test requires an app origin");
  const context = await signedOutContext(browser, baseURL);
  try {
    const page = await context.newPage();
    await page.goto("/settings");
    await expect(page.getByTestId("button-login")).toBeVisible();
    await expect(page.getByTestId("text-settings-title")).toHaveCount(0);
    await page.getByTestId("button-login").click();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    expect(new URL(page.url()).searchParams.get("redirect_url")).toBe("/settings");
    await expect(page.locator(".cl-signIn-root")).toBeVisible();

    await submitSignInForm(page);
    await page.waitForFunction(
      () => Boolean((window as typeof window & {
        Clerk?: { loaded?: boolean; session?: { id?: string } | null };
      }).Clerk?.loaded && (window as typeof window & {
        Clerk?: { session?: { id?: string } | null };
      }).Clerk?.session?.id),
      undefined,
      { timeout: 30_000 },
    );
    await expect(page).toHaveURL(new URL("/settings", baseURL).href, { timeout: 30_000 });
    await expect(page.getByTestId("text-settings-title")).toBeVisible();
    const response = await page.evaluate(async () =>
      (await fetch("/api/auth/user", { credentials: "same-origin" })).status,
    );
    expect(response).toBe(200);
  } finally {
    await context.close();
  }
});

test("unsafe sign-in return targets cannot control the authenticated route", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Browser test requires an app origin");
  const context = await signedOutContext(browser, baseURL);
  try {
    const page = await context.newPage();
    // Only allow-listed return paths may be passed to Clerk as destinations.
    expect(getReturnPathFromSearch(`?redirect_url=${encodeURIComponent("/settings")}`)).toBe("/settings");
    expect(buildSignInPath("/settings")).toBe("/sign-in?redirect_url=%2Fsettings");
    for (const target of ["https://example.invalid/", "//example.invalid/", "/sign-in", "/settings\\evil"]) {
      expect(getReturnPathFromSearch(`?redirect_url=${encodeURIComponent(target)}`)).toBeNull();
      expect(buildSignInPath(target)).toBe("/sign-in");
      await page.goto(`/sign-in?redirect_url=${encodeURIComponent(target)}`);
      await expect(page.locator(".cl-signIn-root")).toBeVisible();
    }
    const emailAddress = process.env.E2E_CLERK_EMAIL;
    if (!emailAddress) throw new Error("Browser fixture did not provide a disposable Clerk account");
    // This helper only establishes an authenticated session; the safety
    // assertion above tests the allow-list, not the form's fallback behavior.
    await activateTestSession(page);
    await page.goto("/");
    await expect(page).toHaveURL(new URL("/", baseURL).href);
    await expect(page.getByTestId("text-dashboard-title")).toBeVisible();
  } finally {
    await context.close();
  }
});