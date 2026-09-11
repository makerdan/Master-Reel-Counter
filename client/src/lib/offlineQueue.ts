const DB_NAME = "reel-counter-offline";
const DB_VERSION = 2;
const PHOTO_STORE = "photo-queue";
const ENTRY_STORE = "entry-queue";

const QUEUE_CHANGE_EVENT = "offline-queue-change";

function notifyQueueChange() {
  window.dispatchEvent(new Event(QUEUE_CHANGE_EVENT));
}

export function onQueueChange(callback: () => void): () => void {
  window.addEventListener(QUEUE_CHANGE_EVENT, callback);
  return () => window.removeEventListener(QUEUE_CHANGE_EVENT, callback);
}

export interface QueuedPhoto {
  id: string;
  registrationKey: string;
  sessionId: number;
  userId?: string;
  blob: Blob;
  originalFilename?: string;
  uploadFilename?: string;
  width?: number;
  height?: number;
  photoQuality?: number;
  aisle: string;
  section: string;
  notes: string;
  isReceiving: boolean;
  isOnFloor: boolean;
  createdAt: number;
  inFlight?: boolean;
  claimedAt?: number;
  uploadedObjectPath?: string;
}

export interface QueuedEntry {
  id: string;
  sessionId: number;
  userId?: string;
  data: Record<string, unknown>;
  createdAt: number;
  placeholderId?: number;
  inFlight?: boolean;
  claimedAt?: number;
  permanentlyFailed?: boolean;
  failureReason?: string;
}

