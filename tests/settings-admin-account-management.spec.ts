import { expect, test } from "@playwright/test";

const ownerUser = {
  id: "owner-account-management",
  email: "owner@example.com",
  firstName: "Owner",
  lastName: "Account",
  approved: true,
  rejected: false,
  role: "Admin",
};

async function fulfillJson(
  route: import("@playwright/test").Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockOwnerAuth(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/auth/user", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      body: JSON.stringify({ ...body, role: "Admin" }),
    });
  });
}

test.describe("owner account-management loading", () => {
  test("shows loading and a retryable owner error before succeeding", async ({ page }) => {
    await mockOwnerAuth(page);
    let requestCount = 0;
    await page.route("**/api/admin/users", async (route) => {
      requestCount += 1;
      if (requestCount === 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await fulfillJson(route, { message: "temporary failure" }, 503);
        return;
      }
      await fulfillJson(route, [ownerUser]);
    });

    await page.goto("/settings#admin");
    await expect(page.getByTestId("tab-trigger-admin")).toBeVisible();
    await expect(page.getByTestId("admin-users-loading")).toBeVisible();
    await expect(page.getByTestId("admin-users-error")).toBeVisible();
    await expect(page.getByText("Check your connection and try again.")).toBeVisible();

    await page.getByTestId("button-retry-admin-users").click();
    await expect(page.getByTestId(`row-user-${ownerUser.id}`)).toBeVisible();
  });

  test("does not show a non-owner denial as an owner error", async ({ page }) => {
    await page.route("**/api/auth/user", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        body: JSON.stringify({ ...body, isOwner: false }),
      });
    });
    await page.route("**/api/admin/users", async (route) => {
      await fulfillJson(route, { message: "Forbidden" }, 403);
    });

    await page.goto("/settings#admin");
    await expect(page.getByTestId("tab-trigger-admin")).toHaveCount(0);
    await expect(page.getByTestId("admin-users-error")).toHaveCount(0);
  });
});

test("keeps block-list confirmation accurate when its count request fails", async ({ page }) => {
  await mockOwnerAuth(page);
  let countRequestCount = 0;
  await page.route("**/api/admin/users", async (route) => {
    await fulfillJson(route, [ownerUser]);
  });
  await page.route("**/api/admin/rejected-users/count", async (route) => {
    countRequestCount += 1;
    if (countRequestCount === 1) {
      await fulfillJson(route, { message: "temporary failure" }, 503);
      return;
    }
    await fulfillJson(route, { count: 2 });
  });

  const initialCountFailure = page.waitForResponse(
    (response) =>
      response.url().includes("/api/admin/rejected-users/count") &&
      response.status() === 503,
  );
  await page.goto("/settings#admin");
  await initialCountFailure;
  await expect(page.getByTestId("rejected-count-error")).toBeVisible();
  await expect(page.getByTestId("button-clear-rejected")).toBeDisabled();

  await page.getByTestId("button-retry-rejected-count").click();
  await expect(page.getByTestId("button-clear-rejected")).toBeEnabled();
  await page.getByTestId("button-clear-rejected").click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("This will unblock 2 rejected users");
  await expect(page.getByTestId("button-confirm-clear-rejected")).toHaveText("Clear 2 blocked users");
});