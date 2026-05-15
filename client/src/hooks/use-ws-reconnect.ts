import { createContext, useContext, useState, useCallback, createElement, type ReactNode } from "react";

export interface WsReconnectState {
  wsStatus: string;
  reconnectCountdown: number | null;
}

export interface WsReconnectContextValue extends WsReconnectState {
  setWsReconnect: (wsStatus: string, countdown: number | null) => void;
}

export const WsReconnectContext = createContext<WsReconnectContextValue>({
  wsStatus: "connected",
  reconnectCountdown: null,
  setWsReconnect: () => {},
});

export function useWsReconnect() {
  return useContext(WsReconnectContext);
}

export function WsReconnectProvider({ children }: { children: ReactNode }) {
  const [wsStatus, setWsStatus] = useState("connected");
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null);

  const setWsReconnect = useCallback((status: string, countdown: number | null) => {
    setWsStatus(status);
    setReconnectCountdown(countdown);
  }, []);

  return createElement(WsReconnectContext.Provider, {
    value: { wsStatus, reconnectCountdown, setWsReconnect },
    children,
  });
}