export function dispatchEntrySynced(placeholderId: number, realId: number, sessionId: number): void {
  window.dispatchEvent(
    new CustomEvent("reelcounter:entry-synced", {
      detail: { placeholderId, realId, sessionId },
    }),
  );
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        db.createObjectStore(ENTRY_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveToQueue(item: QueuedPhoto): Promise<void> {
  if (!item.userId) {
    throw new Error("Cannot queue an offline photo without an authenticated application identity");
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).put(item);
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function ensurePhotoRegistrationKey(item: QueuedPhoto): Promise<string> {
  if (item.registrationKey) return item.registrationKey;
  const registrationKey = item.id;
  await patchPhotoRecord(item.id, { registrationKey });
  return registrationKey;
}

export async function persistPhotoUploadedObjectPath(id: string, uploadedObjectPath: string, expectedOwner?: string): Promise<void> {
  return patchPhotoRecord(id, { uploadedObjectPath }, expectedOwner);
}
export async function removeFromQueue(id: string, expectedOwner?: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    const store = tx.objectStore(PHOTO_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result as QueuedPhoto | undefined;
      if (item && (!expectedOwner || item.userId === expectedOwner)) store.delete(id);
    };
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns queued photos, optionally filtered by session and/or user.
 *
 * **Always pass `userId` in UI contexts.** Omitting it returns items for ALL
 * users on this device, which inflates any count or list shown to the current
 * user. The only legitimate callers without a userId are internal migration and
 * admin helpers that intentionally operate on the full store.
 */
export async function getQueuedPhotos(sessionId?: number, userId?: string): Promise<QueuedPhoto[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const req = tx.objectStore(PHOTO_STORE).getAll();
    req.onsuccess = () => {
      let results = req.result as QueuedPhoto[];
      if (sessionId !== undefined) {
        results = results.filter(r => r.sessionId === sessionId);
      }
      if (userId !== undefined) {
        // Ownerless records are legacy data and must never be adopted by the
        // current identity. They are purged during startup migration below.
        results = results.filter(r => r.userId === userId);
      }
      resolve(results.sort((a, b) => a.createdAt - b.createdAt));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearQueue(sessionId?: number, userId?: string): Promise<void> {
  const items = await getQueuedPhotos(sessionId, userId);
  if (sessionId !== undefined || userId !== undefined) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, "readwrite");
      const store = tx.objectStore(PHOTO_STORE);
      for (const item of items) {
        store.delete(item.id);
      }
      tx.oncomplete = () => { resolve(); notifyQueueChange(); };
      tx.onerror = () => reject(tx.error);
    });
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).clear();
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveEntryToQueue(item: QueuedEntry): Promise<void> {
  if (!item.userId) {
    throw new Error("Cannot queue an offline entry without an authenticated application identity");
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, "readwrite");
    tx.objectStore(ENTRY_STORE).put(item);
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeEntryFromQueue(id: string, expectedOwner?: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, "readwrite");
    const store = tx.objectStore(ENTRY_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result as QueuedEntry | undefined;
      if (item && (!expectedOwner || item.userId === expectedOwner)) store.delete(id);
    };
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns queued entries, optionally filtered by session and/or user.
 *
 * **Always pass `userId` in UI contexts.** Omitting it returns items for ALL
 * users on this device, which inflates any count or list shown to the current
 * user. The only legitimate callers without a userId are internal migration and
 * admin helpers that intentionally operate on the full store.
 */
export async function getQueuedEntries(sessionId?: number, userId?: string): Promise<QueuedEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, "readonly");
    const req = tx.objectStore(ENTRY_STORE).getAll();
    req.onsuccess = () => {
      let results = req.result as QueuedEntry[];
      if (sessionId !== undefined) {
        results = results.filter(r => r.sessionId === sessionId);
      }
      if (userId !== undefined) {
        // Ownerless records are not eligible for display or submission by any
        // authenticated identity.
        results = results.filter(r => r.userId === userId);
      }
      resolve(results.sort((a, b) => a.createdAt - b.createdAt));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns the total number of queued items (photos + entries) pending sync.
 *
 * **Always pass `userId` in UI contexts.** Omitting it counts items for ALL
 * users on this device and will show an inflated badge number to the current
 * user. The only legitimate callers without a userId are internal diagnostics
 * or admin helpers that need the full device-wide total.
 */
export async function getPendingCount(userId?: string): Promise<number> {
  const photos = await getQueuedPhotos(undefined, userId);
  const entries = await getQueuedEntries(undefined, userId);
  return photos.length + entries.length;
}

export interface QueueReconciliationResult {
  reassignedPhotos: number;
  reassignedEntries: number;
  ownerlessPhotos: number;
  ownerlessEntries: number;
}

const identityInitializationPromises = new Map<string, Promise<QueueReconciliationResult>>();

/**
 * Reassign records only when their existing owner is a server-verified alias
 * of the current account. Both stores are updated in one transaction so queue
 * filtering and cleanup cannot observe a partially migrated identity.
 */
export async function reconcileQueueOwnership(
  canonicalUserId: string,
  verifiedAliases: readonly string[],
): Promise<QueueReconciliationResult> {
  const aliases = new Set(
    verifiedAliases.filter(alias => alias.length > 0 && alias !== canonicalUserId),
  );
  const result: QueueReconciliationResult = {
    reassignedPhotos: 0,
    reassignedEntries: 0,
    ownerlessPhotos: 0,
    ownerlessEntries: 0,
  };
  if (aliases.size === 0) return result;

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([PHOTO_STORE, ENTRY_STORE], "readwrite");
    const reconcileStore = (
      storeName: string,
      reassignedKey: "reassignedPhotos" | "reassignedEntries",
      ownerlessKey: "ownerlessPhotos" | "ownerlessEntries",
    ) => {
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        for (const item of request.result as Array<{ userId?: unknown }>) {
          if (typeof item.userId !== "string" || item.userId.length === 0) {
            result[ownerlessKey]++;
          } else if (aliases.has(item.userId)) {
            store.put({ ...item, userId: canonicalUserId });
            result[reassignedKey]++;
          }
        }
      };
    };
    reconcileStore(PHOTO_STORE, "reassignedPhotos", "ownerlessPhotos");
    reconcileStore(ENTRY_STORE, "reassignedEntries", "ownerlessEntries");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  if (result.reassignedPhotos > 0 || result.reassignedEntries > 0) {
    notifyQueueChange();
  }
  return result;
}

/**
 * Shared startup barrier for every identity-scoped queue consumer.
 * Reconciliation must finish before owner-filtered reads or claim recovery.
 */
export function initializeOfflineQueueIdentity(
  canonicalUserId: string,
  verifiedAliases: readonly string[],
): Promise<QueueReconciliationResult> {
  const key = JSON.stringify([
    canonicalUserId,
    ...Array.from(new Set(verifiedAliases)).sort(),
  ]);
  let pending = identityInitializationPromises.get(key);
  if (!pending) {
    pending = reconcileQueueOwnership(canonicalUserId, verifiedAliases);
    identityInitializationPromises.set(key, pending);
    pending.catch(() => identityInitializationPromises.delete(key));
  }
  return pending;
}

export async function clearAllQueuedPhotos(userId?: string): Promise<void> {
  if (userId !== undefined) {
    return clearQueue(undefined, userId);
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).clear();
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

// ─── In-flight claim helpers ──────────────────────────────────────────────────
// Each queue item is marked inFlight=true before the drain loop submits it.
// The drain loop skips any item already marked inFlight, preventing
// double-submission when two drainers run concurrently (e.g. rapid reconnect
// events or multiple tabs open simultaneously).
// clearAllInFlight() resets stale inFlight flags left by interrupted page
// sessions and must be called once on startup.

// Atomically claims an item by setting inFlight=true only if it is currently
// false (or absent).  Returns true if the claim succeeded, false if another
// drainer already holds the claim.
//
// IDB guarantees that only one readwrite transaction can hold the lock on a
// given object store at a time, so the get→check→put sequence inside a single
// readwrite transaction is effectively atomic even under concurrent drainers
// (e.g. multiple browser tabs or rapid online/offline events).

export async function claimPhotoInFlight(id: string, expectedOwner?: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    const store = tx.objectStore(PHOTO_STORE);
    const req = store.get(id);
    let claimed = false;
    req.onsuccess = () => {
      const item = req.result as QueuedPhoto | undefined;
      if (!item || item.inFlight || (expectedOwner && item.userId !== expectedOwner)) return;
      store.put({ ...item, inFlight: true, claimedAt: Date.now() });
      claimed = true;
    };
    tx.oncomplete = () => resolve(claimed);
    tx.onerror = () => reject(tx.error);
  });
}

export async function claimEntryInFlight(id: string, expectedOwner?: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, "readwrite");
    const store = tx.objectStore(ENTRY_STORE);
    const req = store.get(id);
    let claimed = false;
    req.onsuccess = () => {
      const item = req.result as QueuedEntry | undefined;
      if (!item || item.inFlight || (expectedOwner && item.userId !== expectedOwner)) return;
      store.put({ ...item, inFlight: true, claimedAt: Date.now() });
      claimed = true;
    };
    tx.oncomplete = () => resolve(claimed);
    tx.onerror = () => reject(tx.error);
  });
}

