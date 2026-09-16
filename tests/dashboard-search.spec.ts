import { test, expect, createSessionViaApi } from "./fixtures";

test.describe("dashboard search", () => {
  test("loads matches beyond the first owned page and keeps recent searches available", async ({
    page,
    request,
  }) => {
    const token = `Dashboard Search ${Date.now()}`;
    const match = await createSessionViaApi(request, `${token} Match`);

    // The dashboard loads 50 owned sessions at a time. Create enough newer
    // sessions that the matching session is on a later page.
    for (let i = 0; i < 50; i++) {
      await createSessionViaApi(request, `${token} Distractor ${i}`);
    }

    await page.goto("/");
    const search = page.getByTestId("input-search-sessions");
    await expect(search).toBeVisible();

    await search.fill(token);
    await expect(
      page.getByTestId(`card-session-${match.id}`),
      "search should load a matching owned session from a later page",
    ).toBeVisible({ timeout: 30_000 });

    await search.press("Enter");
    await page.getByTestId("button-clear-search").click();
    await search.focus();
    await expect(page.getByTestId("dropdown-recent-searches")).toBeVisible();
    await expect(page.getByTestId(`item-recent-search-${token}`)).toBeVisible();

    await page.getByTestId(`button-select-recent-${token}`).click();
    await expect(search).toHaveValue(token);
    await expect(page.getByTestId(`card-session-${match.id}`)).toBeVisible();
  });

  test("applies structured filters and preserves sorting and search state after reload", async ({
    page,
    request,
  }) => {
    const suffix = Date.now();
    const active = await createSessionViaApi(request, `Filter Active ${suffix}`);
    const completed = await createSessionViaApi(request, `Filter Completed ${suffix}`);
    const statusResponse = await request.post("/api/sessions/bulk/status", {
      data: { ids: [completed.id], status: "completed" },
    });
    expect(
      statusResponse.ok(),
      `status update failed: HTTP ${statusResponse.status()} ${await statusResponse.text()}`,
    ).toBeTruthy();

    await page.goto("/");
    await page.getByTestId("button-toggle-filter-bar").click();
    await page.getByTestId("filter-status-completed").click();
    await expect(page.getByTestId(`card-session-${completed.id}`)).toBeVisible();
    await expect(page.getByTestId(`card-session-${active.id}`)).toHaveCount(0);

    await page.getByTestId("button-sort-sessions").click();
    await page.getByTestId("menu-sort-name").click();
    await page.reload();

    await expect(page.getByTestId("input-search-sessions")).toHaveValue("");
    await expect(page.getByTestId("chip-filter-status")).toContainText("completed");
    await expect(page.getByTestId(`card-session-${completed.id}`)).toBeVisible();
    await expect(page.getByTestId(`card-session-${active.id}`)).toHaveCount(0);
  });

  test("shows a retryable search failure instead of no results", async ({ page }) => {
    let shouldFail = true;
    await page.route("**/api/search/sessions**", async (route) => {
      if (shouldFail) {
        shouldFail = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "temporary failure" }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto("/");
    const search = page.getByTestId("input-search-sessions");
    await search.fill(`Transient Search ${Date.now()}`);

    await expect(page.getByTestId("button-retry-search")).toBeVisible();
    await expect(page.getByTestId("no-search-results")).toHaveCount(0);

    await page.getByTestId("button-retry-search").click();
    await expect(page.getByTestId("button-retry-search")).toHaveCount(0);
  });
});
