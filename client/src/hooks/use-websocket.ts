import { useEffect, useRef, useCallback, useState } from "react";
import { queryClient } from "@/lib/queryClient";

type MessageHandler = (msg: any) => void;
export type WsStatus = "connecting" | "connected" | "reconnecting";

const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_CAP_MS = 30_000;
const WS_RECONNECT_JITTER_MS = 500;
const WS_BUFFER_MAX = 20;

export function useSessionWebSocket(
  sessionId: number | null,
  onMessage?: MessageHandler,
  userInfo?: { userId: string; username: string },
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelayRef = useRef(WS_RECONNECT_BASE_MS);
  const pendingBufferRef = useRef<string[]>([]);
  const hasEverConnectedRef = useRef(false);
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [reconnectDelayMs, setReconnectDelayMs] = useState<number | null>(null);

  const safeSend = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      if (pendingBufferRef.current.length < WS_BUFFER_MAX) {
        pendingBufferRef.current.push(data);
      }
    }
  }, []);

  const connect = useCallback(() => {
    if (!sessionId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectDelayRef.current = WS_RECONNECT_BASE_MS;
      hasEverConnectedRef.current = true;
      setWsStatus("connected");
      setReconnectDelayMs(null);
      // Drain the pre-open buffer first, then send the join frame.
      // safeSend is used for all sends so the guard path is consistent even
      // though readyState is guaranteed OPEN inside onopen.
      const buffered = pendingBufferRef.current.splice(0);
      for (const msg of buffered) {
        safeSend(msg);
      }
      safeSend(JSON.stringify({ type: "join", sessionId, userId: userInfo?.userId, username: userInfo?.username }));
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
            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sid, "incomplete-pins"] });
          } else if (msg.entity === "scan_results") {
            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sid, "scan-results"] });
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
      const jitter = (Math.random() * 2 - 1) * WS_RECONNECT_JITTER_MS;
      const delay = Math.min(reconnectDelayRef.current + jitter, WS_RECONNECT_CAP_MS);
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, WS_RECONNECT_CAP_MS);
      const actualDelay = Math.max(delay, WS_RECONNECT_BASE_MS);
      if (hasEverConnectedRef.current) {
        setWsStatus("reconnecting");
        setReconnectDelayMs(actualDelay);
      }
      reconnectTimerRef.current = setTimeout(connect, actualDelay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [sessionId, onMessage, userInfo?.userId, userInfo?.username]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const sendMessage = useCallback((data: object) => {
    safeSend(JSON.stringify(data));
  }, [safeSend]);

  return { wsRef, sendMessage, wsStatus, reconnectDelayMs };
}
