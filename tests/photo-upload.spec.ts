/**
 * @feature photo-upload-validation
 * Guards the `POST /api/sessions/:sessionId/photos` route against:
 *   - Missing body (no Content-Type header) → must return 400, not crash with 500
 *   - Empty JSON body → must return 400 (objectStorageKey is required)
 *   - Client-injected server fields (userId, id) → must be ignored; server values win
 */
import { test, expect, createSessionViaApi } from "./fixtures";

const directPhoto = {
  name: "direct-retry.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  ),
};

async function interceptLostFirstRegistration(
  context: import("@playwright/test").BrowserContext,
  sessionId: number,
): Promise<{ attempts: () => number; uploads: () => number; keys: string[] }> {
  let attemptCount = 0;
  let uploadCount = 0;
  const keys: string[] = [];
  await context.route("**/api/uploads/direct", async (route) => {
    uploadCount++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        objectPath: `/uploads/direct-retry-${sessionId}.png`,
        metadata: {
          name: `direct-retry-${sessionId}.png`,
          size: directPhoto.buffer.length,
          contentType: directPhoto.mimeType,
        },
      }),
    });
  });
  await context.route(`**/api/sessions/${sessionId}/photos`, async route => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    attemptCount++;
    const payload = route.request().postDataJSON();
    keys.push(payload.registrationKey);
    if (attemptCount === 1) {
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
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  return { attempts: () => attemptCount, uploads: () => uploadCount, keys };
}

test.describe("photo POST validation @photo-upload", () => {
  test("photo mode reuses its registration key after a lost confirmation", async ({
    page,
    context,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Photo Mode Retry ${Date.now()}`);
    cleanupIds.push(sess.id);
    const intercepted = await interceptLostFirstRegistration(context, sess.id);

    await page.goto(`/session/${sess.id}`);
    await page.locator('[data-testid="tab-photo-mode"]').click();
    const input = page.locator('[data-testid="input-photo-file"]');
    await input.setInputFiles(directPhoto);
    await expect.poll(intercepted.attempts).toBe(1);
    const photoCounter = page.locator('[data-testid="text-photo-counter"]');
    await expect(photoCounter).toContainText("/ 01");
    await expect(input).toHaveValue("");
    await input.setInputFiles(directPhoto);
    await expect.poll(intercepted.attempts).toBe(2);
    await expect(photoCounter).toContainText("/ 01");
    await expect(page.locator('[data-testid="nearby-photo-1"]')).toHaveCount(0);

    expect(intercepted.keys).toHaveLength(2);
    expect(intercepted.keys[0]).toEqual(expect.any(String));
    expect(intercepted.keys[1]).toBe(intercepted.keys[0]);
    expect(intercepted.uploads()).toBe(1);
    const photos = await request.get(`/api/sessions/${sess.id}/photos`);
    expect(await photos.json()).toHaveLength(1);
  });

  test("quick entry reuses its registration key after a lost confirmation", async ({
    page,
    context,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Quick Entry Photo Retry ${Date.now()}`);
    cleanupIds.push(sess.id);
    const intercepted = await interceptLostFirstRegistration(context, sess.id);

    await page.goto(`/session/${sess.id}`);
    await page.locator('[data-testid="tab-photo-mode"]').click();
    await page.locator('[data-testid="button-quick-entry-toggle"]').click();
    const input = page.locator('[data-testid="input-single-file"]');
    await input.setInputFiles(directPhoto);
    await expect.poll(intercepted.attempts, { timeout: 20_000 }).toBe(1);
    await expect(input).toHaveValue("");
    await input.setInputFiles(directPhoto);
    await expect.poll(intercepted.attempts, { timeout: 20_000 }).toBe(2);

    expect(intercepted.keys).toHaveLength(2);
    expect(intercepted.keys[0]).toEqual(expect.any(String));
    expect(intercepted.keys[1]).toBe(intercepted.keys[0]);
    expect(intercepted.uploads()).toBe(1);
    await expect(page.locator('[data-testid="img-captured-photo"]')).toBeVisible();
    const photos = await request.get(`/api/sessions/${sess.id}/photos`);
    expect(await photos.json()).toHaveLength(1);
  });

  test("missing body (no Content-Type) returns 400 not 500", async ({
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Photo Validation ${Date.now()}`);
    cleanupIds.push(sess.id);

    const res = await request.post(`/api/sessions/${sess.id}/photos`, {
      headers: {},
      data: undefined,
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("message");
  });

  test("empty JSON body returns 400 (objectStorageKey required)", async ({
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Photo Validation ${Date.now()}`);
    cleanupIds.push(sess.id);

    const res = await request.post(`/api/sessions/${sess.id}/photos`, {
      data: {},
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("message");
    expect(body.errors).toHaveProperty("objectStorageKey");
  });

  test("client-supplied userId and sessionId are overridden by server values", async ({
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Photo Override ${Date.now()}`);
    cleanupIds.push(sess.id);

    const res = await request.post(`/api/sessions/${sess.id}/photos`, {
      data: {
        objectStorageKey: `uploads/fake-regression-test-${Date.now()}.jpg`,
        originalFilename: "regression.jpg",
        userId: "INJECTED-USER-ID",
        sessionId: 99999,
        uploadedBy: "INJECTED-NAME",
      },
    });

    expect(res.status()).toBe(200);
    const photo = await res.json();
    expect(photo.userId).not.toBe("INJECTED-USER-ID");
    expect(photo.sessionId).toBe(sess.id);
    expect(photo.uploadedBy).not.toBe("INJECTED-NAME");
  });
});
