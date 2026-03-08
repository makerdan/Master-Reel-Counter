import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ScanLine, ZoomIn, ZoomOut, Loader2, Check, X, AlertTriangle, AlertCircle, Sparkles, Grid3X3, List, Flag,
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

function getSelectStorageKey(sessionId: number) {
  return `scanner-select-${sessionId}`;
}

function loadSavedSelections(sessionId: number): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(getSelectStorageKey(sessionId));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveSelectionState(sessionId: number, pinId: number, included: boolean) {
  try {
    const saved = loadSavedSelections(sessionId);
    saved[String(pinId)] = included;
    localStorage.setItem(getSelectStorageKey(sessionId), JSON.stringify(saved));
  } catch {}
}


function parseSortKey(catalog: string): { type: string; color: string; size: number; footage: number } {
  const s = (catalog || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^([A-Z]+?)(\d+)([A-Z]{2})(\d+)$/);
  if (m) return { type: m[1], color: m[3], size: parseInt(m[2]), footage: parseInt(m[4]) };
  const m2 = s.match(/^([A-Z]+?)(\d+)$/);
  if (m2) return { type: m2[1], color: "", size: parseInt(m2[2]), footage: 0 };
  return { type: s || "ZZZZ", color: "ZZ", size: 99999, footage: 99999 };
}

function getResultsStorageKey(sessionId: number) {
  return `scanner-results-${sessionId}`;
}

interface SavedCardResult {
  pinId: number;
  rawText: string | null;
  readable: boolean;
  editCatalog: string;
  editVendor: string;
  editFootage: string;
  confidence: string;
  timestamp: number;
}

function saveAnalysisResults(sessionId: number, cards: PinCard[]) {
  try {
    const data: SavedCardResult[] = cards
      .filter((c) => c.result)
      .map((c) => ({
        pinId: c.pin.id,
        rawText: c.result!.rawText,
        readable: c.result!.readable,
        editCatalog: c.editCatalog,
        editVendor: c.editVendor,
        editFootage: c.editFootage,
        confidence: c.matchResult?.confidence ?? "none",
        timestamp: Date.now(),
      }));
    localStorage.setItem(getResultsStorageKey(sessionId), JSON.stringify(data));
  } catch {}
}

function loadSavedResults(sessionId: number): SavedCardResult[] {
  try {
    const raw = localStorage.getItem(getResultsStorageKey(sessionId));
    if (!raw) return [];
    const data: SavedCardResult[] = JSON.parse(raw);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const valid = data.filter((d) => d.timestamp > cutoff);
    if (valid.length !== data.length) {
      localStorage.setItem(getResultsStorageKey(sessionId), JSON.stringify(valid));
    }
    return valid;
  } catch { return []; }
}


function computeSmartZoom(pinCount: number): number {
  if (pinCount <= 3) return 0.15;
  if (pinCount <= 6) return 0.12;
  return 0.08;
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
  _serverTs?: number;
}

const imageCache = new Map<string, HTMLImageElement>();
const IMAGE_CACHE_MAX = 20;

