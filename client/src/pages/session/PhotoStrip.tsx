import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, ExternalLink, Loader2, Link2, X, Copy, Trash2, LayoutGrid, ZoomIn, ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatPinLabel, generateDetailPinLabel, isDSuffixLabel } from "./utils";
import type { Photo, Pin } from "@shared/schema";

function photoUrl(key: string): string {
  return key.startsWith("/uploads/") ? key : `/uploads/${key}`;
}

function photoSeqLabel(photo: Photo): string {
  const stem = (photo.originalFilename || "").replace(/\.\w+$/, "");
  return stem.length >= 3 ? stem.slice(-3) : String(photo.id);
}

function sortPhotos(photos: Photo[]): Photo[] {
  return [...photos].sort((a, b) => {
    const aisleA = (a.aisle || "").toLowerCase();
    const aisleB = (b.aisle || "").toLowerCase();
    if (aisleA !== aisleB) return aisleA.localeCompare(aisleB);
    const secA = parseInt(a.section || "0", 10);
    const secB = parseInt(b.section || "0", 10);
    if (!isNaN(secA) && !isNaN(secB) && secA !== secB) return secA - secB;
    return (a.section || "").localeCompare(b.section || "");
  });
}

function orderWithDetailShots(photos: Photo[]): Photo[] {
  const sorted = sortPhotos(photos);

  const detailsByParent = new Map<number, Photo[]>();
  const mainPhotos: Photo[] = [];

  for (const photo of sorted) {
    if (photo.isDetailShot && photo.parentPhotoId != null) {
      if (!detailsByParent.has(photo.parentPhotoId)) {
        detailsByParent.set(photo.parentPhotoId, []);
      }
      detailsByParent.get(photo.parentPhotoId)!.push(photo);
    } else {
      mainPhotos.push(photo);
    }
  }

  const placed = new Set<number>();
  const result: Photo[] = [];

  for (const photo of mainPhotos) {
    result.push(photo);
    for (const detail of detailsByParent.get(photo.id) || []) {
      result.push(detail);
      placed.add(detail.id);
    }
  }

  for (const details of detailsByParent.values()) {
    for (const d of details) {
      if (!placed.has(d.id)) result.push(d);
    }
  }

  return result;
}

const BLUE_SHADES = [
  { bg: "bg-blue-500", border: "border-blue-300", shadow: "shadow-[0_0_0_3px_rgba(59,130,246,0.5)]", css: "rgba(59,130,246,1)" },
  { bg: "bg-sky-400", border: "border-sky-200", shadow: "shadow-[0_0_0_3px_rgba(56,189,248,0.5)]", css: "rgba(56,189,248,1)" },
  { bg: "bg-indigo-500", border: "border-indigo-300", shadow: "shadow-[0_0_0_3px_rgba(99,102,241,0.5)]", css: "rgba(99,102,241,1)" },
  { bg: "bg-blue-700", border: "border-blue-400", shadow: "shadow-[0_0_0_3px_rgba(29,78,216,0.5)]", css: "rgba(29,78,216,1)" },
  { bg: "bg-cyan-500", border: "border-cyan-300", shadow: "shadow-[0_0_0_3px_rgba(6,182,212,0.5)]", css: "rgba(6,182,212,1)" },
  { bg: "bg-violet-500", border: "border-violet-300", shadow: "shadow-[0_0_0_3px_rgba(139,92,246,0.5)]", css: "rgba(139,92,246,1)" },
];
function blueShade(index: number) { return BLUE_SHADES[index % BLUE_SHADES.length]; }

