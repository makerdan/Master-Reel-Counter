import { apiRequest } from "@/lib/queryClient";
import { saveEntryToQueue } from "@/lib/offlineQueue";

export interface OfflineEntryResult {
  entry: { id: number; sessionId: number; [key: string]: unknown };
  queued: boolean;
  placeholderId?: number;
}

function isNetworkFailure(err: unknown): boolean {
  if (!navigator.onLine) return true;
  if (err instanceof TypeError) {
    return (
      err.message === "Failed to fetch" ||
      err.message === "Load failed" ||
      err.message === "NetworkError when attempting to fetch resource."
    );
  }
  return false;
}

// ─── Persistent placeholder ID counter ───────────────────────────────────────
// The counter is seeded from localStorage so IDs stay unique across page
// reloads.  Without persistence the counter restarts at 0 after every reload,
// producing duplicate negative IDs that collide with optimistic entries from
// a previous session (React key collisions, mismatched UI rows).

const PLACEHOLDER_SEED_KEY = "offlinePlaceholderSeed";

function readSeedFromStorage(): number {
  try {
    const raw = localStorage.getItem(PLACEHOLDER_SEED_KEY);
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {}
  return 0;
}

let _placeholderCounter = readSeedFromStorage();

function nextPlaceholderId(): number {
  const id = -(++_placeholderCounter);
  try { localStorage.setItem(PLACEHOLDER_SEED_KEY, String(_placeholderCounter)); } catch {}
  return id;
}

export async function createEntryWithOfflineFallback(
  sessionId: number,
  data: Record<string, unknown>,
  userId?: string,
): Promise<OfflineEntryResult> {
  if (!navigator.onLine) {
    const id = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const placeholderId = nextPlaceholderId();
    await saveEntryToQueue({ id, sessionId, userId, data, createdAt: Date.now(), placeholderId });
    return { entry: { ...data, id: placeholderId, sessionId }, queued: true, placeholderId };
  }

  try {
    const res = await apiRequest("POST", `/api/sessions/${sessionId}/entries`, data);
    const entry = await res.json();
    return { entry, queued: false };
  } catch (err) {
    if (isNetworkFailure(err)) {
      const id = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const placeholderId = nextPlaceholderId();
      await saveEntryToQueue({ id, sessionId, userId, data, createdAt: Date.now(), placeholderId });
      return { entry: { ...data, id: placeholderId, sessionId }, queued: true, placeholderId };
    }
    throw err;
  }
}
