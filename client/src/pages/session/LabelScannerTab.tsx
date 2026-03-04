import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ScanLine, ZoomIn, ZoomOut, Loader2, Check, X, AlertTriangle, AlertCircle, Sparkles, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { matchLabelText, type LabelMatchResult } from "@/lib/labelMatcher";
import type { Photo, Pin } from "@shared/schema";

const ZOOM_MIN = 0.005;
const ZOOM_MAX = 1.0;
const ZOOM_STEP = 0.005;
const ZOOM_CLICK_STEP = 0.015;
const ZOOM_DEFAULT = 0.12;

function getZoomStorageKey(sessionId: number) {
  return `scanner-zoom-${sessionId}`;
}

function loadSavedZooms(sessionId: number): Record<string, number> {
  try {
    const raw = localStorage.getItem(getZoomStorageKey(sessionId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveZoomLevel(sessionId: number, pinId: number, zoom: number) {
  try {
    const saved = loadSavedZooms(sessionId);
    saved[String(pinId)] = zoom;
    localStorage.setItem(getZoomStorageKey(sessionId), JSON.stringify(saved));
  } catch {}
}

function saveGlobalZoom(sessionId: number, zoom: number) {
  try {
    localStorage.setItem(`scanner-global-zoom-${sessionId}`, String(zoom));
  } catch {}
}

function loadGlobalZoom(sessionId: number): number {
  try {
    const v = localStorage.getItem(`scanner-global-zoom-${sessionId}`);
    return v ? parseFloat(v) : ZOOM_DEFAULT;
  } catch { return ZOOM_DEFAULT; }
}

function zoomLabel(fraction: number): string {
  const pct = fraction * 100;
  return pct < 1 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

interface AnalysisResult {
  pinId: number;
  pinLabel: string;
  rawText: string | null;
  readable: boolean;
}

interface PinCard {
  pin: Pin;
  zoomLevel: number;
  panX: number;
  panY: number;
  included: boolean;
  isDraft: boolean;
  result?: AnalysisResult;
  matchResult?: LabelMatchResult;
  editCatalog: string;
  editFootage: string;
  editVendor: string;
  catalogCode: string;
}

function CropCanvas({
  photoUrl,
  xPercent,
  yPercent,
  zoomLevel,
  panX = 0,
  panY = 0,
  onPan,
  size = 180,
}: {
  photoUrl: string;
  xPercent: number;
  yPercent: number;
  zoomLevel: number;
  panX?: number;
  panY?: number;
  onPan?: (dx: number, dy: number) => void;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.naturalWidth) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fraction = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel));
    const cropW = img.naturalWidth * fraction;
    const cropH = img.naturalHeight * fraction;

    const centerX = (xPercent / 100) * img.naturalWidth + panX;
    const centerY = (yPercent / 100) * img.naturalHeight + panY;

    let sx = centerX - cropW / 2;
    let sy = centerY - cropH / 2;
    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx + cropW > img.naturalWidth) sx = img.naturalWidth - cropW;
    if (sy + cropH > img.naturalHeight) sy = img.naturalHeight - cropH;

    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, size, size);
  }, [xPercent, yPercent, zoomLevel, panX, panY, size]);

  useEffect(() => {
    if (imgRef.current && imgRef.current.src === photoUrl && imgRef.current.complete) {
      draw();
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      draw();
    };
    img.src = photoUrl;
  }, [photoUrl, draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getPointerPos = (e: React.MouseEvent | React.TouchEvent) => {
    if ("touches" in e) {
      const t = e.touches[0] || (e as React.TouchEvent).changedTouches[0];
      return { x: t.clientX, y: t.clientY };
    }
    return { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getPointerPos(e);
    dragRef.current = { startX: pos.x, startY: pos.y, startPanX: panX, startPanY: panY };
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragRef.current || !onPan || !imgRef.current) return;
    const pos = getPointerPos(e);
    const dx = pos.x - dragRef.current.startX;
    const dy = pos.y - dragRef.current.startY;
    const fraction = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel));
    const scale = (imgRef.current.naturalWidth * fraction) / size;
    const rawPanX = dragRef.current.startPanX - dx * scale;
    const rawPanY = dragRef.current.startPanY - dy * scale;
    const maxPanX = imgRef.current.naturalWidth * (1 - fraction) / 2;
    const maxPanY = imgRef.current.naturalHeight * (1 - fraction) / 2;
    onPan(
      Math.max(-maxPanX, Math.min(maxPanX, rawPanX)),
      Math.max(-maxPanY, Math.min(maxPanY, rawPanY))
    );
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded border border-[hsl(18_60%_30%/0.3)] bg-black"
      style={{ width: size, height: size, cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerUp}
      onTouchStart={handlePointerDown}
      onTouchMove={handlePointerMove}
      onTouchEnd={handlePointerUp}
      onTouchCancel={handlePointerUp}
      data-testid="canvas-crop-preview"
    />
  );
}

