/**
 * @feature offline-queue
 * Guards the logout guard flow: attempting to sign out while there are
 * unsynced offline items must show a warning dialog. After cancelling and
 * clearing the queue the pending-count badge must return to 0 (or hide).
 */
import { clerk as clerkTesting, setupClerkTestingToken } from "@clerk/testing/playwright";
import { parsePublishableKey } from "@clerk/shared/keys";
import { BASE_URL, test, expect, createSessionViaApi, uploadTestPhoto } from "./fixtures";

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

async function seedOfflineQueueRecord(page: import("@playwright/test").Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("reel-counter-offline", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("entry-queue")) {
        request.result.createObjectStore("entry-queue", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const transaction = request.result.transaction("entry-queue", "readwrite");
      transaction.objectStore("entry-queue").put({
        id: "worker-upgrade-preservation",
        sessionId: 1,
        userId: "worker-test",
        data: {},
        createdAt: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }));
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
) {
  await page.evaluate(async ({ paths, uploadPath }) => {
    const apiCache = await caches.open("reel-counter-api-v1");
    await Promise.all(
      paths.map((path) =>
        apiCache.put(
          path,
          new Response(JSON.stringify({ secret: "legacy-protected-response" }), {
            headers: { "Content-Type": "application/json" },
          }),
        ),
      ),
    );
    const shellCache = await caches.open("reel-counter-v1");
    await shellCache.put(
      uploadPath,
      new Response("legacy-protected-photo", {
        headers: { "Content-Type": "image/png" },
      }),
    );
  }, { paths, uploadPath });
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
  test("script cache admits only valid application assets and cleans legacy errors", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });
    const assetPath = "/assets/e2e-valid.js";
    await context.route(`**${assetPath}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "export const e2eCacheFixture = true;",
      });
    });
    const page = await context.newPage();

    try {
      await page.goto("/");
      await seedOfflineQueueRecord(page);
      await page.evaluate(async () => {
        const cache = await caches.open("reel-counter-v1");
        await cache.put(
          "/assets/legacy-error.js",
          new Response("<!doctype html><title>error</title>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
        );
        await cache.put(
          "/auth/clerk.js",
          new Response("legacy auth transport", {
            status: 200,
            headers: { "Content-Type": "application/javascript" },
          }),
        );
      });

      await installServiceWorker(page);
      await expect.poll(
        () => page.evaluate(() => caches.match("/assets/legacy-error.js").then(Boolean)),
      ).toBe(false);
      expect(
        await page.evaluate(() => caches.match("/auth/clerk.js").then(Boolean)),
      ).toBe(false);

      const validAsset = await page.evaluate(async (path) => {
        const cache = await caches.open("reel-counter-v1");
        await cache.delete(path);
        const response = await fetch(path);
        return {
          status: response.status,
          contentType: response.headers.get("content-type"),
        };
      }, assetPath);
      expect(validAsset.status).toBe(200);
      expect(validAsset.contentType).toContain("javascript");
      await expect.poll(
        () => page.evaluate((path) => caches.match(path).then(Boolean), assetPath),
      ).toBe(true);

      const rejected = await page.evaluate(async () => {
        const htmlResponse = await fetch("/assets/missing-script.js");
        const authResponse = await fetch("/api/__clerk/missing.js");
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          htmlStatus: htmlResponse.status,
          htmlType: htmlResponse.headers.get("content-type"),
          htmlCached: Boolean(await caches.match("/assets/missing-script.js")),
          authCached: Boolean(await caches.match("/api/__clerk/missing.js")),
        };
      });
      expect(
        rejected.htmlStatus >= 400 || rejected.htmlType?.includes("text/html"),
      ).toBe(true);
      expect(rejected.htmlCached).toBe(false);
      expect(rejected.authCached).toBe(false);

      expect(await page.evaluate(() => new Promise<boolean>((resolve, reject) => {
        const request = indexedDB.open("reel-counter-offline", 2);
        request.onsuccess = () => {
          const transaction = request.result.transaction("entry-queue", "readonly");
          const getRequest = transaction.objectStore("entry-queue").get("worker-upgrade-preservation");
          getRequest.onsuccess = () => resolve(Boolean(getRequest.result));
          getRequest.onerror = () => reject(getRequest.error);
        };
        request.onerror = () => reject(request.error);
      }))).toBe(true);
    } finally {
      await context.close();
    }
  });

  test("logout and identity changes cannot expose legacy protected caches offline", async ({
    context,
    page,
    request,
  }) => {
    const sessionResponse = await request.post("/api/sessions", {
      data: { name: `Offline Guard ${Date.now()}`, location: null },
    });
    expect(sessionResponse.ok()).toBe(true);
    const sess = await sessionResponse.json() as { id: number };
    try {
      const paths = protectedPaths(sess.id);
      const objectPath = await createProtectedUpload(request, sess.id);
      const uploadPath = objectPath.startsWith("/")
        ? objectPath
        : `/uploads/${objectPath}`;

      await page.goto("/");
      await installServiceWorker(page);
      await expect(page.getByTestId("text-dashboard-title")).toBeVisible();

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

      const cleanupResponse = await request.delete(`/api/sessions/${sess.id}/permanent`);
      expect(cleanupResponse.ok()).toBe(true);
      await putLegacyProtectedCache(page, paths, uploadPath);
      await page.getByTestId("button-logout").click();
      await expect(page.locator('[data-testid="button-login"]')).toBeVisible();
      await expect.poll(
        () => page.evaluate(() => caches.has("reel-counter-api-v1")),
      ).toBe(false);
      expect(await page.evaluate((path) => caches.match(path).then(Boolean), uploadPath)).toBe(false);

      await page.goto("/");
      await expect.poll(
        () => page.evaluate(() => caches.has("reel-counter-api-v1")).catch(() => null),
        { timeout: 15_000 },
      ).toBe(false);
      expect(await page.evaluate((path) => caches.match(path).then(Boolean), uploadPath)).toBe(false);
      expect((await context.request.get("/api/auth/user")).status()).toBe(401);
      await expect(page.locator('[data-testid="button-login"]')).toBeVisible();

      // Even if stale protected responses appear after cleanup, the current
      // network-only worker must never consult them during offline fallback.
      await putLegacyProtectedCache(page, paths, uploadPath);
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

  test("replays a lost entry response once and commits its intended photo pin", async ({
    page,
    browser,
    request,
    anonymousRequest,
    cleanupIds,
    secondApprovedIdentity,
  }) => {
    const sess = await createSessionViaApi(request, `Offline Entry Replay ${Date.now()}`);
    cleanupIds.push(sess.id);
    const photo = await uploadTestPhoto(request, sess.id);
    expect(photo.id, "photo upload must succeed for this replay scenario").toBeGreaterThan(0);

    const draftClientId = `offline-entry-pin-${Date.now()}`;
    const draftResponse = await request.post(`/api/photos/${photo.id}/pins`, {
      data: {
        xPercent: 32,
        yPercent: 67,
        label: "77",
        reelCount: 1,
        wireDetails: "TC1241000",
        vendorCode: "COP",
        footage: 1000,
        draftClientId,
      },
    });
    expect(draftResponse.ok(), `draft pin creation failed: ${await draftResponse.text()}`).toBe(true);

    await page.goto("/");
    await expect(page.locator('[data-testid="text-dashboard-title"]')).toBeVisible();
    const userId = await page.evaluate(async () => {
      const response = await fetch("/api/auth/user", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Could not resolve current user (${response.status})`);
      return (await response.json()).id as string;
    });
    const apiUserResponse = await request.get("/api/auth/user");
    expect(apiUserResponse.status()).toBe(200);
    expect((await apiUserResponse.json()).id).toBe(userId);
    const sessionResponse = await request.get(`/api/sessions/${sess.id}`);
    expect(sessionResponse.status()).toBe(200);
    expect((await sessionResponse.json()).userId).toBe(userId);

    const entryPath = `/api/sessions/${sess.id}/entries`;
    let attempts = 0;
    let originalEntryId: number | undefined;
    let replayStatus: number | undefined;
    let initialBody: Buffer | null = null;
    const operationIds: string[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === entryPath && response.request().method() === "POST") {
        replayStatus = response.status();
      }
    });
    await page.route(`**${entryPath}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      attempts++;
      const headers = route.request().headers();
      const operationId = headers["idempotency-key"] || "";
      operationIds.push(operationId);
      if (attempts === 1) {
        initialBody = route.request().postDataBuffer();
        expect(initialBody, "initial entry POST must have a body").not.toBeNull();
        expect(operationId, "initial entry POST must have an idempotency key").toBeTruthy();
        expect(headers["content-type"]).toContain("application/json");
        const committedResponse = await request.post(entryPath, {
          data: initialBody!,
          headers: {
            "Content-Type": headers["content-type"],
            "Idempotency-Key": operationId,
          },
        });
        expect(committedResponse.ok(), `initial entry POST failed: ${await committedResponse.text()}`).toBe(true);
        originalEntryId = (await committedResponse.json()).id;
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });

    const queued = await page.evaluate(async ({ sessionId, userId, photoId, draftClientId }) => {
      const modulePath = "/src/lib/offlineEntryCreate.ts";
      const offlineEntryCreate = await import(modulePath);
      return offlineEntryCreate.createEntryWithOfflineFallback(sessionId, {
        aisle: "A",
        section: "1",
        position: "77",
        reelTag: "TC1241000",
        manufacturer: "COP",
        footage: 1000,
        reelCount: 1,
        photoId,
        pinCommit: {
          photoId,
          draftClientId,
          xPercent: 32,
          yPercent: 67,
          label: "77",
          reelCount: 1,
          wireDetails: "TC1241000",
          vendorCode: "COP",
          footage: 1000,
          flagged: false,
          flagReason: null,
        },
      }, userId);
    }, { sessionId: sess.id, userId, photoId: photo.id, draftClientId });

    expect(queued.queued).toBe(true);
    expect(originalEntryId, "the owner must commit before the browser loses the response").toBeGreaterThan(0);
    const firstEntriesResponse = await request.get(entryPath);
    expect(firstEntriesResponse.status()).toBe(200);
    expect((await firstEntriesResponse.json()).map((entry: { id: number }) => entry.id)).toEqual([originalEntryId]);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => attempts, { timeout: 15_000 }).toBe(2);
    await expect.poll(() => replayStatus, { timeout: 15_000 }).toBe(200);

    const entriesResponse = await request.get(`/api/sessions/${sess.id}/entries`);
    expect(entriesResponse.ok()).toBe(true);
    const entries = await entriesResponse.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(originalEntryId);

    const pinsResponse = await request.get(`/api/photos/${photo.id}/pins`);
    expect(pinsResponse.ok()).toBe(true);
    const pins = await pinsResponse.json();
    expect(pins).toHaveLength(1);
    expect(pins[0].draftClientId).toBe(draftClientId);
    expect(pins[0].entryId).toBe(originalEntryId);
    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).toBeTruthy();
    expect(operationIds[1]).toBe(operationIds[0]);

    const rejectedHeaders = {
      "Content-Type": "application/json",
      "Idempotency-Key": operationIds[0],
    };
    // The fixture verifies that this separate request has no owner identity.
    const anonymous = await anonymousRequest.post(entryPath, {
      headers: rejectedHeaders,
      data: initialBody!,
    });
    expect(anonymous.status(), `anonymous replay: ${await anonymous.text()}`).toBe(401);

    const frontendApiUrl = parsePublishableKey(process.env.VITE_CLERK_PUBLISHABLE_KEY)?.frontendApi;
    if (!frontendApiUrl) throw new Error("Browser replay requires a valid Clerk publishable key");
    const otherContext = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
    });
    try {
      await setupClerkTestingToken({ context: otherContext, options: { frontendApiUrl } });
      const otherPage = await otherContext.newPage();
      await otherPage.goto("/sign-in");
      await clerkTesting.signIn({ page: otherPage, emailAddress: secondApprovedIdentity.email });
      const otherUserResponse = await otherContext.request.get("/api/auth/user");
      expect(otherUserResponse.status()).toBe(200);
      expect((await otherUserResponse.json()).id).not.toBe(userId);
      const denied = await otherContext.request.post(entryPath, {
        data: initialBody!,
        headers: rejectedHeaders,
      });
      expect(denied.status(), "another approved owner must not replay this entry").toBe(404);
    } finally {
      await otherContext.close();
    }
    const finalEntries = await request.get(entryPath);
    expect(finalEntries.status()).toBe(200);
    expect((await finalEntries.json()).map((entry: { id: number }) => entry.id)).toEqual([originalEntryId]);
  });
});
