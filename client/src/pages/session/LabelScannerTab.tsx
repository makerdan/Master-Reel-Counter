import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ScanLine, ZoomIn, ZoomOut, Loader2, Check, X, AlertTriangle, Sparkles,
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
const ZOOM_DEFAULT = 0.12;

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
  included: boolean;
  result?: AnalysisResult;
  matchResult?: LabelMatchResult;
  editCatalog: string;
  editFootage: string;
  editVendor: string;
}

function CropCanvas({
  photoUrl,
  xPercent,
  yPercent,
  zoomLevel,
  size = 180,
}: {
  photoUrl: string;
  xPercent: number;
  yPercent: number;
  zoomLevel: number;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.naturalWidth) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fraction = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel));
    const cropW = img.naturalWidth * fraction;
    const cropH = img.naturalHeight * fraction;

    const centerX = (xPercent / 100) * img.naturalWidth;
    const centerY = (yPercent / 100) * img.naturalHeight;

    let sx = centerX - cropW / 2;
    let sy = centerY - cropH / 2;
    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx + cropW > img.naturalWidth) sx = img.naturalWidth - cropW;
    if (sy + cropH > img.naturalHeight) sy = img.naturalHeight - cropH;

    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, size, size);
  }, [xPercent, yPercent, zoomLevel, size]);

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

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded border border-[hsl(18_60%_30%/0.3)] bg-black"
      style={{ width: size, height: size }}
      data-testid="canvas-crop-preview"
    />
  );
}

