import { useState, useEffect } from "react";
import { WifiOff, Loader2, CloudUpload, AlertTriangle, RefreshCw, X, ChevronDown, ChevronUp } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { useAuth } from "@/hooks/use-auth";

function entryLabel(data: Record<string, unknown>): string {
  const parts: string[] = [];
  if (data.aisle) parts.push(String(data.aisle));
  if (data.section) parts.push(String(data.section));
  const loc = parts.join("/");
  const cat = data.category ? String(data.category) : null;
  const ft = data.footage != null ? `${data.footage}ft` : null;
  const detail = [cat, ft].filter(Boolean).join(" · ");
  return [loc, detail].filter(Boolean).join(" — ") || "Unknown entry";
}

// ---------------------------------------------------------------------------
// Module-level WS reconnect state store.
// session.tsx calls setWsReconnectState() to push live countdown updates.
// NetworkStatusIndicator subscribes via useWsReconnectState().
// ---------------------------------------------------------------------------
interface WsReconnectState {
  wsStatus: string;
  countdown: number | null;
}
let _wsReconnect: WsReconnectState = { wsStatus: "connected", countdown: null };
const _wsListeners = new Set<() => void>();

export function setWsReconnectState(wsStatus: string, countdown: number | null) {
  _wsReconnect = { wsStatus, countdown };
  _wsListeners.forEach((fn) => fn());
}

function useWsReconnectState(): WsReconnectState {
  const [state, setState] = useState<WsReconnectState>(_wsReconnect);
  useEffect(() => {
    const handler = () => setState({ ..._wsReconnect });
    _wsListeners.add(handler);
    return () => { _wsListeners.delete(handler); };
  }, []);
  return state;
}

export function NetworkStatusIndicator() {
  const { user } = useAuth();
  const { isOnline, pendingCount, isSyncing, entryRetryAttempt, permanentlyFailedCount, retryAllFailedEntries, failedEntries } = useNetworkStatus(user?.id);
  const { wsStatus, countdown: reconnectCountdown } = useWsReconnectState();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const hasRetryingEntries = isSyncing && entryRetryAttempt !== null;
  const hasPermanentFailures = !isSyncing && permanentlyFailedCount > 0;
  const isWsReconnecting = wsStatus === "reconnecting";

  // Auto-show details panel when new failures arrive.
  useEffect(() => {
    if (failedEntries.length > 0) {
      setDismissed(false);
      setExpanded(true);
    }
  }, [failedEntries.length]);

  // Collapse when all failures are resolved.
  useEffect(() => {
    if (failedEntries.length === 0) {
      setExpanded(false);
      setDismissed(false);
    }
  }, [failedEntries.length]);

  if (isOnline && pendingCount === 0 && !isSyncing && !hasPermanentFailures && !isWsReconnecting) {
    return null;
  }

  const showPanel = hasPermanentFailures && expanded && !dismissed;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col items-start gap-2" data-testid="network-status-container">
      {/* Expanded failure detail panel */}
      {showPanel && (
        <div
          className="w-72 rounded-lg border border-destructive/30 bg-background shadow-xl"
          data-testid="panel-sync-failures"
        >
          <div className="flex items-center justify-between gap-2 border-b border-destructive/20 px-3 py-2">
            <div className="flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs font-semibold">
                {permanentlyFailedCount} entr{permanentlyFailedCount === 1 ? "y" : "ies"} failed to sync
              </span>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-dismiss-failure-panel"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <ul className="max-h-48 overflow-y-auto divide-y divide-border/50" data-testid="list-failed-entries">
            {failedEntries.map((entry) => (
              <li key={entry.id} className="px-3 py-2" data-testid={`item-failed-entry-${entry.id}`}>
                <p className="text-xs font-medium text-foreground leading-snug">
                  Session {entry.sessionId} · {entryLabel(entry.data)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{entry.reason}</p>
              </li>
            ))}
          </ul>

          <div className="border-t border-destructive/20 px-3 py-2">
            <button
              onClick={() => { retryAllFailedEntries(); setExpanded(false); }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
              data-testid="button-retry-all-failed"
            >
              <RefreshCw className="h-3 w-3" />
              Retry All
            </button>
          </div>
        </div>
      )}

      {/* Status pill */}
      <div
        data-testid="network-status-indicator"
        className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg transition-all ${
          hasPermanentFailures
            ? "bg-destructive text-destructive-foreground cursor-pointer"
            : isOnline
            ? "bg-primary text-primary-foreground"
            : "bg-destructive text-destructive-foreground"
        }`}
        onClick={hasPermanentFailures ? () => { setExpanded(e => !e); setDismissed(false); } : undefined}
      >
        {!isOnline && (
          <>
            <WifiOff className="h-3.5 w-3.5" />
            <span data-testid="text-offline-status">Offline</span>
          </>
        )}
        {isOnline && isWsReconnecting && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span data-testid="text-ws-reconnecting-mobile">
              {reconnectCountdown !== null
                ? `Reconnecting in ${reconnectCountdown}s…`
                : "Reconnecting…"}
            </span>
          </>
        )}
        {isOnline && !isWsReconnecting && hasRetryingEntries && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span data-testid="text-retrying-entry-status">
              Retrying entry sync (attempt {entryRetryAttempt} of {3})...
            </span>
          </>
        )}
        {isOnline && !isWsReconnecting && isSyncing && !hasRetryingEntries && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span data-testid="text-syncing-status">Syncing...</span>
          </>
        )}
        {isOnline && hasPermanentFailures && (
          <>
            <AlertTriangle className="h-3.5 w-3.5" />
            <span data-testid="text-entry-sync-failed">
              {permanentlyFailedCount} entr{permanentlyFailedCount === 1 ? "y" : "ies"} failed to sync
            </span>
            {expanded && !dismissed
              ? <ChevronDown className="h-3 w-3 ml-0.5" />
              : <ChevronUp className="h-3 w-3 ml-0.5" />
            }
          </>
        )}
        {isOnline && !isWsReconnecting && !isSyncing && !hasPermanentFailures && pendingCount > 0 && (
          <>
            <CloudUpload className="h-3.5 w-3.5" />
            <span data-testid="text-pending-status">
              {pendingCount} pending
            </span>
          </>
        )}
        {pendingCount > 0 && !isOnline && (
          <span
            className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]"
            data-testid="text-pending-count"
          >
            {pendingCount}
          </span>
        )}
      </div>
    </div>
  );
}