function getOrLoadImage(url: string): HTMLImageElement {
  const cached = imageCache.get(url);
  if (cached) {
    imageCache.delete(url);
    imageCache.set(url, cached);
    return cached;
  }
  if (imageCache.size >= IMAGE_CACHE_MAX) {
    const oldest = imageCache.keys().next().value;
    if (oldest) imageCache.delete(oldest);
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onerror = () => { imageCache.delete(url); };
  img.src = url;
  imageCache.set(url, img);
  return img;
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
    const img = getOrLoadImage(photoUrl);
    imgRef.current = img;
    if (img.complete && img.naturalWidth) {
      draw();
    } else {
      const onLoad = () => { draw(); };
      img.addEventListener("load", onLoad);
      return () => { img.removeEventListener("load", onLoad); };
    }
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
  const [cards, setCards] = useState<PinCard[]>([]);
  const [phase, setPhase] = useState<"preview" | "results">("preview");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchMode, setBatchMode] = useState(false);

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

  const { data: serverScanResults = [] } = useQuery<Array<{
    id: number; sessionId: number; photoId: number; pinId: number;
    pinLabel: string | null; rawText: string | null; readable: boolean | null;
    scannedBy: string | null; createdAt: string; updatedAt: string;
  }>>({
    queryKey: ["/api/sessions", String(sessionId), "scan-results"],
  });

  const activePinsForPhoto = useMemo(() => {
    const committedKeys = new Set(
      committedPins
        .filter((p) => p.entryId)
        .map((p) => `${p.xPercent.toFixed(5)}_${p.yPercent.toFixed(5)}_${p.label}`)
    );
    const draftPins = committedPins.filter((p) => {
      if (p.entryId) return false;
      const key = `${p.xPercent.toFixed(5)}_${p.yPercent.toFixed(5)}_${p.label}`;
      return !committedKeys.has(key);
    });
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
      const rpCommittedKeys = new Set(
        rpPins.filter((p) => p.entryId).map((p) => `${p.xPercent.toFixed(5)}_${p.yPercent.toFixed(5)}_${p.label}`)
      );
      const rpActive = rpPins.filter((pin) => {
        if (pin.entryId) return !pin.wireDetails || pin.footage == null;
        const ck = `${pin.xPercent.toFixed(5)}_${pin.yPercent.toFixed(5)}_${pin.label}`;
        return !rpCommittedKeys.has(ck);
      });
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

  const allSessionActivePins = useMemo(() => {
    const byPhoto = new Map<number, Pin[]>();
    for (const pin of allSessionPins) {
      if (!byPhoto.has(pin.photoId)) byPhoto.set(pin.photoId, []);
      byPhoto.get(pin.photoId)!.push(pin);
    }
    const result: Pin[] = [];
    for (const [, photoPins] of byPhoto) {
      const committedKeys = new Set(
        photoPins.filter((p) => p.entryId).map((p) => `${p.xPercent.toFixed(5)}_${p.yPercent.toFixed(5)}_${p.label}`)
      );
      for (const pin of photoPins) {
        if (pin.entryId) {
          if (!pin.wireDetails || pin.footage == null) {
            result.push(pin);
          }
        } else {
          const key = `${pin.xPercent.toFixed(5)}_${pin.yPercent.toFixed(5)}_${pin.label}`;
          if (!committedKeys.has(key)) {
            result.push(pin);
          }
        }
      }
    }
    return result;
  }, [allSessionPins]);

  const effectivePins = batchMode
    ? allSessionActivePins
    : isReceiving ? pooledPins : activePinsForPhoto;

  useEffect(() => {
    if (photoUrl) getOrLoadImage(photoUrl);
    const crossPhotoPins = batchMode ? allSessionActivePins : (isReceiving && pooledPins.length > 0 ? pooledPins : []);
    if (crossPhotoPins.length > 0) {
      const otherPhotoIds = new Set(crossPhotoPins.map((p) => p.photoId));
      otherPhotoIds.delete(currentPhotoId!);
      for (const pid of otherPhotoIds) {
        const p = photos.find((ph) => ph.id === pid);
        const url = getPhotoUrl(p);
        if (url) getOrLoadImage(url);
      }
    }
  }, [photoUrl, batchMode, isReceiving, pooledPins, allSessionActivePins, currentPhotoId, photos, getPhotoUrl]);

  const serverScanResultsKey = useMemo(() => {
    return serverScanResults.map((r) => `${r.pinId}:${r.updatedAt || r.createdAt}`).join(",");
  }, [serverScanResults]);

  useEffect(() => {
    if (!effectivePins.length) {
      setCards([]);
      setPhase("preview");
      return;
    }

    const serverResultsMap = new Map(serverScanResults.map((r) => [r.pinId, r]));

    setCards((prev) => {
      const existing = new Map(prev.map((c) => [c.pin.id, c]));
      const savedZooms = loadSavedZooms(sessionId);
      const savedSelections = loadSavedSelections(sessionId);
      const localResults = loadSavedResults(sessionId);
      const localResultsMap = new Map(localResults.map((r) => [r.pinId, r]));
      const pinCountByPhoto = new Map<number, number>();
      for (const p of effectivePins) {
        pinCountByPhoto.set(p.photoId, (pinCountByPhoto.get(p.photoId) || 0) + 1);
      }

      function buildResultFromServer(sr: typeof serverScanResults[0], pin: Pin) {
        const matchResult = sr.rawText ? matchLabelText(sr.rawText) : undefined;
        const parsed = matchResult?.match;
        return {
          result: { pinId: pin.id, pinLabel: sr.pinLabel || pin.label || "", rawText: sr.rawText, readable: !!sr.readable } as AnalysisResult,
          matchResult,
          editCatalog: parsed?.catalog ?? "",
          editFootage: parsed?.footage ? String(parsed.footage) : "",
          editVendor: parsed?.vendor ?? "",
        };
      }

      const built = effectivePins.map((pin) => {
        const sr = serverResultsMap.get(pin.id);
        const ex = existing.get(pin.id);
        if (ex && ex.pin.id === pin.id) {
          if (sr) {
            const serverTime = new Date(sr.updatedAt || sr.createdAt).getTime();
            const hasNewerServer = !ex.result || serverTime > (ex._serverTs ?? 0);
            if (hasNewerServer) {
              return { ...ex, pin, isDraft: !pin.entryId, _serverTs: serverTime, ...buildResultFromServer(sr, pin) };
            }
          }
          return { ...ex, pin, isDraft: !pin.entryId };
        }
        const savedZoom = savedZooms[String(pin.id)];
        const smartZoom = computeSmartZoom(pinCountByPhoto.get(pin.photoId) || 1);
        const savedIncluded = savedSelections[String(pin.id)];
        const base = { pin, zoomLevel: savedZoom ?? smartZoom, panX: 0, panY: 0, included: savedIncluded ?? true, isDraft: !pin.entryId };
        if (sr) {
          return { ...base, _serverTs: new Date(sr.updatedAt || sr.createdAt).getTime(), ...buildResultFromServer(sr, pin) };
        }
        const local = localResultsMap.get(pin.id);
        if (local && local.rawText !== null) {
          return {
            ...base,
            editCatalog: local.editCatalog ?? "",
            editFootage: local.editFootage ?? "",
            editVendor: local.editVendor ?? "",
            result: { pinId: pin.id, pinLabel: pin.label || "", rawText: local.rawText, readable: local.readable } as AnalysisResult,
            matchResult: local.rawText ? matchLabelText(local.rawText) : undefined,
          };
        }
        return { ...base, editCatalog: "", editFootage: "", editVendor: "" };
      });
      return built.some((c) => c.result) ? sortCardsByCatalog(built) : built;
    });
  }, [effectivePins.map((p) => p.id).join(","), currentPhotoId, isReceiving, batchMode, serverScanResultsKey]);

  const hasCachedResults = !!(cachedResults?.results);

  useEffect(() => {
    if (cachedResults?.results && phase === "preview" && useCachedResults) {
      applyResults(cachedResults.results);
    }
  }, [cachedResults]);

  const cardsWithResults = cards.filter((c) => c.result).length;
  useEffect(() => {
    if (phase === "preview" && cards.length > 0 && cardsWithResults > 0) {
      setPhase("results");
    }
  }, [cards.length, cardsWithResults, phase]);

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
      prev.map((c) => {
        if (c.pin.id !== pinId) return c;
        const oldFraction = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoomLevel));
        const newFraction = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
        const scale = newFraction / oldFraction;
        return { ...c, zoomLevel: zoom, panX: c.panX * scale, panY: c.panY * scale };
      })
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
    saveSelectionState(sessionId, pinId, included);
  };

  const setCardField = (pinId: number, field: "editCatalog" | "editVendor", value: string) => {
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, [field]: value } : c))
    );
  };

  const includedCards = cards.filter((c) => c.included);

  const toggleFlag = useCallback(async (pinId: number) => {
    const card = cards.find((c) => c.pin.id === pinId);
    if (!card) return;
    const newFlagged = !card.pin.flagged;
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, pin: { ...c.pin, flagged: newFlagged } } : c))
    );
    try {
      await apiRequest("PATCH", `/api/pins/${pinId}/flag`, { flagged: newFlagged });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(sessionId), "pins"] });
    } catch {
      setCards((prev) =>
        prev.map((c) => (c.pin.id === pinId ? { ...c, pin: { ...c.pin, flagged: !newFlagged } } : c))
      );
    }
  }, [cards, sessionId]);

  function sortCardsByCatalog(cardsToSort: PinCard[]): PinCard[] {
    const freq = new Map<string, number>();
    for (const c of cardsToSort) {
      if (c.result && c.editCatalog) {
        const key = c.editCatalog.toUpperCase().trim();
        freq.set(key, (freq.get(key) || 0) + 1);
      }
    }

    const photoUserMap = new Map(photos.map((p) => [p.id, p.userId]));

    return [...cardsToSort].sort((a, b) => {
      const flagA = !!a.pin.flagged;
      const flagB = !!b.pin.flagged;
      if (flagA !== flagB) return flagA ? 1 : -1;
      if (flagA && flagB) {
        const userA = photoUserMap.get(a.pin.photoId) || "";
        const userB = photoUserMap.get(b.pin.photoId) || "";
        if (userA !== userB) return userA.localeCompare(userB);
      }

      const hasA = !!(a.result && a.editCatalog);
      const hasB = !!(b.result && b.editCatalog);
      if (hasA !== hasB) return hasA ? -1 : 1;
      if (!hasA) return 0;

      const freqA = freq.get(a.editCatalog.toUpperCase().trim()) || 0;
      const freqB = freq.get(b.editCatalog.toUpperCase().trim()) || 0;
      if (freqA !== freqB) return freqB - freqA;

      const ka = parseSortKey(a.editCatalog);
      const kb = parseSortKey(b.editCatalog);
      if (ka.type !== kb.type) return ka.type.localeCompare(kb.type);
      if (ka.color !== kb.color) return ka.color.localeCompare(kb.color);
      if (ka.size !== kb.size) return ka.size - kb.size;
      return ka.footage - kb.footage;
    });
  }

  async function handleAnalyze() {
    if ((!currentPhotoId && !batchMode) || !includedCards.length) return;
    setAnalyzing(true);
    try {
      const byPhoto = new Map<number, typeof includedCards>();
      for (const c of includedCards) {
        const pid = c.pin.photoId;
        if (!byPhoto.has(pid)) byPhoto.set(pid, []);
        byPhoto.get(pid)!.push(c);
      }

      const totalBatches = byPhoto.size;
      let doneBatches = 0;
      setAnalyzeProgress({ done: 0, total: totalBatches });
      let totalResults = 0;

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
        if (data.results) {
          applyResults(data.results);
          totalResults += data.results.length;
        }
        doneBatches++;
        setAnalyzeProgress({ done: doneBatches, total: totalBatches });
      }

      if (totalResults > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(sessionId), "scan-results"] });
        setCards((prev) => {
          const sorted = sortCardsByCatalog(prev);
          saveAnalysisResults(sessionId, sorted);
          const updated = sorted.map((c) => {
            if (c.result?.rawText && !c.editCatalog.trim() && !c.editVendor.trim()) {
              saveSelectionState(sessionId, c.pin.id, false);
              return { ...c, included: false };
            }
            return c;
          });
          return updated;
        });
        toast({ title: "Analysis complete", description: `Read ${totalResults} label(s)` });
      }
    } catch (error: any) {
      toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
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
      const draftSuccessByPhoto = new Map<number, Set<string>>();

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

            const pinKey = `${card.pin.xPercent.toFixed(5)}_${card.pin.yPercent.toFixed(5)}_${card.pin.label}`;
            if (!draftSuccessByPhoto.has(card.pin.photoId)) draftSuccessByPhoto.set(card.pin.photoId, new Set());
            draftSuccessByPhoto.get(card.pin.photoId)!.add(pinKey);

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

      for (const [photoId, succeededKeys] of draftSuccessByPhoto) {
        try {
          const allPhotoPins = await (await fetch(`/api/photos/${photoId}/pins`, { credentials: "include" })).json();
          const remainingDrafts = allPhotoPins.filter((p: Pin) => {
            if (p.entryId) return false;
            const pinKey = `${p.xPercent.toFixed(5)}_${p.yPercent.toFixed(5)}_${p.label}`;
            return !succeededKeys.has(pinKey);
          });
          await retryRequest("PUT", `/api/photos/${photoId}/draft-pins`, {
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
        } catch {}
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
        return remaining.map((c) => ({ ...c, included: false }));
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
      {!batchMode && (
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
      )}
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

  if (!batchMode && (!photo || !currentPhotoId)) {
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

  if (!batchMode && pinsLoading) {
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
            {!batchMode && (
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
            )}
            <Badge variant="outline" className="text-xs border-[hsl(18_60%_30%/0.4)] text-white/70">
              {effectivePins.length} active pin{effectivePins.length !== 1 ? "s" : ""}
            </Badge>
            {isReceiving && effectivePins.length > activePinsForPhoto.length && (
              <Badge className="text-[10px] bg-purple-900/50 text-purple-300 border-purple-700/40" data-testid="badge-receiving-pooled">
                Pooled from {new Set(effectivePins.map((p) => p.photoId)).size} photos
              </Badge>
            )}
          </div>
          {!batchMode && nextPhoto && (
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
        {phase === "preview" && (
          <div className="pt-1 flex justify-end">
            <Button
              size="sm"
              onClick={handleAnalyze}
              disabled={analyzing || !includedCards.length || !canEdit}
              className="gap-2 bg-[hsl(18_85%_32%)] hover:bg-[hsl(18_85%_38%)] text-white"
              data-testid="btn-analyze-labels"
            >
              {analyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {analyzeProgress
                    ? `Batch ${analyzeProgress.done}/${analyzeProgress.total}...`
                    : "Analyzing..."}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Analyze {includedCards.length} Label{includedCards.length !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
        )}
        {!batchMode && photo && (photo.aisle || photo.section) && (
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

      <div className="flex items-center gap-2" data-testid="batch-mode-toggle-row">
        <div className="flex rounded-md border border-[hsl(18_60%_30%/0.3)] overflow-hidden">
          <button
            onClick={() => setBatchMode(false)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              !batchMode
                ? "bg-[hsl(18_85%_32%)] text-white"
                : "bg-[hsl(25_12%_18%)] text-white/50 hover:text-white/70"
            }`}
            data-testid="btn-mode-single"
          >
            <List className="h-3.5 w-3.5" />
            Single Photo
          </button>
          <button
            onClick={() => setBatchMode(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              batchMode
                ? "bg-[hsl(18_85%_32%)] text-white"
                : "bg-[hsl(25_12%_18%)] text-white/50 hover:text-white/70"
            }`}
            data-testid="btn-mode-batch"
          >
            <Grid3X3 className="h-3.5 w-3.5" />
            All Photos
            {batchMode && allSessionActivePins.length > 0 && (
              <Badge className="text-[9px] bg-white/15 text-white/80 border-0 py-0 px-1.5 ml-0.5">{allSessionActivePins.length} pins</Badge>
            )}
          </button>
        </div>
        {phase === "results" && (
          <Badge className="text-[10px] bg-[hsl(25_30%_20%)] text-white/50 border-[hsl(18_30%_30%/0.3)]">
            Sorted by type / size / color
          </Badge>
        )}
      </div>

      {includedCards.length > 20 && phase === "preview" && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[hsl(0_0%_5%)] border border-[hsl(18_60%_30%/0.4)] rounded text-[hsl(18_85%_55%)] text-xs" data-testid="warning-batch-split">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{includedCards.length} pins selected — analysis will be split into {Math.ceil(includedCards.length / 20)} batches.</span>
        </div>
      )}

      {batchMode && phase === "preview" && cards.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(25_12%_20%)] border border-[hsl(18_60%_30%/0.2)] rounded text-white/60 text-xs" data-testid="batch-summary-note">
          <Grid3X3 className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{cards.length} pin{cards.length !== 1 ? "s" : ""} across {new Set(cards.map((c) => c.pin.photoId)).size} photo{new Set(cards.map((c) => c.pin.photoId)).size !== 1 ? "s" : ""}</span>
        </div>
      )}

      <div className={`grid gap-3 ${
        batchMode && phase === "preview"
          ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      }`}>
        {cards.map((card) => {
          const hasFilled = !!(card.pin.wireDetails && card.pin.footage);
          const isFromOtherPhoto = card.pin.photoId !== currentPhotoId;
          const cardPhotoObj = isFromOtherPhoto ? photos.find((p) => p.id === card.pin.photoId) : photo;
          const batchPhotoObj = batchMode ? photos.find((p) => p.id === card.pin.photoId) || photo : null;
          const cardPhotoUrl = (batchMode || isFromOtherPhoto) ? getPhotoUrl(batchPhotoObj || cardPhotoObj) : photoUrl;
          const isBatch = batchMode && phase === "preview";
          return (
            <div
              key={card.pin.id}
              className={`rounded-lg border ${isBatch ? "p-2 space-y-1" : "p-3 space-y-2"} transition-colors overflow-hidden ${
                card.included
                  ? "bg-[hsl(25_12%_16%)] border-[hsl(18_60%_30%/0.3)]"
                  : "bg-[hsl(25_8%_14%)] border-[hsl(18_20%_25%/0.2)] opacity-60"
              }`}
              data-testid={`card-pin-${card.pin.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Checkbox
                    checked={card.included}
                    onCheckedChange={(v) => setCardIncluded(card.pin.id, !!v)}
                    data-testid={`checkbox-pin-${card.pin.id}`}
                  />
                  <span className={`font-mono font-bold text-white ${isBatch ? "text-xs" : "text-sm"}`}>
                    {card.pin.label || `#${card.pin.id}`}
                  </span>
                  <button
                    onClick={() => toggleFlag(card.pin.id)}
                    className={`p-0.5 rounded transition-colors ${
                      card.pin.flagged
                        ? "text-amber-400 hover:text-amber-300"
                        : "text-white/20 hover:text-white/40"
                    }`}
                    title={card.pin.flagged ? "Remove flag" : "Flag for review"}
                    data-testid={`btn-flag-${card.pin.id}`}
                  >
                    <Flag className={`${isBatch ? "h-3 w-3" : "h-3.5 w-3.5"} ${card.pin.flagged ? "fill-amber-400" : ""}`} />
                  </button>
                  {!isBatch && card.isDraft && (
                    <Badge className="text-[10px] bg-blue-900/50 text-blue-300 border-blue-700/40" data-testid={`badge-draft-${card.pin.id}`}>
                      Draft
                    </Badge>
                  )}
                  {!isBatch && hasFilled && !card.isDraft && (
                    <Badge className="text-[10px] bg-green-900/50 text-green-300 border-green-700/40" data-testid={`badge-filled-${card.pin.id}`}>
                      Already filled
                    </Badge>
                  )}
                  {!isBatch && isFromOtherPhoto && cardPhotoObj && (
                    <Badge className="text-[10px] bg-purple-900/50 text-purple-300 border-purple-700/40" data-testid={`badge-pooled-${card.pin.id}`}>
                      {cardPhotoObj.aisle || ""}{cardPhotoObj.section ? ` / ${cardPhotoObj.section}` : ""}
                    </Badge>
                  )}
                  {isBatch && batchPhotoObj && (
                    <Badge className="text-[9px] bg-[hsl(25_30%_25%)] text-white/50 border-[hsl(18_30%_30%/0.3)] py-0 px-1" data-testid={`badge-batch-source-${card.pin.id}`}>
                      {batchPhotoObj.aisle || "?"}{batchPhotoObj.section ? `/${batchPhotoObj.section}` : ""}
                    </Badge>
                  )}
                </div>
              </div>

              {cardPhotoUrl && (
                <div className={isBatch ? "space-y-1" : "space-y-1.5"}>
                  <div className="flex justify-center">
                    <CropCanvas
                      photoUrl={cardPhotoUrl}
                      xPercent={card.pin.xPercent}
                      yPercent={card.pin.yPercent}
                      zoomLevel={card.zoomLevel}
                      panX={card.panX}
                      panY={card.panY}
                      onPan={(px, py) => setCardPan(card.pin.id, px, py)}
                      size={isBatch ? 200 : 180}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 px-1">
                    <ZoomOut className={`${isBatch ? "h-4 w-4" : "h-6 w-6"} text-white/30 flex-shrink-0 cursor-pointer`} onClick={() => setCardZoom(card.pin.id, Math.min(ZOOM_MAX, card.zoomLevel + ZOOM_CLICK_STEP))} data-testid={`btn-zoom-out-${card.pin.id}`} />
                    <Slider
                      value={[ZOOM_MAX - card.zoomLevel + ZOOM_MIN]}
                      min={ZOOM_MIN}
                      max={ZOOM_MAX}
                      step={ZOOM_STEP}
                      onValueChange={([v]) => setCardZoom(card.pin.id, ZOOM_MAX - v + ZOOM_MIN)}
                      className="flex-1"
                      data-testid={`slider-zoom-${card.pin.id}`}
                    />
                    <ZoomIn className={`${isBatch ? "h-4 w-4" : "h-6 w-6"} text-white/30 flex-shrink-0 cursor-pointer`} onClick={() => setCardZoom(card.pin.id, Math.max(ZOOM_MIN, card.zoomLevel - ZOOM_CLICK_STEP))} data-testid={`btn-zoom-in-${card.pin.id}`} />
                  </div>
                </div>
              )}

              {card.result && phase === "results" && (
                <div className="space-y-2 pt-1 border-t border-[hsl(18_60%_30%/0.15)]" style={{ fontFamily: "'Times New Roman', serif", fontSize: "28px" }}>
                  <div className="rounded bg-black/30 px-2 py-1" data-testid={`raw-text-${card.pin.id}`}>
                    <span className="text-[10px] text-white/30 uppercase tracking-wider" style={{ fontFamily: "'JetBrains Mono', monospace" }}>AI Raw</span>
                    <p
                      className="text-[11px] text-white/50 break-words whitespace-pre-wrap"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {card.result.rawText ? card.result.rawText : <em className="text-white/30">unreadable</em>}
                    </p>
                  </div>
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
                      maxLength={3}
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
                      maxLength={3}
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
          <div className="flex w-full justify-end">
            <Button
              size="sm"
              onClick={handleAnalyze}
              disabled={analyzing || !includedCards.length || !canEdit}
              className="gap-2 bg-[hsl(18_85%_32%)] hover:bg-[hsl(18_85%_38%)] text-white"
              data-testid="btn-analyze-labels-bottom"
            >
              {analyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {analyzeProgress
                    ? `Batch ${analyzeProgress.done}/${analyzeProgress.total}...`
                    : "Analyzing..."}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Analyze {includedCards.length} Label{includedCards.length !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </div>
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
