/**
 * @feature folder-expand
 * Guards folder auto-expand behaviour: after creating a folder and moving a
 * session into it (via the inline create-and-move flow) the folder must be
 * expanded and the session visible. The second sub-test guards the parity
 * case where moving a session via the "Move to Folder" dropdown should *also*
 * auto-expand the target folder — a behaviour that is easily missed when only
 * the create-and-move path is tested.
 */
import { test, expect, createSessionViaApi } from "./fixtures";

test.describe("folder auto-expand @folder-expand", () => {
  test("creating a folder and moving a session into it auto-expands the folder", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(
      request,
      `FolderExpand Create ${Date.now()}`,
    );
    cleanupIds.push(sess.id);

    // Capture the folder name before any UI interaction so the finally block
    // can always find and delete it via the API, even if an assertion fails.
    const folderName = `AutoExpand ${Date.now()}`;

    try {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Open session context menu
      const menuBtn = page.locator(
        `[data-testid="button-session-menu-${sess.id}"]`,
      );
      await expect(menuBtn).toBeVisible({ timeout: 10_000 });
      await menuBtn.click();

      // Open the "Move to Folder" submenu to expose nested items
      const moveSubmenu = page.locator(
        `[data-testid="menu-move-session-${sess.id}"]`,
      );
      await expect(moveSubmenu).toBeVisible({ timeout: 5_000 });
      await moveSubmenu.click();

      // Click "Create folder and move" (nested inside the submenu)
      const createFolderItem = page.locator(
        `[data-testid="menu-create-folder-${sess.id}"]`,
      );
      await expect(createFolderItem).toBeVisible({ timeout: 5_000 });
      await createFolderItem.click();

      // Fill in folder name and submit
      const folderNameInput = page.locator(
        '[data-testid="input-inline-folder-name"]',
      );
      await expect(folderNameInput).toBeVisible({ timeout: 5_000 });
      await folderNameInput.fill(folderName);

      const createMoveBtn = page.locator(
        '[data-testid="button-create-folder-and-move"]',
      );
      await createMoveBtn.click();

      // Wait for the mutation to complete and the UI to update
      await page.waitForLoadState("networkidle");

      // Find the newly created folder's header in the DOM
      const folderHeader = page
        .locator('[data-testid^="folder-header-"]')
        .filter({ hasText: folderName });
      await expect(folderHeader).toBeVisible({ timeout: 10_000 });

      // The session card must be visible (i.e., the folder is expanded)
      const sessionCard = page.locator(
        `[data-testid="card-session-${sess.id}"]`,
      );
      await expect(
        sessionCard,
        "Session card must be visible after create-and-move (folder should be auto-expanded)",
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      // Always clean up: look up the folder by name via the API and delete it.
      // This runs even when an assertion fails before the folderHeader resolves.
      const foldersRes = await request.get("/api/folders").catch(() => null);
      if (foldersRes?.ok()) {
        const folders = (await foldersRes.json()) as { id: number; name: string }[];
        const matches = folders.filter((f) => f.name === folderName);
        for (const match of matches) {
          await request.delete(`/api/folders/${match.id}`).catch(() => {});
        }
      }
    }
  });

  test("moving a session via Move-to-Folder menu auto-expands the target folder", async ({
    page,
    request,
    cleanupIds,
  }) => {
    const sess = await createSessionViaApi(
      request,
      `FolderExpand Move ${Date.now()}`,
    );
    cleanupIds.push(sess.id);

    // Create a folder via API — capture its ID immediately for guaranteed cleanup
    const folderRes = await request.post("/api/folders", {
      data: { name: `MoveTarget ${Date.now()}` },
    });
    const folder = await folderRes.json() as { id: number };

    try {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Collapse the folder first (it should be collapsed if empty)
      const toggleBtn = page.locator(
        `[data-testid="button-toggle-folder-${folder.id}"]`,
      );
      if (await toggleBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        // Check if folder is currently expanded by seeing if sessions inside are visible
        const folderSection = page.locator(`#folder-section-${folder.id}`);
        const isOpen = await folderSection
          .locator('[data-testid^="card-session-"]')
          .first()
          .isVisible({ timeout: 1_000 })
          .catch(() => false);
        if (isOpen) {
          await toggleBtn.click();
          await page.waitForTimeout(300);
        }
      }

      // Open session context menu and move to the existing folder
      const menuBtn = page.locator(
        `[data-testid="button-session-menu-${sess.id}"]`,
      );
      await expect(menuBtn).toBeVisible({ timeout: 10_000 });
      await menuBtn.click();

      // Open the "Move to Folder" submenu
      const moveSubmenu = page.locator(
        `[data-testid="menu-move-session-${sess.id}"]`,
      );
      await expect(moveSubmenu).toBeVisible({ timeout: 5_000 });
      await moveSubmenu.click();

      // Click the specific target folder
      const moveFolderItem = page.locator(
        `[data-testid="menu-move-to-folder-${folder.id}-${sess.id}"]`,
      );
      await expect(moveFolderItem).toBeVisible({ timeout: 5_000 });
      await moveFolderItem.click();

      await page.waitForLoadState("networkidle");

      // The session must be visible inside the target folder (i.e., folder is expanded)
      const sessionCard = page.locator(
        `[data-testid="card-session-${sess.id}"]`,
      );
      await expect(
        sessionCard,
        "Session card must be visible after Move-to-Folder (target folder should auto-expand)",
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      // Always clean up the folder — runs even when an assertion fails mid-test
      await request.delete(`/api/folders/${folder.id}`).catch(() => {});
    }
  });
});