function PhotoCard({
  photo,
  sessionId,
  canEdit,
  allPhotos,
  pins,
  allPins,
  onJumpToPhoto,
  onLightbox,
  onClearUndoHistory,
  onPushUndo,
}: {
  photo: Photo;
  sessionId: number;
  canEdit: boolean;
  allPhotos: Photo[];
  pins: Pin[];
  allPins: Pin[];
  onJumpToPhoto: (id: number) => void;
  onLightbox: (url: string, label: string) => void;
  onClearUndoHistory?: () => void;
  onPushUndo?: (action: any) => void;
}) {
  const { toast } = useToast();
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [aisle, setAisle] = useState(photo.aisle || "");
  const [section, setSection] = useState(photo.section || "");
  const [notes, setNotes] = useState(photo.notes || "");
  const [notesOpen, setNotesOpen] = useState(false);
  const [parentId, setParentId] = useState<number | null>(photo.parentPhotoId ?? null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkReason, setLinkReason] = useState(photo.linkReason || "");
  const [linkedPinLabel, setLinkedPinLabel] = useState(photo.linkedPinLabel || "");
  const [selectedParentForLink, setSelectedParentForLink] = useState<number | null>(null);
  const [customReasonOpen, setCustomReasonOpen] = useState(false);
  const [customReasonText, setCustomReasonText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [relabelLinkDialog, setRelabelLinkDialog] = useState<{ parentPinLabel: string; pinsToRelabel: Pin[]; linkParams: { parentId: number; reason: string; pinLabel: string } } | null>(null);
  const [relabelUnlinkDialog, setRelabelUnlinkDialog] = useState<{ pinsToRelabel: Pin[] } | null>(null);
  const aisleRef = useRef(aisle);
  const sectionRef = useRef(section);
  const notesRef = useRef(notes);
  const thumbContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = thumbContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const invalidatePhotos = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
  };
  const invalidateEntries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
  };

  const locationMutation = useMutation({
    mutationFn: async (update: { aisle?: string; section?: string; _previous?: { aisle?: string; section?: string } }) => {
      const { _previous, ...patch } = update;
      await apiRequest("PATCH", `/api/photos/${photo.id}`, patch);
      return { patch, _previous };
    },
    onSuccess: (result) => {
      invalidatePhotos(); invalidateEntries();
      if (onPushUndo && result?._previous) {
        onPushUndo({
          type: "update-photo",
          sessionId,
          entityId: photo.id,
          data: result.patch,
          previousData: result._previous,
        });
      }
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const notesMutation = useMutation({
    mutationFn: async (val: string) => {
      const previousNotes = notesRef.current || "";
      await apiRequest("PATCH", `/api/photos/${photo.id}`, { notes: val });
      return { notes: val, previousNotes };
    },
    onSuccess: (result) => {
      invalidatePhotos();
      if (onPushUndo && result) {
        onPushUndo({
          type: "update-photo",
          sessionId,
          entityId: photo.id,
          data: { notes: result.notes },
          previousData: { notes: result.previousNotes },
        });
      }
    },
    onError: () => toast({ title: "Failed to save notes", variant: "destructive" }),
  });

  const invalidatePins = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
    queryClient.invalidateQueries({ queryKey: ["/api/photos", String(photo.id), "pins"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
  };

  const relabelPins = async (pinIds: number[], newLabels: string[]) => {
    for (let i = 0; i < pinIds.length; i++) {
      await apiRequest("PATCH", `/api/pins/${pinIds[i]}`, { label: newLabels[i] });
    }
  };

  const getNextSequentialLabels = async (count: number): Promise<string[]> => {
    const res = await apiRequest("GET", `/api/sessions/${sessionId}/pins`);
    const allSessionPins: { label?: string | null }[] = await res.json();
    let maxNum = allSessionPins.reduce((m, p) => {
      const n = parseInt(p.label || "0", 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      maxNum++;
      labels.push(String(maxNum).padStart(3, "0"));
    }
    return labels;
  };

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/photos/${photo.id}`, { parentPhotoId: null, isDetailShot: false, linkReason: null, linkedPinLabel: null });
    },
    onSuccess: () => {
      setParentId(null);
      setLinkReason("");
      setLinkedPinLabel("");
      invalidatePhotos();
      invalidateEntries();
    },
    onError: () => toast({ title: "Failed to unlink photo", variant: "destructive" }),
  });

  const handleUnlink = async () => {
    const photoPins = pins.filter(p => isDSuffixLabel(p.label || ""));
    if (photoPins.length > 0) {
      setRelabelUnlinkDialog({ pinsToRelabel: photoPins });
    } else {
      unlinkMutation.mutate();
    }
  };

  const confirmUnlinkRelabel = async (doRelabel: boolean) => {
    const dialog = relabelUnlinkDialog;
    setRelabelUnlinkDialog(null);
    try {
      await unlinkMutation.mutateAsync();
      if (doRelabel && dialog) {
        try {
          const newLabels = await getNextSequentialLabels(dialog.pinsToRelabel.length);
          await relabelPins(dialog.pinsToRelabel.map(p => p.id), newLabels);
          invalidatePins();
        } catch {
          toast({ title: "Failed to relabel pins", variant: "destructive" });
        }
      }
    } catch {
      toast({ title: "Failed to unlink photo", variant: "destructive" });
    }
  };

  const linkMutation = useMutation({
    mutationFn: async (params: { parentId: number; reason: string; pinLabel: string }) => {
      await apiRequest("PATCH", `/api/photos/${photo.id}`, {
        parentPhotoId: params.parentId,
        isDetailShot: true,
        linkReason: params.reason || null,
        linkedPinLabel: params.pinLabel || null,
      });
    },
    onSuccess: (_data, params) => {
      setParentId(params.parentId);
      setLinkReason(params.reason);
      setLinkedPinLabel(params.pinLabel);
      setLinkPickerOpen(false);
      setSelectedParentForLink(null);
      setCustomReasonOpen(false);
      setCustomReasonText("");
      invalidatePhotos();
      invalidateEntries();
    },
    onError: () => toast({ title: "Failed to link photo", variant: "destructive" }),
  });

  const handleLink = (params: { parentId: number; reason: string; pinLabel: string }) => {
    const photoPins = pins.filter(p => p.label);
    if (params.pinLabel && photoPins.length > 0) {
      const hasNonDSuffix = photoPins.some(p => !isDSuffixLabel(p.label || ""));
      if (hasNonDSuffix) {
        setRelabelLinkDialog({ parentPinLabel: params.pinLabel, pinsToRelabel: photoPins, linkParams: params });
        return;
      }
    }
    linkMutation.mutate(params);
  };

  const confirmLinkRelabel = async (doRelabel: boolean) => {
    const dialog = relabelLinkDialog;
    setRelabelLinkDialog(null);
    if (!dialog) return;
    try {
      await linkMutation.mutateAsync(dialog.linkParams);
      if (doRelabel) {
        try {
          const existingLabels: string[] = [];
          const newLabels = dialog.pinsToRelabel.map(p => {
            const label = generateDetailPinLabel(dialog.parentPinLabel, existingLabels);
            existingLabels.push(label);
            return label;
          });
          await relabelPins(dialog.pinsToRelabel.map(p => p.id), newLabels);
          invalidatePins();
        } catch {
          toast({ title: "Failed to relabel pins", variant: "destructive" });
        }
      }
    } catch {
      toast({ title: "Failed to link photo", variant: "destructive" });
    }
  };

  const handleAisleBlur = () => {
    if (aisle !== aisleRef.current) {
      const prev = aisleRef.current;
      aisleRef.current = aisle;
      locationMutation.mutate({ aisle, _previous: { aisle: prev } });
    }
  };

  const handleSectionBlur = () => {
    if (section.trim() === "") {
      setSection(sectionRef.current);
      return;
    }
    if (section !== sectionRef.current) {
      const prev = sectionRef.current;
      sectionRef.current = section;
      locationMutation.mutate({ section, _previous: { section: prev } });
    }
  };

  const handleNotesBlur = () => {
    if (notes !== notesRef.current) {
      notesRef.current = notes;
      notesMutation.mutate(notes);
    }
  };

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/photos/${photo.id}/duplicate`);
      return res.json();
    },
    onSuccess: (newPhoto) => {
      invalidatePhotos();
      if (onPushUndo && newPhoto?.id) {
        onPushUndo({
          type: "duplicate-photo",
          sessionId,
          entityId: newPhoto.id,
          data: newPhoto,
        });
      }
      toast({ title: "Photo duplicated" });
    },
    onError: () => toast({ title: "Failed to duplicate photo", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { id, createdAt, ...rest } = photo;
      const capturedPins = [...pins];
      const pinnedEntryIds = capturedPins.filter(p => p.entryId).map(p => p.entryId!);
      const entriesRes = await apiRequest("GET", `/api/sessions/${sessionId}/entries`);
      const allEntries: any[] = await entriesRes.json();
      const capturedEntries = allEntries.filter(
        (e: any) => pinnedEntryIds.includes(e.id) || e.photoId === photo.id
      );
      await apiRequest("DELETE", `/api/photos/${photo.id}?keepFile=1`);
      return { photoData: rest, capturedPins, capturedEntries };
    },
    onSuccess: ({ photoData, capturedPins, capturedEntries }) => {
      invalidatePhotos();
      invalidateEntries();
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
      onClearUndoHistory?.();
      if (onPushUndo) {
        onPushUndo({
          type: "delete-photo",
          sessionId,
          entityId: photo.id,
          data: photoData,
          previousData: { ...photoData, pins: capturedPins, entries: capturedEntries },
        });
      }
      toast({ title: "Photo deleted" });
    },
    onError: () => toast({ title: "Failed to delete photo", variant: "destructive" }),
  });

  const isSaving = locationMutation.isPending || notesMutation.isPending || unlinkMutation.isPending || linkMutation.isPending;
  const hasNotes = notes.trim().length > 0;

  const parentPhoto = parentId !== null ? allPhotos.find(p => p.id === parentId) : null;
  const parentLabel = parentPhoto
    ? `${parentPhoto.aisle || "—"} / ${parentPhoto.section || "—"}`
    : "Linked";

  const linkBadgeText = (() => {
    const pinRef = linkedPinLabel ? formatPinLabel(linkedPinLabel) : "";
    if (linkReason === "Close-up" && pinRef) return `Close-up of ${pinRef}`;
    if (linkReason === "Close-up") return "Close-up";
    if (linkReason === "Re-shoot for flag" && pinRef) return `Re-shoot for Flag · ${pinRef}`;
    if (linkReason === "Re-shoot for flag") return "Re-shoot for flag";
    if (linkReason === "Better tag visibility" && pinRef) return `Tag visibility · ${pinRef}`;
    if (linkReason === "Better tag visibility") return "Better tag visibility";
    if (linkReason && pinRef) return `${linkReason} · ${pinRef}`;
    if (linkReason) return linkReason;
    if (pinRef) return `Detail of ${pinRef}`;
    return parentLabel;
  })();

  const linkBadgeColor = (() => {
    if (linkReason === "Close-up") return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    if (linkReason === "Re-shoot for flag") return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
    return "bg-muted text-muted-foreground border-border";
  })();

  const isDetail = photo.isDetailShot && parentId !== null;

  const linkedPinShadeMap = useMemo(() => {
    const map = new Map<string, number>();
    const labels: string[] = [];
    for (const p of allPhotos) {
      if (p.parentPhotoId === photo.id && p.linkedPinLabel && !labels.includes(p.linkedPinLabel)) {
        labels.push(p.linkedPinLabel);
      }
    }
    labels.sort();
    labels.forEach((l, i) => map.set(l, i));
    return map;
  }, [allPhotos, photo.id]);

  const detailShadeIndex = useMemo(() => {
    if (!isDetail || !photo.linkedPinLabel || !photo.parentPhotoId) return 0;
    const siblings: string[] = [];
    for (const p of allPhotos) {
      if (p.parentPhotoId === photo.parentPhotoId && p.linkedPinLabel && !siblings.includes(p.linkedPinLabel)) {
        siblings.push(p.linkedPinLabel);
      }
    }
    siblings.sort();
    return siblings.indexOf(photo.linkedPinLabel);
  }, [allPhotos, photo.parentPhotoId, photo.linkedPinLabel, isDetail]);

  const candidateParents = sortPhotos(allPhotos.filter(p => !p.isDetailShot && p.id !== photo.id));

  const parentPinsForLink = selectedParentForLink
    ? allPins.filter(p => p.photoId === selectedParentForLink && p.label)
    : [];

  return (
    <div className={`rounded-md border bg-card group relative flex flex-col ${isDetail ? "!border-blue-500 sm:ml-3" : "border-border"}`} data-testid={`strip-card-${photo.id}`}>
      <div ref={thumbContainerRef} className="relative aspect-square lg:aspect-video bg-muted overflow-hidden">
        <img
          src={photoUrl(photo.objectStorageKey)}
          alt={`Photo ${photo.id}`}
          className="w-full h-full object-contain cursor-zoom-in"
          loading="lazy"
          onClick={() => {
            const label = [photo.aisle, photo.section].filter(Boolean).join(" / ") || `Photo #${photo.id}`;
            onLightbox(photoUrl(photo.objectStorageKey), label);
          }}
          onLoad={(e) => {
            const img = e.currentTarget;
            setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
          }}
          data-testid={`img-strip-thumb-${photo.id}`}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none flex items-center justify-center">
          <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow pointer-events-none" />
        </div>
        {imgNaturalSize && containerSize && pins.map((pin) => {
          let displayX = pin.xPercent;
          let displayY = pin.yPercent;
          if (imgNaturalSize && containerSize) {
            const { w: iw, h: ih } = imgNaturalSize;
            const contAspect = containerSize.w / containerSize.h;
            const imgAspect = iw / ih;
            if (imgAspect > contAspect) {
              const scale = contAspect / imgAspect;
              displayY = pin.yPercent * scale + (1 - scale) * 50;
            } else if (imgAspect < contAspect) {
              const scale = imgAspect / contAspect;
              displayX = pin.xPercent * scale + (1 - scale) * 50;
            }
          }
          return (
            <div
              key={pin.id}
              className="absolute pointer-events-none"
              style={{
                left: `${displayX}%`,
                top: `${displayY}%`,
                transform: "translate(-50%, -50%)",
              }}
              title={pin.label || "Pin"}
            >
              {(() => {
                const shadeIdx = isDetail ? detailShadeIndex : (pin.label ? linkedPinShadeMap.get(pin.label) : undefined);
                const dotColor = shadeIdx !== undefined && shadeIdx >= 0 ? blueShade(shadeIdx).bg : "bg-orange-400";
                return (pin.reelCount ?? 1) >= 2 ? (
                  <div className={`w-5 h-5 rounded-full ${dotColor} border-2 border-white shadow-md flex items-center justify-center`}>
                    <span className="text-[9px] font-bold leading-none text-black">{pin.reelCount}</span>
                  </div>
                ) : (
                  <div className={`w-3 h-3 rounded-full ${dotColor} border-2 border-white shadow-md`} />
                );
              })()}
            </div>
          );
        })}
        <Button
          size="icon"
          variant="ghost"
          className="absolute top-1 right-1 h-6 w-6 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
          onPointerDown={(e) => { e.preventDefault(); onJumpToPhoto(photo.id); }}
          data-testid={`button-strip-jump-${photo.id}`}
          title="Open in Reel IDs"
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
        {isSaving && (
          <div className="absolute bottom-1 right-1">
            <Loader2 className="h-3 w-3 animate-spin text-white drop-shadow" />
          </div>
        )}
      </div>

      <div className="p-2 flex flex-col gap-1.5 flex-1">
        <div className="text-[10px] font-mono font-semibold text-muted-foreground tracking-wide">
          {photoSeqLabel(photo)}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Aisle</label>
            <Input
              value={aisle}
              onChange={(e) => setAisle(e.target.value)}
              onBlur={handleAisleBlur}
              disabled={!canEdit}
              className="h-6 text-xs px-1.5 py-0"
              data-testid={`input-strip-aisle-${photo.id}`}
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Section</label>
            <Input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              onBlur={handleSectionBlur}
              disabled={!canEdit}
              className="h-6 text-xs px-1.5 py-0"
              data-testid={`input-strip-section-${photo.id}`}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {parentId !== null && (
            <span className="inline-flex items-center gap-0.5">
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0 h-4 rounded border font-medium ${linkBadgeColor}`}
                title={`Linked to: ${parentLabel}${linkReason ? ` (${linkReason})` : ""}${linkedPinLabel ? ` · Pin ${formatPinLabel(linkedPinLabel)}` : ""}`}
                data-testid={`badge-link-info-${photo.id}`}
              >
                <Link2 className="h-2.5 w-2.5" />
                {linkBadgeText}
              </span>
              {canEdit && (
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => handleUnlink()}
                  disabled={unlinkMutation.isPending}
                  title="Unlink from parent"
                  data-testid={`button-strip-unlink-${photo.id}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          )}

          <div className="hidden sm:flex items-center gap-3 flex-1">
            {parentId === null && canEdit && (
              <button
                className="text-muted-foreground hover:text-primary transition-colors"
                onClick={() => setLinkPickerOpen((o) => !o)}
                title="Link to a parent photo"
                data-testid={`button-strip-link-${photo.id}`}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            )}

            {canEdit && (
              confirmDuplicate ? (
                <button
                  className="text-[10px] font-medium text-primary border border-primary/50 rounded px-1 py-0 h-4 hover:bg-primary/10 transition-colors disabled:opacity-50"
                  onPointerDown={(e) => { e.preventDefault(); duplicateMutation.mutate(); setConfirmDuplicate(false); }}
                  onBlur={() => setConfirmDuplicate(false)}
                  disabled={duplicateMutation.isPending}
                  title="Confirm duplicate"
                  data-testid={`button-strip-duplicate-confirm-${photo.id}`}
                  autoFocus
                >
                  {duplicateMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin inline" /> : "Duplicate?"}
                </button>
              ) : (
                <button
                  className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                  onPointerDown={(e) => { e.preventDefault(); setConfirmDuplicate(true); }}
                  disabled={duplicateMutation.isPending}
                  title="Duplicate this photo"
                  data-testid={`button-strip-duplicate-${photo.id}`}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )
            )}

            {canEdit && (
              confirmDelete ? (
                <button
                  className="text-[10px] font-medium text-destructive border border-destructive/50 rounded px-1 py-0 h-4 hover:bg-destructive/10 transition-colors disabled:opacity-50"
                  onPointerDown={(e) => { e.preventDefault(); deleteMutation.mutate(); }}
                  onBlur={() => setConfirmDelete(false)}
                  disabled={deleteMutation.isPending}
                  title="Confirm delete"
                  data-testid={`button-strip-delete-confirm-${photo.id}`}
                  autoFocus
                >
                  {deleteMutation.isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin inline" /> : "Delete?"}
                </button>
              ) : (
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  onPointerDown={(e) => { e.preventDefault(); setConfirmDelete(true); }}
                  disabled={deleteMutation.isPending}
                  title="Delete this photo"
                  data-testid={`button-strip-delete-${photo.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )
            )}

            <button
              className="ml-auto"
              onClick={() => setNotesOpen((o) => !o)}
              title={hasNotes ? "View/edit notes" : "Add notes"}
              data-testid={`button-strip-notes-${photo.id}`}
            >
              <Pencil className={`h-3.5 w-3.5 ${hasNotes ? "text-primary fill-primary/20" : "text-muted-foreground"}`} />
            </button>
          </div>

          <div className="sm:hidden ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded hover:bg-muted transition-colors" data-testid={`button-strip-actions-${photo.id}`}>
                  <MoreVertical className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[160px]">
                {parentId === null && canEdit && (
                  <DropdownMenuItem
                    onClick={() => setLinkPickerOpen((o) => !o)}
                    data-testid={`menu-strip-link-${photo.id}`}
                  >
                    <Link2 className="h-4 w-4 mr-2" />
                    Link to parent
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => setNotesOpen((o) => !o)}
                  data-testid={`menu-strip-notes-${photo.id}`}
                >
                  <Pencil className={`h-4 w-4 mr-2 ${hasNotes ? "text-primary" : ""}`} />
                  {hasNotes ? "View notes" : "Add notes"}
                </DropdownMenuItem>
                {canEdit && (
                  confirmDuplicate ? (
                    <DropdownMenuItem
                      className="text-primary focus:text-primary font-semibold"
                      onClick={(e) => { e.preventDefault(); duplicateMutation.mutate(); setConfirmDuplicate(false); }}
                      disabled={duplicateMutation.isPending}
                      data-testid={`menu-strip-duplicate-confirm-${photo.id}`}
                    >
                      {duplicateMutation.isPending
                        ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        : <Copy className="h-4 w-4 mr-2" />}
                      Confirm Duplicate?
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onSelect={(e) => { e.preventDefault(); setConfirmDuplicate(true); }}
                      disabled={duplicateMutation.isPending}
                      data-testid={`menu-strip-duplicate-${photo.id}`}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Duplicate
                    </DropdownMenuItem>
                  )
                )}
                {canEdit && (
                  confirmDelete ? (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive font-semibold"
                      onClick={(e) => { e.preventDefault(); deleteMutation.mutate(); }}
                      disabled={deleteMutation.isPending}
                      data-testid={`menu-strip-delete-confirm-${photo.id}`}
                    >
                      {deleteMutation.isPending
                        ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        : <Trash2 className="h-4 w-4 mr-2" />}
                      Confirm Delete?
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={(e) => { e.preventDefault(); setConfirmDelete(true); }}
                      disabled={deleteMutation.isPending}
                      data-testid={`menu-strip-delete-${photo.id}`}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {isDetail && linkReason && (
          <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400" data-testid={`text-link-reason-${photo.id}`}>
            {linkReason}{linkedPinLabel ? ` · Pin ${formatPinLabel(linkedPinLabel)}` : ""}
          </div>
        )}

        {linkPickerOpen && canEdit && parentId === null && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Link to parent photo</label>
            <select
              className="w-full text-xs rounded border border-border bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
              value={selectedParentForLink?.toString() || ""}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) {
                  setSelectedParentForLink(val);
                  setLinkedPinLabel("");
                }
              }}
              data-testid={`select-strip-link-${photo.id}`}
            >
              <option value="" disabled>Select a photo…</option>
              {candidateParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.aisle || "—"} / {p.section || "—"} · #{photoSeqLabel(p)}
                </option>
              ))}
            </select>

            {selectedParentForLink && (
              <>
                {parentPinsForLink.length > 0 && (
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Pin (optional)</label>
                    <select
                      className="w-full text-xs rounded border border-border bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary mt-0.5"
                      value={linkedPinLabel}
                      onChange={(e) => setLinkedPinLabel(e.target.value)}
                      data-testid={`select-strip-pin-${photo.id}`}
                    >
                      <option value="">No specific pin</option>
                      {parentPinsForLink.map((pin) => (
                        <option key={pin.id} value={pin.label!}>
                          {formatPinLabel(pin.label!)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Reason</label>
                  <select
                    className="w-full text-xs rounded border border-border bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary mt-0.5"
                    value={customReasonOpen ? "__custom__" : linkReason}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__custom__") {
                        setCustomReasonOpen(true);
                        setLinkReason("");
                      } else {
                        setCustomReasonOpen(false);
                        setCustomReasonText("");
                        setLinkReason(v);
                      }
                    }}
                    data-testid={`select-strip-reason-${photo.id}`}
                  >
                    <option value="">No reason</option>
                    <option value="Close-up">Close-up</option>
                    <option value="Re-shoot for flag">Re-shoot for flag</option>
                    <option value="Better tag visibility">Better tag visibility</option>
                    <option value="__custom__">Custom…</option>
                  </select>
                </div>

                {customReasonOpen && (
                  <input
                    type="text"
                    className="w-full text-xs rounded border border-border bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Enter custom reason…"
                    value={customReasonText}
                    onChange={(e) => {
                      setCustomReasonText(e.target.value);
                      setLinkReason(e.target.value);
                    }}
                    data-testid={`input-strip-custom-reason-${photo.id}`}
                  />
                )}

                <div className="flex items-center justify-between mt-0.5">
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setLinkPickerOpen(false);
                      setSelectedParentForLink(null);
                      setCustomReasonOpen(false);
                      setCustomReasonText("");
                      setLinkReason("");
                      setLinkedPinLabel("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="text-sm font-semibold text-white bg-primary hover:bg-primary/80 disabled:opacity-50 rounded px-4 py-1.5"
                    onClick={() => handleLink({ parentId: selectedParentForLink!, reason: linkReason, pinLabel: linkedPinLabel })}
                    disabled={linkMutation.isPending}
                    data-testid={`button-strip-confirm-link-${photo.id}`}
                  >
                    {linkMutation.isPending ? "Linking…" : "Link"}
                  </button>
                </div>
              </>
            )}

            {!selectedParentForLink && (
              <button
                className="text-[10px] text-muted-foreground hover:text-foreground self-end"
                onClick={() => setLinkPickerOpen(false)}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {notesOpen && (
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesBlur}
            disabled={!canEdit}
            placeholder="Add notes..."
            className="text-xs min-h-[56px] resize-none"
            data-testid={`textarea-strip-notes-${photo.id}`}
          />
        )}
      </div>

      <AlertDialog open={!!relabelLinkDialog} onOpenChange={(open) => { if (!open) setRelabelLinkDialog(null); }}>
        <AlertDialogContent data-testid={`dialog-relabel-link-${photo.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Relabel pins?</AlertDialogTitle>
            <AlertDialogDescription>
              {relabelLinkDialog && (() => {
                const existingLabels: string[] = [];
                const newLabels = relabelLinkDialog.pinsToRelabel.map(p => {
                  const label = generateDetailPinLabel(relabelLinkDialog.parentPinLabel, existingLabels);
                  existingLabels.push(label);
                  return label;
                });
                return relabelLinkDialog.pinsToRelabel.map((p, i) => (
                  <span key={p.id} className="block">
                    {formatPinLabel(p.label || "")} will be renamed to {formatPinLabel(newLabels[i])}
                  </span>
                ));
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => confirmLinkRelabel(false)} data-testid={`button-relabel-link-cancel-${photo.id}`}>
              Keep current labels
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmLinkRelabel(true)} data-testid={`button-relabel-link-confirm-${photo.id}`}>
              Relabel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!relabelUnlinkDialog} onOpenChange={(open) => { if (!open) setRelabelUnlinkDialog(null); }}>
        <AlertDialogContent data-testid={`dialog-relabel-unlink-${photo.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Relabel pins?</AlertDialogTitle>
            <AlertDialogDescription>
              {relabelUnlinkDialog && relabelUnlinkDialog.pinsToRelabel.map(p => (
                <span key={p.id} className="block">
                  {formatPinLabel(p.label || "")} will be renamed to a sequential number
                </span>
              ))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => confirmUnlinkRelabel(false)} data-testid={`button-relabel-unlink-cancel-${photo.id}`}>
              Keep current labels
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmUnlinkRelabel(true)} data-testid={`button-relabel-unlink-confirm-${photo.id}`}>
              Relabel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type LightboxPhoto = { url: string; label: string; pins?: Pin[]; linkedPinShadeMap?: Map<string, number>; isDetailShot?: boolean; detailShadeIndex?: number };

function Lightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  photos: LightboxPhoto[];
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const total = photos.length;
  const current = photos[index];
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  const prev = useCallback(() => { if (hasPrev) onNavigate(index - 1); }, [hasPrev, index, onNavigate]);
  const next = useCallback(() => { if (hasNext) onNavigate(index + 1); }, [hasNext, index, onNavigate]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowLeft") { prev(); return; }
    if (e.key === "ArrowRight") { next(); }
  }, [onClose, prev, next]);

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;
    if (dt > 500 || Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) next();
    else prev();
  }, [prev, next]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-testid="lightbox-overlay"
    >
      <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
        <span className="text-white/70 text-sm truncate max-w-[200px]">{current.label}</span>
        <button
          className="text-white/80 hover:text-white bg-black/40 rounded-full p-1.5 transition-colors"
          onClick={onClose}
          data-testid="button-lightbox-close"
          title="Close (Esc)"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {hasPrev && (
        <button
          className="absolute left-1 sm:left-4 top-1/2 -translate-y-1/2 z-10 text-white/80 hover:text-white bg-black/60 hover:bg-black/80 rounded-full p-1.5 sm:p-2 transition-colors"
          onClick={(e) => { e.stopPropagation(); prev(); }}
          data-testid="button-lightbox-prev"
          title="Previous (←)"
        >
          <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
      )}

      <div className="relative px-10 sm:px-16" onClick={(e) => e.stopPropagation()}>
        <img
          src={current.url}
          alt={current.label}
          className="max-w-[calc(100vw-5rem)] sm:max-w-[85vw] max-h-[88vh] object-contain rounded shadow-2xl block"
          data-testid="img-lightbox-full"
        />
        {current.pins && current.pins.map((pin) => {
          const shadeIdx = current.isDetailShot ? (current.detailShadeIndex ?? 0) : (pin.label ? current.linkedPinShadeMap?.get(pin.label) : undefined);
          const shade = shadeIdx !== undefined && shadeIdx >= 0 ? blueShade(shadeIdx) : null;
          const dotBg = shade ? shade.bg : "bg-orange-500";
          const dotBorder = shade ? shade.border : "border-orange-300";
          const dotShadow = shade ? shade.shadow : "shadow-[0_0_0_3px_rgba(251,146,60,0.5)]";
          return (
          <div
            key={pin.id}
            className="absolute pointer-events-none"
            style={{
              left: `${pin.xPercent}%`,
              top: `${pin.yPercent}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            {(pin.reelCount ?? 1) >= 2 ? (
              <div className={`w-8 h-8 rounded-full ${dotBg} border-[3px] ${dotBorder} ${dotShadow} flex items-center justify-center`}>
                <span className="text-sm font-bold leading-none text-black">{pin.reelCount}</span>
              </div>
            ) : (
              <div className={`w-5 h-5 rounded-full ${dotBg} border-[3px] ${dotBorder} ${dotShadow}`} />
            )}
          </div>
        );})}
      </div>

      {hasNext && (
        <button
          className="absolute right-1 sm:right-4 top-1/2 -translate-y-1/2 z-10 text-white/80 hover:text-white bg-black/60 hover:bg-black/80 rounded-full p-1.5 sm:p-2 transition-colors"
          onClick={(e) => { e.stopPropagation(); next(); }}
          data-testid="button-lightbox-next"
          title="Next (→)"
        >
          <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
        </button>
      )}

      {total > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {photos.map((_, i) => (
            <button
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${i === index ? "bg-white" : "bg-white/30 hover:bg-white/60"}`}
              onClick={(e) => { e.stopPropagation(); onNavigate(i); }}
              data-testid={`button-lightbox-dot-${i}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PhotoStrip({
  sessionId,
  canEdit,
  onJumpToPhoto,
  onClearUndoHistory,
  onPushUndo,
  scrollToPhotoId,
  onScrolled,
}: {
  sessionId: number;
  canEdit: boolean;
  onJumpToPhoto: (photoId: number) => void;
  onClearUndoHistory?: () => void;
  onPushUndo?: (action: any) => void;
  scrollToPhotoId?: number | null;
  onScrolled?: () => void;
}) {
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null);

  useEffect(() => {
    if (!scrollToPhotoId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-testid="strip-card-${scrollToPhotoId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-blue-400");
        setTimeout(() => el.classList.remove("ring-2", "ring-blue-400"), 2000);
      }
      onScrolled?.();
    }, 300);
    return () => clearTimeout(timer);
  }, [scrollToPhotoId, onScrolled]);

  const { data: photos = [], isLoading } = useQuery<Photo[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "photos"],
    enabled: sessionId > 0,
  });

  const { data: allPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
    enabled: sessionId > 0,
  });

  const pinsByPhoto = new Map<number, Pin[]>();
  for (const pin of allPins) {
    if (!pinsByPhoto.has(pin.photoId)) pinsByPhoto.set(pin.photoId, []);
    pinsByPhoto.get(pin.photoId)!.push(pin);
  }

  if (isLoading) {
    return (
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3" data-testid="strip-loading">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square lg:aspect-video rounded-md" />
        ))}
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm" data-testid="strip-empty">
        No photos yet — use Mobile Flow or Reel IDs to capture images.
      </div>
    );
  }

  const sorted = orderWithDetailShots(photos);

  type SectionGroup = { section: string; photos: Photo[] };
  type AisleGroup = { aisle: string; sections: SectionGroup[] };

  const aisleGroups: AisleGroup[] = [];
  for (const photo of sorted) {
    const aisleKey = photo.aisle || "";
    const sectionKey = photo.section || "";

    let aisleGroup = aisleGroups[aisleGroups.length - 1];
    if (!aisleGroup || aisleGroup.aisle !== aisleKey) {
      aisleGroup = { aisle: aisleKey, sections: [] };
      aisleGroups.push(aisleGroup);
    }

    let sectionGroup = aisleGroup.sections[aisleGroup.sections.length - 1];
    if (!sectionGroup || sectionGroup.section !== sectionKey) {
      sectionGroup = { section: sectionKey, photos: [] };
      aisleGroup.sections.push(sectionGroup);
    }

    sectionGroup.photos.push(photo);
  }

  return (
    <div className="p-4 space-y-6" data-testid="photo-strip">
      <h2 className="sm:hidden text-lg font-bold underline flex items-center justify-center gap-2 -mb-2">
        <LayoutGrid className="h-5 w-5" />
        Photos Reel
      </h2>
      {aisleGroups.map((aisleGroup) => {
        const totalPhotos = aisleGroup.sections.reduce((n, s) => n + s.photos.length, 0);
        return (
          <div key={aisleGroup.aisle} className="border border-blue-500 sm:!border-blue-600/50 rounded-lg p-2">
            <div className="mb-3 pb-1 border-b">
              <button
                className="text-xs font-semibold uppercase tracking-wider text-orange-500 hover:text-orange-400 hover:underline transition-colors cursor-pointer"
                onClick={() => onJumpToPhoto(aisleGroup.sections[0].photos[0].id)}
                data-testid={`link-strip-aisle-${aisleGroup.aisle || "none"}`}
              >
                {aisleGroup.aisle ? (
                  <>
                    <span className="sm:hidden">
                      {`Aisle: ${aisleGroup.aisle.toLowerCase() === "receiving" ? "Rec." : aisleGroup.aisle}`}
                    </span>
                    <span className="hidden sm:inline">
                      {`Aisle: ${aisleGroup.aisle}`}
                    </span>
                  </>
                ) : "No Aisle Set"}
              </button>
              <span className="ml-2 text-xs text-muted-foreground">
                ({totalPhotos} photo{totalPhotos !== 1 ? "s" : ""})
              </span>
            </div>

            <div className="space-y-4">
              {aisleGroup.sections.map((sectionGroup) => (
                <div key={sectionGroup.section} className="sm:border-0 border border-blue-400 rounded-md p-1.5 sm:p-0">
                  <div className="flex items-center gap-2 mb-2 border-l-2 border-muted-foreground/20 pl-2">
                    <button
                      className="text-xs font-medium text-orange-500 underline hover:text-orange-400 transition-colors cursor-pointer"
                      onClick={() => onJumpToPhoto(sectionGroup.photos[0].id)}
                      data-testid={`link-strip-section-${aisleGroup.aisle || "none"}-${sectionGroup.section || "none"}`}
                    >
                      {sectionGroup.section ? `Section ${sectionGroup.section}` : "No Section Set"}
                    </button>
                    <span className="text-[11px] text-muted-foreground/50">
                      · {sectionGroup.photos.length} photo{sectionGroup.photos.length !== 1 ? "s" : ""}
                    </span>
                    {sectionGroup.photos.some(p => p.isDetailShot && p.parentPhotoId != null) && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-500 bg-blue-500/10 border border-blue-500/20 rounded px-1 py-0">
                        <Link2 className="h-2.5 w-2.5" />
                        Linked
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
                    {sectionGroup.photos.map((photo) => (
                      <PhotoCard
                        key={photo.id}
                        photo={photo}
                        sessionId={sessionId}
                        canEdit={canEdit}
                        allPhotos={photos}
                        pins={pinsByPhoto.get(photo.id) ?? []}
                        allPins={allPins}
                        onJumpToPhoto={onJumpToPhoto}
                        onLightbox={() => {
                          const sectionPhotos: LightboxPhoto[] = sectionGroup.photos.map(p => {
                            const shadeMap = new Map<string, number>();
                            const labels: string[] = [];
                            for (const op of photos) {
                              if (op.parentPhotoId === p.id && op.linkedPinLabel && !labels.includes(op.linkedPinLabel)) {
                                labels.push(op.linkedPinLabel);
                              }
                            }
                            labels.sort();
                            labels.forEach((l, i) => shadeMap.set(l, i));
                            let dsi = 0;
                            if (p.isDetailShot && p.parentPhotoId && p.linkedPinLabel) {
                              const sibs: string[] = [];
                              for (const op of photos) {
                                if (op.parentPhotoId === p.parentPhotoId && op.linkedPinLabel && !sibs.includes(op.linkedPinLabel)) sibs.push(op.linkedPinLabel);
                              }
                              sibs.sort();
                              dsi = sibs.indexOf(p.linkedPinLabel);
                            }
                            return {
                              url: photoUrl(p.objectStorageKey),
                              label: [p.aisle, p.section].filter(Boolean).join(" / ") || `Photo #${p.id}`,
                              pins: pinsByPhoto.get(p.id) ?? [],
                              linkedPinShadeMap: shadeMap,
                              isDetailShot: p.isDetailShot || false,
                              detailShadeIndex: dsi,
                            };
                          });
                          const idx = sectionGroup.photos.findIndex(p => p.id === photo.id);
                          setLightbox({ photos: sectionPhotos, index: idx >= 0 ? idx : 0 });
                        }}
                        onClearUndoHistory={onClearUndoHistory}
                        onPushUndo={onPushUndo}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(i) => setLightbox((prev) => prev ? { ...prev, index: i } : null)}
        />
      )}
    </div>
  );
}
