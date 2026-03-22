import { apiRequest } from "@/lib/queryClient";
import { saveEntryToQueue } from "@/lib/offlineQueue";

interface OfflineEntryResult {
  entry: { id: number; sessionId: number; [key: string]: unknown };
  queued: boolean;
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

export async function createEntryWithOfflineFallback(
  sessionId: number,
  data: Record<string, unknown>,
): Promise<OfflineEntryResult> {
  if (!navigator.onLine) {
    const id = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await saveEntryToQueue({ id, sessionId, data, createdAt: Date.now() });
    return { entry: { ...data, id: -1, sessionId }, queued: true };
  }

  try {
    const res = await apiRequest("POST", `/api/sessions/${sessionId}/entries`, data);
    const entry = await res.json();
    return { entry, queued: false };
  } catch (err) {
    if (isNetworkFailure(err)) {
      const id = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await saveEntryToQueue({ id, sessionId, data, createdAt: Date.now() });
      return { entry: { ...data, id: -1, sessionId }, queued: true };
    }
    throw err;
  }
}
