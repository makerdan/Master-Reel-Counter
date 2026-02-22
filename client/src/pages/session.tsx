import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft, Camera, ListPlus, Download, FileText, Mail, Undo2, Redo2, History, MessageSquare,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Session, Entry, Photo } from "@shared/schema";
import PhotoMode from "./session/PhotoMode";
import TeamDialog from "./session/TeamDialog";
import EntryTable from "./session/EntryTable";
import SingleEntryMode from "./session/SingleEntryMode";
import MobileCaptureView from "./session/MobileCaptureView";
import ActivityLog from "./session/ActivityLog";
import Comments from "./session/Comments";
import { buildExportFilename, formatSessionTime } from "./session/utils";
import { useUndoRedo } from "@/hooks/use-undo";
import { useSessionWebSocket } from "@/hooks/use-websocket";

export default function SessionPage() {
  const [, params] = useRoute("/session/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const sessionId = params?.id ? parseInt(params.id) : 0;

  useEffect(() => {
    if (sessionId > 0) {
      try { localStorage.setItem("reel-counter-last-session", String(sessionId)); } catch {}
    }
  }, [sessionId]);

  const { data: session, isLoading: sessionLoading } = useQuery<Session & { firstPhotoAt: string | null; lastPhotoAt: string | null; role: "owner" | "editor" | "viewer"; collaboratorCount: number }>({
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

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-muted-foreground">Session not found</p>
            <Button variant="outline" className="mt-4" onClick={() => setLocation("/")}>
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
    />
  );
}

function SessionWorkspace({
  session, entries, entriesLoading, photos, sessionId,
}: {
  session: Session & { role?: "owner" | "editor" | "viewer"; collaboratorCount?: number };
  entries: Entry[];
  entriesLoading: boolean;
  photos: Photo[];
  sessionId: number;
}) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [mode, setMode] = useState<string>("photo");
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [editSessionOpen, setEditSessionOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [navigateToPhotoId, setNavigateToPhotoId] = useState<number | null>(null);
  const [navigateAisle, setNavigateAisle] = useState<string>("");
  const [navigateSection, setNavigateSection] = useState<string>("");
  const [editName, setEditName] = useState(session.name);
  const [editLocation, setEditLocation] = useState(session.location || "");

  const [captureMode, setCaptureMode] = useState(window.innerWidth < 768);
  const [mobileFlowKey, setMobileFlowKey] = useState(0);

  const [showActivity, setShowActivity] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const { pushUndo, undo, redo, canUndo, canRedo } = useUndoRedo(sessionId);

  useSessionWebSocket(sessionId);

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
    mutationFn: async ({ name, location }: { name: string; location: string }) => {
      const res = await apiRequest("PATCH", `/api/sessions/${sessionId}`, {
        name,
        location: location || null,
      });
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      queryClient.refetchQueries({ queryKey: ["/api/sessions"] });
      setEditSessionOpen(false);
      toast({ title: "Session updated" });
    },
    onError: () => {
      toast({ title: "Failed to update session", variant: "destructive" });
    },
  });


  const shareSession = () => {
    const lines: string[] = [];
    lines.push(`Session: ${session.name}`);
    if (session.location) lines.push(`Location: ${session.location}`);
    lines.push(`Entries: ${entries.length}`);
    lines.push(`Total Footage: ${totalFootage.toLocaleString()} ft`);
    lines.push(`Photos: ${photos.length}`);
    if (session.firstPhotoAt) {
      lines.push(`Time: ${formatSessionTime(session.firstPhotoAt, session.lastPhotoAt)}`);
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

    lines.push(`Generated: ${new Date().toLocaleString()}`);

    const subject = encodeURIComponent(`Wire Reel Count - ${session.name}`);
    const body = encodeURIComponent(lines.join("\n"));
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self");
  };

  const exportCsv = async () => {
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

  const exportPdf = async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export/pdf`, { credentials: "include" });
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
        <h1>Master Reel Counter - ${session.name}</h1>
        <h2>Location: ${session.location || "N/A"} | Entries: ${entries.length} | Total Footage: ${totalFootage.toLocaleString()} ft</h2>
        <table><thead><tr><th>#</th><th>Aisle</th><th>Section</th><th>Position</th><th>Pallet ID</th><th>Reel Tag</th><th>Wire Type</th><th>Gauge</th><th>Footage</th><th>Reel Count</th><th>Conductors</th><th>Color</th><th>Manufacturer</th><th>Notes</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
        <div class="audit">Generated: ${new Date().toISOString()} | First photo: ${session.firstPhotoAt ? new Date(session.firstPhotoAt).toISOString() : "N/A"} | Last photo: ${session.lastPhotoAt ? new Date(session.lastPhotoAt).toISOString() : "N/A"}</div>
        <script>setTimeout(()=>window.print(),500)</script></body></html>`);
      w.document.close();
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button size="icon" variant="ghost" onClick={() => setLocation("/")} data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 cursor-pointer" onClick={() => { setEditName(session.name); setEditLocation(session.location || ""); setEditSessionOpen(true); }}>
              <h1 className="text-sm font-semibold truncate" data-testid="text-session-name">{session.name}</h1>
              <span className="mono text-xs text-muted-foreground" data-testid="text-session-time">{formatSessionTime(session.firstPhotoAt, session.lastPhotoAt, captureMode)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" onClick={undo} disabled={!canUndo} data-testid="button-undo" className="h-8 w-8">
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={redo} disabled={!canRedo} data-testid="button-redo" className="h-8 w-8">
              <Redo2 className="h-4 w-4" />
            </Button>
            {(session as any).role === "owner" && (
              <Button size="sm" variant="outline" onClick={() => setTeamDialogOpen(true)} data-testid="button-team">
                Team
              </Button>
            )}
            <Button size="icon" variant={showComments ? "default" : "ghost"} onClick={() => { setShowComments(!showComments); setShowActivity(false); }} data-testid="button-toggle-comments">
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button size="icon" variant={showActivity ? "default" : "ghost"} onClick={() => { setShowActivity(!showActivity); setShowComments(false); }} data-testid="button-toggle-activity">
              <History className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => { if (!captureMode) { setMobileFlowKey(k => k + 1); } setCaptureMode(!captureMode); }} data-testid="button-toggle-mobile">
              {captureMode ? "Full Mode" : "Mobile Flow"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" data-testid="button-export">
                  Export
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
          </div>
        </div>
      </header>

      {(showActivity || showComments) && (
        <div className="border-b bg-card">
          <div className="max-w-5xl mx-auto w-full px-4">
            <div className="flex items-center gap-2 py-2 border-b border-border/50">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {showActivity ? "Activity Log" : "Comments"}
              </h3>
            </div>
            {showActivity && <ActivityLog sessionId={sessionId} />}
            {showComments && <Comments sessionId={sessionId} role={(session as any).role} />}
          </div>
        </div>
      )}

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-4 space-y-4">
        {captureMode ? (
          <MobileCaptureView key={mobileFlowKey} sessionId={sessionId} photos={photos} />
        ) : (
          <>
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList className="w-full bg-[hsl(25_12%_18%)] dark:bg-[hsl(25_8%_15%)] border border-[hsl(18_60%_30%/0.3)]">
                <TabsTrigger value="photo" className="flex-1 text-white/70 data-[state=active]:bg-[hsl(18_85%_32%)] data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-photo-mode">
                  <Camera className="h-4 w-4 mr-1" />
                  Section Photo
                </TabsTrigger>
                <TabsTrigger value="single" className="flex-1 text-white/70 data-[state=active]:bg-[hsl(18_85%_32%)] data-[state=active]:text-white data-[state=active]:shadow-md" data-testid="tab-single-mode">
                  <ListPlus className="h-4 w-4 mr-1" />
                  Single Entry
                </TabsTrigger>
              </TabsList>

              <TabsContent value="photo">
                <PhotoMode sessionId={sessionId} photos={photos} navigateToPhotoId={navigateToPhotoId} navigateAisle={navigateAisle} navigateSection={navigateSection} onNavigated={() => { setNavigateToPhotoId(null); setNavigateAisle(""); setNavigateSection(""); }} />
              </TabsContent>

              <TabsContent value="single">
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
                />
              </TabsContent>
            </Tabs>
          </>
        )}

        <Separator />

        <EntryTable
          entries={entries}
          photos={photos}
          onEdit={(entry) => { setEditingEntry(entry); setMode("single"); }}
          sessionId={sessionId}
          totalFootage={totalFootage}
          onUndoableDelete={pushUndo}
        />
      </div>

      {editingEntry && (
        <Dialog open={!!editingEntry} onOpenChange={(o) => { if (!o) setEditingEntry(null); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Entry #{editingEntry.id}</DialogTitle>
            </DialogHeader>
            {editingEntry.photoId && (() => {
              const photo = photos.find(p => p.id === editingEntry.photoId);
              if (!photo) return null;
              const imgSrc = photo.objectStorageKey.startsWith("/uploads/") ? photo.objectStorageKey : `/uploads/${photo.objectStorageKey}`;
              return (
                <div className="rounded-md overflow-hidden border border-border/50 mb-2">
                  <img src={imgSrc} alt="Entry photo" className="w-full max-h-48 object-cover" data-testid="img-edit-entry-photo" />
                </div>
              );
            })()}
            <SingleEntryMode sessionId={sessionId} editingEntry={editingEntry} onDoneEditing={() => setEditingEntry(null)} onUndoableSave={pushUndo} />
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={editSessionOpen} onOpenChange={setEditSessionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Session</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editName.trim()) updateSession.mutate({ name: editName, location: editLocation });
            }}
            className="space-y-4"
          >
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
            <Button
              type="submit"
              className="w-full"
              disabled={!editName.trim() || updateSession.isPending}
              data-testid="button-save-session-edit"
            >
              {updateSession.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <TeamDialog
        open={teamDialogOpen}
        onOpenChange={setTeamDialogOpen}
        sessionId={sessionId}
        sessionName={session.name}
        isOwner={(session as any).role === "owner"}
      />
    </div>
  );
}


