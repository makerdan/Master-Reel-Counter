import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Flag, Loader2, MapPin, Eye, X, Check, Share2, Camera, AlertTriangle, Pencil, ChevronDown, ChevronUp, Save, Copy, Trash2, EyeOff, ScanSearch, ArrowUpDown, CheckCircle2, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Entry, Pin, Photo, ReviewResponse } from "@shared/schema";
import { detectDuplicatePins, detectSameReelDuplicates, loadScannerResults, type DuplicateGroup, type DuplicatePinInfo } from "@/lib/duplicateDetector";
import { lookupCategory, type ParsedCatalogEntry, PARSED_CATALOG, userWireCategoryToParsedEntry } from "@/lib/wireReference";
import { toDisplayUnit, toBaseFeet, unitLabel } from "@/lib/unit-conversion";
import type { UnitType } from "@/lib/unit-conversion";
import { useVendorCodes } from "@/hooks/use-vendor-codes";
import { useWireCategories } from "@/hooks/use-wire-categories";

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
  flagReason: string | null;
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
  flagReason: string;
  reelCount: string;
}

interface FlaggedReelsProps {
  sessionId: number;
  onBack: () => void;
  onReshoot?: (aisle: string, section: string, parentPhotoId: number) => void;
  onViewInPhoto?: (photoId: number, pinId?: number) => void;
  pushUndo?: (action: { type: string; sessionId: number; entityId: number; data: any; previousData?: any }) => void;
}

function photoUrl(key: string): string {
  return key.startsWith("/uploads/") ? key : `/uploads/${key}`;
}


function PinLocationPhoto({
  photoUrl,
  xPercent,
  yPercent,
  photoFilename,
  onClick,
  containerClass,
  imgClass,
  dotClass,
  children,
}: {
  photoUrl: string;
  xPercent: number;
  yPercent: number;
  photoFilename?: string;
  onClick?: () => void;
  containerClass?: string;
  imgClass?: string;
  dotClass?: string;
  children?: React.ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [photoUrl]);
  return (
    <div className={`relative ${containerClass ?? ""}`} onClick={onClick}>
      <img
        src={photoUrl}
        alt={photoFilename || "Photo"}
        className={imgClass ?? "w-full h-full object-cover"}
        onLoad={() => setLoaded(true)}
      />
      {loaded && (
        <div
          className="absolute pointer-events-none"
          style={{ left: `${xPercent}%`, top: `${yPercent}%`, transform: "translate(-50%, -50%)" }}
        >
          <div className={dotClass ?? "w-8 h-8 rounded-full animate-pulse"} style={{ border: "4px solid #f97316" }} />
          <div className={`absolute inset-0 rounded-full border border-white ${dotClass ?? "w-8 h-8"}`} />
        </div>
      )}
      {children}
    </div>
  );
}

function dupGroupKey(group: DuplicateGroup): string {
  if (group.groupType === "same-reel") {
    const sortedIds = group.pins.map(p => p.pinId).sort((a, b) => a - b);
    return `samereel||${sortedIds.join("||")}`;
  }
  return `label||${group.label}||${group.aisle ?? ""}||${group.section ?? ""}`;
}

