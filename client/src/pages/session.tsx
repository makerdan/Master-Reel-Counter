import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useIsMutating } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft, ArrowUp, Camera, ListPlus, Download, FileText, Mail, Undo2, Redo2, History,
  Lock, Unlock, Check, Loader2, AlertTriangle, Flag, Users, Smartphone, Monitor, Share2, Trash2, LayoutGrid,
} from "lucide-react";
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
import type { Session, Entry, Photo, Pin } from "@shared/schema";
import PhotoMode from "./session/PhotoMode";
import TeamDialog from "./session/TeamDialog";
import EntryTable from "./session/EntryTable";
import SingleEntryMode from "./session/SingleEntryMode";
import MobileCaptureView from "./session/MobileCaptureView";
import ActivityLog from "./session/ActivityLog";
import FlaggedReels from "./session/FlaggedReels";
import PhotoStrip from "./session/PhotoStrip";
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
      if (tab && ["photo", "single", "flagged"].includes(tab)) return tab;
    } catch {}
    return "photo";
  })();
  const [mode, setMode] = useState<string>(initialTab);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const previousModeRef = useRef<string | null>(null);
  const [editSessionOpen, setEditSessionOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [navigateToPhotoId, setNavigateToPhotoId] = useState<number | null>(null);
  const [navigateAisle, setNavigateAisle] = useState<string>("");
  const [navigateSection, setNavigateSection] = useState<string>("");
  const [editName, setEditName] = useState(session.name);
  const [editLocation, setEditLocation] = useState(session.location || "");
  const [editDescription, setEditDescription] = useState((session as any).description || "");

  useEffect(() => {
    const url = new URL(window.location.href);
    if (mode === "photo") {
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

  const { pushUndo, undo, redo, canUndo, canRedo } = useUndoRedo(sessionId);

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
        if (e.shiftKey) { redo(); } else { undo(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const totalFootage = entries.reduce((sum, e) => sum + (e.footage || 0), 0);

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
      if (previousModeRef.current) { setMode(previousModeRef.current); previousModeRef.current = null; }
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
    lines.push(`Total Footage: ${totalFootage.toLocaleString()} ft`);
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
        const parts = [e.reelTag || "Unknown", e.wireType, e.gauge, e.footage ? `${e.footage}ft` : "", e.color, e.manufacturer].filter(Boolean);
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
  const [pendingExportType, setPendingExportType] = useState<"pdf" | "csv" | null>(null);
  const unpinnedEntries = entries.filter(e => !pinByEntryId.has(e.id));

  const doExportCsv = async () => {
    try {
      const res = await apiRequest("GET", `/api/sessions/${sessionId}/export`);
      const data = await res.json();
      const exportEntries = data.entries || entries;
      const exportPhotos = data.photos || [];
      const photoMap = new Map(exportPhotos.map((p: any) => [p.id, p]));
      const headers = ["#", "Aisle", "Section", "Position", "Pallet ID", "Reel Tag", "Wire Type", "Gauge", "Footage", "Reel Count", "Conductors", "Color", "Manufacturer", "Notes", "Photo", "Photo Notes", "Detail Shot", "Parent Photo"];
      const rows = exportEntries.map((e: any, i: number) => {
        const photo = e.photoId ? photoMap.get(e.photoId) : null;
        const parentPhoto = photo?.parentPhotoId ? photoMap.get(photo.parentPhotoId) : null;
        return [
          i + 1, e.aisle, e.section, e.position || "", e.palletId || "", e.reelTag || "",
          e.wireType || "", e.gauge || "", e.footage || "", e.reelCount || 1,
          e.conductors || "", e.color || "", e.manufacturer || "", e.notes || "",
          photo?.originalFilename || "", photo?.notes || "",
          photo?.isDetailShot ? "Yes" : "", parentPhoto?.originalFilename || "",
        ];
      });
      const csv = [headers.join(","), ...rows.map((r: any[]) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildExportFilename(session, "csv");
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Failed to export CSV", variant: "destructive" });
    }
  };

  const exportCsv = async () => {
    if (unpinnedEntries.length > 0) {
      setPendingExportType("csv");
      setExportWarningOpen(true);
      return;
    }
    await doExportCsv();
  };

  const doExportPdf = async () => {
    try {
      const params = new URLSearchParams();
      if (userSettings?.companyName) params.set("companyName", userSettings.companyName);
      if (userSettings?.exportFooterText) params.set("footerText", userSettings.exportFooterText);
      const qs = params.toString();
      const res = await fetch(`/api/sessions/${sessionId}/export/pdf${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("PDF export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildExportFilename(session, "pdf");
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      const w = window.open("", "_blank");
      if (!w) return;
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const rowsHtml = entries.map((e, i) => `
        <tr>
          <td>${i + 1}</td><td>${esc(e.aisle)}</td><td>${esc(e.section)}</td><td>${esc(e.position || "")}</td>
          <td>${esc(e.palletId || "")}</td><td>${esc(e.reelTag || "")}</td><td>${esc(e.wireType || "")}</td>
          <td>${esc(e.gauge || "")}</td><td>${e.footage || ""}</td>
          <td>${e.reelCount || 1}</td><td>${esc(e.conductors || "")}</td><td>${esc(e.color || "")}</td><td>${esc(e.manufacturer || "")}</td>
          <td>${esc(e.notes || "")}</td>
        </tr>
      `).join("");
      w.document.write(`<!DOCTYPE html><html><head><title>${session.name} - Report</title>
        <style>body{font-family:Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%;margin-top:12px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}th{background:#f5f0eb}
        h1{font-size:18px}h2{font-size:14px;color:#666;margin-top:4px}.audit{margin-top:20px;font-size:10px;color:#999;border-top:1px solid #ddd;padding-top:8px}</style></head><body>
        ${userSettings?.companyName ? `<h1>${esc(userSettings.companyName)}</h1>` : ""}
        <h1>Master Reel Counter - ${session.name}</h1>
        <h2>Location: ${session.location || "N/A"} | Entries: ${entries.length} | Total Footage: ${totalFootage.toLocaleString()} ft</h2>
        <table><thead><tr><th>#</th><th>Aisle</th><th>Section</th><th>Position</th><th>Pallet ID</th><th>Reel Tag</th><th>Wire Type</th><th>Gauge</th><th>Footage</th><th>Reel Count</th><th>Conductors</th><th>Color</th><th>Manufacturer</th><th>Notes</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
        <div class="audit">Generated: ${new Date().toISOString()} | First photo: ${session.firstPhotoAt ? new Date(session.firstPhotoAt).toISOString() : "N/A"} | Last photo: ${session.lastPhotoAt ? new Date(session.lastPhotoAt).toISOString() : "N/A"}</div>
        ${userSettings?.exportFooterText ? `<div class="audit">${esc(userSettings.exportFooterText)}</div>` : ""}
        <script>setTimeout(()=>window.print(),500)</script></body></html>`);
      w.document.close();
    }
  };

  const exportPdf = async () => {
    if (unpinnedEntries.length > 0) {
      setPendingExportType("pdf");
      setExportWarningOpen(true);
      return;
    }
    await doExportPdf();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-x-hidden">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" onClick={() => setLocation("/")} data-testid="button-back">
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
                <Button size="icon" variant="ghost" onClick={undo} disabled={!canUndo} data-testid="button-undo" className="hidden sm:inline-flex h-8 w-8">
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" onClick={redo} disabled={!canRedo} data-testid="button-redo" className="hidden sm:inline-flex h-8 w-8">
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
                  <Button size="sm" variant="outline" onClick={() => setTeamDialogOpen(true)} data-testid="button-team">
                    <Users className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Team</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Manage team</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="outline" onClick={() => { if (!captureMode) { setMobileFlowKey(k => k + 1); } setCaptureMode(!captureMode); }} data-testid="button-toggle-mobile">
                  {captureMode ? <Monitor className="h-4 w-4 sm:mr-1" /> : <Smartphone className="h-4 w-4 sm:mr-1" />}
                  <span className="hidden sm:inline">{captureMode ? "Full Mode" : "Mobile Flow"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{captureMode ? "Switch to full mode" : "Switch to mobile capture mode"}</TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" data-testid="button-export" title="Export session data">
                  <Share2 className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportCsv} data-testid="button-export-csv">
                  <Download className="h-4 w-4 mr-2" />
                  CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportPdf} data-testid="button-export-pdf">
                  <FileText className="h-4 w-4 mr-2" />
                  PDF
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
          <Button size="icon" variant="ghost" onClick={undo} disabled={!canUndo} data-testid="button-undo-mobile" className="h-6 w-6" title="Undo" aria-label="Undo">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={redo} disabled={!canRedo} data-testid="button-redo-mobile" className="h-6 w-6" title="Redo" aria-label="Redo">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          <span className="mono text-xs text-muted-foreground">{formatSessionTimeMobile(session.firstPhotoAt, session.lastPhotoAt, tz)}</span>
        </div>
      </header>

      {showActivity && (
        <div className="border-b bg-card">
          <div className="max-w-5xl mx-auto w-full px-4">
            <div className="flex items-center gap-2 py-2 border-b border-border/50">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Activity Log
              </h3>
            </div>
            <ActivityLog sessionId={sessionId} />
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
          />
        ) : (
          <>
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList className="w-full bg-[hsl(25_12%_18%)] dark:bg-[hsl(25_8%_15%)] border border-[hsl(18_60%_30%/0.3)]">
                <TabsTrigger value="photo" className="flex-1 text-white/70 data-[state=active]:bg-[hsl(18_85%_32%)] data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-photo-mode" aria-label="Section Photo">
                  <Camera className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Section Photo</span>
                </TabsTrigger>
                <TabsTrigger value="single" className="flex-1 text-white/70 data-[state=active]:bg-[hsl(18_85%_32%)] data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-single-mode" aria-label="Single Entry">
                  <ListPlus className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Single Entry</span>
                </TabsTrigger>
                <TabsTrigger value="flagged" className="flex-1 text-white/70 data-[state=active]:bg-[hsl(45_85%_40%)] data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-flagged-mode" aria-label="Flagged">
                  <Flag className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Flagged</span>
                </TabsTrigger>
                <TabsTrigger value="strip" className="flex-1 text-white/70 data-[state=active]:bg-[hsl(200_70%_32%)] data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-strip-mode" aria-label="Photos Reel">
                  <LayoutGrid className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Photos Reel</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="photo">
                <PhotoMode sessionId={sessionId} photos={photos} navigateToPhotoId={navigateToPhotoId} navigateAisle={navigateAisle} navigateSection={navigateSection} onNavigated={() => { setNavigateToPhotoId(null); setNavigateAisle(""); setNavigateSection(""); }} canEdit={canEditSession} initialPhotoIndex={session.lastPhotoIndex ?? 0} />
              </TabsContent>

              <TabsContent value="single">
                <h2 className="sm:hidden text-lg font-bold underline flex items-center justify-center gap-2 mb-3 px-1 pt-1">
                  <ListPlus className="h-5 w-5" />
                  Single Entry
                </h2>
                <SingleEntryMode
                  sessionId={sessionId}
                  editingEntry={editingEntry}
                  onDoneEditing={() => setEditingEntry(null)}
                  onSwitchToPhoto={(photoId: number, aisleVal: string, sectionVal: string) => {
                    setNavigateToPhotoId(photoId);
                    setNavigateAisle(aisleVal);
                    setNavigateSection(sectionVal);
                    setMode("photo");
                  }}
                  onUndoableSave={pushUndo}
                  canEdit={canEditSession}
                />
              </TabsContent>

              <TabsContent value="flagged">
                <FlaggedReels
                  sessionId={sessionId}
                  onBack={() => setMode("photo")}
                  onReshoot={(aisleVal, sectionVal, parentPhotoId) => {
                    setMobileFlowInitialAisle(aisleVal);
                    setMobileFlowInitialSection(sectionVal);
                    setMobileFlowDetailParentPhotoId(parentPhotoId);
                    setCaptureMode(true);
                    setMobileFlowKey(k => k + 1);
                  }}
                />
              </TabsContent>

              <TabsContent value="strip">
                <PhotoStrip
                  sessionId={sessionId}
                  canEdit={canEditSession}
                  onJumpToPhoto={(photoId) => {
                    setNavigateToPhotoId(photoId);
                    setMode("photo");
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

        {mobileFlowDetailParentPhotoId == null && (
          <>
            <Separator />

            <EntryTable
              entries={entries}
              photos={photos}
              onEdit={(entry) => { previousModeRef.current = mode; setEditingEntry(entry); setMode("single"); }}
              sessionId={sessionId}
              totalFootage={totalFootage}
              onUndoableDelete={pushUndo}
              canEdit={canEditSession}
            />
          </>
        )}
      </div>

      {editingEntry && (
        <Dialog open={!!editingEntry} onOpenChange={(o) => { if (!o) { setEditingEntry(null); if (previousModeRef.current) { setMode(previousModeRef.current); previousModeRef.current = null; } } }}>
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
                    <img src={imgSrc} alt="Entry photo" className="w-full" style={{ display: "block" }} data-testid="img-edit-entry-photo" />
                    {pin && (
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
              <SingleEntryMode sessionId={sessionId} editingEntry={editingEntry} onDoneEditing={() => { setEditingEntry(null); if (previousModeRef.current) { setMode(previousModeRef.current); previousModeRef.current = null; } }} onUndoableSave={pushUndo} canEdit={canEditSession} />
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
                if (type === "pdf") await doExportPdf();
                else if (type === "csv") await doExportCsv();
              }}
            >
              Export Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


