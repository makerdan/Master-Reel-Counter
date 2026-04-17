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

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);

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
        if (!navigator.onLine) break;
        try {
          const res = await fetch(`/api/sessions/${entry.sessionId}/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry.data),
            credentials: "include",
          });
          if (res.ok) {
            const created = await res.json().catch(() => null);
            await removeEntryFromQueue(entry.id);
            if (entry.placeholderId != null && created?.id != null) {
              dispatchEntrySynced(entry.placeholderId, created.id, entry.sessionId);
            }
            queryClient.invalidateQueries({
              queryKey: ["/api/sessions", entry.sessionId.toString(), "entries"],
            });
          }
        } catch {
          break;
        }
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
      await refreshPendingCount();
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
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
    };
  }, [syncQueue, refreshPendingCount]);

  return { isOnline, pendingCount, isSyncing, syncQueue, refreshPendingCount };
}
