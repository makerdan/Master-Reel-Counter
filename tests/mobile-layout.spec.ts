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

  test("Mobile Flow input text size remains stable across rotation @mobile-image-orientation", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Mobile input sizing ${Date.now()}`);
    cleanupIds.push(sess.id);

    await page.goto(`/session/${sess.id}`);
    await page.waitForLoadState("domcontentloaded");
    const mobileHeader = page.locator('[data-testid="header-mobile-flow"]');
    const mobileToggle = page.locator('[data-testid="button-toggle-mobile"]');
    await expect(mobileToggle).toBeVisible();
    if (!(await mobileHeader.isVisible().catch(() => false))) {
      await mobileToggle.click();
    }
    await expect(mobileHeader).toBeVisible();

    const aisle = page.locator('[data-testid="input-mobile-aisle"]');
    const section = page.locator('[data-testid="input-mobile-section"]');
    await aisle.fill("A-12");
    await section.fill("7");

    const portraitMetrics = await page.evaluate(() => {
      const getMetrics = (testId: string) => {
        const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
        if (!input) throw new Error(`Missing ${testId}`);
        const styles = getComputedStyle(input);
        return {
          value: input.value,
          fontSize: styles.fontSize,
          height: input.getBoundingClientRect().height,
        };
      };
      const label = document.querySelector("label");
      const cameraButton = document.querySelector('[data-testid="button-mobile-camera"]');
      if (!label || !cameraButton) throw new Error("Missing Mobile Flow surrounding controls");
      return {
        aisle: getMetrics("input-mobile-aisle"),
        section: getMetrics("input-mobile-section"),
        labelFontSize: getComputedStyle(label).fontSize,
        cameraButtonFontSize: getComputedStyle(cameraButton).fontSize,
      };
    });

    expect(portraitMetrics.aisle).toMatchObject({ value: "A-12", fontSize: "60px" });
    expect(portraitMetrics.section).toMatchObject({ value: "7", fontSize: "60px" });
    expect(portraitMetrics.aisle.height).toBe(72);
    expect(portraitMetrics.section.height).toBe(72);

    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(async () => page.evaluate(() => ({
      aisle: (document.querySelector('[data-testid="input-mobile-aisle"]') as HTMLInputElement)?.value,
      section: (document.querySelector('[data-testid="input-mobile-section"]') as HTMLInputElement)?.value,
      aisleFontSize: getComputedStyle(document.querySelector('[data-testid="input-mobile-aisle"]')!).fontSize,
      sectionFontSize: getComputedStyle(document.querySelector('[data-testid="input-mobile-section"]')!).fontSize,
    }))).toEqual({
      aisle: "A-12",
      section: "7",
      aisleFontSize: "60px",
      sectionFontSize: "60px",
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const returnedMetrics = await page.evaluate(() => {
      const getMetrics = (testId: string) => {
        const input = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
        if (!input) throw new Error(`Missing ${testId}`);
        const styles = getComputedStyle(input);
        return {
          value: input.value,
          fontSize: styles.fontSize,
          height: input.getBoundingClientRect().height,
        };
      };
      const label = document.querySelector("label");
      const cameraButton = document.querySelector('[data-testid="button-mobile-camera"]');
      if (!label || !cameraButton) throw new Error("Missing Mobile Flow surrounding controls");
      return {
        aisle: getMetrics("input-mobile-aisle"),
        section: getMetrics("input-mobile-section"),
        labelFontSize: getComputedStyle(label).fontSize,
        cameraButtonFontSize: getComputedStyle(cameraButton).fontSize,
      };
    });

    expect(returnedMetrics).toEqual(portraitMetrics);
  });

  test("offline pending-count badge is visible on mobile", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Mobile denied join ${Date.now()}`);
    cleanupIds.push(sess.id);

    await page.goto(`/session/${sess.id}`);
    await page.waitForLoadState("domcontentloaded");

    const currentUserId = await page.evaluate(async () => {
      const response = await fetch("/api/auth/user", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Could not resolve current user (${response.status})`);
      return (await response.json()).id as string;
    });
    await page.evaluate(({ sid, currentUserId }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("reel-counter-offline", 2);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("entry-queue", "readwrite");
          tx.objectStore("entry-queue").put({
            id: `mobile-test-${Date.now()}`,
            sessionId: sid,
            userId: currentUserId,
            data: { aisle: "A", section: "1", category: "TEST", footage: 100, reelCount: 1 },
            createdAt: Date.now(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, { sid: sess.id, currentUserId });

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
    const sess = await createSessionViaApi(request, `Mobile denied join ${Date.now()}`);

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
    await page.waitForLoadState("domcontentloaded");

    // Wait until the app has created at least one WebSocket (tracked by PatchedWS)
    await page.waitForFunction(() => {
      const sockets = (window as unknown as Record<string, WebSocket[]>).__testWsSockets ?? [];
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
