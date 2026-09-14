import { expect, test } from "@playwright/test";

test("shows a safe recovery view after Clerk fails and retries without losing the return path", async ({
  page,
}) => {
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

  await page.unroute("**/npm/@clerk/clerk-js@*/dist/clerk.browser.js");
  await page.getByTestId("button-retry-clerk").click();

  await expect(page).toHaveURL(
    new RegExp(`/sign-in\\?redirect_url=${encodeURIComponent(returnPath)}`),
  );
  await expect(page.getByTestId("clerk-bootstrap-recovery")).not.toBeVisible({
    timeout: 30_000,
  });
});