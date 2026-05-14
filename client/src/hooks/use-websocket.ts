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

  // Two-level reconnect guard:
  //
  // 1. shouldReconnectRef  – set to false on intentional teardown (unmount or
  //    session change). Prevents scheduling any reconnect when the component is
  //    done with the current socket altogether.
  //
  // 2. connectionIdRef     – monotonically incremented each time connect() is
  //    called. Each WebSocket closure captures its own snapshot (`myId`). The
  //    onclose handler compares myId to the current ref; if they differ, a new
  //    socket is already active so the old onclose silently returns without
  //    scheduling a reconnect. This closes the race where cleanup sets
  //    shouldReconnectRef=false but the new effect immediately sets it back to
  //    true before the old socket's async onclose fires.
  const shouldReconnectRef = useRef(true);
  const connectionIdRef = useRef(0);

  // Stable refs for callbacks and user info — updated every render so the
  // connect callback always reads the latest values without those values
  // appearing in the effect dependency array (which would trigger reconnects
  // every time the parent re-renders with a new function or object literal).
  const onMessageRef = useRef(onMessage);
  const userInfoRef = useRef(userInfo);
  onMessageRef.current = onMessage;
  userInfoRef.current = userInfo;

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

  // connect is keyed only on sessionId (and the stable safeSend). Callbacks
  // (onMessage, userInfo) are read from refs so they never cause reconnects.
  const connect = useCallback(() => {
    if (!sessionId) return;

    // Capture a connection-specific ID so this socket's onclose can detect
    // whether it has been superseded by a newer connection.
    const myId = ++connectionIdRef.current;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectDelayRef.current = WS_RECONNECT_BASE_MS;
      hasEverConnectedRef.current = true;
      setWsStatus("connected");
      setReconnectDelayMs(null);
      // Send join first so the server registers room membership before any
      // buffered messages arrive — buffered messages may require room context.
      // Read userInfo from the ref to avoid stale closures.
      const ui = userInfoRef.current;
      safeSend(JSON.stringify({ type: "join", sessionId, userId: ui?.userId, username: ui?.username }));
      const buffered = pendingBufferRef.current.splice(0);
      for (const msg of buffered) {
        safeSend(msg);
      }
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
        // Read handler from ref so parent can swap it without causing reconnects.
        onMessageRef.current?.(msg);
      } catch {}
    };

    ws.onclose = () => {
      // Guard 1: if a newer connection has already been established, this
      // onclose belongs to a superseded socket — do nothing.
      if (myId !== connectionIdRef.current) return;
      // Guard 2: intentional teardown (unmount) — do not reconnect.
      if (!shouldReconnectRef.current) return;

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
  }, [sessionId, safeSend]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    return () => {
      // Signal onclose that this teardown is intentional so it skips reconnect.
      // connectionIdRef is incremented at the start of the next connect() call,
      // which invalidates any pending onclose from the socket we close here.
      shouldReconnectRef.current = false;
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
