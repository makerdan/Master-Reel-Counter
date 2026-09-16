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
    await fulfillJson(route, ownerUser);
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
      await fulfillJson(route, {
        ...ownerUser,
        id: "non-owner-account-management",
        role: "User",
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

test("shows exactly the supported AI models with independent availability", async ({ page }) => {
  await mockOwnerAuth(page);
  await page.route("**/api/admin/users", async (route) => {
    await fulfillJson(route, [ownerUser]);
  });
  await page.route("**/api/admin/rejected-users/count", async (route) => {
    await fulfillJson(route, { count: 0 });
  });
  await page.route("**/api/admin/ai-health", async (route) => {
    await fulfillJson(route, {
      apiOnline: true,
      models: [
        { id: "Gemini-3.1-Pro", label: "Gemini 3.1 Pro", available: true },
        { id: "Claude-Sonnet-4.5", label: "Claude Sonnet 4.5", available: false },
        { id: "unrelated-provider-model", label: "Unrelated model", available: true },
      ],
    });
  });

  await page.goto("/settings#admin");
  await expect(page.getByTestId("section-ai-health")).toBeVisible();
  await expect(page.getByTestId("badge-ai-api-status")).toHaveClass(/border-green/);
  await expect(page.getByTestId("badge-ai-model-Gemini-3.1-Pro")).toHaveAttribute(
    "aria-label",
    "Gemini 3.1 Pro: available",
  );
  await expect(page.getByTestId("badge-ai-model-Gemini-3.1-Pro")).toHaveClass(/text-green/);
  await expect(page.getByTestId("badge-ai-model-Claude-Sonnet-4.5")).toHaveAttribute(
    "aria-label",
    "Claude Sonnet 4.5: unavailable",
  );
  await expect(page.getByTestId("badge-ai-model-Claude-Sonnet-4.5")).toHaveClass(/text-destructive/);
  await expect(page.locator('[data-testid^="badge-ai-model-"]')).toHaveCount(2);
  await expect(page.getByText("Unrelated model")).toHaveCount(0);
});