/**
 * @feature review
 * Guards reviewer-position persistence: the current entry index is stored in
 * sessionStorage and must be restored after a hard page reload so a reviewer
 * does not lose their place.
 */
import {
  test,
  expect,
  createSessionViaApi,
  createEntryViaApi,
} from "./fixtures";

test.describe("review tab persistence @review", () => {
  test("reviewer position is restored after hard reload", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(
      request,
      `Review Persist ${Date.now()}`,
    );
    cleanupIds.push(sess.id);

    // Need enough entries that index 3 is reachable (0-based)
    for (let i = 0; i < 5; i++) {
      await createEntryViaApi(request, sess.id, {
        aisle: "A",
        section: String(i + 1),
      });
    }

    await page.goto(`/session/${sess.id}`);
    await page.waitForLoadState("networkidle");
    await page.click('[data-testid="tab-review-mode"]');

    const container = page.locator('[data-testid="review-tab-container"]');
    await expect(container).toBeVisible({ timeout: 10_000 });

    // Wait for cohort assignment (loading gate)
    const cohortPending = page.locator(
      '[data-testid="text-review-cohort-pending"]',
    );
    await expect(cohortPending).toBeHidden({ timeout: 15_000 });

    // Advance to entry index 3 (click Next 3 times from entry 0)
    const nextBtn = page.locator('[data-testid="button-review-next"]');
    for (let i = 0; i < 3; i++) {
      await expect(nextBtn).toBeVisible({ timeout: 5_000 });
      await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
      await nextBtn.click();
      await page.waitForTimeout(300);
    }

    // Read the counter text, e.g. "4 / 5" (1-based display of index 3)
    const counterEl = page.locator('[data-testid="text-review-entry-counter"]');
    await expect(counterEl).toBeVisible();
    const counterBefore = await counterEl.textContent();

    // Hard reload
    await page.reload();
    await page.click('[data-testid="tab-review-mode"]');
    await expect(container).toBeVisible({ timeout: 10_000 });
    await expect(cohortPending).toBeHidden({ timeout: 15_000 });

    // The counter should be the same position as before reload
    await expect(counterEl).toBeVisible({ timeout: 10_000 });
    const counterAfter = await counterEl.textContent();
    expect(counterAfter).toBe(counterBefore);
  });
});
