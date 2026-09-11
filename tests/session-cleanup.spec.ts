/**
 * @feature session-cleanup
 * Guards localStorage key hygiene for the delete/reset lifecycle:
 *   - Trashing a session must remove ALL *-{sid} keys (clearSessionKeys),
 *     including scanner keys, undo/redo stacks, and the tab preference.
 *   - Resetting a session must remove scanner+undo keys (clearSessionResetKeys)
 *     but MUST preserve session-tab-{sid} (tab/view preference is intentionally
 *     kept so the UI returns to the same view after reset).
 */
import { test, expect, createSessionViaApi } from "./fixtures";

async function getKeyPresence(
  page: import("@playwright/test").Page,
  keys: string[],
): Promise<Record<string, boolean>> {
  return page.evaluate((ks) => {
    const r: Record<string, boolean> = {};
    for (const k of ks) r[k] = localStorage.getItem(k) !== null;
    return r;
  }, keys);
}

test.describe("session state cleanup @session-cleanup", () => {
  test("trashing a session removes all *-{id} localStorage keys", async ({
    page,
    request,
  }) => {
    const sess = await createSessionViaApi(request, `Cleanup Trash ${Date.now()}`);
    const sid = sess.id;
    const allKeys = [
      `session-tab-${sid}`,
      `scanner-zoom-${sid}`,
      `scanner-select-${sid}`,
      `scanner-results-${sid}`,
      `reelcounter:undo-stack:${sid}`,
      `reelcounter:redo-stack:${sid}`,
    ];

    await page.goto(`/session/${sid}`);
    await page.waitForLoadState("domcontentloaded");

    // Plant scanner + undo/redo keys to simulate a prior session
    await page.evaluate((keys) => {
      const [tabKey, zoomKey, selectKey, resultsKey, undoKey, redoKey] = keys;
      localStorage.setItem(tabKey, "entries");
      localStorage.setItem(zoomKey, JSON.stringify({ "1": 0.12 }));
      localStorage.setItem(selectKey, JSON.stringify({ "1": true }));
      localStorage.setItem(resultsKey, JSON.stringify([{ pinId: 1, rawText: "TEST" }]));
      localStorage.setItem(undoKey, JSON.stringify([{ type: "DELETE_ENTRY", payload: {} }]));
      localStorage.setItem(redoKey, JSON.stringify([]));
    }, allKeys);

    const before = await getKeyPresence(page, allKeys);
    for (const k of allKeys) {
      expect(before[k], `${k} should exist before trash`).toBe(true);
    }

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const menuBtn = page.locator(`[data-testid="button-session-menu-${sid}"]`);
    await expect(menuBtn).toBeVisible({ timeout: 10_000 });
    await menuBtn.click();

    const trashItem = page.locator(`[data-testid="menu-delete-session-${sid}"]`);
    await expect(trashItem).toBeVisible({ timeout: 5_000 });
    await trashItem.click();

    const confirmBtn = page.locator('[data-testid="button-confirm-delete-session"]');
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
    await confirmBtn.click();

    await page.waitForTimeout(2_000);

    const after = await getKeyPresence(page, allKeys);
    for (const k of allKeys) {
      expect(after[k], `${k} must be removed after session is trashed`).toBe(false);
    }

    // Permanently delete the trashed session so it doesn't accumulate across runs
    await request.delete(`/api/sessions/${sid}/permanent`).catch(() => {});
  });

  test("resetting a session clears scanner/undo keys but preserves session-tab", async ({
    page,
    request,
  }) => {
    const sess = await createSessionViaApi(request, `Cleanup Reset ${Date.now()}`);
    const sid = sess.id;

    // Keys cleared by clearSessionResetKeys (scanner + undo/redo stacks)
    const resetKeys = [
      `scanner-zoom-${sid}`,
      `scanner-select-${sid}`,
      `scanner-results-${sid}`,
      `reelcounter:undo-stack:${sid}`,
      `reelcounter:redo-stack:${sid}`,
    ];
    // session-tab is intentionally preserved by clearSessionResetKeys
    const tabKey = `session-tab-${sid}`;

    await page.goto(`/session/${sid}`);
    await page.waitForLoadState("domcontentloaded");

    // Plant all keys
    await page.evaluate(([tk, ...rk]) => {
      localStorage.setItem(tk, "entries");
      const [zk, sk, resk, undoK, redoK] = rk;
      localStorage.setItem(zk, JSON.stringify({ "1": 0.12 }));
      localStorage.setItem(sk, JSON.stringify({ "1": true }));
      localStorage.setItem(resk, JSON.stringify([{ pinId: 1, rawText: "TEST" }]));
      localStorage.setItem(undoK, JSON.stringify([{ type: "DELETE_ENTRY", payload: {} }]));
      localStorage.setItem(redoK, JSON.stringify([]));
    }, [tabKey, ...resetKeys]);

    const before = await getKeyPresence(page, [tabKey, ...resetKeys]);
    for (const k of [tabKey, ...resetKeys]) {
      expect(before[k], `${k} should exist before reset`).toBe(true);
    }

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const menuBtn = page.locator(`[data-testid="button-session-menu-${sid}"]`);
    await expect(menuBtn).toBeVisible({ timeout: 10_000 });
    await menuBtn.click();

    const resetItem = page.getByRole("menuitem", { name: /reset/i }).first();
    await expect(
      resetItem,
      "Reset menu item must be present in the session context menu",
    ).toBeVisible({ timeout: 5_000 });
    await resetItem.click();

    const confirmReset = page.getByRole("button", { name: /reset|confirm/i }).last();
    if (await confirmReset.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmReset.click();
    }

    await page.waitForTimeout(2_000);

    // Scanner + undo/redo keys must be gone
    const after = await getKeyPresence(page, [tabKey, ...resetKeys]);
    for (const k of resetKeys) {
      expect(after[k], `${k} must be removed after session reset`).toBe(false);
    }

    // session-tab must still be present (preserved intentionally)
    expect(
      after[tabKey],
      "session-tab-{id} must NOT be cleared by reset — view preference should survive",
    ).toBe(true);

    await request.delete(`/api/sessions/${sid}/permanent`).catch(() => {});
  });
});
