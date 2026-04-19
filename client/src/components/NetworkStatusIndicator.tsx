import { WifiOff, Loader2, CloudUpload, AlertTriangle, RefreshCw } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";

export function NetworkStatusIndicator() {
  const { isOnline, pendingCount, isSyncing, entryRetryAttempt, permanentlyFailedCount, retryAllFailedEntries } = useNetworkStatus();

  const hasRetryingEntries = isSyncing && entryRetryAttempt !== null;
  const hasPermanentFailures = !isSyncing && permanentlyFailedCount > 0;

  if (isOnline && pendingCount === 0 && !isSyncing && !hasPermanentFailures) {
    return null;
  }

  return (
    <div
      data-testid="network-status-indicator"
      className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg transition-all ${
        hasPermanentFailures
          ? "bg-destructive text-destructive-foreground"
          : isOnline
          ? "bg-primary text-primary-foreground"
          : "bg-destructive text-destructive-foreground"
      }`}
    >
      {!isOnline && (
        <>
          <WifiOff className="h-3.5 w-3.5" />
          <span data-testid="text-offline-status">Offline</span>
        </>
      )}
      {isOnline && hasRetryingEntries && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span data-testid="text-retrying-entry-status">
            Retrying entry sync (attempt {entryRetryAttempt} of {3})...
          </span>
        </>
      )}
      {isOnline && isSyncing && !hasRetryingEntries && (
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
          <button
            onClick={retryAllFailedEntries}
            className="ml-1 flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] hover:bg-white/30 transition-colors"
            data-testid="button-retry-failed-entries"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Retry
          </button>
        </>
      )}
      {isOnline && !isSyncing && !hasPermanentFailures && pendingCount > 0 && (
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
  );
}