export default function LabelScannerTab({
  sessionId,
  photos,
  currentPhotoId: initialPhotoId,
  canEdit = true,
}: {
  sessionId: number;
  photos: Photo[];
  currentPhotoId: number | null;
  canEdit?: boolean;
}) {
  const { toast } = useToast();
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(initialPhotoId);
  const [globalZoom, setGlobalZoom] = useState(ZOOM_DEFAULT);
  const [cards, setCards] = useState<PinCard[]>([]);
  const [phase, setPhase] = useState<"preview" | "results">("preview");
  const [analyzing, setAnalyzing] = useState(false);

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

  const { data: committedPins = [], isLoading: pinsLoading } = useQuery<Pin[]>({
    queryKey: ["/api/photos", String(currentPhotoId), "pins"],
    enabled: !!currentPhotoId,
  });

  const { data: cachedResults } = useQuery<{ results: AnalysisResult[] | null }>({
    queryKey: ["/api/photos", String(currentPhotoId), "label-cache"],
    enabled: !!currentPhotoId && useCachedResults,
  });

  const onlyCommitted = committedPins.filter((p) => p.entryId);

  useEffect(() => {
    if (!onlyCommitted.length) {
      setCards([]);
      setPhase("preview");
      return;
    }

    setCards((prev) => {
      const existing = new Map(prev.map((c) => [c.pin.id, c]));
      return onlyCommitted.map((pin) => {
        const ex = existing.get(pin.id);
        if (ex && ex.pin.id === pin.id) {
          return { ...ex, pin };
        }
        const hasFilled = !!(pin.wireDetails && pin.footage);
        return {
          pin,
          zoomLevel: globalZoom,
          included: !hasFilled,
          editCatalog: "",
          editFootage: "",
          editVendor: "",
        };
      });
    });
  }, [onlyCommitted.length, currentPhotoId]);

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
        };
      })
    );
    setPhase("results");
  }

  const setCardZoom = (pinId: number, zoom: number) => {
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, zoomLevel: zoom } : c))
    );
  };

  const setCardIncluded = (pinId: number, included: boolean) => {
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, included } : c))
    );
  };

  const setCardField = (pinId: number, field: "editCatalog" | "editFootage" | "editVendor", value: string) => {
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, [field]: value } : c))
    );
  };

  const applyGlobalZoom = (zoom: number) => {
    setGlobalZoom(zoom);
    setCards((prev) => prev.map((c) => ({ ...c, zoomLevel: zoom })));
  };

  const includedCards = cards.filter((c) => c.included);

  async function handleAnalyze() {
    if (!currentPhotoId || !includedCards.length) return;
    setAnalyzing(true);
    try {
      const pinData = includedCards.map((c) => ({
        pinId: c.pin.id,
        pinLabel: c.pin.label || `P${String(c.pin.id).padStart(3, "0")}`,
        x: c.pin.xPercent,
        y: c.pin.yPercent,
        zoomLevel: c.zoomLevel,
      }));

      const res = await apiRequest("POST", `/api/photos/${currentPhotoId}/analyze-labels`, { pins: pinData });
      const data = await res.json();
      if (data.results) {
        applyResults(data.results);
        toast({ title: "Analysis complete", description: `Read ${data.results.length} label(s)` });
      }
    } catch (error: any) {
      toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  }

  const applyMutation = useMutation({
    mutationFn: async (cardsToApply: PinCard[]) => {
      const failures: string[] = [];
      let successCount = 0;

      for (const card of cardsToApply) {
        if (!card.result || !card.included) continue;
        const updates: Record<string, any> = {};
        if (card.editCatalog) updates.wireDetails = card.editCatalog;
        if (card.editVendor) updates.vendorCode = card.editVendor;
        if (card.editFootage) updates.footage = parseInt(card.editFootage) || null;

        if (Object.keys(updates).length > 0) {
          try {
            await apiRequest("PATCH", `/api/pins/${card.pin.id}`, updates);

            if (card.pin.entryId) {
              const entryUpdates: Record<string, any> = {};
              if (card.editCatalog) entryUpdates.reelTag = card.editCatalog;
              if (card.editVendor) entryUpdates.manufacturer = card.editVendor;
              if (card.editFootage) entryUpdates.footage = parseInt(card.editFootage) || null;
              if (card.matchResult?.match) {
                if (card.matchResult.match.wireType) entryUpdates.wireType = card.matchResult.match.wireType;
                if (card.matchResult.match.wireSize) entryUpdates.gauge = card.matchResult.match.wireSize;
                if (card.matchResult.match.color) entryUpdates.color = card.matchResult.match.color;
                if (card.matchResult.match.conductors) entryUpdates.conductors = card.matchResult.match.conductors;
              }
              if (Object.keys(entryUpdates).length > 0) {
                await apiRequest("PATCH", `/api/entries/${card.pin.entryId}`, entryUpdates);
              }
            }
            successCount++;
          } catch (err: any) {
            failures.push(card.pin.label || `Pin ${card.pin.id}`);
          }
        }
      }
      return { successCount, failures };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/photos", String(currentPhotoId), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(sessionId), "entries"] });
      if (data.failures.length > 0) {
        toast({
          title: `Applied ${data.successCount} of ${data.successCount + data.failures.length}`,
          description: `Failed: ${data.failures.join(", ")}`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Applied", description: `Updated ${data.successCount} pin(s) successfully` });
      }
      setPhase("preview");
      setCards((prev) => prev.map((c) => ({ ...c, result: undefined, matchResult: undefined, editCatalog: "", editFootage: "", editVendor: "" })));
    },
    onError: (error: any) => {
      toast({ title: "Apply failed", description: error.message, variant: "destructive" });
    },
  });

  const photoSelector = (
    <div className="flex items-center gap-2 bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_13%)] rounded-lg p-3 border border-[hsl(18_60%_30%/0.2)]">
      <ScanLine className="h-5 w-5 text-[hsl(18_85%_55%)]" />
      <span className="font-semibold text-white text-sm">Label Scanner</span>
      <Select
        value={currentPhotoId ? String(currentPhotoId) : ""}
        onValueChange={(v) => {
          setSelectedPhotoId(parseInt(v));
          setPhase("preview");
          setCards([]);
        }}
      >
        <SelectTrigger className="w-[200px] h-7 text-xs bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.3)] text-white" data-testid="select-scanner-photo">
          <SelectValue placeholder="Select a photo..." />
        </SelectTrigger>
        <SelectContent>
          {photos.map((p, idx) => (
            <SelectItem key={p.id} value={String(p.id)}>
              Photo {idx + 1}{p.aisle ? ` — ${p.aisle}` : ""}{p.section ? ` / ${p.section}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  if (!photos.length) {
    return (
      <div className="space-y-4" data-testid="scanner-no-photos">
        {photoSelector}
        <div className="p-6 text-center text-muted-foreground">
          <ScanLine className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No photos in this session yet. Upload photos in the Section Photo tab first.</p>
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

  if (!onlyCommitted.length) {
    return (
      <div className="space-y-4" data-testid="scanner-no-pins">
        {photoSelector}
        <div className="p-6 text-center text-muted-foreground">
          <ScanLine className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>No committed pins on this photo. Commit pins in the Section Photo tab to use the label scanner.</p>
        </div>
      </div>
    );
  }

  const selectedForApply = cards.filter((c) => c.included && c.result);

  return (
    <div className="space-y-4" data-testid="label-scanner-tab">
      <div className="flex items-center justify-between flex-wrap gap-2 bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_13%)] rounded-lg p-3 border border-[hsl(18_60%_30%/0.2)]">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-[hsl(18_85%_55%)]" />
          <span className="font-semibold text-white text-sm">
            Label Scanner
          </span>
          <Select
            value={currentPhotoId ? String(currentPhotoId) : ""}
            onValueChange={(v) => {
              setSelectedPhotoId(parseInt(v));
              setPhase("preview");
              setCards([]);
            }}
          >
            <SelectTrigger className="w-[160px] h-7 text-xs bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.3)] text-white" data-testid="select-scanner-photo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {photos.map((p, idx) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  Photo {idx + 1}{p.aisle ? ` — ${p.aisle}` : ""}{p.section ? ` / ${p.section}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="outline" className="text-xs border-[hsl(18_60%_30%/0.4)] text-white/70">
            {onlyCommitted.length} pin{onlyCommitted.length !== 1 ? "s" : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-2 min-w-[200px]">
          <ZoomOut className="h-3.5 w-3.5 text-white/40 flex-shrink-0" />
          <Slider
            value={[ZOOM_MAX - globalZoom + ZOOM_MIN]}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            onValueChange={([v]) => applyGlobalZoom(ZOOM_MAX - v + ZOOM_MIN)}
            className="flex-1"
            data-testid="slider-global-zoom"
          />
          <ZoomIn className="h-3.5 w-3.5 text-white/40 flex-shrink-0" />
          <span className="text-[10px] font-mono text-white/50 min-w-[32px] text-right">{zoomLabel(globalZoom)}</span>
        </div>
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
          return (
            <div
              key={card.pin.id}
              className={`rounded-lg border p-3 space-y-2 transition-colors ${
                card.included
                  ? "bg-[hsl(25_12%_16%)] border-[hsl(18_60%_30%/0.3)]"
                  : "bg-[hsl(25_8%_14%)] border-[hsl(18_20%_25%/0.2)] opacity-60"
              }`}
              data-testid={`card-pin-${card.pin.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={card.included}
                    onCheckedChange={(v) => setCardIncluded(card.pin.id, !!v)}
                    data-testid={`checkbox-pin-${card.pin.id}`}
                  />
                  <span className="font-mono text-sm font-bold text-white">
                    {card.pin.label || `#${card.pin.id}`}
                  </span>
                  {hasFilled && (
                    <Badge className="text-[10px] bg-green-900/50 text-green-300 border-green-700/40" data-testid={`badge-filled-${card.pin.id}`}>
                      Already filled
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] font-mono text-white/50 min-w-[28px] text-right">
                  {zoomLabel(card.zoomLevel)}
                </span>
              </div>

              {photoUrl && (
                <div className="space-y-1.5">
                  <div className="flex justify-center">
                    <CropCanvas
                      photoUrl={photoUrl}
                      xPercent={card.pin.xPercent}
                      yPercent={card.pin.yPercent}
                      zoomLevel={card.zoomLevel}
                      size={180}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 px-1">
                    <ZoomOut className="h-3 w-3 text-white/30 flex-shrink-0" />
                    <Slider
                      value={[ZOOM_MAX - card.zoomLevel + ZOOM_MIN]}
                      min={ZOOM_MIN}
                      max={ZOOM_MAX}
                      step={ZOOM_STEP}
                      onValueChange={([v]) => setCardZoom(card.pin.id, ZOOM_MAX - v + ZOOM_MIN)}
                      className="flex-1"
                      data-testid={`slider-zoom-${card.pin.id}`}
                    />
                    <ZoomIn className="h-3 w-3 text-white/30 flex-shrink-0" />
                  </div>
                </div>
              )}

              {card.result && phase === "results" && (
                <div className="space-y-2 pt-1 border-t border-[hsl(18_60%_30%/0.15)]">
                  <div>
                    <span className="text-[10px] uppercase text-white/40 tracking-wider">Raw text</span>
                    <p
                      className="text-sm font-mono text-amber-200 bg-[hsl(25_15%_12%)] rounded px-2 py-1 mt-0.5 break-words"
                      data-testid={`text-raw-${card.pin.id}`}
                    >
                      {card.result.readable ? card.result.rawText : <em className="text-red-400">Unreadable</em>}
                    </p>
                  </div>

                  {card.matchResult && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] uppercase text-white/40 tracking-wider">Match:</span>
                        {card.matchResult.confidence !== "none" ? (
                          <>
                            <Badge
                              className={`text-[10px] ${
                                card.matchResult.confidence === "high"
                                  ? "bg-green-900/50 text-green-300 border-green-700/40"
                                  : card.matchResult.confidence === "medium"
                                  ? "bg-amber-900/50 text-amber-300 border-amber-700/40"
                                  : "bg-red-900/50 text-red-300 border-red-700/40"
                              }`}
                              data-testid={`badge-match-${card.pin.id}`}
                            >
                              {card.matchResult.match?.catalog} ({card.matchResult.confidence})
                            </Badge>
                            <Badge
                              variant="outline"
                              className="text-[9px] border-white/15 text-white/40"
                              data-testid={`badge-method-${card.pin.id}`}
                            >
                              {card.matchResult.matchMethod}
                            </Badge>
                          </>
                        ) : (
                          <Badge className="text-[10px] bg-zinc-800 text-zinc-400 border-zinc-700" data-testid={`badge-no-match-${card.pin.id}`}>
                            No match
                          </Badge>
                        )}
                      </div>
                      {card.matchResult.match && (
                        <div className="space-y-0.5">
                          <p
                            className="text-[10px] text-white/50 leading-tight break-words"
                            data-testid={`text-description-${card.pin.id}`}
                          >
                            {card.matchResult.match.description}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {card.matchResult.match.wireType && (
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-[hsl(25_15%_18%)] text-amber-300/70" data-testid={`tag-wiretype-${card.pin.id}`}>
                                {card.matchResult.match.wireType}
                              </span>
                            )}
                            {card.matchResult.match.wireSize && (
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-[hsl(25_15%_18%)] text-amber-300/70" data-testid={`tag-wiresize-${card.pin.id}`}>
                                {card.matchResult.match.wireSize}
                              </span>
                            )}
                            {card.matchResult.match.color && (
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-[hsl(25_15%_18%)] text-amber-300/70" data-testid={`tag-color-${card.pin.id}`}>
                                {card.matchResult.match.color}
                              </span>
                            )}
                            {card.matchResult.match.footage && (
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-[hsl(25_15%_18%)] text-amber-300/70" data-testid={`tag-footage-${card.pin.id}`}>
                                {card.matchResult.match.footage}ft
                              </span>
                            )}
                            {card.matchResult.match.conductors && (
                              <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-[hsl(25_15%_18%)] text-amber-300/70" data-testid={`tag-conductors-${card.pin.id}`}>
                                {card.matchResult.match.conductors}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <label className="text-[10px] text-white/40">Catalog</label>
                      <Input
                        value={card.editCatalog}
                        onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                        className="h-7 text-xs font-mono bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.2)] text-white"
                        data-testid={`input-catalog-${card.pin.id}`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/40">Footage</label>
                      <Input
                        value={card.editFootage}
                        onChange={(e) => setCardField(card.pin.id, "editFootage", e.target.value)}
                        className="h-7 text-xs font-mono bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.2)] text-white"
                        data-testid={`input-footage-${card.pin.id}`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/40">Vendor</label>
                      <Input
                        value={card.editVendor}
                        onChange={(e) => setCardField(card.pin.id, "editVendor", e.target.value)}
                        className="h-7 text-xs font-mono bg-[hsl(25_12%_20%)] border-[hsl(18_60%_30%/0.2)] text-white"
                        data-testid={`input-vendor-${card.pin.id}`}
                      />
                    </div>
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
                  setCards((prev) => prev.map((c) => ({ ...c, result: undefined, matchResult: undefined, editCatalog: "", editFootage: "", editVendor: "" })));
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
