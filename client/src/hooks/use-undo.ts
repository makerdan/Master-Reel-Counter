import { useState, useCallback, useRef, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { createEntryWithOfflineFallback } from "@/lib/offlineEntryCreate";

type ActionType = "create-entry" | "update-entry" | "delete-entry" | "create-pin" | "update-pin" | "delete-pin" | "restore-draft-pins" | "dismiss-duplicate" | "undismiss-duplicate" | "flag-pin" | "unflag-pin" | "delete-photo" | "duplicate-photo" | "update-photo" | "update-session" | "lock-session" | "create-comment" | "update-comment" | "delete-comment";

interface UndoAction {
  type: ActionType;
  sessionId: number;
  entityId: number;
  data: any;
  previousData?: any;
}

const MAX_STACK = 20;

function undoKey(sessionId: number) { return `reelcounter:undo-stack:${sessionId}`; }
function redoKey(sessionId: number) { return `reelcounter:redo-stack:${sessionId}`; }

function loadStack(key: string): UndoAction[] {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStack(key: string, stack: UndoAction[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(stack));
  } catch {
    // Ignore quota or access errors gracefully
  }
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

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function useUndoRedo(sessionId: number) {
  const [undoStack, setUndoStack] = useState<UndoAction[]>(() => loadStack(undoKey(sessionId)));
  const [redoStack, setRedoStack] = useState<UndoAction[]>(() => loadStack(redoKey(sessionId)));
  const busyRef = useRef(false);
  const { toast } = useToast();

  // Rehydrate stacks when sessionId changes (guards against a component instance
  // being reused with a different sessionId without unmounting first).
  useEffect(() => {
    setUndoStack(loadStack(undoKey(sessionId)));
    setRedoStack(loadStack(redoKey(sessionId)));
  }, [sessionId]);

  // Persist stacks to sessionStorage on every change.
  // Guard: if any action in either stack carries a different sessionId, the
  // stacks are still settling after a session transition (React's setState from
  // the rehydration effect above hasn't propagated yet). Skip the write so we
  // never persist stale cross-session data under the new session's key.
  useEffect(() => {
    const mismatch =
      undoStack.some(a => a.sessionId !== sessionId) ||
      redoStack.some(a => a.sessionId !== sessionId);
    if (!mismatch) {
      saveStack(undoKey(sessionId), undoStack);
      saveStack(redoKey(sessionId), redoStack);
    }
  }, [sessionId, undoStack, redoStack]);

  // Clear persisted stacks when leaving the session (component unmount).
  useEffect(() => {
    return () => {
      try { sessionStorage.removeItem(undoKey(sessionId)); } catch {}
      try { sessionStorage.removeItem(redoKey(sessionId)); } catch {}
    };
  }, [sessionId]);

  const invalidateSession = useCallback((actionType?: ActionType) => {
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "dismissed-duplicates"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"] });
    if (actionType === "create-comment" || actionType === "update-comment" || actionType === "delete-comment") {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "activity"] });
    }
    if (actionType === "update-session" || actionType === "lock-session") {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
    }
    if (actionType === "delete-photo" || actionType === "duplicate-photo" || actionType === "create-entry" || actionType === "delete-entry" || actionType === "update-entry") {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
    }
  }, [sessionId]);

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack(prev => [...prev.slice(-(MAX_STACK - 1)), action]);
    setRedoStack([]);
  }, []);

  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const applyReverse = useCallback(async (action: UndoAction): Promise<UndoAction> => {
    switch (action.type) {
      case "create-entry": {
        await apiRequest("DELETE", `/api/entries/${action.entityId}`);
        return { type: "delete-entry", sessionId: action.sessionId, entityId: action.entityId, data: action.data, previousData: action.data };
      }
      case "delete-entry": {
        const res = await apiRequest("POST", `/api/sessions/${action.sessionId}/entries`, action.previousData);
        const created = await res.json();
        return { type: "create-entry", sessionId: action.sessionId, entityId: created.id, data: action.previousData };
      }
      case "update-entry": {
        await apiRequest("PATCH", `/api/entries/${action.entityId}`, action.previousData);
        return { type: "update-entry", sessionId: action.sessionId, entityId: action.entityId, data: action.previousData, previousData: action.data };
      }
      case "create-pin": {
        await apiRequest("DELETE", `/api/pins/${action.entityId}`);
        return { type: "delete-pin", sessionId: action.sessionId, entityId: action.entityId, data: action.data, previousData: action.data };
      }
      case "delete-pin": {
        const res = await apiRequest("POST", `/api/photos/${action.data.photoId}/pins`, action.previousData);
        const created = await res.json();
        return { type: "create-pin", sessionId: action.sessionId, entityId: created.id, data: action.previousData };
      }
      case "update-pin": {
        await apiRequest("PATCH", `/api/pins/${action.entityId}`, action.previousData);
        return { type: "update-pin", sessionId: action.sessionId, entityId: action.entityId, data: action.previousData, previousData: action.data };
      }
      case "restore-draft-pins": {
        await apiRequest("PUT", `/api/photos/${action.previousData.photoId}/draft-pins`, { pins: action.previousData.pins });
        return { type: "restore-draft-pins", sessionId: action.sessionId, entityId: action.entityId, data: action.previousData, previousData: action.data };
      }
      case "dismiss-duplicate": {
        await apiRequest("DELETE", `/api/sessions/${action.sessionId}/dismissed-duplicates`, { key: action.data.key });
        return { type: "undismiss-duplicate", sessionId: action.sessionId, entityId: 0, data: action.data, previousData: action.data };
      }
      case "undismiss-duplicate": {
        await apiRequest("POST", `/api/sessions/${action.sessionId}/dismissed-duplicates`, { key: action.data.key });
        return { type: "dismiss-duplicate", sessionId: action.sessionId, entityId: 0, data: action.data, previousData: action.data };
      }
      case "flag-pin": {
        await apiRequest("PATCH", `/api/pins/${action.entityId}/flag`, { flagged: false, flagReason: null });
        return { type: "unflag-pin", sessionId: action.sessionId, entityId: action.entityId, data: { flagged: false, flagReason: null }, previousData: action.data };
      }
      case "unflag-pin": {
        await apiRequest("PATCH", `/api/pins/${action.entityId}/flag`, { flagged: true, flagReason: action.previousData?.flagReason ?? null });
        return { type: "flag-pin", sessionId: action.sessionId, entityId: action.entityId, data: { flagged: true, flagReason: action.previousData?.flagReason ?? null }, previousData: { flagged: false, flagReason: null } };
      }
      case "delete-photo": {
        const res = await apiRequest("POST", `/api/sessions/${action.sessionId}/photos/restore`, { ...action.previousData, oldPhotoId: action.entityId });
        const created = await res.json();
        return { type: "duplicate-photo", sessionId: action.sessionId, entityId: created.id, data: action.previousData, previousData: action.previousData };
      }
      case "duplicate-photo": {
        await apiRequest("DELETE", `/api/photos/${action.entityId}?keepFile=1`);
        return { type: "delete-photo", sessionId: action.sessionId, entityId: action.entityId, data: action.data, previousData: action.data };
      }
      case "update-photo": {
        await apiRequest("PATCH", `/api/photos/${action.entityId}`, action.previousData);
        return { type: "update-photo", sessionId: action.sessionId, entityId: action.entityId, data: action.previousData, previousData: action.data };
      }
      case "update-session": {
        const res = await apiRequest("PATCH", `/api/sessions/${action.sessionId}`, { ...action.previousData, expectedLastUpdatedAt: action.data?.expectedLastUpdatedAt });
        const updated = await res.json().catch(() => null);
        return { type: "update-session", sessionId: action.sessionId, entityId: action.entityId, data: { ...action.previousData, expectedLastUpdatedAt: updated?.lastUpdatedAt }, previousData: action.data };
      }
      case "lock-session": {
        const newLocked = !action.data.locked;
        await apiRequest("POST", `/api/sessions/${action.sessionId}/lock`, { locked: newLocked });
        return { type: "lock-session", sessionId: action.sessionId, entityId: 0, data: { locked: newLocked }, previousData: action.data };
      }
      case "create-comment": {
        await apiRequest("DELETE", `/api/comments/${action.entityId}`);
        return { type: "delete-comment", sessionId: action.sessionId, entityId: action.entityId, data: action.data, previousData: action.data };
      }
      case "delete-comment": {
        const res = await apiRequest("POST", `/api/sessions/${action.sessionId}/comments`, action.previousData);
        const created = await res.json();
        return { type: "create-comment", sessionId: action.sessionId, entityId: created.id, data: action.previousData };
      }
      case "update-comment": {
        await apiRequest("PATCH", `/api/comments/${action.entityId}`, { text: action.previousData.text });
        return { type: "update-comment", sessionId: action.sessionId, entityId: action.entityId, data: action.previousData, previousData: action.data };
      }
    }
  }, []);

  // Action types whose reverse operation is safe to route through the existing
  // offline queue. Today only entry create/restore is queue-safe, because the
  // shared offline queue (offlineQueue.ts) is built around POST /entries.
  const isQueueSafeOffline = (action: UndoAction): boolean =>
    action.type === "delete-entry" && !!action.previousData;

  const optimisticallyApplyOffline = useCallback((action: UndoAction, placeholderId: number) => {
    if (action.type === "delete-entry" && action.previousData) {
      // Restore the deleted entry locally with the placeholder id so the UI
      // reflects the undo immediately while offline. The real id arrives
      // when the queued create replays after reconnect.
      const entriesKey = ["/api/sessions", action.sessionId.toString(), "entries"];
      const placeholder = {
        ...action.previousData,
        id: placeholderId,
        sessionId: action.sessionId,
      };
      queryClient.setQueryData<any[]>(entriesKey, (prev) => {
        if (!Array.isArray(prev)) return prev;
        return [...prev, placeholder];
      });
    }
  }, []);

  const tryQueueOffline = useCallback(async (action: UndoAction): Promise<number | false> => {
    if (!isQueueSafeOffline(action)) return false;
    if (action.type === "delete-entry") {
      const result = await createEntryWithOfflineFallback(action.sessionId, action.previousData);
      const placeholderId = result.placeholderId ?? result.entry.id;
      optimisticallyApplyOffline(action, placeholderId);
      return placeholderId;
    }
    return false;
  }, [optimisticallyApplyOffline]);

  const performStep = useCallback(async (
    action: UndoAction,
    direction: "undo" | "redo",
  ) => {
    const verb = direction === "undo" ? "Undo" : "Redo";

    if (!navigator.onLine) {
      try {
        const placeholderId = await tryQueueOffline(action);
        if (placeholderId !== false) {
          // Push a placeholder reverse action onto the opposite stack so the
          // user can redo once the queue syncs and the placeholder id is patched
          // to the real server-assigned id via the reelcounter:entry-synced event.
          const reverseAction: UndoAction = {
            type: "create-entry",
            sessionId: action.sessionId,
            entityId: placeholderId,
            data: action.previousData,
          };
          if (direction === "undo") {
            setUndoStack(prev => prev.slice(0, -1));
            setRedoStack(prev => [...prev.slice(-(MAX_STACK - 1)), reverseAction]);
          } else {
            setRedoStack(prev => prev.slice(0, -1));
            setUndoStack(prev => [...prev.slice(-(MAX_STACK - 1)), reverseAction]);
          }
          invalidateSession(action.type);
          toast({
            title: `${verb} queued`,
            description: "You're offline. The change will sync when you're back online.",
          });
        } else {
          toast({
            title: `Can't ${verb.toLowerCase()} while offline`,
            description: "This action can't be queued. Reconnect and try again.",
            variant: "destructive",
          });
        }
      } catch (err) {
        toast({
          title: `${verb} failed`,
          description: errorMessage(err, "Could not queue this action."),
          variant: "destructive",
        });
      }
      return;
    }

    try {
      const reversed = await applyReverse(action);
      if (direction === "undo") {
        setUndoStack(prev => prev.slice(0, -1));
        setRedoStack(prev => [...prev.slice(-(MAX_STACK - 1)), reversed]);
      } else {
        setRedoStack(prev => prev.slice(0, -1));
        setUndoStack(prev => [...prev.slice(-(MAX_STACK - 1)), reversed]);
      }
      invalidateSession(action.type);
    } catch (err) {
      if (isNetworkFailure(err)) {
        try {
          const placeholderId = await tryQueueOffline(action);
          if (placeholderId !== false) {
            const reverseAction: UndoAction = {
              type: "create-entry",
              sessionId: action.sessionId,
              entityId: placeholderId,
              data: action.previousData,
            };
            if (direction === "undo") {
              setUndoStack(prev => prev.slice(0, -1));
              setRedoStack(prev => [...prev.slice(-(MAX_STACK - 1)), reverseAction]);
            } else {
              setRedoStack(prev => prev.slice(0, -1));
              setUndoStack(prev => [...prev.slice(-(MAX_STACK - 1)), reverseAction]);
            }
            invalidateSession(action.type);
            toast({
              title: `${verb} queued`,
              description: "You're offline. The change will sync when you're back online.",
            });
            return;
          }
        } catch (queueErr) {
          toast({
            title: `${verb} failed`,
            description: errorMessage(queueErr, "Could not queue this action."),
            variant: "destructive",
          });
          return;
        }
        toast({
          title: `Can't ${verb.toLowerCase()} while offline`,
          description: "This action can't be queued. Reconnect and try again.",
          variant: "destructive",
        });
        return;
      }
      // Server-side or other failure: leave the stacks unchanged so the
      // action remains available to retry, and inform the user.
      toast({
        title: `${verb} failed`,
        description: errorMessage(err, "The server rejected this change."),
        variant: "destructive",
      });
    }
  }, [applyReverse, invalidateSession, toast, tryQueueOffline]);

  // When the offline queue replays a queued entry create and gets the real
  // server-assigned id, update any undo/redo action that still holds the
  // placeholder id so subsequent redo (or undo) targets the correct entry.
  // sessionStorage is updated via the persistence useEffects that run after
  // the state setters are called.
  useEffect(() => {
    const handler = (e: Event) => {
      const { placeholderId, realId } = (
        e as CustomEvent<{ placeholderId: number; realId: number; sessionId: number }>
      ).detail;
      const patch = (a: UndoAction): UndoAction =>
        a.entityId === placeholderId ? { ...a, entityId: realId } : a;
      setUndoStack(prev => prev.map(patch));
      setRedoStack(prev => prev.map(patch));
      // Also update the optimistic cache entry so the row id matches the real one.
      queryClient.setQueryData<any[]>(
        ["/api/sessions", sessionId.toString(), "entries"],
        (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map(entry =>
            entry.id === placeholderId ? { ...entry, id: realId } : entry,
          );
        },
      );
    };
    window.addEventListener("reelcounter:entry-synced", handler);
    return () => window.removeEventListener("reelcounter:entry-synced", handler);
  }, [sessionId]);

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    const action = undoStack[undoStack.length - 1];
    if (!action) return;
    busyRef.current = true;
    try {
      await performStep(action, "undo");
    } finally {
      busyRef.current = false;
    }
  }, [undoStack, performStep]);

  const redo = useCallback(async () => {
    if (busyRef.current) return;
    const action = redoStack[redoStack.length - 1];
    if (!action) return;
    busyRef.current = true;
    try {
      await performStep(action, "redo");
    } finally {
      busyRef.current = false;
    }
  }, [redoStack, performStep]);

  return {
    pushUndo,
    clearHistory,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
  };
}
