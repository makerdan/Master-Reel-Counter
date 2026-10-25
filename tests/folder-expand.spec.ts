/**
 * @feature folder-expand
 * Guards folder auto-expand behaviour: after creating a folder and moving a
 * session into it (via the inline create-and-move flow) the folder must be
 * expanded and the session visible. The second sub-test guards the parity
 * case where moving a session via the "Move to Folder" dropdown should *also*
 * auto-expand the target folder — a behaviour that is easily missed when only
 * the create-and-move path is tested.
 */
import pg from "pg";
import { test, expect, createSessionViaApi } from "./fixtures";

type FolderRecord = {
  id: number;
  name: string;
  parentFolderId: number | null;
  deletedAt: string | null;
  trashedFromParentFolderId?: number | null;
};

async function expectOk(response: {
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
}) {
  if (!response.ok()) {
    throw new Error(`Expected successful API response, received ${response.status()}: ${await response.text()}`);
  }
}

async function createFolder(
  request: Parameters<typeof createSessionViaApi>[0],
  name: string,
  parentFolderId: number | null = null,
): Promise<FolderRecord> {
  const created = await request.post("/api/folders", { data: { name } });
  await expectOk(created);
  let folder = await created.json() as FolderRecord;
  if (parentFolderId !== null) {
    const moved = await request.patch(`/api/folders/${folder.id}`, { data: { parentFolderId } });
    await expectOk(moved);
    folder = await moved.json() as FolderRecord;
  }
  return folder;
}

async function getFolders(request: Parameters<typeof createSessionViaApi>[0]) {
  const response = await request.get("/api/folders");
  await expectOk(response);
  return response.json() as Promise<FolderRecord[]>;
}

async function moveSessionToFolder(
  request: Parameters<typeof createSessionViaApi>[0],
  sessionId: number,
  folderId: number | null,
) {
  const response = await request.post(`/api/sessions/${sessionId}/move`, { data: { folderId } });
  await expectOk(response);
  return response.json() as Promise<{ id: number; folderId: number | null }>;
}

async function permanentlyRemoveFolder(
  request: Parameters<typeof createSessionViaApi>[0],
  folderId: number,
) {
  const trashed = await request.delete(`/api/folders/${folderId}`);
  await expectOk(trashed);
  const deleted = await request.delete(`/api/folders/${folderId}/permanent`);
  await expectOk(deleted);
}

