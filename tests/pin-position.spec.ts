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
    const sess = await createSessionViaApi(request, `Position API ${Date.now()}`);
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
   * AI Label Scanner, the POST /api/sessions/:id/entries body must include
   * `position` set to the pin's label number (as a string).
   *
   * The draft pin is seeded with wireDetails/vendorCode/footage so that
   * applyPinSeed populates editCatalog/editVendor/editFootage without needing
   * an actual scan result — the card is immediately committable after the
   * (mocked) analysis completes.
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
    if (!photo) {
      test.skip(true, "Photo upload unavailable in this environment");
      return;
    }

    // Create a draft pin with label 42 and pre-filled wire data so that the
    // scanner card is committable (editCatalog/Vendor/Footage come from
    // pin.wireDetails via applyPinSeed, no catalog match required).
    const pinRes = await request.post(`/api/sessions/${sess.id}/pins`, {
      data: {
        photoId: photo.id,
        label: 42,
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

    // Mock analyze-labels to return immediately (pin is unreadable so no
    // catalog-match step is required, but the phase still transitions to
    // "results" and the card is committable via the pin's own wireDetails).
    await page.route(`**/api/photos/${photo.id}/analyze-labels`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            { pinId: pin.id, pinLabel: "42", rawText: null, readable: false },
          ],
          skippedPins: 1,
          skippedPinLabels: ["42"],
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
    await page.waitForLoadState("networkidle");

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
});
