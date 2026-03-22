import { Wifi, WifiOff, Loader2, CloudUpload } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";

export function NetworkStatusIndicator() {
  const { isOnline, pendingCount, isSyncing } = useNetworkStatus();

  if (isOnline && pendingCount === 0 && !isSyncing) {
    return null;
  }

  return (
    <div
      data-testid="network-status-indicator"
      className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg transition-all ${
        isOnline
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
      {isOnline && isSyncing && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span data-testid="text-syncing-status">Syncing...</span>
        </>
      )}
      {isOnline && !isSyncing && pendingCount > 0 && (
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
