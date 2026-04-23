import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { useSessionWebSocket } from "@/hooks/use-websocket";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ScanLine, ZoomIn, ZoomOut, Loader2, Check, X, AlertTriangle, AlertCircle, Sparkles, Grid3X3, List, Flag, Users, CheckCircle2, RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useVendorCodes } from "@/hooks/use-vendor-codes";
import { useWireCatalogs } from "@/hooks/use-wire-catalogs";
import { lookupCatalog, userWireCatalogToParsedEntry, type ParsedCatalogEntry } from "@/lib/wireReference";
import { matchLabelText, type LabelMatchResult } from "@/lib/labelMatcher";
import { toDisplayUnit, toBaseFeet } from "@/lib/unit-conversion";
import type { UnitType } from "@/lib/unit-conversion";
import { formatPinLabel } from "./utils";
import type { Photo, Pin } from "@shared/schema";

const ZOOM_MIN = 0.005;
const ZOOM_MAX = 1.0;
const ZOOM_STEP = 0.005;
const ZOOM_CLICK_STEP = 0.015;

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


function isIncompleteCard(card: { matchResult?: LabelMatchResult }): boolean {
  const match = card.matchResult?.match;
  if (!match) return false;
  return !match.wireType || !match.wireSize || !match.color;
}

function parseSortKey(catalog: string): { type: string; color: string; size: number; footage: number } {
  const s = (catalog || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = s.match(/^([A-Z]+?)(\d+)([A-Z]{2})(\d+)$/);
  if (m) return { type: m[1], color: m[3], size: parseInt(m[2]), footage: parseInt(m[4]) };
  const m2 = s.match(/^([A-Z]+?)(\d+)$/);
  if (m2) return { type: m2[1], color: "", size: parseInt(m2[2]), footage: 0 };
  return { type: s || "ZZZZ", color: "ZZ", size: 99999, footage: 99999 };
}

function measureTextWidth(text: string, fontSize: number, fontFamily: string): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = `600 ${fontSize}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

interface FitTextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  maxFontSize?: number;
  minFontSize?: number;
  fontFamily?: string;
  paddingH?: number;
  "data-testid"?: string;
}

function FitTextInput({
  value,
  onChange,
  className,
  maxFontSize = 28,
  minFontSize = 11,
  fontFamily = "'Times New Roman', serif",
  paddingH = 16,
  ...props
}: FitTextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  const recalc = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const available = el.clientWidth - paddingH;
    if (available <= 0) return;
    const text = value || "";
    if (!text) { setFontSize(maxFontSize); return; }
    let low = minFontSize, high = maxFontSize, best = minFontSize;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (measureTextWidth(text, mid, fontFamily) <= available) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    setFontSize(best);
  }, [value, maxFontSize, minFontSize, fontFamily, paddingH]);

  useLayoutEffect(() => { recalc(); }, [recalc]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recalc());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recalc]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={onChange}
      className={className}
      style={{ fontSize: `${fontSize}px`, fontFamily, lineHeight: 1.2, fontWeight: 600 }}
      {...props}
    />
  );
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

type NotAnalyzedReason = "excluded" | "cancelled" | "failed" | "new";

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
  notAnalyzedReason?: NotAnalyzedReason;
  _serverTs?: number;
}

function notAnalyzedCopy(reason: NotAnalyzedReason | undefined): string {
  switch (reason) {
    case "excluded": return "Not sent — was excluded before analysis";
    case "cancelled": return "Cancelled before this photo was scanned";
    case "failed": return "Analysis failed — tap Retry";
    case "new":
    default: return "Not analyzed yet";
  }
}

function parseStatusFromError(err: unknown): number | null {
  if (!err || !(err instanceof Error) || typeof err.message !== "string") return null;
  const m = err.message.match(/^(\d{3})/);
  return m ? parseInt(m[1], 10) : null;
}

function isRetryableAnalyzeError(err: unknown): boolean {
  const status = parseStatusFromError(err);
  if (status === null) return true; // network/timeout/abort
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
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
      className="rounded border border-blue-600/30 bg-black"
      style={{ width: size, height: size, maxWidth: "100%", aspectRatio: "1", cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
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

type OnlineUser = { userId: string; username: string };

export default function LabelScannerTab({
  sessionId,
  photos,
  currentPhotoId: initialPhotoId,
  canEdit = true,
  isAdmin = false,
  onPinDataChanged,
  onPhotoChange,
  onlineUsers = [],
  pushUndo,
  onApplied,
  onBatchModeChange,
  onClose,
}: {
  sessionId: number;
  photos: Photo[];
  currentPhotoId: number | null;
  canEdit?: boolean;
  isAdmin?: boolean;
  onPinDataChanged?: () => void;
  onPhotoChange?: (photoId: number | null) => void;
  onlineUsers?: OnlineUser[];
  pushUndo?: (action: { type: string; sessionId: number; entityId: number; data: any; previousData?: any }) => void;
  onApplied?: (sectionKey: string) => void;
  onBatchModeChange?: (isBatchMode: boolean) => void;
  onClose?: () => void;
}) {
  const { toast } = useToast();
  const { allCodes: vendorCodes } = useVendorCodes();
  const { catalogs: userCatalogs } = useWireCatalogs();
  const userParsedCatalog = useMemo<ParsedCatalogEntry[]>(
    () => (userCatalogs ?? []).map(userWireCatalogToParsedEntry),
    [userCatalogs]
  );
  const { data: scannerSettings } = useQuery<{ defaultUnit: string }>({
    queryKey: ["/api/settings"],
    select: (data: any) => ({ defaultUnit: data?.defaultUnit ?? "feet" }),
  });
  const currentUnit: UnitType = (scannerSettings?.defaultUnit as UnitType) || "feet";
  const [selectedPhotoId, setSelectedPhotoId] = useState<number | null>(initialPhotoId);
  const lastInitialPhotoIdRef = useRef(initialPhotoId);
  const [cards, setCards] = useState<PinCard[]>([]);
  const [phase, setPhase] = useState<"preview" | "results">("preview");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const analyzingRef = useRef(false);
  const cancelRequested = useRef(false);
  useEffect(() => { analyzingRef.current = analyzing; }, [analyzing]);
  useSessionWebSocket(analyzing ? sessionId : null, useCallback((msg: any) => {
    if (msg.type === "label_progress" && analyzingRef.current) {
      setAnalyzeProgress({ done: msg.done, total: msg.total });
    }
  }, []));
  const [batchMode, setBatchModeRaw] = useState(() => {
    try {
      const saved = sessionStorage.getItem(`scanner-batch-${sessionId}`);
      return saved === "true";
    } catch { return false; }
  });
  const setBatchMode = useCallback((v: boolean) => {
    setBatchModeRaw(v);
    try { sessionStorage.setItem(`scanner-batch-${sessionId}`, String(v)); } catch {}
    onBatchModeChange?.(v);
  }, [sessionId, onBatchModeChange]);
  const batchModeInitRef = useRef(batchMode || sessionStorage.getItem(`scanner-batch-${sessionId}`) !== null);
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
  const [flagPopoverPinId, setFlagPopoverPinId] = useState<number | null>(null);
  const [flagReasonDraft, setFlagReasonDraft] = useState("");
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
      if (!batchMode) {
        setPhase("preview");
        setCards([]);
      }
    } else if (currentPhotoId && availablePhotos.length === 0) {
      setSelectedPhotoId(null);
      if (!batchMode) {
        setPhase("preview");
        setCards([]);
      }
    }
  }, [availablePhotos, currentPhotoId, batchMode]);


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

  useEffect(() => {
    if (!batchModeInitRef.current && serverScanResults.length > 0) {
      batchModeInitRef.current = true;
      setBatchMode(true);
    }
  }, [serverScanResults.length]);

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
        if (pin.flagged) continue;
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
      if (currentPhotoId) otherPhotoIds.delete(currentPhotoId);
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

  useLayoutEffect(() => {
    if (!batchMode && !isReceiving && currentPhotoId) {
      const stale = effectivePins.length > 0 && effectivePins.every((p) => p.photoId !== currentPhotoId);
      if (stale) {
        setCards([]);
        setPhase("preview");
        return;
      }
    }

    if (!effectivePins.length) {
      setCards([]);
      setPhase("preview");
      return;
    }

    const serverResultsMap = new Map(serverScanResults.map((r) => [r.pinId, r]));

    let builtHasResults = false;
    setCards((prev) => {
      const existing = new Map(prev.map((c) => [c.pin.id, c]));
      const stableKey = (p: { photoId: number; xPercent: number; yPercent: number; label: string | null }) =>
        `${p.photoId}|${p.xPercent.toFixed(5)}|${p.yPercent.toFixed(5)}|${p.label ?? ""}`;
      const existingByStableKey = new Map(prev.map((c) => [stableKey(c.pin), c]));
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
        let vendor = parsed?.vendor ?? "";
        const catalogCode = parsed?.catalog ?? "";
        const rawUpper = (sr.rawText ?? "").toUpperCase();
        if (catalogCode.startsWith("THHN") && !rawUpper.includes("ALU")) {
          vendor = "COP";
        } else if (catalogCode.startsWith("XHHW") && !rawUpper.includes("COP")) {
          vendor = "ALU";
        }
        return {
          result: { pinId: pin.id, pinLabel: sr.pinLabel || pin.label || "", rawText: sr.rawText, readable: !!sr.readable } as AnalysisResult,
          matchResult,
          editCatalog: catalogCode,
          editFootage: parsed?.footage ? String(toDisplayUnit(parsed.footage, currentUnit)) : "",
          editVendor: vendor,
        };
      }

      function applyPinSeed<T extends { editCatalog: string; editVendor: string; editFootage: string }>(seed: T, pin: Pin): T {
        return {
          ...seed,
          editCatalog: pin.wireDetails && pin.wireDetails.trim() ? pin.wireDetails.toUpperCase() : seed.editCatalog,
          editVendor: pin.vendorCode && pin.vendorCode.trim() ? pin.vendorCode.toUpperCase() : seed.editVendor,
          editFootage: pin.footage != null ? String(toDisplayUnit(pin.footage, currentUnit)) : seed.editFootage,
        };
      }

      const built = effectivePins.map((pin) => {
        const sr = serverResultsMap.get(pin.id);
        let ex = existing.get(pin.id);
        if (!ex) {
          const byKey = existingByStableKey.get(stableKey(pin));
          if (byKey && byKey.pin.id !== pin.id) {
            ex = byKey;
          }
        }
        if (ex) {
          if (sr) {
            const serverTime = new Date(sr.updatedAt || sr.createdAt).getTime();
            const hasNewerServer = !ex.result || serverTime > (ex._serverTs ?? 0);
            if (hasNewerServer) {
              return { ...ex, pin, isDraft: !pin.entryId, _serverTs: serverTime, ...applyPinSeed(buildResultFromServer(sr, pin), pin) };
            }
          }
          return { ...ex, pin, isDraft: !pin.entryId };
        }
        const savedZoom = savedZooms[String(pin.id)];
        const smartZoom = computeSmartZoom(pinCountByPhoto.get(pin.photoId) || 1);
        const hasSavedSelection = String(pin.id) in savedSelections;
        const savedIncluded = hasSavedSelection ? savedSelections[String(pin.id)] : undefined;
        const base = { pin, zoomLevel: savedZoom ?? smartZoom, panX: 0, panY: 0, included: savedIncluded ?? true, isDraft: !pin.entryId };
        if (sr) {
          return { ...base, included: savedIncluded ?? true, _serverTs: new Date(sr.updatedAt || sr.createdAt).getTime(), ...applyPinSeed(buildResultFromServer(sr, pin), pin) };
        }
        const local = localResultsMap.get(pin.id);
        if (local && local.rawText !== null) {
          return {
            ...base,
            included: savedIncluded ?? true,
            ...applyPinSeed({
              editCatalog: local.editCatalog ?? "",
              editFootage: local.editFootage ?? "",
              editVendor: local.editVendor ?? "",
            }, pin),
            result: { pinId: pin.id, pinLabel: pin.label || "", rawText: local.rawText, readable: local.readable } as AnalysisResult,
            matchResult: local.rawText ? matchLabelText(local.rawText) : undefined,
          };
        }
        return { ...base, included: savedIncluded ?? true, ...applyPinSeed({ editCatalog: "", editFootage: "", editVendor: "" }, pin) };
      });
      builtHasResults = built.some((c) => c.result);
      return builtHasResults ? sortCardsByCatalog(built) : built;
    });
    if (builtHasResults) setPhase("results");
  }, [effectivePins.map((p) => p.id).join(","), currentPhotoId, isReceiving, batchMode, serverScanResultsKey, currentUnit]);

  useEffect(() => {
    if (cachedResults?.results && phase === "preview" && useCachedResults) {
      applyResults(cachedResults.results);
    }
  }, [cachedResults]);

  const displayCards = useMemo(() => {
    const base = (batchMode || isReceiving) ? cards : !currentPhotoId ? cards : cards.filter((c) => c.pin.photoId === currentPhotoId);
    return base.filter((c) => !c.pin.flagged);
  }, [cards, batchMode, isReceiving, currentPhotoId]);

  const frozenPhotoAssignmentRef = useRef<{ photoToParticipant: Map<number, string>; participantIds: string[]; participantNames: Map<string, string> } | null>(null);
  const [batchReadyStatus, setBatchReadyStatus] = useState<Record<string, boolean>>({});

  const participantBatches = useMemo(() => {
    if (!batchMode || displayCards.length === 0) {
      frozenPhotoAssignmentRef.current = null;
      return null;
    }

    if (onlineUsers.length === 0) {
      if (frozenPhotoAssignmentRef.current) return null;
      return null;
    }

    const displayPhotoIds = [...new Set(displayCards.map((c) => c.pin.photoId))];

    const frozen = frozenPhotoAssignmentRef.current;
    if (frozen) {
      const nameMap = new Map(frozen.participantNames);
      for (const u of onlineUsers) nameMap.set(u.userId, u.username);

      const batchMap = new Map<string, PinCard[]>();
      for (const uid of frozen.participantIds) batchMap.set(uid, []);

      const photoCounts = new Map<string, number>();
      for (const uid of frozen.participantIds) photoCounts.set(uid, 0);
      for (const [, assignee] of frozen.photoToParticipant) {
        if (photoCounts.has(assignee)) photoCounts.set(assignee, (photoCounts.get(assignee) ?? 0) + 1);
      }

      for (const card of displayCards) {
        let assignee = frozen.photoToParticipant.get(card.pin.photoId);
        if (!assignee || !batchMap.has(assignee)) {
          const smallest = frozen.participantIds.reduce((a, b) =>
            (photoCounts.get(a) ?? 0) <= (photoCounts.get(b) ?? 0) ? a : b
          );
          assignee = smallest;
          frozen.photoToParticipant.set(card.pin.photoId, smallest);
          photoCounts.set(smallest, (photoCounts.get(smallest) ?? 0) + 1);
        }
        batchMap.get(assignee)!.push(card);
      }

      const result = frozen.participantIds
        .map((uid, i) => ({ name: nameMap.get(uid) || uid, userId: uid, cards: batchMap.get(uid) || [], index: i + 1 }))
        .filter((b) => b.cards.length > 0);

      if (result.length > 0) return result;
    }

    const participantIds = onlineUsers.map((u) => u.userId);
    const participantNames = new Map(onlineUsers.map((u) => [u.userId, u.username]));

    const photoOwners = new Map<number, string>();
    for (const p of photos) {
      if (p.userId) photoOwners.set(p.id, p.userId);
    }

    const uniqueOwnerIds = new Set<string>();
    for (const pid of displayPhotoIds) {
      const ownerId = photoOwners.get(pid);
      if (ownerId) uniqueOwnerIds.add(ownerId);
    }

    const photoToParticipant = new Map<number, string>();

    if (uniqueOwnerIds.size > 1) {
      const photoCounts = new Map<string, number>();
      for (const uid of participantIds) photoCounts.set(uid, 0);

      for (const pid of displayPhotoIds) {
        const ownerId = photoOwners.get(pid);
        if (ownerId && photoCounts.has(ownerId)) {
          photoToParticipant.set(pid, ownerId);
          photoCounts.set(ownerId, (photoCounts.get(ownerId) ?? 0) + 1);
        } else {
          const smallest = participantIds.reduce((a, b) =>
            (photoCounts.get(a) ?? 0) <= (photoCounts.get(b) ?? 0) ? a : b
          );
          photoToParticipant.set(pid, smallest);
          photoCounts.set(smallest, (photoCounts.get(smallest) ?? 0) + 1);
        }
      }
    } else {
      displayPhotoIds.forEach((pid, i) => {
        photoToParticipant.set(pid, participantIds[i % participantIds.length]);
      });
    }

    frozenPhotoAssignmentRef.current = { photoToParticipant, participantIds, participantNames };

    const batchMap = new Map<string, PinCard[]>();
    for (const uid of participantIds) batchMap.set(uid, []);

    for (const card of displayCards) {
      const assignee = photoToParticipant.get(card.pin.photoId);
      if (assignee && batchMap.has(assignee)) {
        batchMap.get(assignee)!.push(card);
      }
    }

    const result = participantIds
      .map((uid, i) => ({ name: participantNames.get(uid) || uid, userId: uid, cards: batchMap.get(uid) || [], index: i + 1 }))
      .filter((b) => b.cards.length > 0);

    return result;
  }, [batchMode, displayCards, onlineUsers, photos]);

  const cardsWithResults = displayCards.filter((c) => c.result).length;
  useEffect(() => {
    if (phase === "preview" && displayCards.length > 0 && cardsWithResults > 0) {
      setPhase("results");
    }
  }, [displayCards.length, cardsWithResults, phase]);

  useEffect(() => {
    setBatchReadyStatus({});
  }, [phase]);

  function applyResults(results: AnalysisResult[]) {
    setCards((prev) =>
      prev.map((card) => {
        const result = results.find((r) => r.pinId === card.pin.id);
        if (!result) return card;
        const matchResult = result.rawText ? matchLabelText(result.rawText) : undefined;
        const parsed = matchResult?.match;
        let vendor = parsed?.vendor ?? "";
        const catalogCode = parsed?.catalog ?? "";
        const rawUpper = (result.rawText ?? "").toUpperCase();
        if (catalogCode.startsWith("THHN") && !rawUpper.includes("ALU")) {
          vendor = "COP";
        } else if (catalogCode.startsWith("XHHW") && !rawUpper.includes("COP")) {
          vendor = "ALU";
        }
        const isHighConfidence = matchResult?.confidence === "high";
        const included = isHighConfidence;
        const updated = {
          ...card,
          result,
          matchResult,
          editCatalog: catalogCode,
          editFootage: parsed?.footage ? String(toDisplayUnit(parsed.footage, currentUnit)) : "",
          editVendor: vendor,
          included,
          notAnalyzedReason: undefined,
        };
        saveSelectionState(sessionId, card.pin.id, included);
        return updated;
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

  const toggleAllCards = (checked: boolean) => {
    const displayIds = new Set(displayCards.map((c) => c.pin.id));
    setCards((prev) =>
      prev.map((c) => {
        if (!displayIds.has(c.pin.id)) return c;
        saveSelectionState(sessionId, c.pin.id, checked);
        return { ...c, included: checked };
      })
    );
  };

  const setCardField = (pinId: number, field: "editCatalog" | "editVendor", value: string) => {
    setCards((prev) =>
      prev.map((c) => {
        if (c.pin.id !== pinId) return c;
        const updated: PinCard = { ...c, [field]: value, notAnalyzedReason: undefined };
        if (field === "editCatalog") {
          const cleaned = value.trim();
          if (cleaned.length >= 2) {
            const results = lookupCatalog(cleaned, userParsedCatalog);
            const upper = cleaned.toUpperCase().replace(/[^A-Z0-9]/g, "");
            const exactMatches = results.filter((r) => r.catalog === upper);
            const unambiguous =
              exactMatches.length === 1
                ? exactMatches[0]
                : exactMatches.length === 0 && results.length === 1
                ? results[0]
                : null;
            if (unambiguous) {
              if (!updated.editVendor.trim() && unambiguous.vendor) {
                updated.editVendor = unambiguous.vendor.toUpperCase();
              }
              if (!updated.editFootage.trim() && unambiguous.footage) {
                updated.editFootage = String(toDisplayUnit(unambiguous.footage, currentUnit));
              }
              if (exactMatches.length === 1) {
                updated.matchResult = {
                  match: unambiguous,
                  confidence: "high",
                  normalizedInput: upper,
                  matchMethod: "exact",
                };
              }
            }
          }
        }
        return updated;
      })
    );
  };

  const includedCards = displayCards.filter((c) => c.included);
  const allChecked = displayCards.length > 0 && displayCards.every((c) => c.included);
  const someChecked = displayCards.some((c) => c.included);

  const toggleFlag = useCallback(async (pinId: number, reason?: string) => {
    const card = cards.find((c) => c.pin.id === pinId);
    if (!card) return;
    const prevFlagged = card.pin.flagged;
    const prevFlagReason = card.pin.flagReason ?? null;
    const newFlagged = !prevFlagged;
    setCards((prev) =>
      prev.map((c) => (c.pin.id === pinId ? { ...c, pin: { ...c.pin, flagged: newFlagged, flagReason: newFlagged && reason ? reason : c.pin.flagReason } } : c))
    );
    try {
      const body: Record<string, unknown> = { flagged: newFlagged };
      if (newFlagged && reason) body.flagReason = reason;
      if (!newFlagged) body.flagReason = null;
      await apiRequest("PATCH", `/api/pins/${pinId}/flag`, body);
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(sessionId), "pins"] });
      onPinDataChanged?.();
      if (newFlagged) {
        pushUndo?.({ type: "flag-pin", sessionId, entityId: pinId, data: { flagged: true, flagReason: reason ?? null }, previousData: { flagged: prevFlagged, flagReason: prevFlagReason } });
      } else {
        pushUndo?.({ type: "unflag-pin", sessionId, entityId: pinId, data: { flagged: false, flagReason: null }, previousData: { flagged: true, flagReason: prevFlagReason } });
      }
    } catch {
      setCards((prev) =>
        prev.map((c) => (c.pin.id === pinId ? { ...c, pin: { ...c.pin, flagged: !newFlagged } } : c))
      );
    }
  }, [cards, sessionId, onPinDataChanged, pushUndo]);

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

  async function attemptPhotoAnalyze(photoId: number, photoCards: PinCard[]): Promise<any> {
    const pinData = photoCards.map((c) => ({
      pinId: c.pin.id,
      pinLabel: c.pin.label || `P${String(c.pin.id).padStart(3, "0")}`,
      x: c.pin.xPercent,
      y: c.pin.yPercent,
      zoomLevel: c.zoomLevel,
    }));
    const MAX_ATTEMPTS = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (cancelRequested.current) {
        const e = new Error("__cancelled__");
        throw e;
      }
      try {
        const res = await apiRequest("POST", `/api/photos/${photoId}/analyze-labels`, { pins: pinData });
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (!isRetryableAnalyzeError(err)) throw err;
        if (attempt === MAX_ATTEMPTS - 1) throw err;
        const base = 500 * Math.pow(2, attempt);
        const jitter = Math.random() * 250;
        await new Promise((r) => setTimeout(r, base + jitter));
      }
    }
    throw lastErr;
  }

  async function runAnalyze(targets: PinCard[], opts: { isRetry: boolean }) {
    if (!targets.length) return;
    cancelRequested.current = false;
    setAnalyzing(true);

    const targetIds = new Set(targets.map((c) => c.pin.id));
    const displayIdSet = new Set(displayCards.map((c) => c.pin.id));

    setCards((prev) => prev.map((c) => {
      if (c.result) return c;
      if (targetIds.has(c.pin.id)) return { ...c, notAnalyzedReason: "new" };
      if (!opts.isRetry && displayIdSet.has(c.pin.id) && !c.included) {
        return { ...c, notAnalyzedReason: "excluded" };
      }
      return c;
    }));

    let totalResults = 0;
    let succeededPhotos = 0;
    let failedPhotos = 0;

    try {
      const byPhoto = new Map<number, PinCard[]>();
      for (const c of targets) {
        const pid = c.pin.photoId;
        if (!byPhoto.has(pid)) byPhoto.set(pid, []);
        byPhoto.get(pid)!.push(c);
      }
      const totalBatches = byPhoto.size;
      let doneBatches = 0;
      setAnalyzeProgress({ done: 0, total: totalBatches });

      const photoOrder = Array.from(byPhoto.keys());
      for (let pIdx = 0; pIdx < photoOrder.length; pIdx++) {
        const photoId = photoOrder[pIdx];
        const photoCards = byPhoto.get(photoId)!;
        if (cancelRequested.current) {
          const remainingPhotoIds = new Set(photoOrder.slice(pIdx));
          setCards((prev) => prev.map((c) =>
            remainingPhotoIds.has(c.pin.photoId) && targetIds.has(c.pin.id) && !c.result
              ? { ...c, notAnalyzedReason: "cancelled" }
              : c
          ));
          toast({ title: "Analysis cancelled", description: `Completed ${doneBatches} of ${totalBatches} batch${totalBatches !== 1 ? "es" : ""}` });
          return;
        }
        try {
          const data = await attemptPhotoAnalyze(photoId, photoCards);
          if (data?.results) {
            applyResults(data.results);
            totalResults += data.results.length;
          }
          succeededPhotos++;
        } catch (err: any) {
          if (err?.message === "__cancelled__") {
            const remainingPhotoIds = new Set(photoOrder.slice(pIdx));
            setCards((prev) => prev.map((c) =>
              remainingPhotoIds.has(c.pin.photoId) && targetIds.has(c.pin.id) && !c.result
                ? { ...c, notAnalyzedReason: "cancelled" }
                : c
            ));
            toast({ title: "Analysis cancelled", description: `Completed ${doneBatches} of ${totalBatches} batch${totalBatches !== 1 ? "es" : ""}` });
            return;
          }
          failedPhotos++;
          const failedPinIds = new Set(photoCards.map((c) => c.pin.id));
          setCards((prev) => prev.map((c) =>
            failedPinIds.has(c.pin.id) && !c.result
              ? { ...c, notAnalyzedReason: "failed" }
              : c
          ));
          console.error(`[analyze] photo ${photoId} failed:`, err);
        }
        doneBatches++;
        setAnalyzeProgress({ done: doneBatches, total: totalBatches });
      }

      if (totalResults > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", String(sessionId), "scan-results"] });
        setCards((prev) => {
          const sorted = sortCardsByCatalog(prev);
          saveAnalysisResults(sessionId, sorted);
          return sorted;
        });
      }

      if (failedPhotos > 0) {
        const totalPhotos = succeededPhotos + failedPhotos;
        toast({
          title: `Analyzed ${succeededPhotos} of ${totalPhotos} photo${totalPhotos !== 1 ? "s" : ""}`,
          description: `${failedPhotos} failed — tap Retry on affected cards.`,
          variant: "destructive",
        });
      } else if (totalResults > 0) {
        toast({ title: "Analysis complete", description: `Read ${totalResults} label(s)` });
      }
    } catch (error: any) {
      toast({ title: "Analysis failed", description: error?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
    }
  }

  async function handleAnalyze() {
    if ((!currentPhotoId && !batchMode) || !includedCards.length) return;
    await runAnalyze(includedCards, { isRetry: false });
  }

  const handleRetryPhoto = useCallback((photoId: number) => {
    const photoCards = cards.filter(
      (c) => c.pin.photoId === photoId && c.included && !c.result && !c.pin.flagged
    );
    if (!photoCards.length) return;
    runAnalyze(photoCards, { isRetry: true });
  }, [cards]);

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
      const blocked: string[] = [];
      const succeededPinIds: number[] = [];
      const draftSuccessByPhoto = new Map<number, Set<string>>();

      for (const card of cardsToApply) {
        if (!card.included) continue;
        const hasData = !!(card.result || card.editCatalog || card.editVendor);
        if (!hasData) continue;

        if (isIncompleteCard(card)) {
          blocked.push(card.pin.label || `Pin ${card.pin.id}`);
          continue;
        }

        try {
          if (card.isDraft) {
            const cardPhoto = photos.find((p) => p.id === card.pin.photoId);
            const aisle = cardPhoto?.aisle || "";
            const section = cardPhoto?.section || "";
            const displayFootage = card.editFootage ? (parseInt(card.editFootage) || null) : null;
            const footage = displayFootage != null ? toBaseFeet(displayFootage, currentUnit) : null;
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
            if (card.editFootage) {
              const df = parseInt(card.editFootage) || null;
              updates.footage = df != null ? toBaseFeet(df, currentUnit) : null;
            }

            if (Object.keys(updates).length > 0) {
              await retryRequest("PATCH", `/api/pins/${card.pin.id}`, updates);

              if (card.pin.entryId) {
                const entryUpdates: Record<string, any> = {};
                if (card.editCatalog) entryUpdates.reelTag = card.editCatalog.toUpperCase();
                if (card.editVendor) entryUpdates.manufacturer = card.editVendor.toUpperCase();
                if (card.editFootage) {
                  const df2 = parseInt(card.editFootage) || null;
                  const rc = card.pin.reelCount ?? 1;
                  entryUpdates.footage = df2 != null ? toBaseFeet(df2, currentUnit) * rc : null;
                }
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

      return { successCount: succeededPinIds.length, failures, blocked, succeededPinIds };
    },
    onSuccess: (data, cardsToApply) => {
      if (currentPhotoId) {
        queryClient.invalidateQueries({ queryKey: ["/api/photos", String(currentPhotoId), "pins"] });
      }
      if (isReceiving || batchMode) {
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
      if (onApplied && data.successCount > 0) {
        const sectionCounts = new Map<string, number>();
        for (const card of cardsToApply) {
          if (!card.included) continue;
          const cardPhoto = photos.find((p) => p.id === card.pin.photoId);
          const key = `${cardPhoto?.aisle || "—"}-${cardPhoto?.section || "—"}`;
          sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1);
        }
        let primaryKey = "";
        let maxCount = 0;
        for (const [key, count] of sectionCounts) {
          if (count > maxCount) { maxCount = count; primaryKey = key; }
        }
        if (primaryKey) onApplied(primaryKey);
      }
      if (data.blocked.length > 0) {
        toast({
          title: `${data.blocked.length} reel(s) skipped — wire type, gauge, or color could not be read`,
          description: `Edit these cards before applying: ${data.blocked.join(", ")}`,
          variant: "destructive",
        });
      }
      if (data.failures.length > 0) {
        toast({
          title: `Applied ${data.successCount} of ${data.successCount + data.failures.length}`,
          description: `Failed: ${data.failures.join(", ")}`,
          variant: "destructive",
        });
      } else if (data.successCount > 0) {
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
    <div className="flex items-center gap-2 bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_13%)] rounded-lg p-3 border border-[hsl(215_30%_50%/0.25)]">
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
          <SelectTrigger className="w-[300px] h-7 text-xs bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.3)] text-white" data-testid="select-scanner-photo">
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
          <p>{photos.length > 0 ? "All photos have been fully scanned and applied." : "No photos in this session yet. Upload photos in the Reel IDs tab first."}</p>
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
          <p>No active pins on this photo. Place pins in the Reel IDs tab to use the AI scanner.</p>
          {next && (
            <Button
              size="sm"
              onClick={() => { setSelectedPhotoId(next.id); setPhase("preview"); setCards([]); }}
              className="mt-3 bg-[hsl(30_90%_45%)] text-white border border-[hsl(30_90%_35%)]"
              data-testid="btn-next-photo-no-pins"
            >
              <AlertCircle className="h-3.5 w-3.5 mr-1" />
              <span className="text-xs font-semibold">Go To Next Photo ({availablePhotos.length - idx - 1})</span>
            </Button>
          )}
        </div>
      </div>
    );
  }

  const selectedForApply = displayCards.filter((c) => c.included && (c.result || c.editCatalog || c.editVendor));

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
    <ErrorBoundary fallback={
      <div className="flex flex-col items-center justify-center p-8 gap-3 text-center text-sm">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="font-medium">The scanner encountered an unexpected error.</p>
        <button className="underline text-muted-foreground" onClick={() => window.location.reload()}>Reload page</button>
      </div>
    }>
    <div className="space-y-4" data-testid="label-scanner-tab">
      <div className="bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_13%)] rounded-lg p-3 border border-[hsl(215_30%_50%/0.25)] space-y-2">
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
                <SelectTrigger className="w-[300px] h-7 text-xs bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.3)] text-white" data-testid="select-scanner-photo">
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
            <Badge variant="outline" className="text-xs border-[hsl(215_30%_50%/0.4)] text-white/70">
              {effectivePins.length} active pin{effectivePins.length !== 1 ? "s" : ""}
            </Badge>
            {isReceiving && effectivePins.length > activePinsForPhoto.length && (
              <Badge className="text-[10px] bg-purple-900/50 text-purple-300 border-purple-700/40" data-testid="badge-receiving-pooled">
                Pooled from {new Set(effectivePins.map((p) => p.photoId)).size} photos
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!batchMode && nextPhoto && (
              <Button
                size="sm"
                onClick={advanceToNextPhoto}
                className="bg-[hsl(30_90%_45%)] text-white border border-[hsl(30_90%_35%)]"
                data-testid="btn-next-photo"
              >
                <AlertCircle className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs font-semibold">Go To Next Photo ({availablePhotos.length - currentPhotoIndex - 1})</span>
              </Button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                title="Close panel"
                data-testid="btn-scanner-close"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {(phase === "preview" || isAdmin) && (
          <div className="pt-1 flex items-center justify-end gap-2">
            {analyzing && batchMode && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { cancelRequested.current = true; }}
                className="gap-2 border-red-700/50 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                data-testid="btn-cancel-analyze-labels"
              >
                <X className="h-4 w-4" />
                Cancel AI Analyses
              </Button>
            )}
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
        {displayCards.length > 0 && (
          <div className="pt-1 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none" data-testid="label-select-all">
              <Checkbox
                checked={allChecked}
                data-state={someChecked && !allChecked ? "indeterminate" : undefined}
                onCheckedChange={(v) => toggleAllCards(!!v)}
                data-testid="checkbox-select-all"
              />
              <span className="text-xs text-white/60">
                {allChecked ? "Deselect all" : "Select all"} ({displayCards.length})
              </span>
            </label>
            {phase === "results" && (
              <Button
                size="sm"
                onClick={() => applyMutation.mutate(displayCards)}
                disabled={applyMutation.isPending || !selectedForApply.length}
                className="gap-2 bg-green-800 hover:bg-green-700 text-white"
                data-testid="btn-apply-labels-top"
              >
                {applyMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Add-{selectedForApply.length} Reels from Images
                  </>
                )}
              </Button>
            )}
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
        <div className="flex rounded-md border border-[hsl(215_30%_50%/0.3)] overflow-hidden">
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
            All Remaining Photos
            {batchMode && allSessionActivePins.length > 0 && (
              <Badge className="text-[9px] bg-white/15 text-white/80 border-0 py-0 px-1.5 ml-0.5">{allSessionActivePins.length} pins</Badge>
            )}
          </button>
        </div>
      </div>

      {includedCards.length > 20 && phase === "preview" && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[hsl(0_0%_5%)] border border-[hsl(215_30%_50%/0.4)] rounded text-[hsl(18_85%_55%)] text-xs" data-testid="warning-batch-split">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{includedCards.length} pins selected — analysis will be split into {Math.ceil(includedCards.length / 20)} batches.</span>
        </div>
      )}

      {batchMode && phase === "preview" && displayCards.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(25_12%_20%)] border border-[hsl(215_30%_50%/0.25)] rounded text-white/60 text-xs" data-testid="batch-summary-note">
          <Grid3X3 className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{displayCards.length} pin{displayCards.length !== 1 ? "s" : ""} across {new Set(displayCards.map((c) => c.pin.photoId)).size} photo{new Set(displayCards.map((c) => c.pin.photoId)).size !== 1 ? "s" : ""}{participantBatches ? ` · ${participantBatches.length} batch${participantBatches.length !== 1 ? "es" : ""}` : ""}</span>
        </div>
      )}

      {(batchMode && participantBatches) ? (
        <>
          {participantBatches.map((batch, batchIdx) => {
            const batchPhotoCount = new Set(batch.cards.map((c) => c.pin.photoId)).size;
            const batchPinCount = batch.cards.length;
            return (
              <div key={batch.userId} data-testid={`batch-section-${batchIdx}`}>
                {batchIdx > 0 && (
                  <div className="border-t border-[hsl(215_30%_50%/0.25)] my-4" />
                )}
                <div className={`sticky top-0 z-10 flex items-center gap-2 px-3 py-2 mb-3 border rounded-lg ${
                  batchReadyStatus[batch.userId]
                    ? "bg-green-900/30 border-green-700/40"
                    : "bg-[hsl(25_15%_13%)] border-[hsl(215_30%_50%/0.25)]"
                }`} data-testid={`batch-header-${batchIdx}`}>
                  {batchReadyStatus[batch.userId] ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400 flex-shrink-0" />
                  ) : (
                    <Users className="h-3.5 w-3.5 text-[hsl(18_85%_55%)] flex-shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-white">Batch {batch.index} — {batch.name}</span>
                  {batchReadyStatus[batch.userId] && (
                    <Badge className="text-[9px] bg-green-800/60 text-green-300 border-green-700/40 py-0 px-1.5" data-testid={`badge-batch-ready-${batchIdx}`}>
                      {phase === "results" ? "Ready for Table Entry" : "Ready for Analysis"}
                    </Badge>
                  )}
                  <div className="flex items-center gap-2 ml-auto">
                    <Badge className="text-[9px] bg-white/10 text-white/60 border-0 py-0 px-1.5">{batchPhotoCount} photo{batchPhotoCount !== 1 ? "s" : ""}</Badge>
                    <Badge className="text-[9px] bg-white/10 text-white/60 border-0 py-0 px-1.5">{batchPinCount} pin{batchPinCount !== 1 ? "s" : ""}</Badge>
                  </div>
                </div>
                <div className={`grid gap-3 ${
                  phase === "preview"
                    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                    : "grid-cols-1 sm:grid-cols-2"
                }`}>
                  {batch.cards.map((card) => {
                    const isFromOtherPhoto = card.pin.photoId !== currentPhotoId;
                    const pinPhotoObj = photos.find((p) => p.id === card.pin.photoId) ?? null;
                    const cardPhotoObj = isFromOtherPhoto ? pinPhotoObj : photo;
                    const batchPhotoObj = pinPhotoObj || photo;
                    const cardPhotoUrl = getPhotoUrl(batchPhotoObj || cardPhotoObj || pinPhotoObj);
                    const isBatch = phase === "preview";
                    return (
                      <div
                        key={card.pin.id}
                        className={`rounded-lg border ${isBatch ? "p-2 space-y-1" : "p-3 space-y-2"} transition-colors ${
                          card.included
                            ? "bg-[hsl(25_12%_16%)] border-[hsl(215_30%_50%/0.3)]"
                            : "bg-[hsl(25_8%_14%)] border-[hsl(18_20%_25%/0.2)]"
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
                              {card.pin.label ? formatPinLabel(card.pin.label) : `#${card.pin.id}`}
                            </span>
                            {card.pin.flagged ? (
                              <button
                                onClick={() => toggleFlag(card.pin.id)}
                                className="p-0.5 rounded transition-colors text-amber-400 hover:text-amber-300"
                                title="Remove flag"
                                data-testid={`btn-flag-${card.pin.id}`}
                              >
                                <Flag className={`${isBatch ? "h-3 w-3" : "h-3.5 w-3.5"} fill-amber-400`} />
                              </button>
                            ) : (
                              <Popover
                                open={flagPopoverPinId === card.pin.id}
                                onOpenChange={(open) => {
                                  if (open) { setFlagPopoverPinId(card.pin.id); setFlagReasonDraft(""); }
                                  else setFlagPopoverPinId(null);
                                }}
                              >
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="p-0.5 rounded transition-colors text-white/20 hover:text-white/40"
                                    title="Flag for re-shoot"
                                    data-testid={`btn-flag-${card.pin.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Flag className={`${isBatch ? "h-3 w-3" : "h-3.5 w-3.5"}`} />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-3 space-y-2" onClick={(e) => e.stopPropagation()} onCloseAutoFocus={(e) => e.preventDefault()} data-testid={`popover-flag-${card.pin.id}`}>
                                  <p className="text-xs font-medium">Flag for re-shoot</p>
                                  <Input
                                    placeholder="Reason (optional)"
                                    value={flagReasonDraft}
                                    onChange={(e) => setFlagReasonDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") { toggleFlag(card.pin.id, flagReasonDraft.trim() || undefined); setFlagPopoverPinId(null); }
                                    }}
                                    autoFocus
                                    data-testid={`input-flag-reason-${card.pin.id}`}
                                  />
                                  <div className="flex justify-end gap-1">
                                    <Button size="sm" variant="ghost" onClick={() => setFlagPopoverPinId(null)}>Cancel</Button>
                                    <Button size="sm" onClick={() => { toggleFlag(card.pin.id, flagReasonDraft.trim() || undefined); setFlagPopoverPinId(null); }} data-testid={`btn-flag-confirm-${card.pin.id}`}>
                                      <Flag className="h-3.5 w-3.5 mr-1" />
                                      Flag
                                    </Button>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                            {isBatch && batchPhotoObj && (
                              <Badge className="text-[9px] bg-[hsl(25_30%_25%)] text-white/50 border-[hsl(215_25%_40%/0.3)] py-0 px-1" data-testid={`badge-batch-source-${card.pin.id}`}>
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
                                size={isBatch ? 300 : 180}
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
                          <div className="space-y-2 pt-1 border-t border-[hsl(215_30%_50%/0.15)]">
                            <div className="rounded bg-black/30 px-2 py-1" data-testid={`raw-text-${card.pin.id}`}>
                              <span className="text-[10px] text-white/30 uppercase tracking-wider" style={{ fontFamily: "'JetBrains Mono', monospace" }}>AI Raw</span>
                              <p className="text-[11px] text-white/50 break-words whitespace-pre-wrap" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                                {card.result.rawText ? card.result.rawText : <em className="text-white/30">unreadable</em>}
                              </p>
                            </div>
                            {card.matchResult && card.matchResult.confidence !== "none" ? (
                              <div className={`rounded-md border px-2 py-1 ${
                                card.matchResult.confidence === "high" ? "bg-green-900/50 border-green-700/40" : card.matchResult.confidence === "medium" ? "bg-amber-900/50 border-amber-700/40" : "bg-red-900/50 border-red-700/40"
                              }`}>
                                <FitTextInput
                                  value={card.editCatalog}
                                  onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                                  className={`w-full bg-transparent uppercase outline-none ${
                                    card.matchResult.confidence === "high" ? "text-green-300" : card.matchResult.confidence === "medium" ? "text-amber-300" : "text-red-300"
                                  }`}
                                  paddingH={0}
                                  data-testid={`input-catalog-${card.pin.id}`}
                                />
                              </div>
                            ) : (
                              <div>
                                <label className="text-[10px] text-white/40">Catalog</label>
                                <FitTextInput
                                  value={card.editCatalog}
                                  onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                                  className="w-full rounded-md border bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.25)] text-white uppercase outline-none px-2 py-1"
                                  placeholder="Enter catalog..."
                                  data-testid={`input-catalog-${card.pin.id}`}
                                />
                              </div>
                            )}
                            {isIncompleteCard(card) && (
                              <Badge
                                className="py-1 px-2 text-[11px] bg-amber-900/40 text-amber-300 border-amber-700/50 w-full justify-center"
                                data-testid={`badge-incomplete-${card.pin.id}`}
                              >
                                Incomplete — fill in wire type, gauge, color
                              </Badge>
                            )}
                            <div className="w-24">
                              <label className="text-[10px] text-white/40">Vendor</label>
                              <FitTextInput
                                value={card.editVendor}
                                onChange={(e) => setCardField(card.pin.id, "editVendor", e.target.value)}
                                maxLength={3}
                                className="w-full rounded-md border bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.25)] text-white uppercase outline-none px-2 py-1"
                                data-testid={`input-vendor-${card.pin.id}`}
                              />
                            </div>
                          </div>
                        )}
                        {!card.result && phase === "results" && (
                          <div className="space-y-2 pt-1 border-t border-[hsl(215_30%_50%/0.15)]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge
                                className={`py-1 px-2 text-wrap text-[11px] ${
                                  card.notAnalyzedReason === "failed"
                                    ? "bg-red-900/40 text-red-300 border-red-700/50"
                                    : card.notAnalyzedReason === "cancelled"
                                    ? "bg-amber-900/40 text-amber-300 border-amber-700/50"
                                    : card.notAnalyzedReason === "excluded"
                                    ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                                    : "bg-zinc-800 text-zinc-400 border-zinc-700"
                                }`}
                                data-testid={`badge-manual-${card.pin.id}`}
                              >
                                {notAnalyzedCopy(card.notAnalyzedReason)}
                              </Badge>
                              {card.notAnalyzedReason === "failed" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleRetryPhoto(card.pin.photoId)}
                                  disabled={analyzing}
                                  className="h-6 gap-1 px-2 text-[11px] border-red-700/50 text-red-300 hover:text-red-200 hover:bg-red-900/20"
                                  data-testid={`btn-retry-${card.pin.id}`}
                                >
                                  <RotateCw className="h-3 w-3" />
                                  Retry
                                </Button>
                              )}
                            </div>
                            <div>
                              <label className="text-[10px] text-white/40">Catalog</label>
                              <FitTextInput
                                value={card.editCatalog}
                                onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                                className="w-full rounded-md border bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.25)] text-white uppercase outline-none px-2 py-1"
                                placeholder="Enter catalog..."
                                data-testid={`input-catalog-manual-${card.pin.id}`}
                              />
                            </div>
                            <div className="w-24">
                              <label className="text-[10px] text-white/40">Vendor</label>
                              <FitTextInput
                                value={card.editVendor}
                                onChange={(e) => setCardField(card.pin.id, "editVendor", e.target.value)}
                                maxLength={3}
                                className="w-full rounded-md border bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.25)] text-white uppercase outline-none px-2 py-1"
                                data-testid={`input-vendor-manual-${card.pin.id}`}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-end mt-2">
                  <Button
                    size="sm"
                    variant={batchReadyStatus[batch.userId] ? "outline" : "default"}
                    onClick={() => setBatchReadyStatus((prev) => ({ ...prev, [batch.userId]: !prev[batch.userId] }))}
                    className={`gap-2 text-xs ${
                      batchReadyStatus[batch.userId]
                        ? "border-green-700/40 text-green-400 hover:text-green-300 bg-green-900/20 hover:bg-green-900/30"
                        : "bg-[hsl(18_85%_32%)] hover:bg-[hsl(18_85%_38%)] text-white"
                    }`}
                    data-testid={`btn-batch-ready-${batchIdx}`}
                  >
                    {batchReadyStatus[batch.userId] ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {phase === "results" ? "Marked Ready for Table Entry" : "Marked Ready for Analysis"}
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        {phase === "results" ? "Batch Ready for Table Entry" : "Batch Ready for AI Analysis"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <div className={`grid gap-3 ${
          batchMode && phase === "preview"
            ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
            : "grid-cols-1 sm:grid-cols-2"
        }`}>
        {displayCards.map((card) => {
          const hasFilled = !!(card.pin.wireDetails && card.pin.footage);
          const isFromOtherPhoto = card.pin.photoId !== currentPhotoId;
          const pinPhotoObj = photos.find((p) => p.id === card.pin.photoId) ?? null;
          const cardPhotoObj = isFromOtherPhoto ? pinPhotoObj : photo;
          const batchPhotoObj = batchMode ? pinPhotoObj || photo : null;
          const cardPhotoUrl = (batchMode || isFromOtherPhoto) ? getPhotoUrl(batchPhotoObj || cardPhotoObj || pinPhotoObj) : photoUrl;
          const isBatch = batchMode && phase === "preview";
          return (
            <div
              key={card.pin.id}
              className={`rounded-lg border ${isBatch ? "p-2 space-y-1" : "p-3 space-y-2"} transition-colors ${
                card.included
                  ? "bg-[hsl(25_12%_16%)] border-[hsl(215_30%_50%/0.3)]"
                  : "bg-[hsl(25_8%_14%)] border-[hsl(18_20%_25%/0.2)]"
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
                    {card.pin.label ? formatPinLabel(card.pin.label) : `#${card.pin.id}`}
                  </span>
                  {card.pin.flagged ? (
                    <button
                      onClick={() => toggleFlag(card.pin.id)}
                      className="p-0.5 rounded transition-colors text-amber-400 hover:text-amber-300"
                      title="Remove flag"
                      data-testid={`btn-flag-${card.pin.id}`}
                    >
                      <Flag className={`${isBatch ? "h-3 w-3" : "h-3.5 w-3.5"} fill-amber-400`} />
                    </button>
                  ) : (
                    <Popover
                      open={flagPopoverPinId === card.pin.id}
                      onOpenChange={(open) => {
                        if (open) { setFlagPopoverPinId(card.pin.id); setFlagReasonDraft(""); }
                        else setFlagPopoverPinId(null);
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="p-0.5 rounded transition-colors text-white/20 hover:text-white/40"
                          title="Flag for re-shoot"
                          data-testid={`btn-flag-${card.pin.id}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Flag className={`${isBatch ? "h-3 w-3" : "h-3.5 w-3.5"}`} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3 space-y-2" onClick={(e) => e.stopPropagation()} onCloseAutoFocus={(e) => e.preventDefault()} data-testid={`popover-flag-${card.pin.id}`}>
                        <p className="text-xs font-medium">Flag for re-shoot</p>
                        <Input
                          placeholder="Reason (optional)"
                          value={flagReasonDraft}
                          onChange={(e) => setFlagReasonDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { toggleFlag(card.pin.id, flagReasonDraft.trim() || undefined); setFlagPopoverPinId(null); }
                          }}
                          autoFocus
                          data-testid={`input-flag-reason-${card.pin.id}`}
                        />
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setFlagPopoverPinId(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => { toggleFlag(card.pin.id, flagReasonDraft.trim() || undefined); setFlagPopoverPinId(null); }} data-testid={`btn-flag-confirm-${card.pin.id}`}>
                            <Flag className="h-3.5 w-3.5 mr-1" />
                            Flag
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
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
                    <Badge className="text-[9px] bg-[hsl(25_30%_25%)] text-white/50 border-[hsl(215_25%_40%/0.3)] py-0 px-1" data-testid={`badge-batch-source-${card.pin.id}`}>
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
                <div className="space-y-2 pt-1 border-t border-[hsl(215_30%_50%/0.15)]">
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
                      <FitTextInput
                        value={card.editCatalog}
                        onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                        className={`w-full bg-transparent uppercase outline-none ${
                          card.matchResult.confidence === "high" ? "text-green-300" : card.matchResult.confidence === "medium" ? "text-amber-300" : "text-red-300"
                        }`}
                        paddingH={0}
                        data-testid={`input-catalog-${card.pin.id}`}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] text-white/40">Catalog</label>
                      <FitTextInput
                        value={card.editCatalog}
                        onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                        className="w-full rounded-md border bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.25)] text-white uppercase outline-none px-2 py-1"
                        placeholder="Enter catalog..."
                        data-testid={`input-catalog-${card.pin.id}`}
                      />
                    </div>
                  )}

                  {isIncompleteCard(card) && (
                    <Badge
                      className="py-1 px-2 text-[11px] bg-amber-900/40 text-amber-300 border-amber-700/50 w-full justify-center"
                      data-testid={`badge-incomplete-${card.pin.id}`}
                    >
                      Incomplete — fill in wire type, gauge, color
                    </Badge>
                  )}

                  <div className="w-24">
                    <label className="text-[10px] text-white/40">Vendor</label>
                    <FitTextInput
                      value={card.editVendor}
                      onChange={(e) => setCardField(card.pin.id, "editVendor", e.target.value)}
                      maxLength={3}
                      className="w-full rounded-md border bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.25)] text-white uppercase outline-none px-2 py-1"
                      data-testid={`input-vendor-${card.pin.id}`}
                    />
                  </div>
                </div>
              )}

              {!card.result && phase === "results" && (
                <div className="space-y-2 pt-1 border-t border-[hsl(215_30%_50%/0.15)]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      className={`py-1 px-2 text-wrap text-[11px] ${
                        card.notAnalyzedReason === "failed"
                          ? "bg-red-900/40 text-red-300 border-red-700/50"
                          : card.notAnalyzedReason === "cancelled"
                          ? "bg-amber-900/40 text-amber-300 border-amber-700/50"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                      }`}
                      data-testid={`badge-manual-${card.pin.id}`}
                    >
                      {notAnalyzedCopy(card.notAnalyzedReason)}
                    </Badge>
                    {card.notAnalyzedReason === "failed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRetryPhoto(card.pin.photoId)}
                        disabled={analyzing}
                        className="h-6 gap-1 px-2 text-[11px] border-red-700/50 text-red-300 hover:text-red-200 hover:bg-red-900/20"
                        data-testid={`btn-retry-${card.pin.id}`}
                      >
                        <RotateCw className="h-3 w-3" />
                        Retry
                      </Button>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-white/40">Catalog</label>
                    <FitTextInput
                      value={card.editCatalog}
                      onChange={(e) => setCardField(card.pin.id, "editCatalog", e.target.value)}
                      className="w-full rounded-md border bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.25)] text-white uppercase outline-none px-2 py-1"
                      placeholder="Enter catalog..."
                      data-testid={`input-catalog-manual-${card.pin.id}`}
                    />
                  </div>
                  <div className="w-24">
                    <label className="text-[10px] text-white/40">Vendor</label>
                    <FitTextInput
                      value={card.editVendor}
                      onChange={(e) => setCardField(card.pin.id, "editVendor", e.target.value)}
                      maxLength={3}
                      className="w-full rounded-md border bg-[hsl(25_12%_20%)] border-[hsl(215_30%_50%/0.25)] text-white uppercase outline-none px-2 py-1"
                      data-testid={`input-vendor-manual-${card.pin.id}`}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
        {(phase === "preview" || isAdmin) && (
          <div className="flex w-full items-center justify-end gap-2">
            {analyzing && batchMode && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { cancelRequested.current = true; }}
                className="gap-2 border-red-700/50 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                data-testid="btn-cancel-analyze-labels-bottom"
              >
                <X className="h-4 w-4" />
                Cancel AI Analyses
              </Button>
            )}
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
                className="gap-2 border-[hsl(215_30%_50%/0.3)] text-white/70 hover:text-white"
                data-testid="btn-back-to-preview"
              >
                <X className="h-4 w-4" />
                Re-adjust & Re-run
              </Button>
            </div>
            <Button
              onClick={() => applyMutation.mutate(displayCards)}
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
                  Add-{selectedForApply.length} Reels from Images
                </>
              )}
            </Button>
          </>
        )}
      </div>
      <datalist id="vendor-code-suggestions-scanner">
        {vendorCodes.map(code => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </div>
  </ErrorBoundary>
  );
}
