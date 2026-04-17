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

let _placeholderCounter = 0;
function nextPlaceholderId(): number {
  return -(++_placeholderCounter);
}

export async function createEntryWithOfflineFallback(
  sessionId: number,
  data: Record<string, unknown>,
): Promise<OfflineEntryResult> {
  if (!navigator.onLine) {
    const id = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const placeholderId = nextPlaceholderId();
    await saveEntryToQueue({ id, sessionId, data, createdAt: Date.now(), placeholderId });
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
      await saveEntryToQueue({ id, sessionId, data, createdAt: Date.now(), placeholderId });
      return { entry: { ...data, id: placeholderId, sessionId }, queued: true, placeholderId };
    }
    throw err;
  }
}
