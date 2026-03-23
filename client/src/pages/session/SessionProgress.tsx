import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Camera, Tag, CheckCircle2, Flag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Entry, Pin, ReviewResponse } from "@shared/schema";

function ProgressBar({ label, icon: Icon, current, total, colorClass }: {
  label: string;
  icon: typeof Camera;
  current: number;
  total: number;
  colorClass: string;
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="flex-1 min-w-[140px]" data-testid={`progress-${label.toLowerCase()}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold ml-auto">{current}/{total}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: `${pct}%` }}
          data-testid={`progress-bar-${label.toLowerCase()}`}
        />
      </div>
    </div>
  );
}

export default function SessionProgress({
  entries,
  pins,
  sessionId,
}: {
  entries: Entry[];
  pins: Pin[];
  sessionId: number;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("session-progress-collapsed") === "1";
    } catch {
      return false;
    }
  });

  const { data: reviewResponses = [] } = useQuery<ReviewResponse[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "review-responses"],
    enabled: sessionId > 0,
  });

  const pinByEntryId = useMemo(
    () => new Map(pins.filter(p => p.entryId).map(p => [p.entryId!, p])),
    [pins]
  );

  const metrics = useMemo(() => {
    const total = entries.length;
    const pinned = entries.filter(e => pinByEntryId.has(e.id)).length;
    const tagged = entries.filter(e => e.wireType && e.gauge && e.footage).length;

    const reviewedEntryIds = new Set(reviewResponses.map(r => r.entryId));
    const reviewed = entries.filter(e => reviewedEntryIds.has(e.id)).length;

    const flaggedPinEntryIds = new Set(
      pins.filter(p => p.flagged && p.entryId).map(p => p.entryId!)
    );
    const flaggedReviewEntryIds = new Set(
      reviewResponses.filter(r => r.verdict === "flagged").map(r => r.entryId)
    );
    const flagged = entries.filter(
      e => flaggedPinEntryIds.has(e.id) || flaggedReviewEntryIds.has(e.id)
    ).length;

    return { total, pinned, tagged, reviewed, flagged };
  }, [entries, pinByEntryId, reviewResponses, pins]);

  if (metrics.total === 0) return null;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("session-progress-collapsed", next ? "1" : "0"); } catch {}
  };

  return (
    <Card className="border-blue-200 dark:border-blue-800" data-testid="session-progress-panel">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={toggle}
        data-testid="btn-toggle-progress"
      >
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        <span className="text-sm font-semibold">Session Progress</span>
        {collapsed && (
          <span className="text-xs text-muted-foreground ml-auto">
            {metrics.pinned}/{metrics.total} pinned · {metrics.tagged}/{metrics.total} tagged
          </span>
        )}
      </button>
      {!collapsed && (
        <CardContent className="pt-0 pb-3 px-3">
          <div className="flex flex-wrap gap-4">
            <ProgressBar
              label="Pinned"
              icon={Camera}
              current={metrics.pinned}
              total={metrics.total}
              colorClass="bg-blue-500"
            />
            <ProgressBar
              label="Tagged"
              icon={Tag}
              current={metrics.tagged}
              total={metrics.total}
              colorClass="bg-green-500"
            />
            <ProgressBar
              label="Reviewed"
              icon={CheckCircle2}
              current={metrics.reviewed}
              total={metrics.total}
              colorClass="bg-purple-500"
            />
            <ProgressBar
              label="Flagged"
              icon={Flag}
              current={metrics.flagged}
              total={metrics.total}
              colorClass="bg-amber-500"
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
