import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useIsMutating } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft, ArrowUp, Camera, Download, FileText, Mail, Undo2, Redo2,
  Lock, Check, Loader2, AlertTriangle, Flag, Users, TabletSmartphone, Monitor, Trash2, LayoutGrid, X, ClipboardCheck, BarChart2,
} from "lucide-react";
import { toDisplayUnit, unitLabel } from "@/lib/unit-conversion";
import { LAST_SESSION_KEY, sessionTabKey, PDF_EXPORT_QUALITY_KEY } from "@/lib/storageKeys";
import type { UnitType } from "@/lib/unit-conversion";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest, queryClient, parseApiErrorPayload } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import type { Session, Entry, Photo, Pin } from "@shared/schema";
import PhotoMode from "./session/PhotoMode";
import { ErrorBoundary } from "@/components/error-boundary";
import TeamDialog from "./session/TeamDialog";
import EntryTable from "./session/EntryTable";
import SingleEntryMode from "./session/SingleEntryMode";
import MobileCaptureView from "./session/MobileCaptureView";
import ActivityLog from "./session/ActivityLog";
import FlaggedReels from "./session/FlaggedReels";
import PhotoStrip from "./session/PhotoStrip";
import ReviewTab from "./session/ReviewTab";
import FinalResultsTab from "./session/FinalResultsTab";
import SessionProgress from "./session/SessionProgress";
import HelpMenu from "@/components/HelpMenu";
import { buildExportFilename } from "./session/utils";
import { useTimezone } from "@/hooks/use-timezone";
import { useWsReconnect } from "@/hooks/use-ws-reconnect";
import { formatSessionTimeWithTz, formatSessionTimeMobile, formatTimestamp } from "@/lib/timezone";
import { useUndoRedo } from "@/hooks/use-undo";
import { useSessionWebSocket } from "@/hooks/use-websocket";
import { useAuth } from "@/hooks/use-auth";

export default function SessionPage() {
  const [, params] = useRoute("/session/:id");
  const [, setLocation] = useLocation();
  const sessionId = params?.id ? parseInt(params.id) : 0;

  useEffect(() => {
    if (sessionId > 0) {
      try { localStorage.setItem(LAST_SESSION_KEY, String(sessionId)); } catch {}
    }
  }, [sessionId]);

  const { data: session, isLoading: sessionLoading, isError: sessionError } = useQuery<Session & { firstPhotoAt: string | null; lastPhotoAt: string | null; role: "owner" | "editor" | "viewer"; collaboratorCount: number }>({
    queryKey: ["/api/sessions", sessionId.toString()],
    enabled: sessionId > 0,
  });

  const { data: entries = [] } = useQuery<Entry[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "entries"],
    enabled: sessionId > 0,
  });

  const { data: photos = [], isFetching: photosFetching } = useQuery<Photo[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "photos"],
    enabled: sessionId > 0,
  });

  const retriedMissingPhotoIdsRef = useRef<string>("");
  useEffect(() => {
    retriedMissingPhotoIdsRef.current = "";
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId || photosFetching) return;
    if (!entries.length) {
      retriedMissingPhotoIdsRef.current = "";
      return;
    }
    const photoIds = new Set(photos.map((p) => p.id));
    const missingIds = entries
      .filter((e) => e.photoId && !photoIds.has(e.photoId))
      .map((e) => e.photoId!)
      .sort((a, b) => a - b);
    if (missingIds.length === 0) {
      retriedMissingPhotoIdsRef.current = "";
      return;
    }
    const signature = missingIds.join(",");
    if (signature === retriedMissingPhotoIdsRef.current) return;
    retriedMissingPhotoIdsRef.current = signature;
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
  }, [entries, photos, sessionId, photosFetching]);

  const { data: userSettings } = useQuery<{
    defaultExportFormat: string;
    companyName: string | null;
    exportFooterText: string | null;
    defaultUnit: string;
    testerPassword: string | null;
  }>({
    queryKey: ["/api/settings"],
  });

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm border border-destructive/30">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-destructive" />
            <p className="text-sm font-medium mb-1">Failed to load session</p>
            <p className="text-xs text-muted-foreground mb-4">There was a problem connecting to the server.</p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={() => setLocation("/")} data-testid="button-error-back" title="Back to dashboard">
                Back to Dashboard
              </Button>
              <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] })} data-testid="button-retry-session" title="Retry loading session">
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Session not found</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/")} title="Back to dashboard">
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <SessionWorkspace
      session={session}
      entries={entries}
      photos={photos}
      sessionId={sessionId}
      userSettings={userSettings}
    />
  );
}

