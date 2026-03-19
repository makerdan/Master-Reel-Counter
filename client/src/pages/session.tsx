import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useIsMutating } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft, ArrowUp, Camera, Download, FileText, Mail, Undo2, Redo2, History,
  Lock, Unlock, Check, Loader2, AlertTriangle, Flag, Users, Smartphone, Monitor, Trash2, LayoutGrid, X, ClipboardCheck, BarChart2,
} from "lucide-react";
import { toDisplayUnit, unitLabel } from "@/lib/unit-conversion";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import type { Session, Entry, Photo, Pin } from "@shared/schema";
import PhotoMode from "./session/PhotoMode";
import TeamDialog from "./session/TeamDialog";
import EntryTable from "./session/EntryTable";
import SingleEntryMode from "./session/SingleEntryMode";
import MobileCaptureView from "./session/MobileCaptureView";
import ActivityLog from "./session/ActivityLog";
import FlaggedReels from "./session/FlaggedReels";
import PhotoStrip from "./session/PhotoStrip";
import ReviewTab from "./session/ReviewTab";
import FinalResultsTab from "./session/FinalResultsTab";
import HelpMenu from "@/components/HelpMenu";
import { buildExportFilename } from "./session/utils";
import { useTimezone } from "@/hooks/use-timezone";
import { formatSessionTimeWithTz, formatSessionTimeMobile, formatTimestamp } from "@/lib/timezone";
import { useUndoRedo } from "@/hooks/use-undo";
import { useSessionWebSocket } from "@/hooks/use-websocket";
import { useAuth } from "@/hooks/use-auth";

export default function SessionPage() {
  const [, params] = useRoute("/session/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const tz = useTimezone();
  const sessionId = params?.id ? parseInt(params.id) : 0;

  useEffect(() => {
    if (sessionId > 0) {
      try { localStorage.setItem("reel-counter-last-session", String(sessionId)); } catch {}
    }
  }, [sessionId]);

  const { data: session, isLoading: sessionLoading, isError: sessionError } = useQuery<Session & { firstPhotoAt: string | null; lastPhotoAt: string | null; role: "owner" | "editor" | "viewer"; collaboratorCount: number }>({
    queryKey: ["/api/sessions", sessionId.toString()],
    enabled: sessionId > 0,
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery<Entry[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "entries"],
    enabled: sessionId > 0,
  });

  const { data: photos = [] } = useQuery<Photo[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "photos"],
    enabled: sessionId > 0,
  });

  const { data: userSettings } = useQuery<{
    defaultExportFormat: string;
    companyName: string | null;
    exportFooterText: string | null;
    defaultUnit: string;
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
      entriesLoading={entriesLoading}
      photos={photos}
      sessionId={sessionId}
      userSettings={userSettings}
    />
  );
}

