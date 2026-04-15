import { useState, useCallback, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ActionType = "create-entry" | "update-entry" | "delete-entry" | "create-pin" | "update-pin" | "delete-pin" | "restore-draft-pins" | "dismiss-duplicate" | "undismiss-duplicate" | "flag-pin" | "unflag-pin" | "delete-photo" | "duplicate-photo" | "update-photo" | "update-session" | "lock-session" | "create-comment" | "update-comment" | "delete-comment";

interface UndoAction {
  type: ActionType;
  sessionId: number;
  entityId: number;
  data: any;
  previousData?: any;
}

const MAX_STACK = 20;

export function useUndoRedo(sessionId: number) {
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);
  const busyRef = useRef(false);

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
        await apiRequest("PATCH", `/api/sessions/${action.sessionId}`, action.previousData);
        return { type: "update-session", sessionId: action.sessionId, entityId: action.entityId, data: action.previousData, previousData: action.data };
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

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    const action = undoStack[undoStack.length - 1];
    if (!action) return;
    busyRef.current = true;

    try {
      const reversed = await applyReverse(action);
      setUndoStack(prev => prev.slice(0, -1));
      setRedoStack(prev => [...prev.slice(-(MAX_STACK - 1)), reversed]);
      invalidateSession(action.type);
    } catch {
    } finally {
      busyRef.current = false;
    }
  }, [undoStack, invalidateSession, applyReverse]);

  const redo = useCallback(async () => {
    if (busyRef.current) return;
    const action = redoStack[redoStack.length - 1];
    if (!action) return;
    busyRef.current = true;

    try {
      const reversed = await applyReverse(action);
      setRedoStack(prev => prev.slice(0, -1));
      setUndoStack(prev => [...prev.slice(-(MAX_STACK - 1)), reversed]);
      invalidateSession(action.type);
    } catch {
    } finally {
      busyRef.current = false;
    }
  }, [redoStack, invalidateSession, applyReverse]);

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