function SessionWorkspace({
  session, entries, photos, sessionId, userSettings,
}: {
  session: Session & { role?: "owner" | "editor" | "viewer"; collaboratorCount?: number; firstPhotoAt?: string | null; lastPhotoAt?: string | null };
  entries: Entry[];
  photos: Photo[];
  sessionId: number;
  userSettings?: { defaultExportFormat: string; companyName: string | null; exportFooterText: string | null; defaultUnit: string; testerPassword?: string | null };
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const tz = useTimezone();
  const initialTab = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab === "single") return "photo";
      if (tab === "scanner") return "photo";
      if (tab && ["photo", "flagged", "strip", "review", "results"].includes(tab)) return tab;
      const stored = localStorage.getItem(sessionTabKey(sessionId));
      if (stored && ["photo", "flagged", "strip", "review", "results"].includes(stored)) return stored;
    } catch {}
    return "strip";
  })();
  const initialScanPanelOpen = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("tab") === "scanner";
    } catch { return false; }
  })();
  const [mode, setMode] = useState<string>(initialTab);
  const TAB_ORDER = ["strip", "photo", "flagged", "review", "results"];
  const tabSwipeRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const panActiveRef = useRef(false);
  const handleTabSwipeStart = useCallback((e: React.TouchEvent) => {
    if (panActiveRef.current) return;
    tabSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
  }, []);
  const handleTabSwipeEnd = useCallback((e: React.TouchEvent) => {
    const s = tabSwipeRef.current;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    const dt = Date.now() - s.time;
    tabSwipeRef.current = null;
    if (dt > 400 || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    setMode((prev) => {
      const ci = TAB_ORDER.indexOf(prev);
      if (dx < 0 && ci < TAB_ORDER.length - 1) return TAB_ORDER[ci + 1];
      if (dx > 0 && ci > 0) return TAB_ORDER[ci - 1];
      return prev;
    });
  }, []);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const editingEntryDirtyRef = useRef(false);
  const [unsavedChangesOpen, setUnsavedChangesOpen] = useState(false);
  const pendingNavActionRef = useRef<(() => void) | null>(null);

  const confirmUnsavedNav = (action: () => void) => {
    if (!editingEntryDirtyRef.current) { action(); return; }
    pendingNavActionRef.current = action;
    setUnsavedChangesOpen(true);
  };

  useEffect(() => {
    if (!editingEntry) return;
    const origPushState = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      if (editingEntryDirtyRef.current) {
        pendingNavActionRef.current = () => origPushState(...args);
        setUnsavedChangesOpen(true);
        return;
      }
      return origPushState(...args);
    };
    const trackedHref = { value: window.location.href };
    const guardActive = { value: false };
    const handlePopState = () => {
      if (guardActive.value || !editingEntryDirtyRef.current) {
        trackedHref.value = window.location.href;
        return;
      }
      const navigatedToHref = window.location.href;
      const prevHref = trackedHref.value;
      if (navigatedToHref === prevHref) return;
      origPushState(null, "", prevHref);
      guardActive.value = true;
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      guardActive.value = false;
      pendingNavActionRef.current = () => {
        trackedHref.value = navigatedToHref;
        origPushState(null, "", navigatedToHref);
        guardActive.value = true;
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
        guardActive.value = false;
      };
      setUnsavedChangesOpen(true);
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      history.pushState = origPushState;
    };
  }, [editingEntry?.id]);

  const [editPhotoLoaded, setEditPhotoLoaded] = useState(false);
  useEffect(() => { setEditPhotoLoaded(false); }, [editingEntry?.id]);
  const [pinRefreshSignal, setPinRefreshSignal] = useState(0);
  const triggerPinRefresh = useCallback(() => setPinRefreshSignal((s) => s + 1), []);
  const [editSessionOpen, setEditSessionOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [navigateToPhotoId, setNavigateToPhotoId] = useState<number | null>(null);
  const [navigateAisle, setNavigateAisle] = useState<string>("");
  const [navigateSection, setNavigateSection] = useState<string>("");
  const [navigateToPinId, setNavigateToPinId] = useState<number | null>(null);
  const [stripScrollToPhotoId, setStripScrollToPhotoId] = useState<number | null>(null);
  const syncedPhotoIdRef = useRef<number | null>(null);
  const lastPhotoModePhotoIdRef = useRef<number | null>(null);
  const photoModeFlushRef = useRef<(() => Promise<void>) | null>(null);
  const [editName, setEditName] = useState(session.name);
  const [editLocation, setEditLocation] = useState(session.location || "");
  const [editDescription, setEditDescription] = useState((session as any).description || "");

  useEffect(() => {
    const url = new URL(window.location.href);
    if (mode === "strip") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", mode);
    }
    window.history.replaceState({}, "", url.toString());
    try { localStorage.setItem(sessionTabKey(sessionId), mode); } catch {}
  }, [mode, sessionId]);

  const [captureMode, setCaptureMode] = useState(window.innerWidth < 768);
  const [mobileFlowKey, setMobileFlowKey] = useState(0);
  const [mobileFlowInitialAisle, setMobileFlowInitialAisle] = useState("");
  const [mobileFlowInitialSection, setMobileFlowInitialSection] = useState("");
  const [mobileFlowDetailParentPhotoId, setMobileFlowDetailParentPhotoId] = useState<number | null>(null);

  const [showActivity, setShowActivity] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("activity") === "1"; } catch { return false; }
  });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const { pushUndo, clearHistory, undo, redo, canUndo, canRedo, undoPendingSync, redoPendingSync } = useUndoRedo(sessionId);
  const [undoRedoSignal, setUndoRedoSignal] = useState(0);
  const [exclusiveExpandKey, setExclusiveExpandKey] = useState<string | undefined>(undefined);
  const undoWithSignal = useCallback(async () => { await undo(); setUndoRedoSignal(s => s + 1); }, [undo]);
  const redoWithSignal = useCallback(async () => { await redo(); setUndoRedoSignal(s => s + 1); }, [redo]);
  const undoWithSignalRef = useRef(undoWithSignal);
  useEffect(() => { undoWithSignalRef.current = undoWithSignal; }, [undoWithSignal]);

  const { data: sessionPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
    enabled: sessionId > 0,
  });
  const pinByEntryId = new Map(sessionPins.filter(p => p.entryId).map(p => [p.entryId!, p]));

  const { data: serverActiveTasks } = useQuery<{ pdf: boolean; excel: boolean; scan: boolean }>({
    queryKey: ["/api/sessions", sessionId.toString(), "active-tasks"],
    enabled: sessionId > 0,
    refetchInterval: 5000,
  });

  const isLocked = !!(session as any).isLocked;
  const isOwner = (session as any).role === "owner";
  const canEditSession = !isLocked || isOwner;

  const { user } = useAuth();
  const { setWsReconnect } = useWsReconnect();
  const [onlineUsers, setOnlineUsers] = useState<{ userId: string; username: string }[]>([]);

  const { wsStatus, reconnectDelayMs } = useSessionWebSocket(sessionId, (msg) => {
    if (msg.type === "presence") {
      setOnlineUsers(msg.users || []);
    }
  }, user ? { userId: (user as any).id, username: (user as any).firstName || (user as any).id } : undefined);

  // Live countdown: ticks once per second from the initial reconnect delay down to 0,
  // then holds at 0 until the socket reconnects (wsStatus returns to "connected").
  // Resets whenever a new delay is received (each disconnect cycle may use a different
  // exponential-backoff value) and clears when the connection recovers.
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (wsStatus !== "reconnecting" || reconnectDelayMs === null) {
      setReconnectCountdown(null);
      return;
    }
    setReconnectCountdown(Math.ceil(reconnectDelayMs / 1000));
    const interval = setInterval(() => {
      setReconnectCountdown(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);
    return () => clearInterval(interval);
  }, [wsStatus, reconnectDelayMs]);

  // Push WS reconnect state into context so the global NetworkStatusIndicator
  // pill can show the live countdown on mobile.
  useEffect(() => {
    setWsReconnect(wsStatus, reconnectCountdown);
  }, [wsStatus, reconnectCountdown, setWsReconnect]);

  // Reset context only on unmount so the pill disappears when leaving the page.
  useEffect(() => {
    return () => { setWsReconnect("connected", null); };
  }, [setWsReconnect]);

  const isMutating = useIsMutating();
  useEffect(() => {
    if (isMutating > 0) {
      setSaveStatus("saving");
    } else if (saveStatus === "saving") {
      setSaveStatus("saved");
      const t = setTimeout(() => setSaveStatus("idle"), 2000);
      return () => clearTimeout(t);
    }
  }, [isMutating]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) { redoWithSignal(); } else { undoWithSignal(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undoWithSignal, redoWithSignal]);

  const currentUnit: UnitType = (userSettings?.defaultUnit as UnitType) || "feet";
  const uLabel = unitLabel(currentUnit);
  const totalFootage = entries.reduce((sum, e) => sum + (e.footage || 0), 0);
  const displayTotalFootage = toDisplayUnit(totalFootage, currentUnit);

  const prevSessionValuesRef = useRef<{ name: string; location: string; description: string } | null>(null);

  const updateSession = useMutation({
    mutationFn: async ({ name, location, description, _previous }: { name: string; location: string; description?: string; _previous?: { name: string; location: string; description: string } }) => {
      const res = await apiRequest("PATCH", `/api/sessions/${sessionId}`, {
        name,
        location: location || null,
        ...(description !== undefined ? { description: description || null } : {}),
        expectedLastUpdatedAt: session?.lastUpdatedAt,
      });
      return { result: await res.json(), _previous, newValues: { name, location: location || null, description: description || null } };
    },
    onSuccess: async ({ result, _previous, newValues }) => {
      await queryClient.refetchQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
      if (_previous) {
        pushUndo({
          type: "update-session",
          sessionId,
          entityId: sessionId,
          data: { name: newValues.name, location: newValues.location, description: newValues.description, expectedLastUpdatedAt: result?.lastUpdatedAt },
          previousData: { name: _previous.name, location: _previous.location || null, description: _previous.description || null },
        });
      }
    },
    onError: async (err: unknown) => {
      let message = "Failed to update session";
      const parsed = parseApiErrorPayload(err);
      if (parsed?.code === "SESSION_VERSION_CONFLICT") {
        if (typeof parsed.message === "string") message = parsed.message;
        await queryClient.refetchQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      }
      toast({ title: message, variant: "destructive" });
    },
  });

  const deleteEditingEntry = useMutation({
    mutationFn: async ({ id, entry }: { id: number; entry: Entry }) => {
      await apiRequest("DELETE", `/api/entries/${id}`);
      return entry;
    },
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      const { id, ...rest } = entry;
      pushUndo({
        type: "delete-entry",
        sessionId,
        entityId: id,
        data: rest,
        previousData: rest,
        serverUpdatedAt: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : new Date(entry.updatedAt as unknown as string).toISOString(),
      });
      let consumed = false;
      toast({
        title: "Entry deleted",
        action: <ToastAction altText="Undo" onClick={(e) => { if (consumed) return; consumed = true; (e.currentTarget as HTMLButtonElement).disabled = true; undoWithSignalRef.current(); }}>Undo</ToastAction>,
      });
      setEditingEntry(null);
    },
  });

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!editSessionOpen) return;
    if (!editName.trim()) return;
    if (editName === session.name && (editLocation || "") === (session.location || "") && (editDescription || "") === ((session as any).description || "")) return;
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const prev = prevSessionValuesRef.current || {
        name: session.name,
        location: session.location || "",
        description: (session as any).description || "",
      };
      prevSessionValuesRef.current = { name: editName, location: editLocation, description: editDescription };
      updateSession.mutate({ name: editName, location: editLocation, description: editDescription, _previous: prev });
    }, 1000);
    return () => clearTimeout(autoSaveTimerRef.current);
  }, [editName, editLocation, editDescription, editSessionOpen]);


  const shareSession = () => {
    const lines: string[] = [];
    lines.push(`Session: ${session.name}`);
    if (session.location) lines.push(`Location: ${session.location}`);
    lines.push(`Entries: ${entries.length}`);
    lines.push(`Total Footage: ${displayTotalFootage.toLocaleString()} ${uLabel}`);
    lines.push(`Photos: ${photos.length}`);
    if (session.firstPhotoAt) {
      lines.push(`Time: ${formatSessionTimeWithTz(session.firstPhotoAt ?? null, session.lastPhotoAt ?? null, tz)}`);
    }
    lines.push("");

    const grouped = new Map<string, Entry[]>();
    for (const e of entries) {
      const key = `${e.aisle} - ${e.section}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(e);
    }

    for (const [loc, group] of grouped) {
      lines.push(`--- ${loc} ---`);
      for (const e of group) {
        const parts = [e.reelTag || "Unknown", e.wireType, e.gauge, e.footage ? `${toDisplayUnit(e.footage, currentUnit)}${uLabel}` : "", e.color, e.manufacturer].filter(Boolean);
        lines.push(`  ${parts.join(" | ")}${e.reelCount && e.reelCount > 1 ? ` (x${e.reelCount})` : ""}`);
      }
      lines.push("");
    }

    lines.push(`Generated: ${formatTimestamp(new Date(), tz)}`);

    const subject = encodeURIComponent(`Wire Reel Count - ${session.name}`);
    const body = encodeURIComponent(lines.join("\n"));
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self");
  };

  const [exportWarningOpen, setExportWarningOpen] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [isExcelExporting, setIsExcelExporting] = useState(false);
  const isAnyExportRunning = isPdfExporting || isExcelExporting || !!(serverActiveTasks?.pdf) || !!(serverActiveTasks?.excel);
  const [pdfQualityOpen, setPdfQualityOpen] = useState(false);
  const [pdfQualityChoice, setPdfQualityChoice] = useState<"full" | "standard">(
    () => (localStorage.getItem(PDF_EXPORT_QUALITY_KEY) as "full" | "standard") ?? "full"
  );
  const [pdfDialogWaiting, setPdfDialogWaiting] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{done: number, total: number} | null>(null);
  const fullJobRef = useRef<string | null>(null);
  const stdJobRef  = useRef<string | null>(null);
  const pdfPollAbortRef = useRef<AbortController | null>(null);
  const unpinnedEntries = entries.filter(e => !pinByEntryId.has(e.id));

  const flushBeforeExport = async (): Promise<boolean> => {
    if (editingEntry) {
      toast({
        title: "Unsaved Changes",
        description: "You have an entry open for editing. Please save or close it before exporting.",
        variant: "destructive",
      });
      return false;
    }
    try {
      if (photoModeFlushRef.current) await photoModeFlushRef.current();
    } catch {}
    return true;
  };

  const doExportExcel = async () => {
    setIsExcelExporting(true);
    try {
      const canProceed = await flushBeforeExport();
      if (!canProceed) return;
      const params = new URLSearchParams();
      if (userSettings?.companyName) params.set("companyName", userSettings.companyName);
      const url = `/api/sessions/${sessionId}/export/excel?${params}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = buildExportFilename(session, "xlsx");
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast({ title: "Failed to export Excel", variant: "destructive" });
    } finally {
      setIsExcelExporting(false);
    }
  };

  const exportExcel = async () => {
    await doExportExcel();
  };

  const buildPdfStartUrl = (quality: "full" | "standard") => {
    const params = new URLSearchParams();
    if (userSettings?.companyName) params.set("companyName", userSettings.companyName);
    if (userSettings?.exportFooterText) params.set("footerText", userSettings.exportFooterText);
    params.set("quality", quality);
    return `/api/sessions/${sessionId}/export/pdf/start?${params}`;
  };

  const triggerPdfGeneration = (quality: "full" | "standard", jobId: string) => {
    const params = new URLSearchParams();
    if (userSettings?.companyName) params.set("companyName", userSettings.companyName);
    if (userSettings?.exportFooterText) params.set("footerText", userSettings.exportFooterText);
    params.set("quality", quality);
    params.set("jobId", jobId);
    fetch(`/api/sessions/${sessionId}/export/pdf?${params}`, { credentials: "include" }).catch(() => null);
  };

  const pollPdfJob = async (
    jobId: string,
    signal: AbortSignal,
    onProgress: (p: {done: number, total: number}) => void
  ): Promise<Blob | null> => {
    while (!signal.aborted) {
      await new Promise<void>(r => setTimeout(r, 800));
      if (signal.aborted) return null;
      try {
        const res = await fetch(`/api/sessions/${sessionId}/export/pdf/progress/${jobId}`, {
          credentials: "include", signal,
        });
        if (!res.ok) return null;
        const prog = await res.json();
        if (prog.error) return null;
        if (prog.total > 0) onProgress({ done: prog.done, total: prog.total });
        if (prog.complete) {
          const dlRes = await fetch(`/api/sessions/${sessionId}/export/pdf/download/${jobId}`, {
            credentials: "include", signal,
          });
          if (!dlRes.ok) return null;
          return await dlRes.blob();
        }
      } catch {
        return null;
      }
    }
    return null;
  };

  const startPdfJob = (quality: "full" | "standard") => {
    fetch(buildPdfStartUrl(quality), { method: "POST", credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.jobId) return;
        const jobId = data.jobId;
        if (quality === "full") fullJobRef.current = jobId;
        else stdJobRef.current = jobId;
        // Fire-and-forget: trigger actual PDF generation with this job ID
        triggerPdfGeneration(quality, jobId);
      })
      .catch(() => null);
  };

  const abortPdfFetches = () => {
    fullJobRef.current = null;
    stdJobRef.current  = null;
    pdfPollAbortRef.current?.abort();
    pdfPollAbortRef.current = null;
    setPdfProgress(null);
  };

  const openQualityDialogDirect = async () => {
    const canProceed = await flushBeforeExport();
    if (!canProceed) return;
    abortPdfFetches();
    setPdfQualityOpen(true);
    startPdfJob("full");
    startPdfJob("standard");
  };

  const confirmQualityExport = async () => {
    localStorage.setItem(PDF_EXPORT_QUALITY_KEY, pdfQualityChoice);
    const jobId = pdfQualityChoice === "full" ? fullJobRef.current : stdJobRef.current;
    if (!jobId) {
      // Job ID not yet returned — wait briefly then try once more
      setPdfDialogWaiting(true);
      await new Promise(r => setTimeout(r, 1500));
      const retryJobId = pdfQualityChoice === "full" ? fullJobRef.current : stdJobRef.current;
      if (!retryJobId) {
        setPdfDialogWaiting(false);
        toast({
          title: "PDF Export Failed",
          description: "Export failed — Try again in a moment.",
          variant: "destructive",
          action: <ToastAction altText="Try again" onClick={exportPdf}>Try Again</ToastAction>,
        });
        return;
      }
    }
    const finalJobId = pdfQualityChoice === "full" ? fullJobRef.current : stdJobRef.current;
    if (!finalJobId) return;
    setPdfDialogWaiting(true);
    setPdfProgress(null);
    const ctrl = new AbortController();
    pdfPollAbortRef.current = ctrl;
    const blob = await pollPdfJob(finalJobId, ctrl.signal, setPdfProgress);
    setPdfDialogWaiting(false);
    setPdfQualityOpen(false);
    abortPdfFetches();
    if (!blob || blob.size < 500) {
      toast({
        title: "PDF Export Failed",
        description: "Export failed — Try again in a moment.",
        variant: "destructive",
        action: <ToastAction altText="Try again" onClick={exportPdf}>Try Again</ToastAction>,
      });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const baseName = buildExportFilename(session, "pdf");
    a.download = pdfQualityChoice === "standard"
      ? baseName.replace(/\.pdf$/, " (Standard Quality).pdf")
      : baseName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const cancelQualityDialog = () => {
    abortPdfFetches();
    setPdfQualityOpen(false);
  };

  const doExportPdf = async () => {
    const quality = (localStorage.getItem(PDF_EXPORT_QUALITY_KEY) as "full" | "standard") ?? "full";
    const canProceed = await flushBeforeExport();
    if (!canProceed) return;
    setIsPdfExporting(true);
    setPdfProgress(null);
    const ctrl = new AbortController();
    pdfPollAbortRef.current = ctrl;
    try {
      const startRes = await fetch(buildPdfStartUrl(quality), {
        method: "POST", credentials: "include", signal: ctrl.signal,
      });
      if (!startRes.ok) throw new Error("Failed to start PDF export");
      const { jobId } = await startRes.json();
      // Fire-and-forget: trigger actual PDF generation with this job ID
      triggerPdfGeneration(quality, jobId);
      const blob = await pollPdfJob(jobId, ctrl.signal, setPdfProgress);
      if (ctrl.signal.aborted) return;
      if (!blob || blob.size < 500) throw new Error("The PDF was generated but appears to be empty.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildExportFilename(session, "pdf");
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "PDF export failed";
      const isNetworkError = /offline|fetch|network|failed to fetch/i.test(msg);
      let recommendation: string;
      if (isNetworkError) {
        recommendation = "Check your internet connection and try again.";
      } else if (/not found|404/i.test(msg)) {
        recommendation = "Try refreshing the page. If the session no longer appears, it may have been deleted.";
      } else if (/empty/i.test(msg)) {
        recommendation = "Try exporting again. If this keeps happening, submit a bug report from Settings > Contact & Feedback.";
      } else {
        recommendation = "Try again in a moment. If the problem persists, submit a bug report from Settings > Contact & Feedback.";
      }
      toast({
        title: "PDF Export Failed",
        description: `${msg} — ${recommendation}`,
        variant: "destructive",
        ...(!isNetworkError && {
          action: (
            <ToastAction altText="Try again" onClick={() => doExportPdf()}>
              Try Again
            </ToastAction>
          ),
        }),
      });
    } finally {
      setIsPdfExporting(false);
      setPdfProgress(null);
      pdfPollAbortRef.current = null;
    }
  };

  const exportPdf = () => {
    if (unpinnedEntries.length > 0) {
      setExportWarningOpen(true);
      return;
    }
    if (!navigator.onLine) {
      toast({ title: "PDF Export Failed", description: "You appear to be offline. Check your internet connection and try again.", variant: "destructive" });
      return;
    }
    setTimeout(() => openQualityDialogDirect(), 0);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">
      <header className="sticky top-0 z-50 border-b !border-b-[hsl(215_40%_35%)] bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" onClick={() => confirmUnsavedNav(() => setLocation("/"))} data-testid="button-back" className="!border !border-[hsl(215_40%_35%)]">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back to dashboard</TooltipContent>
            </Tooltip>
            <div
              className="min-w-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              role="button"
              tabIndex={0}
              aria-label="Edit session details"
              onClick={() => { setEditName(session.name); setEditLocation(session.location || ""); setEditDescription((session as any).description || ""); setEditSessionOpen(true); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditName(session.name); setEditLocation(session.location || ""); setEditDescription((session as any).description || ""); setEditSessionOpen(true); } }}
            >
              <h1 className="text-sm font-semibold truncate" data-testid="text-session-name">{session.name}</h1>
              <span className="mono text-xs text-muted-foreground hidden sm:inline" data-testid="text-session-time">{formatSessionTimeWithTz(session.firstPhotoAt ?? null, session.lastPhotoAt ?? null, tz, captureMode)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {wsStatus === "reconnecting" && (
              <span className="flex items-center gap-1 text-xs text-amber-500 animate-pulse" data-testid="text-ws-reconnecting">
                <Loader2 className="h-3 w-3 animate-spin" />
                {reconnectCountdown !== null
                  ? `Reconnecting in ${reconnectCountdown}s…`
                  : "Reconnecting…"}
              </span>
            )}
            {saveStatus === "saving" && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground animate-pulse" data-testid="text-save-status">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving...
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="flex items-center gap-1 text-xs text-green-500" data-testid="text-save-status">
                <Check className="h-3 w-3" />
                Saved
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden sm:inline-flex relative">
                  <Button size="icon" variant="ghost" onClick={undoWithSignal} disabled={!canUndo} data-testid="button-undo" className="h-8 w-8">
                    <Undo2 className="h-4 w-4" />
                  </Button>
                  {undoPendingSync && (
                    <span
                      className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-background pointer-events-none"
                      data-testid="badge-undo-pending-sync"
                      aria-label="pending sync"
                    />
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {undoPendingSync ? "Undo (pending sync)" : "Undo"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden sm:inline-flex relative">
                  <Button size="icon" variant="ghost" onClick={redoWithSignal} disabled={!canRedo} data-testid="button-redo" className="h-8 w-8">
                    <Redo2 className="h-4 w-4" />
                  </Button>
                  {redoPendingSync && (
                    <span
                      className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-background pointer-events-none"
                      data-testid="badge-redo-pending-sync"
                      aria-label="pending sync"
                    />
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {redoPendingSync ? "Redo (pending sync)" : "Redo"}
              </TooltipContent>
            </Tooltip>
            {onlineUsers.length > 0 && (
              <div className="hidden sm:flex items-center gap-0.5 mr-1" data-testid="online-users">
                {onlineUsers.slice(0, 3).map((u, i) => (
                  <div
                    key={u.userId}
                    className="relative w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold uppercase border border-background"
                    title={`${u.username} (online)`}
                    data-testid={`avatar-online-${i}`}
                  >
                    {u.username.charAt(0)}
                    <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 border border-background" />
                  </div>
                ))}
                {onlineUsers.length > 3 && (
                  <span className="text-[10px] text-muted-foreground ml-0.5">+{onlineUsers.length - 3}</span>
                )}
              </div>
            )}
            {isOwner && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={() => setTeamDialogOpen(true)} data-testid="button-team" className="!border-[hsl(215_40%_35%)]">
                    <Users className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Team</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Manage team</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={() => { if (!captureMode) { setMobileFlowKey(k => k + 1); window.scrollTo({ top: 0, behavior: "instant" }); } setCaptureMode(!captureMode); }} data-testid="button-toggle-mobile" className={captureMode ? "!border-blue-600 !bg-blue-600 !text-white hover:!bg-blue-700 hover:!border-blue-700" : "!border-red-600 !bg-red-600/80 !text-white hover:!bg-red-700 hover:!border-red-700"}>
                  {captureMode ? <Monitor className="h-4 w-4 sm:mr-1" /> : <TabletSmartphone className="h-4 w-4 sm:mr-1" />}
                  <span className="hidden sm:inline">{captureMode ? "Reel IDs" : "Mobile Flow"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{captureMode ? "Switch to Reel IDs" : "Switch to mobile capture mode"}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" data-testid="button-export" title="Export session data" disabled={isAnyExportRunning} className="!border-[hsl(215_40%_35%)]">
                  {isAnyExportRunning ? <Loader2 className="h-4 w-4 sm:mr-1 animate-spin text-orange-600" /> : <Download className="h-4 w-4 sm:mr-1" />}
                  <span className={`hidden sm:inline${isAnyExportRunning ? " text-orange-600 animate-pulse [animation-duration:1.8s]" : ""}`}>{isAnyExportRunning ? "Exporting…" : "Export"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(userSettings?.defaultExportFormat === "excel") ? (
                  <>
                    <DropdownMenuItem onClick={exportExcel} data-testid="button-export-excel" disabled={isAnyExportRunning}>
                      {(isExcelExporting || serverActiveTasks?.excel) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                      {(isExcelExporting || serverActiveTasks?.excel) ? "Generating Excel…" : "Excel"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportPdf} data-testid="button-export-pdf" disabled={isAnyExportRunning}>
                      {(isPdfExporting || serverActiveTasks?.pdf) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                      {(isPdfExporting || serverActiveTasks?.pdf)
                        ? (pdfProgress && pdfProgress.total > 0 ? `Generating… ${pdfProgress.done} of ${pdfProgress.total}` : "Generating PDF…")
                        : "PDF"}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem onClick={exportPdf} data-testid="button-export-pdf" disabled={isAnyExportRunning}>
                      {(isPdfExporting || serverActiveTasks?.pdf) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                      {(isPdfExporting || serverActiveTasks?.pdf)
                        ? (pdfProgress && pdfProgress.total > 0 ? `Generating… ${pdfProgress.done} of ${pdfProgress.total}` : "Generating PDF…")
                        : "PDF"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportExcel} data-testid="button-export-excel" disabled={isAnyExportRunning}>
                      {(isExcelExporting || serverActiveTasks?.excel) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                      {(isExcelExporting || serverActiveTasks?.excel) ? "Generating Excel…" : "Excel"}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={shareSession} data-testid="button-share-session">
                  <Mail className="h-4 w-4 mr-2" />
                  Share via Email
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle className="h-7 w-7 sm:h-9 sm:w-9" />
            <HelpMenu mode={captureMode ? "mobile" : "full"} />
          </div>
        </div>
        <div className="sm:hidden border-t border-border/50 px-4 py-1 flex items-center justify-center gap-1" data-testid="header-mobile-date">
          <span className="mono text-xs text-muted-foreground">{formatSessionTimeMobile(session.firstPhotoAt ?? null, session.lastPhotoAt ?? null, tz)}</span>
        </div>
      </header>

      {showActivity && (
        <div className="border-b bg-card">
          <div className="max-w-5xl mx-auto w-full px-4">
            <div className="flex items-center gap-2 py-2 border-b border-border/50">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                Activity Log
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setShowActivity(false)}
                data-testid="button-close-activity"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <ActivityLog sessionId={sessionId} currentUserId={user?.id as string | undefined} isOwner={isOwner} onPushUndo={pushUndo} />
          </div>
        </div>
      )}

      {isLocked && !isOwner && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-center">
          <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1">
            <Lock className="h-3 w-3" />
            This session is locked. Editing is disabled.
          </span>
        </div>
      )}


      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-4 pb-[50vh] space-y-4">
        {captureMode ? (
          <MobileCaptureView
            key={mobileFlowKey}
            sessionId={sessionId}
            photos={photos}
            initialAisle={mobileFlowInitialAisle}
            initialSection={mobileFlowInitialSection}
            detailParentPhotoId={mobileFlowDetailParentPhotoId}
            onDetailCaptured={() => {
              setMobileFlowInitialAisle("");
              setMobileFlowInitialSection("");
              setMobileFlowDetailParentPhotoId(null);
            }}
            onBackToFlagged={() => {
              setMobileFlowInitialAisle("");
              setMobileFlowInitialSection("");
              setMobileFlowDetailParentPhotoId(null);
              setCaptureMode(false);
              setMode("flagged");
            }}
            onClearUndoHistory={clearHistory}
          />
        ) : (
          <>
            <Tabs value={mode} onValueChange={(newMode) => {
              if (newMode === "photo" && syncedPhotoIdRef.current) {
                setNavigateToPhotoId(syncedPhotoIdRef.current);
                setNavigateAisle("");
                setNavigateSection("");
              }
              setMode(newMode);
            }} onTouchStart={handleTabSwipeStart} onTouchEnd={handleTabSwipeEnd}>
              <TabsList className="w-full bg-blue-600 border border-blue-700/40">
                <TabsTrigger value="strip" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-800 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-strip-mode" aria-label="Photos Reel">
                  <LayoutGrid className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Photos Reel</span>
                  {photos.length > 0 && (
                    <span className="sm:hidden ml-0.5 text-[9px] font-bold leading-none bg-white/25 rounded-full px-1 py-0.5 tabular-nums" data-testid="badge-tab-strip">{photos.length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="photo" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-800 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-photo-mode" aria-label="Reel IDs">
                  <Camera className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Reel IDs</span>
                  {entries.length > 0 && (
                    <span className="sm:hidden ml-0.5 text-[9px] font-bold leading-none bg-white/25 rounded-full px-1 py-0.5 tabular-nums" data-testid="badge-tab-photo">{entries.length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="flagged" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-800 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-flagged-mode" aria-label="Flagged">
                  <Flag className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Flagged</span>
                </TabsTrigger>
                <TabsTrigger value="review" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-800 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-review-mode" aria-label="Review">
                  <ClipboardCheck className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Review</span>
                </TabsTrigger>
                <TabsTrigger value="results" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-800 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-results-mode" aria-label="Final Results">
                  <BarChart2 className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Final Results</span>
                  {displayTotalFootage > 0 && (
                    <span className="sm:hidden ml-0.5 text-[9px] font-bold leading-none bg-white/25 rounded-full px-1 py-0.5 tabular-nums" data-testid="badge-tab-results">
                      {displayTotalFootage >= 1000 ? `${(displayTotalFootage / 1000).toFixed(1)}k ${uLabel}` : `${displayTotalFootage} ${uLabel}`}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {entries.length > 0 && (
                <SessionProgress
                  entries={entries}
                  pins={sessionPins}
                  sessionId={sessionId}
                />
              )}

              <TabsContent value="strip">
                <PhotoStrip
                  sessionId={sessionId}
                  canEdit={canEditSession}
                  onJumpToPhoto={(photoId) => {
                    setNavigateToPhotoId(photoId);
                    setMode("photo");
                  }}
                  onClearUndoHistory={clearHistory}
                  onPushUndo={pushUndo}
                  scrollToPhotoId={stripScrollToPhotoId}
                  onScrolled={() => setStripScrollToPhotoId(null)}
                  onAddPhoto={() => setMode("photo")}
                />
              </TabsContent>

              <TabsContent value="photo">
                <ErrorBoundary fallback={
                  <div className="flex flex-col items-center justify-center p-8 gap-3 text-center text-sm" data-testid="photo-mode-error-fallback">
                    <AlertTriangle className="h-8 w-8 text-destructive" />
                    <p className="font-medium">The photo annotation view encountered an unexpected error.</p>
                    <p className="text-muted-foreground text-xs">Your saved entries and photos are not affected.</p>
                    <button className="underline text-muted-foreground" onClick={() => window.location.reload()} data-testid="button-photo-mode-reload">Reload page</button>
                  </div>
                }>
                  <PhotoMode sessionId={sessionId} photos={photos} navigateToPhotoId={navigateToPhotoId} navigateAisle={navigateAisle} navigateSection={navigateSection} navigateToPinId={navigateToPinId} onNavigated={() => { setNavigateToPhotoId(null); setNavigateAisle(""); setNavigateSection(""); setNavigateToPinId(null); }} canEdit={canEditSession} initialPhotoIndex={session.lastPhotoIndex ?? 0} onPushUndo={pushUndo} onClearUndoHistory={clearHistory} undoRedoSignal={undoRedoSignal} onDraftPinsHint={(aisle, section) => setExclusiveExpandKey(`${aisle}-${section}`)} pinRefreshSignal={pinRefreshSignal} onCurrentPhotoChange={(photoId) => { lastPhotoModePhotoIdRef.current = photoId; }} isAdmin={isOwner} onPinDataChanged={triggerPinRefresh} onlineUsers={onlineUsers} initialScanPanelOpen={initialScanPanelOpen} onJumpToStripPhoto={(photoId) => { setStripScrollToPhotoId(photoId); setMode("strip"); }} flushRef={photoModeFlushRef} onScanApplied={(sectionKey) => { setExclusiveExpandKey(sectionKey); }} onPanStateChange={(active) => { panActiveRef.current = active; }} onTriggerUndo={() => undoWithSignalRef.current()} />
                </ErrorBoundary>
              </TabsContent>

              <TabsContent value="flagged">
                <FlaggedReels
                  sessionId={sessionId}
                  onBack={() => setMode("photo")}
                  pushUndo={pushUndo}
                  onReshoot={(aisleVal, sectionVal, parentPhotoId) => {
                    setMobileFlowInitialAisle(aisleVal);
                    setMobileFlowInitialSection(sectionVal);
                    setMobileFlowDetailParentPhotoId(parentPhotoId);
                    setCaptureMode(true);
                    setMobileFlowKey(k => k + 1);
                  }}
                  onViewInPhoto={(photoId, pinId) => {
                    setNavigateToPhotoId(photoId);
                    if (pinId) setNavigateToPinId(pinId);
                    setMode("photo");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              </TabsContent>

              <TabsContent value="review">
                <ReviewTab
                  sessionId={sessionId}
                  entries={entries}
                  photos={photos}
                  onlineUsers={onlineUsers}
                  serverReviewCohort={session?.reviewCohort ?? null}
                />
              </TabsContent>

              <TabsContent value="results">
                <FinalResultsTab
                  sessionId={sessionId}
                  entries={entries}
                  photos={photos}
                  onJumpToPin={(photoId, pinId) => {
                    setNavigateToPhotoId(photoId);
                    setNavigateToPinId(pinId);
                    setMode("photo");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  onSwitchToFlagged={(section) => {
                    setMode("flagged");
                    setTimeout(() => {
                      const anchor = section === "pins" ? "flagged-pins-section" : "section-review-flagged";
                      const el = document.querySelector(`[data-testid="${anchor}"]`) || document.getElementById(anchor);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                    }, 150);
                  }}
                  onSwitchToReview={() => {
                    setMode("review");
                  }}
                />
              </TabsContent>
            </Tabs>
          </>
        )}

        {mode === "strip" && mobileFlowDetailParentPhotoId == null && entries.length > 0 && (
          <div className="flex justify-center py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="gap-2 text-muted-foreground hover:text-foreground"
              data-testid="btn-scroll-to-top"
            >
              <ArrowUp className="h-4 w-4" />
              Back to top
            </Button>
          </div>
        )}

        {!captureMode && mobileFlowDetailParentPhotoId == null && (
          <>
            <Separator />

            <div id="section-entry-table">
              <EntryTable
                entries={entries}
                photos={photos}
                onEdit={(entry) => { setEditingEntry(entry); }}
                sessionId={sessionId}
                totalFootage={displayTotalFootage}
                unitLabel={uLabel}
                currentUnit={currentUnit}
                onUndoableDelete={pushUndo}
                onTriggerUndo={undoWithSignal}
                canEdit={canEditSession}
                exclusiveExpandKey={exclusiveExpandKey}
                onJumpToPin={(photoId, pinId) => {
                  setNavigateToPhotoId(photoId);
                  setNavigateToPinId(pinId);
                  setMode("photo");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onGoToPhotoMode={() => { setMode("photo"); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              />
            </div>
          </>
        )}
      </div>

      {editingEntry && (
        <Dialog open={!!editingEntry} onOpenChange={(o) => { if (!o) confirmUnsavedNav(() => setEditingEntry(null)); }}>
          <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0">
            <DialogHeader className="p-4 pb-2 shrink-0">
              <DialogTitle>Edit Entry #{editingEntry.id}</DialogTitle>
            </DialogHeader>
            {editingEntry.photoId && (() => {
              const photo = photos.find(p => p.id === editingEntry.photoId);
              if (!photo) return null;
              const imgSrc = photo.objectStorageKey.startsWith("/uploads/") ? photo.objectStorageKey : `/uploads/${photo.objectStorageKey}`;
              const pin = pinByEntryId.get(editingEntry.id);
              return (
                <div
                  className="border border-border/50 mx-4 mb-2 max-h-[40vh] overflow-y-auto rounded-md shrink-0"
                  style={{ overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}
                >
                  <div className="relative inline-block w-full">
                    <img src={imgSrc} alt="Entry photo" className="w-full" style={{ display: "block" }} data-testid="img-edit-entry-photo" onLoad={() => setEditPhotoLoaded(true)} />
                    {editPhotoLoaded && pin && (
                      <div
                        className="absolute pointer-events-none"
                        style={{ left: `${pin.xPercent}%`, top: `${pin.yPercent}%`, transform: "translate(-50%, -50%)" }}
                        data-testid={`pin-highlight-edit-${editingEntry.id}`}
                        ref={(el) => {
                          if (el && !(el as any).__scrolled) {
                            (el as any).__scrolled = true;
                            setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
                          }
                        }}
                      >
                        <div className="w-24 h-24 rounded-full animate-pulse opacity-100" style={{ border: "12px solid #f97316" }} />
                        <div className="absolute inset-0 w-24 h-24 rounded-full border-2 border-white opacity-100" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              <SingleEntryMode sessionId={sessionId} editingEntry={editingEntry} onDoneEditing={() => { editingEntryDirtyRef.current = false; setEditingEntry(null); }} onUndoableSave={pushUndo} canEdit={canEditSession} onIsDirtyChange={(dirty) => { editingEntryDirtyRef.current = dirty; }} />
              {canEditSession && (
                <div className="mt-4 pt-4 border-t border-destructive/20">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive-outline" size="sm" className="w-full" data-testid="button-delete-entry-modal">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Entry
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Entry?</AlertDialogTitle>
                        <AlertDialogDescription>This entry will be permanently removed.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteEditingEntry.mutate({ id: editingEntry.id, entry: editingEntry })}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={editSessionOpen} onOpenChange={(open) => {
        if (!open && editName.trim() && (editName !== session.name || (editLocation || "") !== (session.location || "") || (editDescription || "") !== ((session as any).description || ""))) {
          const prev = prevSessionValuesRef.current || {
            name: session.name,
            location: session.location || "",
            description: (session as any).description || "",
          };
          prevSessionValuesRef.current = { name: editName, location: editLocation, description: editDescription };
          updateSession.mutate({ name: editName, location: editLocation, description: editDescription, _previous: prev });
        }
        if (open) {
          prevSessionValuesRef.current = null;
        }
        setEditSessionOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-session-name">Session Name</Label>
              <Input
                id="edit-session-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                data-testid="input-edit-session-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-session-location">Location</Label>
              <Input
                id="edit-session-location"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                data-testid="input-edit-session-location"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-session-description">Description</Label>
              <textarea
                id="edit-session-description"
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Optional notes about this session"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                data-testid="input-edit-session-description"
                rows={3}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">Changes are saved automatically</p>
          </div>
        </DialogContent>
      </Dialog>

      <TeamDialog
        open={teamDialogOpen}
        onOpenChange={setTeamDialogOpen}
        sessionId={sessionId}
        sessionName={session.name}
        isOwner={(session as any).role === "owner"}
        onlineUsers={onlineUsers}
        hasTesterPassword={userSettings?.testerPassword === "********"}
      />

      <AlertDialog open={exportWarningOpen} onOpenChange={setExportWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Entries Without Photos (PDF Export)</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">
                  {unpinnedEntries.length} {unpinnedEntries.length === 1 ? "entry has" : "entries have"} no linked photo and will appear in the &quot;Entries Without Photos&quot; section of the PDF.
                </p>
                <div className="space-y-1 max-h-48 overflow-y-auto text-sm">
                  {unpinnedEntries.slice(0, 10).map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="font-mono text-foreground">{e.reelTag || e.wireType || "Entry"}</span>
                      <span className="text-muted-foreground text-xs">Aisle {e.aisle} / Section {e.section}</span>
                    </div>
                  ))}
                  {unpinnedEntries.length > 10 && (
                    <p className="text-muted-foreground text-xs pt-1">…and {unpinnedEntries.length - 10} more.</p>
                  )}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-export-anyway"
              onClick={async () => {
                setExportWarningOpen(false);
                await openQualityDialogDirect();
              }}
            >
              Export Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={unsavedChangesOpen} onOpenChange={(open) => { if (!open) pendingNavActionRef.current = null; setUnsavedChangesOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to this entry. If you leave now, your changes will be discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-unsaved-stay">Stay</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-unsaved-leave"
              onClick={() => {
                const action = pendingNavActionRef.current;
                pendingNavActionRef.current = null;
                editingEntryDirtyRef.current = false;
                action?.();
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={pdfQualityOpen} onOpenChange={(open) => { if (!open) cancelQualityDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>PDF Export Quality</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(["full", "standard"] as const).map((q) => (
              <button
                key={q}
                onClick={() => setPdfQualityChoice(q)}
                className={`w-full text-left rounded-lg border-2 p-4 transition-colors ${
                  pdfQualityChoice === q
                    ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30"
                    : "border-border hover:border-muted-foreground/40"
                }`}
                data-testid={`button-pdf-quality-${q}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">
                    {q === "full" ? "Full Quality" : "Standard"}
                  </span>
                  {q === "full" && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 uppercase tracking-wide">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {q === "full"
                    ? "Original resolution — best for auditing reel labels"
                    : "1600 px wide — faster download, smaller file"}
                </p>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={cancelQualityDialog} data-testid="button-pdf-quality-cancel">
              Cancel
            </Button>
            <Button
              onClick={confirmQualityExport}
              disabled={pdfDialogWaiting}
              className="bg-orange-600 hover:bg-orange-700 text-white"
              data-testid="button-pdf-quality-confirm"
            >
              {pdfDialogWaiting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {pdfProgress && pdfProgress.total > 0
                    ? `Generating… ${pdfProgress.done} of ${pdfProgress.total}`
                    : "Generating…"}
                </>
              ) : (
                "Export"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


