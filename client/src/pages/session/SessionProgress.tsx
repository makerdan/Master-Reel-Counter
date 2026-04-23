import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, MapPin, CheckCircle2, Flag, CircleDot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Entry, Pin, ReviewResponse } from "@shared/schema";

function MetricBar({ label, icon: Icon, current, total, colorClass }: {
  label: string;
  icon: typeof MapPin;
  current: number;
  total?: number;
  colorClass: string;
}) {
  const hasTotal = total !== undefined && total > 0;
  const pct = hasTotal ? Math.round((current / total) * 100) : 0;
  return (
    <div className="flex-1 min-w-[140px]" data-testid={`progress-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold ml-auto">{hasTotal ? `${current}/${total}` : current}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colorClass}`}
          style={{ width: hasTotal ? `${pct}%` : (current > 0 ? "100%" : "0%") }}
          data-testid={`progress-bar-${label.toLowerCase().replace(/\s+/g, "-")}`}
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

  const metrics = useMemo(() => {
    const totalPins = pins.length;
    const activePins = pins.filter(p => !p.entryId).length;
    const committedPins = pins.filter(p => !!p.entryId).length;

    const approvedEntryIds = new Set(
      reviewResponses.filter(r => r.verdict === "approved").map(r => r.entryId)
    );
    const reviewed = entries.filter(e => approvedEntryIds.has(e.id)).length;

    const flaggedPinIds = new Set(
      pins.filter(p => p.flagged).map(p => p.id)
    );
    const flaggedReviewEntryIds = new Set(
      reviewResponses.filter(r => r.verdict === "flagged").map(r => r.entryId)
    );
    const flaggedFromReviews = entries.filter(e => flaggedReviewEntryIds.has(e.id)).length;
    const flaggedTotal = flaggedPinIds.size + flaggedFromReviews;

    return { totalPins, activePins, committedPins, reviewed, flaggedTotal };
  }, [entries, pins, reviewResponses]);

  const totalPins = metrics.totalPins;
  if (totalPins === 0 && entries.length === 0) return null;

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
            {metrics.activePins} active · {metrics.committedPins} committed · {metrics.reviewed} reviewed
          </span>
        )}
      </button>
      {!collapsed && (
        <CardContent className="pt-0 pb-3 px-3">
          <div className="flex flex-wrap gap-4">
            <MetricBar
              label="Active Pins"
              icon={CircleDot}
              current={metrics.activePins}
              total={metrics.totalPins}
              colorClass="bg-blue-500"
            />
            <MetricBar
              label="Committed Pins"
              icon={MapPin}
              current={metrics.committedPins}
              total={metrics.totalPins}
              colorClass="bg-green-500"
            />
            <MetricBar
              label="Reviewed"
              icon={CheckCircle2}
              current={metrics.reviewed}
              total={metrics.totalPins}
              colorClass="bg-purple-500"
            />
            <MetricBar
              label="Flagged"
              icon={Flag}
              current={metrics.flaggedTotal}
              colorClass="bg-amber-500"
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
