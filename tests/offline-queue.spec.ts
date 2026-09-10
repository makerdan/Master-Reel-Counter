/**
 * @feature offline-queue
 * Guards the logout guard flow: attempting to sign out while there are
 * unsynced offline items must show a warning dialog. After cancelling and
 * clearing the queue the pending-count badge must return to 0 (or hide).
 */
import { BASE_URL, test, expect, createSessionViaApi } from "./fixtures";
import { TESTER_NAME, TESTER_PASSWORD } from "./global-setup";

const protectedPaths = (sessionId: number) => [
  `/api/sessions/${sessionId}`,
  `/api/sessions/${sessionId}/entries`,
  `/api/sessions/${sessionId}/photos`,
  `/api/sessions/${sessionId}/pins`,
];

async function createProtectedUpload(
  request: import("@playwright/test").APIRequestContext,
  sessionId: number,
) {
  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const uploadResponse = await request.post("/api/uploads/direct", {
    multipart: {
      file: {
        name: "offline-cache-test.png",
        mimeType: "image/png",
        buffer: pngBuffer,
      },
    },
  });
  if (!uploadResponse.ok()) {
    throw new Error(
      `protected upload failed: ${uploadResponse.status()} ${await uploadResponse.text()}`,
    );
  }
  const upload = await uploadResponse.json();
  const photoResponse = await request.post(`/api/sessions/${sessionId}/photos`, {
    data: {
      objectStorageKey: upload.objectPath,
      originalFilename: "offline-cache-test.png",
      mimeType: "image/png",
      fileSize: pngBuffer.byteLength,
      aisle: "A",
      section: "1",
      notes: "",
      isDetailShot: false,
    },
  });
  if (!photoResponse.ok()) {
    throw new Error(
      `photo registration failed: ${photoResponse.status()} ${await photoResponse.text()}`,
    );
  }
  return upload.objectPath as string;
}

async function installServiceWorker(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
  }
  await expect.poll(
    () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBe(true);
}

async function installServiceWorkerWithCacheFailure(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  failure: "open" | "put",
) {
  const workerResponse = await request.get("/sw.js");
  expect(workerResponse.ok()).toBe(true);
  const source = await workerResponse.text();
  const rewrittenSource = source.replaceAll("caches.open", "testCaches.open");
  const cacheFailureHook =
    failure === "open"
      ? `
let testCacheOpenCount = 0;
const testCaches = Object.create(caches);
testCaches.open = (...args) => {
  testCacheOpenCount += 1;
  if (testCacheOpenCount > 2) {
    return Promise.reject(new Error("forced cache.open failure"));
  }
  return caches.open(...args);
};
`
      : `
const testCaches = Object.create(caches);
testCaches.open = (...args) =>
  caches.open(...args).then((cache) => new Proxy(cache, {
    get(target, property) {
      if (property === "put") {
        return () => Promise.reject(new Error("forced cache.put failure"));
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }));
`;

  await page.route("**/sw.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: rewrittenSource.replace("const CACHE_NAME", `${cacheFailureHook}\nconst CACHE_NAME`),
    }),
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
  }
  await expect.poll(
    () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBe(true);
}

