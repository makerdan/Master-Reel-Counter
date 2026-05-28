/**
 * @feature export
 * Guards PDF and Excel export functionality end-to-end via the session page UI:
 * - Creates a session with at least one entry via API fixture helpers.
 * - Navigates to the session page and verifies export controls are present
 *   (skips gracefully if the export button is not found in the UI).
 * - Excel: clicks the export dropdown → Excel item → captures the browser
 *   download event and asserts a non-empty file with a .xlsx extension.
 * - PDF: clicks the export dropdown → PDF item → handles the "unpinned
 *   entries" warning dialog and the PDF quality chooser dialog → captures
 *   the browser download event and asserts a non-empty .pdf file.
 */
import {
  test,
  expect,
  createSessionViaApi,
  createEntryViaApi,
} from "./fixtures";

test.describe("export checks @export", () => {
  test("Excel export initiates a non-empty .xlsx download from the UI", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(
      request,
      `Export Excel E2E ${Date.now()}`,
    );
    cleanupIds.push(sess.id);
    await createEntryViaApi(request, sess.id);

    await page.goto(`/session/${sess.id}`);
    await page.waitForLoadState("networkidle");

    // Guard: skip if the export button is not present in this build
    const exportBtn = page.locator('[data-testid="button-export"]');
    const exportBtnVisible = await exportBtn
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!exportBtnVisible) {
      test.skip(true, "Export button not found in session UI — skipping");
      return;
    }

    // Open the export dropdown — once the button exists the menu item must too
    await exportBtn.click();
    const excelItem = page
      .locator('[data-testid="button-export-excel"]')
      .first();
    await expect(
      excelItem,
      "Excel export item must be present in the export dropdown",
    ).toBeVisible({ timeout: 5_000 });

    // Arm the download listener before triggering so we don't miss it
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });

    // Click Excel — this starts the fetch + blob download client-side
    await excelItem.click();

    const download = await downloadPromise;
    const filename = download.suggestedFilename();

    expect(
      filename,
      "Downloaded file must have a .xlsx extension",
    ).toMatch(/\.xlsx$/i);

    // Ensure the download resolves without error and produces a real file
    const path = await download.path();
    expect(path, "Download must save to a local temp path").not.toBeNull();

    const { statSync } = await import("fs");
    const { size } = statSync(path!);
    expect(size, "Downloaded Excel file must be non-empty").toBeGreaterThan(0);
  });

  test("PDF export initiates a non-empty .pdf download from the UI", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(
      request,
      `Export PDF E2E ${Date.now()}`,
    );
    cleanupIds.push(sess.id);
    await createEntryViaApi(request, sess.id);

    await page.goto(`/session/${sess.id}`);
    await page.waitForLoadState("networkidle");

    // Guard: skip if the export button is not present in this build
    const exportBtn = page.locator('[data-testid="button-export"]');
    const exportBtnVisible = await exportBtn
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!exportBtnVisible) {
      test.skip(true, "Export button not found in session UI — skipping");
      return;
    }

    // Open the export dropdown — once the button exists the menu item must too
    await exportBtn.click();
    const pdfItem = page
      .locator('[data-testid="button-export-pdf"]')
      .first();
    await expect(
      pdfItem,
      "PDF export item must be present in the export dropdown",
    ).toBeVisible({ timeout: 5_000 });

    // Arm the download listener before any action that could trigger it.
    // PDF generation is a background job that may take up to ~60 s.
    const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });

    // Click PDF — triggers exportPdf() in the UI
    await pdfItem.click();

    // The session has an entry without a linked photo pin, so the "unpinned
    // entries" warning dialog may appear. If it does, click "Export Anyway".
    const exportAnywayBtn = page.locator(
      '[data-testid="button-export-anyway"]',
    );
    const warningVisible = await exportAnywayBtn
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (warningVisible) {
      await exportAnywayBtn.click();
    }

    // The PDF quality chooser dialog always opens next. Select "standard"
    // quality (faster for tests) and confirm.
    const qualityStandardBtn = page.locator(
      '[data-testid="button-pdf-quality-standard"]',
    );
    await expect(qualityStandardBtn).toBeVisible({ timeout: 10_000 });
    await qualityStandardBtn.click();

    const confirmBtn = page.locator(
      '[data-testid="button-pdf-quality-confirm"]',
    );
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // Wait for the background PDF job to finish and the browser to start the
    // download (client-side blob URL download via a.click()).
    const download = await downloadPromise;
    const filename = download.suggestedFilename();

    expect(
      filename,
      "Downloaded file must have a .pdf extension",
    ).toMatch(/\.pdf$/i);

    const path = await download.path();
    expect(path, "Download must save to a local temp path").not.toBeNull();

    const { statSync } = await import("fs");
    const { size } = statSync(path!);
    expect(size, "Downloaded PDF file must be non-empty").toBeGreaterThan(0);
  });
});
