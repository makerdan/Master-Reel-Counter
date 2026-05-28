import { createContext, useContext, useState, useCallback, useRef, createElement, type ReactNode } from "react";

export interface WsReconnectState {
  wsStatus: string;
  reconnectCountdown: number | null;
}

export interface WsReconnectContextValue extends WsReconnectState {
  setWsReconnect: (wsStatus: string, countdown: number | null) => void;
  forceReconnect: (() => void) | null;
  setForceReconnect: (fn: (() => void) | null) => void;
}

export const WsReconnectContext = createContext<WsReconnectContextValue>({
  wsStatus: "connected",
  reconnectCountdown: null,
  setWsReconnect: () => {},
  forceReconnect: null,
  setForceReconnect: () => {},
});

export function useWsReconnect() {
  return useContext(WsReconnectContext);
}

export function WsReconnectProvider({ children }: { children: ReactNode }) {
  const [wsStatus, setWsStatus] = useState("connected");
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null);
  const forceReconnectRef = useRef<(() => void) | null>(null);
  const [, forceUpdate] = useState(0);

  const setWsReconnect = useCallback((status: string, countdown: number | null) => {
    setWsStatus(status);
    setReconnectCountdown(countdown);
  }, []);

  const setForceReconnect = useCallback((fn: (() => void) | null) => {
    forceReconnectRef.current = fn;
    forceUpdate(n => n + 1);
  }, []);

  const forceReconnect = forceReconnectRef.current;

  return createElement(WsReconnectContext.Provider, {
    value: { wsStatus, reconnectCountdown, setWsReconnect, forceReconnect, setForceReconnect },
    children,
  });
}