async function putLegacyProtectedCache(
  page: import("@playwright/test").Page,
  paths: string[],
  uploadPath: string,
  identity: string,
) {
  await page.evaluate(async ({ paths, uploadPath, identity }) => {
    const apiCache = await caches.open("reel-counter-api-v1");
    await Promise.all(
      paths.map((path) =>
        apiCache.put(
          path,
          new Response(JSON.stringify({ secret: `${identity}:${path}` }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    const shellCache = await caches.open("reel-counter-v1");
    await shellCache.put(
      uploadPath,
      new Response(`previous-user-photo:${identity}`, {
        headers: { "Content-Type": "image/png" },
      }),
    );
  }, { paths, uploadPath, identity });
}

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
  test("logout and identity changes cannot expose legacy protected caches offline", async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });
    const ownerLogin = await context.request.post("/api/__test__/owner-login");
    expect(ownerLogin.ok()).toBe(true);
    const page = await context.newPage();
    const sess = await createSessionViaApi(request, `Offline Isolation ${Date.now()}`);
    try {
      const paths = protectedPaths(sess.id);
      const objectPath = await createProtectedUpload(request, sess.id);
      const uploadPath = objectPath.startsWith("/")
        ? objectPath
        : `/uploads/${objectPath}`;

      await page.goto("/");
      await installServiceWorker(page);

      for (const path of paths) {
        const response = await page.request.get(path);
        expect(response.headers()["cache-control"]).toContain("no-store");
      }

      const uploadResponse = await page.evaluate(async (uploadPath) => {
        const response = await fetch(uploadPath);
        return {
          status: response.status,
          cacheControl: response.headers.get("cache-control"),
          byteLength: (await response.arrayBuffer()).byteLength,
        };
      }, uploadPath);
      expect(uploadResponse.status).toBe(200);
      expect(uploadResponse.cacheControl).toContain("no-store");
      expect(uploadResponse.byteLength).toBeGreaterThan(0);
      expect(await page.evaluate((path) => caches.match(path).then(Boolean), uploadPath)).toBe(false);

      await putLegacyProtectedCache(page, paths, uploadPath, "owner");
      const seedResponse = await request.post("/api/__test__/seed-tester-password", {
        data: { password: TESTER_PASSWORD },
      });
      expect(seedResponse.ok()).toBe(true);
      const { ownerUserId } = await seedResponse.json();

      await context.request.get("/api/auth/tester-logout");
      await page.goto("/");
      await expect(page.locator('[data-testid="button-login"]')).toBeVisible();
      expect((await context.request.get("/api/auth/user")).status()).toBe(401);

      await page.goto("/tester-login");
      await putLegacyProtectedCache(page, paths, uploadPath, "signed-out");
      await page.locator('[data-testid="input-display-name"]').fill(TESTER_NAME);
      await page.locator('[data-testid="input-owner-access-code"]').fill(ownerUserId);
      await page.locator('[data-testid="input-tester-password"]').fill(TESTER_PASSWORD);
      await page.locator('[data-testid="button-tester-login"]').click();
      await expect(page.locator('[data-testid="text-dashboard-title"]')).toBeVisible();
      await expect.poll(
        () => page.evaluate(() => caches.has("reel-counter-api-v1")),
      ).toBe(false);
      expect(await page.evaluate((path) => caches.match(path).then(Boolean), uploadPath)).toBe(false);

      await putLegacyProtectedCache(page, paths, uploadPath, "tester");
      const authenticatedUser = await context.request.get("/api/auth/user");
      expect(authenticatedUser.ok()).toBe(true);
      expect((await authenticatedUser.json()).isTester).toBe(true);
      await page.locator('[data-testid="button-logout"]').click();
      const guardConfirm = page.locator('[data-testid="button-logout-guard-confirm"]');
      if (await guardConfirm.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await guardConfirm.click();
      }
      await expect.poll(
        () => page.evaluate(() => caches.has("reel-counter-api-v1")).catch(() => null),
        { timeout: 15_000 },
      ).toBe(false);
      expect(await page.evaluate((path) => caches.match(path).then(Boolean), uploadPath)).toBe(false);
      const testerLogout = await context.request.get("/api/auth/tester-logout", {
        maxRedirects: 0,
      });
      expect(testerLogout.status()).toBe(302);
      expect((await context.request.get("/api/auth/user")).status()).toBe(401);
      await page.goto("/");
      await expect(page.locator('[data-testid="button-login"]')).toBeVisible();

      // Even if stale protected responses appear after cleanup, the current
      // network-only worker must never consult them during offline fallback.
      await putLegacyProtectedCache(page, paths, uploadPath, "pre-logout");
      await context.setOffline(true);
      const results = await page.evaluate(async (paths) =>
        Promise.all(paths.map(async (path) => {
          const response = await fetch(path);
          return { status: response.status, body: await response.text() };
        })), paths);
      expect(results).toEqual(
        paths.map(() => ({ status: 503, body: '{"error":"offline"}' })),
      );
      const offlineUpload = await page.evaluate(async (path) => {
        const response = await fetch(path);
        return { status: response.status, body: await response.text() };
      }, uploadPath);
      expect(offlineUpload).toEqual({ status: 503, body: "" });

      const shellResponse = await page.evaluate(async () => {
        const response = await fetch("/", { headers: { Accept: "text/html" } });
        return { status: response.status, text: await response.text() };
      });
      expect(shellResponse.status).toBe(200);
      expect(shellResponse.text).toContain('<div id="root"></div>');
    } finally {
      await context.setOffline(false);
      await context.close();
      await request.delete(`/api/sessions/${sess.id}`).catch(() => {});
      await request.delete(`/api/sessions/${sess.id}/permanent`).catch(() => {});
    }
  });

  test("public cache writes survive offline use and handled storage failures", async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const webErrors: string[] = [];
    context.on("weberror", (webError) => webErrors.push(webError.error().message));

    try {
      await page.goto("/");
      await installServiceWorker(page);

      const onlineShell = await page.evaluate(async () => {
        const response = await fetch("/", { headers: { Accept: "text/html" } });
        return { status: response.status, text: await response.text() };
      });
      expect(onlineShell.status).toBe(200);
      expect(onlineShell.text).toContain('<div id="root"></div>');
      await expect.poll(
        () => page.evaluate(() => caches.match("/").then(Boolean)),
      ).toBe(true);

      await page.evaluate(async () => {
        const cache = await caches.open("reel-counter-v1");
        await cache.delete("/icon-192.svg");
      });
      const onlineAsset = await page.evaluate(async () => {
        const response = await fetch("/icon-192.svg");
        return { status: response.status, byteLength: (await response.arrayBuffer()).byteLength };
      });
      expect(onlineAsset.status).toBe(200);
      expect(onlineAsset.byteLength).toBeGreaterThan(0);
      await expect.poll(
        () => page.evaluate(() => caches.match("/icon-192.svg").then(Boolean)),
      ).toBe(true);

      await context.setOffline(true);
      const offlineShell = await page.evaluate(async () => {
        const response = await fetch("/", { headers: { Accept: "text/html" } });
        return { status: response.status, text: await response.text() };
      });
      expect(offlineShell.status).toBe(200);
      expect(offlineShell.text).toContain('<div id="root"></div>');
      const offlineAsset = await page.evaluate(async () => {
        const response = await fetch("/icon-192.svg");
        return { status: response.status, byteLength: (await response.arrayBuffer()).byteLength };
      });
      expect(offlineAsset.status).toBe(200);
      expect(offlineAsset.byteLength).toBeGreaterThan(0);
      await context.setOffline(false);

      for (const failure of ["open", "put"] as const) {
        const failureContext = await browser.newContext({
          baseURL: BASE_URL,
          storageState: { cookies: [], origins: [] },
        });
        const failurePage = await failureContext.newPage();
        const failureErrors: string[] = [];
        failureContext.on("weberror", (webError) =>
          failureErrors.push(webError.error().message),
        );
        try {
          await failurePage.goto("/");
          await installServiceWorkerWithCacheFailure(failurePage, request, failure);
          const response = await failurePage.evaluate(async () => {
            const result = await fetch("/", { headers: { Accept: "text/html" } });
            return { status: result.status, text: await result.text() };
          });
          expect(response.status).toBe(200);
          expect(response.text).toContain('<div id="root"></div>');
          await failurePage.evaluate(async () => {
            const cache = await caches.open("reel-counter-v1");
            await cache.delete("/icon-192.svg");
            const result = await fetch("/icon-192.svg");
            return { status: result.status, byteLength: (await result.arrayBuffer()).byteLength };
          }).then((asset) => {
            expect(asset.status).toBe(200);
            expect(asset.byteLength).toBeGreaterThan(0);
          });
          await failurePage.waitForTimeout(250);
          expect(failureErrors).toEqual([]);
        } finally {
          await failureContext.close();
        }
      }
      expect(webErrors).toEqual([]);
    } finally {
      await context.setOffline(false);
      await context.close();
    }
  });

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
    await expect(page.locator('[data-testid="text-dashboard-title"]')).toBeVisible();

    const currentUserId = await page.evaluate(async () => {
      const response = await fetch("/api/auth/user", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Could not resolve current user (${response.status})`);
      return (await response.json()).id as string;
    });

    // Plant a queued entry in IndexedDB (works on any page; IndexedDB is browser-wide)
    await page.evaluate(({ sid, currentUserId }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("reel-counter-offline", 2);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("entry-queue", "readwrite");
          const store = tx.objectStore("entry-queue");
          store.put({
            id: `test-offline-owner-${Date.now()}`,
            sessionId: sid,
            userId: currentUserId,
            data: { aisle: "A", section: "99", category: "OWNER", footage: 100, reelCount: 1 },
            createdAt: Date.now(),
          });
          store.put({
            id: `test-offline-other-${Date.now()}`,
            sessionId: sid,
            userId: "different-application-user",
            data: { aisle: "B", section: "98", category: "OTHER", footage: 100, reelCount: 1 },
            createdAt: Date.now(),
          });
          store.put({
            id: `test-offline-ownerless-${Date.now()}`,
            sessionId: sid,
            data: { aisle: "C", section: "97", category: "OWNERLESS", footage: 100, reelCount: 1 },
            createdAt: Date.now(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, { sid: sess.id, currentUserId });

    // Go offline and notify the app about the queue change
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline-queue-change")));

    const indicator = page.locator('[data-testid="network-status-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="text-pending-count"]')).toHaveText("1");

    // Click the logout button (icon-only button in the header; no visible text)
    const logoutBtn = page.locator('[data-testid="button-logout"]');
    await logoutBtn.click({ timeout: 8_000 });

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
