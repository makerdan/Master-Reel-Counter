/**
 * @feature pin-position
 *
 * Guards the regression where committed pin entries did not carry the pin's
 * label number into the `position` field. Both the PhotoMode commit path
 * (PhotoMode.tsx) and the AI Label Scanner commit path (LabelScannerTab.tsx)
 * were affected. The `position` column in Table View would appear blank even
 * though the pin had a numeric label.
 *
 * Root cause: PhotoMode hardcoded `position: ""` and LabelScannerTab omitted
 * the field entirely when building the entry payload on commit.
 */
import { test, expect, createSessionViaApi, uploadTestPhoto } from "./fixtures";

test.describe("pin label → entry position field @pin-position", () => {
  /**
   * Server-side contract: the API must accept and persist the position value
   * passed in the entry creation payload. If this breaks, the client-side fix
   * cannot work regardless of what the frontend sends.
   */
  test("API stores position when provided in entry creation", async ({
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(
      request,
      `Position Scanner ${Date.now()}`,
    );

    const operationId = `entry-operation-${Date.now()}`;
    cleanupIds.push(sess.id);

    const res = await request.post(`/api/sessions/${sess.id}/entries`, {
      data: {
        aisle: "22",
        section: "46",
        position: "42",
        reelTag: "TC1241000",
        footage: 1000,
        reelCount: 1,
      },
    });
    expect(res.ok(), `entries POST failed: ${await res.text()}`).toBe(true);

    const entry = await res.json();
    expect(
      entry.position,
      "Server must persist the position value from the request body",
    ).toBe("42");
  });

  /**
   * LabelScannerTab commit path: when the user commits a draft pin from the
   * AI Label Scanner, the POST body must include the pin label as position.
   */
  test("LabelScannerTab commit sends pin label as position", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(
      request,
      `Position Scanner ${Date.now()}`,
    );

    cleanupIds.push(sess.id);

    const photo = await uploadTestPhoto(request, sess.id);

    // Create a draft pin with label 42 and pre-filled wire data so that the
    // scanner card is committable (editCatalog/Vendor/Footage come from
    // pin.wireDetails via applyPinSeed, no catalog match required).
    const pinRes = await request.post(`/api/photos/${photo.id}/pins`, {
      data: {
        photoId: photo.id,
        label: "42",
        xPercent: 50,
        yPercent: 50,
        reelCount: 1,
        wireDetails: "TC1241000",
        vendorCode: "COP",
        footage: 1000,
      },
    });
    expect(pinRes.ok(), `pin creation failed: ${await pinRes.text()}`).toBe(
      true,
    );
    const pin = await pinRes.json();

    // Mock a recognizable catalog result so the scanner selects and populates
    // the draft card before the commit request is captured.
    await page.route(`**/api/photos/${photo.id}/analyze-labels`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            { pinId: pin.id, pinLabel: "42", rawText: "THHN1RD500", readable: true },
          ],
          truncated: false,
          truncatedCount: 0,
        }),
      }),
    );

    // Intercept the entries POST to capture the request body, then forward to
    // the real server so the commit can complete without errors.
    let capturedEntryBody: Record<string, unknown> | null = null;
    await page.route(`**/api/sessions/${sess.id}/entries`, async (route) => {
      if (route.request().method() === "POST") {
        capturedEntryBody = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
      }
      await route.continue();
    });

    await page.goto(`/session/${sess.id}?tab=scanner`);
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.locator('[data-testid="btn-analyze-labels"]'),
      "btn-analyze-labels must be present in scanner tab",
    ).toBeVisible({ timeout: 8_000 });

    await page.click('[data-testid="btn-analyze-labels"]');

    // Phase transitions to "results" after analysis completes — apply button
    // becomes visible.
    await expect(
      page.locator('[data-testid="btn-apply-labels"]'),
      "btn-apply-labels must appear after analysis finishes",
    ).toBeVisible({ timeout: 12_000 });

    await page.click('[data-testid="btn-apply-labels"]');

    // Allow the intercepted request to fire and the commit to settle.
    await page.waitForTimeout(2_000);

    expect(
      capturedEntryBody,
      "POST /api/sessions/:id/entries must have been intercepted — apply did not trigger an entry creation",
    ).not.toBeNull();

    expect(
      (capturedEntryBody as any)?.position,
      "entries POST body must include position equal to the pin label (regression: was '' or absent)",
    ).toBe("42");
  });

  test("repeated entry POSTs with one idempotency key return the original entry", async ({
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(
      request,
      `Position Scanner ${Date.now()}`,
    );
    cleanupIds.push(sess.id);

    const operationId = `entry-operation-${Date.now()}`;
    const payload = {
      aisle: "22",
      section: "46",
      position: "42",
      reelTag: "IDEMPOTENT-ENTRY",
      footage: 1000,
      reelCount: 1,
    };
    const headers = { "Idempotency-Key": operationId };

    const firstResponse = await request.post(
      `/api/sessions/${sess.id}/entries`,
      { headers, data: payload },
    );
    expect(
      firstResponse.ok(),
      `initial entries POST failed: ${await firstResponse.text()}`,
    ).toBe(true);
    const firstEntry = await firstResponse.json();

    const retryResponse = await request.post(
      `/api/sessions/${sess.id}/entries`,
      { headers, data: payload },
    );
    expect(
      retryResponse.ok(),
      `repeated entries POST failed: ${await retryResponse.text()}`,
    ).toBe(true);
    const retriedEntry = await retryResponse.json();
    expect(retriedEntry.id).toBe(firstEntry.id);

    const entriesResponse = await request.get(
      `/api/sessions/${sess.id}/entries`,
    );
    expect(entriesResponse.ok()).toBe(true);
    const entries = await entriesResponse.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(firstEntry.id);
  });
});
