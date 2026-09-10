/**
 * @feature mobile-photo-upload
 * Guards Mobile Flow's browser image preparation and durable queue lifecycle.
 */
import sharp from "sharp";
import {
  test,
  expect,
  createOrientedJpegFixture,
  createSessionViaApi,
  orientedJpegFixtureCases,
} from "./fixtures";

for (const fixtureCase of orientedJpegFixtureCases) {
  test(`prepares ${fixtureCase.name} with oriented pixels and dimensions @mobile-image-orientation`, async ({
    page,
  }, testInfo) => {
    const fixture = await createOrientedJpegFixture(fixtureCase);
    await test.step(`${testInfo.project.name}: ${fixture.name}`, async () => {
      await page.goto("/");
      const prepared = await page.evaluate(async ({ bytes, name }) => {
        const moduleUrl = "/src/lib/prepareMobileImage.ts";
        const { prepareMobileImage } = await import(/* @vite-ignore */ moduleUrl);
        const source = new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
        const result = await prepareMobileImage(source, 95);
        return {
          width: result.width,
          height: result.height,
          bytes: Array.from(new Uint8Array(await result.file.arrayBuffer())),
        };
      }, { bytes: Array.from(fixture.buffer), name: fixture.name });

      expect(prepared.width, `${testInfo.project.name} ${fixture.name} prepared width`)
        .toBe(fixture.preparedWidth);
      expect(prepared.height, `${testInfo.project.name} ${fixture.name} prepared height`)
        .toBe(fixture.preparedHeight);

      const sourceMetadata = await sharp(fixture.buffer).metadata();
      expect(sourceMetadata.width, `${testInfo.project.name} ${fixture.name} source pixel width`)
        .toBe(fixture.sourceWidth);
      expect(sourceMetadata.height, `${testInfo.project.name} ${fixture.name} source pixel height`)
        .toBe(fixture.sourceHeight);

      const preparedImage = sharp(Buffer.from(prepared.bytes));
      const preparedMetadata = await preparedImage.metadata();
      expect(preparedMetadata.width, `${testInfo.project.name} ${fixture.name} encoded width`)
        .toBe(fixture.preparedWidth);
      expect(preparedMetadata.height, `${testInfo.project.name} ${fixture.name} encoded height`)
        .toBe(fixture.preparedHeight);

      const { data, info } = await preparedImage.raw().toBuffer({ resolveWithObject: true });
      const corner = (x: number, y: number): [number, number, number] => {
        const offset = (y * info.width + x) * info.channels;
        return [
          data[offset] ?? 0,
          data[offset + 1] ?? 0,
          data[offset + 2] ?? 0,
        ];
      };
      const inset = 4;
      const corners = [
        corner(inset, inset),
        corner(info.width - inset - 1, inset),
        corner(inset, info.height - inset - 1),
        corner(info.width - inset - 1, info.height - inset - 1),
      ];
      const dominantChannels = corners.map(([red, green, blue]) => {
        if (red > 180 && green > 180 && blue < 100) return "yellow";
        if (red > green && red > blue) return "red";
        if (green > red && green > blue) return "green";
        return "blue";
      });
      expect(
        dominantChannels,
        `${testInfo.project.name} ${fixture.name} final pixel orientation`,
      ).toEqual(fixture.expectedCorners);
    });
  });
}

async function queuedPhotoCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("reel-counter-offline", 2);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("photo-queue")) {
        resolve(0);
        return;
      }
      const transaction = db.transaction("photo-queue", "readonly");
      const count = transaction.objectStore("photo-queue").count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    };
    request.onerror = () => reject(request.error);
  }));
}

async function queuedUploadFilenames(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open("reel-counter-offline", 2);
    request.onsuccess = () => {
      const transaction = request.result.transaction("photo-queue", "readonly");
      const getAll = transaction.objectStore("photo-queue").getAll();
      getAll.onsuccess = () => resolve(getAll.result.map(item => item.uploadFilename).sort());
      getAll.onerror = () => reject(getAll.error);
    };
    request.onerror = () => reject(request.error);
  }));
}

