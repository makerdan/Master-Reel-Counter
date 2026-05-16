/**
 * @feature scan
 * Guards the parity bug where per-photo scan reports skipped-pin count in the
 * result toast but session-wide scan omits it. Both paths must surface the
 * same metric. Buttons are located via stable data-testid attributes so
 * label changes don't produce false passes/failures.
 */
import { test, expect, createSessionViaApi, uploadTestPhoto } from "./fixtures";

const MOCK_SKIP_PAYLOAD = {
  results: [{ pinId: -1, pinLabel: "P1", rawText: null, readable: false }],
  skippedPins: 1,
  skippedPinLabels: ["P1"],
};

test.describe("scan result parity @scan", () => {
  test("per-photo scan toast shows skipped-pin count", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Scan Parity Photo ${Date.now()}`);
    cleanupIds.push(sess.id);

    const photo = await uploadTestPhoto(request, sess.id);
    if (!photo) {
      test.skip(true, "Photo upload unavailable");
      return;
    }

    await request.post(`/api/sessions/${sess.id}/pins`, {
      data: { photoId: photo.id, label: "P1", xPercent: 50, yPercent: 50, reelCount: 1, isDraft: true },
    });

    await page.route(`**/api/photos/${photo.id}/analyze-labels`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SKIP_PAYLOAD) }),
    );

    await page.goto(`/session/${sess.id}?tab=scanner`);
    await page.waitForLoadState("networkidle");

    // Use stable data-testid — hard failure if button is missing (guards UI wiring)
    await expect(
      page.locator('[data-testid="btn-analyze-labels"]'),
      "btn-analyze-labels must be present in the scanner tab",
    ).toBeVisible({ timeout: 8_000 });
    await page.click('[data-testid="btn-analyze-labels"]');

    await expect(
      page.locator('[role="status"]').getByText(/1\s+skip/i).first(),
    ).toBeVisible({ timeout: 12_000, message: "Per-photo scan toast must report skipped-pin count" });
  });

  test("session-wide scan toast shows skipped-pin count", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Scan Parity Session ${Date.now()}`);
    cleanupIds.push(sess.id);

    const photo = await uploadTestPhoto(request, sess.id);
    if (!photo) {
      test.skip(true, "Photo upload unavailable");
      return;
    }

    await request.post(`/api/sessions/${sess.id}/pins`, {
      data: { photoId: photo.id, label: "P1", xPercent: 50, yPercent: 50, reelCount: 1, isDraft: true },
    });

    await page.route(`**/api/sessions/${sess.id}/analyze-labels`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SKIP_PAYLOAD) }),
    );

    await page.goto(`/session/${sess.id}?tab=scanner`);
    await page.waitForLoadState("networkidle");

    // Switch to batch/session-wide mode — hard failure if button missing
    await expect(
      page.locator('[data-testid="btn-mode-batch"]'),
      "btn-mode-batch must be present in the scanner tab",
    ).toBeVisible({ timeout: 8_000 });
    await page.click('[data-testid="btn-mode-batch"]');

    // Trigger session-wide scan — hard failure if button missing
    await expect(
      page.locator('[data-testid="btn-analyze-labels"]'),
      "btn-analyze-labels must be visible after switching to batch mode",
    ).toBeVisible({ timeout: 8_000 });
    await page.click('[data-testid="btn-analyze-labels"]');

    // Parity check: session-wide toast must also show skipped count
    await expect(
      page.locator('[role="status"]').getByText(/1\s+skip/i).first(),
    ).toBeVisible({ timeout: 12_000, message: "Session-wide scan toast must report skipped-pin count — parity with per-photo scan" });
  });
});