export default function LabelScannerTab({
  sessionId,
  photos,
  currentPhotoId: initialPhotoId,
  canEdit = true,
  onPinDataChanged,
  onPhotoChange,
}: {
  sessionId: number;
  photos: Photo[];
  currentPhotoId: number | null;
  canEdit?: boolean;
  onPinDataChanged?: () => void;
  onPhotoChange?: (photoId: number | null) => void;
}) {
  const { toast } = useToast();
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(initialPhotoId);
  const lastInitialPhotoIdRef = useRef(initialPhotoId);
  const [globalZoom, setGlobalZoom] = useState(() => loadGlobalZoom(sessionId));
  const [cards, setCards] = useState<PinCard[]>([]);
  const [phase, setPhase] = useState<"preview" | "results">("preview");
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (initialPhotoId && initialPhotoId !== lastInitialPhotoIdRef.current) {
      lastInitialPhotoIdRef.current = initialPhotoId;
      setSelectedPhotoId(initialPhotoId);
      setPhase("preview");
      setCards([]);
    }
  }, [initialPhotoId]);

  useEffect(() => {
    onPhotoChange?.(selectedPhotoId);
  }, [selectedPhotoId]);

  const [useCachedResults, setUseCachedResults] = useState(true);
  const currentPhotoId = selectedPhotoId;
  const photo = photos.find((p) => p.id === currentPhotoId) ?? null;
  const photoUrl = photo?.objectStorageKey
    ? (() => {
        const key = photo.objectStorageKey;
        if (key.startsWith("/uploads/")) return key;
        if (key.startsWith("/objects/")) return key;
        return `/uploads/${key}`;
      })()
    : null;

  const { data: allSessionPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", String(sessionId), "pins"],
  });

  const availablePhotos = useMemo(() => {
    return photos.filter((p) => {
      const photoPins = allSessionPins.filter((pin) => pin.photoId === p.id);
      if (photoPins.length === 0) return false;
      const hasDraftPins = photoPins.some((pin) => !pin.entryId);
      const hasIncompleteCommitted = photoPins.some((pin) => pin.entryId && (!pin.wireDetails || pin.footage == null));
      return hasDraftPins || hasIncompleteCommitted;
    });
  }, [photos, allSessionPins]);

  useEffect(() => {
    if (!currentPhotoId && availablePhotos.length > 0) {
      setSelectedPhotoId(availablePhotos[0].id);
    } else if (currentPhotoId && availablePhotos.length > 0 && !availablePhotos.some((p) => p.id === currentPhotoId)) {
      setSelectedPhotoId(availablePhotos[0].id);
      setPhase("preview");
      setCards([]);
    } else if (currentPhotoId && availablePhotos.length === 0) {
      setSelectedPhotoId(null);
      setPhase("preview");
      setCards([]);
    }
  }, [availablePhotos, currentPhotoId]);

  const { data: committedPins = [], isLoading: pinsLoading } = useQuery<Pin[]>({
    queryKey: ["/api/photos", String(currentPhotoId), "pins"],
    enabled: !!currentPhotoId,
  });

  const { data: cachedResults } = useQuery<{ results: AnalysisResult[] | null }>({
    queryKey: ["/api/photos", String(currentPhotoId), "label-cache"],
    enabled: !!currentPhotoId && useCachedResults,
  });

  const activePinsForPhoto = useMemo(() => {
    const draftPins = committedPins.filter((p) => !p.entryId);
    const incompleteCommitted = committedPins.filter((p) => p.entryId && (!p.wireDetails || p.footage == null));
    return [...draftPins, ...incompleteCommitted];
  }, [committedPins]);

  const isReceiving = useMemo(() => {
    if (!photo) return false;
    const a = (photo.aisle || "").toLowerCase();
    const s = (photo.section || "").toLowerCase();
    return a.includes("receiving") || s.includes("receiving");
  }, [photo]);

  const getPhotoUrl = useCallback((p: Photo | undefined | null): string | null => {
    if (!p?.objectStorageKey) return null;
    const key = p.objectStorageKey;
    if (key.startsWith("/uploads/") || key.startsWith("/objects/")) return key;
    return `/uploads/${key}`;
  }, []);

  const pooledPins = useMemo(() => {
    if (!isReceiving) return activePinsForPhoto;
    const MAX_POOLED = 9;
    const result: Pin[] = [...activePinsForPhoto];
    if (result.length >= MAX_POOLED) return result.slice(0, MAX_POOLED);
    const currentIds = new Set(result.map((p) => p.id));
    const receivingPhotos = availablePhotos.filter((p) => {
      if (p.id === currentPhotoId) return false;
      const a = (p.aisle || "").toLowerCase();
      const s = (p.section || "").toLowerCase();
      return a.includes("receiving") || s.includes("receiving");
    });
    for (const rp of receivingPhotos) {
      if (result.length >= MAX_POOLED) break;
      const rpPins = allSessionPins.filter((pin) => pin.photoId === rp.id);
      const rpActive = rpPins.filter((pin) => !pin.entryId || (pin.entryId && (!pin.wireDetails || pin.footage == null)));
      for (const pin of rpActive) {
        if (result.length >= MAX_POOLED) break;
        if (!currentIds.has(pin.id)) {
          result.push(pin);
          currentIds.add(pin.id);
        }
      }
    }
    return result;
  }, [isReceiving, activePinsForPhoto, availablePhotos, currentPhotoId, allSessionPins]);

  const effectivePins = isReceiving ? pooledPins : activePinsForPhoto;

  useEffect(() => {
    if (!effectivePins.length) {
      setCards([]);
      setPhase("preview");
      return;
    }

    setCards((prev) => {
      const existing = new Map(prev.map((c) => [c.pin.id, c]));
      const savedZooms = loadSavedZooms(sessionId);
      return effectivePins.map((pin) => {
        const ex = existing.get(pin.id);
        if (ex && ex.pin.id === pin.id) {
          return { ...ex, pin, isDraft: !pin.entryId };
        }
        const savedZoom = savedZooms[String(pin.id)];
        return {
          pin,
          zoomLevel: savedZoom ?? globalZoom,
          panX: 0,
          panY: 0,
          included: true,
          isDraft: !pin.entryId,
          editCatalog: "",
          editFootage: "",
          editVendor: "",
          catalogCode: "",
        };
      });
    });
  }, [effectivePins.map((p) => p.id).join(","), currentPhotoId, isReceiving]);

  const hasCachedResults = !!(cachedResults?.results);

  useEffect(() => {
    if (cachedResults?.results && phase === "preview" && useCachedResults) {
      applyResults(cachedResults.results);
    }
  }, [cachedResults]);

  function applyResults(results: AnalysisResult[]) {
    setCards((prev) =>
      prev.map((card) => {
        const result = results.find((r) => r.pinId === card.pin.id);
        if (!result) return card;
        const matchResult = result.rawText ? matchLabelText(result.rawText) : undefined;
        const parsed = matchResult?.match;
        return {
          ...card,
          result,
          matchResult,
          editCatalog: parsed?.catalog ?? "",
          editFootage: parsed?.footage ? String(parsed.footage) : "",
          editVendor: parsed?.vendor ?? "",
          catalogCode: parsed?.catalog ?? "",
        };
      })
    );
    setPhase("results");
  }

  const setCardZoom = (pinId: number, zoom: number) => {
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, zoomLevel: zoom, panX: 0, panY: 0 } : c))
    );
    saveZoomLevel(sessionId, pinId, zoom);
  };

  const setCardPan = (pinId: number, px: number, py: number) => {
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, panX: px, panY: py } : c))
    );
  };

  const setCardIncluded = (pinId: number, included: boolean) => {
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, included } : c))
    );
  };

  const setCardField = (pinId: number, field: "editCatalog" | "editVendor", value: string) => {
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, [field]: value } : c))
    );
  };

  const applyGlobalZoom = (zoom: number) => {
    setGlobalZoom(zoom);
    saveGlobalZoom(sessionId, zoom);
    setCards((prev) => {
      const updated = prev.map((c) => ({ ...c, zoomLevel: zoom, panX: 0, panY: 0 }));
      updated.forEach((c) => saveZoomLevel(sessionId, c.pin.id, zoom));
      return updated;
    });
  };

  const includedCards = cards.filter((c) => c.included);

  async function handleAnalyze() {
    if (!currentPhotoId || !includedCards.length) return;
    setAnalyzing(true);
    try {
      const byPhoto = new Map<number, typeof includedCards>();
      for (const c of includedCards) {
        const pid = c.pin.photoId;
        if (!byPhoto.has(pid)) byPhoto.set(pid, []);
        byPhoto.get(pid)!.push(c);
      }

      const allResults: AnalysisResult[] = [];
      for (const [photoId, photoCards] of byPhoto) {
        const pinData = photoCards.map((c) => ({
          pinId: c.pin.id,
          pinLabel: c.pin.label || `P${String(c.pin.id).padStart(3, "0")}`,
          x: c.pin.xPercent,
          y: c.pin.yPercent,
          zoomLevel: c.zoomLevel,
        }));
        const res = await apiRequest("POST", `/api/photos/${photoId}/analyze-labels`, { pins: pinData });
        const data = await res.json();
        if (data.results) allResults.push(...data.results);
      }
      if (allResults.length) {
        applyResults(allResults);
        toast({ title: "Analysis complete", description: `Read ${allResults.length} label(s)` });
      }
    } catch (error: any) {
      toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  }

  const retryRequest = async (method: string, url: string, body: any, retries = 2): Promise<any> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await apiRequest(method, url, body);
        try {
          return await res.json();
        } catch {
          return undefined;
        }
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  };

  const applyMutation = useMutation({
    mutationFn: async (cardsToApply: PinCard[]) => {
      const failures: string[] = [];
      const succeededPinIds: number[] = [];

      for (const card of cardsToApply) {
        if (!card.included) continue;
        const hasData = !!(card.result || card.editCatalog || card.editVendor);
        if (!hasData) continue;

        try {
          if (card.isDraft) {
            const cardPhoto = photos.find((p) => p.id === card.pin.photoId);
            const aisle = cardPhoto?.aisle || "";
            const section = cardPhoto?.section || "";
            const footage = card.editFootage ? (parseInt(card.editFootage) || null) : null;
            const reelCount = card.pin.reelCount ?? 1;
            const computedFootage = footage && reelCount > 1 ? footage * reelCount : footage;

            const entryData: Record<string, any> = {
              aisle,
              section,
              reelTag: card.editCatalog ? card.editCatalog.toUpperCase() : "",
              manufacturer: card.editVendor ? card.editVendor.toUpperCase() : "",
              footage: computedFootage,
              reelCount,
              photoId: card.pin.photoId,
            };
            if (card.matchResult?.match) {
              if (card.matchResult.match.wireType) entryData.wireType = card.matchResult.match.wireType;
              if (card.matchResult.match.wireSize) entryData.gauge = card.matchResult.match.wireSize;
              if (card.matchResult.match.color) entryData.color = card.matchResult.match.color;
              if (card.matchResult.match.conductors) entryData.conductors = card.matchResult.match.conductors;
            }

            const entry = await retryRequest("POST", `/api/sessions/${sessionId}/entries`, entryData);

            try {
              await retryRequest("POST", `/api/photos/${card.pin.photoId}/pins`, {
                xPercent: card.pin.xPercent,
                yPercent: card.pin.yPercent,
                label: card.pin.label,
                reelCount,
                entryId: entry.id,
                wireDetails: card.editCatalog ? card.editCatalog.toUpperCase() : undefined,
                vendorCode: card.editVendor ? card.editVendor.toUpperCase() : undefined,
                footage,
                flagged: card.pin.flagged || false,
              });
            } catch (pinErr) {
              try { await apiRequest("DELETE", `/api/entries/${entry.id}`); } catch {}
              throw pinErr;
            }

            const allPhotoPins = await (await fetch(`/api/photos/${card.pin.photoId}/pins`, { credentials: "include" })).json();
            const remainingDrafts = allPhotoPins.filter((p: Pin) => !p.entryId && p.id !== card.pin.id);
            await retryRequest("PUT", `/api/photos/${card.pin.photoId}/draft-pins`, {
              pins: remainingDrafts.map((p: Pin) => ({
                xPercent: p.xPercent,
                yPercent: p.yPercent,
                label: p.label,
                reelCount: p.reelCount ?? 1,
                wireDetails: p.wireDetails || "",
                vendorCode: p.vendorCode || "",
                footage: p.footage,
                flagged: p.flagged || false,
              })),
            });

            succeededPinIds.push(card.pin.id);
          } else {
            const updates: Record<string, any> = {};
            if (card.editCatalog) updates.wireDetails = card.editCatalog.toUpperCase();
            if (card.editVendor) updates.vendorCode = card.editVendor.toUpperCase();
            if (card.editFootage) updates.footage = parseInt(card.editFootage) || null;

            if (Object.keys(updates).length > 0) {
              await retryRequest("PATCH", `/api/pins/${card.pin.id}`, updates);

              if (card.pin.entryId) {
                const entryUpdates: Record<string, any> = {};
                if (card.editCatalog) entryUpdates.reelTag = card.editCatalog.toUpperCase();
                if (card.editVendor) entryUpdates.manufacturer = card.editVendor.toUpperCase();
                if (card.editFootage) entryUpdates.footage = parseInt(card.editFootage) || null;
                entryUpdates.reelCount = card.pin.reelCount ?? 1;
                if (card.matchResult?.match) {
                  if (card.matchResult.match.wireType) entryUpdates.wireType = card.matchResult.match.wireType;
                  if (card.matchResult.match.wireSize) entryUpdates.gauge = card.matchResult.match.wireSize;
                  if (card.matchResult.match.color) entryUpdates.color = card.matchResult.match.color;
                  if (card.matchResult.match.conductors) entryUpdates.conductors = card.matchResult.match.conductors;
                }
                if (Object.keys(entryUpdates).length > 0) {
                  await retryRequest("PATCH", `/api/entries/${card.pin.entryId}`, entryUpdates);
                }
              }
              succeededPinIds.push(card.pin.id);
            }
          }
        } catch (err: any) {
          failures.push(card.pin.label || `Pin ${card.pin.id}`);
        }
      }
      return { successCount: succeededPinIds.length, failures, succeededPinIds };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/photos", String(currentPhotoId), "pins"] });
      if (isReceiving) {
        const involvedPhotoIds = new Set(cards.map((c) => c.pin.photoId));
        involvedPhotoIds.forEach((pid) => {
          if (pid !== currentPhotoId) {
            queryClient.invalidateQueries({ queryKey: ["/api/photos", String(pid), "pins"] });
          }
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(sessionId), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(sessionId), "entries"] });
      onPinDataChanged?.();
      if (data.failures.length > 0) {
        toast({
          title: `Applied ${data.successCount} of ${data.successCount + data.failures.length}`,
          description: `Failed: ${data.failures.join(", ")}`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Applied", description: `Updated ${data.successCount} pin(s) successfully` });
      }
      const successSet = new Set(data.succeededPinIds);
      setCards((prev) => {
        const remaining = prev.filter((c) => !successSet.has(c.pin.id));
        if (remaining.length === 0) {
          setPhase("preview");
        }
        return remaining;
      });
    },
    onError: (error: any) => {
      toast({ title: "Apply failed", description: error.message, variant: "destructive" });
    },
  });

  const photoSelector = (
    <div className="flex items-center gap-2 bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_13%)] rounded-lg p-3 border border-[hsl(18_60%_30%/0.2)]">
      <ScanLine className="h-5 w-5 text-[hsl(18_85%_55%)]" />
      <span className="font-semibold text-white text-sm">AI Scanner</span>
      <Select
        value={currentPhotoId ? String(currentPhotoId) : ""}
        onValueChange={(v) => {
          setSelectedPhotoId(parseInt(v));
          setPhase("preview");
          setCards([]);
        }}
      >
        <SelectTrigger className="w-[300px] h-7 text-xs bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.3)] text-white" data-testid="select-scanner-photo">
          <SelectValue placeholder="Select a photo..." />
        </SelectTrigger>
        <SelectContent>
          {availablePhotos.map((p, idx) => (
            <SelectItem key={p.id} value={String(p.id)}>
              Photo {idx + 1}{p.aisle ? ` — ${p.aisle}` : ""}{p.section ? ` / ${p.section}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  if (!availablePhotos.length) {
    return (
      <div className="space-y-4" data-testid="scanner-no-photos">
        {photoSelector}
        <div className="p-6 text-center text-muted-foreground">
          <ScanLine className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>{photos.length > 0 ? "All photos have been fully scanned and applied." : "No photos in this session yet. Upload photos in the Section Photo tab first."}</p>
        </div>
      </div>
    );
  }

  if (!photo || !currentPhotoId) {
    return (
      <div className="space-y-4" data-testid="scanner-no-photo">
        {photoSelector}
        <div className="p-6 text-center text-muted-foreground">
          <ScanLine className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Select a photo above to scan its labels.</p>
        </div>
      </div>
    );
  }

  if (pinsLoading) {
    return (
      <div className="space-y-4" data-testid="scanner-loading">
        {photoSelector}
        <div className="p-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          <p className="text-muted-foreground">Loading pins...</p>
        </div>
      </div>
    );
  }

  if (!effectivePins.length) {
    const idx = availablePhotos.findIndex((p) => p.id === currentPhotoId);
    const next = idx >= 0 && idx < availablePhotos.length - 1 ? availablePhotos[idx + 1] : null;
    return (
      <div className="space-y-4" data-testid="scanner-no-pins">
        {photoSelector}
        <div className="p-6 text-center text-muted-foreground">
          <ScanLine className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No active pins on this photo. Place pins in the Section Photo tab to use the AI scanner.</p>
          {next && (
            <Button
              size="sm"
              onClick={() => { setSelectedPhotoId(next.id); setPhase("preview"); setCards([]); }}
              className="mt-3 bg-[hsl(30_90%_45%)] text-white border border-[hsl(30_90%_35%)]"
              data-testid="btn-next-photo-no-pins"
            >
              <AlertCircle className="h-3.5 w-3.5 mr-1" />
              <span className="text-xs font-semibold">Next Photo ({availablePhotos.length - idx - 1})</span>
            </Button>
          )}
        </div>
      </div>
    );
  }

  const selectedForApply = cards.filter((c) => c.included && (c.result || c.editCatalog || c.editVendor));

  const currentPhotoIndex = availablePhotos.findIndex((p) => p.id === currentPhotoId);
  const nextPhoto = currentPhotoIndex >= 0 && currentPhotoIndex < availablePhotos.length - 1
    ? availablePhotos[currentPhotoIndex + 1]
    : null;

  const advanceToNextPhoto = () => {
    if (nextPhoto) {
      setSelectedPhotoId(nextPhoto.id);
      setPhase("preview");
      setCards([]);
      setUseCachedResults(true);
    }
  };

  return (
    <div className="space-y-4" data-testid="label-scanner-tab">
      <div className="bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_13%)] rounded-lg p-3 border border-[hsl(18_60%_30%/0.2)] space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-[hsl(18_85%_55%)]" />
            <span className="font-semibold text-white text-sm">
              AI Scanner
            </span>
            <Select
              value={currentPhotoId ? String(currentPhotoId) : ""}
              onValueChange={(v) => {
                setSelectedPhotoId(parseInt(v));
                setPhase("preview");
                setCards([]);
              }}
            >
              <SelectTrigger className="w-[300px] h-7 text-xs bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.3)] text-white" data-testid="select-scanner-photo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availablePhotos.map((p, idx) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    Photo {idx + 1}{p.aisle ? ` — ${p.aisle}` : ""}{p.section ? ` / ${p.section}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-xs border-[hsl(18_60%_30%/0.4)] text-white/70">
              {effectivePins.length} active pin{effectivePins.length !== 1 ? "s" : ""}
            </Badge>
            {isReceiving && effectivePins.length > activePinsForPhoto.length && (
              <Badge className="text-[10px] bg-purple-900/50 text-purple-300 border-purple-700/40" data-testid="badge-receiving-pooled">
                Pooled from {new Set(effectivePins.map((p) => p.photoId)).size} photos
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 min-w-[160px]">
              <ZoomOut className="h-3.5 w-3.5 text-white/40 flex-shrink-0 cursor-pointer" onClick={() => applyGlobalZoom(Math.min(ZOOM_MAX, globalZoom + ZOOM_CLICK_STEP))} data-testid="btn-global-zoom-out" />
              <Slider
                value={[ZOOM_MAX - globalZoom + ZOOM_MIN]}
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={ZOOM_STEP}
                onValueChange={([v]) => applyGlobalZoom(ZOOM_MAX - v + ZOOM_MIN)}
                className="flex-1"
                data-testid="slider-global-zoom"
              />
              <ZoomIn className="h-3.5 w-3.5 text-white/40 flex-shrink-0 cursor-pointer" onClick={() => applyGlobalZoom(Math.max(ZOOM_MIN, globalZoom - ZOOM_CLICK_STEP))} data-testid="btn-global-zoom-in" />
              <span className="text-[10px] font-mono text-white/50 min-w-[32px] text-right">{zoomLabel(globalZoom)}</span>
            </div>
            {nextPhoto && (
              <Button
                size="sm"
                onClick={advanceToNextPhoto}
                className="bg-[hsl(30_90%_45%)] text-white border border-[hsl(30_90%_35%)]"
                data-testid="btn-next-photo"
              >
                <AlertCircle className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs font-semibold">Next Photo ({availablePhotos.length - currentPhotoIndex - 1})</span>
              </Button>
            )}
          </div>
        </div>
        {photo && (photo.aisle || photo.section) && (
          <div className="flex items-center gap-3 pl-7" data-testid="text-aisle-section">
            {photo.aisle && (
              <span className="text-base font-bold text-[hsl(18_85%_55%)] font-mono" data-testid="text-aisle">
                Aisle {photo.aisle}
              </span>
            )}
            {photo.aisle && photo.section && (
              <span className="text-white/30">/</span>
            )}
            {photo.section && (
              <span className="text-base font-bold text-white/80 font-mono" data-testid="text-section">
                Section {photo.section}
              </span>
            )}
          </div>
        )}
      </div>

      {includedCards.length > 20 && phase === "preview" && (
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/30 border border-yellow-700/40 rounded text-yellow-200 text-xs" data-testid="warning-batch-split">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{includedCards.length} pins selected — analysis will be split into {Math.ceil(includedCards.length / 20)} batches.</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((card) => {
          const hasFilled = !!(card.pin.wireDetails && card.pin.footage);
          const isFromOtherPhoto = card.pin.photoId !== currentPhotoId;
          const cardPhotoObj = isFromOtherPhoto ? photos.find((p) => p.id === card.pin.photoId) : photo;
          const cardPhotoUrl = isFromOtherPhoto ? getPhotoUrl(cardPhotoObj) : photoUrl;
          return (
            <div
              key={card.pin.id}
              className={`rounded-lg border p-3 space-y-2 transition-colors overflow-hidden ${
                card.included
                  ? "bg-[hsl(25_12%_16%)] border-[hsl(18_60%_30%/0.3)]"
                  : "bg-[hsl(25_8%_14%)] border-[hsl(18_20%_25%/0.2)] opacity-60"
              }`}
              data-testid={`card-pin-${card.pin.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <Checkbox
                    checked={card.included}
                    onCheckedChange={(v) => setCardIncluded(card.pin.id, !!v)}
                    data-testid={`checkbox-pin-${card.pin.id}`}
                  />
                  <span className="font-mono text-sm font-bold text-white">
                    {card.pin.label || `#${card.pin.id}`}
                  </span>
                  {card.isDraft && (
                    <Badge className="text-[10px] bg-blue-900/50 text-blue-300 border-blue-700/40" data-testid={`badge-draft-${card.pin.id}`}>
                      Draft
                    </Badge>
                  )}
                  {hasFilled && !card.isDraft && (
                    <Badge className="text-[10px] bg-green-900/50 text-green-300 border-green-700/40" data-testid={`badge-filled-${card.pin.id}`}>
                      Already filled
                    </Badge>
                  )}
                  {isFromOtherPhoto && cardPhotoObj && (
                    <Badge className="text-[10px] bg-purple-900/50 text-purple-300 border-purple-700/40" data-testid={`badge-pooled-${card.pin.id}`}>
                      {cardPhotoObj.aisle || ""}{cardPhotoObj.section ? ` / ${cardPhotoObj.section}` : ""}
                    </Badge>
                  )}
                </div>
              </div>

              {cardPhotoUrl && (
                <div className="space-y-1.5">
                  <div className="flex justify-center">
                    <CropCanvas
                      photoUrl={cardPhotoUrl}
                      xPercent={card.pin.xPercent}
                      yPercent={card.pin.yPercent}
                      zoomLevel={card.zoomLevel}
                      panX={card.panX}
                      panY={card.panY}
                      onPan={(px, py) => setCardPan(card.pin.id, px, py)}
                      size={180}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 px-1">
                    <ZoomOut className="h-6 w-6 text-white/30 flex-shrink-0 cursor-pointer" onClick={() => setCardZoom(card.pin.id, Math.min(ZOOM_MAX, card.zoomLevel + ZOOM_CLICK_STEP))} data-testid={`btn-zoom-out-${card.pin.id}`} />
                    <Slider
                      value={[ZOOM_MAX - card.zoomLevel + ZOOM_MIN]}
                      min={ZOOM_MIN}
                      max={ZOOM_MAX}
                      step={ZOOM_STEP}
                      onValueChange={([v]) => setCardZoom(card.pin.id, ZOOM_MAX - v + ZOOM_MIN)}
                      className="flex-1"
                      data-testid={`slider-zoom-${card.pin.id}`}
                    />
                    <ZoomIn className="h-6 w-6 text-white/30 flex-shrink-0 cursor-pointer" onClick={() => setCardZoom(card.pin.id, Math.max(ZOOM_MIN, card.zoomLevel - ZOOM_CLICK_STEP))} data-testid={`btn-zoom-in-${card.pin.id}`} />
                  </div>
                </div>
              )}

              {card.result && phase === "results" && (
                <div className="space-y-2 pt-1 border-t border-[hsl(18_60%_30%/0.15)]" style={{ fontFamily: "'Times New Roman', serif", fontSize: "28px" }}>
                  {card.matchResult && card.matchResult.confidence !== "none" ? (
                    <div className={`rounded-md border px-2 py-1 ${
                      card.matchResult.confidence === "high"
                        ? "bg-green-900/50 border-green-700/40"
                        : card.matchResult.confidence === "medium"
                        ? "bg-amber-900/50 border-amber-700/40"
                        : "bg-red-900/50 border-red-700/40"
                    }`}>
                      <Input
                        value={card.editCatalog}
                        onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                        className={`border-0 bg-transparent uppercase p-0 h-auto ${
                          card.matchResult.confidence === "high" ? "text-green-300" : card.matchResult.confidence === "medium" ? "text-amber-300" : "text-red-300"
                        }`}
                        style={{ fontFamily: "'Times New Roman', serif", fontSize: "28px" }}
                        data-testid={`input-catalog-${card.pin.id}`}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] text-white/40">Category</label>
                      <Input
                        value={card.editCatalog}
                        onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                        className="bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.2)] text-white uppercase"
                        style={{ fontFamily: "'Times New Roman', serif", fontSize: "28px", height: "auto", padding: "4px 8px" }}
                        placeholder="Enter category..."
                        data-testid={`input-catalog-${card.pin.id}`}
                      />
                    </div>
                  )}

                  <div className="w-20">
                    <label className="text-[10px] text-white/40">Vendor</label>
                    <Input
                      value={card.editVendor}
                      onChange={(e) => setCardField(card.pin.id, "editVendor", e.target.value)}
                      className="bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.2)] text-white uppercase"
                      style={{ fontFamily: "'Times New Roman', serif", fontSize: "28px", height: "auto", padding: "4px 8px" }}
                      data-testid={`input-vendor-${card.pin.id}`}
                    />
                  </div>
                </div>
              )}

              {!card.result && phase === "results" && (
                <div className="space-y-2 pt-1 border-t border-[hsl(18_60%_30%/0.15)] overflow-hidden" style={{ fontFamily: "'Times New Roman', serif", fontSize: "28px" }}>
                  <Badge className="py-1 px-2 bg-zinc-800 text-zinc-400 border-zinc-700 text-wrap" style={{ fontFamily: "'Times New Roman', serif", fontSize: "14px" }} data-testid={`badge-manual-${card.pin.id}`}>
                    Not analyzed — enter manually
                  </Badge>
                  <div>
                    <label className="text-[10px] text-white/40">Category</label>
                    <Input
                      value={card.editCatalog}
                      onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                      className="bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.2)] text-white uppercase"
                      style={{ fontFamily: "'Times New Roman', serif", fontSize: "28px", height: "auto", padding: "4px 8px" }}
                      placeholder="Enter category..."
                      data-testid={`input-catalog-manual-${card.pin.id}`}
                    />
                  </div>
                  <div className="w-20">
                    <label className="text-[10px] text-white/40">Vendor</label>
                    <Input
                      value={card.editVendor}
                      onChange={(e) => setCardField(card.pin.id, "editVendor", e.target.value)}
                      className="bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.2)] text-white uppercase"
                      style={{ fontFamily: "'Times New Roman', serif", fontSize: "28px", height: "auto", padding: "4px 8px" }}
                      data-testid={`input-vendor-manual-${card.pin.id}`}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
        {phase === "preview" && (
          <Button
            onClick={handleAnalyze}
            disabled={analyzing || !includedCards.length || !canEdit}
            className="gap-2 bg-[hsl(18_85%_32%)] hover:bg-[hsl(18_85%_38%)] text-white"
            data-testid="btn-analyze-labels"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Analyze {includedCards.length} Label{includedCards.length !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        )}
        {phase === "results" && (
          <>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPhase("preview");
                  setUseCachedResults(false);
                  setCards((prev) => prev.map((c) => ({ ...c, result: undefined, matchResult: undefined, editCatalog: "", editFootage: "", editVendor: "", catalogCode: "" })));
                }}
                className="gap-2 border-[hsl(18_60%_30%/0.3)] text-white/70 hover:text-white"
                data-testid="btn-back-to-preview"
              >
                <X className="h-4 w-4" />
                Re-adjust & Re-run
              </Button>
            </div>
            <Button
              onClick={() => applyMutation.mutate(cards)}
              disabled={applyMutation.isPending || !selectedForApply.length}
              className="gap-2 bg-green-800 hover:bg-green-700 text-white"
              data-testid="btn-apply-labels"
            >
              {applyMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Apply {selectedForApply.length} Selected
                </>
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
