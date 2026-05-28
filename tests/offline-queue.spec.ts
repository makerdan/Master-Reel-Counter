/**
 * @feature offline-queue
 * Guards the logout guard flow: attempting to sign out while there are
 * unsynced offline items must show a warning dialog. After cancelling and
 * clearing the queue the pending-count badge must return to 0 (or hide).
 */
import { test, expect, createSessionViaApi } from "./fixtures";

async function clearOfflineQueue(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("reel-counter-offline", 2);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("entry-queue")) { resolve(); return; }
        const tx = db.transaction("entry-queue", "readwrite");
        tx.objectStore("entry-queue").clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

test.describe("offline queue warning @offline-queue", () => {
  test("logout guard dialog appears when there are pending offline items", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Offline Guard ${Date.now()}`);
    cleanupIds.push(sess.id);

    // Navigate to "/" while ONLINE so the page is loaded before going offline.
    // In dev mode there is no service worker, so page.goto() while offline would
    // fail with a network error. Loading the page first avoids that.
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Plant a queued entry in IndexedDB (works on any page; IndexedDB is browser-wide)
    await page.evaluate((sid) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("reel-counter-offline", 2);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("entry-queue", "readwrite");
          tx.objectStore("entry-queue").put({
            id: `test-offline-${Date.now()}`,
            sessionId: sid,
            data: { aisle: "A", section: "99", category: "TEST", footage: 100, reelCount: 1 },
            createdAt: Date.now(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, sess.id);

    // Go offline and notify the app about the queue change
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline-queue-change")));

    const indicator = page.locator('[data-testid="network-status-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 8_000 });

    // Attempt logout; fall back to avatar dropdown if the button isn't directly visible
    const logoutBtn = page.getByRole("button", { name: /sign out|log out|logout/i }).first();
    if (!await logoutBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const avatarBtn = page.locator('button[aria-label*="user" i], button[aria-label*="account" i]').first();
      if (await avatarBtn.isVisible({ timeout: 2_000 }).catch(() => false)) await avatarBtn.click();
    }
    await page.getByRole("button", { name: /sign out|log out|logout/i }).first().click();

    // Guard dialog must appear
    const guardDialog = page.locator('[data-testid="dialog-logout-guard"]');
    await expect(
      guardDialog,
      "Logout guard dialog must appear when there are pending offline items",
    ).toBeVisible({ timeout: 8_000 });

    // Cancel — dialog must hide
    await page.click('[data-testid="button-logout-guard-cancel"]');
    await expect(
      guardDialog,
      "Guard dialog must hide after clicking cancel",
    ).toBeHidden({ timeout: 5_000 });

    // Restore network, clear queue, dispatch change event
    await page.context().setOffline(false);
    await clearOfflineQueue(page);
    await page.evaluate(() => window.dispatchEvent(new Event("offline-queue-change")));

    await page.waitForTimeout(1_000);

    // After queue is empty the pending-count badge should show 0 or be hidden
    const pendingCountEl = page.locator('[data-testid="text-pending-count"]');
    if (await pendingCountEl.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const count = parseInt((await pendingCountEl.textContent()) ?? "0", 10);
      expect(count, "Pending-count badge must be 0 after queue is cleared").toBe(0);
    }
  });
});
