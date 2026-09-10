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
  ensurePhotoRegistrationKey,
  persistPhotoUploadedObjectPath,
  claimEntryInFlight,
  clearEntryInFlight,
  clearStaleInFlight,
  markEntryPermanentlyFailed,
  clearEntryPermanentlyFailed,
  getFailedQueuedEntries,
  clearLegacyQueueItems,
} from "@/lib/offlineQueue";
import { queryClient } from "@/lib/queryClient";

// Legacy records have no safe owner. Purge them once per page session, even
// though multiple components subscribe to the network status hook.
const MAX_ENTRY_RETRIES = 3;

export interface FailedEntryInfo {
  id: string;
  sessionId: number;
  data: Record<string, unknown>;
  reason: string;
}

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

export function useNetworkStatus(currentUserId?: string) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [entryRetryAttempt, setEntryRetryAttempt] = useState<number | null>(null);
  const [permanentlyFailedCount, setPermanentlyFailedCount] = useState(0);
  const [failedEntries, setFailedEntries] = useState<FailedEntryInfo[]>([]);

  const syncingRef = useRef(false);
  const currentUserRef = useRef(currentUserId);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const entryRetryCountsRef = useRef<Map<string, number>>(new Map());
  const permanentlyFailedRef = useRef<Set<string>>(new Set());
  const failedEntriesRef = useRef<Map<string, FailedEntryInfo>>(new Map());
  const entryRetryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (currentUserRef.current !== currentUserId) {
      activeAbortControllerRef.current?.abort();
      entryRetryCountsRef.current.clear();
      permanentlyFailedRef.current.clear();
      failedEntriesRef.current.clear();
      setEntryRetryAttempt(null);
      setPermanentlyFailedCount(0);
      setFailedEntries([]);
      for (const timer of entryRetryTimersRef.current.values()) clearTimeout(timer);
      entryRetryTimersRef.current.clear();
    }
    currentUserRef.current = currentUserId;
    return () => {
      activeAbortControllerRef.current?.abort();
    };
  }, [currentUserId]);

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount(currentUserId);
      setPendingCount(count);
    } catch {}
  }, [currentUserId]);

  const syncQueue = useCallback(async () => {
    // Never drain without a confirmed user identity — would risk submitting
    // another user's queued items under the current auth cookie.
    if (!currentUserId) return;
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setIsSyncing(true);
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    try {
      const entries = await getQueuedEntries(undefined, currentUserId);
      for (const entry of entries) {
        if (currentUserRef.current !== currentUserId) break;
        // Fast path: skip items the snapshot already shows as in-flight.
        if (entry.inFlight) continue;
        // Check both the in-memory ref and the IDB-persisted flag so that
        // entries which permanently failed before the last reload are also
        // skipped until the user explicitly retries.
        if (permanentlyFailedRef.current.has(entry.id) || entry.permanentlyFailed) continue;
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
        if (currentUserRef.current !== currentUserId) {
          await clearEntryInFlight(entry.id);
          break;
        }

        let fetchFailed = false;
        try {
          const res = await fetch(`/api/sessions/${entry.sessionId}/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry.data),
            credentials: "include",
            signal: abortController.signal,
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
              const reason = `Server error (${res.status})`;
              permanentlyFailedRef.current.add(entry.id);
              setPermanentlyFailedCount(permanentlyFailedRef.current.size);
              const info: FailedEntryInfo = {
                id: entry.id,
                sessionId: entry.sessionId,
                data: entry.data,
                reason,
              };
              failedEntriesRef.current.set(entry.id, info);
              setFailedEntries(Array.from(failedEntriesRef.current.values()));
              // Persist the failure to IDB so the warning survives a page reload.
              markEntryPermanentlyFailed(entry.id, reason).catch(() => {});
            } else {
              scheduleEntryRetry(entry.id, nextRetries, entryRetryTimersRef, syncQueue);
            }
          }
        } catch (error) {
          await clearEntryInFlight(entry.id);
          fetchFailed = true;
          if (abortController.signal.aborted || currentUserRef.current !== currentUserId) {
            break;
          }
          const nextRetries = currentRetries + 1;
          entryRetryCountsRef.current.set(entry.id, nextRetries);
          if (nextRetries >= MAX_ENTRY_RETRIES) {
            const reason = "Network error";
            permanentlyFailedRef.current.add(entry.id);
            setPermanentlyFailedCount(permanentlyFailedRef.current.size);
            const info: FailedEntryInfo = {
              id: entry.id,
              sessionId: entry.sessionId,
              data: entry.data,
              reason,
            };
            failedEntriesRef.current.set(entry.id, info);
            setFailedEntries(Array.from(failedEntriesRef.current.values()));
            // Persist the failure to IDB so the warning survives a page reload.
            markEntryPermanentlyFailed(entry.id, reason).catch(() => {});
          } else {
            scheduleEntryRetry(entry.id, nextRetries, entryRetryTimersRef, syncQueue);
          }
        }

        if (fetchFailed) break;
      }

      const photos = await getQueuedPhotos(undefined, currentUserId);
      for (const photo of photos) {
        if (currentUserRef.current !== currentUserId) break;
        // Fast path: snapshot already shows this item as in-flight.
        if (photo.inFlight) continue;
        if (!navigator.onLine) break;

        // Atomically claim the photo item before submitting.
        const claimed = await claimPhotoInFlight(photo.id);
        if (!claimed) continue;
        if (currentUserRef.current !== currentUserId) {
          await clearPhotoInFlight(photo.id);
          break;
        }

        try {
          const claimedPhoto = (await getQueuedPhotos(photo.sessionId, currentUserId))
            .find(item => item.id === photo.id);
          if (!claimedPhoto) continue;
          const registrationKey = await ensurePhotoRegistrationKey(claimedPhoto);
          let uploadedObjectPath = claimedPhoto.uploadedObjectPath;
          if (!uploadedObjectPath) {
            const formData = new FormData();
            formData.append("file", claimedPhoto.blob, claimedPhoto.uploadFilename || `photo-${photo.id}.jpg`);

            const uploadRes = await fetch("/api/uploads/direct", {
              method: "POST",
              body: formData,
              credentials: "include",
              signal: abortController.signal,
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
            if (typeof uploadData.objectPath !== "string" || uploadData.objectPath.length === 0) {
              throw new Error("Upload response did not include an object path");
            }
            uploadedObjectPath = uploadData.objectPath;
            await persistPhotoUploadedObjectPath(photo.id, uploadData.objectPath);
          }
          if (!uploadedObjectPath) throw new Error("Uploaded object path is unavailable");

          const photoRes = await fetch(`/api/sessions/${photo.sessionId}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              registrationKey,
              objectStorageKey: uploadedObjectPath,
              originalFilename: claimedPhoto.originalFilename || `offline-${photo.id}.jpg`,
              mimeType: "image/jpeg",
              fileSize: claimedPhoto.blob.size,
              width: claimedPhoto.width,
              height: claimedPhoto.height,
              aisle: claimedPhoto.aisle,
              section: claimedPhoto.section,
              notes: claimedPhoto.notes || undefined,
            }),
            credentials: "include",
            signal: abortController.signal,
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
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null;
      }
      syncingRef.current = false;
      setIsSyncing(false);
      setEntryRetryAttempt(null);
      await refreshPendingCount();
    }
  }, [refreshPendingCount, currentUserId]);

  const discardFailedEntry = useCallback(async (id: string) => {
    try {
      await removeEntryFromQueue(id);
    } catch {}
    permanentlyFailedRef.current.delete(id);
    failedEntriesRef.current.delete(id);
    setPermanentlyFailedCount(permanentlyFailedRef.current.size);
    setFailedEntries(Array.from(failedEntriesRef.current.values()));
  }, []);

  const retryAllFailedEntries = useCallback(async () => {
    for (const timer of entryRetryTimersRef.current.values()) {
      clearTimeout(timer);
    }
    entryRetryTimersRef.current.clear();
    // Clear the IDB-persisted failure flags BEFORE draining so the drain loop
    // does not see permanentlyFailed=true and skip these entries.  We must
    // await all clears; a fire-and-forget here would race with syncQueue.
    // If a clear fails, we proceed anyway so the current session's retry works
    // correctly (in-memory refs are cleared below regardless).  The worst-case
    // degradation is that a successfully-retried entry re-appears as "failed"
    // after the next reload; IDB remove (on success) makes this self-healing.
    await Promise.all(
      Array.from(permanentlyFailedRef.current).map(id =>
        clearEntryPermanentlyFailed(id).catch(err => {
          console.warn("[offline] Failed to clear permanentlyFailed flag for entry", id, err);
        }),
      ),
    );
    permanentlyFailedRef.current.clear();
    entryRetryCountsRef.current.clear();
    failedEntriesRef.current.clear();
    setPermanentlyFailedCount(0);
    setFailedEntries([]);
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

    const recoverExpiredClaims = () => {
      clearStaleInFlight()
        .catch(() => {})
        .then(() => {
          refreshPendingCount();
          if (navigator.onLine) syncQueue();
        });
    };

    refreshPendingCount();
    // A claim can still be fresh when a replacement page starts. Keep sweeping
    // while the app is open so an interrupted owner is retried once its claim
    // expires, without resetting active work in another tab.
    const interval = setInterval(recoverExpiredClaims, 5000);
    const unsubQueue = onQueueChange(refreshPendingCount);

    // Clear STALE inFlight flags (older than 2 min) from a previous page crash
    // BEFORE the initial drain, so stranded items are retried.  We use a
    // staleness threshold rather than clearing all flags so that active claims
    // in another tab are never disturbed.  syncQueue fires only after the clear
    // completes to prevent a race where the drain skips not-yet-reset items.
    //
    // After clearing stale flags, restore any entries that were permanently
    // failed in a previous session.  They stay in IDB with permanentlyFailed=true
    // and must be surfaced to the user immediately — before the first drain —
    // so the warning panel appears right away instead of after the next retry
    // cycle exhausts its attempts again.
    ensureLegacyQueueCleanup()
      .catch(() => {})
      .then(() => clearStaleInFlight())
      .catch(() => {})
      .then(async () => {
        try {
          const failed = await getFailedQueuedEntries(currentUserId);
          const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
          const now = Date.now();
          for (const entry of failed) {
            const age = typeof entry.createdAt === "number" ? now - entry.createdAt : 0;
            if (age > TTL_MS) {
              // Silently remove expired entries — no need to surface them.
              removeEntryFromQueue(entry.id).catch(() => {});
              continue;
            }
            permanentlyFailedRef.current.add(entry.id);
            failedEntriesRef.current.set(entry.id, {
              id: entry.id,
              sessionId: entry.sessionId,
              data: entry.data,
              reason: entry.failureReason || "Failed to sync",
            });
          }
          if (permanentlyFailedRef.current.size > 0) {
            setPermanentlyFailedCount(permanentlyFailedRef.current.size);
            setFailedEntries(Array.from(failedEntriesRef.current.values()));
          }
        } catch {}

        // Purge orphaned queued photos older than 30 days.  These accumulate
        // when a tab is closed mid-upload before the item exhausts its retry
        // budget (it never reaches permanentlyFailed so it stays in IDB forever).
        try {
          const TTL_MS = 30 * 24 * 60 * 60 * 1000;
          const now = Date.now();
          const photos = await getQueuedPhotos(undefined, currentUserId);
          const staleIds = photos
            .filter(p => {
              const age = typeof p.createdAt === "number" ? now - p.createdAt : 0;
              return age > TTL_MS;
            })
            .map(p => p.id);
          if (staleIds.length > 0) {
            await Promise.allSettled(staleIds.map(id => removeFromQueue(id)));
            console.debug(`[offline-queue] auto-purged ${staleIds.length} stale queued photo${staleIds.length === 1 ? "" : "s"} (>30 days old)`);
          }
        } catch {}

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

  // Show the browser's native "Leave site?" dialog whenever there are items
  // waiting to be synced. Registered/removed as pendingCount crosses zero so
  // the listener is never attached unnecessarily.
  useEffect(() => {
    if (pendingCount === 0) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "You have unsynced items that have not been uploaded yet. Are you sure you want to leave?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pendingCount]);

  return {
    isOnline,
    pendingCount,
    isSyncing,
    syncQueue,
    refreshPendingCount,
    entryRetryAttempt,
    permanentlyFailedCount,
    retryAllFailedEntries,
    discardFailedEntry,
    failedEntries,
  };
}

let legacyCleanupPromise: Promise<void> | null = null;

function ensureLegacyQueueCleanup(): Promise<void> {
  legacyCleanupPromise ??= clearLegacyQueueItems();
  return legacyCleanupPromise;
}
