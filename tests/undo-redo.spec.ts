/**
 * @feature undo
 * Guards the class of bug where undo is wired for one deletion type (entries)
 * but not another (pins). Both must show an "Undo" toast action and restore
 * the deleted item when clicked.
 */
import { test, expect, createSessionViaApi, createEntryViaApi, uploadTestPhoto } from "./fixtures";

test.describe("undo/redo parity @undo", () => {
  test("deleting an entry shows undo toast and restoring it works", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Undo Entry ${Date.now()}`);
    cleanupIds.push(sess.id);
    const entry = await createEntryViaApi(request, sess.id);

    await page.goto(`/session/${sess.id}`);
    const photoTab = page.locator('[data-testid="tab-photo-mode"]');
    await expect(photoTab).toBeVisible({ timeout: 30_000 });
    await photoTab.click();

    // Entry sections are collapsed by default — expand the section first
    const sectionToggle = page.locator('[data-testid="section-toggle-A-1"]');
    if (await sectionToggle.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await sectionToggle.click();
    }

    const entryRow = page.locator(`[data-testid="row-entry-${entry.id}"]`);
    await expect(entryRow).toBeVisible({ timeout: 10_000 });

    await page.click(`[data-testid="button-delete-entry-${entry.id}"]`);

    // The delete button opens a confirmation dialog — confirm the deletion
    const deleteConfirmBtn = page.getByRole("button", { name: /^Delete$/i }).last();
    if (await deleteConfirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await deleteConfirmBtn.click();
    }

    // Undo toast action button must appear
    const undoBtn = page.getByRole("button", { name: /^Undo$/i });
    await expect(undoBtn).toBeVisible({ timeout: 8_000 });

    // Clicking undo must restore the row.
    // The undo for delete-entry re-creates the entry via POST (new server-assigned ID),
    // so we check that ANY entry row is visible rather than the original ID.
    await undoBtn.click();
    await expect(page.locator('[data-testid^="row-entry-"]').first()).toBeVisible({ timeout: 8_000 });
  });

  test("deleting a draft pin can be undone @undo", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(request, `Undo Pin ${Date.now()}`);
    cleanupIds.push(sess.id);

    const photo = await uploadTestPhoto(request, sess.id);
    const draftClientId = `undo-pin-${Date.now()}`;

    // Create a draft pin
    const pinRes = await request.post(`/api/photos/${photo.id}/pins`, {
      data: {
        photoId: photo.id,
        label: "P1",
        xPercent: 50,
        yPercent: 50,
        reelCount: 1,
        draftClientId,
      },
    });
    expect(pinRes.ok(), `Pin creation failed: ${await pinRes.text()}`).toBe(true);
    const pin = await pinRes.json();

    // PhotoMode renders pin overlays after the image load completes. Keep this
    // fixture independent from object-storage availability in the browser
    // test environment while still exercising the real photo and pin APIs.
    await page.route("**/uploads/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64",
        ),
      }),
    );
    await page.goto(`/session/${sess.id}?tab=photo`);

    // Wait for photo mode to load with the pin
    const pinEl = page.locator(`[data-testid="pin-${draftClientId}"]`);
    await expect(pinEl).toBeVisible({ timeout: 10_000 });

    // Delete the pin — must trigger an undo toast (parity check with entry deletion)
    await page.click(`[data-testid="button-delete-pin-${draftClientId}"]`);

    await expect(pinEl).toHaveCount(0);
    const undoBtn = page.locator('[data-testid="button-undo"]');
    await expect(
      undoBtn,
      "Deleting a draft pin must enable the session Undo control",
    ).toBeEnabled({ timeout: 8_000 });

    // Clicking undo must restore the pin
    await undoBtn.click();
    await expect(pinEl).toBeVisible({ timeout: 8_000 });
  });
});
