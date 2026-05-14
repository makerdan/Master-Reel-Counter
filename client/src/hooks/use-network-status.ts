import { useState, useEffect, useCallback, useRef } from "react";
import {
  getQueuedPhotos,
  getQueuedEntries,
  removeFromQueue,
  removeEntryFromQueue,
  getPendingCount,
  onQueueChange,
  dispatchEntrySynced,
  claimPhotoInFlight,
  clearPhotoInFlight,
  claimEntryInFlight,
  clearEntryInFlight,
  clearStaleInFlight,
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
        // Fast path: skip items the snapshot already shows as in-flight.
        if (entry.inFlight) continue;
        if (permanentlyFailedRef.current.has(entry.id)) continue;
        if (!navigator.onLine) break;

        const currentRetries = entryRetryCountsRef.current.get(entry.id) ?? 0;
        if (currentRetries > 0) {
          setEntryRetryAttempt(currentRetries + 1);
        }

        // Atomically claim the item. A concurrent drainer (e.g. another tab)
        // will have its own readwrite transaction queued behind this one; once
        // ours commits with inFlight=true, theirs will see the flag and return
        // false, so it skips the item without double-submitting.
        const claimed = await claimEntryInFlight(entry.id);
        if (!claimed) continue;

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
            // Item deleted from IDB — the inFlight flag goes with it.
            await removeEntryFromQueue(entry.id);
            if (entry.placeholderId != null && created?.id != null) {
              dispatchEntrySynced(entry.placeholderId, created.id, entry.sessionId);
            }
            queryClient.invalidateQueries({
              queryKey: ["/api/sessions", entry.sessionId.toString(), "entries"],
            });
          } else if (res.status === 401) {
            // Session expired — retrying won't help. Force re-auth and keep
            // the item in the queue for the next authenticated session.
            await clearEntryInFlight(entry.id);
            queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
            fetchFailed = true;
          } else {
            await clearEntryInFlight(entry.id);
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
          await clearEntryInFlight(entry.id);
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
        // Fast path: snapshot already shows this item as in-flight.
        if (photo.inFlight) continue;
        if (!navigator.onLine) break;

        // Atomically claim the photo item before submitting.
        const claimed = await claimPhotoInFlight(photo.id);
        if (!claimed) continue;

        try {
          const formData = new FormData();
          formData.append("file", photo.blob, `photo-${photo.id}.jpg`);

          const uploadRes = await fetch("/api/uploads/direct", {
            method: "POST",
            body: formData,
            credentials: "include",
          });

          if (uploadRes.status === 401) {
            await clearPhotoInFlight(photo.id);
            queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
            break;
          }
          if (!uploadRes.ok) {
            // Server-side error for this photo — release claim and try the next.
            await clearPhotoInFlight(photo.id);
            continue;
          }
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

          if (photoRes.status === 401) {
            await clearPhotoInFlight(photo.id);
            queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
            break;
          }
          if (photoRes.ok) {
            // Item deleted — inFlight flag goes with it.
            await removeFromQueue(photo.id);
            queryClient.invalidateQueries({
              queryKey: ["/api/sessions", photo.sessionId.toString(), "photos"],
            });
          } else {
            // Photo record creation failed — release claim for a future retry.
            await clearPhotoInFlight(photo.id);
          }
        } catch {
          // True network failure — release claim and wait for next online event.
          await clearPhotoInFlight(photo.id);
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

    // Clear STALE inFlight flags (older than 2 min) from a previous page crash
    // BEFORE the initial drain, so stranded items are retried.  We use a
    // staleness threshold rather than clearing all flags so that active claims
    // in another tab are never disturbed.  syncQueue fires only after the clear
    // completes to prevent a race where the drain skips not-yet-reset items.
    clearStaleInFlight()
      .catch(() => {})
      .then(() => {
        if (navigator.onLine) syncQueue();
      });

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