// Non-atomic release helpers — safe to use because the caller already holds
// the claim (and is the only one mutating it at this point).

async function patchPhotoRecord(id: string, patch: Partial<QueuedPhoto>, expectedOwner?: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    const store = tx.objectStore(PHOTO_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result as QueuedPhoto | undefined;
      if (item && (!expectedOwner || item.userId === expectedOwner)) store.put({ ...item, ...patch });
    };
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

async function patchEntryRecord(id: string, patch: Partial<QueuedEntry>, expectedOwner?: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, "readwrite");
    const store = tx.objectStore(ENTRY_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result as QueuedEntry | undefined;
      if (item && (!expectedOwner || item.userId === expectedOwner)) store.put({ ...item, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearPhotoInFlight(id: string, expectedOwner?: string): Promise<void> {
  return patchPhotoRecord(id, { inFlight: false }, expectedOwner);
}

export async function clearEntryInFlight(id: string, expectedOwner?: string): Promise<void> {
  return patchEntryRecord(id, { inFlight: false }, expectedOwner);
}

// How long a claim is considered "fresh" (i.e. likely still being processed).
// Any inFlight claim stamped within this window is preserved so that a second
// tab or rapid-reconnect event cannot reset a claim that is actively in use.
// Chosen to be comfortably longer than a realistic single-item submit cycle
// (upload + record create).  Crashed-page claims expire after this period.
export const CLAIM_STALENESS_MS = 2 * 60 * 1000; // 2 minutes
export const CLAIM_FUTURE_SKEW_MS = 30 * 1000;

// Resets inFlight flags ONLY for claims that are demonstrably stale (older
// than CLAIM_STALENESS_MS or missing a claimedAt timestamp).
// Call once on app startup so items stranded by a previous page crash are
// retried, without disturbing active claims from another tab.
export async function clearStaleInFlight(userId: string): Promise<void> {
  const db = await openDB();
  const now = Date.now();

  const resetStore = (storeName: string) =>
    new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      let resetAny = false;
      req.onsuccess = () => {
        for (const item of req.result as Array<Record<string, unknown>>) {
          if (item.userId !== userId) continue;
          if (!item.inFlight) continue;
          const claimedAt = item.claimedAt;
          const validClaimTime =
            typeof claimedAt === "number"
            && Number.isFinite(claimedAt)
            && claimedAt <= now + CLAIM_FUTURE_SKEW_MS;
          const age = validClaimTime ? now - claimedAt : Infinity;
          if (age >= CLAIM_STALENESS_MS) {
            store.put({ ...item, inFlight: false, claimedAt: undefined });
            resetAny = true;
          }
        }
      };
      tx.oncomplete = () => resolve(resetAny);
      tx.onerror = () => reject(tx.error);
    });

  const photoReset = await resetStore(PHOTO_STORE);
  const entryReset = await resetStore(ENTRY_STORE);
  if (photoReset || entryReset) notifyQueueChange();
}

// ─── Permanently-failed entry helpers ────────────────────────────────────────
// These persist the failure state to IDB so that the warning panel is
// restored immediately after a page reload, without having to exhaust retries
// again.

export async function markEntryPermanentlyFailed(id: string, reason: string, expectedOwner?: string): Promise<void> {
  return patchEntryRecord(id, { permanentlyFailed: true, failureReason: reason }, expectedOwner);
}

export async function clearEntryPermanentlyFailed(id: string, expectedOwner?: string): Promise<void> {
  return patchEntryRecord(id, { permanentlyFailed: false, failureReason: undefined }, expectedOwner);
}

export async function getFailedQueuedEntries(userId?: string): Promise<QueuedEntry[]> {
  const all = await getQueuedEntries(undefined, userId);
  return all.filter(e => e.permanentlyFailed === true);
}

export async function clearLegacyQueueItems(): Promise<void> {
  // Ownerless records cannot be safely attributed to the signed-in account.
  // Keep them quarantined by strict owner filtering rather than deleting data
  // that may be recoverable through a future, trustworthy ownership mechanism.
  await openDB();
}
