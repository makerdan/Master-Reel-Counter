import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, FileText, Camera, MapPin, MessageSquare, User, AlertTriangle, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTimezone } from "@/hooks/use-timezone";
import { formatDateOnly, formatTimestamp } from "@/lib/timezone";

interface ActivityLogEntry {
  id: number;
  sessionId: number;
  userId: string;
  username: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: string | null;
  createdAt: string;
}

const ACTION_CONFIG: Record<string, { icon: typeof FileText; label: string; color: string }> = {
  entry_created: { icon: FileText, label: "Added entry", color: "text-green-500" },
  entry_updated: { icon: FileText, label: "Updated entry", color: "text-blue-500" },
  entry_deleted: { icon: FileText, label: "Deleted entry", color: "text-red-500" },
  photo_uploaded: { icon: Camera, label: "Uploaded photo", color: "text-purple-500" },
  photo_deleted: { icon: Camera, label: "Deleted photo", color: "text-red-500" },
  pin_created: { icon: MapPin, label: "Placed pin", color: "text-orange-500" },
  pin_committed: { icon: MapPin, label: "Committed pin", color: "text-green-500" },
  comment_added: { icon: MessageSquare, label: "Commented", color: "text-blue-500" },
  status_changed: { icon: Clock, label: "Status changed", color: "text-yellow-500" },
  collaborator_added: { icon: User, label: "Added team member", color: "text-green-500" },
  collaborator_removed: { icon: User, label: "Removed team member", color: "text-red-500" },
};

function formatTimeAgo(dateStr: string, tz: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateOnly(date, tz);
}

export default function ActivityLog({ sessionId }: { sessionId: number }) {
  const tz = useTimezone();
  const { data: logs = [], isLoading, isError: logsError } = useQuery<ActivityLogEntry[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "activity"],
    refetchInterval: 30000,
  });
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  if (logsError) {
    return (
      <div className="p-4 text-center">
        <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-destructive" />
        <p className="text-xs text-muted-foreground">Failed to load activity log</p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="p-4 text-center">
        <Clock className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">No activity yet</p>
      </div>
    );
  }

  const copyAll = () => {
    const lines = logs.map((log) => {
      const config = ACTION_CONFIG[log.action] || { label: log.action };
      const timestamp = formatTimestamp(log.createdAt, tz, {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
      const parts = [
        log.username || "Unknown",
        config.label,
        log.details || "",
        timestamp,
      ];
      return parts.filter(Boolean).join(" | ");
    });
    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div>
      <div className="flex justify-end px-2 py-1">
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={copyAll} data-testid="button-copy-activity">
          {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy All</>}
        </Button>
      </div>
      <div className="space-y-0.5 max-h-[400px] overflow-y-auto" data-testid="activity-log-list">
      {logs.map((log) => {
        const config = ACTION_CONFIG[log.action] || { icon: Clock, label: log.action, color: "text-muted-foreground" };
        const Icon = config.icon;
        return (
          <div key={log.id} className="flex items-start gap-2 px-2 py-1.5 hover:bg-muted/50 rounded-sm" data-testid={`activity-${log.id}`}>
            <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${config.color}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs leading-tight">
                <span className="font-medium">{log.username || "Unknown"}</span>
                {" "}
                <span className="text-muted-foreground">{config.label}</span>
                {log.details && <span className="text-muted-foreground"> — {log.details}</span>}
              </p>
              <span className="text-[10px] text-muted-foreground mono">{formatTimeAgo(log.createdAt, tz)}</span>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
