import { useState, useRef, useCallback, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft, Camera, ListPlus, Plus, Trash2, Pencil, Download, FileText,
  RotateCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, ChevronDown, Cable,
  Save, X, Loader2, RotateCcw, AlertTriangle, Move, StickyNote, Focus, Eye,
  Users, Copy, Link, Mail, UserPlus, UserMinus, ImagePlus, Crosshair, ArrowUpDown, AlertCircle,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { correctWireDetails, WIRE_TYPES as REF_WIRE_TYPES, WIRE_GAUGES, WIRE_COLORS, COLOR_CODES, VENDOR_CODES, lookupCategory, PARSED_CATALOG, type ParsedCatalogEntry } from "@/lib/wireReference";
import type { Session, Entry, Photo, Pin, Collaborator, InviteLink } from "@shared/schema";

const WIRE_TYPES = [...REF_WIRE_TYPES];
const GAUGES = [...WIRE_GAUGES];
const POSITIONS = ["On Floor", "In Front Of", "900", "800", "700", "600", "500", "400", "__none__"];
const COLOR_OPTIONS = [
  { value: "__none__", label: "-- None --" },
  ...Object.entries(WIRE_COLORS).map(([code, name]) => ({
    value: name,
    label: `(${code})  ${name}`,
  })).sort((a, b) => a.label.localeCompare(b.label)),
];

const VENDOR_CODE_MAP: Record<string, string[]> = {
  COP: ["THHN", "TC", "RX", "UF", "BARE"],
  ALU: ["XHHW", "URD", "TRIPLEX", "MHF"],
  COR: ["SEOOW", "SJEOO", "SJEW"],
  ALF: ["ALF", "SGF", "LT", "LTNM"],
};

function deriveVendorCode(wireDetails: string): string | undefined {
  if (!wireDetails) return undefined;
  const upper = wireDetails.toUpperCase();
  for (const [code, types] of Object.entries(VENDOR_CODE_MAP)) {
    for (const t of types) {
      if (upper.startsWith(t)) return code;
    }
  }
  return undefined;
}

interface LocalPin {
  id: string;
  x: number;
  y: number;
  label: string;
  reelCount: number;
  wireDetails?: string;
  vendorCode?: string;
  footage?: number;
}

function ReelCropPreview({ photoUrl, pinX, pinY, label, cropMode, onCropModeChange, onClose }: { photoUrl: string; pinX: number; pinY: number; label: string; cropMode: "closeup" | "wide"; onCropModeChange: (mode: "closeup" | "wide") => void; onClose?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const DISPLAY_SIZE = 320;
  const fraction = cropMode === "closeup" ? 0.15 : 0.07;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cropW = img.width * fraction;
      const cropH = img.height * fraction;
      const cx = (pinX / 100) * img.width;
      const cy = (pinY / 100) * img.height;
      let sx = cx - cropW / 2;
      let sy = cy - cropH / 2;
      sx = Math.max(0, Math.min(sx, img.width - cropW));
      sy = Math.max(0, Math.min(sy, img.height - cropH));
      canvas.width = DISPLAY_SIZE * 2;
      canvas.height = DISPLAY_SIZE * 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
    };
    img.src = photoUrl;
  }, [photoUrl, pinX, pinY, fraction]);

  return (
    <div className="space-y-1" data-testid="reel-crop-preview">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 flex-wrap">
        <Focus className="h-3 w-3" />
        Reel Preview — {label}
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors ${cropMode === "closeup" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover-elevate"}`}
            onClick={() => onCropModeChange("closeup")}
            data-testid="button-crop-closeup"
          >
            Close-up
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors ${cropMode === "wide" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover-elevate"}`}
            onClick={() => onCropModeChange("wide")}
            data-testid="button-crop-wide"
          >
            Wide Shot
          </button>
          {onClose && (
            <button
              type="button"
              className="ml-1 p-0.5 rounded text-muted-foreground hover-elevate"
              onClick={onClose}
              data-testid="button-close-preview"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="rounded-md border border-border/50 overflow-hidden bg-black inline-block">
        <canvas
          ref={canvasRef}
          className="block"
          style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE }}
          data-testid="reel-crop-canvas"
        />
      </div>
    </div>
  );
}

function formatSessionTime(firstPhotoAt: string | Date | null, lastPhotoAt: string | Date | null, elapsedOnly = false) {
  if (!firstPhotoAt) return "No photos yet";
  const fmt = (d: string | Date) => new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  if (!lastPhotoAt || new Date(firstPhotoAt).getTime() === new Date(lastPhotoAt).getTime()) {
    return elapsedOnly ? "0m" : fmt(firstPhotoAt);
  }
  const diff = new Date(lastPhotoAt).getTime() - new Date(firstPhotoAt).getTime();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const elapsed = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  if (elapsedOnly) return elapsed;
  return `${fmt(firstPhotoAt)} - ${fmt(lastPhotoAt)} (${elapsed})`;
}

export default function SessionPage() {
  const [, params] = useRoute("/session/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const sessionId = params?.id ? parseInt(params.id) : 0;

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
      a.download = `${session.name.replace(/\s+/g, "_")}_entries.csv`;
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
      a.download = `${session.name.replace(/\s+/g, "_")}_report.pdf`;
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
            {(session as any).role === "owner" && (
              <Button size="sm" variant="outline" onClick={() => setTeamDialogOpen(true)} data-testid="button-team">
                Team
              </Button>
            )}
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
                />
              </TabsContent>
            </Tabs>
          </>
        )}

        <Separator />

        <EntryTable
          entries={entries}
          loading={entriesLoading}
          totalFootage={totalFootage}
          sessionId={sessionId}
          onEdit={(entry) => { setEditingEntry(entry); setMode("single"); }}
          photos={photos}
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
            <SingleEntryMode sessionId={sessionId} editingEntry={editingEntry} onDoneEditing={() => setEditingEntry(null)} />
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

function TeamDialog({
  open, onOpenChange, sessionId, sessionName, isOwner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: number;
  sessionName: string;
  isOwner: boolean;
}) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  const { data: collaboratorsData } = useQuery<{ collaborators: Collaborator[]; owner: { userId: string } }>({
    queryKey: ["/api/sessions", sessionId.toString(), "collaborators"],
    enabled: open,
  });

  const { data: inviteLinks = [] } = useQuery<InviteLink[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "invite-links"],
    enabled: open && isOwner,
  });

  const addCollaborator = useMutation({
    mutationFn: async (uname: string) => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/collaborators`, { username: uname });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Collaborator added" });
      setUsername("");
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "collaborators"] });
    },
    onError: async (error: any) => {
      let message = "Failed to add collaborator";
      try { message = (await error)?.message || message; } catch {}
      toast({ title: message, variant: "destructive" });
    },
  });

  const removeCollaborator = useMutation({
    mutationFn: async (collabId: number) => {
      await apiRequest("DELETE", `/api/sessions/${sessionId}/collaborators/${collabId}`);
    },
    onSuccess: () => {
      toast({ title: "Collaborator removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "collaborators"] });
    },
    onError: () => {
      toast({ title: "Failed to remove collaborator", variant: "destructive" });
    },
  });

  const generateLink = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/invite-links`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "invite-links"] });
      toast({ title: "Invite link generated" });
    },
    onError: () => {
      toast({ title: "Failed to generate invite link", variant: "destructive" });
    },
  });

  const revokeLink = useMutation({
    mutationFn: async (linkId: number) => {
      await apiRequest("DELETE", `/api/invite-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "invite-links"] });
      toast({ title: "Invite link revoked" });
    },
    onError: () => {
      toast({ title: "Failed to revoke link", variant: "destructive" });
    },
  });

  const sendEmailInvite = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/invite-links`);
      return res.json();
    },
    onSuccess: (link: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "invite-links"] });
      const inviteUrl = `${window.location.origin}/join/${link.token}`;
      const subject = encodeURIComponent(`You've been invited to count reels - ${sessionName}`);
      const body = encodeURIComponent(`You've been invited to collaborate on the counting session '${sessionName}'. Click the link to join: ${inviteUrl}`);
      window.open(`mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`, "_self");
      setEmail("");
      toast({ title: "Email client opened" });
    },
    onError: () => {
      toast({ title: "Failed to generate invite link", variant: "destructive" });
    },
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Link copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const activeLinks = inviteLinks.filter((l: any) => l.isActive);
  const collaborators = collaboratorsData?.collaborators || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="dialog-team">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Team Management
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="username" className="w-full">
          <TabsList className="w-full" data-testid="tabs-invite-method">
            <TabsTrigger value="username" className="flex-1" data-testid="tab-invite-username">
              <UserPlus className="h-3 w-3 mr-1" />
              Username
            </TabsTrigger>
            <TabsTrigger value="link" className="flex-1" data-testid="tab-invite-link">
              <Link className="h-3 w-3 mr-1" />
              Share Link
            </TabsTrigger>
            <TabsTrigger value="email" className="flex-1" data-testid="tab-invite-email">
              <Mail className="h-3 w-3 mr-1" />
              Email
            </TabsTrigger>
          </TabsList>

          <TabsContent value="username" className="space-y-3 mt-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (username.trim()) addCollaborator.mutate(username.trim());
              }}
              className="flex items-center gap-2"
            >
              <Input
                placeholder="Replit username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                data-testid="input-collaborator-username"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!username.trim() || addCollaborator.isPending}
                data-testid="button-add-collaborator"
              >
                {addCollaborator.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Add"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="link" className="space-y-3 mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => generateLink.mutate()}
              disabled={generateLink.isPending}
              data-testid="button-generate-link"
            >
              {generateLink.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Link className="h-3 w-3 mr-1" />}
              Generate Link
            </Button>
            {activeLinks.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Active invite links:</p>
                {activeLinks.map((link: any) => {
                  const fullUrl = `${window.location.origin}/join/${link.token}`;
                  return (
                    <div key={link.id} className="flex items-center gap-2 text-xs" data-testid={`invite-link-${link.id}`}>
                      <code className="flex-1 truncate bg-muted px-2 py-1 rounded text-xs" data-testid={`text-invite-url-${link.id}`}>
                        {fullUrl}
                      </code>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button size="sm" variant="ghost" onClick={() => copyToClipboard(fullUrl)} data-testid={`button-copy-link-${link.id}`}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copy link</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button size="sm" variant="ghost" onClick={() => revokeLink.mutate(link.id)} disabled={revokeLink.isPending} data-testid={`button-revoke-link-${link.id}`}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="email" className="space-y-3 mt-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) sendEmailInvite.mutate();
              }}
              className="flex items-center gap-2"
            >
              <Input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-invite-email"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!email.trim() || sendEmailInvite.isPending}
                data-testid="button-send-email-invite"
              >
                {sendEmailInvite.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send Invite"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        {collaborators.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground">Team Members ({collaborators.length})</p>
            {collaborators.map((collab: any) => (
              <div key={collab.id} className="flex items-center justify-between gap-2" data-testid={`collaborator-${collab.id}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm truncate" data-testid={`text-collaborator-username-${collab.id}`}>
                    {collab.username || collab.userId}
                  </span>
                  <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs" data-testid={`badge-collaborator-role-${collab.id}`}>
                    {collab.role}
                  </Badge>
                </div>
                {isOwner && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeCollaborator.mutate(collab.id)}
                    disabled={removeCollaborator.isPending}
                    data-testid={`button-remove-collaborator-${collab.id}`}
                  >
                    <UserMinus className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PhotoMode({ sessionId, photos, navigateToPhotoId, navigateAisle, navigateSection, onNavigated }: { sessionId: number; photos: Photo[]; navigateToPhotoId?: number | null; navigateAisle?: string; navigateSection?: string; onNavigated?: () => void }) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [aisle, setAisle] = useState("");
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{ url: string; objectPath: string; section: string; aisle?: string; dbId?: number; filename?: string; timestamp?: string; notes?: string; isDetailShot?: boolean; parentPhotoId?: number; pinScale?: number }>>([]);
  const [currentPhotoIdx, setCurrentPhotoIdx] = useState(0);
  const [viewingNearbyIdx, setViewingNearbyIdx] = useState<number | null>(null);

  const { data: incompletePinsData } = useQuery<{ photoId: number; incompleteCount: number }[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"],
    enabled: sessionId > 0,
    refetchInterval: 10000,
  });

  const incompletePinsMap = new Map<number, number>();
  if (incompletePinsData) {
    for (const item of incompletePinsData) {
      incompletePinsMap.set(item.photoId, item.incompleteCount);
    }
  }

  const totalIncompletePins = incompletePinsData ? incompletePinsData.reduce((sum, item) => sum + item.incompleteCount, 0) : 0;

  useEffect(() => {
    if (viewingNearbyIdx !== null && viewingNearbyIdx >= uploadedPhotos.length) {
      setViewingNearbyIdx(null);
    }
  }, [uploadedPhotos.length, viewingNearbyIdx]);

  useEffect(() => {
    if (viewingNearbyIdx === null || viewingNearbyIdx === currentPhotoIdx) {
      setNearbyCommittedPins([]);
      return;
    }
    const nearbyPhoto = uploadedPhotos[viewingNearbyIdx];
    if (!nearbyPhoto?.dbId) {
      setNearbyCommittedPins([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/photos/${nearbyPhoto.dbId}/pins`);
        const dbPins: Pin[] = await res.json();
        if (cancelled) return;
        const committed = dbPins.filter(p => !!p.entryId);
        setNearbyCommittedPins(committed.map(p => ({
          id: `nearby-committed-${p.id}`,
          x: p.xPercent,
          y: p.yPercent,
          label: p.label || "01",
          reelCount: p.reelCount || 1,
        })));
      } catch {
        if (!cancelled) setNearbyCommittedPins([]);
      }
    })();
    return () => { cancelled = true; };
  }, [viewingNearbyIdx, currentPhotoIdx, uploadedPhotos]);
  const [localPins, _setLocalPins] = useState<LocalPin[]>([]);
  const localPinsRef = useRef<LocalPin[]>([]);
  const setLocalPins = useCallback((updater: LocalPin[] | ((prev: LocalPin[]) => LocalPin[])) => {
    _setLocalPins((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localPinsRef.current = next;
      return next;
    });
  }, []);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [committedPins, setCommittedPins] = useState<Array<{ id: string; dbId?: number; x: number; y: number; label: string; reelCount: number }>>([]);
  const [nearbyCommittedPins, setNearbyCommittedPins] = useState<Array<{ id: string; x: number; y: number; label: string; reelCount: number }>>([]);
  const [pinsLoaded, setPinsLoaded] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutoSave = useRef(false);
  const [relabelPinId, setRelabelPinId] = useState<string | null>(null);
  const [relabelValue, setRelabelValue] = useState("");
  const dragRef = useRef<{
    isDragging: boolean;
    pinId: string | null;
    startX: number;
    startY: number;
    moved: boolean;
  }>({ isDragging: false, pinId: null, startX: 0, startY: 0, moved: false });
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; errors: string[] } | null>(null);
  const [activeSuggestionPin, setActiveSuggestionPin] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ParsedCatalogEntry[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);

  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [pinScale, setPinScale] = useState(1);
  const [cropMode, setCropMode] = useState<"closeup" | "wide">("closeup");
  const pinScaleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const photoImgRef = useRef<HTMLImageElement>(null);
  const [photoNotes, setPhotoNotes] = useState("");
  const [isDetailShot, setIsDetailShot] = useState(false);
  const [parentPhotoId, setParentPhotoId] = useState<number | undefined>(undefined);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aisleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clampPan = useCallback((px: number, py: number, s: number) => {
    const el = containerRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const maxPanX = (rect.width * (s - 1)) / (2 * s);
    const maxPanY = (rect.height * (s - 1)) / (2 * s);
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, px)),
      y: Math.max(-maxPanY, Math.min(maxPanY, py)),
    };
  }, []);

  useEffect(() => {
    const clamped = clampPan(panX, panY, scale);
    if (clamped.x !== panX || clamped.y !== panY) {
      setPanX(clamped.x);
      setPanY(clamped.y);
    }
  }, [scale, panX, panY, clampPan]);

  const currentPhoto = uploadedPhotos[currentPhotoIdx];
  const displayedPhotoIdx = viewingNearbyIdx !== null ? viewingNearbyIdx : currentPhotoIdx;
  const displayedPhoto = uploadedPhotos[displayedPhotoIdx];

  useEffect(() => {
    if (photos.length === 0) return;
    const shouldFullSync = uploadedPhotos.length === 0;
    const needsNavTarget = navigateToPhotoId && !uploadedPhotos.some(p => p.dbId === navigateToPhotoId) && photos.some(p => p.id === navigateToPhotoId);
    if (!shouldFullSync && !needsNavTarget) return;
    const mapped = photos.map((p) => {
      const filename = p.originalFilename || `Photo_${p.id}`;
      return {
        url: p.objectStorageKey.startsWith("/uploads/") ? p.objectStorageKey : p.objectStorageKey.startsWith("/objects/") ? p.objectStorageKey : `/uploads/${p.objectStorageKey}`,
        objectPath: p.objectStorageKey,
        section: p.section || "",
        aisle: p.aisle || "",
        dbId: p.id,
        filename,
        timestamp: p.createdAt ? new Date(p.createdAt).toLocaleString() : undefined,
        notes: p.notes || "",
        isDetailShot: p.isDetailShot || false,
        parentPhotoId: p.parentPhotoId || undefined,
        pinScale: p.pinScale ?? 1,
      };
    });
    mapped.sort((a, b) => {
      const aisleA = (a.aisle || "").toLowerCase();
      const aisleB = (b.aisle || "").toLowerCase();
      if (aisleA !== aisleB) return aisleA.localeCompare(aisleB);
      const secA = parseInt(a.section || "0", 10) || 0;
      const secB = parseInt(b.section || "0", 10) || 0;
      if (secA !== secB) return secA - secB;
      return (a.dbId || 0) - (b.dbId || 0);
    });
    setUploadedPhotos(mapped);
    if (!navigateToPhotoId) {
      const firstAisle = mapped.find(p => p.aisle)?.aisle;
      if (firstAisle && !aisle) setAisle(firstAisle);
    }
  }, [photos, navigateToPhotoId]);

  useEffect(() => {
    if (!navigateToPhotoId) return;
    const idx = uploadedPhotos.findIndex(p => p.dbId === navigateToPhotoId);
    if (idx >= 0) {
      setCurrentPhotoIdx(idx);
      setViewingNearbyIdx(null);
      setAisle(navigateAisle || "");
      if (navigateSection) {
        setUploadedPhotos(prev => prev.map((p, i) => i === idx ? { ...p, section: navigateSection } : p));
      }
      onNavigated?.();
    }
  }, [navigateToPhotoId, uploadedPhotos]);

  useEffect(() => {
    const photo = uploadedPhotos[currentPhotoIdx];
    if (photo) {
      setAisle(photo.aisle || "");
    }
  }, [currentPhotoIdx, uploadedPhotos]);

  const flushSavePins = useCallback(async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const photoDbId = uploadedPhotos[currentPhotoIdx]?.dbId;
    const pins = localPinsRef.current;
    if (!photoDbId) return;
    try {
      await apiRequest("PUT", `/api/photos/${photoDbId}/draft-pins`, {
        pins: pins.map(p => ({
          xPercent: p.x,
          yPercent: p.y,
          label: p.label,
          reelCount: p.reelCount,
          wireDetails: p.wireDetails || null,
          vendorCode: p.vendorCode || null,
          footage: p.footage || null,
        })),
      });
    } catch {
    }
  }, [uploadedPhotos, currentPhotoIdx]);

  useEffect(() => {
    if (!currentPhoto?.dbId) {
      setPinsLoaded(false);
      return;
    }
    setPinsLoaded(false);
    skipAutoSave.current = true;
    const loadPins = async () => {
      try {
        const res = await apiRequest("GET", `/api/photos/${currentPhoto.dbId}/pins`);
        const dbPins: Pin[] = await res.json();
        const draftPins = dbPins.filter(p => !p.entryId);
        const committed = dbPins.filter(p => !!p.entryId);
        setCommittedPins(committed.map(p => ({
          id: `committed-${p.id}`,
          dbId: p.id,
          x: p.xPercent,
          y: p.yPercent,
          label: p.label || "01",
          reelCount: p.reelCount || 1,
        })));
        if (draftPins.length > 0) {
          setLocalPins(draftPins.map(p => ({
            id: `pin-${p.id}`,
            x: p.xPercent,
            y: p.yPercent,
            label: p.label || "01",
            reelCount: p.reelCount || 1,
            wireDetails: p.wireDetails || undefined,
            vendorCode: p.vendorCode || undefined,
            footage: p.footage || undefined,
          })));
        } else {
          setLocalPins([]);
        }
      } catch {
        setLocalPins([]);
      }
      setPinsLoaded(true);
      setTimeout(() => { skipAutoSave.current = false; }, 500);
    };
    loadPins();
  }, [currentPhoto?.dbId]);

  useEffect(() => {
    if (pinScaleSaveTimer.current) {
      clearTimeout(pinScaleSaveTimer.current);
      pinScaleSaveTimer.current = null;
    }
    setPinScale(displayedPhoto?.pinScale ?? 1);
  }, [displayedPhoto?.dbId]);

  const savePinScale = useCallback((newScale: number) => {
    const clamped = Math.max(0.5, Math.min(5, newScale));
    setPinScale(clamped);
    const photoId = displayedPhoto?.dbId;
    if (!photoId) return;
    setUploadedPhotos(prev => prev.map(p => p.dbId === photoId ? { ...p, pinScale: clamped } : p));
    if (pinScaleSaveTimer.current) clearTimeout(pinScaleSaveTimer.current);
    pinScaleSaveTimer.current = setTimeout(async () => {
      try {
        await apiRequest("PATCH", `/api/photos/${photoId}`, { pinScale: clamped });
      } catch {}
    }, 500);
  }, [displayedPhoto?.dbId]);

  useEffect(() => {
    if (!currentPhoto?.dbId || !pinsLoaded || skipAutoSave.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await apiRequest("PUT", `/api/photos/${currentPhoto.dbId}/draft-pins`, {
          pins: localPins.map(p => ({
            xPercent: p.x,
            yPercent: p.y,
            label: p.label,
            reelCount: p.reelCount,
            wireDetails: p.wireDetails || null,
            vendorCode: p.vendorCode || null,
            footage: p.footage || null,
          })),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
      } catch {
      }
    }, 1000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [localPins, currentPhoto?.dbId, pinsLoaded]);

  useEffect(() => {
    if (noteSaveTimer.current) {
      clearTimeout(noteSaveTimer.current);
      noteSaveTimer.current = null;
    }
    if (sectionSaveTimer.current) {
      clearTimeout(sectionSaveTimer.current);
      sectionSaveTimer.current = null;
    }
    if (aisleSaveTimer.current) {
      clearTimeout(aisleSaveTimer.current);
      aisleSaveTimer.current = null;
    }
    if (currentPhoto) {
      setPhotoNotes(currentPhoto.notes || "");
      setIsDetailShot(currentPhoto.isDetailShot || false);
      setParentPhotoId(currentPhoto.parentPhotoId);
    }
  }, [currentPhotoIdx, currentPhoto?.dbId]);

  const savePhotoMeta = useCallback(async (notes: string, detail: boolean, parentId: number | undefined) => {
    if (!currentPhoto?.dbId) return;
    try {
      await apiRequest("PATCH", `/api/photos/${currentPhoto.dbId}`, {
        notes: notes || null,
        isDetailShot: detail,
        parentPhotoId: parentId || null,
      });
      setUploadedPhotos((prev) =>
        prev.map((p, i) =>
          i === currentPhotoIdx ? { ...p, notes, isDetailShot: detail, parentPhotoId: parentId } : p
        )
      );
    } catch {}
  }, [currentPhoto?.dbId, currentPhotoIdx]);

  const handleNotesChange = useCallback((val: string) => {
    setPhotoNotes(val);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      savePhotoMeta(val, isDetailShot, parentPhotoId);
    }, 1200);
  }, [savePhotoMeta, isDetailShot, parentPhotoId]);

  const handleDetailShotToggle = useCallback((checked: boolean) => {
    setIsDetailShot(checked);
    if (!checked) {
      setParentPhotoId(undefined);
      savePhotoMeta(photoNotes, checked, undefined);
    } else {
      savePhotoMeta(photoNotes, checked, parentPhotoId);
    }
  }, [savePhotoMeta, photoNotes, parentPhotoId]);

  const handleParentPhotoChange = useCallback((val: string) => {
    const id = val ? parseInt(val) : undefined;
    setParentPhotoId(id);
    savePhotoMeta(photoNotes, isDetailShot, id);
  }, [savePhotoMeta, photoNotes, isDetailShot]);

  const parentPhotoOptions = uploadedPhotos.filter((p, i) => i !== currentPhotoIdx && p.dbId && !p.isDetailShot);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      try {
        const result = await uploadFile(file);
        if (!result) {
          toast({ title: "Upload failed", description: `Could not upload ${file.name}. Please try again.`, variant: "destructive" });
          continue;
        }
        const res = await apiRequest("POST", `/api/sessions/${sessionId}/photos`, {
          objectStorageKey: result.objectPath,
          originalFilename: file.name,
          mimeType: file.type,
          aisle,
          section: "",
        });
        const savedPhoto = await res.json();
        const photoUrl = result.objectPath;
        setUploadedPhotos((prev) => {
          const existingCount = prev.filter((p) => p.filename?.replace(/_\d+(?=\.\w+$)/, "") === file.name || p.filename === file.name).length;
          const dotIdx = file.name.lastIndexOf(".");
          const base = dotIdx > 0 ? file.name.substring(0, dotIdx) : file.name;
          const ext = dotIdx > 0 ? file.name.substring(dotIdx) : "";
          const numberedName = `${base}_${String(existingCount + prev.length + 1).padStart(4, "0")}${ext}`;
          return [...prev, {
            url: photoUrl,
            objectPath: result.objectPath,
            section: "",
            aisle: aisle || "",
            dbId: savedPhoto.id,
            filename: numberedName,
            timestamp: new Date().toLocaleString(),
          }];
        });
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      } catch (err) {
        console.error("Photo upload error:", err);
        toast({ title: "Upload failed", description: `Error uploading ${file.name}: ${err instanceof Error ? err.message : "Unknown error"}`, variant: "destructive" });
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (isPanning || panMode) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const rawX = (e.clientX - rect.left) / rect.width;
    const rawY = (e.clientY - rect.top) / rect.height;

    if (rawX < 0.048 || rawX > 0.952) return;

    const cx = 0.5, cy = 0.5;
    let relX = rawX - cx;
    let relY = rawY - cy;

    relX /= scale;
    relY /= scale;

    relX -= panX / rect.width;
    relY -= panY / rect.height;

    const rad = -(rotation * Math.PI) / 180;
    const rotatedX = relX * Math.cos(rad) - relY * Math.sin(rad);
    const rotatedY = relX * Math.sin(rad) + relY * Math.cos(rad);

    const x = (rotatedX + cx) * 100;
    const y = (rotatedY + cy) * 100;

    if (x < 0 || x > 100 || y < 0 || y > 100) return;

    const existingNumbers = [
      ...localPins.map((p) => parseInt(p.label, 10)),
      ...committedPins.map((p) => parseInt(p.label, 10)),
    ].filter((n) => !isNaN(n));
    let nextNumber = 1;
    while (existingNumbers.includes(nextNumber)) {
      nextNumber++;
    }
    const newPin: LocalPin = {
      id: `pin-${Date.now()}`,
      x,
      y,
      label: String(nextNumber).padStart(2, "0"),
      reelCount: 1,
    };
    setLocalPins((prev) => [...prev, newPin]);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".pin-marker")) return;
    if (!panMode && scale <= 1) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX, panY };
    containerRef.current?.classList.add("grabbing");
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    const rawX = panStart.current.panX + dx / scale;
    const rawY = panStart.current.panY + dy / scale;
    const clamped = clampPan(rawX, rawY, scale);
    setPanX(clamped.x);
    setPanY(clamped.y);
  }, [isPanning, scale, clampPan]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    containerRef.current?.classList.remove("grabbing");
  }, []);

  useEffect(() => {
    if (isPanning) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isPanning, handleMouseMove, handleMouseUp]);

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panXRef = useRef(panX);
  panXRef.current = panX;
  const panYRef = useRef(panY);
  panYRef.current = panY;

  const zoomAtPoint = useCallback((clientX: number, clientY: number, newScale: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const oldScale = scaleRef.current;
    if (newScale === oldScale) return;
    const cursorX = (clientX - rect.left) / rect.width - 0.5;
    const cursorY = (clientY - rect.top) / rect.height - 0.5;
    const adjX = panXRef.current + cursorX * (1 / newScale - 1 / oldScale) * rect.width;
    const adjY = panYRef.current + cursorY * (1 / newScale - 1 / oldScale) * rect.height;
    const clamped = clampPan(adjX, adjY, newScale);
    setScale(newScale);
    setPanX(clamped.x);
    setPanY(clamped.y);
  }, [clampPan]);

  const zoomAtPointRef = useRef(zoomAtPoint);
  zoomAtPointRef.current = zoomAtPoint;

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      if (target.closest(".photo-scroll-strip") || target.closest(".photo-overlay-controls")) return;
      e.preventDefault();
      e.stopPropagation();
      const oldScale = scaleRef.current;
      const delta = e.ctrlKey ? -e.deltaY * 0.01 : (e.deltaY < 0 ? 0.2 : -0.2);
      const newScale = Math.min(5, Math.max(1, oldScale + delta));
      zoomAtPointRef.current(e.clientX, e.clientY, newScale);
    };

    const onGestureStart = (e: Event) => {
      const el = containerRef.current;
      if (el && el.contains(e.target as Node)) e.preventDefault();
    };
    const onGestureChange = (e: Event) => {
      const el = containerRef.current;
      if (el && el.contains(e.target as Node)) e.preventDefault();
    };

    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("gesturestart", onGestureStart, { passive: false } as any);
    document.addEventListener("gesturechange", onGestureChange, { passive: false } as any);
    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("gesturestart", onGestureStart);
      document.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  const pinchRef = useRef<{ dist: number; midX: number; midY: number; scale: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchRef.current = {
        dist: Math.hypot(dx, dy),
        midX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        midY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        scale: scaleRef.current,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchRef.current.dist;
      const newScale = Math.min(5, Math.max(1, pinchRef.current.scale * ratio));
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomAtPoint(midX, midY, newScale);
    }
  }, [zoomAtPoint]);

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const screenToImagePercent = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const rawX = (clientX - rect.left) / rect.width;
    const rawY = (clientY - rect.top) / rect.height;
    const cx = 0.5, cy = 0.5;
    let relX = rawX - cx;
    let relY = rawY - cy;
    relX /= scale;
    relY /= scale;
    relX -= panX / rect.width;
    relY -= panY / rect.height;
    const rad = -(rotation * Math.PI) / 180;
    const rX = relX * Math.cos(rad) - relY * Math.sin(rad);
    const rY = relX * Math.sin(rad) + relY * Math.cos(rad);
    const x = Math.max(0, Math.min(100, (rX + cx) * 100));
    const y = Math.max(0, Math.min(100, (rY + cy) * 100));
    return { x, y };
  }, [scale, panX, panY, rotation]);

  const startPinDrag = useCallback((e: React.MouseEvent | React.TouchEvent, pinId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = { isDragging: true, pinId, startX: clientX, startY: clientY, moved: false };

    const moveHandler = (ev: MouseEvent | TouchEvent) => {
      if (!dragRef.current.isDragging) return;
      ev.preventDefault();
      const cx = "touches" in ev ? (ev as TouchEvent).touches[0].clientX : (ev as MouseEvent).clientX;
      const cy = "touches" in ev ? (ev as TouchEvent).touches[0].clientY : (ev as MouseEvent).clientY;
      if (Math.abs(cx - dragRef.current.startX) > 3 || Math.abs(cy - dragRef.current.startY) > 3) {
        dragRef.current.moved = true;
      }
      const pos = screenToImagePercent(cx, cy);
      if (!pos) return;
      const marker = document.querySelector(`[data-pin-id="${pinId}"]`) as HTMLElement;
      if (marker) {
        marker.classList.add("dragging");
        marker.style.left = `${pos.x}%`;
        marker.style.top = `${pos.y}%`;
      }
    };

    const endHandler = (ev: MouseEvent | TouchEvent) => {
      if (!dragRef.current.isDragging) return;
      const cx = "changedTouches" in ev ? (ev as TouchEvent).changedTouches[0].clientX : (ev as MouseEvent).clientX;
      const cy = "changedTouches" in ev ? (ev as TouchEvent).changedTouches[0].clientY : (ev as MouseEvent).clientY;
      const pos = screenToImagePercent(cx, cy);
      const marker = document.querySelector(`[data-pin-id="${pinId}"]`) as HTMLElement;
      if (marker) marker.classList.remove("dragging");

      if (pos && dragRef.current.moved) {
        setLocalPins((prev) =>
          prev.map((p) => p.id === pinId ? { ...p, x: pos.x, y: pos.y } : p)
        );
      }
      dragRef.current = { isDragging: false, pinId: null, startX: 0, startY: 0, moved: false };
      document.removeEventListener("mousemove", moveHandler);
      document.removeEventListener("mouseup", endHandler);
      document.removeEventListener("touchmove", moveHandler);
      document.removeEventListener("touchend", endHandler);
    };

    document.addEventListener("mousemove", moveHandler);
    document.addEventListener("mouseup", endHandler);
    document.addEventListener("touchmove", moveHandler, { passive: false });
    document.addEventListener("touchend", endHandler);
  }, [screenToImagePercent]);

  const openRelabel = useCallback((pinId: string) => {
    const pin = localPins.find((p) => p.id === pinId);
    if (pin) {
      setRelabelPinId(pinId);
      setRelabelValue(pin.label);
    }
  }, [localPins]);

  const applyRelabel = useCallback(() => {
    if (!relabelPinId || !relabelValue.trim()) return;
    setLocalPins((prev) =>
      prev.map((p) => p.id === relabelPinId ? { ...p, label: relabelValue.trim() } : p)
    );
    setRelabelPinId(null);
    setRelabelValue("");
  }, [relabelPinId, relabelValue]);

  const updatePinField = useCallback((pinId: string, field: keyof LocalPin, value: any) => {
    setLocalPins((prev) =>
      prev.map((p) => {
        if (p.id !== pinId) return p;
        const updates: Partial<LocalPin> = { [field]: value };
        if (field === "wireDetails") {
          const derived = deriveVendorCode(String(value || ""));
          if (derived) updates.vendorCode = derived;
        }
        return { ...p, ...updates };
      })
    );
  }, []);

  const copyRowDown = useCallback((index: number) => {
    setLocalPins((prev) => {
      if (index >= prev.length - 1) return prev;
      const src = prev[index];
      return prev.map((p, i) =>
        i === index + 1
          ? { ...p, wireDetails: src.wireDetails, vendorCode: src.vendorCode, footage: src.footage }
          : p
      );
    });
  }, []);

  const deleteCommittedPin = useCallback(async (pin: { id: string; dbId?: number }) => {
    if (pin.dbId) {
      try {
        await apiRequest("DELETE", `/api/pins/${pin.dbId}`);
      } catch {
        toast({ title: "Failed to delete pin", variant: "destructive" });
        return;
      }
    }
    setCommittedPins(prev => prev.filter(p => p.id !== pin.id));
  }, [toast]);

  const applyAutoFill = useCallback((pinId: string) => {
    const pin = localPinsRef.current.find(p => p.id === pinId);
    if (!pin?.wireDetails) return;
    const normalized = pin.wireDetails.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const matches = lookupCategory(pin.wireDetails);
    if (matches.length === 0) return;
    const exactMatch = matches.find(m => m.catalog === normalized);
    const match = exactMatch || (matches.length === 1 ? matches[0] : null);
    if (!match) return;
    updatePinField(pinId, "wireDetails", match.catalog);
    if (!pin.vendorCode && match.vendor) updatePinField(pinId, "vendorCode", match.vendor);
    if (!pin.footage && match.footage) updatePinField(pinId, "footage", match.footage);
  }, [updatePinField]);

  const clearRow = useCallback((pinId: string) => {
    setLocalPins((prev) =>
      prev.map((p) =>
        p.id === pinId
          ? { ...p, wireDetails: undefined, vendorCode: undefined, footage: undefined, reelCount: 1 }
          : p
      )
    );
  }, []);

  const createEntries = useMutation({
    mutationFn: async () => {
      const allPins = [...localPinsRef.current];
      const pinsToCommit = allPins.filter(p => p.wireDetails && p.wireDetails.trim().length > 0);
      if (pinsToCommit.length === 0) {
        return [];
      }
      const isDetail = currentPhoto?.isDetailShot || false;
      const parentPhoto = isDetail && currentPhoto?.parentPhotoId
        ? uploadedPhotos.find(p => p.dbId === currentPhoto.parentPhotoId)
        : undefined;
      const entryAisle = isDetail && parentPhoto?.aisle ? parentPhoto.aisle : (currentPhoto?.aisle || aisle || "");
      const entrySection = currentPhoto?.section || parentPhoto?.section || "";
      const entryPhotoId = isDetail && parentPhoto?.dbId ? parentPhoto.dbId : currentPhoto?.dbId;
      const pinPhotoId = currentPhoto?.dbId;
      const errors: string[] = [];
      const totalEntries = pinsToCommit.length;
      let completed = 0;
      setBatchProgress({ current: 0, total: totalEntries, errors: [] });

      for (const pin of pinsToCommit) {
        try {
          const reelLabel = pin.wireDetails || `Pin ${pin.label}`;
          const totalFootage = pin.footage ? pin.footage * pin.reelCount : undefined;
          const noteParts: string[] = [];
          if (isDetail) noteParts.push(`From detail shot: ${currentPhoto?.filename || "detail"}`);
          const res = await apiRequest("POST", `/api/sessions/${sessionId}/entries`, {
            aisle: entryAisle,
            section: entrySection,
            position: "",
            reelTag: reelLabel,
            manufacturer: pin.vendorCode || undefined,
            footage: totalFootage,
            reelCount: pin.reelCount,
            photoId: entryPhotoId || undefined,
            notes: noteParts.length > 0 ? noteParts.join(" | ") : undefined,
          });
          const entry = await res.json();
          completed++;
          setBatchProgress({ current: completed, total: totalEntries, errors });
          if (pinPhotoId) {
            const pinRes = await apiRequest("POST", `/api/photos/${pinPhotoId}/pins`, {
              xPercent: pin.x,
              yPercent: pin.y,
              label: pin.label,
              reelCount: pin.reelCount,
              entryId: entry.id,
            });
            const savedPin = await pinRes.json();
            (pin as any)._dbPinId = savedPin.id;
          }
        } catch {
          errors.push(`Pin ${pin.label}`);
          setBatchProgress({ current: completed, total: totalEntries, errors });
        }
      }
      if (errors.length > 0) {
        throw new Error(`Failed to create entries for: ${errors.join(", ")}`);
      }
      return pinsToCommit;
    },
    onSuccess: (pinsToCommit) => {
      if (pinsToCommit.length === 0) {
        toast({ title: "No pins have category details entered yet" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
      const totalCreated = pinsToCommit.reduce((sum, pin) => sum + pin.reelCount, 0);
      const committedIds = new Set(pinsToCommit.map(p => p.id));
      setCommittedPins(prev => [
        ...prev,
        ...pinsToCommit.map(p => ({
          id: `committed-${p.id}-${Date.now()}`,
          dbId: (p as any)._dbPinId as number | undefined,
          x: p.x,
          y: p.y,
          label: p.label,
          reelCount: p.reelCount,
        })),
      ]);
      setLocalPins(prev => prev.filter(p => !committedIds.has(p.id)));
      setSelectedPinId(prev => prev && committedIds.has(prev) ? null : prev);
      setBatchProgress(null);
      toast({ title: `Created ${totalCreated} entries from ${pinsToCommit.length} pins` });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      toast({ title: error.message, variant: "destructive" });
      setTimeout(() => setBatchProgress(null), 3000);
    },
  });


  const resetView = () => {
    setScale(1);
    setPanX(0);
    setPanY(0);
  };

  const navigateToNextIncomplete = async () => {
    if (!incompletePinsData || incompletePinsData.length === 0) return;
    const incompletePhotoIds = new Set(incompletePinsData.map(d => d.photoId));
    for (let offset = 1; offset <= uploadedPhotos.length; offset++) {
      const idx = (currentPhotoIdx + offset) % uploadedPhotos.length;
      const photo = uploadedPhotos[idx];
      if (photo?.dbId && incompletePhotoIds.has(photo.dbId)) {
        await flushSavePins();
        skipAutoSave.current = true;
        setLocalPins([]);
        setViewingNearbyIdx(null);
        setCurrentPhotoIdx(idx);
        resetView();
        return;
      }
    }
  };

  const currentPhotoIncompleteCount = currentPhoto?.dbId ? (incompletePinsMap.get(currentPhoto.dbId) || 0) : 0;

  return (
    <div className="space-y-4 rounded-md border-2 border-[hsl(18_60%_30%/0.35)] bg-[hsl(30_10%_96%)] dark:bg-[hsl(25_8%_13%)] p-4">
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-xs font-bold text-[hsl(18_80%_40%)] dark:text-[hsl(18_80%_60%)] mb-1">Aisle:</label>
          <Input
            value={aisle}
            onChange={(e) => {
              let val = e.target.value;
              if (val.toLowerCase() === "rec") val = "Receiving";
              setAisle(val);
              setUploadedPhotos(prev => prev.map((p, i) => i === currentPhotoIdx ? { ...p, aisle: val } : p));
              const photoDbId = currentPhoto?.dbId;
              if (aisleSaveTimer.current) clearTimeout(aisleSaveTimer.current);
              if (photoDbId) {
                aisleSaveTimer.current = setTimeout(async () => {
                  try {
                    await apiRequest("PATCH", `/api/photos/${photoDbId}`, { aisle: val });
                  } catch {}
                }, 800);
              }
            }}
            placeholder="Aisle..."
            className={`w-24 border-2 focus-visible:ring-[hsl(18_85%_48%)] bg-white dark:bg-[hsl(25_10%_10%)] placeholder:text-[hsl(18_85%_32%)] placeholder:font-semibold ${aisle.trim() ? "input-filled" : "input-pulse-empty"}`}
            enterKeyHint="next"
            data-testid="input-photo-aisle"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            className="bg-[hsl(18_85%_32%)] text-white border-[hsl(18_85%_26%)]"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            data-testid="button-upload-photos"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Upload Photos
          </Button>
          <Button
            className="bg-[hsl(18_85%_32%)] text-white border-[hsl(18_85%_26%)]"
            onClick={() => cameraInputRef.current?.click()}
            disabled={isUploading}
            data-testid="button-take-photo"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Take Photo
          </Button>
        </div>
      </div>

      {uploadedPhotos.length > 0 && (
        <>
          <div className="bg-[hsl(25_15%_14%)] dark:bg-[hsl(25_8%_10%)] rounded-md px-3 py-2 space-y-1">
            <div className="flex items-center w-full">
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                  disabled={uploadedPhotos.length <= 1}
                  onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i - 1 + uploadedPhotos.length) % uploadedPhotos.length); resetView(); }}
                  data-testid="button-prev-photo"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-1 text-sm mono text-[hsl(30_40%_85%)]" data-testid="text-photo-counter">
                  {currentPhotoIncompleteCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[hsl(30_90%_45%)] text-white text-[10px] font-bold px-1" data-testid="badge-current-incomplete-top">
                      {currentPhotoIncompleteCount}
                    </span>
                  )}
                  <input
                    type="text"
                    inputMode="numeric"
                    className="w-8 text-center bg-transparent border border-[hsl(18_60%_30%/0.4)] rounded px-1 py-0.5 text-sm mono text-[hsl(30_40%_85%)] focus:outline-none focus:border-[hsl(18_85%_40%)]"
                    value={String(currentPhotoIdx + 1).padStart(2, "0")}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val >= 1 && val <= uploadedPhotos.length) {
                        flushSavePins().then(() => {
                          skipAutoSave.current = true;
                          setLocalPins([]);
                          setViewingNearbyIdx(null);
                          setCurrentPhotoIdx(val - 1);
                          resetView();
                        });
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                    data-testid="input-photo-number-top"
                  />
                  <span>/ {String(uploadedPhotos.length).padStart(2, "0")}</span>
                </div>
                <Button
                  size="icon"
                  className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                  disabled={uploadedPhotos.length <= 1}
                  onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i + 1) % uploadedPhotos.length); resetView(); }}
                  data-testid="button-next-photo"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
                {totalIncompletePins > 0 && (
                  <Button
                    size="sm"
                    className="bg-[hsl(30_90%_45%)] text-white border border-[hsl(30_90%_35%)] ml-1"
                    onClick={navigateToNextIncomplete}
                    data-testid="button-next-incomplete"
                  >
                    <AlertCircle className="h-3.5 w-3.5 mr-1" />
                    <span className="mono text-xs">{totalIncompletePins}</span>
                  </Button>
                )}
              </div>
              <div className="flex-1 flex justify-end gap-2">
                <div>
                  <label className="block text-xs font-bold text-white dark:text-white mb-1">Section:</label>
                  <Input
                    value={currentPhoto?.section || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      const photoDbId = currentPhoto?.dbId;
                      setUploadedPhotos((prev) =>
                        prev.map((p, i) => i === currentPhotoIdx ? { ...p, section: val } : p)
                      );
                      if (sectionSaveTimer.current) clearTimeout(sectionSaveTimer.current);
                      if (photoDbId) {
                        sectionSaveTimer.current = setTimeout(async () => {
                          try {
                            await apiRequest("PATCH", `/api/photos/${photoDbId}`, { section: val });
                          } catch {}
                        }, 800);
                      }
                    }}
                    placeholder="Section..."
                    className={`w-24 border-2 focus-visible:ring-[hsl(18_85%_48%)] bg-white dark:bg-[hsl(25_10%_10%)] placeholder:text-[hsl(18_85%_32%)] placeholder:font-semibold ${(currentPhoto?.section || "").trim() ? "input-filled" : "input-pulse-empty"}`}
                    enterKeyHint="done"
                    data-testid="input-photo-section"
                  />
                </div>
              </div>
            </div>
            {currentPhoto && (
              <div className="flex items-center justify-center gap-3 text-xs mono text-[hsl(25_40%_60%)]" data-testid="text-photo-info">
                {currentPhoto.filename && <span className="truncate max-w-[200px]" title={currentPhoto.filename}>{currentPhoto.filename}</span>}
                {currentPhoto.timestamp && <span className="whitespace-nowrap">{currentPhoto.timestamp}</span>}
                {currentPhoto.isDetailShot && (
                  <span className="inline-flex items-center gap-1 text-[hsl(200_70%_55%)]" title="Detail Shot">
                    <Focus className="h-3 w-3" />
                  </span>
                )}
                {currentPhoto.notes && (
                  <span className="inline-flex items-center gap-1 text-[hsl(18_70%_55%)]" title={currentPhoto.notes}>
                    <StickyNote className="h-3 w-3" />
                  </span>
                )}
              </div>
            )}
          </div>

          {viewingNearbyIdx !== null && viewingNearbyIdx !== currentPhotoIdx && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(18_85%_40%/0.15)] border border-[hsl(18_85%_40%/0.3)] rounded-md text-xs text-[hsl(30_40%_85%)]" data-testid="nearby-viewing-banner">
              <Eye className="h-3 w-3 flex-shrink-0" />
              <span>Viewing nearby photo {viewingNearbyIdx + 1} — pin table still shows photo {currentPhotoIdx + 1}</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-xs"
                onClick={() => setViewingNearbyIdx(null)}
                data-testid="button-return-to-current"
              >
                Return
              </Button>
            </div>
          )}

          {currentPhoto && (
            <div
              ref={containerRef}
              className="photo-viewer-container w-full"
              style={{ cursor: panMode ? "grab" : "crosshair" }}
              onMouseDown={handleMouseDown}
              onClick={handleContainerClick}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              data-testid="photo-viewer"
            >
              <div className="photo-scroll-strip left" onWheel={(e) => e.stopPropagation()} />
              <div className="photo-scroll-strip right" onWheel={(e) => e.stopPropagation()} />
              <div
                className="relative w-full"
                style={{
                  transform: `scale(${scale}) translate(${panX}px, ${panY}px) rotate(${rotation}deg)`,
                  transformOrigin: "center center",
                  ["--pin-scale" as string]: pinScale,
                }}
              >
              <img
                ref={photoImgRef}
                src={displayedPhoto?.url || currentPhoto.url}
                alt="Section photo"
                draggable={false}
                className="w-full select-none"
                style={{ display: "block" }}
                onLoad={() => {}}
              />
              {viewingNearbyIdx === null || viewingNearbyIdx === currentPhotoIdx ? (
                <>
                  {localPins.map((pin) => (
                    <div
                      key={pin.id}
                      className={`pin-marker ${selectedPinId === pin.id ? "selected" : ""}`}
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                      data-pin-id={pin.id}
                      onMouseDown={(e) => {
                        if ((e.target as HTMLElement).closest(".pin-label, .pin-delete-btn, .pin-count-btn")) return;
                        startPinDrag(e, pin.id);
                      }}
                      onTouchStart={(e) => {
                        if ((e.target as HTMLElement).closest(".pin-label, .pin-delete-btn, .pin-count-btn")) return;
                        startPinDrag(e, pin.id);
                      }}
                      onClick={(e) => { e.stopPropagation(); setSelectedPinId(pin.id); }}
                      data-testid={`pin-${pin.id}`}
                    >
                      <div className="pin-top-row">
                        <button
                          className="pin-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocalPins((prev) => prev.filter((p) => p.id !== pin.id));
                          }}
                          title="Delete pin"
                          data-testid={`button-delete-pin-${pin.id}`}
                        >
                          &times;
                        </button>
                        <div
                          className="pin-label"
                          onClick={(e) => { e.stopPropagation(); openRelabel(pin.id); }}
                          title="Click to rename"
                          data-testid={`label-pin-${pin.id}`}
                        >
                          {pin.label}
                        </div>
                      </div>
                      <div className="pin-bottom-row">
                        <button
                          className="pin-count-btn minus"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocalPins((prev) =>
                              prev.map((p) => p.id === pin.id ? { ...p, reelCount: Math.max(1, p.reelCount - 1) } : p)
                            );
                          }}
                          title="Decrease count"
                          data-testid={`button-minus-pin-${pin.id}`}
                        >
                          &minus;
                        </button>
                        <span className="pin-reel-count" data-testid={`count-pin-${pin.id}`}>{pin.reelCount}</span>
                        <button
                          className="pin-count-btn plus"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocalPins((prev) =>
                              prev.map((p) => p.id === pin.id ? { ...p, reelCount: Math.min(99, p.reelCount + 1) } : p)
                            );
                          }}
                          title="Increase count"
                          data-testid={`button-plus-pin-${pin.id}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                  {committedPins.map((pin) => (
                    <div
                      key={pin.id}
                      className="pin-marker committed"
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                      data-testid={`pin-committed-${pin.id}`}
                    >
                      <div className="pin-committed-topbar">
                        <button
                          className="pin-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteCommittedPin(pin);
                          }}
                          title="Delete committed pin"
                          data-testid={`button-delete-committed-${pin.id}`}
                        >
                          &times;
                        </button>
                        <div className="pin-label">P{pin.label}</div>
                        {pin.reelCount >= 2 && (
                          <div className="pin-reel-badge" data-testid={`badge-reel-count-${pin.id}`}>
                            X{pin.reelCount}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {nearbyCommittedPins.map((pin) => (
                    <div
                      key={pin.id}
                      className="pin-marker committed"
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                      data-testid={`pin-nearby-committed-${pin.id}`}
                    >
                      <div className="pin-committed-topbar">
                        <div className="pin-label">P{pin.label}</div>
                        {pin.reelCount >= 2 && (
                          <div className="pin-reel-badge">
                            X{pin.reelCount}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
              </div>
              <div className="photo-overlay-controls right-strip">
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); setScale((s) => Math.min(5, s + 0.5)); }}
                  title="Zoom in"
                  data-testid="button-zoom-in"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); setScale((s) => Math.max(1, s - 0.5)); }}
                  title="Zoom out"
                  data-testid="button-zoom-out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  className={`photo-overlay-btn ${panMode ? "photo-overlay-btn-active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setPanMode((m) => !m); }}
                  title={panMode ? "Exit pan mode (tap to place pins)" : "Enter pan mode (drag to move)"}
                  data-testid="button-pan-mode"
                >
                  <Move className="h-4 w-4" />
                </button>
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); setRotation((r) => (r + 90) % 360); }}
                  title="Rotate clockwise"
                  data-testid="button-rotate-cw"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); setRotation((r) => (r - 90 + 360) % 360); }}
                  title="Rotate counter-clockwise"
                  data-testid="button-rotate-ccw"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <div className="photo-overlay-divider" />
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); savePinScale(Math.min(5, +(pinScale + 0.25).toFixed(2))); }}
                  title="Increase pin size"
                  data-testid="button-pin-size-up"
                >
                  <Crosshair className="h-4 w-4" />
                  <Plus className="h-2.5 w-2.5 absolute bottom-0.5 right-0.5" />
                </button>
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); savePinScale(Math.max(0.5, +(pinScale - 0.25).toFixed(2))); }}
                  title="Decrease pin size"
                  data-testid="button-pin-size-down"
                >
                  <Crosshair className="h-4 w-4" />
                  <span className="absolute bottom-0 right-0.5 text-[8px] font-bold leading-none">-</span>
                </button>
              </div>
            </div>
          )}

          {currentPhoto && (
            <div className="bg-[hsl(25_15%_14%)] dark:bg-[hsl(25_8%_10%)] rounded-md px-3 py-2 flex flex-col items-center gap-1" data-testid="bottom-photo-nav">
              {currentPhoto.filename && (
                <span className="text-xs mono text-[hsl(25_40%_60%)] truncate max-w-[260px]" title={currentPhoto.filename} data-testid="text-photo-name-bottom">
                  {currentPhoto.filename}
                </span>
              )}
              <div className="flex items-center w-full">
                <div className="flex-1" />
                <div className="flex items-center gap-3">
                  <Button
                    size="icon"
                    className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                    disabled={uploadedPhotos.length <= 1}
                    onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i - 1 + uploadedPhotos.length) % uploadedPhotos.length); resetView(); }}
                    data-testid="button-prev-photo-bottom"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <div className="flex items-center gap-1 text-sm mono text-[hsl(30_40%_85%)]" data-testid="text-photo-counter-bottom">
                    {currentPhotoIncompleteCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[hsl(30_90%_45%)] text-white text-[10px] font-bold px-1" data-testid="badge-current-incomplete-bottom">
                        {currentPhotoIncompleteCount}
                      </span>
                    )}
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-8 text-center bg-transparent border border-[hsl(18_60%_30%/0.4)] rounded px-1 py-0.5 text-sm mono text-[hsl(30_40%_85%)] focus:outline-none focus:border-[hsl(18_85%_40%)]"
                      value={String(currentPhotoIdx + 1).padStart(2, "0")}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= 1 && val <= uploadedPhotos.length) {
                          flushSavePins().then(() => {
                            skipAutoSave.current = true;
                            setLocalPins([]);
                            setViewingNearbyIdx(null);
                            setCurrentPhotoIdx(val - 1);
                            resetView();
                          });
                        }
                      }}
                      onFocus={(e) => e.target.select()}
                      data-testid="input-photo-number"
                    />
                    <span>/ {String(uploadedPhotos.length).padStart(2, "0")}</span>
                  </div>
                  <Button
                    size="icon"
                    className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                    disabled={uploadedPhotos.length <= 1}
                    onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i + 1) % uploadedPhotos.length); resetView(); }}
                    data-testid="button-next-photo-bottom"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                  {totalIncompletePins > 0 && (
                    <Button
                      size="sm"
                      className="bg-[hsl(30_90%_45%)] text-white border border-[hsl(30_90%_35%)] ml-1"
                      onClick={navigateToNextIncomplete}
                      data-testid="button-next-incomplete-bottom"
                    >
                      <AlertCircle className="h-3.5 w-3.5 mr-1" />
                      <span className="mono text-xs">{totalIncompletePins}</span>
                    </Button>
                  )}
                </div>
                <div className="flex-1 flex justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="lg"
                      variant="ghost"
                      className="text-red-400 px-2"
                      data-testid="button-delete-photo"
                    >
                      <Trash2 className="h-8 w-8" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Photo?</AlertDialogTitle>
                      <AlertDialogDescription>This photo and all its pins will be permanently removed.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          const photoDbId = currentPhoto?.dbId;
                          if (!photoDbId) return;
                          try {
                            await apiRequest("DELETE", `/api/photos/${photoDbId}`);
                            setUploadedPhotos(prev => {
                              const filtered = prev.filter((_, i) => i !== currentPhotoIdx);
                              const newIdx = Math.min(currentPhotoIdx, Math.max(0, filtered.length - 1));
                              setCurrentPhotoIdx(newIdx);
                              return filtered;
                            });
                            setLocalPins([]);
                            localPinsRef.current = [];
                            setViewingNearbyIdx(null);
                            resetView();
                            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
                            toast({ title: "Photo deleted" });
                          } catch {
                            toast({ title: "Failed to delete photo", variant: "destructive" });
                          }
                        }}
                        data-testid="button-confirm-delete-photo"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                </div>
              </div>
            </div>
          )}

          {currentPhoto && (
            <div className="space-y-3 bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_11%)] rounded-md p-3 border border-[hsl(18_60%_30%/0.2)]">
              <div className="flex items-center gap-2 flex-wrap">
                <StickyNote className="h-4 w-4 text-[hsl(18_70%_50%)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(25_60%_70%)]">Photo Notes:</span>
                {isDetailShot && (
                  <Badge className="bg-[hsl(200_70%_30%)] text-white text-[10px] px-1.5 py-0 no-default-hover-elevate no-default-active-elevate" data-testid="badge-detail-shot">
                    <Focus className="h-3 w-3 mr-1" />
                    Detail Shot
                  </Badge>
                )}
              </div>
              <Textarea
                value={photoNotes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder=""
                className="resize-none border-[hsl(18_40%_50%/0.4)] bg-white dark:bg-[hsl(25_10%_10%)] text-sm min-h-[60px]"
                rows={2}
                data-testid="textarea-photo-notes"
              />
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer" data-testid="toggle-detail-shot">
                  <Checkbox
                    checked={isDetailShot}
                    onCheckedChange={(checked) => handleDetailShotToggle(!!checked)}
                  />
                  <span className="text-xs text-[hsl(25_50%_65%)]">This is a detail/close-up shot</span>
                </label>
                {isDetailShot && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-[hsl(25_50%_65%)] whitespace-nowrap">Linked to:</label>
                    <select
                      value={parentPhotoId ?? ""}
                      onChange={(e) => handleParentPhotoChange(e.target.value)}
                      className="rounded-md border border-[hsl(18_40%_50%/0.4)] bg-white dark:bg-[hsl(25_10%_10%)] px-2 py-1 text-xs min-w-[120px] focus:outline-none focus:ring-2 focus:ring-[hsl(18_85%_48%)]"
                      data-testid="select-parent-photo"
                    >
                      <option value="">-- Select parent photo --</option>
                      {parentPhotoOptions.map((p) => (
                        <option key={p.dbId} value={p.dbId}>
                          {p.filename || `Photo ${uploadedPhotos.indexOf(p) + 1}`} {p.section ? `(${p.section})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {uploadedPhotos.length > 1 && (() => {
            const sortedByLocation = uploadedPhotos
              .map((photo, origIdx) => ({ photo, origIdx }))
              .sort((a, b) => {
                const aisleA = (a.photo.aisle || "").toLowerCase();
                const aisleB = (b.photo.aisle || "").toLowerCase();
                if (aisleA !== aisleB) return aisleA.localeCompare(aisleB);
                const secA = parseInt(a.photo.section || "0", 10) || 0;
                const secB = parseInt(b.photo.section || "0", 10) || 0;
                return secA - secB;
              });
            const sortedPos = sortedByLocation.findIndex(s => s.origIdx === currentPhotoIdx);
            const nearbyItems = sortedByLocation.filter((_, si) => Math.abs(si - sortedPos) <= 3);
            return (
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" data-testid="text-nearby-photos-title">
                  Nearby Photos
                </div>
                <div className="flex gap-2 overflow-x-auto py-1 px-0.5">
                  {nearbyItems.map(({ photo, origIdx }) => {
                    const isCurrent = origIdx === currentPhotoIdx;
                    const isViewing = origIdx === displayedPhotoIdx;
                    return (
                      <button
                        key={origIdx}
                        type="button"
                        className={`relative flex-shrink-0 rounded-md overflow-visible border-2 transition-colors ${
                          isViewing
                            ? "border-primary ring-2 ring-primary/30"
                            : isCurrent
                              ? "border-[hsl(18_85%_40%)] ring-1 ring-[hsl(18_85%_40%/0.3)]"
                              : "border-border/50 hover-elevate"
                        }`}
                        onClick={() => {
                          if (origIdx === currentPhotoIdx || origIdx === viewingNearbyIdx) {
                            setViewingNearbyIdx(null);
                          } else {
                            setViewingNearbyIdx(origIdx);
                          }
                          resetView();
                        }}
                        title={`${photo.aisle ? `Aisle ${photo.aisle} - ` : ""}${photo.section ? `Section ${photo.section}` : photo.filename || `Photo ${origIdx + 1}`}${photo.dbId && incompletePinsMap.has(photo.dbId) ? ` (${incompletePinsMap.get(photo.dbId)} incomplete)` : ""}`}
                        data-testid={`nearby-photo-${origIdx}`}
                      >
                        {photo.dbId && incompletePinsMap.has(photo.dbId) && (
                          <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-[hsl(30_90%_45%)] text-white text-[9px] font-bold px-0.5 z-10" data-testid={`badge-nearby-incomplete-${origIdx}`}>
                            {incompletePinsMap.get(photo.dbId)}
                          </span>
                        )}
                        <img
                          src={photo.url}
                          alt={photo.filename || `Photo ${origIdx + 1}`}
                          className="w-16 h-12 object-cover rounded-[4px]"
                        />
                        <div className="text-[10px] text-center truncate max-w-[64px] text-muted-foreground mt-0.5">
                          {photo.aisle && photo.section ? `${photo.aisle}-${photo.section}` : photo.section || `#${origIdx + 1}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {localPins.length > 0 && (
            <div className="space-y-3">
              {selectedPinId && currentPhoto && (() => {
                const selectedPin = localPins.find(p => p.id === selectedPinId);
                if (!selectedPin) return null;
                return (
                  <div className="sticky top-[53px] z-[999] bg-background py-1">
                    <ReelCropPreview
                      photoUrl={currentPhoto.url}
                      pinX={selectedPin.x}
                      pinY={selectedPin.y}
                      label={selectedPin.label}
                      cropMode={cropMode}
                      onCropModeChange={setCropMode}
                      onClose={() => setSelectedPinId(null)}
                    />
                  </div>
                );
              })()}
              <div className="text-sm font-semibold uppercase tracking-wider text-[hsl(18_60%_40%)] dark:text-[hsl(25_70%_60%)]" data-testid="text-pin-table-title">Enter Details for Each Position</div>
              <div className="overflow-x-auto">
                <table className="pin-entry-table" data-testid="pin-entry-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Reel #:</th>
                      <th style={{ minWidth: 140 }}>Category:</th>
                      <th style={{ width: 80 }}>Vendor Code:</th>
                      <th style={{ width: 80 }}>Footage:</th>
                      <th style={{ width: 60 }}>Reels:</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {localPins.map((pin, index) => (
                      <tr
                        key={pin.id}
                        data-testid={`pin-entry-row-${index}`}
                        className={selectedPinId === pin.id ? "ring-1 ring-primary/40" : ""}
                        onClick={() => setSelectedPinId(pin.id)}
                      >
                        <td>
                          <span className="pin-position-cell">{pin.label}</span>
                        </td>
                        <td className="relative">
                          <input
                            type="text"
                            className="input-caps"
                            value={pin.wireDetails || ""}
                            onChange={(e) => {
                              const val = e.target.value.toUpperCase();
                              updatePinField(pin.id, "wireDetails", val);
                              const matches = lookupCategory(val);
                              setSuggestions(matches);
                              setSuggestionIndex(-1);
                              setActiveSuggestionPin(matches.length > 0 ? pin.id : null);
                            }}
                            onFocus={() => {
                              setSelectedPinId(pin.id);
                              setSuggestionIndex(-1);
                              if (pin.wireDetails) {
                                const matches = lookupCategory(pin.wireDetails);
                                setSuggestions(matches);
                                setActiveSuggestionPin(matches.length > 0 ? pin.id : null);
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setActiveSuggestionPin(null);
                                setSuggestionIndex(-1);
                              }, 200);
                              applyAutoFill(pin.id);
                            }}
                            onKeyDown={(e) => {
                              if (activeSuggestionPin === pin.id && suggestions.length > 0) {
                                if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  setSuggestionIndex(prev => Math.min(prev + 1, suggestions.length - 1));
                                } else if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  setSuggestionIndex(prev => Math.max(prev - 1, -1));
                                } else if (e.key === "Enter" && suggestionIndex >= 0) {
                                  e.preventDefault();
                                  const s = suggestions[suggestionIndex];
                                  updatePinField(pin.id, "wireDetails", s.catalog);
                                  if (s.vendor) updatePinField(pin.id, "vendorCode", s.vendor);
                                  if (s.footage) updatePinField(pin.id, "footage", s.footage);
                                  setActiveSuggestionPin(null);
                                  setSuggestions([]);
                                  setSuggestionIndex(-1);
                                } else if (e.key === "Escape") {
                                  setActiveSuggestionPin(null);
                                  setSuggestions([]);
                                  setSuggestionIndex(-1);
                                }
                              }
                            }}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="characters"
                            placeholder="Type category..."
                            data-testid={`input-wire-details-${index}`}
                          />
                          {activeSuggestionPin === pin.id && suggestions.length > 0 && (
                            <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-lg" data-testid={`suggestions-${index}`}>
                              {suggestions.map((s, si) => (
                                <button
                                  key={`${s.vendor}-${s.catalog}`}
                                  type="button"
                                  className={`w-full text-left px-2 py-1.5 text-xs cursor-pointer border-b last:border-b-0 border-border/50 ${si === suggestionIndex ? "bg-accent text-accent-foreground" : "hover-elevate"}`}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    updatePinField(pin.id, "wireDetails", s.catalog);
                                    if (s.vendor) updatePinField(pin.id, "vendorCode", s.vendor);
                                    if (s.footage) updatePinField(pin.id, "footage", s.footage);
                                    setActiveSuggestionPin(null);
                                    setSuggestions([]);
                                    setSuggestionIndex(-1);
                                  }}
                                  data-testid={`suggestion-${s.catalog}`}
                                >
                                  <span className="font-mono font-semibold">{s.catalog}</span>
                                  <span className="text-muted-foreground ml-2">{s.description}</span>
                                  {s.footage && <span className="text-muted-foreground ml-1">({s.footage}')</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <select
                            value={pin.vendorCode || ""}
                            onChange={(e) => updatePinField(pin.id, "vendorCode", e.target.value)}
                            data-testid={`select-vendor-code-${index}`}
                          >
                            <option value="">--</option>
                            <option value="COP">COP</option>
                            <option value="ALU">ALU</option>
                            <option value="COR">COR</option>
                            <option value="ALF">ALF</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            value={pin.footage ?? ""}
                            onChange={(e) => updatePinField(pin.id, "footage", e.target.value ? parseInt(e.target.value) : undefined)}
                            min={0}
                            inputMode="decimal"
                            autoComplete="off"
                            data-testid={`input-footage-${index}`}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={pin.reelCount}
                            onChange={(e) => updatePinField(pin.id, "reelCount", Math.max(1, parseInt(e.target.value) || 1))}
                            min={1}
                            inputMode="numeric"
                            autoComplete="off"
                            style={{ width: "100%" }}
                            data-testid={`input-reels-${index}`}
                          />
                        </td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                          <button
                            type="button"
                            className="copy-down-btn"
                            onClick={() => copyRowDown(index)}
                            title="Copy to next row"
                            data-testid={`button-copy-down-${index}`}
                          >
                            &#8595;
                          </button>
                          <button
                            type="button"
                            className="clear-row-btn"
                            onClick={() => clearRow(pin.id)}
                            title="Clear row"
                            data-testid={`button-clear-row-${index}`}
                          >
                            &#10005;
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {batchProgress && (
                <div className="space-y-2" data-testid="batch-progress">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Creating entries...</span>
                    <span>{batchProgress.current} / {batchProgress.total}</span>
                  </div>
                  <Progress value={(batchProgress.current / batchProgress.total) * 100} />
                  {batchProgress.errors.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      Failed: {batchProgress.errors.join(", ")}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  className="bg-[hsl(145_60%_28%)] text-white border-[hsl(145_60%_22%)]"
                  onClick={() => createEntries.mutate()}
                  disabled={createEntries.isPending || !aisle}
                  data-testid="button-create-entries-from-pins"
                >
                  {createEntries.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Reel(s) from Image
                </Button>
              </div>
              {!aisle && (
                <p className="text-xs text-center text-muted-foreground" data-testid="text-create-entries-hint">
                  Fill in Aisle above to enable this button
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  className="border-[hsl(18_40%_50%/0.5)] text-[hsl(18_60%_40%)] dark:text-[hsl(25_60%_70%)] dark:border-[hsl(18_40%_50%/0.4)]"
                  onClick={() => {
                    setLocalPins((prev) => prev.map((p) => ({
                      ...p,
                      wireDetails: undefined,
                      vendorCode: undefined,
                      footage: undefined,
                      reelCount: 1,
                    })));
                  }}
                  disabled={createEntries.isPending}
                  data-testid="button-clear-pins"
                >
                  Clear All
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={!!relabelPinId} onOpenChange={(open) => { if (!open) { setRelabelPinId(null); setRelabelValue(""); } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Rename Pin</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Enter new shelf/spot code:</p>
          <Input
            value={relabelValue}
            onChange={(e) => setRelabelValue(e.target.value)}
            placeholder="e.g., 9001"
            className="text-center font-mono text-lg"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyRelabel(); }
              if (e.key === "Escape") { setRelabelPinId(null); setRelabelValue(""); }
            }}
            data-testid="input-relabel-pin"
          />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => { setRelabelPinId(null); setRelabelValue(""); }} data-testid="button-cancel-relabel">
              Cancel
            </Button>
            <Button className="flex-1" onClick={applyRelabel} disabled={!relabelValue.trim()} data-testid="button-save-relabel">
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SingleEntryMode({
  sessionId, editingEntry, onDoneEditing, onSwitchToPhoto,
}: {
  sessionId: number;
  editingEntry: Entry | null;
  onDoneEditing: () => void;
  onSwitchToPhoto?: (photoId: number, aisle: string, section: string) => void;
}) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const singleFileRef = useRef<HTMLInputElement>(null);
  const singleCameraRef = useRef<HTMLInputElement>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<{ url: string; objectPath: string; photoId: number } | null>(null);
  const [keepLocation, setKeepLocation] = useState(false);
  const [form, setForm] = useState({
    aisle: editingEntry?.aisle || "",
    section: editingEntry?.section || "",
    position: editingEntry?.position || "",
    reelTag: editingEntry?.reelTag || "",
    wireType: editingEntry?.wireType || "",
    gauge: editingEntry?.gauge || "",
    footage: editingEntry?.footage?.toString() || "",
    color: editingEntry?.color || "",
    manufacturer: editingEntry?.manufacturer || "",
    notes: editingEntry?.notes || "",
    reelCount: editingEntry?.reelCount?.toString() || "1",
    conductors: editingEntry?.conductors || "",
  });
  const [onFloor, setOnFloor] = useState(editingEntry?.notes?.includes("On Floor") || false);
  const [inFrontOf, setInFrontOf] = useState(editingEntry?.notes?.includes("In Front Of") || false);
  const [receivingChecked, setReceivingChecked] = useState(editingEntry?.aisle?.toLowerCase() === "receiving" || false);
  const [footageOverride, setFootageOverride] = useState(!!editingEntry);
  const lastMatchedCatalog = useRef<string | null>(null);
  const [categorySuggestions, setCategorySuggestions] = useState<ParsedCatalogEntry[]>([]);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (editingEntry) {
      setForm({
        aisle: editingEntry.aisle || "",
        section: editingEntry.section || "",
        position: editingEntry.position || "",
        reelTag: editingEntry.reelTag || "",
        wireType: editingEntry.wireType || "",
        gauge: editingEntry.gauge || "",
        footage: editingEntry.footage && editingEntry.reelCount && editingEntry.reelCount > 1 ? Math.round(editingEntry.footage / editingEntry.reelCount).toString() : editingEntry.footage?.toString() || "",
        color: editingEntry.color || "",
        manufacturer: editingEntry.manufacturer || "",
        notes: editingEntry.notes || "",
        reelCount: editingEntry.reelCount?.toString() || "1",
        conductors: editingEntry.conductors || "",
      });
      setOnFloor(editingEntry.notes?.includes("On Floor") || false);
      setInFrontOf(editingEntry.notes?.includes("In Front Of") || false);
      setReceivingChecked(editingEntry.aisle?.toLowerCase() === "receiving" || false);
      setFootageOverride(true);
      lastMatchedCatalog.current = editingEntry.reelTag?.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
      setCapturedPhoto(null);
      setErrors({});
      setTouched({});
    }
  }, [editingEntry]);

  const getCatalogMatch = (reelTag: string): ParsedCatalogEntry | null => {
    if (!reelTag || reelTag.length < 2) return null;
    const matches = lookupCategory(reelTag);
    const normalized = reelTag.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const exact = matches.find(m => m.catalog === normalized);
    return exact || (matches.length === 1 ? matches[0] : null);
  };

  const getUniqueVendor = (catalog: string): string | null => {
    const vendors = new Set(PARSED_CATALOG.filter(e => e.catalog === catalog).map(e => e.vendor));
    return vendors.size === 1 ? [...vendors][0] : null;
  };

  useEffect(() => {
    const match = getCatalogMatch(form.reelTag);
    if (match) {
      if (match.conductors && !form.conductors) {
        setForm(f => ({ ...f, conductors: match.conductors || "" }));
      }
      const uniqueVendor = getUniqueVendor(match.catalog);
      if (uniqueVendor && !form.manufacturer) {
        setForm(f => ({ ...f, manufacturer: uniqueVendor }));
      }
      if (match.footage) {
        const matchCatalog = match.catalog;
        if (matchCatalog !== lastMatchedCatalog.current) {
          lastMatchedCatalog.current = matchCatalog;
          setFootageOverride(false);
          const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
          setForm(f => ({ ...f, footage: (match.footage! * reelCount).toString() }));
        }
      } else {
        lastMatchedCatalog.current = match.catalog;
      }
    } else {
      if (lastMatchedCatalog.current !== null) {
        lastMatchedCatalog.current = null;
      }
    }
  }, [form.reelTag]);

  useEffect(() => {
    if (!footageOverride) {
      const match = getCatalogMatch(form.reelTag);
      if (match?.footage) {
        const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
        setForm(f => ({ ...f, footage: (match.footage! * reelCount).toString() }));
      }
    }
  }, [form.reelCount, footageOverride]);

  const handleSinglePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await uploadFile(file);
      if (!result) {
        toast({ title: "Upload failed", variant: "destructive" });
        return;
      }
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/photos`, {
        objectStorageKey: result.objectPath,
        originalFilename: file.name,
        mimeType: file.type,
        aisle: form.aisle,
        section: form.section,
      });
      const savedPhoto = await res.json();
      await queryClient.refetchQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      if (onSwitchToPhoto) {
        toast({ title: "Photo captured — switching to pin mode" });
        onSwitchToPhoto(savedPhoto.id, form.aisle, form.section);
      } else {
        setCapturedPhoto({ url: result.objectPath, objectPath: result.objectPath, photoId: savedPhoto.id });
        toast({ title: "Photo captured" });
      }
    } catch {
      toast({ title: "Photo upload failed", variant: "destructive" });
    }
    if (singleFileRef.current) singleFileRef.current.value = "";
    if (singleCameraRef.current) singleCameraRef.current.value = "";
  };

  const update = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) {
      setErrors((e) => { const n = { ...e }; delete n[field]; return n; });
    }
  };

  const markTouched = (field: string) => {
    setTouched((t) => ({ ...t, [field]: true }));
  };

  const applyCatalogMatch = (match: ParsedCatalogEntry) => {
    const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
    lastMatchedCatalog.current = match.catalog;
    setFootageOverride(false);
    const uniqueVendor = getUniqueVendor(match.catalog);
    setForm(f => ({
      ...f,
      reelTag: match.catalog,
      manufacturer: f.manufacturer || (uniqueVendor ?? ""),
      footage: match.footage ? (match.footage * reelCount).toString() : f.footage,
      conductors: f.conductors || match.conductors || "",
    }));
    setCategorySuggestions([]);
    setShowCategorySuggestions(false);
  };

  const toggleNoteTag = (tag: string, checked: boolean) => {
    setForm((f) => {
      const parts = f.notes.split("; ").filter(p => p.trim() && p.trim() !== tag);
      if (checked) parts.unshift(tag);
      return { ...f, notes: parts.join("; ") };
    });
  };

  const isReceiving = form.aisle.trim().toLowerCase() === "receiving";

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!form.aisle.trim()) newErrors.aisle = "Aisle is required";
    if (!isReceiving && !form.section.trim()) newErrors.section = "Section is required";
    if (form.footage && (isNaN(parseInt(form.footage)) || parseInt(form.footage) < 1)) newErrors.footage = "Must be a positive number";
    setErrors(newErrors);
    setTouched({ aisle: true, section: true, footage: true });
    return Object.keys(newErrors).length === 0;
  };

  const saveEntry = useMutation({
    mutationFn: async () => {
      const reelCount = Math.max(1, parseInt(form.reelCount) || 1);
      const totalFootage = form.footage ? parseInt(form.footage) : null;
      const sectionValue = isReceiving && !form.section.trim() ? "000" : form.section;
      const body: Record<string, unknown> = {
        aisle: form.aisle,
        section: sectionValue,
        position: form.position && form.position !== "__none__" ? form.position : null,
        reelTag: form.reelTag.toUpperCase() || null,
        wireType: form.wireType || null,
        gauge: form.gauge || null,
        footage: totalFootage,
        reelCount,
        color: form.color && form.color !== "__none__" ? form.color : null,
        manufacturer: form.manufacturer || null,
        notes: form.notes || null,
        conductors: form.conductors || null,
      };
      if (!editingEntry && capturedPhoto) body.photoId = capturedPhoto.photoId;

      if (editingEntry) {
        await apiRequest("PATCH", `/api/entries/${editingEntry.id}`, body);
      } else {
        await apiRequest("POST", `/api/sessions/${sessionId}/entries`, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      toast({ title: editingEntry ? "Entry updated" : "Entry saved" });
      if (editingEntry) {
        onDoneEditing();
      } else {
        const savedAisle = form.aisle;
        const savedSection = form.section;
        setForm({
          aisle: keepLocation ? savedAisle : "",
          section: keepLocation ? savedSection : "",
          position: "", reelTag: "", wireType: "", gauge: "",
          footage: "", color: "", manufacturer: "", notes: "", reelCount: "1", conductors: "",
        });
        setOnFloor(false);
        setInFrontOf(false);
        setReceivingChecked(false);
        setFootageOverride(false);
        lastMatchedCatalog.current = null;
        setCapturedPhoto(null);
        setErrors({});
        setTouched({});
      }
    },
    onError: () => {
      toast({ title: "Failed to save entry", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast({ title: "Missing required fields", description: "Aisle and Section are required", variant: "destructive" });
      return;
    }
    saveEntry.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {!editingEntry && (
        <div className="space-y-2">
          <Label className="text-xs underline">Photo (optional):</Label>
          <input ref={singleFileRef} type="file" accept="image/*" className="hidden" onChange={handleSinglePhoto} data-testid="input-single-file" />
          <input ref={singleCameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleSinglePhoto} data-testid="input-single-camera" />
          {capturedPhoto ? (
            <div className="relative rounded-md overflow-hidden border border-border/50">
              <img src={capturedPhoto.objectPath.startsWith("/uploads/") ? capturedPhoto.objectPath : `/uploads/${capturedPhoto.objectPath}`} alt="Captured" className="w-full max-h-48 object-cover" data-testid="img-captured-photo" />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute top-1 right-1 bg-black/50 text-white"
                onClick={() => setCapturedPhoto(null)}
                data-testid="button-remove-photo"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button type="button" size="lg" className="flex-1 bg-[hsl(18_85%_48%)] hover:bg-[hsl(18_85%_40%)] text-white font-semibold text-base py-3" onClick={() => singleFileRef.current?.click()} disabled={isUploading} data-testid="button-single-upload">
                <ImagePlus className="h-5 w-5 mr-2" />
                Upload Photo
              </Button>
              <Button type="button" size="lg" className="flex-1 bg-[hsl(18_85%_48%)] hover:bg-[hsl(18_85%_40%)] text-white font-semibold text-base py-3" onClick={() => singleCameraRef.current?.click()} disabled={isUploading} data-testid="button-single-camera">
                <Camera className="h-5 w-5 mr-2" />
                Take Photo
              </Button>
              {isUploading && <Loader2 className="h-5 w-5 animate-spin self-center" />}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs underline">Aisle: <span className="text-destructive">*</span></Label>
          <Input
            value={form.aisle}
            onChange={(e) => {
              const val = e.target.value;
              if (val.toLowerCase() === "rec") {
                update("aisle", "Receiving");
              } else {
                update("aisle", val);
              }
            }}
            onBlur={() => markTouched("aisle")}
            placeholder="Aisle"
            enterKeyHint="next"
            className={touched.aisle && errors.aisle ? "border-destructive" : ""}
            data-testid="input-aisle"
          />
          {touched.aisle && errors.aisle && (
            <p className="text-xs text-destructive" data-testid="error-aisle">{errors.aisle}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs underline">Section: <span className="text-destructive">*</span></Label>
          <Input
            value={form.section}
            onChange={(e) => update("section", e.target.value)}
            onBlur={() => markTouched("section")}
            placeholder="Section"
            enterKeyHint="next"
            className={touched.section && errors.section ? "border-destructive" : ""}
            data-testid="input-section"
          />
          {touched.section && errors.section && (
            <p className="text-xs text-destructive" data-testid="error-section">{errors.section}</p>
          )}
        </div>
      </div>

      <div className="flex gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={receivingChecked}
            onCheckedChange={(c) => {
              const checked = !!c;
              setReceivingChecked(checked);
              if (checked) {
                update("aisle", "Receiving");
                update("section", "000");
              } else {
                update("aisle", "");
                update("section", "");
              }
            }}
            data-testid="checkbox-receiving"
          />
          Receiving
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={onFloor}
            onCheckedChange={(c) => {
              const checked = !!c;
              setOnFloor(checked);
              toggleNoteTag("On Floor", checked);
            }}
            data-testid="checkbox-on-floor"
          />
          On Floor
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={inFrontOf}
            onCheckedChange={(c) => {
              const checked = !!c;
              setInFrontOf(checked);
              toggleNoteTag("In Front Of", checked);
            }}
            data-testid="checkbox-in-front-of"
          />
          In Front Of
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1 relative">
          <Label className="text-xs underline">Category:</Label>
          <Input
            value={form.reelTag}
            onChange={(e) => {
              const val = e.target.value.toUpperCase();
              update("reelTag", val);
              if (val.length >= 2) {
                const matches = lookupCategory(val);
                setCategorySuggestions(matches);
                setShowCategorySuggestions(matches.length > 0);
              } else {
                setCategorySuggestions([]);
                setShowCategorySuggestions(false);
              }
            }}
            onFocus={() => {
              if (form.reelTag && form.reelTag.length >= 2) {
                const matches = lookupCategory(form.reelTag);
                setCategorySuggestions(matches);
                setShowCategorySuggestions(matches.length > 0);
              }
            }}
            onBlur={() => {
              setTimeout(() => setShowCategorySuggestions(false), 200);
              const match = getCatalogMatch(form.reelTag);
              if (match) applyCatalogMatch(match);
            }}
            placeholder="Category"
            enterKeyHint="next"
            autoComplete="off"
            data-testid="input-reel-tag"
          />
          {showCategorySuggestions && categorySuggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto" data-testid="category-suggestions">
              {categorySuggestions.map((s) => (
                <button
                  key={s.catalog}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground border-b border-border/30 last:border-0"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyCatalogMatch(s);
                  }}
                  data-testid={`suggestion-${s.catalog}`}
                >
                  <span className="font-mono font-semibold">{s.catalog}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{s.description}</span>
                  {s.footage && <span className="text-orange-500 ml-1 text-xs">({s.footage}ft)</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs underline">Vendor Code:</Label>
          <Input value={form.manufacturer} onChange={(e) => update("manufacturer", e.target.value.toUpperCase())} placeholder="Vendor Code" enterKeyHint="next" data-testid="input-manufacturer" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs underline">Number of Reels:</Label>
          <Input
            type="number"
            value={form.reelCount}
            onChange={(e) => update("reelCount", e.target.value)}
            min={1}
            inputMode="numeric"
            placeholder="1"
            enterKeyHint="next"
            data-testid="input-reel-count"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs underline">Total Footage:</Label>
          <Input
            type="number"
            value={form.footage}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              setFootageOverride(true);
              update("footage", v);
            }}
            onBlur={() => markTouched("footage")}
            onKeyDown={(e) => { if (e.key === "-" || e.key === "." || e.key === "e" || e.key === "+") e.preventDefault(); }}
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="Auto or enter manually"
            enterKeyHint="next"
            className={touched.footage && errors.footage ? "border-destructive" : ""}
            data-testid="input-footage"
          />
          {touched.footage && errors.footage && (
            <p className="text-xs text-destructive" data-testid="error-footage">{errors.footage}</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs underline">Notes:</Label>
        <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Notes..." rows={2} enterKeyHint="done" data-testid="input-notes" />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        {!editingEntry && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={keepLocation}
              onCheckedChange={(c) => setKeepLocation(!!c)}
              data-testid="checkbox-keep-location"
            />
            Keep Location
          </label>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {editingEntry && (
            <Button type="button" variant="outline" onClick={onDoneEditing} data-testid="button-cancel-edit">
              Cancel
            </Button>
          )}
          {!editingEntry && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(f => ({
                  aisle: keepLocation ? f.aisle : "",
                  section: keepLocation ? f.section : "",
                  position: "",
                  reelTag: "",
                  wireType: "",
                  gauge: "",
                  footage: "",
                  color: "",
                  manufacturer: "",
                  notes: "",
                  reelCount: "1",
                  conductors: "",
                }));
                setOnFloor(false);
                setInFrontOf(false);
                setReceivingChecked(false);
                setFootageOverride(false);
                lastMatchedCatalog.current = null;
                setCapturedPhoto(null);
                setErrors({});
                setTouched({});
              }}
              data-testid="button-clear-form"
            >
              Clear
            </Button>
          )}
          <Button
            type="submit"
            disabled={saveEntry.isPending}
            data-testid="button-save-entry"
          >
            {saveEntry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editingEntry ? "Update" : "Save Entry"}
          </Button>
        </div>
      </div>
    </form>
  );
}

type UploadQueueItem = {
  queueId: string;
  file: File;
  blobUrl: string;
  aisle: string;
  section: string;
  status: "pending" | "uploading" | "failed";
  retries: number;
};

function MobileCaptureView({ sessionId, photos }: { sessionId: number; photos: Photo[] }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const aisleInputRef = useRef<HTMLInputElement>(null);
  const sectionInputRef = useRef<HTMLInputElement>(null);
  const [aisle, setAisle] = useState("");
  const [section, setSection] = useState("");
  const [recentPhotos, setRecentPhotos] = useState<Array<{ id: number; objectPath: string; notes: string; aisle: string; section: string; isDetailShot: boolean }>>([]);
  const [savingNotes, setSavingNotes] = useState<Record<number, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [photoSort, setPhotoSort] = useState<"latest" | "aisle">("aisle");
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const notesTimerRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const blobUrlsRef = useRef<Set<string>>(new Set());

  const isReceiving = aisle.trim().toLowerCase() === "receiving";

  useEffect(() => {
    if (photos.length > 0) {
      const mapped = photos.map(p => ({
        id: p.id,
        objectPath: p.objectStorageKey,
        notes: p.notes || "",
        aisle: p.aisle || "",
        section: p.section || "",
        isDetailShot: p.isDetailShot || false,
      }));
      setRecentPhotos(mapped);
    }
  }, [photos]);

  useEffect(() => {
    if (processingRef.current) return;
    const nextItem = uploadQueue.find(q => q.status === "pending");
    if (!nextItem) return;
    processingRef.current = true;
    setUploadQueue(prev => prev.map(q => q.queueId === nextItem.queueId ? { ...q, status: "uploading" as const } : q));

    (async () => {
      try {
        const formData = new FormData();
        formData.append("file", nextItem.file);
        const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: formData, credentials: "include" });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const uploadResult = await uploadRes.json();

        const res = await apiRequest("POST", `/api/sessions/${sessionId}/photos`, {
          objectStorageKey: uploadResult.objectPath,
          originalFilename: nextItem.file.name,
          mimeType: nextItem.file.type,
          aisle: nextItem.aisle,
          section: nextItem.section,
        });
        const savedPhoto = await res.json();

        if (!mountedRef.current) return;
        setRecentPhotos(prev => [...prev, {
          id: savedPhoto.id,
          objectPath: uploadResult.objectPath,
          notes: "",
          aisle: nextItem.aisle,
          section: nextItem.section,
          isDetailShot: false,
        }]);
        URL.revokeObjectURL(nextItem.blobUrl);
        blobUrlsRef.current.delete(nextItem.blobUrl);
        setUploadQueue(prev => prev.filter(q => q.queueId !== nextItem.queueId));
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      } catch {
        if (!mountedRef.current) return;
        setUploadQueue(prev => prev.map(q => q.queueId === nextItem.queueId ? { ...q, status: "failed" as const, retries: q.retries + 1 } : q));
        toast({ title: "Photo upload failed — tap to retry", variant: "destructive" });
      } finally {
        processingRef.current = false;
      }
    })();
  }, [uploadQueue, sessionId, toast]);

  const retryUpload = useCallback((queueId: string) => {
    setUploadQueue(prev => prev.map(q => q.queueId === queueId ? { ...q, status: "pending" as const } : q));
  }, []);

  const dismissFailedUpload = useCallback((queueId: string) => {
    setUploadQueue(prev => {
      const item = prev.find(q => q.queueId === queueId);
      if (item) {
        URL.revokeObjectURL(item.blobUrl);
        blobUrlsRef.current.delete(item.blobUrl);
      }
      return prev.filter(q => q.queueId !== queueId);
    });
  }, []);

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const sectionValue = isReceiving && !section.trim() ? "000" : section;
    const newItems: UploadQueueItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const blobUrl = URL.createObjectURL(file);
      blobUrlsRef.current.add(blobUrl);
      newItems.push({
        queueId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        blobUrl,
        aisle,
        section: sectionValue,
        status: "pending",
        retries: 0,
      });
    }
    setUploadQueue(prev => [...prev, ...newItems]);
    toast({ title: `${newItems.length} photo${newItems.length > 1 ? "s" : ""} queued` });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
    };
  }, []);

  const isUploading = uploadQueue.some(q => q.status === "uploading");
  const pendingCount = uploadQueue.filter(q => q.status === "pending" || q.status === "uploading").length;
  const failedCount = uploadQueue.filter(q => q.status === "failed").length;

  const toggleDetailShot = useCallback(async (photoId: number, isDetail: boolean) => {
    setRecentPhotos(prev => prev.map(p => p.id === photoId ? { ...p, isDetailShot: isDetail } : p));
    try {
      await apiRequest("PATCH", `/api/photos/${photoId}`, { isDetailShot: isDetail });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
    } catch {
      setRecentPhotos(prev => prev.map(p => p.id === photoId ? { ...p, isDetailShot: !isDetail } : p));
    }
  }, [sessionId]);

  const deletePhoto = useCallback(async (photoId: number) => {
    try {
      await apiRequest("DELETE", `/api/photos/${photoId}`);
      setRecentPhotos(prev => prev.filter(p => p.id !== photoId));
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      toast({ title: "Photo deleted" });
    } catch {
      toast({ title: "Failed to delete photo", variant: "destructive" });
      setConfirmDeleteId(null);
    }
  }, [sessionId, toast]);

  const updatePhotoNotes = useCallback((photoId: number, notes: string) => {
    setRecentPhotos(prev => prev.map(p => p.id === photoId ? { ...p, notes } : p));
    if (notesTimerRef.current[photoId]) clearTimeout(notesTimerRef.current[photoId]);
    notesTimerRef.current[photoId] = setTimeout(async () => {
      setSavingNotes(prev => ({ ...prev, [photoId]: true }));
      try {
        await apiRequest("PATCH", `/api/photos/${photoId}`, { notes });
      } catch {}
      setSavingNotes(prev => ({ ...prev, [photoId]: false }));
    }, 800);
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          {!aisle.trim() && (
            <div className="rounded-md border border-[hsl(18_85%_40%/0.5)] bg-[hsl(18_85%_40%/0.08)] px-3 py-2 text-sm text-muted-foreground" data-testid="text-aisle-required">
              Enter an aisle below to start capturing photos
            </div>
          )}
          <form onSubmit={(e) => e.preventDefault()} className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs underline">Aisle: <span className="text-destructive">*</span></Label>
              <Input
                ref={aisleInputRef}
                value={aisle}
                onChange={(e) => setAisle(e.target.value)}
                placeholder="Aisle"
                className={!aisle.trim() ? "border-[hsl(18_85%_40%/0.5)] ring-1 ring-[hsl(18_85%_40%/0.3)]" : ""}
                disabled={isReceiving}
                tabIndex={1}
                enterKeyHint="next"
                data-testid="input-mobile-aisle"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sectionInputRef.current?.focus(); } }}
              />
              <label className="flex items-center gap-2 cursor-pointer pt-1" data-testid="checkbox-receiving">
                <Checkbox
                  checked={isReceiving}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setAisle("Receiving");
                      setSection("");
                    } else {
                      setAisle("");
                    }
                  }}
                  className="h-8 w-8 [&_svg]:h-5 [&_svg]:w-5"
                />
                <span className="text-sm text-muted-foreground">Receiving</span>
              </label>
            </div>
            <div className="space-y-1">
              <Label className="text-xs underline">Section:{!isReceiving && <span className="text-destructive"> *</span>}</Label>
              <Input
                ref={sectionInputRef}
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder={isReceiving ? "Optional" : "Section"}
                tabIndex={2}
                enterKeyHint="done"
                data-testid="input-mobile-section"
                onKeyDown={(e) => { if (e.key === "Enter") { sectionInputRef.current?.blur(); } }}
              />
            </div>
          </form>

          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCapture} data-testid="input-mobile-file" />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapture} data-testid="input-mobile-camera" />

          <div className="flex gap-2">
            <Button
              className="flex-1"
              size="lg"
              onClick={() => cameraInputRef.current?.click()}
              disabled={!aisle.trim()}
              data-testid="button-mobile-camera"
            >
              <Camera className="h-5 w-5 mr-2" />
              Take Photo
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              disabled={!aisle.trim()}
              data-testid="button-mobile-upload"
            >
              <ImagePlus className="h-5 w-5" />
            </Button>
          </div>
          {(pendingCount > 0 || failedCount > 0) && (
            <div className="space-y-2" data-testid="upload-queue-status">
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Uploading {pendingCount} photo{pendingCount > 1 ? "s" : ""} in background...</span>
                </div>
              )}
              {failedCount > 0 && (
                <div className="space-y-1">
                  {uploadQueue.filter(q => q.status === "failed").map(item => (
                    <div key={item.queueId} className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2" data-testid={`upload-failed-${item.queueId}`}>
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                      <span className="text-xs flex-1 truncate">{item.file.name} failed</span>
                      <Button size="sm" variant="outline" onClick={() => retryUpload(item.queueId)} data-testid={`button-retry-${item.queueId}`}>
                        <RotateCw className="h-3 w-3 mr-1" /> Retry
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => dismissFailedUpload(item.queueId)} data-testid={`button-dismiss-${item.queueId}`}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {(recentPhotos.length > 0 || uploadQueue.length > 0) && (() => {
        type DisplayPhoto = { id: number; objectPath: string; notes: string; aisle: string; section: string; isDetailShot: boolean; queueId?: string; queueStatus?: "pending" | "uploading" | "failed"; blobUrl?: string };
        const sorted: DisplayPhoto[] = [...recentPhotos];
        if (photoSort === "latest") {
          sorted.sort((a, b) => b.id - a.id);
        } else {
          sorted.sort((a, b) => {
            const aIsRec = a.aisle.toLowerCase() === "receiving";
            const bIsRec = b.aisle.toLowerCase() === "receiving";
            if (aIsRec && !bIsRec) return 1;
            if (!aIsRec && bIsRec) return -1;
            if (aIsRec && bIsRec) return b.id - a.id;
            const aisleComp = a.aisle.localeCompare(b.aisle, undefined, { numeric: true });
            if (aisleComp !== 0) return aisleComp;
            return (a.section || "").localeCompare(b.section || "", undefined, { numeric: true });
          });
        }
        uploadQueue.forEach(q => {
          sorted.push({
            id: -1,
            objectPath: "",
            notes: "",
            aisle: q.aisle,
            section: q.section,
            isDetailShot: false,
            queueId: q.queueId,
            queueStatus: q.status,
            blobUrl: q.blobUrl,
          });
        });
        if (sorted.length === 0) return null;
        const safeIndex = Math.min(currentPhotoIndex, sorted.length - 1);
        const photo = sorted[safeIndex];
        if (!photo) return null;
        const imgSrc = photo.blobUrl ? photo.blobUrl : (photo.objectPath.startsWith("/uploads/") ? photo.objectPath : `/uploads/${photo.objectPath}`);
        return (
          <Card>
            <CardHeader className="p-3 flex flex-row items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPhotoIndex(i => i - 1)}
                disabled={safeIndex === 0}
                data-testid="button-photo-prev-top"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Prev
              </Button>
              <CardTitle className="text-sm" data-testid="text-mobile-photo-count">{safeIndex + 1} / {sorted.length}</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPhotoIndex(i => i + 1)}
                disabled={safeIndex >= sorted.length - 1}
                data-testid="button-photo-next-top"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-3">
              <div className="space-y-2" data-testid={`mobile-photo-${photo.queueId || photo.id}`}>
                <div className="relative">
                  <img
                    src={imgSrc}
                    alt={photo.queueId ? "Uploading..." : `Photo ${photo.id}`}
                    className={`w-full rounded-md object-cover max-h-64 ${photo.queueStatus ? "opacity-60" : ""}`}
                    data-testid={`img-mobile-photo-${photo.queueId || photo.id}`}
                  />
                  {photo.queueStatus && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center rounded-md bg-background/40">
                      {photo.queueStatus === "uploading" && (
                        <>
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <span className="text-sm font-medium mt-2">Uploading...</span>
                        </>
                      )}
                      {photo.queueStatus === "pending" && (
                        <>
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                          <span className="text-sm text-muted-foreground mt-2">Queued</span>
                        </>
                      )}
                      {photo.queueStatus === "failed" && (
                        <div className="flex flex-col items-center gap-2">
                          <AlertTriangle className="h-8 w-8 text-destructive" />
                          <span className="text-sm font-medium text-destructive">Upload failed</span>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => retryUpload(photo.queueId!)} data-testid={`button-retry-inline-${photo.queueId}`}>
                              <RotateCw className="h-3 w-3 mr-1" /> Retry
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => dismissFailedUpload(photo.queueId!)} data-testid={`button-dismiss-inline-${photo.queueId}`}>
                              <X className="h-3 w-3 mr-1" /> Dismiss
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {!photo.queueStatus && (
                <>
                <div className="flex items-center justify-between gap-2">
                  {(photo.aisle || (photo.section && photo.section !== "000")) ? (
                    <p className="text-xs text-muted-foreground">
                      {photo.aisle && <span>Aisle: {photo.aisle}</span>}
                      {photo.aisle && photo.section && photo.section !== "000" && <span>, </span>}
                      {photo.section && photo.section !== "000" && <span>Section: {photo.section}</span>}
                    </p>
                  ) : <div />}
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer" data-testid={`checkbox-detail-${photo.id}`}>
                      <Checkbox
                        checked={photo.isDetailShot}
                        onCheckedChange={(checked) => toggleDetailShot(photo.id, !!checked)}
                      />
                      <span className="text-xs text-muted-foreground">Detail shot</span>
                    </label>
                    {confirmDeleteId === photo.id ? (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="destructive" onClick={() => { deletePhoto(photo.id); setCurrentPhotoIndex(i => Math.max(0, Math.min(i, sorted.length - 2))); }} data-testid={`button-confirm-delete-${photo.id}`}>
                          Delete
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmDeleteId(null)} data-testid={`button-cancel-delete-${photo.id}`}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDeleteId(photo.id)} data-testid={`button-delete-photo-${photo.id}`}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs underline">Notes:</Label>
                  <Textarea
                    value={photo.notes}
                    onChange={(e) => updatePhotoNotes(photo.id, e.target.value)}
                    placeholder="Photo notes..."
                    rows={2}
                    data-testid={`input-mobile-notes-${photo.id}`}
                  />
                  {savingNotes[photo.id] && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Saving...
                    </p>
                  )}
                </div>
                </>
                )}
                {photo.queueStatus && (photo.aisle || (photo.section && photo.section !== "000")) && (
                  <p className="text-xs text-muted-foreground">
                    {photo.aisle && <span>Aisle: {photo.aisle}</span>}
                    {photo.aisle && photo.section && photo.section !== "000" && <span>, </span>}
                    {photo.section && photo.section !== "000" && <span>Section: {photo.section}</span>}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-center gap-3 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPhotoIndex(i => i - 1)}
                  disabled={safeIndex === 0}
                  data-testid="button-photo-prev"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setPhotoSort(s => s === "latest" ? "aisle" : "latest"); setCurrentPhotoIndex(0); }}
                  data-testid="button-photo-sort"
                >
                  <ArrowUpDown className="h-3 w-3 mr-1" />
                  {photoSort === "latest" ? "By Aisle" : "Latest"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPhotoIndex(i => i + 1)}
                  disabled={safeIndex >= sorted.length - 1}
                  data-testid="button-photo-next"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}

function EntryTable({
  entries, loading, totalFootage, sessionId, onEdit, photos,
}: {
  entries: Entry[];
  loading: boolean;
  totalFootage: number;
  sessionId: number;
  onEdit: (entry: Entry) => void;
  photos: Photo[];
}) {
  const { toast } = useToast();
  const photoMap = new Map(photos.map(p => [p.id, p]));

  const { data: sessionPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
  });
  const pinByEntryId = new Map(sessionPins.filter(p => p.entryId).map(p => [p.entryId!, p]));

  const deleteEntry = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/entries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      toast({ title: "Entry deleted" });
    },
  });

  const getReelInfo = (entry: Entry) => {
    const totalFootage = entry.footage || 0;
    const reelCount = entry.reelCount || 1;
    const perReel = reelCount > 0 ? Math.round(totalFootage / reelCount) : totalFootage;
    return { reelCount, perReel, totalFootage };
  };

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  if (loading) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Cable className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">No entries yet. Add reels using the form above.</p>
        </CardContent>
      </Card>
    );
  }

  const grouped = entries.reduce<Record<string, typeof entries>>((acc, entry) => {
    const key = `${entry.aisle || "—"}-${entry.section || "—"}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});

  const sectionKeys = Object.keys(grouped).sort();

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Card>
      <CardHeader className="p-3">
        <CardTitle className="text-sm" data-testid="text-entries-title">Table View - {entries.length} Entries</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="entries-table" data-testid="entries-table">
            <thead>
              <tr>
                <th style={{ width: 65, textAlign: "center", whiteSpace: "nowrap" }}>Pin #:</th>
                <th style={{ textAlign: "center" }}>Aisle:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap", width: "auto" }}>Section:</th>
                <th style={{ textAlign: "center" }}>Category:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Reels:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Ft/Reel:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>Total Ft:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap", width: "auto" }}>Vendor Code:</th>
                <th style={{ width: 50, textAlign: "center" }}>Photo:</th>
                <th style={{ width: 70, textAlign: "center" }}>Actions:</th>
              </tr>
            </thead>
            <tbody>
              {sectionKeys.map((sectionKey) => {
                const sectionEntries = [...grouped[sectionKey]].sort((a, b) => {
                  const pinA = pinByEntryId.get(a.id);
                  const pinB = pinByEntryId.get(b.id);
                  const numA = pinA?.label ? parseInt(pinA.label, 10) : Infinity;
                  const numB = pinB?.label ? parseInt(pinB.label, 10) : Infinity;
                  return (isNaN(numA) ? Infinity : numA) - (isNaN(numB) ? Infinity : numB);
                });
                const isExpanded = expandedSections[sectionKey] ?? false;
                const sectionFootage = sectionEntries.reduce((s, e) => s + (e.footage || 0), 0);
                const [aisleLabel, sectionLabel] = sectionKey.split("-");
                return (
                  <Fragment key={sectionKey}>
                    <tr
                      className="section-header-row"
                      onClick={() => toggleSection(sectionKey)}
                      data-testid={`section-toggle-${sectionKey}`}
                    >
                      <td colSpan={10}>
                        <div className="flex items-center gap-2">
                          <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                          <span className="font-semibold">{aisleLabel.toLowerCase() === "receiving" ? "Receiving Area" : `Aisle ${aisleLabel}`} - {aisleLabel.toLowerCase() === "receiving" && sectionLabel === "000" ? "Section Unknown" : `Section ${sectionLabel}`}</span>
                          <span className="text-muted-foreground">({sectionEntries.length} {sectionEntries.length === 1 ? "entry" : "entries"}, {sectionFootage.toLocaleString()} ft. total)</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && sectionEntries.map((entry, idx) => {
                      const info = getReelInfo(entry);
                      return (<tr key={entry.id} data-testid={`row-entry-${entry.id}`}>
                        <td className="mono text-muted-foreground" style={{ textAlign: "center" }}>{pinByEntryId.get(entry.id)?.label || String(idx + 1).padStart(2, "0")}</td>
                        <td style={{ textAlign: "center" }}>{entry.aisle}</td>
                        <td style={{ textAlign: "center" }}>{entry.section}</td>
                        <td className="mono">{entry.reelTag || "-"}</td>
                        <td className="mono" style={{ textAlign: "center" }}>{info.reelCount}</td>
                        <td className="mono" style={{ textAlign: "center" }}>{info.perReel ? `${info.perReel.toLocaleString()}'` : "-"}</td>
                        <td className="mono" style={{ textAlign: "center" }}>{info.totalFootage ? `${info.totalFootage.toLocaleString()}'` : "-"}</td>
                        <td style={{ textAlign: "center" }}>{entry.manufacturer || "-"}</td>
                        <td style={{ textAlign: "center" }}>
                          {entry.photoId && photoMap.get(entry.photoId) ? (
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button size="icon" variant="ghost" data-testid={`button-view-photo-${entry.id}`}>
                                  <Eye className="h-3 w-3" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>Photo - {photoMap.get(entry.photoId)?.originalFilename || "Photo"}</DialogTitle>
                                </DialogHeader>
                                <img
                                  src={(() => { const p = photoMap.get(entry.photoId!); const key = p?.objectStorageKey || ""; return key.startsWith("/uploads/") ? key : `/uploads/${key}`; })()}
                                  alt="Entry photo"
                                  className="w-full rounded-md"
                                  data-testid={`img-entry-photo-${entry.id}`}
                                />
                              </DialogContent>
                            </Dialog>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => onEdit(entry)}
                              data-testid={`button-edit-entry-${entry.id}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid={`button-delete-entry-${entry.id}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Entry?</AlertDialogTitle>
                                  <AlertDialogDescription>This entry will be permanently removed.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteEntry.mutate(entry.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="font-semibold">
                  Total: {entries.length} entries
                </td>
                <td className="font-semibold mono" style={{ textAlign: "center" }} data-testid="text-total-footage">
                  {totalFootage.toLocaleString()}'
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
