import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft, Camera, ListPlus, Plus, Trash2, Pencil, Download, FileText,
  RotateCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Brain, Cable,
  Save, X, Loader2, CheckCircle2, RotateCcw, AlertTriangle, Move,
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
import type { Session, Entry, Photo, Pin } from "@shared/schema";

const WIRE_TYPES = ["THHN", "XHHW", "USE-2", "MC Cable", "NM-B", "SER", "UFB", "Bare", "Other"];
const GAUGES = ["14", "12", "10", "8", "6", "4", "3", "2", "1", "1/0", "2/0", "3/0", "4/0", "250", "300", "350", "500", "750"];
const POSITIONS = ["Top", "Middle", "Bottom", "Floor"];
const COLORS = ["Black", "White", "Red", "Blue", "Green", "Orange", "Yellow", "Brown", "Gray", "Purple", "Other"];

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
}

function formatElapsed(startDate: string | Date) {
  const diff = Date.now() - new Date(startDate).getTime();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function SessionPage() {
  const [, params] = useRoute("/session/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const sessionId = params?.id ? parseInt(params.id) : 0;

  const { data: session, isLoading: sessionLoading } = useQuery<Session>({
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
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/sessions/${sessionId}`, {
        name: editName,
        location: editLocation || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      setEditSessionOpen(false);
      toast({ title: "Session updated" });
    },
    onError: () => {
      toast({ title: "Failed to update session", variant: "destructive" });
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async () => {
      const newStatus = session.status === "active" ? "completed" : "active";
      const body: any = { status: newStatus };
      if (newStatus === "completed") body.completedAt = new Date().toISOString();
      else body.completedAt = null;
      const res = await apiRequest("PATCH", `/api/sessions/${sessionId}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      toast({ title: session.status === "active" ? "Session completed" : "Session reopened" });
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
  });

  const exportCsv = () => {
    const headers = ["#", "Aisle", "Section", "Position", "Pallet ID", "Reel Tag", "Wire Type", "Gauge", "Footage", "Color", "Manufacturer", "Notes"];
    const rows = entries.map((e, i) => [
      i + 1, e.aisle, e.section, e.position || "", e.palletId || "", e.reelTag || "",
      e.wireType || "", e.gauge || "", e.footage || "", e.color || "", e.manufacturer || "", e.notes || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${v}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.name.replace(/\s+/g, "_")}_entries.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
        <div class="audit">Generated: ${new Date().toISOString()} | Session started: ${new Date(session.startedAt).toISOString()}</div>
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
                <span className="mono" data-testid="text-elapsed">{formatElapsed(session.startedAt)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => toggleStatus.mutate()}
              disabled={toggleStatus.isPending}
              data-testid="button-toggle-session-status"
            >
              {session.status === "active" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
            </Button>
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
          <TabsList className="w-full">
            <TabsTrigger value="photo" className="flex-1" data-testid="tab-photo-mode">
              <Camera className="h-4 w-4 mr-1" />
              Section Photo
            </TabsTrigger>
            <TabsTrigger value="single" className="flex-1" data-testid="tab-single-mode">
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
              if (editName.trim()) updateSession.mutate();
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
  const [aisle, setAisle] = useState("");
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{ url: string; objectPath: string; section: string; dbId?: number }>>([]);
  const [currentPhotoIdx, setCurrentPhotoIdx] = useState(0);
  const [localPins, setLocalPins] = useState<LocalPin[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
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
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; errors: string[] } | null>(null);

  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

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
      setUploadedPhotos(photos.map((p) => ({
        url: p.objectStorageKey.startsWith("/objects/") ? p.objectStorageKey : `/objects/${p.objectStorageKey}`,
        objectPath: p.objectStorageKey,
        section: p.section || "",
        dbId: p.id,
      })));
    }
  }, [photos]);

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
        setUploadedPhotos((prev) => [...prev, {
          url: photoUrl,
          objectPath: result.objectPath,
          section: "",
          dbId: savedPhoto.id,
        }]);
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
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

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => Math.min(5, Math.max(1, s + (e.deltaY < 0 ? 0.2 : -0.2))));
  };

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
      prev.map((p) => p.id === pinId ? { ...p, [field]: value, ...(field === "wireDetails" ? { aiConfidence: undefined } : {}) } : p)
    );
  }, []);

  const copyRowDown = useCallback((index: number) => {
    setLocalPins((prev) => {
      if (index >= prev.length - 1) return prev;
      const src = prev[index];
      return prev.map((p, i) =>
        i === index + 1
          ? { ...p, wireDetails: src.wireDetails, vendorCode: src.vendorCode, footage: src.footage, aiConfidence: undefined }
          : p
      );
    });
  }, []);

  const clearRow = useCallback((pinId: string) => {
    setLocalPins((prev) =>
      prev.map((p) =>
        p.id === pinId
          ? { ...p, wireDetails: undefined, vendorCode: undefined, footage: undefined, aiConfidence: undefined }
          : p
      )
    );
  }, []);

  const createEntries = useMutation({
    mutationFn: async () => {
      const section = currentPhoto?.section || "";
      const errors: string[] = [];
      const totalEntries = localPins.reduce((sum, pin) => sum + pin.reelCount, 0);
      let completed = 0;
      setBatchProgress({ current: 0, total: totalEntries, errors: [] });

      for (const pin of localPins) {
        try {
          const entryIds: number[] = [];
          for (let r = 0; r < pin.reelCount; r++) {
            const reelLabel = pin.wireDetails || (pin.reelCount > 1 ? `Pin ${pin.label} (${r + 1}/${pin.reelCount})` : `Pin ${pin.label}`);
            const res = await apiRequest("POST", `/api/sessions/${sessionId}/entries`, {
              aisle,
              section,
              position: "Floor",
              reelTag: reelLabel,
              manufacturer: pin.vendorCode || undefined,
              footage: pin.footage || undefined,
              notes: pin.reelCount > 1 ? `Reel ${r + 1} of ${pin.reelCount} at pin ${pin.label}` : undefined,
            });
            const entry = await res.json();
            entryIds.push(entry.id);
            completed++;
            setBatchProgress({ current: completed, total: totalEntries, errors });
          }
          if (currentPhoto?.dbId) {
            await apiRequest("POST", `/api/photos/${currentPhoto.dbId}/pins`, {
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

  const analyzePhoto = async () => {
    if (!currentPhoto || localPins.length === 0) {
      toast({ title: "Add pins to mark reel locations before running AI Assist", variant: "destructive" });
      return;
    }
    setAiLoading(true);
    setAiResult("");
    try {
      const pinPositions = localPins.map((p) => p.label).sort();
      let filterInstruction = "";
      if (aiFilter.trim()) {
        filterInstruction = `\nFILTER: Only include tags containing or similar to "${aiFilter.trim()}" (allow up to 3 character differences for OCR errors).`;
      }
      const prompt = `You are a wire inventory tag reader analyzing a warehouse section photo.

RED BOUNDING BOXES mark user-selected reel locations. Each box has a RED LABEL showing its position code.
Positions to analyze: ${pinPositions.join(", ")}

For each RED BOUNDING BOX, locate and read the WHITE PAPER TAG attached to or near that wire reel.

WHITE PAPER TAGS have BLACK BOLD TEXT - the primary wire category code.
Wire code patterns: [TYPE][SIZE][COLOR][FOOTAGE] e.g., THHN4BK1000, XHHW350WH2500
Types: THHN, XHHW, MHF, URD, SER, RX, TC, TRIPLEX, USE, NM
Sizes: 14, 12, 10, 8, 6, 4, 2, 1, 1/0, 2/0, 3/0, 4/0, 250, 300, 350, 500, 750
Colors: BK, WH, RD, BL, GN, OR, YL, GY${filterInstruction}

Return ONLY valid JSON:
{
  "detected": [
    {"position": "901", "wireDetails": "THHN1GN2500", "footage": 2500, "confidence": 95}
  ],
  "notes": "Brief observation"
}`;

      const res = await apiRequest("POST", "/api/ai/analyze", {
        imageUrl: currentPhoto.url,
        prompt,
      });
      const data = await res.json();
      const resultText = data.result || "";
      setAiResult(resultText);

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
          let filledCount = 0;
          setLocalPins((prev) =>
            prev.map((pin) => {
              const match = parsed.detected.find((d: any) => {
                const normPin = pin.label.trim().toUpperCase();
                const normItem = String(d.position || "").trim().toUpperCase();
                return normPin === normItem || normPin.startsWith(normItem) || normItem.startsWith(normPin);
              });
              if (match && match.wireDetails) {
                filledCount++;
                const details = String(match.wireDetails).toUpperCase().replace(/[^A-Z0-9/\-]/g, "");
                const vendorMatch = details.match(/^(.+?)-(\w+)$/);
                return {
                  ...pin,
                  wireDetails: vendorMatch ? vendorMatch[1] : details,
                  vendorCode: vendorMatch ? vendorMatch[2] : pin.vendorCode,
                  footage: match.footage || pin.footage,
                  aiConfidence: typeof match.confidence === "number" ? match.confidence : 100,
                };
              }
              return pin;
            })
          );
          toast({ title: `AI filled ${filledCount} of ${localPins.length} pin fields` });
        }
      } catch {
        // JSON parse failed, raw result already shown
      }
    } catch {
      toast({ title: "AI analysis failed", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const resetView = () => {
    setScale(1);
    setPanX(0);
    setPanY(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="space-y-1">
          <Label className="text-xs">Aisle</Label>
          <Input
            value={aisle}
            onChange={(e) => setAisle(e.target.value)}
            placeholder="Aisle"
            inputMode="numeric"
            className="w-24"
            data-testid="input-photo-aisle"
          />
        </div>
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            data-testid="button-upload-photos"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Upload Photos
          </Button>
        </div>
      </div>

      {uploadedPhotos.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                disabled={currentPhotoIdx <= 0}
                onClick={() => { setCurrentPhotoIdx((i) => i - 1); setLocalPins([]); resetView(); }}
                data-testid="button-prev-photo"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm mono" data-testid="text-photo-counter">
                {currentPhotoIdx + 1} / {uploadedPhotos.length}
              </span>
              <Button
                size="icon"
                variant="ghost"
                disabled={currentPhotoIdx >= uploadedPhotos.length - 1}
                onClick={() => { setCurrentPhotoIdx((i) => i + 1); setLocalPins([]); resetView(); }}
                data-testid="button-next-photo"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Section</Label>
              <Input
                value={currentPhoto?.section || ""}
                onChange={(e) => {
                  setUploadedPhotos((prev) =>
                    prev.map((p, i) => i === currentPhotoIdx ? { ...p, section: e.target.value } : p)
                  );
                }}
                placeholder="Section"
                inputMode="numeric"
                className="w-24"
                data-testid="input-photo-section"
              />
            </div>
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
              <img
                src={currentPhoto.url}
                alt="Section photo"
                draggable={false}
                className="w-full select-none"
                style={{
                  display: "block",
                  transform: `scale(${scale}) translate(${panX}px, ${panY}px) rotate(${rotation}deg)`,
                  transformOrigin: "center center",
                }}
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

          {localPins.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-sm font-semibold text-muted-foreground whitespace-nowrap">Filter:</label>
                <input
                  type="text"
                  value={aiFilter}
                  onChange={(e) => setAiFilter(e.target.value)}
                  placeholder="e.g. THHN, 4/0, BK (optional)"
                  className="flex-1 min-w-[120px] rounded-md border border-black dark:border-white px-3 py-2 text-sm"
                  data-testid="input-ai-filter"
                />
                <Button
                  variant="outline"
                  className="border-black dark:border-white"
                  onClick={analyzePhoto}
                  disabled={aiLoading}
                  data-testid="button-ai-assist"
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                  AI Assist - Read Tags
                </Button>
              </div>

              {aiResult && (
                <div className="text-xs text-muted-foreground p-2 rounded-md border" data-testid="text-ai-result">
                  <span className="font-semibold">AI Notes:</span> {(() => {
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

              <div className="text-sm font-semibold text-muted-foreground" data-testid="text-pin-table-title">Enter Details for Each Position</div>
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
                            className={`input-caps${pin.aiConfidence != null && pin.aiConfidence < 85 ? " low-confidence" : ""}`}
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

              {aiResult && (
                <>
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
                      onClick={() => createEntries.mutate()}
                      disabled={createEntries.isPending || !aisle}
                      data-testid="button-create-entries-from-pins"
                    >
                      {createEntries.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Create All Entries
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => { setLocalPins([]); setAiResult(""); }}
                      disabled={createEntries.isPending}
                      data-testid="button-clear-pins"
                    >
                      Clear All
                    </Button>
                  </div>
                  {!aisle && (
                    <p className="text-xs text-center text-muted-foreground" data-testid="text-create-entries-hint">
                      Fill in Aisle above to enable this button
                    </p>
                  )}
                </>
              )}
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

  return (
    <Card>
      <CardHeader className="p-3">
        <CardTitle className="text-sm">Entries ({entries.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Aisle</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Reel Tag</TableHead>
                <TableHead>Wire Type</TableHead>
                <TableHead>Gauge</TableHead>
                <TableHead>Footage</TableHead>
                <TableHead>Color</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry, idx) => (
                <TableRow key={entry.id} data-testid={`row-entry-${entry.id}`}>
                  <TableCell className="mono text-xs text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell className="text-xs">{entry.aisle}</TableCell>
                  <TableCell className="text-xs">{entry.section}</TableCell>
                  <TableCell className="text-xs">{entry.position || "-"}</TableCell>
                  <TableCell className="text-xs mono">{entry.reelTag || "-"}</TableCell>
                  <TableCell className="text-xs">{entry.wireType || "-"}</TableCell>
                  <TableCell className="text-xs">{entry.gauge || "-"}</TableCell>
                  <TableCell className="text-xs mono">{entry.footage?.toLocaleString() || "-"}</TableCell>
                  <TableCell className="text-xs">{entry.color || "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={7} className="text-xs font-semibold">
                  Total: {entries.length} entries
                </TableCell>
                <TableCell className="text-xs font-semibold mono" data-testid="text-total-footage">
                  {totalFootage.toLocaleString()} ft
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
