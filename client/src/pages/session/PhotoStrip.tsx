import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { StickyNote, ExternalLink, Loader2, Link2, X, Copy, Trash2, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Photo } from "@shared/schema";

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
  onJumpToPhoto,
}: {
  photo: Photo;
  sessionId: number;
  canEdit: boolean;
  allPhotos: Photo[];
  onJumpToPhoto: (id: number) => void;
}) {
  const { toast } = useToast();
  const [aisle, setAisle] = useState(photo.aisle || "");
  const [section, setSection] = useState(photo.section || "");
  const [notes, setNotes] = useState(photo.notes || "");
  const [notesOpen, setNotesOpen] = useState(false);
  const [isDetail, setIsDetail] = useState(photo.isDetailShot ?? false);
  const [parentId, setParentId] = useState<number | null>(photo.parentPhotoId ?? null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const aisleRef = useRef(aisle);
  const sectionRef = useRef(section);
  const notesRef = useRef(notes);

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

  const detailMutation = useMutation({
    mutationFn: async (val: boolean) => {
      await apiRequest("PATCH", `/api/photos/${photo.id}`, { isDetailShot: val });
    },
    onSuccess: (_data, val) => { setIsDetail(val); invalidatePhotos(); },
    onError: () => toast({ title: "Failed to update Detail status", variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/photos/${photo.id}`, { parentPhotoId: null, isDetailShot: false });
    },
    onSuccess: () => {
      setParentId(null);
      setIsDetail(false);
      invalidatePhotos();
      invalidateEntries();
    },
    onError: () => toast({ title: "Failed to unlink photo", variant: "destructive" }),
  });

  const linkMutation = useMutation({
    mutationFn: async (selectedId: number) => {
      await apiRequest("PATCH", `/api/photos/${photo.id}`, { parentPhotoId: selectedId, isDetailShot: true });
    },
    onSuccess: (_data, selectedId) => {
      setParentId(selectedId);
      setIsDetail(true);
      setLinkPickerOpen(false);
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
      toast({ title: "Photo deleted" });
    },
    onError: () => toast({ title: "Failed to delete photo", variant: "destructive" }),
  });

  const isSaving = locationMutation.isPending || notesMutation.isPending || detailMutation.isPending || unlinkMutation.isPending || linkMutation.isPending;
  const hasNotes = notes.trim().length > 0;

  const parentPhoto = parentId !== null ? allPhotos.find(p => p.id === parentId) : null;
  const parentLabel = parentPhoto
    ? `${parentPhoto.aisle || "—"} / ${parentPhoto.section || "—"}`
    : "Linked";

  const candidateParents = sortPhotos(allPhotos.filter(p => !p.isDetailShot && p.id !== photo.id));

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden group relative flex flex-col" data-testid={`strip-card-${photo.id}`}>
      <div className="relative aspect-square bg-muted overflow-hidden">
        <img
          src={photoUrl(photo.objectStorageKey)}
          alt={`Photo ${photo.id}`}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <Button
          size="icon"
          variant="ghost"
          className="absolute top-1 right-1 h-6 w-6 bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
          onPointerDown={(e) => { e.preventDefault(); onJumpToPhoto(photo.id); }}
          data-testid={`button-strip-jump-${photo.id}`}
          title="Open in Section Photo"
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

        <div className="flex items-center gap-1 flex-wrap">
          {canEdit ? (
            <button
              className={`inline-flex items-center rounded px-1 py-0 h-4 text-[10px] font-medium border transition-colors ${
                isDetail
                  ? "bg-blue-500/15 text-blue-500 border-blue-500/30 hover:bg-blue-500/25"
                  : "text-muted-foreground border-dashed border-muted-foreground/40 hover:border-blue-400 hover:text-blue-400"
              }`}
              onClick={() => detailMutation.mutate(!isDetail)}
              disabled={detailMutation.isPending}
              title={isDetail ? "Remove Detail mark" : "Mark as Detail shot"}
              data-testid={`button-strip-detail-${photo.id}`}
            >
              {isDetail ? "Detail" : "+ Detail"}
            </button>
          ) : (
            isDetail && (
              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 no-default-hover-elevate no-default-active-elevate bg-blue-500/15 text-blue-500 border-blue-500/30">
                Detail
              </Badge>
            )
          )}

          {parentId !== null ? (
            <span className="inline-flex items-center gap-0.5">
              <Badge
                variant="secondary"
                className="text-[10px] px-1 py-0 h-4 no-default-hover-elevate no-default-active-elevate"
                title={`Linked to: ${parentLabel}`}
              >
                → {parentLabel}
              </Badge>
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
                <Link2 className="h-3 w-3" />
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
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Copy className="h-3 w-3" />}
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
                <Trash2 className="h-3 w-3" />
              </button>
            )
          )}

          <button
            className="ml-auto"
            onClick={() => setNotesOpen((o) => !o)}
            title={hasNotes ? "View/edit notes" : "Add notes"}
            data-testid={`button-strip-notes-${photo.id}`}
          >
            <StickyNote className={`h-3.5 w-3.5 ${hasNotes ? "text-primary fill-primary/20" : "text-muted-foreground"}`} />
          </button>
        </div>

        {linkPickerOpen && canEdit && parentId === null && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Link to parent photo</label>
            <select
              className="w-full text-xs rounded border border-border bg-background text-foreground px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
              defaultValue=""
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) linkMutation.mutate(val);
              }}
              disabled={linkMutation.isPending}
              data-testid={`select-strip-link-${photo.id}`}
            >
              <option value="" disabled>Select a photo…</option>
              {candidateParents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.aisle || "—"} / {p.section || "—"} · #{photoSeqLabel(p)}
                </option>
              ))}
            </select>
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground self-end"
              onClick={() => setLinkPickerOpen(false)}
            >
              Cancel
            </button>
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

export default function PhotoStrip({
  sessionId,
  canEdit,
  onJumpToPhoto,
}: {
  sessionId: number;
  canEdit: boolean;
  onJumpToPhoto: (photoId: number) => void;
}) {
  const { data: photos = [], isLoading } = useQuery<Photo[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "photos"],
    enabled: sessionId > 0,
  });

  if (isLoading) {
    return (
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="strip-loading">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm" data-testid="strip-empty">
        No photos yet — use Mobile Flow or Section Photo to capture images.
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
          <div key={aisleGroup.aisle}>
            <div className="mb-3 pb-1 border-b">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {aisleGroup.aisle ? `Aisle: ${aisleGroup.aisle}` : "No Aisle Set"}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                ({totalPhotos} photo{totalPhotos !== 1 ? "s" : ""})
              </span>
            </div>

            <div className="space-y-4">
              {aisleGroup.sections.map((sectionGroup) => (
                <div key={sectionGroup.section}>
                  <div className="flex items-center gap-2 mb-2 border-l-2 border-muted-foreground/20 pl-2">
                    <span className="text-[11px] font-medium text-muted-foreground/80">
                      {sectionGroup.section ? `Section ${sectionGroup.section}` : "No Section Set"}
                    </span>
                    <span className="text-[11px] text-muted-foreground/50">
                      · {sectionGroup.photos.length} photo{sectionGroup.photos.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {sectionGroup.photos.map((photo) => (
                      <PhotoCard
                        key={photo.id}
                        photo={photo}
                        sessionId={sessionId}
                        canEdit={canEdit}
                        allPhotos={photos}
                        onJumpToPhoto={onJumpToPhoto}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

    </div>
  );
}
