import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Flag, Loader2, MapPin, Eye, X, Check, Share2, Camera, AlertTriangle, Pencil, ChevronDown, ChevronUp, Save, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Entry, Pin, Photo } from "@shared/schema";
import { detectDuplicatePins, loadScannerResults, type DuplicateGroup, type DuplicatePinInfo } from "@/lib/duplicateDetector";

interface FlaggedPin {
  id: number;
  photoId: number;
  entryId: number | null;
  xPercent: number;
  yPercent: number;
  label: string;
  reelCount: number;
  wireDetails: string | null;
  vendorCode: string | null;
  footage: number | null;
  flagged: boolean;
  photoUrl?: string;
  photoFilename?: string;
  photoAisle?: string | null;
  photoSection?: string | null;
  hasDetailPhoto?: boolean;
  hasNotes?: boolean;
  entryNotes?: string | null;
}

interface EditingState {
  wireDetails: string;
  vendorCode: string;
  footage: string;
  notes: string;
}

interface FlaggedReelsProps {
  sessionId: number;
  onBack: () => void;
  onReshoot?: (aisle: string, section: string, parentPhotoId: number) => void;
}

function photoUrl(key: string): string {
  return key.startsWith("/uploads/") ? key : `/uploads/${key}`;
}

function DupPinTile({ pin }: { pin: DuplicatePinInfo }) {
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null);

  let displayX = pin.xPercent;
  let displayY = pin.yPercent;
  if (imgNaturalSize) {
    const { w: iw, h: ih } = imgNaturalSize;
    if (iw > ih) {
      const ratio = iw / ih;
      displayX = pin.xPercent * ratio - (ratio - 1) * 50;
    } else if (ih > iw) {
      const ratio = ih / iw;
      displayY = pin.yPercent * ratio - (ratio - 1) * 50;
    }
  }

  return (
    <div
      className="flex-1 min-w-[140px] max-w-[220px] border border-border rounded overflow-hidden bg-card"
      data-testid={`dup-pin-${pin.pinId}`}
    >
      {pin.photoObjectStorageKey ? (
        <div className="relative w-full aspect-video bg-muted overflow-hidden">
          <img
            src={photoUrl(pin.photoObjectStorageKey)}
            alt={`Pin ${pin.pinId}`}
            className="w-full h-full object-cover"
            onLoad={(e) => {
              const img = e.currentTarget;
              setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${displayX}%`,
              top: `${displayY}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div className="w-5 h-5 rounded-full bg-amber-400 border-2 border-white shadow-md" />
          </div>
        </div>
      ) : (
        <div className="w-full aspect-video bg-muted flex items-center justify-center">
          <MapPin className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="p-1.5 space-y-0.5">
        {pin.wireDetails && (
          <p className="text-[10px] font-mono font-semibold truncate" data-testid={`text-dup-wire-${pin.pinId}`}>
            {pin.wireDetails}
          </p>
        )}
        {pin.scannerCatalog && (
          <p className="text-[10px] font-mono text-muted-foreground truncate" data-testid={`text-dup-scanner-${pin.pinId}`}>
            Scan: {pin.scannerCatalog}
            {pin.scannerConfidence && pin.scannerConfidence !== "none" && (
              <span className={`ml-1 ${pin.scannerConfidence === "high" ? "text-green-500" : pin.scannerConfidence === "medium" ? "text-amber-500" : "text-red-400"}`}>
                ({pin.scannerConfidence})
              </span>
            )}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground font-mono">
          {[pin.vendorCode, pin.footage ? `${pin.footage.toLocaleString()} ft` : null].filter(Boolean).join(" · ")}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {pin.entryId ? `Entry #${pin.entryId}` : "No entry"}
        </p>
      </div>
    </div>
  );
}

export default function FlaggedReels({ sessionId, onBack, onReshoot }: FlaggedReelsProps) {
  const { toast } = useToast();
  const [previewPin, setPreviewPin] = useState<FlaggedPin | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingPinId, setEditingPinId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditingState>({ wireDetails: "", vendorCode: "", footage: "", notes: "" });
  const [dupsOpen, setDupsOpen] = useState(true);

  const { data: flaggedPins = [], isLoading } = useQuery<FlaggedPin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/flagged-pins`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load flagged pins");
      return res.json();
    },
  });

  const unflagMutation = useMutation({
    mutationFn: async (pinId: number) => {
      await apiRequest("PATCH", `/api/pins/${pinId}/flag`, { flagged: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
    },
  });

  const savePinMutation = useMutation({
    mutationFn: async ({ pinId, entryId, data }: { pinId: number; entryId: number | null; data: EditingState }) => {
      const parsedFootage = data.footage ? Number(data.footage) : null;
      await apiRequest("PATCH", `/api/pins/${pinId}`, {
        wireDetails: data.wireDetails || null,
        vendorCode: data.vendorCode || null,
        footage: parsedFootage && Number.isFinite(parsedFootage) ? parsedFootage : null,
      });
      if (entryId && data.notes !== undefined) {
        await apiRequest("PATCH", `/api/entries/${entryId}`, { notes: data.notes || null });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      setEditingPinId(null);
      toast({ title: "Saved", description: "Pin details updated." });
    },
    onError: () => {
      toast({ title: "Save failed", variant: "destructive" });
    },
  });

  const openEditor = useCallback((pin: FlaggedPin) => {
    setEditingPinId(pin.id);
    setEditState({
      wireDetails: pin.wireDetails || "",
      vendorCode: pin.vendorCode || "",
      footage: pin.footage ? String(pin.footage) : "",
      notes: pin.entryNotes || "",
    });
  }, []);

  const { data: sessionEntries = [] } = useQuery<Entry[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "entries"],
  });

  const { data: sessionPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
  });

  const { data: sessionPhotos = [] } = useQuery<Photo[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "photos"],
  });

  const duplicateGroups = useMemo<DuplicateGroup[]>(() => {
    if (!sessionPins.length || !sessionPhotos.length) return [];
    const scannerResults = loadScannerResults(sessionId);
    return detectDuplicatePins(sessionPins, sessionPhotos, scannerResults);
  }, [sessionPins, sessionPhotos, sessionId]);

  const pinnedEntryIds = new Set(sessionPins.filter(p => p.entryId).map(p => p.entryId!));
  const unpinnedEntries = sessionEntries.filter(e => !pinnedEntryIds.has(e.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-lg font-bold underline flex items-center gap-2 justify-center" data-testid="text-flagged-heading">
          <Flag className="h-5 w-5 text-yellow-500" />
          <span className="sm:hidden">Flagged</span>
          <span className="hidden sm:inline">Flagged Reels</span>
          <Badge variant="secondary" data-testid="badge-flagged-count">{flaggedPins.length}</Badge>
        </h2>
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            data-testid="button-share-flagged"
            title="Copy shareable link"
            aria-label="Share"
            onClick={() => {
              const url = `${window.location.origin}/session/${sessionId}?tab=flagged`;
              navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                toast({ title: "Link copied", description: "Share this link with your team member." });
                setTimeout(() => setCopied(false), 2000);
              }).catch(() => {
                toast({ title: "Copy failed", description: url, variant: "destructive" });
              });
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5 sm:mr-1" /> : <Share2 className="h-3.5 w-3.5 sm:mr-1" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Share"}</span>
          </Button>
        </div>
      </div>

      {duplicateGroups.length > 0 && (
        <div className="space-y-2" data-testid="section-duplicates">
          <button
            className="flex items-center gap-2 w-full pt-2 border-t border-border text-left"
            onClick={() => setDupsOpen((o) => !o)}
            data-testid="button-toggle-duplicates"
          >
            <Copy className="h-4 w-4 text-orange-500 shrink-0" />
            <h3 className="text-sm font-semibold text-orange-600 dark:text-orange-400 flex-1">
              Possible Duplicates ({duplicateGroups.length})
            </h3>
            {dupsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {dupsOpen && (
            <div className="grid gap-2">
              {duplicateGroups.map((group) => (
                <div
                  key={`${group.label}-${group.aisle}-${group.section}`}
                  className={`border rounded-lg p-3 ${group.isDefiniteDoubleCount ? "border-orange-400/50 dark:border-orange-700/50 bg-orange-50/50 dark:bg-orange-950/20" : "border-amber-300/50 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10"}`}
                  data-testid={`dup-group-${group.label}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-sm font-semibold" data-testid={`text-dup-label-${group.label}`}>
                      Reel #{group.label}
                    </span>
                    {(group.aisle || group.section) && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {[group.aisle && `Aisle ${group.aisle}`, group.section && `Section ${group.section}`].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <Badge
                      className={`ml-auto text-[10px] ${group.isDefiniteDoubleCount ? "bg-orange-900/50 text-orange-300 border-orange-700/40" : "bg-amber-900/50 text-amber-300 border-amber-700/40"}`}
                      data-testid={`badge-dup-type-${group.label}`}
                    >
                      {group.isDefiniteDoubleCount ? "Double Count" : "Check Needed"}
                    </Badge>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {group.pins.map((pin) => (
                      <DupPinTile key={pin.pinId} pin={pin} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : flaggedPins.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="text-no-flagged">
          <Flag className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No flagged reels in this session.</p>
          <p className="text-xs mt-1">Use the flag button on pins in Photo Mode to mark reels for re-shoot.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {flaggedPins.map((pin) => (
            <div
              key={pin.id}
              className="border border-border rounded-lg p-3 bg-card hover:bg-accent/5 transition-colors"
              data-testid={`flagged-pin-card-${pin.id}`}
            >
              {/* Desktop layout */}
              <div className="hidden sm:flex items-start gap-3">
                {pin.photoUrl ? (
                  <div
                    className="relative w-20 h-20 rounded overflow-hidden border border-border shrink-0 cursor-pointer"
                    onClick={() => setPreviewPin(pin)}
                  >
                    <img
                      src={pin.photoUrl}
                      alt={pin.photoFilename || "Photo"}
                      className="w-full h-full object-cover"
                    />
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${pin.xPercent}%`,
                        top: `${pin.yPercent}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <div className="w-8 h-8 rounded-full animate-pulse" style={{ border: "4px solid #f97316" }} />
                      <div className="absolute inset-0 w-8 h-8 rounded-full border border-white" />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/30 transition-opacity">
                      <Eye className="h-4 w-4 text-white" />
                    </div>
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded bg-muted flex items-center justify-center shrink-0">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-medium" data-testid={`text-pin-label-${pin.id}`}>
                      Pin {pin.label}
                    </span>
                    {pin.wireDetails && (
                      <Badge variant="outline" className="text-xs" data-testid={`badge-wire-${pin.id}`}>
                        {pin.wireDetails}
                      </Badge>
                    )}
                    {(pin.hasDetailPhoto || pin.hasNotes || pin.wireDetails) ? (
                      <Badge className="text-[10px] bg-green-900/50 text-green-300 border-green-700/40" data-testid={`badge-addressed-${pin.id}`}>
                        Addressed
                      </Badge>
                    ) : (
                      <Badge className="text-[10px] bg-amber-900/50 text-amber-300 border-amber-700/40" data-testid={`badge-needs-attention-${pin.id}`}>
                        Needs Attention
                      </Badge>
                    )}
                  </div>
                  {(pin.photoAisle || pin.photoSection) && (
                    <div className="flex gap-2 text-sm font-mono mb-0.5" data-testid={`text-location-${pin.id}`}>
                      {pin.photoAisle && <span><span className="font-bold">Aisle</span> {pin.photoAisle}</span>}
                      {pin.photoAisle && pin.photoSection && <span>&middot;</span>}
                      {pin.photoSection && <span><span className="font-bold">Section</span> {pin.photoSection}</span>}
                    </div>
                  )}
                  <div className="flex gap-3 text-xs text-muted-foreground font-mono">
                    {pin.reelCount > 0 && <span>{pin.reelCount} reel{pin.reelCount !== 1 ? "s" : ""}</span>}
                    {pin.vendorCode && <span>{pin.vendorCode}</span>}
                    {pin.footage && <span>{pin.footage.toLocaleString()} ft</span>}
                  </div>
                  {pin.photoFilename && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {pin.photoFilename}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-3 shrink-0">
                  {onReshoot && (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => onReshoot(pin.photoAisle || "", pin.photoSection || "", pin.photoId)}
                      data-testid={`button-reshoot-${pin.id}`}
                      title="Take a detail photo in Mobile Flow"
                    >
                      <Camera className="h-5 w-5 mr-1.5" />
                      Re-shoot
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => editingPinId === pin.id ? setEditingPinId(null) : openEditor(pin)}
                    data-testid={`button-edit-${pin.id}`}
                    title="Edit details"
                  >
                    <Pencil className="h-5 w-5 mr-1.5" />
                    {editingPinId === pin.id ? "Close" : "Edit"}
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => unflagMutation.mutate(pin.id)}
                    disabled={unflagMutation.isPending}
                    data-testid={`button-resolve-${pin.id}`}
                    title="Mark as resolved"
                  >
                    <Check className="h-5 w-5 mr-1.5" />
                    Un-Flag
                  </Button>
                </div>
              </div>
              {editingPinId === pin.id && (
                <div className="hidden sm:block border-t border-border pt-3 mt-1">
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Category / Wire Details</label>
                      <Input
                        value={editState.wireDetails}
                        onChange={(e) => setEditState(s => ({ ...s, wireDetails: e.target.value }))}
                        placeholder="e.g. THHN #12 Black"
                        data-testid={`input-wire-details-${pin.id}`}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Vendor Code</label>
                      <Input
                        value={editState.vendorCode}
                        onChange={(e) => setEditState(s => ({ ...s, vendorCode: e.target.value.slice(0, 3) }))}
                        placeholder="e.g. SOU"
                        maxLength={3}
                        data-testid={`input-vendor-code-${pin.id}`}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Footage</label>
                      <Input
                        type="number"
                        value={editState.footage}
                        onChange={(e) => setEditState(s => ({ ...s, footage: e.target.value }))}
                        placeholder="e.g. 1000"
                        data-testid={`input-footage-${pin.id}`}
                      />
                    </div>
                  </div>
                  {pin.entryId && (
                    <div className="mb-3">
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Notes</label>
                      <Textarea
                        value={editState.notes}
                        onChange={(e) => setEditState(s => ({ ...s, notes: e.target.value }))}
                        placeholder="Add notes about this reel..."
                        rows={2}
                        data-testid={`input-notes-${pin.id}`}
                      />
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => savePinMutation.mutate({ pinId: pin.id, entryId: pin.entryId, data: editState })}
                      disabled={savePinMutation.isPending}
                      data-testid={`button-save-edit-${pin.id}`}
                    >
                      {savePinMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                      Save
                    </Button>
                  </div>
                </div>
              )}

              {/* Mobile layout */}
              <div className="sm:hidden flex flex-col items-center gap-2">
                <div className="flex items-center gap-2 w-full">
                  <span className="font-mono text-sm font-medium" data-testid={`text-pin-label-mobile-${pin.id}`}>
                    Pin {pin.label}
                  </span>
                  {pin.wireDetails && (
                    <Badge variant="outline" className="text-xs" data-testid={`badge-wire-mobile-${pin.id}`}>
                      {pin.wireDetails}
                    </Badge>
                  )}
                  {(pin.hasDetailPhoto || pin.hasNotes || pin.wireDetails) ? (
                    <Badge className="text-[10px] bg-green-900/50 text-green-300 border-green-700/40" data-testid={`badge-addressed-mobile-${pin.id}`}>
                      Addressed
                    </Badge>
                  ) : (
                    <Badge className="text-[10px] bg-amber-900/50 text-amber-300 border-amber-700/40" data-testid={`badge-needs-attention-mobile-${pin.id}`}>
                      Needs Attention
                    </Badge>
                  )}
                </div>
                {pin.photoUrl ? (
                  <div
                    className="relative w-full rounded overflow-hidden border border-border cursor-pointer"
                    onClick={() => setPreviewPin(pin)}
                  >
                    <img
                      src={pin.photoUrl}
                      alt={pin.photoFilename || "Photo"}
                      className="w-full h-auto block"
                    />
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${pin.xPercent}%`,
                        top: `${pin.yPercent}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <div className="w-8 h-8 rounded-full animate-pulse" style={{ border: "4px solid #f97316" }} />
                      <div className="absolute inset-0 w-8 h-8 rounded-full border border-white" />
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-24 rounded bg-muted flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 w-full text-sm font-mono text-muted-foreground">
                  <span><span className="font-bold">Aisle</span>{pin.photoAisle ? ` ${pin.photoAisle}` : ""}</span>
                  <span><span className="font-bold">Section</span>{pin.photoSection ? ` ${pin.photoSection}` : ""}</span>
                  <span>{pin.reelCount} Reel{pin.reelCount !== 1 ? "s" : ""}</span>
                  <span>{[pin.vendorCode, pin.footage ? `${pin.footage.toLocaleString()} ft` : ""].filter(Boolean).join(", ")}</span>
                </div>
                <div className="flex items-center justify-center gap-10 w-full py-2">
                  {onReshoot && (
                    <Button
                      variant="ghost"
                      className="rounded-full border border-white/80 ring-1 ring-white/30 w-14 h-14"
                      onClick={() => onReshoot(pin.photoAisle || "", pin.photoSection || "", pin.photoId)}
                      data-testid={`button-reshoot-mobile-${pin.id}`}
                      title="Re-shoot"
                      aria-label="Re-shoot"
                    >
                      <Camera className="h-7 w-7" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="rounded-full border border-white/80 ring-1 ring-white/30 w-14 h-14"
                    onClick={() => editingPinId === pin.id ? setEditingPinId(null) : openEditor(pin)}
                    data-testid={`button-edit-mobile-${pin.id}`}
                    title="Edit details"
                    aria-label="Edit details"
                  >
                    <Pencil className="h-7 w-7" />
                  </Button>
                  <Button
                    variant="ghost"
                    className="rounded-full border border-white/80 ring-1 ring-white/30 w-14 h-14"
                    onClick={() => unflagMutation.mutate(pin.id)}
                    disabled={unflagMutation.isPending}
                    data-testid={`button-resolve-mobile-${pin.id}`}
                    title="Un-Flag"
                    aria-label="Un-Flag"
                  >
                    <Check className="h-7 w-7" />
                  </Button>
                </div>
                {editingPinId === pin.id && (
                  <div className="w-full border-t border-border pt-3 mt-1 space-y-3">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Category / Wire Details</label>
                      <Input
                        value={editState.wireDetails}
                        onChange={(e) => setEditState(s => ({ ...s, wireDetails: e.target.value }))}
                        placeholder="e.g. THHN #12 Black"
                        data-testid={`input-wire-details-mobile-${pin.id}`}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Vendor Code</label>
                        <Input
                          value={editState.vendorCode}
                          onChange={(e) => setEditState(s => ({ ...s, vendorCode: e.target.value.slice(0, 3) }))}
                          placeholder="e.g. SOU"
                          maxLength={3}
                          data-testid={`input-vendor-code-mobile-${pin.id}`}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Footage</label>
                        <Input
                          type="number"
                          value={editState.footage}
                          onChange={(e) => setEditState(s => ({ ...s, footage: e.target.value }))}
                          placeholder="e.g. 1000"
                          data-testid={`input-footage-mobile-${pin.id}`}
                        />
                      </div>
                    </div>
                    {pin.entryId && (
                      <div>
                        <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Notes</label>
                        <Textarea
                          value={editState.notes}
                          onChange={(e) => setEditState(s => ({ ...s, notes: e.target.value }))}
                          placeholder="Add notes about this reel..."
                          rows={2}
                          data-testid={`input-notes-mobile-${pin.id}`}
                        />
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={() => savePinMutation.mutate({ pinId: pin.id, entryId: pin.entryId, data: editState })}
                        disabled={savePinMutation.isPending}
                        data-testid={`button-save-edit-mobile-${pin.id}`}
                      >
                        {savePinMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {unpinnedEntries.length > 0 && (
        <div className="space-y-2" data-testid="section-issues">
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              Entries Without Photos ({unpinnedEntries.length})
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">These entries have no linked photo. They can be edited or deleted from Table View.</p>
          <div className="grid gap-2">
            {unpinnedEntries.map((e) => (
              <div
                key={e.id}
                className="border border-amber-200 dark:border-amber-900/50 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-950/20"
                data-testid={`issue-entry-card-${e.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium truncate" data-testid={`text-issue-label-${e.id}`}>
                      {e.reelTag || e.wireType || "Entry"}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-issue-location-${e.id}`}>
                      Aisle {e.aisle} / Section {e.section}
                    </p>
                  </div>
                  <div className="text-xs font-mono text-muted-foreground text-right shrink-0">
                    {e.reelCount && e.reelCount > 0 && <div>{e.reelCount} reel{e.reelCount !== 1 ? "s" : ""}</div>}
                    {e.footage && <div>{Number(e.footage).toLocaleString()} ft</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewPin && previewPin.photoUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewPin(null)}
          data-testid="modal-pin-preview"
        >
          <div className="relative max-w-2xl max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="absolute -top-10 right-0 text-white hover:text-white/80"
              onClick={() => setPreviewPin(null)}
              data-testid="button-close-preview"
            >
              <X className="h-5 w-5" />
            </Button>
            <div className="relative">
              <img
                src={previewPin.photoUrl}
                alt="Flagged pin location"
                className="max-w-full max-h-[75vh] rounded-lg"
              />
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${previewPin.xPercent}%`,
                  top: `${previewPin.yPercent}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="w-24 h-24 rounded-full animate-pulse opacity-100" style={{ border: "12px solid #f97316" }} />
                <div className="absolute inset-0 w-24 h-24 rounded-full border-2 border-white opacity-100" />
              </div>
            </div>
            <div className="mt-2 text-white text-sm text-center">
              <span className="font-mono">Pin {previewPin.label}</span>
              {previewPin.wireDetails && <span className="ml-2">&mdash; {previewPin.wireDetails}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