async function queuedRegistrationKeys(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open("reel-counter-offline", 2);
    request.onsuccess = () => {
      const transaction = request.result.transaction("photo-queue", "readonly");
      const getAll = transaction.objectStore("photo-queue").getAll();
      getAll.onsuccess = () => resolve(getAll.result.map(item => item.registrationKey).sort());
      getAll.onerror = () => reject(getAll.error);
    };
    request.onerror = () => reject(request.error);
  }));
}

async function queuedUploadedObjectPaths(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open("reel-counter-offline", 2);
    request.onsuccess = () => {
      const transaction = request.result.transaction("photo-queue", "readonly");
      const getAll = transaction.objectStore("photo-queue").getAll();
      getAll.onsuccess = () => resolve(getAll.result
        .map(item => item.uploadedObjectPath)
        .filter((path): path is string => typeof path === "string"));
      getAll.onerror = () => reject(getAll.error);
    };
    request.onerror = () => reject(request.error);
  }));
}

async function ageQueuedPhotoClaims(
  page: import("@playwright/test").Page,
  ageMs: number,
): Promise<void> {
  await page.evaluate((claimAge) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("reel-counter-offline", 2);
    request.onsuccess = () => {
      const transaction = request.result.transaction("photo-queue", "readwrite");
      const store = transaction.objectStore("photo-queue");
      const getAll = store.getAll();
      getAll.onsuccess = () => {
        for (const item of getAll.result) {
          store.put({
            ...item,
            inFlight: true,
            claimedAt: Date.now() - claimAge,
          });
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }), ageMs);
}

async function enterMobileFlow(page: import("@playwright/test").Page): Promise<void> {
  const header = page.locator('[data-testid="header-mobile-flow"]');
  if (!(await header.isVisible().catch(() => false))) {
    await page.locator('[data-testid="button-toggle-mobile"]').click();
  }
  await expect(header).toBeVisible();
}

test.describe("Mobile Flow photo queue @mobile-photo-upload", () => {
  test("converts, uploads, registers once, and clears the durable queue", async ({
    page,
    context,
    request,
    cleanupIds,
  }) => {
    const session = await createSessionViaApi(request, `Mobile Photo ${Date.now()}`);
    cleanupIds.push(session.id);
    const settingsResponse = await request.patch("/api/settings", {
      data: {
        photoQuality: 65,
        useReceivingQuality: true,
        receivingPhotoQuality: 30,
        useOnFloorQuality: true,
        onFloorPhotoQuality: 30,
      },
    });
    expect(settingsResponse.ok()).toBe(true);

    await page.addInitScript(() => {
      (window as any).__mobileJpegQualities = [];
      const original = OffscreenCanvas.prototype.convertToBlob;
      OffscreenCanvas.prototype.convertToBlob = function(options?: ImageEncodeOptions) {
        (window as any).__mobileJpegQualities.push(options?.quality);
        return original.call(this, options);
      };
    });

    let uploadAttempts = 0;
    let registrationAttempts = 0;
    const registrationPayloads: any[] = [];
    context.on("request", (outgoing) => {
      if (outgoing.method() === "POST" && outgoing.url().endsWith("/api/uploads/direct")) {
        uploadAttempts++;
      }
      if (
        outgoing.method() === "POST"
        && outgoing.url().endsWith(`/api/sessions/${session.id}/photos`)
      ) {
        registrationAttempts++;
        registrationPayloads.push(outgoing.postDataJSON());
      }
    });

    await page.goto(`/session/${session.id}`);
    await enterMobileFlow(page);
    await page.locator('[data-testid="checkbox-receiving"]').click();
    await page.locator('[data-testid="checkbox-on-floor"]').click();

    const png = await sharp({
      create: {
        width: 37,
        height: 23,
        channels: 3,
        background: { r: 32, g: 128, b: 224 },
      },
    }).png().toBuffer();
    const jpeg = await sharp({
      create: {
        width: 19,
        height: 31,
        channels: 3,
        background: { r: 224, g: 96, b: 48 },
      },
    }).jpeg({ quality: 90 }).toBuffer();
    await context.setOffline(true);
    await page.locator('[data-testid="input-mobile-file"]').setInputFiles([
      {
        name: "mobile-source.png",
        mimeType: "image/png",
        buffer: png,
      },
      {
        name: "mobile-source.jpg",
        mimeType: "image/jpeg",
        buffer: jpeg,
      },
    ]);
    await expect.poll(() => queuedPhotoCount(page)).toBe(2);
    expect(await queuedUploadFilenames(page)).toEqual(["mobile-source.jpg", "mobile-source.jpg"]);
    expect(uploadAttempts).toBe(0);
    expect(registrationAttempts).toBe(0);
    const encodedQualities = await page.evaluate(() => (window as any).__mobileJpegQualities);
    // Simulate an upload-owning page disappearing while its claims are still
    // fresh. The replacement page must retry after expiry without another reload.
    await ageQueuedPhotoClaims(page, 110_000);
    await page.close();
    await context.setOffline(false);
    const restoredPage = await context.newPage();
    await restoredPage.goto(`/session/${session.id}`);
    await enterMobileFlow(restoredPage);

    await restoredPage.waitForTimeout(1_000);
    expect(uploadAttempts).toBe(0);
    await expect.poll(() => uploadAttempts, { timeout: 20_000 }).toBe(2);
    await expect.poll(() => registrationAttempts, { timeout: 20_000 }).toBe(2);
    await expect.poll(() => queuedPhotoCount(restoredPage), { timeout: 20_000 }).toBe(0);
    await expect(restoredPage.locator('[data-testid="upload-queue-status"]')).toBeHidden();
    await restoredPage.locator('[data-testid="button-toggle-mobile"]').click();
    await expect(restoredPage.locator('[data-testid="badge-tab-strip"]')).toHaveText("2");

    const photosResponse = await request.get(`/api/sessions/${session.id}/photos`);
    expect(photosResponse.ok()).toBe(true);
    const photos = await photosResponse.json();
    expect(photos).toHaveLength(2);
    expect(photos).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mimeType: "image/jpeg",
        width: 37,
        height: 23,
        aisle: "Receiving",
        isDetailShot: false,
      }),
      expect.objectContaining({
        mimeType: "image/jpeg",
        width: 19,
        height: 31,
        aisle: "Receiving",
        isDetailShot: false,
      }),
    ]));
    expect(encodedQualities).toEqual([0.65, 0.65]);
    expect(uploadAttempts).toBe(2);
    expect(registrationAttempts).toBe(2);
    expect(registrationPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalFilename: "mobile-source.png", width: 37, height: 23, registrationKey: expect.any(String) }),
      expect.objectContaining({ originalFilename: "mobile-source.jpg", width: 19, height: 31, registrationKey: expect.any(String) }),
    ]));
  });

  test("reuses the durable registration key after the first response is lost", async ({
    page,
    context,
    request,
    cleanupIds,
  }) => {
    const session = await createSessionViaApi(request, `Interrupted Registration ${Date.now()}`);
    cleanupIds.push(session.id);
    let uploadAttempts = 0;
    let registrationAttempts = 0;
    const registrationKeys: string[] = [];
    let releaseRestoredUpload!: () => void;
    const restoredUploadGate = new Promise<void>(resolve => {
      releaseRestoredUpload = resolve;
    });
    let holdNextUpload = false;

    await context.route("**/api/uploads/direct", async route => {
      uploadAttempts++;
      if (holdNextUpload) {
        holdNextUpload = false;
        await restoredUploadGate;
      }
      await route.continue();
    });

    await page.goto(`/session/${session.id}`);
    await enterMobileFlow(page);
    await page.locator('[data-testid="input-mobile-aisle"]').fill("A");
    const jpeg = await sharp({
      create: {
        width: 17,
        height: 13,
        channels: 3,
        background: { r: 80, g: 120, b: 200 },
      },
    }).jpeg().toBuffer();
    await context.setOffline(true);
    await page.locator('[data-testid="input-mobile-file"]').setInputFiles({
      name: "interrupted.jpg",
      mimeType: "image/jpeg",
      buffer: jpeg,
    });

    await expect.poll(() => queuedPhotoCount(page)).toBe(1);
    const persistedKeys = await queuedRegistrationKeys(page);
    expect(persistedKeys).toHaveLength(1);
    expect(persistedKeys[0]).toEqual(expect.any(String));

    await page.close();
    await context.setOffline(false);
    holdNextUpload = true;
    const restoredPage = await context.newPage();
    await restoredPage.goto(`/session/${session.id}`);
    await enterMobileFlow(restoredPage);
    await expect.poll(() => queuedRegistrationKeys(restoredPage)).toEqual(persistedKeys);
    await context.route(`**/api/sessions/${session.id}/photos`, async route => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      registrationAttempts++;
      const payload = route.request().postDataJSON();
      registrationKeys.push(payload.registrationKey);
      if (registrationAttempts === 1) {
        const cookies = await context.cookies(route.request().url());
        const committedResponse = await fetch(route.request().url(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; "),
          },
          body: JSON.stringify(payload),
        });
        expect(committedResponse.ok).toBe(true);
        await expect.poll(() => queuedUploadedObjectPaths(restoredPage)).toHaveLength(1);
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });
    releaseRestoredUpload();

    await expect.poll(() => registrationAttempts, { timeout: 20_000 }).toBe(2);
    await expect.poll(() => queuedPhotoCount(restoredPage), { timeout: 20_000 }).toBe(0);
    expect(registrationKeys).toEqual([persistedKeys[0], persistedKeys[0]]);
    expect(uploadAttempts).toBe(1);
    const photosResponse = await request.get(`/api/sessions/${session.id}/photos`);
    expect(photosResponse.ok()).toBe(true);
    expect(await photosResponse.json()).toHaveLength(1);
  });

  test("does not retain stale items while an online multi-file selection is still preparing", async ({
    page,
    context,
    request,
    cleanupIds,
  }) => {
    const session = await createSessionViaApi(request, `Online Mobile Batch ${Date.now()}`);
    cleanupIds.push(session.id);
    await page.addInitScript(() => {
      let conversionCount = 0;
      const original = OffscreenCanvas.prototype.convertToBlob;
      OffscreenCanvas.prototype.convertToBlob = async function(options?: ImageEncodeOptions) {
        conversionCount++;
        if (conversionCount === 2) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return original.call(this, options);
      };
    });

    let uploadAttempts = 0;
    let registrationAttempts = 0;
    context.on("request", (outgoing) => {
      if (outgoing.method() === "POST" && outgoing.url().endsWith("/api/uploads/direct")) {
        uploadAttempts++;
      }
      if (
        outgoing.method() === "POST"
        && outgoing.url().endsWith(`/api/sessions/${session.id}/photos`)
      ) {
        registrationAttempts++;
      }
    });

    await page.goto(`/session/${session.id}`);
    await enterMobileFlow(page);
    await page.locator('[data-testid="input-mobile-aisle"]').fill("A");
    const png = await sharp({
      create: {
        width: 7,
        height: 9,
        channels: 3,
        background: { r: 72, g: 96, b: 224 },
      },
    }).png().toBuffer();
    await page.locator('[data-testid="input-mobile-file"]').setInputFiles([
      { name: "online-first.png", mimeType: "image/png", buffer: png },
      { name: "online-delayed.png", mimeType: "image/png", buffer: png },
    ]);

    await expect.poll(() => uploadAttempts).toBe(2);
    await expect.poll(() => registrationAttempts).toBe(2);
    await expect.poll(() => queuedPhotoCount(page)).toBe(0);
    await expect(page.locator('[data-testid="upload-queue-status"]')).toBeHidden();
    expect(uploadAttempts).toBe(2);
    expect(registrationAttempts).toBe(2);
  });

  test("keeps the detail review image loaded after durable queue cleanup", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const session = await createSessionViaApi(request, `Mobile Detail Review ${Date.now()}`);
    cleanupIds.push(session.id);
    const parentResponse = await request.post(`/api/sessions/${session.id}/photos`, {
      data: {
        objectStorageKey: `/uploads/detail-parent-${Date.now()}.jpg`,
        originalFilename: "detail-parent.jpg",
        mimeType: "image/jpeg",
        width: 20,
        height: 20,
        aisle: "A",
        section: "1",
      },
    });
    expect(parentResponse.ok()).toBe(true);
    const parent = await parentResponse.json();
    const pinResponse = await request.post(`/api/photos/${parent.id}/pins`, {
      data: {
        xPercent: 50,
        yPercent: 50,
        label: "DETAIL-1",
        reelCount: 1,
        flagged: true,
        flagReason: "Needs close-up",
      },
    });
    expect(pinResponse.ok()).toBe(true);
    const pin = await pinResponse.json();
    const flaggedResponse = await request.get(`/api/sessions/${session.id}/flagged-pins`);
    expect(flaggedResponse.ok()).toBe(true);
    const flaggedPins = await flaggedResponse.json();
    expect(flaggedPins).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: pin.id, entryId: null, flagged: true }),
    ]));

    await page.goto(`/session/${session.id}?tab=flagged`);
    await expect(page.getByRole("heading", { name: /Flagged Reels/ })).toBeVisible();
    await page.locator(`[data-testid="button-edit-${pin.id}"]`).click();
    await page.locator(`[data-testid="button-detail-photo-desktop-${pin.id}"]`).click();
    await expect(page.locator('[data-testid="text-detail-shot-banner"]')).toBeVisible();

    const jpeg = await sharp({
      create: {
        width: 13,
        height: 21,
        channels: 3,
        background: { r: 208, g: 64, b: 96 },
      },
    }).jpeg({ quality: 90 }).toBuffer();
    await page.locator('[data-testid="input-mobile-file"]').setInputFiles({
      name: "detail-review.jpg",
      mimeType: "image/jpeg",
      buffer: jpeg,
    });

    await expect.poll(() => queuedPhotoCount(page)).toBe(0);
    const reviewImage = page.locator('[data-testid="img-detail-review"]');
    await expect(reviewImage).toBeVisible();
    await expect.poll(() => reviewImage.evaluate((image: HTMLImageElement) =>
      image.complete && image.naturalWidth > 0,
    )).toBe(true);
  });

  test("shows an undecodable file as terminal without upload retries", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const session = await createSessionViaApi(request, `Invalid Mobile Photo ${Date.now()}`);
    cleanupIds.push(session.id);
    let uploadAttempts = 0;
    page.on("request", (outgoing) => {
      if (outgoing.method() === "POST" && outgoing.url().endsWith("/api/uploads/direct")) {
        uploadAttempts++;
      }
    });

    await page.goto(`/session/${session.id}`);
    await enterMobileFlow(page);
    await page.locator('[data-testid="input-mobile-aisle"]').fill("A");
    await page.locator('[data-testid="input-mobile-file"]').setInputFiles({
      name: "broken.heic",
      mimeType: "image/heic",
      buffer: Buffer.from("not an image"),
    });

    const failure = page.locator('[data-testid^="upload-failed-"]');
    await expect(failure).toContainText("This photo format could not be read");
    await expect(failure.locator('[data-testid^="button-retry-"]')).toHaveCount(0);
    await page.waitForTimeout(2_500);
    expect(uploadAttempts).toBe(0);
    expect(await queuedPhotoCount(page)).toBe(0);
  });

  test("uses 95 percent when no saved photo quality is returned", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const session = await createSessionViaApi(request, `Default Mobile Quality ${Date.now()}`);
    cleanupIds.push(session.id);

    await page.route("**/api/settings", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: {} });
        return;
      }
      await route.continue();
    });
    await page.addInitScript(() => {
      (window as any).__mobileJpegQualities = [];
      const original = OffscreenCanvas.prototype.convertToBlob;
      OffscreenCanvas.prototype.convertToBlob = function(options?: ImageEncodeOptions) {
        (window as any).__mobileJpegQualities.push(options?.quality);
        return original.call(this, options);
      };
    });

    await page.goto(`/session/${session.id}`);
    await enterMobileFlow(page);
    await page.locator('[data-testid="input-mobile-aisle"]').fill("A");

    const png = await sharp({
      create: {
        width: 11,
        height: 17,
        channels: 3,
        background: { r: 48, g: 192, b: 96 },
      },
    }).png().toBuffer();
    await page.locator('[data-testid="input-mobile-file"]').setInputFiles({
      name: "default-quality.png",
      mimeType: "image/png",
      buffer: png,
    });

    await expect.poll(() => queuedPhotoCount(page)).toBe(0);
    await expect(page.locator('[data-testid="upload-queue-status"]')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__mobileJpegQualities)).toEqual([0.95]);
  });
});
