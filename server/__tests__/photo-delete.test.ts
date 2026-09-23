/**
 * Integration tests for the photo deletion failure modes.
 *
 * Tests import and call the REAL `executePhotoDeletion` function from routes.ts
 * (not a synthetic re-implementation), so any regression in the production
 * sequencing logic will be caught here.
 *
 * The two failure branches under test:
 *
 *   Scenario 1 — DB cascade fails
 *     The storage file must not be touched. The photo remains fully accessible
 *     so the UI shows no broken reference.
 *
 *   Scenario 2 — Storage file removal fails after a successful DB cascade
 *     The function must resolve (not re-throw), leaving an orphaned blob but
 *     no DB row — the UI has no broken reference. Verified by querying the
 *     real DB after the call.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  executePhotoDeletion,
  executeSessionPhotoFileCleanup,
  type PhotoDeletionDeps,
} from "../routes.js";
import { physicalObjectKeyAliases, storage } from "../storage.js";
import { db, pool } from "../db.js";
import { countingSessions, photos, uploadIntents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { canonicalPhysicalObjectKey } from "../replit_integrations/object_storage/index.js";

// ---------------------------------------------------------------------------
// Scenario 1: DB failure — storage must NOT be called
// ---------------------------------------------------------------------------

describe("executePhotoDeletion — DB cascade failure", () => {
  test("re-throws the DB error so the caller can return 500", async () => {
    const deps: PhotoDeletionDeps = {
      deletePhotoFromDb: async () => {
        throw new Error("Simulated DB constraint failure");
      },
      isObjectKeyShared: async () => false,
      deleteStorageFile: async () => {
        throw new Error("deleteStorageFile must NOT have been called");
      },
    };

    await assert.rejects(
      () => executePhotoDeletion({ id: 999, objectStorageKey: "/uploads/test.jpg" }, deps),
      (err: Error) => {
        assert.equal(err.message, "Simulated DB constraint failure");
        return true;
      }
    );
  });

  test("storage deleteStorageFile is never invoked when the DB cascade throws", async () => {
    let storageDeleteInvoked = false;

    const deps: PhotoDeletionDeps = {
      deletePhotoFromDb: async () => {
        throw new Error("Simulated DB constraint failure");
      },
      isObjectKeyShared: async () => {
        storageDeleteInvoked = true;
        return false;
      },
      deleteStorageFile: async () => {
        storageDeleteInvoked = true;
      },
    };

    await assert.rejects(
      () => executePhotoDeletion({ id: 999, objectStorageKey: "/uploads/test.jpg" }, deps)
    );

    assert.equal(
      storageDeleteInvoked,
      false,
      "neither isObjectKeyShared nor deleteStorageFile must be called when deletePhotoFromDb throws — " +
      "the storage file must remain intact so the photo stays accessible in the UI"
    );
  });
});

describe("canonical physical object identity", () => {
  test("maps direct and legacy upload paths to the same key", () => {
    assert.equal(canonicalPhysicalObjectKey("/uploads/shared.jpg"), "/uploads/shared.jpg");
    assert.equal(canonicalPhysicalObjectKey("/objects/uploads/shared.jpg"), "/uploads/shared.jpg");
    assert.equal(canonicalPhysicalObjectKey("uploads/shared.jpg"), "/uploads/shared.jpg");
  });

  test("produces only the two indexed database lookup aliases", () => {
    assert.deepEqual(
      physicalObjectKeyAliases("/objects/uploads/shared.jpg"),
      ["/uploads/shared.jpg", "/objects/uploads/shared.jpg"],
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Storage failure after successful DB cascade — must return 200
//
// Uses real DB fixtures so the DB-row-absence assertion is authoritative:
// we insert an actual photo row, let executePhotoDeletion delete it via the
// real storage.deletePhoto, then query the DB to confirm the row is gone.
// ---------------------------------------------------------------------------

describe("executePhotoDeletion — storage failure after successful DB delete", () => {
  type PhotoFixture = {
    userId: string;
    sessionId: number;
    photo: { id: number; objectStorageKey: string };
  };

  async function createPhotoFixture(label: string): Promise<PhotoFixture> {
    const userId = `photo-delete-${randomUUID()}`;
    let sessionId = 0;
    try {
      const [session] = await db
        .insert(countingSessions)
        .values({ userId, name: `__photo-delete-${label}-${userId}__` })
        .returning();
      sessionId = session.id;

      const [photo] = await db
        .insert(photos)
        .values({
          sessionId,
          userId,
          objectStorageKey: `/uploads/${userId}.jpg`,
        })
        .returning();
      return { userId, sessionId, photo };
    } catch (error) {
      if (sessionId) {
        await db.delete(countingSessions).where(eq(countingSessions.id, sessionId)).catch(() => {});
      }
      throw error;
    }
  }

  async function cleanupPhotoFixture(fixture: PhotoFixture): Promise<void> {
    await db
      .delete(uploadIntents)
      .where(eq(uploadIntents.userId, fixture.userId))
      .catch(() => {});
    await db
      .delete(countingSessions)
      .where(eq(countingSessions.id, fixture.sessionId))
      .catch(() => {});
  }

  async function withPhotoFixture<T>(
    label: string,
    callback: (fixture: PhotoFixture) => Promise<T>,
  ): Promise<T> {
    const fixture = await createPhotoFixture(label);
    try {
      return await callback(fixture);
    } finally {
      await cleanupPhotoFixture(fixture);
    }
  }

  after(async () => {
    await pool.end().catch(() => {});
  });

  test("resolves without throwing even when deleteStorageFile throws", async () => {
    await withPhotoFixture("storage-failure", async ({ photo }) => {
      let storageDeleteAttempted = false;

      const deps: PhotoDeletionDeps = {
        // Use the real storage.deletePhoto so the DB row is actually removed.
        deletePhotoFromDb: (id) => storage.deletePhoto(id),
        isObjectKeyShared: (key, excludeId) => storage.isObjectKeyShared(key, excludeId),
        deleteStorageFile: async () => {
          storageDeleteAttempted = true;
          throw new Error("Simulated GCS / object-storage outage");
        },
      };

      // Must NOT throw — the storage failure must be swallowed.
      await executePhotoDeletion(photo, deps);

      assert.equal(
        storageDeleteAttempted,
        true,
        "deleteStorageFile must have been attempted even though it fails"
      );
    });
  });

  test("photo row no longer exists in the DB after executePhotoDeletion resolves", async () => {
    await withPhotoFixture("row-absence", async ({ photo }) => {
      await executePhotoDeletion(photo, {
        deletePhotoFromDb: (id) => storage.deletePhoto(id),
        isObjectKeyShared: (key, excludeId) => storage.isObjectKeyShared(key, excludeId),
        deleteStorageFile: async () => {},
      });

      const row = await storage.getPhoto(photo.id);
      assert.equal(
        row,
        undefined,
        "photo row must be absent from the DB after executePhotoDeletion returns — " +
        "the UI must not be able to serve a broken reference"
      );
    });
  });

  test("session cleanup preserves a file referenced through a legacy alias", async () => {
    await withPhotoFixture("legacy-alias", async ({ userId, sessionId }) => {
      const [retainedSession] = await db
        .insert(countingSessions)
        .values({ userId, name: `__photo-delete-retained-${userId}__` })
        .returning();
      try {
        const [direct, legacy] = await db
          .insert(photos)
          .values([
            {
              sessionId,
              userId,
              objectStorageKey: "/uploads/shared-alias.jpg",
            },
            {
              sessionId: retainedSession.id,
              userId,
              objectStorageKey: "/objects/uploads/shared-alias.jpg",
            },
          ])
          .returning();
        let storageDeleteAttempted = false;

        await executePhotoDeletion(direct, {
          deletePhotoFromDb: (id) => storage.deletePhoto(id),
          isObjectKeyShared: (key, excludeId) => storage.isObjectKeyShared(key, excludeId),
          deleteStorageFile: async () => {
            storageDeleteAttempted = true;
          },
        });

        assert.equal(storageDeleteAttempted, false);
        assert.ok(await storage.getPhoto(legacy.id));
      } finally {
        await db.delete(countingSessions).where(eq(countingSessions.id, retainedSession.id)).catch(() => {});
      }
    });
  });

  test("whole-session cleanup deletes direct and legacy candidates exactly once", async () => {
    const candidates = [
      { id: 901, objectStorageKey: "/uploads/session-alias.jpg" },
      { id: 902, objectStorageKey: "/objects/uploads/session-alias.jpg" },
    ];
    const sharedChecks: Array<{ key: string; excludedIds: number[] }> = [];
    const deletedKeys: string[] = [];

    await executeSessionPhotoFileCleanup(candidates, {
      isObjectKeyShared: async (key, excludedIds) => {
        sharedChecks.push({ key, excludedIds });
        return false;
      },
      deleteStorageFile: async (key) => {
        deletedKeys.push(key);
      },
    });

    assert.deepEqual(sharedChecks, [{
      key: "/uploads/session-alias.jpg",
      excludedIds: [901, 902],
    }]);
    assert.deepEqual(deletedKeys, ["/uploads/session-alias.jpg"]);
  });

  test("orphan cleanup does not return a legacy intent whose direct key is referenced", async () => {
    await withPhotoFixture("orphan-intent", async ({ userId, sessionId }) => {
      const objectPath = "/objects/uploads/referenced-intent-alias.jpg";
      await db.insert(photos).values({
        sessionId,
        userId,
        objectStorageKey: "/uploads/referenced-intent-alias.jpg",
      });
      await db.insert(uploadIntents).values({
        objectPath,
        userId,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });

      const expired = await storage.getExpiredUploadIntents(60 * 60 * 1000);

      assert.equal(
        expired.some((intent) => intent.objectPath === objectPath),
        false,
        "a referenced legacy alias must not be purged as an orphan",
      );
    });
  });
});
