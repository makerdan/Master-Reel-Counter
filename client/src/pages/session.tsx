import { useState, useRef, useCallback, useEffect, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft, Camera, ListPlus, Plus, Trash2, Pencil, Download, FileText,
  RotateCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, ChevronDown, Brain, Cable,
  Save, X, Loader2, RotateCcw, AlertTriangle, Move, StickyNote, Focus,
} from "lucide-react";
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
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { correctWireDetails, WIRE_TYPES as REF_WIRE_TYPES, WIRE_GAUGES, COLOR_CODES, VENDOR_CODES } from "@/lib/wireReference";
import type { Session, Entry, Photo, Pin } from "@shared/schema";

const WIRE_TYPES = ["THHN", "XHHW", "USE-2", "MC Cable", "NM-B", "SER", "UFB", "Bare", "Other"];
const GAUGES = ["14", "12", "10", "8", "6", "4", "3", "2", "1", "1/0", "2/0", "3/0", "4/0", "250", "300", "350", "500", "750"];
const POSITIONS = ["Top", "Middle", "Bottom", "Floor"];
const COLORS = ["Black", "White", "Red", "Blue", "Green", "Orange", "Yellow", "Brown", "Gray", "Purple", "Other"];

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
  aiConfidence?: number;
  correctionConfident?: boolean;
}

function formatSessionTime(firstPhotoAt: string | Date | null, lastPhotoAt: string | Date | null) {
  if (!firstPhotoAt) return "No photos yet";
  const fmt = (d: string | Date) => new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  if (!lastPhotoAt || new Date(firstPhotoAt).getTime() === new Date(lastPhotoAt).getTime()) {
    return fmt(firstPhotoAt);
  }
  const diff = new Date(lastPhotoAt).getTime() - new Date(firstPhotoAt).getTime();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const elapsed = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `${fmt(firstPhotoAt)} - ${fmt(lastPhotoAt)} (${elapsed})`;
}