function DupPinTile({
  pin,
  siblingPinIds,
  sessionId,
  currentUnit,
  uLabel,
}: {
  pin: DuplicatePinInfo;
  siblingPinIds: number[];
  sessionId: number;
  currentUnit: UnitType;
  uLabel: string;
}) {
  const { toast } = useToast();
  const [tileLoaded, setTileLoaded] = useState(false);
  useEffect(() => { setTileLoaded(false); }, [pin.photoObjectStorageKey]);

  const keepMutation = useMutation({
    mutationFn: async () => {
      for (const id of siblingPinIds) {
        await apiRequest("DELETE", `/api/pins/${id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      toast({ title: "Kept", description: "Other duplicate pin(s) removed." });
    },
    onError: () => {
      toast({ title: "Failed", description: "Could not delete duplicate pins.", variant: "destructive" });
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/photos/${pin.photoId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      toast({ title: "Photo deleted", description: "Photo and its pins have been removed." });
    },
    onError: () => {
      toast({ title: "Failed", description: "Could not delete photo.", variant: "destructive" });
    },
  });

  return (
    <div
      className="flex-1 min-w-0 max-w-[47%] sm:max-w-[280px] border border-blue-600/50 rounded overflow-hidden bg-card"
      data-testid={`dup-pin-${pin.pinId}`}
    >
      {pin.photoObjectStorageKey ? (
        <div className="relative w-full bg-muted">
          <img
            src={photoUrl(pin.photoObjectStorageKey)}
            alt={`Pin ${pin.pinId}`}
            className="w-full h-auto block"
            onLoad={() => setTileLoaded(true)}
          />
          {tileLoaded && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${pin.xPercent}%`,
                top: `${pin.yPercent}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div className="w-2.5 h-2.5 sm:w-5 sm:h-5 rounded-full bg-amber-400 border sm:border-2 border-white shadow-md" />
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-32 bg-muted flex items-center justify-center">
          <MapPin className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="hidden sm:block p-1.5 space-y-1">
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
          {[pin.vendorCode, pin.footage ? `${toDisplayUnit(pin.footage, currentUnit).toLocaleString()} ${uLabel}` : null].filter(Boolean).join(" · ")}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {pin.entryId ? `Entry #${pin.entryId}` : "No entry"}
        </p>
        <div className="flex gap-1 pt-0.5">
          {siblingPinIds.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-6 text-[10px] px-1 text-green-600 !border-blue-600/50 hover:bg-green-50 dark:hover:bg-green-950/30"
              onClick={() => keepMutation.mutate()}
              disabled={keepMutation.isPending || deletePhotoMutation.isPending}
              data-testid={`button-keep-${pin.pinId}`}
              title="Keep this pin, delete others"
            >
              {keepMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-0.5" />}
              Keep
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-6 text-[10px] px-1 text-red-600 !border-blue-600/50 hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={() => deletePhotoMutation.mutate()}
            disabled={keepMutation.isPending || deletePhotoMutation.isPending}
            data-testid={`button-delete-photo-${pin.pinId}`}
            title="Delete this photo entirely"
          >
            {deletePhotoMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3 mr-0.5" />}
            Delete
          </Button>
        </div>
      </div>
      <div className="sm:hidden flex gap-1 p-1">
        {siblingPinIds.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 px-0 text-green-600 !border-blue-600/50 hover:bg-green-50 dark:hover:bg-green-950/30"
            onClick={() => keepMutation.mutate()}
            disabled={keepMutation.isPending || deletePhotoMutation.isPending}
            data-testid={`button-keep-mobile-${pin.pinId}`}
            title="Keep this pin, delete others"
          >
            {keepMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 px-0 text-red-600 !border-blue-600/50 hover:bg-red-50 dark:hover:bg-red-950/30"
          onClick={() => deletePhotoMutation.mutate()}
          disabled={keepMutation.isPending || deletePhotoMutation.isPending}
          data-testid={`button-delete-photo-mobile-${pin.pinId}`}
          title="Delete this photo entirely"
        >
          {deletePhotoMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export default function FlaggedReels({ sessionId, onBack, onReshoot, onViewInPhoto, pushUndo }: FlaggedReelsProps) {
  const { toast } = useToast();
  const { allCodes: vendorCodes } = useVendorCodes();
  const { categories: userCategories } = useWireCategories();
  const userParsedCatalog = useMemo(
    () => userCategories.map(userWireCategoryToParsedEntry),
    [userCategories]
  );
  const { data: flagSettings } = useQuery<{ defaultUnit: string }>({
    queryKey: ["/api/settings"],
    select: (data: any) => ({ defaultUnit: data?.defaultUnit ?? "feet" }),
  });
  const currentUnit: UnitType = (flagSettings?.defaultUnit as UnitType) || "feet";
  const uLabel = unitLabel(currentUnit);
  const [previewPin, setPreviewPin] = useState<FlaggedPin | null>(null);
  const [previewImgLoaded, setPreviewImgLoaded] = useState(false);
  useEffect(() => { setPreviewImgLoaded(false); }, [previewPin?.id]);
  const [copied, setCopied] = useState(false);
  const [editingPinId, setEditingPinId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditingState>({ wireDetails: "", vendorCode: "", footage: "", notes: "", flagReason: "", reelCount: "1" });
  const [categorySuggestions, setCategorySuggestions] = useState<ParsedCatalogEntry[]>([]);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);
  const [dupsOpen, setDupsOpen] = useState(true);
  const { data: dismissedKeysFromDb = [] } = useQuery<string[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "dismissed-duplicates"],
  });
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(new Set());
  const [migrated, setMigrated] = useState(false);

  useEffect(() => {
    setLocalDismissed(new Set());
  }, [dismissedKeysFromDb]);

  const disregardedKeys = useMemo(() => {
    const merged = new Set(dismissedKeysFromDb);
    for (const k of localDismissed) merged.add(k);
    return merged;
  }, [dismissedKeysFromDb, localDismissed]);
  const [sortBy, setSortBy] = useState<"location" | "label" | "count">("location");

  const { data: flaggedPins = [], isLoading } = useQuery<FlaggedPin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/flagged-pins`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load flagged pins");
      return res.json();
    },
  });

  const { data: reviewResponses = [] } = useQuery<ReviewResponse[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "review-responses"],
    enabled: sessionId > 0,
  });

  const { data: allEntries = [], isLoading: entriesLoading } = useQuery<Entry[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "entries"],
  });

  const reviewFlaggedItems = useMemo(() => {
    const entryMap = new Map(allEntries.map(e => [e.id, e]));
    const seen = new Set<number>();
    return reviewResponses
      .filter(r => r.verdict === "flagged")
      .filter(r => {
        if (seen.has(r.entryId)) return false;
        seen.add(r.entryId);
        return true;
      })
      .map(r => ({ response: r, entry: entryMap.get(r.entryId) }))
      .filter(item => item.entry);
  }, [reviewResponses, allEntries]);

  const unflagMutation = useMutation({
    mutationFn: async ({ pinId, flagReason, entryId, existingNotes }: { pinId: number; flagReason: string | null; entryId: number | null; existingNotes: string | null }) => {
      await apiRequest("PATCH", `/api/pins/${pinId}/flag`, { flagged: false, flagReason: null });
      if (entryId) {
        const marker = flagReason ? `[Resolved from flag: ${flagReason}]` : "[Resolved from flag]";
        const updatedNotes = existingNotes ? `${existingNotes}\n${marker}` : marker;
        await apiRequest("PATCH", `/api/entries/${entryId}`, { notes: updatedNotes });
      }
      return { pinId, flagReason };
    },
    onSuccess: ({ pinId, flagReason }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      pushUndo?.({ type: "unflag-pin", sessionId, entityId: pinId, data: { flagged: false, flagReason: null }, previousData: { flagged: true, flagReason } });
    },
  });

  const unflagGroupMutation = useMutation({
    mutationFn: async (pins: { id: number; entryId: number | null; flagReason: string | null; entryNotes: string | null }[]) => {
      for (const pin of pins) {
        await apiRequest("PATCH", `/api/pins/${pin.id}/flag`, { flagged: false, flagReason: null });
      }
      const entryUpdates = new Map<number, { baseNotes: string | null; markers: string[] }>();
      for (const pin of pins) {
        if (pin.entryId) {
          if (!entryUpdates.has(pin.entryId)) {
            entryUpdates.set(pin.entryId, { baseNotes: pin.entryNotes || null, markers: [] });
          }
          const marker = pin.flagReason ? `[Resolved from flag: ${pin.flagReason}]` : "[Resolved from flag]";
          entryUpdates.get(pin.entryId)!.markers.push(marker);
        }
      }
      for (const [entryId, { baseNotes, markers }] of entryUpdates) {
        const combined = markers.join("\n");
        const updatedNotes = baseNotes ? `${baseNotes}\n${combined}` : combined;
        await apiRequest("PATCH", `/api/entries/${entryId}`, { notes: updatedNotes });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
    },
    onError: () => {
      toast({ title: "Un-flag failed", variant: "destructive" });
    },
  });

  const savePinMutation = useMutation({
    mutationFn: async ({ pinId, entryId, photoId, photoAisle, photoSection, data }: {
      pinId: number; entryId: number | null; photoId: number;
      photoAisle: string | null; photoSection: string | null; data: EditingState;
    }) => {
      const displayFootage = data.footage ? Number(data.footage) : null;
      const parsedFootage = displayFootage !== null && Number.isFinite(displayFootage) ? toBaseFeet(displayFootage, currentUnit) : null;
      const parsedReelCount = data.reelCount ? parseInt(data.reelCount) : 1;
      const resolving = data.wireDetails.trim().length > 0;

      await apiRequest("PATCH", `/api/pins/${pinId}`, {
        wireDetails: data.wireDetails || null,
        vendorCode: data.vendorCode || null,
        footage: parsedFootage,
        reelCount: parsedReelCount > 0 ? parsedReelCount : 1,
      });

      let resolvedEntryId = entryId;
      if (resolving) {
        const flagReasonText = data.flagReason.trim() || null;
        const resolvedMarker = flagReasonText ? `[Resolved from flag: ${flagReasonText}]` : "[Resolved from flag]";
        await apiRequest("PATCH", `/api/pins/${pinId}/flag`, { flagged: false, flagReason: flagReasonText });
        if (!resolvedEntryId) {
          const totalFootage = parsedFootage ? parsedFootage * (parsedReelCount > 0 ? parsedReelCount : 1) : undefined;
          const notesWithMarker = data.notes ? `${data.notes}\n${resolvedMarker}` : resolvedMarker;
          const res = await apiRequest("POST", `/api/sessions/${sessionId}/entries`, {
            aisle: photoAisle || "",
            section: photoSection || "",
            position: "",
            reelTag: data.wireDetails.trim(),
            manufacturer: data.vendorCode || undefined,
            footage: totalFootage,
            reelCount: parsedReelCount > 0 ? parsedReelCount : 1,
            photoId,
            notes: notesWithMarker,
          });
          const newEntry = await res.json();
          resolvedEntryId = newEntry.id;
          await apiRequest("PATCH", `/api/pins/${pinId}`, { entryId: resolvedEntryId });
        } else {
          const notesWithMarker = data.notes ? `${data.notes}\n${resolvedMarker}` : resolvedMarker;
          await apiRequest("PATCH", `/api/entries/${resolvedEntryId}`, {
            wireType: data.wireDetails || undefined,
            manufacturer: data.vendorCode || undefined,
            footage: parsedFootage ? parsedFootage * (parsedReelCount > 0 ? parsedReelCount : 1) : undefined,
            reelCount: parsedReelCount > 0 ? parsedReelCount : 1,
            notes: notesWithMarker,
          });
        }
      } else {
        await apiRequest("PATCH", `/api/pins/${pinId}/flag`, { flagged: true, flagReason: data.flagReason.trim() || null });
        if (entryId && data.notes !== undefined) {
          await apiRequest("PATCH", `/api/entries/${entryId}`, { notes: data.notes || null });
        }
      }
      return { resolved: resolving };
    },
    onSuccess: ({ resolved }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      setEditingPinId(null);
      if (resolved) {
        toast({ title: "Resolved", description: "Reel details saved and flag removed." });
      } else {
        toast({ title: "Details saved", description: "Fill in wire category to fully resolve." });
      }
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
      footage: pin.footage ? String(toDisplayUnit(pin.footage, currentUnit)) : "",
      notes: pin.entryNotes || "",
      flagReason: pin.flagReason || "",
      reelCount: String(pin.reelCount || 1),
    });
    setCategorySuggestions([]);
    setShowCategorySuggestions(false);
  }, [currentUnit]);

  const getUniqueVendor = (catalog: string): string | null => {
    const vendors = new Set(PARSED_CATALOG.filter(e => e.catalog === catalog).map(e => e.vendor));
    return vendors.size === 1 ? [...vendors][0] : null;
  };

  const applyCatalogMatch = useCallback((match: ParsedCatalogEntry) => {
    setEditState(s => {
      const updates: Partial<EditingState> = { wireDetails: match.catalog };
      const uniqueVendor = getUniqueVendor(match.catalog);
      if (uniqueVendor && !s.vendorCode) updates.vendorCode = uniqueVendor;
      if (match.footage) {
        const rc = Math.max(1, parseInt(s.reelCount) || 1);
        updates.footage = String(toDisplayUnit(match.footage, currentUnit) * rc);
      }
      return { ...s, ...updates };
    });
    setCategorySuggestions([]);
    setShowCategorySuggestions(false);
  }, [currentUnit]);

  const { data: sessionEntries = [] } = useQuery<Entry[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "entries"],
  });

  const { data: sessionPins = [], isSuccess: pinsLoaded } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
  });

  const { data: sessionPhotos = [], isSuccess: photosLoaded } = useQuery<Photo[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "photos"],
  });

  const dupDataLoaded = pinsLoaded && photosLoaded;

  const detailPhotosByParent = useMemo(() => {
    const map = new Map<number, Photo[]>();
    for (const p of sessionPhotos) {
      if (p.parentPhotoId) {
        const arr = map.get(p.parentPhotoId) || [];
        arr.push(p);
        map.set(p.parentPhotoId, arr);
      }
    }
    return map;
  }, [sessionPhotos]);

  const duplicateGroups = useMemo<DuplicateGroup[]>(() => {
    if (!sessionPins.length || !sessionPhotos.length) return [];
    const scannerResults = loadScannerResults(sessionId);
    const labelDups = detectDuplicatePins(sessionPins, sessionPhotos, scannerResults);
    const sameReelDups = detectSameReelDuplicates(sessionPins, sessionPhotos, scannerResults);
    return [...labelDups, ...sameReelDups];
  }, [sessionPins, sessionPhotos, sessionId]);

  const visibleDupGroups = useMemo(
    () => duplicateGroups.filter((g) => !disregardedKeys.has(dupGroupKey(g))),
    [duplicateGroups, disregardedKeys],
  );

  useEffect(() => {
    setMigrated(false);
  }, [sessionId]);

  useEffect(() => {
    if (migrated) return;
    const lsKey = `disregarded-dups-${sessionId}`;
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) { setMigrated(true); return; }
      const keys: string[] = JSON.parse(raw);
      if (!keys.length) { localStorage.removeItem(lsKey); setMigrated(true); return; }
      apiRequest("POST", `/api/sessions/${sessionId}/dismissed-duplicates`, { keys })
        .then(() => {
          localStorage.removeItem(lsKey);
          queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "dismissed-duplicates"] });
        })
        .finally(() => setMigrated(true));
    } catch {
      setMigrated(true);
    }
  }, [sessionId, migrated]);

  function handleDisregard(group: DuplicateGroup) {
    const key = dupGroupKey(group);
    setLocalDismissed(prev => new Set(prev).add(key));
    apiRequest("POST", `/api/sessions/${sessionId}/dismissed-duplicates`, { key })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "dismissed-duplicates"] });
        if (pushUndo) {
          pushUndo({
            type: "dismiss-duplicate",
            sessionId,
            entityId: 0,
            data: { key },
          });
        }
      })
      .catch(() => {
        setLocalDismissed(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        toast({ title: "Failed to save dismissal", variant: "destructive" });
      });
  }

  const photoGroups = useMemo(() => {
    const groupMap = new Map<number, FlaggedPin[]>();
    for (const pin of flaggedPins) {
      const existing = groupMap.get(pin.photoId);
      if (existing) existing.push(pin);
      else groupMap.set(pin.photoId, [pin]);
    }
    const groups = Array.from(groupMap.entries()).map(([photoId, pins]) => ({
      photoId,
      photoUrl: pins[0].photoUrl || null,
      photoFilename: pins[0].photoFilename || null,
      photoAisle: pins[0].photoAisle || null,
      photoSection: pins[0].photoSection || null,
      pins,
    }));
    if (sortBy === "location") {
      groups.sort((a, b) => {
        const cmp = (a.photoAisle || "").localeCompare(b.photoAisle || "", undefined, { numeric: true });
        if (cmp !== 0) return cmp;
        return (a.photoSection || "").localeCompare(b.photoSection || "", undefined, { numeric: true });
      });
      for (const g of groups) {
        g.pins.sort((a, b) => (a.label || "").localeCompare(b.label || "", undefined, { numeric: true }));
      }
    } else if (sortBy === "label") {
      groups.sort((a, b) => {
        const labelA = a.pins[0]?.label || "";
        const labelB = b.pins[0]?.label || "";
        return labelA.localeCompare(labelB, undefined, { numeric: true });
      });
    } else if (sortBy === "count") {
      groups.sort((a, b) => b.pins.length - a.pins.length);
    }
    return groups;
  }, [flaggedPins, sortBy]);

  const pinnedEntryIds = new Set(sessionPins.filter(p => p.entryId).map(p => p.entryId!));
  const unpinnedEntries = sessionEntries.filter(e => !pinnedEntryIds.has(e.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2">
        <h2 className="text-lg font-bold underline flex items-center gap-2 justify-center" data-testid="text-flagged-heading">
          <Flag className="h-5 w-5 text-yellow-500" />
          <span className="sm:hidden">Flagged</span>
          <span className="hidden sm:inline">Flagged Reels</span>
          <Badge variant="secondary" data-testid="badge-flagged-count">{flaggedPins.length + reviewFlaggedItems.length}</Badge>
        </h2>
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            data-testid="button-share-flagged"
            title="Copy shareable link"
            aria-label="Share Link"
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
            <span className="hidden sm:inline">{copied ? "Copied" : "Share Link"}</span>
          </Button>
        </div>
      </div>

      {flaggedPins.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 justify-center" data-testid="flagged-sort-filter">
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="text-xs border !border-blue-600/50 rounded px-2 py-1 bg-card text-foreground"
              data-testid="select-sort"
            >
              <option value="location">Aisle / Section</option>
              <option value="label">Pin Label</option>
              <option value="count">Pin Count</option>
            </select>
          </div>
        </div>
      )}

      <div className="space-y-2" data-testid="section-duplicates">
          {visibleDupGroups.length > 0 ? (
            <button
              className="flex items-center gap-2 w-full pt-2 border-t border-blue-600/50 text-left"
              onClick={() => setDupsOpen((o) => !o)}
              data-testid="button-toggle-duplicates"
            >
              <Copy className="h-4 w-4 text-orange-500 shrink-0" />
              <h3 className="text-sm font-semibold text-orange-600 dark:text-orange-400 flex-1">
                Possible Duplicates ({visibleDupGroups.length})
              </h3>
              {dupsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
          ) : (
            <div className="flex items-center gap-2 w-full pt-2 border-t border-blue-600/50" data-testid="header-duplicates-cleared">
              <Copy className="h-4 w-4 text-muted-foreground shrink-0" />
              <h3 className="text-sm font-semibold text-muted-foreground flex-1">Possible Duplicates</h3>
            </div>
          )}
          {visibleDupGroups.length === 0 && dupDataLoaded && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                duplicateGroups.length > 0
                  ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                  : "bg-muted/50 text-muted-foreground"
              }`}
              data-testid="status-duplicates-cleared"
            >
              <Check className={`h-4 w-4 shrink-0 ${duplicateGroups.length > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`} />
              <span>
                {duplicateGroups.length > 0 ? "No duplicates remaining." : "No duplicates detected"}
              </span>
            </div>
          )}
          {dupsOpen && visibleDupGroups.length > 0 && (
            <div className="grid gap-2">
              {visibleDupGroups.map((group) => {
                const isSameReel = group.groupType === "same-reel";
                const groupKey = dupGroupKey(group);
                return (
                <div
                  key={groupKey}
                  className={`border border-blue-600/50 rounded-lg p-2 sm:p-3 overflow-hidden ${isSameReel ? "bg-violet-50/40 dark:bg-violet-950/15" : group.isDefiniteDoubleCount ? "bg-orange-50/50 dark:bg-orange-950/20" : "bg-amber-50/30 dark:bg-amber-950/10"}`}
                  data-testid={`dup-group-${groupKey}`}
                >
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-2 flex-wrap">
                    <span className="font-mono text-xs sm:text-sm font-semibold" data-testid={`text-dup-label-${groupKey}`}>
                      {isSameReel ? group.label : `Reel #${group.label}`}
                    </span>
                    {(group.aisle || group.section) && (
                      <span className="text-[10px] sm:text-xs text-muted-foreground font-mono">
                        {[group.aisle && `A${group.aisle}`, group.section && `S${group.section}`].filter(Boolean).join("·")}
                      </span>
                    )}
                    <Badge
                      className={`text-[9px] sm:text-[10px] px-1 ${isSameReel ? "bg-violet-900/50 text-violet-300 border-violet-700/40" : group.isDefiniteDoubleCount ? "bg-orange-900/50 text-orange-300 border-orange-700/40" : "bg-amber-900/50 text-amber-300 border-amber-700/40"}`}
                      data-testid={`badge-dup-type-${groupKey}`}
                    >
                      {isSameReel ? "Same Reel?" : group.isDefiniteDoubleCount ? "Double Count" : "Check Needed"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 w-7 p-0 rounded-full !border-red-500 border-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => handleDisregard(group)}
                      data-testid={`button-disregard-${groupKey}`}
                      title="Dismiss this duplicate warning"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex gap-1.5 sm:gap-2 flex-wrap">
                    {group.pins.map((pin) => (
                      <DupPinTile
                        key={pin.pinId}
                        pin={pin}
                        siblingPinIds={group.pins.filter(p => p.pinId !== pin.pinId).map(p => p.pinId)}
                        sessionId={sessionId}
                        currentUnit={currentUnit}
                        uLabel={uLabel}
                      />
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          )}
      </div>
      <hr className="border-t border-blue-600/30 my-2" />
      {(isLoading || entriesLoading) ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : flaggedPins.length === 0 && reviewFlaggedItems.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="text-no-flagged">
          <Flag className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No flagged reels in this session.</p>
          <p className="text-xs mt-1">Use the flag button on pins in Photo Mode to mark reels for re-shoot.</p>
        </div>
      ) : (
        <div className="grid gap-4" data-testid="flagged-pins-section">
          {photoGroups.map((group) => (
            <div
              key={group.photoId}
              className="border !border-blue-600/50 rounded-lg overflow-hidden bg-card"
              data-testid={`flagged-group-${group.photoId}`}
            >
              <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b !border-blue-600/50 flex-wrap" data-testid={`flagged-group-header-${group.photoId}`}>
                <MapPin className="h-4 w-4 text-orange-500 shrink-0" />
                <span className="font-mono text-sm font-semibold">
                  {[group.photoAisle && `Aisle ${group.photoAisle}`, group.photoSection && `Section ${group.photoSection}`].filter(Boolean).join(" · ") || "No location"}
                </span>
                <Badge variant="secondary" className="text-[10px]" data-testid={`badge-group-count-${group.photoId}`}>
                  {group.pins.length} pin{group.pins.length !== 1 ? "s" : ""}
                </Badge>
                {group.photoFilename && (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px] hidden sm:inline">{group.photoFilename}</span>
                )}
                <div className="flex gap-2 ml-auto shrink-0 [--button-outline:black]">
                  {onViewInPhoto && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onViewInPhoto(group.photoId, group.pins[0]?.id)}
                      data-testid={`button-view-in-photo-group-${group.photoId}`}
                      title="Go to this photo in Reel IDs"
                    >
                      <ScanSearch className="h-4 w-4 sm:mr-1" />
                      <span className="sm:hidden text-xs">Go To Photo</span>
                      <span className="hidden sm:inline">View Reel ID Photo</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="hidden sm:flex"
                    onClick={() => unflagGroupMutation.mutate(group.pins.map(p => ({ id: p.id, entryId: p.entryId, flagReason: p.flagReason, entryNotes: p.entryNotes || null })))}
                    disabled={unflagGroupMutation.isPending}
                    data-testid={`button-unflag-group-${group.photoId}`}
                    title="Remove flag from all pins in this group"
                  >
                    {unflagGroupMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                    {group.pins.length > 1 ? "Un-Flag All" : "Un-Flag"}
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 p-3">
                {group.pins.map((pin) => (
                  <div
                    key={pin.id}
                    className="border !border-blue-600/50 rounded-lg p-3 hover:bg-accent/5 transition-colors"
                    data-testid={`flagged-pin-card-${pin.id}`}
                  >
                    {/* Desktop layout */}
                    <div className="hidden sm:flex items-start gap-3">
                      {pin.photoUrl ? (
                        <PinLocationPhoto
                          photoUrl={pin.photoUrl}
                          xPercent={pin.xPercent}
                          yPercent={pin.yPercent}
                          photoFilename={pin.photoFilename}
                          onClick={() => setPreviewPin(pin)}
                          containerClass="w-20 h-20 rounded overflow-hidden border border-blue-600/50 shrink-0 cursor-pointer"
                        >
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/30 transition-opacity pointer-events-none">
                            <Eye className="h-4 w-4 text-white" />
                          </div>
                        </PinLocationPhoto>
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
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground font-mono">
                          {pin.reelCount > 0 && <span>{pin.reelCount} reel{pin.reelCount !== 1 ? "s" : ""}</span>}
                          {pin.vendorCode && <span>{pin.vendorCode}</span>}
                          {pin.footage && <span>{toDisplayUnit(pin.footage, currentUnit).toLocaleString()} {uLabel}</span>}
                        </div>
                        {pin.flagReason && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-testid={`text-flag-reason-${pin.id}`}>
                            <Flag className="h-3 w-3 inline mr-1" />
                            {pin.flagReason}
                          </p>
                        )}
                        {pin.photoId && (detailPhotosByParent.get(pin.photoId) || []).length > 0 && (
                          <div className="flex gap-2 mt-2 flex-wrap items-start" data-testid={`detail-photos-desktop-${pin.id}`}>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1 self-center"><ImageIcon className="h-3 w-3" /> Linked:</span>
                            {(detailPhotosByParent.get(pin.photoId) || []).map((dp) => (
                              <button
                                key={dp.id}
                                type="button"
                                className="relative w-16 h-16 rounded overflow-hidden border-2 border-blue-400 cursor-pointer hover:border-blue-300 hover:shadow-lg shrink-0 transition-all"
                                onClick={() => setPreviewPhotoUrl(`/api/photos/${dp.id}/image`)}
                                data-testid={`detail-thumb-desktop-${dp.id}`}
                                title={`${dp.linkReason || "Detail"} — click to enlarge`}
                              >
                                <img src={`/api/photos/${dp.id}/image`} alt="detail" className="w-full h-full object-cover" />
                                <span className="absolute bottom-0 left-0 right-0 bg-blue-600/90 text-white text-[7px] text-center leading-3 py-px truncate px-0.5">{dp.linkReason || "Detail"}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 shrink-0 [--button-outline:black]">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => editingPinId === pin.id ? setEditingPinId(null) : openEditor(pin)}
                          data-testid={`button-edit-${pin.id}`}
                          title="Edit details"
                        >
                          <Pencil className="h-4 w-4 mr-1" />
                          {editingPinId === pin.id ? "Close w/o Saving" : "Edit Reel Data"}
                        </Button>
                      </div>
                    </div>
                    {editingPinId === pin.id && (
                      <div className="hidden sm:block border-t border-blue-600/50 pt-3 mt-1">
                        {onReshoot && (
                          <div className="mb-3">
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => onReshoot(group.photoAisle || "", group.photoSection || "", group.photoId)}
                              data-testid={`button-detail-photo-desktop-${pin.id}`}
                            >
                              <Camera className="h-4 w-4 mr-1" />
                              Take Detail Photo
                            </Button>
                          </div>
                        )}
                        <div className="grid grid-cols-4 gap-3 mb-3">
                          <div className="relative">
                            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Category / Wire Details</label>
                            <Input
                              value={editState.wireDetails}
                              onChange={(e) => {
                                const val = e.target.value.toUpperCase();
                                setEditState(s => ({ ...s, wireDetails: val }));
                                if (val.length >= 2) {
                                  const matches = lookupCategory(val, userParsedCatalog);
                                  setCategorySuggestions(matches);
                                  setShowCategorySuggestions(matches.length > 0);
                                } else {
                                  setCategorySuggestions([]);
                                  setShowCategorySuggestions(false);
                                }
                              }}
                              onFocus={() => {
                                if (editState.wireDetails.length >= 2) {
                                  const matches = lookupCategory(editState.wireDetails, userParsedCatalog);
                                  setCategorySuggestions(matches);
                                  setShowCategorySuggestions(matches.length > 0);
                                }
                              }}
                              onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 200)}
                              className="uppercase"
                              autoComplete="off"
                              data-testid={`input-wire-details-${pin.id}`}
                            />
                            {showCategorySuggestions && categorySuggestions.length > 0 && (
                              <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto" data-testid="category-suggestions-desktop">
                                {categorySuggestions.map((s) => (
                                  <button
                                    key={s.catalog}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground border-b border-border/30 last:border-0"
                                    onMouseDown={(e) => { e.preventDefault(); applyCatalogMatch(s); }}
                                    data-testid={`suggestion-desktop-${s.catalog}`}
                                  >
                                    <span className="font-mono font-semibold">{s.catalog}</span>
                                    <span className="text-muted-foreground ml-2 text-xs">{s.description}</span>
                                    {s.footage && <span className="text-orange-500 ml-1 text-xs">({toDisplayUnit(s.footage, currentUnit)}{uLabel})</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Vendor Code</label>
                            <Input
                              value={editState.vendorCode}
                              onChange={(e) => setEditState(s => ({ ...s, vendorCode: e.target.value.toUpperCase().slice(0, 3) }))}
                              className="uppercase"
                              maxLength={3}
                              list="vendor-code-suggestions"
                              data-testid={`input-vendor-code-${pin.id}`}
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Footage ({uLabel})</label>
                            <Input
                              type="number"
                              value={editState.footage}
                              onChange={(e) => setEditState(s => ({ ...s, footage: e.target.value }))}
                              data-testid={`input-footage-${pin.id}`}
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Number of Reels:</label>
                            <Input
                              type="number"
                              value={editState.reelCount}
                              onChange={(e) => setEditState(s => ({ ...s, reelCount: e.target.value }))}
                              min={1}
                              inputMode="numeric"
                              data-testid={`input-reel-count-${pin.id}`}
                            />
                          </div>
                        </div>
                        <div className="mb-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditState(s => ({ ...s, wireDetails: "", vendorCode: "", footage: "", reelCount: "1" }))}
                            data-testid={`button-clear-details-${pin.id}`}
                          >
                            <X className="h-4 w-4 mr-1" />
                            Clear Reel Details
                          </Button>
                        </div>
                        {pin.entryId && (
                          <div className="mb-3">
                            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Notes</label>
                            <Textarea
                              value={editState.notes}
                              onChange={(e) => setEditState(s => ({ ...s, notes: e.target.value }))}
                              rows={2}
                              data-testid={`input-notes-${pin.id}`}
                            />
                          </div>
                        )}
                        <div className="mb-3">
                          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Flag Reason:</label>
                          <Input
                            value={editState.flagReason}
                            onChange={(e) => setEditState(s => ({ ...s, flagReason: e.target.value }))}
                            data-testid={`input-flag-reason-${pin.id}`}
                          />
                        </div>
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            onClick={() => savePinMutation.mutate({
                              pinId: pin.id,
                              entryId: pin.entryId,
                              photoId: group.photoId,
                              photoAisle: group.photoAisle,
                              photoSection: group.photoSection,
                              data: editState,
                            })}
                            disabled={savePinMutation.isPending}
                            data-testid={`button-save-edit-${pin.id}`}
                          >
                            {savePinMutation.isPending
                              ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              : editState.wireDetails.trim()
                                ? <CheckCircle2 className="h-4 w-4 mr-1" />
                                : <Save className="h-4 w-4 mr-1" />
                            }
                            {editState.wireDetails.trim() ? "Save & Resolve" : "Save Details"}
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
                      </div>
                      {pin.photoUrl ? (
                        <PinLocationPhoto
                          photoUrl={pin.photoUrl}
                          xPercent={pin.xPercent}
                          yPercent={pin.yPercent}
                          photoFilename={pin.photoFilename}
                          onClick={() => setPreviewPin(pin)}
                          containerClass="w-full rounded overflow-hidden border border-blue-600/50 cursor-pointer"
                          imgClass="w-full h-auto block"
                        />
                      ) : (
                        <div className="w-full h-24 rounded bg-muted flex items-center justify-center">
                          <MapPin className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground font-mono w-full">
                        {(group.photoAisle || group.photoSection) && (
                          <p className="mb-0.5">
                            {[group.photoAisle && `Aisle ${group.photoAisle}`, group.photoSection && `Section ${group.photoSection}`].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <div className="flex gap-3">
                          {pin.reelCount > 0 && <span>{pin.reelCount} reel{pin.reelCount !== 1 ? "s" : ""}</span>}
                          {pin.vendorCode && <span>{pin.vendorCode}</span>}
                          {pin.footage && <span>{toDisplayUnit(pin.footage, currentUnit).toLocaleString()} {uLabel}</span>}
                        </div>
                      </div>
                      {pin.flagReason && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 w-full" data-testid={`text-flag-reason-mobile-${pin.id}`}>
                          <Flag className="h-3 w-3 inline mr-1" />
                          {pin.flagReason}
                        </p>
                      )}
                      {pin.photoId && (detailPhotosByParent.get(pin.photoId) || []).length > 0 && (
                        <div className="flex gap-2 w-full flex-wrap items-start" data-testid={`detail-photos-mobile-${pin.id}`}>
                          <p className="w-full text-[10px] text-muted-foreground flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" /> Linked photos — tap to enlarge:
                          </p>
                          {(detailPhotosByParent.get(pin.photoId) || []).map((dp) => (
                            <button
                              key={dp.id}
                              type="button"
                              className="relative w-16 h-16 rounded overflow-hidden border-2 border-blue-400 cursor-pointer active:border-blue-300 shrink-0"
                              onClick={() => setPreviewPhotoUrl(`/api/photos/${dp.id}/image`)}
                              data-testid={`detail-thumb-mobile-${dp.id}`}
                              title={`${dp.linkReason || "Detail"} — tap to enlarge`}
                            >
                              <img src={`/api/photos/${dp.id}/image`} alt="detail" className="w-full h-full object-cover" />
                              <span className="absolute bottom-0 left-0 right-0 bg-blue-600/90 text-white text-[7px] text-center leading-3 py-px truncate px-0.5">{dp.linkReason || "Detail"}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-center gap-4 w-full py-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="!border-blue-600/50"
                          onClick={() => editingPinId === pin.id ? setEditingPinId(null) : openEditor(pin)}
                          data-testid={`button-edit-mobile-${pin.id}`}
                          title="Edit Reel Data"
                        >
                          Edit Reel Data
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="!border-blue-600/50"
                          onClick={() => unflagMutation.mutate({ pinId: pin.id, flagReason: pin.flagReason, entryId: pin.entryId, existingNotes: pin.entryNotes || null })}
                          disabled={unflagMutation.isPending}
                          data-testid={`button-resolve-mobile-${pin.id}`}
                          title="Un-Flag"
                        >
                          Un-Flag
                        </Button>
                      </div>
                      {editingPinId === pin.id && (
                        <div className="w-full border-t border-blue-600/50 pt-3 mt-1 space-y-3">
                          {onReshoot && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => onReshoot(group.photoAisle || "", group.photoSection || "", group.photoId)}
                              data-testid={`button-reshoot-mobile-${pin.id}`}
                            >
                              <Camera className="h-4 w-4 mr-1" />
                              Take Detail Photo
                            </Button>
                          )}
                          <div className="relative">
                            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Category / Wire Details</label>
                            <Input
                              value={editState.wireDetails}
                              onChange={(e) => {
                                const val = e.target.value.toUpperCase();
                                setEditState(s => ({ ...s, wireDetails: val }));
                                if (val.length >= 2) {
                                  const matches = lookupCategory(val, userParsedCatalog);
                                  setCategorySuggestions(matches);
                                  setShowCategorySuggestions(matches.length > 0);
                                } else {
                                  setCategorySuggestions([]);
                                  setShowCategorySuggestions(false);
                                }
                              }}
                              onFocus={() => {
                                if (editState.wireDetails.length >= 2) {
                                  const matches = lookupCategory(editState.wireDetails, userParsedCatalog);
                                  setCategorySuggestions(matches);
                                  setShowCategorySuggestions(matches.length > 0);
                                }
                              }}
                              onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 200)}
                              className="uppercase"
                              autoComplete="off"
                              data-testid={`input-wire-details-mobile-${pin.id}`}
                            />
                            {showCategorySuggestions && categorySuggestions.length > 0 && (
                              <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto" data-testid="category-suggestions-mobile">
                                {categorySuggestions.map((s) => (
                                  <button
                                    key={s.catalog}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground border-b border-border/30 last:border-0"
                                    onMouseDown={(e) => { e.preventDefault(); applyCatalogMatch(s); }}
                                    data-testid={`suggestion-mobile-${s.catalog}`}
                                  >
                                    <span className="font-mono font-semibold">{s.catalog}</span>
                                    <span className="text-muted-foreground ml-2 text-xs">{s.description}</span>
                                    {s.footage && <span className="text-orange-500 ml-1 text-xs">({toDisplayUnit(s.footage, currentUnit)}{uLabel})</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Vendor</label>
                              <Input
                                value={editState.vendorCode}
                                onChange={(e) => setEditState(s => ({ ...s, vendorCode: e.target.value.toUpperCase().slice(0, 3) }))}
                                className="uppercase"
                                maxLength={3}
                                list="vendor-code-suggestions"
                                data-testid={`input-vendor-code-mobile-${pin.id}`}
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Footage ({uLabel})</label>
                              <Input
                                type="number"
                                value={editState.footage}
                                onChange={(e) => setEditState(s => ({ ...s, footage: e.target.value }))}
                                data-testid={`input-footage-mobile-${pin.id}`}
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground mb-1 block"># Reels</label>
                              <Input
                                type="number"
                                value={editState.reelCount}
                                onChange={(e) => setEditState(s => ({ ...s, reelCount: e.target.value }))}
                                min={1}
                                inputMode="numeric"
                                data-testid={`input-reel-count-mobile-${pin.id}`}
                              />
                            </div>
                          </div>
                          {pin.entryId && (
                            <div>
                              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Notes</label>
                              <Textarea
                                value={editState.notes}
                                onChange={(e) => setEditState(s => ({ ...s, notes: e.target.value }))}
                                rows={2}
                                data-testid={`input-notes-mobile-${pin.id}`}
                              />
                            </div>
                          )}
                          <div>
                            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Flag Reason:</label>
                            <Input
                              value={editState.flagReason}
                              onChange={(e) => setEditState(s => ({ ...s, flagReason: e.target.value }))}
                              data-testid={`input-flag-reason-mobile-${pin.id}`}
                            />
                          </div>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              onClick={() => savePinMutation.mutate({
                                pinId: pin.id,
                                entryId: pin.entryId,
                                photoId: group.photoId,
                                photoAisle: group.photoAisle,
                                photoSection: group.photoSection,
                                data: editState,
                              })}
                              disabled={savePinMutation.isPending}
                              data-testid={`button-save-edit-mobile-${pin.id}`}
                            >
                              {savePinMutation.isPending
                                ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                : editState.wireDetails.trim()
                                  ? <CheckCircle2 className="h-4 w-4 mr-1" />
                                  : <Save className="h-4 w-4 mr-1" />
                              }
                              {editState.wireDetails.trim() ? "Save & Resolve" : "Save Details"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {unpinnedEntries.length > 0 && (
        <div className="space-y-2" data-testid="section-issues">
          <div className="flex items-center gap-2 pt-2 border-t border-blue-600/50">
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
                className="border border-blue-600/50 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-950/20"
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
                onLoad={() => setPreviewImgLoaded(true)}
              />
              {previewImgLoaded && (
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
              )}
            </div>
            <div className="mt-2 text-white text-sm text-center">
              <span className="font-mono">Pin {previewPin.label}</span>
              {previewPin.wireDetails && <span className="ml-2">&mdash; {previewPin.wireDetails}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Review-Flagged Entries ───────────────────────────────────── */}
      {reviewFlaggedItems.length > 0 && (
        <div className="border !border-yellow-600/50 rounded-lg overflow-hidden bg-card" data-testid="section-review-flagged">
          <div className="bg-yellow-500/10 px-3 py-2 flex items-center gap-2 border-b !border-yellow-600/50">
            <Flag className="h-4 w-4 text-yellow-600 shrink-0" />
            <span className="font-semibold text-sm">Flagged During Review</span>
            <Badge variant="secondary" className="text-[10px]" data-testid="badge-review-flagged-count">
              {reviewFlaggedItems.length}
            </Badge>
          </div>
          <div className="divide-y divide-yellow-600/20">
            {reviewFlaggedItems.map(({ response, entry }) => (
              <div key={response.id} className="px-3 py-2.5 flex items-center gap-3 flex-wrap" data-testid={`review-flagged-entry-${response.entryId}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold">
                      {[entry!.aisle && `Aisle ${entry!.aisle}`, entry!.section && `Section ${entry!.section}`].filter(Boolean).join(" · ") || "No location"}
                    </span>
                    {entry!.reelTag && (
                      <Badge variant="outline" className="text-[10px] font-mono">{entry!.reelTag}</Badge>
                    )}
                    {entry!.manufacturer && (
                      <Badge variant="outline" className="text-[10px]">{entry!.manufacturer}</Badge>
                    )}
                  </div>
                  {response.flagReason && (
                    <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
                      <AlertTriangle className="h-3 w-3 inline mr-1" />
                      {response.flagReason}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Flagged by {response.username || "unknown"} during review
                  </p>
                </div>
                {onViewInPhoto && entry!.photoId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewInPhoto(entry!.photoId!, undefined)}
                    data-testid={`button-view-review-flagged-${response.entryId}`}
                  >
                    <Eye className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">View</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {previewPhotoUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewPhotoUrl(null)}
          data-testid="modal-detail-photo-preview"
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewPhotoUrl}
              alt="Detail photo"
              className="w-full h-auto rounded-lg shadow-2xl border border-blue-400"
            />
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2"
              onClick={() => setPreviewPhotoUrl(null)}
              data-testid="button-close-detail-preview"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <datalist id="vendor-code-suggestions">
        {vendorCodes.map(code => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </div>
  );
}
