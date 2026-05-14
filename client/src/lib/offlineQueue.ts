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
  sessionId: number;
  blob: Blob;
  aisle: string;
  section: string;
  notes: string;
  isReceiving: boolean;
  isOnFloor: boolean;
  createdAt: number;
  inFlight?: boolean;
}

export interface QueuedEntry {
  id: string;
  sessionId: number;
  data: Record<string, unknown>;
  createdAt: number;
  placeholderId?: number;
  inFlight?: boolean;
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
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).put(item);
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeFromQueue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    tx.objectStore(PHOTO_STORE).delete(id);
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedPhotos(sessionId?: number): Promise<QueuedPhoto[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const req = tx.objectStore(PHOTO_STORE).getAll();
    req.onsuccess = () => {
      let results = req.result as QueuedPhoto[];
      if (sessionId !== undefined) {
        results = results.filter(r => r.sessionId === sessionId);
      }
      resolve(results.sort((a, b) => a.createdAt - b.createdAt));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearQueue(sessionId?: number): Promise<void> {
  if (sessionId !== undefined) {
    const items = await getQueuedPhotos(sessionId);
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
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, "readwrite");
    tx.objectStore(ENTRY_STORE).put(item);
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeEntryFromQueue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, "readwrite");
    tx.objectStore(ENTRY_STORE).delete(id);
    tx.oncomplete = () => { resolve(); notifyQueueChange(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedEntries(sessionId?: number): Promise<QueuedEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, "readonly");
    const req = tx.objectStore(ENTRY_STORE).getAll();
    req.onsuccess = () => {
      let results = req.result as QueuedEntry[];
      if (sessionId !== undefined) {
        results = results.filter(r => r.sessionId === sessionId);
      }
      resolve(results.sort((a, b) => a.createdAt - b.createdAt));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingCount(): Promise<number> {
  const photos = await getQueuedPhotos();
  const entries = await getQueuedEntries();
  return photos.length + entries.length;
}

export async function clearAllQueuedPhotos(): Promise<void> {
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

async function patchPhotoRecord(id: string, patch: Partial<QueuedPhoto>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    const store = tx.objectStore(PHOTO_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      if (req.result) store.put({ ...req.result, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function patchEntryRecord(id: string, patch: Partial<QueuedEntry>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, "readwrite");
    const store = tx.objectStore(ENTRY_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      if (req.result) store.put({ ...req.result, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markPhotoInFlight(id: string): Promise<void> {
  return patchPhotoRecord(id, { inFlight: true });
}

export async function clearPhotoInFlight(id: string): Promise<void> {
  return patchPhotoRecord(id, { inFlight: false });
}

export async function markEntryInFlight(id: string): Promise<void> {
  return patchEntryRecord(id, { inFlight: true });
}

export async function clearEntryInFlight(id: string): Promise<void> {
  return patchEntryRecord(id, { inFlight: false });
}

// Resets all inFlight flags across both stores.  Call once on app startup so
// that items stranded in-flight by a prior page crash or reload are retried
// on the next sync rather than silently skipped forever.
export async function clearAllInFlight(): Promise<void> {
  const db = await openDB();

  const resetStore = (storeName: string) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => {
        for (const item of req.result as Array<Record<string, unknown>>) {
          if (item.inFlight) {
            store.put({ ...item, inFlight: false });
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

  await resetStore(PHOTO_STORE);
  await resetStore(ENTRY_STORE);
}
