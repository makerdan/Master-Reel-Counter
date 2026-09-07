import { expect, test } from "@playwright/test";

test.describe("support help", () => {
  test("searchable help guide is available without hover-only controls", async ({ page }) => {
    await page.goto("/help");
    const search = page.getByTestId("input-help-search");
    await expect(search).toBeVisible();
    await search.fill("mobile");
    await expect(page.getByRole("heading", { name: "Capture with Mobile Flow" })).toBeVisible();
    await expect(search).toHaveAttribute("placeholder", /Search help|Search sessions/);
  });
});