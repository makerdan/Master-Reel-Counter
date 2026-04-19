import { useState, useEffect, useCallback, useRef } from "react";
import {
  getQueuedPhotos,
  getQueuedEntries,
  removeFromQueue,
  removeEntryFromQueue,
  getPendingCount,
  onQueueChange,
  dispatchEntrySynced,
} from "@/lib/offlineQueue";
import { queryClient } from "@/lib/queryClient";

const MAX_ENTRY_RETRIES = 3;

function scheduleEntryRetry(
  entryId: string,
  nextRetries: number,
  timersRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>,
  syncQueue: () => void,
) {
  const existing = timersRef.current.get(entryId);
  if (existing !== undefined) clearTimeout(existing);
  const backoffMs = Math.pow(4, nextRetries) * 500;
  const timer = setTimeout(() => {
    timersRef.current.delete(entryId);
    syncQueue();
  }, backoffMs);
  timersRef.current.set(entryId, timer);
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [entryRetryAttempt, setEntryRetryAttempt] = useState<number | null>(null);
  const [permanentlyFailedCount, setPermanentlyFailedCount] = useState(0);

  const syncingRef = useRef(false);
  const entryRetryCountsRef = useRef<Map<string, number>>(new Map());
  const permanentlyFailedRef = useRef<Set<string>>(new Set());
  const entryRetryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {}
  }, []);

  const syncQueue = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setIsSyncing(true);

    try {
      const entries = await getQueuedEntries();
      for (const entry of entries) {
        if (permanentlyFailedRef.current.has(entry.id)) continue;
        if (!navigator.onLine) break;

        const currentRetries = entryRetryCountsRef.current.get(entry.id) ?? 0;
        if (currentRetries > 0) {
          setEntryRetryAttempt(currentRetries + 1);
        }

        let fetchFailed = false;
        try {
          const res = await fetch(`/api/sessions/${entry.sessionId}/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry.data),
            credentials: "include",
          });

          if (res.ok) {
            const created = await res.json().catch(() => null);
            entryRetryCountsRef.current.delete(entry.id);
            const existingTimer = entryRetryTimersRef.current.get(entry.id);
            if (existingTimer !== undefined) {
              clearTimeout(existingTimer);
              entryRetryTimersRef.current.delete(entry.id);
            }
            await removeEntryFromQueue(entry.id);
            if (entry.placeholderId != null && created?.id != null) {
              dispatchEntrySynced(entry.placeholderId, created.id, entry.sessionId);
            }
            queryClient.invalidateQueries({
              queryKey: ["/api/sessions", entry.sessionId.toString(), "entries"],
            });
          } else {
            const nextRetries = currentRetries + 1;
            entryRetryCountsRef.current.set(entry.id, nextRetries);
            if (nextRetries >= MAX_ENTRY_RETRIES) {
              permanentlyFailedRef.current.add(entry.id);
              setPermanentlyFailedCount(permanentlyFailedRef.current.size);
            } else {
              scheduleEntryRetry(entry.id, nextRetries, entryRetryTimersRef, syncQueue);
            }
          }
        } catch {
          fetchFailed = true;
          const nextRetries = currentRetries + 1;
          entryRetryCountsRef.current.set(entry.id, nextRetries);
          if (nextRetries >= MAX_ENTRY_RETRIES) {
            permanentlyFailedRef.current.add(entry.id);
            setPermanentlyFailedCount(permanentlyFailedRef.current.size);
          } else {
            scheduleEntryRetry(entry.id, nextRetries, entryRetryTimersRef, syncQueue);
          }
        }

        if (fetchFailed) break;
      }

      const photos = await getQueuedPhotos();
      for (const photo of photos) {
        if (!navigator.onLine) break;
        try {
          const formData = new FormData();
          formData.append("file", photo.blob, `photo-${photo.id}.jpg`);

          const uploadRes = await fetch("/api/uploads/direct", {
            method: "POST",
            body: formData,
            credentials: "include",
          });

          if (!uploadRes.ok) continue;
          const uploadData = await uploadRes.json();

          const photoRes = await fetch(`/api/sessions/${photo.sessionId}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              objectStorageKey: uploadData.objectPath,
              originalFilename: `offline-${photo.id}.jpg`,
              mimeType: "image/jpeg",
              aisle: photo.aisle,
              section: photo.section,
              notes: photo.notes || undefined,
            }),
            credentials: "include",
          });

          if (photoRes.ok) {
            await removeFromQueue(photo.id);
            queryClient.invalidateQueries({
              queryKey: ["/api/sessions", photo.sessionId.toString(), "photos"],
            });
          }
        } catch {
          break;
        }
      }
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
      setEntryRetryAttempt(null);
      await refreshPendingCount();
    }
  }, [refreshPendingCount]);

  const retryAllFailedEntries = useCallback(() => {
    for (const timer of entryRetryTimersRef.current.values()) {
      clearTimeout(timer);
    }
    entryRetryTimersRef.current.clear();
    permanentlyFailedRef.current.clear();
    entryRetryCountsRef.current.clear();
    setPermanentlyFailedCount(0);
    syncQueue();
  }, [syncQueue]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      for (const [id, timer] of entryRetryTimersRef.current.entries()) {
        if (!permanentlyFailedRef.current.has(id)) {
          clearTimeout(timer);
          entryRetryTimersRef.current.delete(id);
        }
      }
      syncQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    refreshPendingCount();
    const interval = setInterval(refreshPendingCount, 5000);
    const unsubQueue = onQueueChange(refreshPendingCount);

    if (navigator.onLine) {
      syncQueue();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
      unsubQueue();
      for (const timer of entryRetryTimersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, [syncQueue, refreshPendingCount]);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    syncQueue,
    refreshPendingCount,
    entryRetryAttempt,
    permanentlyFailedCount,
    retryAllFailedEntries,
  };
}