function SessionWorkspace({
  session, entries, entriesLoading, photos, sessionId, userSettings,
}: {
  session: Session & { role?: "owner" | "editor" | "viewer"; collaboratorCount?: number };
  entries: Entry[];
  entriesLoading: boolean;
  photos: Photo[];
  sessionId: number;
  userSettings?: { defaultExportFormat: string; companyName: string | null; exportFooterText: string | null; defaultUnit: string };
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
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
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
  const syncedPhotoIdRef = useRef<number | null>(null);
  const lastPhotoModePhotoIdRef = useRef<number | null>(null);
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
  }, [mode]);

  const [captureMode, setCaptureMode] = useState(window.innerWidth < 768);
  const [mobileFlowKey, setMobileFlowKey] = useState(0);
  const [mobileFlowInitialAisle, setMobileFlowInitialAisle] = useState("");
  const [mobileFlowInitialSection, setMobileFlowInitialSection] = useState("");
  const [mobileFlowDetailParentPhotoId, setMobileFlowDetailParentPhotoId] = useState<number | null>(null);

  const [showActivity, setShowActivity] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("activity") === "1"; } catch { return false; }
  });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const { pushUndo, clearHistory, undo, redo, canUndo, canRedo } = useUndoRedo(sessionId);
  const [undoRedoSignal, setUndoRedoSignal] = useState(0);
  const [tableExpandKey, setTableExpandKey] = useState<string | null>(null);
  const undoWithSignal = useCallback(async () => { await undo(); setUndoRedoSignal(s => s + 1); }, [undo]);
  const redoWithSignal = useCallback(async () => { await redo(); setUndoRedoSignal(s => s + 1); }, [redo]);

  const { data: sessionPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
    enabled: sessionId > 0,
  });
  const pinByEntryId = new Map(sessionPins.filter(p => p.entryId).map(p => [p.entryId!, p]));

  const isLocked = !!(session as any).isLocked;
  const isOwner = (session as any).role === "owner";
  const canEditSession = !isLocked || isOwner;

  const toggleLock = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/lock`, { locked: !isLocked });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: isLocked ? "Session unlocked" : "Session locked" });
    },
  });


  const { user } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<{ userId: string; username: string }[]>([]);

  useSessionWebSocket(sessionId, (msg) => {
    if (msg.type === "presence") {
      setOnlineUsers(msg.users || []);
    }
  }, user ? { userId: (user as any).id, username: (user as any).firstName || (user as any).id } : undefined);

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

  const updateSession = useMutation({
    mutationFn: async ({ name, location, description }: { name: string; location: string; description?: string }) => {
      const res = await apiRequest("PATCH", `/api/sessions/${sessionId}`, {
        name,
        location: location || null,
        ...(description !== undefined ? { description: description || null } : {}),
      });
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
    },
    onError: () => {
      toast({ title: "Failed to update session", variant: "destructive" });
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
      });
      toast({ title: "Entry deleted" });
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
      updateSession.mutate({ name: editName, location: editLocation, description: editDescription });
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
      lines.push(`Time: ${formatSessionTimeWithTz(session.firstPhotoAt, session.lastPhotoAt, tz)}`);
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
  const [pendingExportType, setPendingExportType] = useState<"pdf" | "excel" | null>(null);
  const [pdfQualityOpen, setPdfQualityOpen] = useState(false);
  const [pdfQualityChoice, setPdfQualityChoice] = useState<"full" | "standard">(
    () => (localStorage.getItem("pdfExportQuality") as "full" | "standard") ?? "full"
  );
  const [pdfDialogWaiting, setPdfDialogWaiting] = useState(false);
  const fullAbortRef = useRef<AbortController | null>(null);
  const stdAbortRef  = useRef<AbortController | null>(null);
  const fullBlobRef  = useRef<Blob | null>(null);
  const stdBlobRef   = useRef<Blob | null>(null);
  const fullFetchRef = useRef<Promise<Blob | null> | null>(null);
  const stdFetchRef  = useRef<Promise<Blob | null> | null>(null);
  const unpinnedEntries = entries.filter(e => !pinByEntryId.has(e.id));

  const doExportExcel = async () => {
    try {
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
    }
  };

  const exportExcel = async () => {
    if (unpinnedEntries.length > 0) {
      setPendingExportType("excel");
      setExportWarningOpen(true);
      return;
    }
    await doExportExcel();
  };

  const buildPdfUrl = (quality: "full" | "standard") => {
    const params = new URLSearchParams();
    if (userSettings?.companyName) params.set("companyName", userSettings.companyName);
    if (userSettings?.exportFooterText) params.set("footerText", userSettings.exportFooterText);
    params.set("quality", quality);
    return `/api/sessions/${sessionId}/export/pdf?${params}`;
  };

  const startPdfFetch = (quality: "full" | "standard") => {
    const ctrl = new AbortController();
    if (quality === "full") fullAbortRef.current = ctrl;
    else stdAbortRef.current = ctrl;
    const p = fetch(buildPdfUrl(quality), { credentials: "include", signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        const blob = await res.blob();
        return blob.size >= 500 ? blob : null;
      })
      .catch(() => null);
    if (quality === "full") fullFetchRef.current = p;
    else stdFetchRef.current = p;
    p.then((blob) => {
      if (quality === "full") fullBlobRef.current = blob;
      else stdBlobRef.current = blob;
    });
  };

  const abortPdfFetches = () => {
    fullAbortRef.current?.abort(); fullAbortRef.current = null;
    stdAbortRef.current?.abort();  stdAbortRef.current = null;
    fullBlobRef.current = null; stdBlobRef.current = null;
    fullFetchRef.current = null; stdFetchRef.current = null;
  };

  const openQualityDialogDirect = () => {
    abortPdfFetches();
    setPdfQualityOpen(true);
    startPdfFetch("full");
    startPdfFetch("standard");
  };

  const confirmQualityExport = async () => {
    localStorage.setItem("pdfExportQuality", pdfQualityChoice);
    if (pdfQualityChoice === "full") { stdAbortRef.current?.abort(); stdAbortRef.current = null; }
    else { fullAbortRef.current?.abort(); fullAbortRef.current = null; }
    const blobRef  = pdfQualityChoice === "full" ? fullBlobRef  : stdBlobRef;
    const fetchRef = pdfQualityChoice === "full" ? fullFetchRef : stdFetchRef;
    let blob = blobRef.current;
    if (!blob) {
      setPdfDialogWaiting(true);
      blob = (await fetchRef.current) ?? null;
      setPdfDialogWaiting(false);
    }
    setPdfQualityOpen(false);
    abortPdfFetches();
    if (!blob) {
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
    const quality = (localStorage.getItem("pdfExportQuality") as "full" | "standard") ?? "full";
    setIsPdfExporting(true);
    try {
      const res = await fetch(buildPdfUrl(quality), { credentials: "include" });
      if (!res.ok) {
        let serverMsg = "PDF export failed";
        try { const body = await res.json(); serverMsg = body.message || body.error || serverMsg; } catch {}
        throw new Error(serverMsg);
      }
      const blob = await res.blob();
      if (blob.size < 500) throw new Error("The PDF was generated but appears to be empty.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildExportFilename(session, "pdf");
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
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
    }
  };

  const exportPdf = () => {
    if (unpinnedEntries.length > 0) {
      setPendingExportType("pdf");
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
      <header className="sticky top-0 z-50 border-b !border-b-[hsl(18_60%_30%)] bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" onClick={() => setLocation("/")} data-testid="button-back" className="!border !border-[hsl(18_60%_30%)]">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back to dashboard</TooltipContent>
            </Tooltip>
            <div className="min-w-0 cursor-pointer" onClick={() => { setEditName(session.name); setEditLocation(session.location || ""); setEditDescription((session as any).description || ""); setEditSessionOpen(true); }}>
              <h1 className="text-sm font-semibold truncate" data-testid="text-session-name">{session.name}</h1>
              <span className="mono text-xs text-muted-foreground hidden sm:inline" data-testid="text-session-time">{formatSessionTimeWithTz(session.firstPhotoAt, session.lastPhotoAt, tz, captureMode)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
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
                <Button size="icon" variant="ghost" onClick={undoWithSignal} disabled={!canUndo} data-testid="button-undo" className="hidden sm:inline-flex h-8 w-8">
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" onClick={redoWithSignal} disabled={!canRedo} data-testid="button-redo" className="hidden sm:inline-flex h-8 w-8">
                  <Redo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Redo</TooltipContent>
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
                  <Button size="sm" variant="outline" onClick={() => setTeamDialogOpen(true)} data-testid="button-team" className="!border-[hsl(18_60%_30%)]">
                    <Users className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Team</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Manage team</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={() => { if (!captureMode) { setMobileFlowKey(k => k + 1); window.scrollTo({ top: 0, behavior: "instant" }); } setCaptureMode(!captureMode); }} data-testid="button-toggle-mobile" className="!border-blue-600 !bg-blue-600 !text-white hover:!bg-blue-700 hover:!border-blue-700">
                  {captureMode ? <Monitor className="h-4 w-4 sm:mr-1" /> : <Smartphone className="h-4 w-4 sm:mr-1" />}
                  <span className="hidden sm:inline">{captureMode ? "Reel IDs" : "Mobile Flow"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{captureMode ? "Switch to Reel IDs" : "Switch to mobile capture mode"}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" data-testid="button-export" title="Export session data" disabled={isPdfExporting} className="!border-[hsl(18_60%_30%)]">
                  {isPdfExporting ? <Loader2 className="h-4 w-4 sm:mr-1 animate-spin text-orange-600" /> : <Download className="h-4 w-4 sm:mr-1" />}
                  <span className={`hidden sm:inline${isPdfExporting ? " text-orange-600 animate-pulse [animation-duration:1.8s]" : ""}`}>{isPdfExporting ? "Exporting…" : "Export"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportExcel} data-testid="button-export-excel" disabled={isPdfExporting}>
                  <Download className="h-4 w-4 mr-2" />
                  Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportPdf} data-testid="button-export-pdf" disabled={isPdfExporting}>
                  {isPdfExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                  {isPdfExporting ? "Generating PDF…" : "PDF"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={shareSession} data-testid="button-share-session">
                  <Mail className="h-4 w-4 mr-2" />
                  Share via Email
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle />
            <HelpMenu mode={captureMode ? "mobile" : "full"} />
          </div>
        </div>
        <div className="sm:hidden border-t border-border/50 px-4 py-1 flex items-center justify-center gap-1" data-testid="header-mobile-date">
          <span className="mono text-xs text-muted-foreground">{formatSessionTimeMobile(session.firstPhotoAt, session.lastPhotoAt, tz)}</span>
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
            <ActivityLog sessionId={sessionId} currentUserId={user?.id as string | undefined} isOwner={isOwner} />
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
            }}>
              <TabsList className="w-full bg-[hsl(25_12%_18%)] dark:bg-[hsl(25_8%_15%)] border border-[hsl(18_60%_30%/0.3)]">
                <TabsTrigger value="strip" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-strip-mode" aria-label="Photos Reel">
                  <LayoutGrid className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Photos Reel</span>
                </TabsTrigger>
                <TabsTrigger value="photo" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-photo-mode" aria-label="Reel IDs">
                  <Camera className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Reel IDs</span>
                </TabsTrigger>
                <TabsTrigger value="flagged" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-flagged-mode" aria-label="Flagged">
                  <Flag className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Flagged</span>
                </TabsTrigger>
                <TabsTrigger value="review" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-review-mode" aria-label="Review">
                  <ClipboardCheck className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Review</span>
                </TabsTrigger>
                <TabsTrigger value="results" className="flex-1 py-2.5 sm:py-1.5 text-white/70 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-results-mode" aria-label="Final Results">
                  <BarChart2 className="h-6 w-6 sm:h-4 sm:w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Final Results</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="strip">
                <PhotoStrip
                  sessionId={sessionId}
                  canEdit={canEditSession}
                  onJumpToPhoto={(photoId) => {
                    setNavigateToPhotoId(photoId);
                    setMode("photo");
                  }}
                  onClearUndoHistory={clearHistory}
                />
              </TabsContent>

              <TabsContent value="photo">
                <PhotoMode sessionId={sessionId} photos={photos} navigateToPhotoId={navigateToPhotoId} navigateAisle={navigateAisle} navigateSection={navigateSection} navigateToPinId={navigateToPinId} onNavigated={() => { setNavigateToPhotoId(null); setNavigateAisle(""); setNavigateSection(""); setNavigateToPinId(null); }} canEdit={canEditSession} initialPhotoIndex={session.lastPhotoIndex ?? 0} onPushUndo={pushUndo} onClearUndoHistory={clearHistory} undoRedoSignal={undoRedoSignal} onDraftPinsHint={(aisle, section) => setTableExpandKey(`${aisle}-${section}`)} pinRefreshSignal={pinRefreshSignal} onCurrentPhotoChange={(photoId) => { lastPhotoModePhotoIdRef.current = photoId; }} isAdmin={isOwner} onPinDataChanged={triggerPinRefresh} onlineUsers={onlineUsers} initialScanPanelOpen={initialScanPanelOpen} />
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

            <EntryTable
              entries={entries}
              photos={photos}
              onEdit={(entry) => { setEditingEntry(entry); }}
              sessionId={sessionId}
              totalFootage={displayTotalFootage}
              unitLabel={uLabel}
              currentUnit={currentUnit}
              onUndoableDelete={pushUndo}
              canEdit={canEditSession}
              forceExpandKey={tableExpandKey ?? undefined}
              onJumpToPin={(photoId, pinId) => {
                setNavigateToPhotoId(photoId);
                setNavigateToPinId(pinId);
                setMode("photo");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </>
        )}
      </div>

      {editingEntry && (
        <Dialog open={!!editingEntry} onOpenChange={(o) => { if (!o) { setEditingEntry(null); } }}>
          <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
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
              <SingleEntryMode sessionId={sessionId} editingEntry={editingEntry} onDoneEditing={() => { setEditingEntry(null); }} onUndoableSave={pushUndo} canEdit={canEditSession} />
              {canEditSession && (
                <div className="mt-4 pt-4 border-t border-destructive/20">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="w-full" data-testid="button-delete-entry-modal">
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
          updateSession.mutate({ name: editName, location: editLocation, description: editDescription });
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
      />

      <AlertDialog open={exportWarningOpen} onOpenChange={(open) => { setExportWarningOpen(open); if (!open) setPendingExportType(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Entries Without Photos</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-3">
                  {unpinnedEntries.length} {unpinnedEntries.length === 1 ? "entry has" : "entries have"} no linked photo
                  {pendingExportType === "pdf" ? " and will appear in the \"Entries Without Photos\" section of the PDF." : "."}
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
            <AlertDialogCancel onClick={() => setPendingExportType(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-export-anyway"
              onClick={async () => {
                setExportWarningOpen(false);
                const type = pendingExportType;
                setPendingExportType(null);
                if (type === "pdf") openQualityDialogDirect();
                else if (type === "excel") await doExportExcel();
              }}
            >
              Export Anyway
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
                  Generating…
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


