import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, ExternalLink, Loader2, Link2, X, Copy, Trash2, LayoutGrid, ZoomIn, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
    mutationFn: async (update: { aisle?: string; section?: string }) => {
      await apiRequest("PATCH", `/api/photos/${photo.id}`, update);
    },
    onSuccess: () => { invalidatePhotos(); invalidateEntries(); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const notesMutation = useMutation({
    mutationFn: async (val: string) => {
      await apiRequest("PATCH", `/api/photos/${photo.id}`, { notes: val });
    },
    onSuccess: invalidatePhotos,
    onError: () => toast({ title: "Failed to save notes", variant: "destructive" }),
  });

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

  const handleAisleBlur = () => {
    if (aisle !== aisleRef.current) {
      aisleRef.current = aisle;
      locationMutation.mutate({ aisle });
    }
  };

  const handleSectionBlur = () => {
    if (section.trim() === "") {
      setSection(sectionRef.current);
      return;
    }
    if (section !== sectionRef.current) {
      sectionRef.current = section;
      locationMutation.mutate({ section });
    }
  };

  const handleNotesBlur = () => {
    if (notes !== notesRef.current) {
      notesRef.current = notes;
      notesMutation.mutate(notes);
    }
  };

  const duplicateMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/photos/${photo.id}/duplicate`),
    onSuccess: () => {
      invalidatePhotos();
      toast({ title: "Photo duplicated" });
    },
    onError: () => toast({ title: "Failed to duplicate photo", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/photos/${photo.id}`),
    onSuccess: () => {
      invalidatePhotos();
      invalidateEntries();
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
      onClearUndoHistory?.();
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
    const pinRef = linkedPinLabel ? `P${String(linkedPinLabel).padStart(3, "0")}` : "";
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

  const candidateParents = sortPhotos(allPhotos.filter(p => !p.isDetailShot && p.id !== photo.id));

  const parentPinsForLink = selectedParentForLink
    ? allPins.filter(p => p.photoId === selectedParentForLink && p.label)
    : [];

  const isDetail = photo.isDetailShot && parentId !== null;

  return (
    <div className={`rounded-md border bg-card overflow-hidden group relative flex flex-col ${isDetail ? "!border-blue-500 ml-3" : "border-border"}`} data-testid={`strip-card-${photo.id}`}>
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
              {(pin.reelCount ?? 1) >= 2 ? (
                <div className="w-5 h-5 rounded-full bg-orange-400 border-2 border-white shadow-md flex items-center justify-center">
                  <span className="text-[9px] font-bold leading-none text-black">{pin.reelCount}</span>
                </div>
              ) : (
                <div className="w-3 h-3 rounded-full bg-orange-400 border-2 border-white shadow-md" />
              )}
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
        {isDetail && linkReason && (
          <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400" data-testid={`text-link-reason-${photo.id}`}>
            {linkReason}{linkedPinLabel ? ` · Pin ${linkedPinLabel}` : ""}
          </div>
        )}
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
          {parentId !== null ? (
            <span className="inline-flex items-center gap-0.5">
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0 h-4 rounded border font-medium ${linkBadgeColor}`}
                title={`Linked to: ${parentLabel}${linkReason ? ` (${linkReason})` : ""}${linkedPinLabel ? ` · Pin ${linkedPinLabel}` : ""}`}
                data-testid={`badge-link-info-${photo.id}`}
              >
                <Link2 className="h-2.5 w-2.5" />
                {linkBadgeText}
              </span>
              {canEdit && (
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => unlinkMutation.mutate()}
                  disabled={unlinkMutation.isPending}
                  title="Unlink from parent"
                  data-testid={`button-strip-unlink-${photo.id}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ) : (
            canEdit && (
              <button
                className="text-muted-foreground hover:text-primary transition-colors"
                onClick={() => setLinkPickerOpen((o) => !o)}
                title="Link to a parent photo"
                data-testid={`button-strip-link-${photo.id}`}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            )
          )}

          {canEdit && (
            <button
              className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              onPointerDown={(e) => { e.preventDefault(); duplicateMutation.mutate(); }}
              disabled={duplicateMutation.isPending}
              title="Duplicate this photo"
              data-testid={`button-strip-duplicate-${photo.id}`}
            >
              {duplicateMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Copy className="h-3.5 w-3.5" />}
            </button>
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
                          P{String(pin.label).padStart(3, "0")}
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
                    onClick={() => linkMutation.mutate({ parentId: selectedParentForLink, reason: linkReason, pinLabel: linkedPinLabel })}
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
    </div>
  );
}

type LightboxPhoto = { url: string; label: string; pins?: Pin[] };

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

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      onClick={onClose}
      data-testid="lightbox-overlay"
    >
      <div className="absolute top-3 right-3 flex items-center gap-2">
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
          className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-black/40 hover:bg-black/70 rounded-full p-2 transition-colors"
          onClick={(e) => { e.stopPropagation(); prev(); }}
          data-testid="button-lightbox-prev"
          title="Previous (←)"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <img
          src={current.url}
          alt={current.label}
          className="max-w-[85vw] max-h-[88vh] object-contain rounded shadow-2xl block"
          data-testid="img-lightbox-full"
        />
        {current.pins && current.pins.map((pin) => (
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
              <div className="w-8 h-8 rounded-full bg-orange-500 border-[3px] border-orange-300 shadow-[0_0_0_3px_rgba(251,146,60,0.5)] flex items-center justify-center">
                <span className="text-sm font-bold leading-none text-black">{pin.reelCount}</span>
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full bg-orange-500 border-[3px] border-orange-300 shadow-[0_0_0_3px_rgba(251,146,60,0.5)]" />
            )}
          </div>
        ))}
      </div>

      {hasNext && (
        <button
          className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-black/40 hover:bg-black/70 rounded-full p-2 transition-colors"
          onClick={(e) => { e.stopPropagation(); next(); }}
          data-testid="button-lightbox-next"
          title="Next (→)"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}

      {total > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {photos.map((_, i) => (
            <button
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${i === index ? "bg-white" : "bg-white/30 hover:bg-white/60"}`}
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
  scrollToPhotoId,
  onScrolled,
}: {
  sessionId: number;
  canEdit: boolean;
  onJumpToPhoto: (photoId: number) => void;
  onClearUndoHistory?: () => void;
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
                {aisleGroup.aisle ? `Aisle: ${aisleGroup.aisle}` : "No Aisle Set"}
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
                    {sectionGroup.photos.length > 1 && (
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
                          const sectionPhotos: LightboxPhoto[] = sectionGroup.photos.map(p => ({
                            url: photoUrl(p.objectStorageKey),
                            label: [p.aisle, p.section].filter(Boolean).join(" / ") || `Photo #${p.id}`,
                            pins: pinsByPhoto.get(p.id) ?? [],
                          }));
                          const idx = sectionGroup.photos.findIndex(p => p.id === photo.id);
                          setLightbox({ photos: sectionPhotos, index: idx >= 0 ? idx : 0 });
                        }}
                        onClearUndoHistory={onClearUndoHistory}
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