test.describe("folder auto-expand @folder-expand", () => {
  test("parent trash, restore, and permanent deletion preserve nested folders and sessions", async ({
    page,
    request,
    cleanupIds,
    secondApprovedIdentity,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secondDatabase = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      statement_timeout: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    let connected = false;
    let otherParentId: number | undefined;
    let otherChildId: number | undefined;
    let otherSessionId: number | undefined;
    try {
      await secondDatabase.connect();
      connected = true;
      const first = await createFolder(request, `Nested parent ${suffix}`);
      const child = await createFolder(request, `Nested child ${suffix}`, first.id);
      const grandchild = await createFolder(request, `Nested grandchild ${suffix}`, child.id);
      const session = await createSessionViaApi(request, `Nested session ${suffix}`);
      cleanupIds.push(session.id);
      await moveSessionToFolder(request, session.id, child.id);
      const moveTarget = await createFolder(request, `Nested move target ${suffix}`);

      const otherParent = await secondDatabase.query(
        `INSERT INTO folders (user_id, name) VALUES ($1, $2) RETURNING id`,
        [secondApprovedIdentity.userId, `Other parent ${suffix}`],
      );
      otherParentId = Number(otherParent.rows[0].id);
      const otherChild = await secondDatabase.query(
        `INSERT INTO folders (user_id, name, parent_folder_id) VALUES ($1, $2, $3) RETURNING id`,
        [secondApprovedIdentity.userId, `Other child ${suffix}`, otherParentId],
      );
      otherChildId = Number(otherChild.rows[0].id);
      const otherSession = await secondDatabase.query(
        `INSERT INTO counting_sessions (user_id, name, folder_id) VALUES ($1, $2, $3) RETURNING id`,
        [secondApprovedIdentity.userId, `Other session ${suffix}`, otherChildId],
      );
      otherSessionId = Number(otherSession.rows[0].id);

      const firstTrash = await request.delete(`/api/folders/${first.id}`);
      await expectOk(firstTrash);
      let active = await getFolders(request);
      expect(active.find((folder) => folder.id === child.id)?.parentFolderId).toBeNull();
      expect(active.find((folder) => folder.id === grandchild.id)?.parentFolderId).toBe(child.id);
      const sessionAfterDelete = await request.get(`/api/sessions/${session.id}`);
      expect(sessionAfterDelete.ok()).toBeTruthy();
      expect((await sessionAfterDelete.json()).folderId).toBe(child.id);

      await page.reload();
      await expect(page.locator(`[data-testid="folder-header-${child.id}"]`)).toBeVisible();
      await page.locator(`[data-testid="button-toggle-folder-${child.id}"]`).click();
      await expect(page.locator(`[data-testid="folder-header-${grandchild.id}"]`)).toBeVisible();
      await expect(page.locator(`[data-testid="card-session-${session.id}"]`)).toBeVisible();
      await page.locator(`[data-testid="button-toggle-folder-${grandchild.id}"]`).click();

      const firstRestore = await request.post(`/api/folders/${first.id}/restore`);
      await expectOk(firstRestore);
      active = await getFolders(request);
      expect(active.find((folder) => folder.id === child.id)?.parentFolderId).toBe(first.id);
      expect(active.find((folder) => folder.id === grandchild.id)?.parentFolderId).toBe(child.id);

      const secondParent = await createFolder(request, `Restore parent ${suffix}`);
      const secondChild = await createFolder(request, `Restore child ${suffix}`, secondParent.id);
      const secondGrandchild = await createFolder(request, `Restore grandchild ${suffix}`, secondChild.id);
      const restoreSession = await createSessionViaApi(request, `Restore session ${suffix}`);
      cleanupIds.push(restoreSession.id);
      await moveSessionToFolder(request, restoreSession.id, secondChild.id);
      await request.delete(`/api/folders/${secondParent.id}`);
      active = await getFolders(request);
      expect(active.find((folder) => folder.id === secondChild.id)?.parentFolderId).toBeNull();
      const restored = await request.post(`/api/folders/${secondParent.id}/restore`);
      await expectOk(restored);
      active = await getFolders(request);
      expect(active.find((folder) => folder.id === secondChild.id)?.parentFolderId).toBe(secondParent.id);
      expect(active.find((folder) => folder.id === secondGrandchild.id)?.parentFolderId).toBe(secondChild.id);

      const movedParent = await createFolder(request, `Moved parent ${suffix}`);
      const movedChild = await createFolder(request, `Moved child ${suffix}`, movedParent.id);
      const movedGrandchild = await createFolder(request, `Moved grandchild ${suffix}`, movedChild.id);
      await request.delete(`/api/folders/${movedParent.id}`);
      const explicitMove = await request.patch(`/api/folders/${movedChild.id}`, {
        data: { parentFolderId: moveTarget.id },
      });
      await expectOk(explicitMove);
      const movedRestore = await request.post(`/api/folders/${movedParent.id}/restore`);
      await expectOk(movedRestore);
      active = await getFolders(request);
      expect(active.find((folder) => folder.id === movedChild.id)?.parentFolderId).toBe(moveTarget.id);
      expect(active.find((folder) => folder.id === movedGrandchild.id)?.parentFolderId).toBe(movedChild.id);

      const permanentParent = await createFolder(request, `Permanent parent ${suffix}`);
      const permanentChild = await createFolder(request, `Permanent child ${suffix}`, permanentParent.id);
      const permanentGrandchild = await createFolder(request, `Permanent grandchild ${suffix}`, permanentChild.id);
      const permanentSession = await createSessionViaApi(request, `Permanent session ${suffix}`);
      cleanupIds.push(permanentSession.id);
      await moveSessionToFolder(request, permanentSession.id, permanentChild.id);
      await permanentlyRemoveFolder(request, permanentParent.id);
      active = await getFolders(request);
      expect(active.find((folder) => folder.id === permanentParent.id)).toBeUndefined();
      expect(active.find((folder) => folder.id === permanentChild.id)?.parentFolderId).toBeNull();
      expect(active.find((folder) => folder.id === permanentGrandchild.id)?.parentFolderId).toBe(permanentChild.id);
      const permanentSessionRead = await request.get(`/api/sessions/${permanentSession.id}`);
      expect(permanentSessionRead.ok()).toBeTruthy();
      expect((await permanentSessionRead.json()).folderId).toBe(permanentChild.id);
      await page.reload();
      await expect(page.locator(`[data-testid="folder-header-${permanentChild.id}"]`)).toBeVisible();
      await page.locator(`[data-testid="button-toggle-folder-${permanentChild.id}"]`).click();
      await expect(page.locator(`[data-testid="folder-header-${permanentGrandchild.id}"]`)).toBeVisible();
      await expect(page.locator(`[data-testid="card-session-${permanentSession.id}"]`)).toBeVisible();

      const otherRows = await secondDatabase.query(
        `SELECT f.id, f.parent_folder_id, f.trashed_from_parent_folder_id, s.id AS session_id, s.folder_id AS session_folder_id
         FROM folders f LEFT JOIN counting_sessions s ON s.folder_id = f.id
         WHERE f.id = ANY($1::int[]) ORDER BY f.id`,
        [[otherParentId, otherChildId]],
      );
      expect(otherRows.rows).toEqual([
        {
          id: otherParentId,
          parent_folder_id: null,
          trashed_from_parent_folder_id: null,
          session_id: null,
          session_folder_id: null,
        },
        {
          id: otherChildId,
          parent_folder_id: otherParentId,
          trashed_from_parent_folder_id: null,
          session_id: otherSessionId,
          session_folder_id: otherChildId,
        },
      ]);
    } finally {
      if (connected) {
        if (otherSessionId) await secondDatabase.query("DELETE FROM counting_sessions WHERE id = $1", [otherSessionId]);
        if (otherChildId) await secondDatabase.query("DELETE FROM folders WHERE id = $1", [otherChildId]);
        if (otherParentId) await secondDatabase.query("DELETE FROM folders WHERE id = $1", [otherParentId]);
      }
      await secondDatabase.end().catch(() => {});

      const active = await request.get("/api/folders").catch(() => null);
      if (active?.ok()) {
        const rows = await active.json() as FolderRecord[];
        for (const row of rows.filter((folder) => folder.name.endsWith(suffix))) {
          await request.delete(`/api/folders/${row.id}`).catch(() => {});
        }
      }
      const trash = await request.get("/api/folders/trash").catch(() => null);
      if (trash?.ok()) {
        const rows = await trash.json() as FolderRecord[];
        for (const row of rows.filter((folder) => folder.name.endsWith(suffix))) {
          await request.delete(`/api/folders/${row.id}/permanent`).catch(() => {});
        }
      }
    }
  });

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
      await page.reload();
      await page.waitForLoadState("domcontentloaded");

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
      await page.waitForLoadState("domcontentloaded");

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
      await page.waitForLoadState("domcontentloaded");

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

      await page.waitForLoadState("domcontentloaded");

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
