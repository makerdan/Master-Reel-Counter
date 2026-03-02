import { useState, useCallback, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ActionType = "create-entry" | "update-entry" | "delete-entry" | "create-pin" | "update-pin" | "delete-pin" | "restore-draft-pins";

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

  const invalidateSession = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
  }, [sessionId]);

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack(prev => [...prev.slice(-(MAX_STACK - 1)), action]);
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
      invalidateSession();
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
      invalidateSession();
    } catch {
    } finally {
      busyRef.current = false;
    }
  }, [redoStack, invalidateSession, applyReverse]);

  return {
    pushUndo,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
  };
}
