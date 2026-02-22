import { useEffect, useRef, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";

type MessageHandler = (msg: any) => void;

export function useSessionWebSocket(sessionId: number | null, onMessage?: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (!sessionId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", sessionId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "sync") {
          const sid = msg.sessionId?.toString() || sessionId.toString();
          if (msg.entity === "entries") {
            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sid, "entries"] });
          } else if (msg.entity === "photos") {
            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sid, "photos"] });
          } else if (msg.entity === "pins") {
            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sid, "pins"] });
          }
        } else if (msg.type === "comment") {
          queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "comments"] });
        } else if (msg.type === "activity") {
          queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "activity"] });
        }
        onMessage?.(msg);
      } catch {}
    };

    ws.onclose = () => {
      reconnectTimerRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [sessionId, onMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return wsRef;
}
