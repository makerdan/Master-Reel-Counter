/**
 * @feature mobile
 * Guards status indicators at 390×844 (iPhone 14-class viewport):
 *   1. Offline pending-count badge renders with a non-zero count.
 *   2. WS reconnect countdown banner (text-ws-reconnecting-mobile) renders when
 *      wsStatus=reconnecting (browser online, WS dropped).
 */
import { test, expect, createSessionViaApi } from "./fixtures";
import type { Page } from "@playwright/test";

async function installWebSocketMockCompatibility(page: Page) {
  await page.addInitScript(() => {
    // Playwright's routeWebSocket mock (_WebSocketMock) calls URL.parse() internally.
    // URL.parse is only available in Chrome 120+; polyfill it for older Chromium builds.
    if (typeof (URL as unknown as Record<string, unknown>).parse !== "function") {
      (URL as unknown as Record<string, unknown>).parse = (url: string, base?: string) => {
        try { return new URL(url, base); } catch { return null; }
      };
    }
  });
}

test.describe("mobile layout parity @mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("offline pending-count badge is visible on mobile", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Mobile Offline ${Date.now()}`);
    cleanupIds.push(sess.id);

    await page.goto(`/session/${sess.id}`);
    await page.waitForLoadState("networkidle");

    // Plant a pending entry into the offline queue
    await page.evaluate((sid) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("reel-counter-offline", 2);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("entry-queue", "readwrite");
          tx.objectStore("entry-queue").put({
            id: `mobile-test-${Date.now()}`,
            sessionId: sid,
            data: { aisle: "A", section: "1", category: "TEST", footage: 100, reelCount: 1 },
            createdAt: Date.now(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, sess.id);

    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline-queue-change")));

    await expect(
      page.locator('[data-testid="network-status-indicator"]'),
      "NetworkStatusIndicator must be visible at 390px",
    ).toBeVisible({ timeout: 8_000 });

    const pendingCount = page.locator('[data-testid="text-pending-count"]');
    await expect(
      pendingCount,
      "text-pending-count badge must render on mobile when there are queued entries",
    ).toBeVisible({ timeout: 5_000 });
    expect(
      parseInt((await pendingCount.textContent()) ?? "0", 10),
      "Pending-count badge should display at least 1 queued item",
    ).toBeGreaterThan(0);

    await page.context().setOffline(false);
    await page.evaluate(() => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("reel-counter-offline", 2);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("entry-queue", "readwrite");
          tx.objectStore("entry-queue").clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });
  });

  test("WS reconnect countdown banner is visible on mobile", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Mobile WS ${Date.now()}`);
    cleanupIds.push(sess.id);

    // Track WS instances so we can close the live socket without going offline
    // (offline shows a different indicator; reconnecting shows while online but WS dropped).
    await installWebSocketMockCompatibility(page);
    await page.addInitScript(() => {
      const tracked: WebSocket[] = [];
      (window as unknown as Record<string, unknown>).__testWsSockets = tracked;
      const OrigWS = window.WebSocket;
      const PatchedWS = function (this: WebSocket, url: string, protocols?: string | string[]) {
        const ws = new OrigWS(url, protocols);
        tracked.push(ws);
        return ws;
      } as unknown as typeof WebSocket;
      PatchedWS.prototype = OrigWS.prototype;
      (["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const).forEach(
        (k) => ((PatchedWS as unknown as Record<string, unknown>)[k] = OrigWS[k]),
      );
      window.WebSocket = PatchedWS;
    });

    // Allow the first WS connection; reject reconnect attempts so the app stays
    // in the countdown state rather than immediately recovering.
    let firstConnection = true;
    await page.routeWebSocket(/\/ws/, (ws) => {
      if (firstConnection) { firstConnection = false; ws.connectToServer(); }
      else ws.close();
    });

    await page.goto(`/session/${sess.id}`);
    await page.waitForLoadState("networkidle");

    // Wait until the app has created at least one WebSocket (tracked by PatchedWS)
    await page.waitForFunction(() => {
      const sockets = (window as unknown as Record<string, WebSocket[]>).__testWsSockets;
      return Array.isArray(sockets) && sockets.length > 0;
    }, undefined, { timeout: 10_000 });

    // Close all tracked sockets while online → triggers wsStatus=reconnecting.
    // Don't filter by readyState because _WebSocketMock may not proxy it correctly.
    await page.evaluate(() => {
      const sockets = (window as unknown as Record<string, WebSocket[]>).__testWsSockets ?? [];
      for (const s of sockets) {
        try { s.close(1000, "test-force-reconnect"); } catch { /* ignore if already closed */ }
      }
    });

    await expect(
      page.locator('[data-testid="text-ws-reconnecting-mobile"]'),
      "WS reconnect countdown banner must be visible at 390px when wsStatus=reconnecting",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("denied join shows an access outcome without reconnecting", async ({
    page,
    request,
    cleanupIds,
  }) => {
    await installWebSocketMockCompatibility(page);
    const sess = await createSessionViaApi(request, `Mobile denied join ${Date.now()}`);
    cleanupIds.push(sess.id);

    let connectionCount = 0;
    await page.routeWebSocket(/\/ws/, (ws) => {
      connectionCount++;
      ws.onMessage((message) => {
        const parsed = JSON.parse(String(message));
        if (parsed.type === "join") {
          ws.send(JSON.stringify({
            type: "authorization_changed",
            outcome: "denied_join",
            message: "You are not authorized to join this session.",
          }));
        }
      });
    });

    await page.goto(`/session/${sess.id}`);
    await expect(
      page.locator('[data-testid="text-ws-access-outcome"]'),
      "denied joins must expose a stable access outcome",
    ).toContainText("not authorized", { timeout: 10_000 });

    await page.waitForTimeout(1_500);
    expect(connectionCount, "terminal authorization changes must not reconnect").toBe(1);
    await expect(page.locator('[data-testid="text-ws-reconnecting"]')).toHaveCount(0);
  });
});