export default function SessionPage() {
  const [, params] = useRoute("/session/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const sessionId = params?.id ? parseInt(params.id) : 0;

  const { data: session, isLoading: sessionLoading } = useQuery<Session & { firstPhotoAt: string | null; lastPhotoAt: string | null }>({
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
  session: Session;
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
  const [editName, setEditName] = useState(session.name);
  const [editLocation, setEditLocation] = useState(session.location || "");

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


  const exportCsv = async () => {
    try {
      const res = await apiRequest("GET", `/api/sessions/${sessionId}/export`);
      const data = await res.json();
      const exportEntries = data.entries || entries;
      const exportPhotos = data.photos || [];
      const photoMap = new Map(exportPhotos.map((p: any) => [p.id, p]));
      const headers = ["#", "Aisle", "Section", "Position", "Pallet ID", "Reel Tag", "Wire Type", "Gauge", "Footage", "Color", "Manufacturer", "Notes", "Photo", "Photo Notes", "Detail Shot", "Parent Photo"];
      const rows = exportEntries.map((e: any, i: number) => {
        const photo = e.photoId ? photoMap.get(e.photoId) : null;
        const parentPhoto = photo?.parentPhotoId ? photoMap.get(photo.parentPhotoId) : null;
        return [
          i + 1, e.aisle, e.section, e.position || "", e.palletId || "", e.reelTag || "",
          e.wireType || "", e.gauge || "", e.footage || "", e.color || "", e.manufacturer || "", e.notes || "",
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
      const res = await apiRequest("GET", `/api/sessions/${sessionId}/export/pdf`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${session.name.replace(/\s+/g, "_")}_report.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      const w = window.open("", "_blank");
      if (!w) return;
      const rowsHtml = entries.map((e, i) => `
        <tr>
          <td>${i + 1}</td><td>${e.aisle}</td><td>${e.section}</td><td>${e.position || ""}</td>
          <td>${e.reelTag || ""}</td><td>${e.wireType || ""}</td><td>${e.gauge || ""}</td>
          <td>${e.footage || ""}</td><td>${e.color || ""}</td>
        </tr>
      `).join("");
      w.document.write(`<!DOCTYPE html><html><head><title>${session.name} - Report</title>
        <style>body{font-family:Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%;margin-top:12px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:12px}th{background:#f5f0eb}
        h1{font-size:18px}h2{font-size:14px;color:#666;margin-top:4px}.audit{margin-top:20px;font-size:10px;color:#999;border-top:1px solid #ddd;padding-top:8px}</style></head><body>
        <h1>Master Reel Counter - ${session.name}</h1>
        <h2>Location: ${session.location || "N/A"} | Entries: ${entries.length} | Total Footage: ${totalFootage.toLocaleString()} ft</h2>
        <table><thead><tr><th>#</th><th>Aisle</th><th>Section</th><th>Position</th><th>Reel Tag</th><th>Wire Type</th><th>Gauge</th><th>Footage</th><th>Color</th></tr></thead>
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
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-sm font-semibold truncate" data-testid="text-session-name">{session.name}</h1>
                <Badge
                  variant={session.status === "active" ? "default" : "secondary"}
                  className="no-default-hover-elevate no-default-active-elevate"
                  data-testid="badge-session-status"
                >
                  {session.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="mono" data-testid="text-entry-count">{entries.length} entries</span>
                <span className="mono" data-testid="text-session-time">{formatSessionTime(session.firstPhotoAt, session.lastPhotoAt)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="outline" onClick={exportCsv} data-testid="button-export-csv">
              <Download className="h-3 w-3" />
              CSV
            </Button>
            <Button size="sm" variant="outline" onClick={exportPdf} data-testid="button-export-pdf">
              <FileText className="h-3 w-3" />
              PDF
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-4 space-y-4">
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
            <PhotoMode sessionId={sessionId} photos={photos} />
          </TabsContent>

          <TabsContent value="single">
            <SingleEntryMode sessionId={sessionId} editingEntry={editingEntry} onDoneEditing={() => setEditingEntry(null)} />
          </TabsContent>
        </Tabs>

        <Separator />

        <EntryTable
          entries={entries}
          loading={entriesLoading}
          totalFootage={totalFootage}
          sessionId={sessionId}
          onEdit={(entry) => { setEditingEntry(entry); setMode("single"); }}
        />
      </div>

      {editingEntry && (
        <Dialog open={!!editingEntry} onOpenChange={(o) => { if (!o) setEditingEntry(null); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Entry #{editingEntry.id}</DialogTitle>
            </DialogHeader>
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
    </div>
  );
}

function PhotoMode({ sessionId, photos }: { sessionId: number; photos: Photo[] }) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [aisle, setAisle] = useState("");
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{ url: string; objectPath: string; section: string; aisle?: string; dbId?: number; filename?: string; timestamp?: string; notes?: string; isDetailShot?: boolean; parentPhotoId?: number }>>([]);
  const [currentPhotoIdx, setCurrentPhotoIdx] = useState(0);
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
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [aiProgressText, setAiProgressText] = useState("");
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; errors: string[] } | null>(null);

  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (photos.length > 0 && uploadedPhotos.length === 0) {
      const nameCounts: Record<string, number> = {};
      setUploadedPhotos(photos.map((p) => {
        let filename = p.originalFilename || undefined;
        if (filename) {
          const count = (nameCounts[filename] || 0) + 1;
          nameCounts[filename] = count;
          const dotIdx = filename.lastIndexOf(".");
          const base = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;
          const ext = dotIdx > 0 ? filename.substring(dotIdx) : "";
          filename = `${base}_${String(count).padStart(2, "0")}${ext}`;
        }
        return {
          url: p.objectStorageKey.startsWith("/objects/") ? p.objectStorageKey : `/objects/${p.objectStorageKey}`,
          objectPath: p.objectStorageKey,
          section: p.section || "",
          aisle: p.aisle || "",
          dbId: p.id,
          filename,
          timestamp: p.createdAt ? new Date(p.createdAt).toLocaleString() : undefined,
          notes: p.notes || "",
          isDetailShot: p.isDetailShot || false,
          parentPhotoId: p.parentPhotoId || undefined,
        };
      }));
      const firstAisle = photos.find(p => p.aisle)?.aisle;
      if (firstAisle && !aisle) setAisle(firstAisle);
    }
  }, [photos]);

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
      const result = await uploadFile(file);
      if (result) {
        const res = await apiRequest("POST", `/api/sessions/${sessionId}/photos`, {
          objectStorageKey: result.objectPath,
          originalFilename: file.name,
          mimeType: file.type,
          aisle,
          section: "",
        });
        const savedPhoto = await res.json();
        const photoUrl = result.objectPath.startsWith("/objects/") ? result.objectPath : `/objects/${result.objectPath}`;
        setUploadedPhotos((prev) => {
          const existingCount = prev.filter((p) => p.filename?.replace(/_\d+(?=\.\w+$)/, "") === file.name || p.filename === file.name).length;
          const dotIdx = file.name.lastIndexOf(".");
          const base = dotIdx > 0 ? file.name.substring(0, dotIdx) : file.name;
          const ext = dotIdx > 0 ? file.name.substring(dotIdx) : "";
          const numberedName = `${base}_${String(existingCount + prev.length + 1).padStart(2, "0")}${ext}`;
          return [...prev, {
            url: photoUrl,
            objectPath: result.objectPath,
            section: "",
            dbId: savedPhoto.id,
            filename: numberedName,
            timestamp: new Date().toLocaleString(),
          }];
        });
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
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

    const existingNumbers = localPins
      .map((p) => parseInt(p.label, 10))
      .filter((n) => !isNaN(n));
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
    setSelectedPinId(newPin.id);
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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursorX = (e.clientX - rect.left) / rect.width - 0.5;
    const cursorY = (e.clientY - rect.top) / rect.height - 0.5;
    const oldScale = scaleRef.current;
    const newScale = Math.min(5, Math.max(1, oldScale + (e.deltaY < 0 ? 0.2 : -0.2)));
    if (newScale === oldScale) return;
    const adjX = panXRef.current + cursorX * (1 / newScale - 1 / oldScale) * rect.width;
    const adjY = panYRef.current + cursorY * (1 / newScale - 1 / oldScale) * rect.height;
    const clamped = clampPan(adjX, adjY, newScale);
    setScale(newScale);
    setPanX(clamped.x);
    setPanY(clamped.y);
  }, [clampPan]);

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
          updates.aiConfidence = undefined;
          updates.correctionConfident = undefined;
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
          ? { ...p, wireDetails: src.wireDetails, vendorCode: src.vendorCode, footage: src.footage, aiConfidence: undefined, correctionConfident: undefined }
          : p
      );
    });
  }, []);

  const clearRow = useCallback((pinId: string) => {
    setLocalPins((prev) =>
      prev.map((p) =>
        p.id === pinId
          ? { ...p, wireDetails: undefined, vendorCode: undefined, footage: undefined, reelCount: 1, aiConfidence: undefined, correctionConfident: undefined }
          : p
      )
    );
  }, []);

  const createEntries = useMutation({
    mutationFn: async () => {
      const isDetail = currentPhoto?.isDetailShot || false;
      const parentPhoto = isDetail && currentPhoto?.parentPhotoId
        ? uploadedPhotos.find(p => p.dbId === currentPhoto.parentPhotoId)
        : undefined;
      const entryAisle = aisle || (isDetail && parentPhoto?.aisle ? parentPhoto.aisle : "") || "";
      const entrySection = currentPhoto?.section || parentPhoto?.section || "";
      const entryPhotoId = isDetail && parentPhoto?.dbId ? parentPhoto.dbId : currentPhoto?.dbId;
      const pinPhotoId = currentPhoto?.dbId;
      const errors: string[] = [];
      const totalEntries = localPins.reduce((sum, pin) => sum + pin.reelCount, 0);
      let completed = 0;
      setBatchProgress({ current: 0, total: totalEntries, errors: [] });

      for (const pin of localPins) {
        try {
          const entryIds: number[] = [];
          for (let r = 0; r < pin.reelCount; r++) {
            const reelLabel = pin.wireDetails || (pin.reelCount > 1 ? `Pin ${pin.label} (${r + 1}/${pin.reelCount})` : `Pin ${pin.label}`);
            const noteParts: string[] = [];
            if (pin.reelCount > 1) noteParts.push(`Reel ${r + 1} of ${pin.reelCount} at pin ${pin.label}`);
            if (isDetail) noteParts.push(`From detail shot: ${currentPhoto?.filename || "detail"}`);
            const res = await apiRequest("POST", `/api/sessions/${sessionId}/entries`, {
              aisle: entryAisle,
              section: entrySection,
              position: "Floor",
              reelTag: reelLabel,
              manufacturer: pin.vendorCode || undefined,
              footage: pin.footage || undefined,
              photoId: entryPhotoId || undefined,
              notes: noteParts.length > 0 ? noteParts.join(" | ") : undefined,
            });
            const entry = await res.json();
            entryIds.push(entry.id);
            completed++;
            setBatchProgress({ current: completed, total: totalEntries, errors });
          }
          if (pinPhotoId) {
            await apiRequest("POST", `/api/photos/${pinPhotoId}/pins`, {
              xPercent: pin.x,
              yPercent: pin.y,
              label: pin.label,
              reelCount: pin.reelCount,
              entryId: entryIds[0],
            });
          }
        } catch {
          errors.push(`Pin ${pin.label}`);
          setBatchProgress({ current: completed, total: totalEntries, errors });
        }
      }
      if (errors.length > 0) {
        throw new Error(`Failed to create entries for: ${errors.join(", ")}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      const totalCreated = localPins.reduce((sum, pin) => sum + pin.reelCount, 0);
      setLocalPins([]);
      setAiResult("");
      setBatchProgress(null);
      toast({ title: `Created ${totalCreated} entries from ${localPins.length} pins` });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      toast({ title: error.message, variant: "destructive" });
      setTimeout(() => setBatchProgress(null), 3000);
    },
  });

  const [aiFilter, setAiFilter] = useState("");

  const renderAnnotatedImage = useCallback(async (photoUrl: string, pins: typeof localPins): Promise<string | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        const boxSize = Math.max(60, Math.min(img.naturalWidth, img.naturalHeight) * 0.06);
        const lineWidth = Math.max(3, boxSize * 0.06);
        const fontSize = Math.max(16, boxSize * 0.45);
        for (const pin of pins) {
          const cx = (pin.x / 100) * img.naturalWidth;
          const cy = (pin.y / 100) * img.naturalHeight;
          ctx.strokeStyle = "rgba(255, 0, 0, 0.9)";
          ctx.lineWidth = lineWidth;
          ctx.strokeRect(cx - boxSize / 2, cy - boxSize / 2, boxSize, boxSize);
          ctx.fillStyle = "rgba(255, 0, 0, 0.85)";
          ctx.font = `bold ${fontSize}px Arial, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          const labelWidth = ctx.measureText(pin.label).width + 10;
          const labelHeight = fontSize + 6;
          ctx.fillRect(cx - labelWidth / 2, cy - boxSize / 2 - labelHeight - 2, labelWidth, labelHeight);
          ctx.fillStyle = "#FFFFFF";
          ctx.fillText(pin.label, cx, cy - boxSize / 2 - 4);
        }
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = photoUrl;
    });
  }, []);

  const buildPrompt = useCallback((pinPositions: string[], photoSection: string, filter: string, detailShotInfo?: { isDetailShot: boolean; parentFilename?: string; parentSection?: string }) => {
    let filterInstruction = "";
    if (filter.trim()) {
      filterInstruction = `\nFILTER: Only include tags containing or similar to "${filter.trim()}" (allow up to 3 character differences for OCR errors).`;
    }
    let detailContext = "";
    if (detailShotInfo?.isDetailShot) {
      detailContext = `\n\n=== DETAIL SHOT CONTEXT ===
This is a CLOSE-UP / DETAIL photo taken to get a better view of specific wire reel tag(s).
${detailShotInfo.parentFilename ? `Parent overview photo: ${detailShotInfo.parentFilename} (Section ${detailShotInfo.parentSection || "unknown"})` : ""}
Because this is a close-up, the tag text should be larger and more readable than in an overview shot.
Focus on reading the tag text as accurately as possible — this photo was taken specifically because the tag was hard to read in the wider shot.`;
    }
    return `You are a wire inventory tag reader analyzing a warehouse section photo.

=== ANNOTATED IMAGE ===
This photo shows wire reels in Aisle ${aisle}, Section ${photoSection}.
RED BOUNDING BOXES mark user-selected reel locations. Each box has a RED LABEL showing its position code (e.g., "01", "02").
Positions to analyze: ${pinPositions.join(", ")}${detailContext}

=== YOUR TASK ===
For each RED BOUNDING BOX, locate and read the WHITE PAPER TAG attached to or near that wire reel.

=== READING INSTRUCTIONS ===
1. Find the RED BOUNDING BOX with its position label (e.g., "01")
2. Look inside or immediately adjacent to that box for a WHITE PAPER TAG
3. Read the BLACK BOLD TEXT printed on the tag - this is the wire category code

=== WHITE PAPER TAG IDENTIFICATION ===
- WHITE rectangular paper tag, typically letter-size (11" x 8.5"), attached directly to the wire reel. Contrast may vary — tags can be dirty, faded, partially obscured, or against lighter-colored reels. Do not skip a tag just because contrast is low.
- BLACK BOLD TEXT - the primary category/wire code you need to read
- May include a checkmark but not always present
${filterInstruction}

=== WIRE CODE PATTERNS ===
Format: [TYPE][SIZE][COLOR][FOOTAGE] or [TYPE][SIZE]-[VENDOR]

Types: ${REF_WIRE_TYPES.join(", ")}
Sizes (AWG): ${WIRE_GAUGES.join(", ")}
Colors: ${COLOR_CODES.map(c => c).join(", ")}

Examples: THHN4BK1000, XHHW350WH2500, URD404040-ALU, 4TRIPLEX, THHN8GN5000-COP, TC441000

=== CRITICAL RULES ===
- Use ONLY the position from the RED LABEL - do not guess positions
- Report partial reads if full text is unclear (e.g., "THHN4??1000")
- wireDetails should be ALL CAPS, no spaces, no special characters except hyphen for vendor codes
- If a tag exists but is unreadable, include the position with wireDetails as "UNREADABLE"
- Return position values exactly as listed above with zero-padded two-digit format (e.g., "01", "02", "03")

=== JSON RESPONSE FORMAT ===
Return ONLY valid JSON. Include a "confidence" field (0-100) for each detected item indicating how confident you are in the wireDetails reading:
{
  "detected": [
    {"position": "01", "wireDetails": "THHN1GN2500", "confidence": 95},
    {"position": "02", "wireDetails": "URD404040-ALU", "confidence": 60}
  ],
  "notes": "Brief observation about tag visibility/readability for each position"
}

If no tags are readable: {"detected": [], "notes": "Describe what was visible in each bounding box"}`;
  }, [aisle]);

  const applyAiResultToPins = useCallback((resultText: string, pins: typeof localPins): { updatedPins: typeof localPins; filledCount: number; correctedCount: number; flaggedCount: number } => {
    let filledCount = 0;
    let correctedCount = 0;
    let flaggedCount = 0;
    try {
      let jsonStr = resultText;
      const jsonMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      } else {
        const objMatch = resultText.match(/\{[\s\S]*\}/);
        if (objMatch) jsonStr = objMatch[0];
      }
      const parsed = JSON.parse(jsonStr);
      if (parsed.detected && Array.isArray(parsed.detected)) {
        const updatedPins = pins.map((pin) => {
          const match = parsed.detected.find((d: any) => {
            const normPin = pin.label.trim().toUpperCase();
            const normItem = String(d.position || "").trim().toUpperCase();
            if (normPin === normItem) return true;
            const pinNum = parseInt(normPin, 10);
            const itemNum = parseInt(normItem, 10);
            if (!isNaN(pinNum) && !isNaN(itemNum) && pinNum === itemNum) return true;
            return normPin.startsWith(normItem) || normItem.startsWith(normPin);
          });
          if (match && match.wireDetails) {
            filledCount++;
            const details = String(match.wireDetails).toUpperCase().replace(/[^A-Z0-9\-]/g, "");
            const knownVendors = [...VENDOR_CODES, "COR"];
            const vendorMatch = details.match(/^(.+)-([A-Z]+)$/);
            const hasVendor = vendorMatch && knownVendors.includes(vendorMatch[2]);
            const rawWire = hasVendor ? vendorMatch[1] : details;
            const correction = correctWireDetails(rawWire);
            const aiConf = typeof match.confidence === "number" ? match.confidence : 100;
            if (correction.wasModified) correctedCount++;
            if (!correction.confident) flaggedCount++;
            const parsedFootage = correction.parts.footage ? parseInt(correction.parts.footage) : undefined;
            const derivedVendor = deriveVendorCode(correction.correctedDetails);
            return {
              ...pin,
              wireDetails: correction.correctedDetails,
              vendorCode: hasVendor ? vendorMatch[2] : (derivedVendor || pin.vendorCode),
              footage: match.footage || parsedFootage || pin.footage,
              aiConfidence: aiConf,
              correctionConfident: correction.confident,
            };
          }
          return pin;
        });
        return { updatedPins, filledCount, correctedCount, flaggedCount };
      }
    } catch {}
    return { updatedPins: pins, filledCount: 0, correctedCount: 0, flaggedCount: 0 };
  }, []);

  const analyzePhoto = async () => {
    await flushSavePins();
    const photosWithPins: { photoIdx: number; photo: typeof uploadedPhotos[0]; pins: typeof localPins }[] = [];

    for (let idx = 0; idx < uploadedPhotos.length; idx++) {
      const photo = uploadedPhotos[idx];
      if (!photo.dbId) continue;
      try {
        const res = await apiRequest("GET", `/api/photos/${photo.dbId}/pins`);
        const dbPins: Pin[] = await res.json();
        const draftPins = dbPins.filter(p => !p.entryId);
        if (draftPins.length > 0) {
          photosWithPins.push({
            photoIdx: idx,
            photo,
            pins: draftPins.map(p => ({
              id: `pin-${p.id}`,
              x: p.xPercent,
              y: p.yPercent,
              label: p.label || "01",
              reelCount: p.reelCount || 1,
              wireDetails: p.wireDetails || undefined,
              vendorCode: p.vendorCode || undefined,
              footage: p.footage || undefined,
            })),
          });
        }
      } catch {}
    }

    if (photosWithPins.length === 0) {
      toast({ title: "No photos have pins to analyze", variant: "destructive" });
      return;
    }

    setAiLoading(true);
    setAiResult("");
    let totalFilled = 0;
    let totalCorrected = 0;
    let totalFlagged = 0;
    let totalPins = 0;

    try {
      for (let i = 0; i < photosWithPins.length; i++) {
        const { photoIdx, photo, pins } = photosWithPins[i];
        const photoName = photo.filename || `Photo ${photoIdx + 1}`;
        setAiProgressText(`Analyzing ${photoName} (${i + 1} of ${photosWithPins.length})...`);
        setCurrentPhotoIdx(photoIdx);

        const annotatedDataUrl = await renderAnnotatedImage(photo.url, pins);
        if (!annotatedDataUrl) continue;

        const pinPositions = pins.map((p) => p.label).sort();
        let detailShotInfo: { isDetailShot: boolean; parentFilename?: string; parentSection?: string } | undefined;
        if (photo.isDetailShot) {
          const parentPhoto = photo.parentPhotoId ? uploadedPhotos.find(p => p.dbId === photo.parentPhotoId) : undefined;
          detailShotInfo = {
            isDetailShot: true,
            parentFilename: parentPhoto?.filename,
            parentSection: parentPhoto?.section,
          };
        }
        const prompt = buildPrompt(pinPositions, photo.section || "", aiFilter, detailShotInfo);

        const res = await apiRequest("POST", "/api/ai/analyze", {
          imageDataUrl: annotatedDataUrl,
          prompt,
        });
        const data = await res.json();
        const resultText = data.result || "";

        if (photoIdx === currentPhotoIdx || i === photosWithPins.length - 1) {
          setAiResult(resultText);
        }

        const { updatedPins, filledCount, correctedCount, flaggedCount } = applyAiResultToPins(resultText, pins);
        totalFilled += filledCount;
        totalCorrected += correctedCount;
        totalFlagged += flaggedCount;
        totalPins += pins.length;

        try {
          await apiRequest("PUT", `/api/photos/${photo.dbId}/draft-pins`, {
            pins: updatedPins.map(p => ({
              xPercent: p.x,
              yPercent: p.y,
              label: p.label,
              reelCount: p.reelCount,
              wireDetails: p.wireDetails || null,
              vendorCode: p.vendorCode || null,
              footage: p.footage || null,
            })),
          });
        } catch {}

        if (photoIdx === currentPhotoIdx) {
          setLocalPins(updatedPins);
        }
      }

      const lastItem = photosWithPins[photosWithPins.length - 1];
      setCurrentPhotoIdx(lastItem.photoIdx);
      try {
        const res = await apiRequest("GET", `/api/photos/${lastItem.photo.dbId}/pins`);
        const dbPins: Pin[] = await res.json();
        const draftPins = dbPins.filter(p => !p.entryId);
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
        }
      } catch {}

      let msg = `AI analyzed ${photosWithPins.length} photo${photosWithPins.length > 1 ? "s" : ""}: filled ${totalFilled} of ${totalPins} pins`;
      if (totalCorrected > 0) msg += `, ${totalCorrected} auto-corrected`;
      if (totalFlagged > 0) msg += `, ${totalFlagged} need review`;
      toast({ title: msg });
    } catch (err) {
      toast({ title: "AI analysis failed", variant: "destructive" });
    } finally {
      setAiLoading(false);
      setAiProgressText("");
    }
  };

  const analyzeCurrentPhotoOnly = async () => {
    await flushSavePins();
    const photo = currentPhoto;
    if (!photo || !photo.dbId) {
      toast({ title: "No photo selected", variant: "destructive" });
      return;
    }
    if (localPins.length === 0) {
      toast({ title: "No pins on this photo to analyze", variant: "destructive" });
      return;
    }

    setAiLoading(true);
    setAiResult("");
    setAiProgressText(`Analyzing ${photo.filename || "current photo"}...`);

    try {
      const annotatedDataUrl = await renderAnnotatedImage(photo.url, localPins);
      if (!annotatedDataUrl) {
        toast({ title: "Failed to render annotated image", variant: "destructive" });
        return;
      }

      const pinPositions = localPins.map((p) => p.label).sort();
      let detailShotInfo: { isDetailShot: boolean; parentFilename?: string; parentSection?: string } | undefined;
      if (photo.isDetailShot) {
        const parentPhoto = photo.parentPhotoId ? uploadedPhotos.find(p => p.dbId === photo.parentPhotoId) : undefined;
        detailShotInfo = {
          isDetailShot: true,
          parentFilename: parentPhoto?.filename,
          parentSection: parentPhoto?.section,
        };
      }
      const prompt = buildPrompt(pinPositions, photo.section || "", aiFilter, detailShotInfo);

      const res = await apiRequest("POST", "/api/ai/analyze", {
        imageDataUrl: annotatedDataUrl,
        prompt,
      });
      const data = await res.json();
      const resultText = data.result || "";
      setAiResult(resultText);

      const { updatedPins, filledCount, correctedCount, flaggedCount } = applyAiResultToPins(resultText, localPins);

      try {
        await apiRequest("PUT", `/api/photos/${photo.dbId}/draft-pins`, {
          pins: updatedPins.map(p => ({
            xPercent: p.x,
            yPercent: p.y,
            label: p.label,
            reelCount: p.reelCount,
            wireDetails: p.wireDetails || null,
            vendorCode: p.vendorCode || null,
            footage: p.footage || null,
          })),
        });
      } catch {}

      setLocalPins(updatedPins);

      let msg = `AI analyzed this photo: filled ${filledCount} of ${localPins.length} pins`;
      if (correctedCount > 0) msg += `, ${correctedCount} auto-corrected`;
      if (flaggedCount > 0) msg += `, ${flaggedCount} need review`;
      toast({ title: msg });
    } catch (err) {
      toast({ title: "AI analysis failed", variant: "destructive" });
    } finally {
      setAiLoading(false);
      setAiProgressText("");
    }
  };

  const resetView = () => {
    setScale(1);
    setPanX(0);
    setPanY(0);
  };

  return (
    <div className="space-y-4 rounded-md border-2 border-[hsl(18_60%_30%/0.35)] bg-[hsl(30_10%_96%)] dark:bg-[hsl(25_8%_13%)] p-4">
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <Input
            value={aisle}
            onChange={(e) => {
              const val = e.target.value;
              setAisle(val);
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
            inputMode="numeric"
            className={`w-24 border-2 focus-visible:ring-[hsl(18_85%_48%)] bg-white dark:bg-[hsl(25_10%_10%)] placeholder:text-[hsl(18_85%_32%)] placeholder:font-semibold ${aisle.trim() ? "input-filled" : "input-pulse-empty"}`}
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
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                  disabled={currentPhotoIdx <= 0}
                  onClick={async () => { await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setCurrentPhotoIdx((i) => i - 1); setAiResult(""); resetView(); }}
                  data-testid="button-prev-photo"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <span className="text-sm mono text-[hsl(30_40%_85%)] min-w-[60px] text-center" data-testid="text-photo-counter">
                  {String(currentPhotoIdx + 1).padStart(2, "0")} / {String(uploadedPhotos.length).padStart(2, "0")}
                </span>
                <Button
                  size="icon"
                  className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                  disabled={currentPhotoIdx >= uploadedPhotos.length - 1}
                  onClick={async () => { await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setCurrentPhotoIdx((i) => i + 1); setAiResult(""); resetView(); }}
                  data-testid="button-next-photo"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
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
                  inputMode="numeric"
                  className={`w-24 border-2 focus-visible:ring-[hsl(18_85%_48%)] bg-white dark:bg-[hsl(25_10%_10%)] placeholder:text-[hsl(18_85%_32%)] placeholder:font-semibold ${(currentPhoto?.section || "").trim() ? "input-filled" : "input-pulse-empty"}`}
                  data-testid="input-photo-section"
                />
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

          {currentPhoto && (
            <div
              ref={containerRef}
              className="photo-viewer-container w-full"
              style={{ cursor: panMode ? "grab" : "crosshair" }}
              onMouseDown={handleMouseDown}
              onClick={handleContainerClick}
              onWheel={handleWheel}
              data-testid="photo-viewer"
            >
              <div className="photo-scroll-strip left" onWheel={(e) => e.stopPropagation()} />
              <div className="photo-scroll-strip right" onWheel={(e) => e.stopPropagation()} />
              <div
                className="relative w-full"
                style={{
                  transform: `scale(${scale}) translate(${panX}px, ${panY}px) rotate(${rotation}deg)`,
                  transformOrigin: "center center",
                }}
              >
              <img
                src={currentPhoto.url}
                alt="Section photo"
                draggable={false}
                className="w-full select-none"
                style={{ display: "block" }}
              />
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
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                  disabled={currentPhotoIdx <= 0}
                  onClick={async () => { await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setCurrentPhotoIdx((i) => i - 1); setAiResult(""); resetView(); }}
                  data-testid="button-prev-photo-bottom"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <span className="text-sm mono text-[hsl(30_40%_85%)] min-w-[60px] text-center" data-testid="text-photo-counter-bottom">
                  {String(currentPhotoIdx + 1).padStart(2, "0")} / {String(uploadedPhotos.length).padStart(2, "0")}
                </span>
                <Button
                  size="icon"
                  className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                  disabled={currentPhotoIdx >= uploadedPhotos.length - 1}
                  onClick={async () => { await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setCurrentPhotoIdx((i) => i + 1); setAiResult(""); resetView(); }}
                  data-testid="button-next-photo-bottom"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
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

          {localPins.length > 0 && (
            <div className="space-y-3">
              <Button
                size="lg"
                className="w-full bg-[hsl(18_85%_32%)] text-white border-2 border-[hsl(18_85%_26%)] text-base font-semibold tracking-wide"
                onClick={analyzePhoto}
                disabled={aiLoading}
                data-testid="button-ai-assist"
              >
                {aiLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
                {aiLoading && aiProgressText ? aiProgressText : "AI Assist - Read All Tags"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full border-2 border-[hsl(18_60%_40%/0.5)] text-[hsl(18_60%_40%)] dark:text-[hsl(25_60%_70%)] dark:border-[hsl(18_40%_50%/0.4)] text-base font-semibold tracking-wide"
                onClick={analyzeCurrentPhotoOnly}
                disabled={aiLoading}
                data-testid="button-ai-assist-current"
              >
                {aiLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
                AI Assist - Read Tags from This Photo Only
              </Button>
              <div className="flex items-center gap-2 flex-wrap bg-[hsl(25_12%_18%)] dark:bg-[hsl(25_8%_12%)] rounded-md px-3 py-2 border border-[hsl(18_60%_30%/0.2)]">
                <label className="text-xs font-semibold uppercase tracking-wider text-[hsl(25_60%_70%)] whitespace-nowrap">Filter:</label>
                <input
                  type="text"
                  value={aiFilter}
                  onChange={(e) => setAiFilter(e.target.value)}
                  placeholder="e.g. THHN, 4/0, BK (optional)"
                  className="flex-1 min-w-[120px] rounded-md border border-[hsl(18_40%_50%/0.4)] bg-white dark:bg-[hsl(25_10%_10%)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(18_85%_48%)] focus:border-transparent"
                  data-testid="input-ai-filter"
                />
              </div>

              {aiResult && (
                <div className="text-xs text-[hsl(25_60%_70%)] p-2.5 rounded-md border border-[hsl(18_60%_30%/0.2)] bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_11%)]" data-testid="text-ai-result">
                  <span className="font-semibold text-[hsl(18_80%_55%)]">AI Notes:</span> {(() => {
                    try {
                      let jsonStr = aiResult;
                      const jsonMatch = aiResult.match(/```(?:json)?\s*([\s\S]*?)```/);
                      if (jsonMatch) jsonStr = jsonMatch[1].trim();
                      else { const objMatch = aiResult.match(/\{[\s\S]*\}/); if (objMatch) jsonStr = objMatch[0]; }
                      const parsed = JSON.parse(jsonStr);
                      return parsed.notes || "Analysis complete.";
                    } catch { return aiResult.substring(0, 200); }
                  })()}
                </div>
              )}

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
                      <tr key={pin.id} data-testid={`pin-entry-row-${index}`}>
                        <td>
                          <span className="pin-position-cell">{pin.label}</span>
                        </td>
                        <td>
                          <input
                            type="text"
                            className={`input-caps${(pin.aiConfidence != null && pin.aiConfidence < 85) || pin.correctionConfident === false ? " low-confidence" : ""}`}
                            value={pin.wireDetails || ""}
                            onChange={(e) => updatePinField(pin.id, "wireDetails", e.target.value.toUpperCase())}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="characters"
                            data-testid={`input-wire-details-${index}`}
                          />
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
                  onClick={() => { setAiResult(""); setLocalPins([]); }}
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
  sessionId, editingEntry, onDoneEditing,
}: {
  sessionId: number;
  editingEntry: Entry | null;
  onDoneEditing: () => void;
}) {
  const { toast } = useToast();
  const [keepLocation, setKeepLocation] = useState(false);
  const [form, setForm] = useState({
    aisle: editingEntry?.aisle || "",
    section: editingEntry?.section || "",
    position: editingEntry?.position || "",
    palletId: editingEntry?.palletId || "",
    reelTag: editingEntry?.reelTag || "",
    wireType: editingEntry?.wireType || "",
    gauge: editingEntry?.gauge || "",
    footage: editingEntry?.footage?.toString() || "",
    color: editingEntry?.color || "",
    manufacturer: editingEntry?.manufacturer || "",
    notes: editingEntry?.notes || "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (editingEntry) {
      setForm({
        aisle: editingEntry.aisle || "",
        section: editingEntry.section || "",
        position: editingEntry.position || "",
        palletId: editingEntry.palletId || "",
        reelTag: editingEntry.reelTag || "",
        wireType: editingEntry.wireType || "",
        gauge: editingEntry.gauge || "",
        footage: editingEntry.footage?.toString() || "",
        color: editingEntry.color || "",
        manufacturer: editingEntry.manufacturer || "",
        notes: editingEntry.notes || "",
      });
      setErrors({});
      setTouched({});
    }
  }, [editingEntry]);

  const update = (field: string, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) {
      setErrors((e) => { const n = { ...e }; delete n[field]; return n; });
    }
  };

  const markTouched = (field: string) => {
    setTouched((t) => ({ ...t, [field]: true }));
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!form.aisle.trim()) newErrors.aisle = "Aisle is required";
    if (!form.section.trim()) newErrors.section = "Section is required";
    if (form.footage && isNaN(parseInt(form.footage))) newErrors.footage = "Must be a number";
    setErrors(newErrors);
    setTouched({ aisle: true, section: true, footage: true });
    return Object.keys(newErrors).length === 0;
  };

  const saveEntry = useMutation({
    mutationFn: async () => {
      const body = {
        aisle: form.aisle,
        section: form.section,
        position: form.position || null,
        palletId: form.palletId.toUpperCase() || null,
        reelTag: form.reelTag.toUpperCase() || null,
        wireType: form.wireType || null,
        gauge: form.gauge || null,
        footage: form.footage ? parseInt(form.footage) : null,
        color: form.color || null,
        manufacturer: form.manufacturer || null,
        notes: form.notes || null,
      };

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
          position: "", palletId: "", reelTag: "", wireType: "", gauge: "",
          footage: "", color: "", manufacturer: "", notes: "",
        });
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
    if (validate()) saveEntry.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Aisle <span className="text-destructive">*</span></Label>
          <Input
            value={form.aisle}
            onChange={(e) => update("aisle", e.target.value)}
            onBlur={() => markTouched("aisle")}
            inputMode="numeric"
            placeholder="Aisle"
            className={touched.aisle && errors.aisle ? "border-destructive" : ""}
            data-testid="input-aisle"
          />
          {touched.aisle && errors.aisle && (
            <p className="text-xs text-destructive" data-testid="error-aisle">{errors.aisle}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Section <span className="text-destructive">*</span></Label>
          <Input
            value={form.section}
            onChange={(e) => update("section", e.target.value)}
            onBlur={() => markTouched("section")}
            inputMode="numeric"
            placeholder="Section"
            className={touched.section && errors.section ? "border-destructive" : ""}
            data-testid="input-section"
          />
          {touched.section && errors.section && (
            <p className="text-xs text-destructive" data-testid="error-section">{errors.section}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Position</Label>
          <Select value={form.position} onValueChange={(v) => update("position", v)}>
            <SelectTrigger data-testid="select-position"><SelectValue placeholder="Position" /></SelectTrigger>
            <SelectContent>
              {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Pallet ID</Label>
          <Input value={form.palletId} onChange={(e) => update("palletId", e.target.value.toUpperCase())} placeholder="Pallet ID" data-testid="input-pallet-id" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reel Tag</Label>
          <Input value={form.reelTag} onChange={(e) => update("reelTag", e.target.value.toUpperCase())} placeholder="Reel Tag" data-testid="input-reel-tag" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Wire Type</Label>
          <Select value={form.wireType} onValueChange={(v) => update("wireType", v)}>
            <SelectTrigger data-testid="select-wire-type"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              {WIRE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Gauge</Label>
          <Select value={form.gauge} onValueChange={(v) => update("gauge", v)}>
            <SelectTrigger data-testid="select-gauge"><SelectValue placeholder="Gauge" /></SelectTrigger>
            <SelectContent>
              {GAUGES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Footage</Label>
          <Input
            type="number"
            value={form.footage}
            onChange={(e) => update("footage", e.target.value)}
            onBlur={() => markTouched("footage")}
            placeholder="Footage"
            className={touched.footage && errors.footage ? "border-destructive" : ""}
            data-testid="input-footage"
          />
          {touched.footage && errors.footage && (
            <p className="text-xs text-destructive" data-testid="error-footage">{errors.footage}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Color</Label>
          <Select value={form.color} onValueChange={(v) => update("color", v)}>
            <SelectTrigger data-testid="select-color"><SelectValue placeholder="Color" /></SelectTrigger>
            <SelectContent>
              {COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Manufacturer</Label>
          <Input value={form.manufacturer} onChange={(e) => update("manufacturer", e.target.value)} placeholder="Manufacturer" data-testid="input-manufacturer" />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Notes</Label>
        <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Notes..." rows={2} data-testid="input-notes" />
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

function EntryTable({
  entries, loading, totalFootage, sessionId, onEdit,
}: {
  entries: Entry[];
  loading: boolean;
  totalFootage: number;
  sessionId: number;
  onEdit: (entry: Entry) => void;
}) {
  const { toast } = useToast();

  const deleteEntry = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/entries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      toast({ title: "Entry deleted" });
    },
  });

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
                <th style={{ width: 65, textAlign: "center", whiteSpace: "nowrap" }}>Reel #:</th>
                <th style={{ textAlign: "center" }}>Aisle:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap", width: "auto" }}>Section:</th>
                <th style={{ textAlign: "center" }}>Category:</th>
                <th style={{ textAlign: "center" }}>Footage:</th>
                <th style={{ textAlign: "center", whiteSpace: "nowrap", width: "auto" }}>Vendor Code:</th>
                <th style={{ width: 70, textAlign: "center" }}>Actions:</th>
              </tr>
            </thead>
            <tbody>
              {sectionKeys.map((sectionKey) => {
                const sectionEntries = grouped[sectionKey];
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
                      <td colSpan={7}>
                        <div className="flex items-center gap-2">
                          <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                          <span className="font-semibold">Aisle {aisleLabel} - Section {sectionLabel}</span>
                          <span className="text-muted-foreground">({sectionEntries.length} {sectionEntries.length === 1 ? "entry" : "entries"}, {sectionFootage.toLocaleString()} ft. total)</span>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && sectionEntries.map((entry, idx) => (
                      <tr key={entry.id} data-testid={`row-entry-${entry.id}`}>
                        <td className="mono text-muted-foreground" style={{ textAlign: "center" }}>{String(idx + 1).padStart(2, "0")}</td>
                        <td style={{ textAlign: "center" }}>{entry.aisle}</td>
                        <td style={{ textAlign: "center" }}>{entry.section}</td>
                        <td className="mono">{entry.reelTag || "-"}</td>
                        <td className="mono" style={{ textAlign: "center" }}>{entry.footage ? `${entry.footage.toLocaleString()} ft.` : "-"}</td>
                        <td style={{ textAlign: "center" }}>{entry.manufacturer || "-"}</td>
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
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="font-semibold">
                  Total: {entries.length} entries
                </td>
                <td className="font-semibold mono" style={{ textAlign: "center" }} data-testid="text-total-footage">
                  {totalFootage.toLocaleString()} ft.
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
