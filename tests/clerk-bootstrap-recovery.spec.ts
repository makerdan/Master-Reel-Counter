import { expect, test } from "@playwright/test";

test("shows a safe recovery view after Clerk fails and retries without losing the return path", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  expect(baseURL, "recovery test requires the configured app origin").toBeTruthy();
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: {},
    storageState: { cookies: [], origins: [] },
  });
  let recoveredContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const page = await context.newPage();
    await page.route("**/npm/@clerk/clerk-js@*/dist/clerk.browser.js", (route) =>
      route.abort("failed"),
    );

    const returnPath = "/session/123";
    await page.goto(`/sign-in?redirect_url=${encodeURIComponent(returnPath)}`);

    await expect(page.getByTestId("clerk-bootstrap-recovery")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Authentication service is unavailable")).toBeVisible();
    await expect(page.getByTestId("button-retry-clerk")).toBeVisible();
    await expect(page.getByText("Dashboard")).not.toBeVisible();

    await page.unrouteAll({ behavior: "wait" });
    await Promise.all([
      page.waitForNavigation(),
      page.getByTestId("button-retry-clerk").click(),
    ]);

    await expect(page).toHaveURL(
      new RegExp(`/sign-in\\?redirect_url=${encodeURIComponent(returnPath)}`),
    );
    const recoveryUrl = page.url();
    recoveredContext = await browser.newContext({
      baseURL,
      extraHTTPHeaders: {},
      storageState: { cookies: [], origins: [] },
    });
    const recoveredPage = await recoveredContext.newPage();
    await recoveredPage.goto(recoveryUrl);
    await recoveredPage.waitForFunction(
      () =>
        (globalThis as typeof globalThis & {
          Clerk?: { loaded?: boolean };
        }).Clerk?.loaded === true,
      undefined,
      { timeout: 45_000 },
    );
    await expect(recoveredPage.locator(".cl-signIn-root")).toBeVisible();
  } finally {
    await recoveredContext?.close();
    await context.close();
  }
});
