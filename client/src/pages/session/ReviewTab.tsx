import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Check, Flag, Loader2, AlertTriangle, ChevronLeft, ChevronRight,
  ZoomIn, ZoomOut, RotateCw, RotateCcw, Move, CheckCircle2, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { Entry, Photo, Pin, ReviewResponse } from "@shared/schema";

const REVEAL_DELAY_MS = 60_000;

const ZOOM_MIN = 0.005;
const ZOOM_MAX = 1.0;
const ZOOM_STEP = 0.005;
const ZOOM_CLICK_STEP = 0.015;

type OnlineUser = { userId: string; username: string };

// ─── CropCanvas (mirrors LabelScannerTab's CropCanvas) ───────────────────────

const imageCache = new Map<string, HTMLImageElement>();

function getOrLoadImage(url: string): HTMLImageElement {
  const cached = imageCache.get(url);
  if (cached) { imageCache.delete(url); imageCache.set(url, cached); return cached; }
  if (imageCache.size >= 20) { const oldest = imageCache.keys().next().value; if (oldest) imageCache.delete(oldest); }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onerror = () => imageCache.delete(url);
  img.src = url;
  imageCache.set(url, img);
  return img;
}

function CropCanvas({
  photoUrl, xPercent, yPercent, zoomLevel, panX = 0, panY = 0, onPan, onReady, size = 260,
}: {
  photoUrl: string; xPercent: number; yPercent: number;
  zoomLevel: number; panX?: number; panY?: number;
  onPan?: (px: number, py: number) => void; onReady?: () => void; size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

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
    onReadyRef.current?.();
  }, [xPercent, yPercent, zoomLevel, panX, panY, size]);

  useEffect(() => {
    const img = getOrLoadImage(photoUrl);
    imgRef.current = img;
    if (img.complete && img.naturalWidth) { draw(); }
    else { const onLoad = () => draw(); img.addEventListener("load", onLoad); return () => img.removeEventListener("load", onLoad); }
  }, [photoUrl, draw]);

  useEffect(() => { draw(); }, [draw]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    if ("touches" in e) { const t = e.touches[0] || (e as React.TouchEvent).changedTouches[0]; return { x: t.clientX, y: t.clientY }; }
    return { x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY };
  };

  const handleDown = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getPos(e);
    dragRef.current = { startX: pos.x, startY: pos.y, startPanX: panX, startPanY: panY };
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragRef.current || !onPan || !imgRef.current) return;
    const pos = getPos(e);
    const dx = pos.x - dragRef.current.startX;
    const dy = pos.y - dragRef.current.startY;
    const fraction = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel));
    const scale = (imgRef.current.naturalWidth * fraction) / size;
    const rawPanX = dragRef.current.startPanX - dx * scale;
    const rawPanY = dragRef.current.startPanY - dy * scale;
    const maxPanX = imgRef.current.naturalWidth * (1 - fraction) / 2;
    const maxPanY = imgRef.current.naturalHeight * (1 - fraction) / 2;
    onPan(Math.max(-maxPanX, Math.min(maxPanX, rawPanX)), Math.max(-maxPanY, Math.min(maxPanY, rawPanY)));
  };

  const handleUp = () => { dragRef.current = null; };

  return (
    <canvas
      ref={canvasRef}
      width={size} height={size}
      className="rounded border border-border bg-black mx-auto"
      style={{ width: size, height: size, cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
      onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp}
      onTouchStart={handleDown} onTouchMove={handleMove} onTouchEnd={handleUp} onTouchCancel={handleUp}
      data-testid="canvas-review-thumbnail"
    />
  );
}

// ─── ZoomablePhoto (mirrors PhotoMode's photo viewer) ────────────────────────

function ZoomablePhoto({
  photoUrl, scale, panX, panY, rotation, panMode,
  onScale, onPan, onRotate, onPanMode, onReady,
}: {
  photoUrl: string; scale: number; panX: number; panY: number;
  rotation: number; panMode: boolean;
  onScale: (s: number) => void; onPan: (x: number, y: number) => void;
  onRotate: (deg: number) => void; onPanMode: (m: boolean) => void;
  onReady?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const isPanningRef = useRef(false);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panXRef = useRef(panX);
  panXRef.current = panX;
  const panYRef = useRef(panY);
  panYRef.current = panY;
  const panModeRef = useRef(panMode);
  panModeRef.current = panMode;

  const clamp = useCallback((px: number, py: number, s: number) => {
    const el = containerRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const maxX = (rect.width * (s - 1)) / (2 * s);
    const maxY = (rect.height * (s - 1)) / (2 * s);
    return { x: Math.max(-maxX, Math.min(maxX, px)), y: Math.max(-maxY, Math.min(maxY, py)) };
  }, []);

  const zoomAtPoint = useCallback((clientX: number, clientY: number, newScale: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cursorX = clientX - rect.left - rect.width / 2;
    const cursorY = clientY - rect.top - rect.height / 2;
    const oldScale = scaleRef.current;
    const adjX = panXRef.current + cursorX * (1 / newScale - 1 / oldScale) * newScale;
    const adjY = panYRef.current + cursorY * (1 / newScale - 1 / oldScale) * newScale;
    const clamped = clamp(adjX / newScale, adjY / newScale, newScale);
    onScale(newScale);
    onPan(clamped.x, clamped.y);
  }, [clamp, onScale, onPan]);

  const zoomAtPointRef = useRef(zoomAtPoint);
  zoomAtPointRef.current = zoomAtPoint;

  // Mouse wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      const newScale = Math.max(1, Math.min(12, scaleRef.current + delta));
      zoomAtPointRef.current(e.clientX, e.clientY, newScale);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Touch pinch + pan
  const pinchRef = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const touchPanRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        touchPanRef.current = null;
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        pinchRef.current = { dist: Math.hypot(dx, dy), midX: (e.touches[0].clientX + e.touches[1].clientX) / 2, midY: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      } else if (e.touches.length === 1 && (panModeRef.current || scaleRef.current > 1)) {
        e.preventDefault();
        touchPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, panX: panXRef.current, panY: panYRef.current };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const newDist = Math.hypot(dx, dy);
        const newScale = Math.max(1, Math.min(12, scaleRef.current * (newDist / pinchRef.current.dist)));
        pinchRef.current.dist = newDist;
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        zoomAtPointRef.current(midX, midY, newScale);
      } else if (e.touches.length === 1 && touchPanRef.current) {
        e.preventDefault();
        const dx = e.touches[0].clientX - touchPanRef.current.x;
        const dy = e.touches[0].clientY - touchPanRef.current.y;
        const el2 = containerRef.current;
        const rect = el2?.getBoundingClientRect();
        const s = scaleRef.current;
        const maxX = rect ? (rect.width * (s - 1)) / (2 * s) : 0;
        const maxY = rect ? (rect.height * (s - 1)) / (2 * s) : 0;
        onPan(Math.max(-maxX, Math.min(maxX, touchPanRef.current.panX + dx / s)), Math.max(-maxY, Math.min(maxY, touchPanRef.current.panY + dy / s)));
      }
    };
    const onTouchEnd = () => { pinchRef.current = null; touchPanRef.current = null; };
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [onPan]);

  // Mouse drag pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!panMode && scale <= 1) return;
    e.preventDefault();
    isPanningRef.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, panX, panY };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    const clamped = clamp(panStart.current.panX + dx / scale, panStart.current.panY + dy / scale, scale);
    onPan(clamped.x, clamped.y);
  };
  const handleMouseUp = () => { isPanningRef.current = false; };

  return (
    <div className="relative w-full" style={{ position: "relative" }}>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded border border-border bg-black"
        style={{ cursor: panMode || scale > 1 ? "grab" : "default", maxHeight: "360px" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        data-testid="review-photo-viewer"
      >
        <div
          style={{
            transform: `scale(${scale}) translate(${panX}px, ${panY}px) rotate(${rotation}deg)`,
            transformOrigin: "center center",
            transition: "transform 0.05s",
          }}
        >
          <img
            src={photoUrl}
            alt="Section photo"
            draggable={false}
            className="w-full select-none block"
            data-testid="img-review-photo"
            onLoad={onReady}
          />
        </div>
      </div>

      {/* Overlay controls — right strip */}
      <div className="photo-overlay-controls right-strip">
        <button
          className="photo-overlay-btn"
          onClick={() => { const s = Math.min(12, scale + 0.5); onScale(s); const c = clamp(panX, panY, s); onPan(c.x, c.y); }}
          title="Zoom in"
          data-testid="button-review-zoom-in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          className="photo-overlay-btn"
          onClick={() => { const s = Math.max(1, scale - 0.5); onScale(s); const c = clamp(panX, panY, s); onPan(c.x, c.y); }}
          title="Zoom out"
          data-testid="button-review-zoom-out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          className={`photo-overlay-btn ${panMode ? "photo-overlay-btn-active" : ""}`}
          onClick={() => onPanMode(!panMode)}
          title={panMode ? "Exit pan mode" : "Pan mode"}
          data-testid="button-review-pan-mode"
        >
          <Move className="h-4 w-4" />
        </button>
        <button
          className="photo-overlay-btn"
          onClick={() => onRotate((rotation + 90) % 360)}
          title="Rotate clockwise"
          data-testid="button-review-rotate-cw"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          className="photo-overlay-btn"
          onClick={() => onRotate((rotation - 90 + 360) % 360)}
          title="Rotate counter-clockwise"
          data-testid="button-review-rotate-ccw"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPhotoUrl(photo: Photo): string {
  const key = photo.objectStorageKey;
  if (key.startsWith("/uploads/") || key.startsWith("/objects/")) return key;
  return `/uploads/${key}`;
}

const lateJoinerQueueCache = new Map<string, number[]>();

// ─── ReviewTab ────────────────────────────────────────────────────────────────

export default function ReviewTab({
  sessionId, entries, photos, onlineUsers = [],
}: {
  sessionId: number; entries: Entry[]; photos: Photo[]; onlineUsers?: OnlineUser[];
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const currentUserId = user?.id || "";

  const { data: sessionPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
    enabled: sessionId > 0,
  });

  const { data: reviewResponses = [], isLoading: responsesLoading } = useQuery<ReviewResponse[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "review-responses"],
    enabled: sessionId > 0,
  });

  const pinByEntryId = useMemo(() => {
    const map = new Map<number, Pin>();
    for (const p of sessionPins) { if (p.entryId) map.set(p.entryId, p); }
    return map;
  }, [sessionPins]);

  const photoMap = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);

  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.id - b.id), [entries]);

  const sortedUsers = useMemo(() => {
    if (onlineUsers.length === 0 && currentUserId) return [{ userId: currentUserId, username: user?.firstName || currentUserId }];
    return [...onlineUsers].sort((a, b) => a.userId.localeCompare(b.userId));
  }, [onlineUsers, currentUserId, user]);

  const reviewCohort = useMemo(() => {
    const responderIds = Array.from(new Set(reviewResponses.map(r => r.userId))).sort();
    if (responderIds.length === 0) return sortedUsers;
    const cohortIds = responderIds.filter(
      id => !lateJoinerQueueCache.has(`${sessionId}:${id}`)
    );
    if (cohortIds.length === 0) return sortedUsers;
    const usernameMap = new Map(sortedUsers.map(u => [u.userId, u.username]));
    for (const r of reviewResponses) {
      if (!usernameMap.has(r.userId)) usernameMap.set(r.userId, r.userId);
    }
    return cohortIds.map(id => ({ userId: id, username: usernameMap.get(id) || id }));
  }, [reviewResponses, sortedUsers, sessionId]);

  const isLateJoiner = useMemo(() => {
    const cacheKey = `${sessionId}:${currentUserId}`;
    if (lateJoinerQueueCache.has(cacheKey)) return true;
    if (reviewResponses.length === 0) return false;
    const responderIds = new Set(reviewResponses.map(r => r.userId));
    return !responderIds.has(currentUserId);
  }, [reviewResponses, currentUserId, sessionId]);

  const assignedEntries = useMemo(() => {
    if (sortedEntries.length === 0) return [];

    if (!isLateJoiner) {
      if (reviewCohort.length === 0) return [];
      const userIndex = reviewCohort.findIndex(u => u.userId === currentUserId);
      if (userIndex === -1) return [];
      return sortedEntries.filter((_, i) => i % reviewCohort.length === userIndex);
    }

    const cacheKey = `${sessionId}:${currentUserId}`;
    const cached = lateJoinerQueueCache.get(cacheKey);
    if (cached) {
      const entryById = new Map(sortedEntries.map(e => [e.id, e]));
      const result: Entry[] = [];
      for (const id of cached) {
        const entry = entryById.get(id);
        if (entry) result.push(entry);
      }
      if (result.length === cached.length) return result;
    }

    const avgCount = Math.max(1, Math.floor(sortedEntries.length / reviewCohort.length));

    let hash = 0;
    for (let i = 0; i < currentUserId.length; i++) {
      hash = ((hash << 5) - hash + currentUserId.charCodeAt(i)) | 0;
    }
    const userHash = Math.abs(hash);

    const respondedEntryIds = new Set(reviewResponses.map(r => r.entryId));
    const unreviewed = sortedEntries.filter(e => !respondedEntryIds.has(e.id));
    const reviewed = sortedEntries.filter(e => respondedEntryIds.has(e.id));

    const queue: Entry[] = [];

    if (unreviewed.length <= avgCount) {
      queue.push(...unreviewed);
    } else {
      const offset = userHash % unreviewed.length;
      for (let i = 0; i < avgCount; i++) {
        queue.push(unreviewed[(offset + i) % unreviewed.length]);
      }
    }

    if (queue.length < avgCount && reviewed.length > 0) {
      const offset = userHash % reviewed.length;
      const remaining = avgCount - queue.length;
      for (let i = 0; i < remaining; i++) {
        queue.push(reviewed[(offset + i) % reviewed.length]);
      }
    }

    lateJoinerQueueCache.set(cacheKey, queue.map(e => e.id));
    return queue;
  }, [sortedEntries, reviewCohort, currentUserId, isLateJoiner, reviewResponses, sessionId]);

  const myResponses = useMemo(() => {
    const map = new Map<number, ReviewResponse>();
    for (const r of reviewResponses) { if (r.userId === currentUserId) map.set(r.entryId, r); }
    return map;
  }, [reviewResponses, currentUserId]);

  const reviewedCount = useMemo(() => assignedEntries.filter(e => myResponses.has(e.id)).length, [assignedEntries, myResponses]);

  const allReviewerStatus = useMemo(() => {
    if (reviewCohort.length === 0 || sortedEntries.length === 0) return [];
    const statuses = reviewCohort.map((u, idx) => {
      const assigned = sortedEntries.filter((_, i) => i % reviewCohort.length === idx);
      const respondedIds = new Set(
        reviewResponses.filter(r => r.userId === u.userId).map(r => r.entryId)
      );
      const done = assigned.filter(e => respondedIds.has(e.id)).length;
      return { userId: u.userId, username: u.username, done, total: assigned.length, complete: done >= assigned.length && assigned.length > 0 };
    });

    if (isLateJoiner && currentUserId) {
      const myRespondedIds = new Set(
        reviewResponses.filter(r => r.userId === currentUserId).map(r => r.entryId)
      );
      const done = assignedEntries.filter(e => myRespondedIds.has(e.id)).length;
      const existing = sortedUsers.find(u => u.userId === currentUserId);
      statuses.push({
        userId: currentUserId,
        username: existing?.username || user?.firstName || currentUserId,
        done,
        total: assignedEntries.length,
        complete: done >= assignedEntries.length && assignedEntries.length > 0,
      });
    }

    return statuses;
  }, [reviewCohort, sortedEntries, reviewResponses, isLateJoiner, currentUserId, assignedEntries, sortedUsers, user]);

  // ── Reveal timer state ─────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const hasAutoAdvanced = useRef(false);
  const scrubBarRef = useRef<HTMLDivElement>(null);
  const isScrubbing = useRef(false);

  // On first load, jump straight to the first unreviewed entry
  useEffect(() => {
    if (hasAutoAdvanced.current) return;
    if (assignedEntries.length === 0 || responsesLoading) return;
    const firstUnreviewed = assignedEntries.findIndex(e => !myResponses.has(e.id));
    if (firstUnreviewed > 0) setCurrentIndex(firstUnreviewed);
    hasAutoAdvanced.current = true;
  }, [assignedEntries, myResponses, responsesLoading]);

  const [revealedEntries, setRevealedEntries] = useState<Set<number>>(new Set());
  const [timers, setTimers] = useState<Map<number, number>>(new Map());
  const timerRefs = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map());
  const [flagReason, setFlagReason] = useState("");
  const [showFlagInput, setShowFlagInput] = useState(false);

  useEffect(() => {
    const immediateReveal = new Set<number>();
    const pending: { id: number; remainingMs: number }[] = [];
    for (const entry of assignedEntries) {
      if (myResponses.has(entry.id)) { immediateReveal.add(entry.id); continue; }
      if (revealedEntries.has(entry.id) || timerRefs.current.has(entry.id)) continue;
      const createdAt = entry.createdAt ? new Date(entry.createdAt).getTime() : Date.now();
      const remaining = REVEAL_DELAY_MS - (Date.now() - createdAt);
      if (remaining <= 0) { immediateReveal.add(entry.id); }
      else { pending.push({ id: entry.id, remainingMs: remaining }); }
    }
    if (immediateReveal.size > 0) {
      setRevealedEntries(prev => { const next = new Set(prev); for (const id of immediateReveal) next.add(id); return next; });
    }
    for (const { id, remainingMs } of pending) {
      const initialSeconds = Math.ceil(remainingMs / 1000);
      setTimers(prev => new Map(prev).set(id, initialSeconds));
      const interval = setInterval(() => {
        setTimers(prev => {
          const next = new Map(prev);
          const current = (next.get(id) ?? 1) - 1;
          if (current <= 0) {
            next.delete(id); clearInterval(timerRefs.current.get(id)); timerRefs.current.delete(id);
            setRevealedEntries(r => new Set(r).add(id));
            return next;
          }
          next.set(id, current); return next;
        });
      }, 1000);
      timerRefs.current.set(id, interval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedEntries, myResponses]);

  useEffect(() => {
    return () => { for (const iv of timerRefs.current.values()) clearInterval(iv); timerRefs.current.clear(); };
  }, []);

  // ── Per-entry view state (zoom/pan/rotate), reset on navigation ────────────
  const [pinZoom, setPinZoom] = useState(0.12);
  const [pinPanX, setPinPanX] = useState(0);
  const [pinPanY, setPinPanY] = useState(0);
  const [photoScale, setPhotoScale] = useState(1);
  const [photoPanX, setPhotoPanX] = useState(0);
  const [photoPanY, setPhotoPanY] = useState(0);
  const [photoRotation, setPhotoRotation] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [photoReadyForKey, setPhotoReadyForKey] = useState("");

  const resetView = useCallback(() => {
    setPinZoom(0.12); setPinPanX(0); setPinPanY(0);
    setPhotoScale(1); setPhotoPanX(0); setPhotoPanY(0);
    setPhotoRotation(0); setPanMode(false);
  }, []);

  useEffect(() => {
    resetView();
    setShowFlagInput(false);
    setFlagReason("");
  }, [currentIndex, resetView]);

  const setCardZoom = (zoom: number) => {
    const oldFraction = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinZoom));
    const newFraction = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    const scale = newFraction / oldFraction;
    setPinPanX(prev => prev * scale);
    setPinPanY(prev => prev * scale);
    setPinZoom(zoom);
  };

  // ── Mutation ───────────────────────────────────────────────────────────────
  const [showFlagBanner, setShowFlagBanner] = useState(false);
  const flagBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submitReview = useMutation({
    mutationFn: async ({ entryId, verdict, reason }: { entryId: number; verdict: string; reason?: string }) => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/review-responses`, { entryId, verdict, flagReason: reason || null });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "review-responses"] });
      setShowFlagInput(false); setFlagReason("");
      if (variables.verdict === "flagged") {
        setShowFlagBanner(true);
        if (flagBannerTimerRef.current) clearTimeout(flagBannerTimerRef.current);
        flagBannerTimerRef.current = setTimeout(() => setShowFlagBanner(false), 5000);
      }
    },
    onError: () => { toast({ title: "Failed to save review", variant: "destructive" }); },
  });

  // ── Derived values ─────────────────────────────────────────────────────────
  const currentEntry = assignedEntries[currentIndex] ?? null;
  const currentPin = currentEntry ? pinByEntryId.get(currentEntry.id) : null;
  const currentPhoto = currentEntry?.photoId ? photoMap.get(currentEntry.photoId) : null;
  const isRevealed = currentEntry ? revealedEntries.has(currentEntry.id) : false;
  // Synchronous ready check — avoids the one-frame flash that a useEffect reset would cause
  const photoReadyKey = `${currentIndex}-${isRevealed}`;
  const photoReady = photoReadyForKey === photoReadyKey;
  const timerSeconds = currentEntry ? (timers.get(currentEntry.id) ?? null) : null;
  const existingResponse = currentEntry ? myResponses.get(currentEntry.id) : undefined;
  const isPinEntry = !!(currentPin && currentPin.xPercent !== undefined && currentPin.yPercent !== undefined);

  // ── Empty states ───────────────────────────────────────────────────────────
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground text-sm" data-testid="text-review-empty">No entries to review yet.</p>
        </CardContent>
      </Card>
    );
  }
  if (assignedEntries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground text-sm" data-testid="text-review-no-assignment">No entries assigned to you for review.</p>
        </CardContent>
      </Card>
    );
  }

  const thumbPercent = assignedEntries.length > 1 ? (currentIndex / (assignedEntries.length - 1)) * 100 : 0;

  const scrubTo = useCallback((clientX: number) => {
    const bar = scrubBarRef.current;
    if (!bar || assignedEntries.length === 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setCurrentIndex(Math.round(ratio * (assignedEntries.length - 1)));
  }, [assignedEntries.length]);

  const handleScrubMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isScrubbing.current = true;
    scrubTo(e.clientX);
    const onMove = (me: MouseEvent) => { if (isScrubbing.current) scrubTo(me.clientX); };
    const onUp = () => { isScrubbing.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [scrubTo]);

  const handleScrubTouchStart = useCallback((e: React.TouchEvent) => {
    isScrubbing.current = true;
    scrubTo(e.touches[0].clientX);
    const onMove = (te: TouchEvent) => { if (isScrubbing.current) scrubTo(te.touches[0].clientX); };
    const onEnd = () => { isScrubbing.current = false; window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
  }, [scrubTo]);

  return (
    <div className="space-y-4" data-testid="review-tab-container">
      <h2 className="text-lg font-bold underline text-center" data-testid="heading-review">Review</h2>
      {showFlagBanner && (
        <div
          className="flex items-center gap-2 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-400 dark:border-yellow-700 px-4 py-2.5 text-sm text-yellow-800 dark:text-yellow-300"
          data-testid="banner-flag-moved"
        >
          <Flag className="h-4 w-4 shrink-0 text-yellow-500" />
          <span>Reel moved to Flagged tab for further review.</span>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="outline" data-testid="badge-review-progress">
            {reviewedCount} of {assignedEntries.length} reviewed
          </Badge>
          {sortedUsers.length > 1 && (
            <Badge variant="secondary" data-testid="badge-review-users">{sortedUsers.length} reviewers</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground" data-testid="text-review-entry-counter">
          Entry {currentIndex + 1} of {assignedEntries.length}
        </div>
      </div>

      {/* Scrub bar — click or drag to jump to any entry */}
      <div
        ref={scrubBarRef}
        role="slider"
        aria-label="Entry position"
        aria-valuemin={0}
        aria-valuemax={assignedEntries.length - 1}
        aria-valuenow={currentIndex}
        className="relative h-5 flex items-center cursor-pointer select-none"
        data-testid="scrub-bar-review"
        onMouseDown={handleScrubMouseDown}
        onTouchStart={handleScrubTouchStart}
      >
        {/* Track */}
        <div className="absolute inset-x-0 h-2 rounded-full bg-muted top-1/2 -translate-y-1/2" />
        {/* Per-entry reviewed dots */}
        {assignedEntries.map((entry, idx) => {
          if (!myResponses.has(entry.id)) return null;
          const pct = assignedEntries.length > 1 ? (idx / (assignedEntries.length - 1)) * 100 : 0;
          return (
            <div
              key={entry.id}
              className="absolute w-0.5 h-3 rounded-sm bg-primary/70 -translate-x-1/2 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${pct}%` }}
            />
          );
        })}
        {/* Thumb */}
        <div
          className="absolute w-4 h-4 rounded-full bg-primary border-2 border-background shadow -translate-x-1/2 top-1/2 -translate-y-1/2 transition-[left] duration-75"
          style={{ left: `${thumbPercent}%` }}
          data-testid="scrub-thumb-review"
        />
      </div>

      {/* My completion banner */}
      {reviewedCount >= assignedEntries.length && assignedEntries.length > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3"
          data-testid="banner-review-complete"
        >
          <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              You've reviewed all your assigned entries!
            </p>
            {allReviewerStatus.some(s => s.userId !== currentUserId && !s.complete) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Waiting for other reviewers to finish…
              </p>
            )}
            {allReviewerStatus.length > 0 && allReviewerStatus.every(s => s.complete) && (
              <p className="text-xs text-green-600 dark:text-green-400 font-medium mt-0.5">
                All reviewers are done!
              </p>
            )}
          </div>
        </div>
      )}

      {/* Team progress — only shown when there are multiple reviewers */}
      {sortedUsers.length > 1 && allReviewerStatus.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2" data-testid="panel-team-progress">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Team Progress</p>
          <div className="grid gap-1.5">
            {allReviewerStatus.map(s => (
              <div key={s.userId} className="flex items-center gap-2" data-testid={`reviewer-status-${s.userId}`}>
                {s.complete ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className={`text-sm flex-1 truncate ${s.userId === currentUserId ? "font-semibold" : ""}`}>
                  {s.userId === currentUserId ? "You" : s.username}
                </span>
                <span className={`text-xs tabular-nums font-mono ${s.complete ? "text-green-500" : "text-muted-foreground"}`}>
                  {s.done}/{s.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entry card */}
      {currentEntry && (
        <Card data-testid={`card-review-entry-${currentEntry.id}`}>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {currentEntry.aisle && `Aisle ${currentEntry.aisle}`}
                {currentEntry.section && ` - Section ${currentEntry.section}`}
              </span>
              {currentEntry.reelCount && currentEntry.reelCount > 1 && (
                <span>{currentEntry.reelCount} reels</span>
              )}
            </div>

            {/* Final category — large, visibly colored */}
            {(() => {
              const catalogCode = (currentEntry.reelTag || currentPin?.wireDetails)?.trim().toUpperCase() || null;
              const vendorCode = (currentPin?.vendorCode || currentEntry.manufacturer)?.trim().toUpperCase() || null;
              if (!catalogCode && !vendorCode) {
                return (
                  <p className="text-muted-foreground text-base italic" data-testid="text-review-category">
                    No category assigned
                  </p>
                );
              }
              return (
                <div className="flex items-baseline gap-3 flex-wrap" data-testid="text-review-category">
                  {catalogCode && (
                    <span className="text-xl font-bold text-[hsl(18_85%_55%)] leading-tight font-mono">
                      {catalogCode}
                    </span>
                  )}
                  {vendorCode && (
                    <span className="text-base font-semibold text-[hsl(200_70%_55%)]">
                      {vendorCode}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Photo / spinner area */}
            <div className="flex justify-center min-h-[200px] items-center">
              {!isRevealed ? (
                <div className="flex flex-col items-center gap-3" data-testid="review-spinner">
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Syncing... {timerSeconds !== null ? `${timerSeconds}s` : ""}
                  </p>
                </div>
              ) : isPinEntry && currentPhoto ? (
                /* ── Pin / AI Scanner view ── */
                <div className="w-full space-y-2">
                  <div className="relative">
                    <CropCanvas
                      photoUrl={getPhotoUrl(currentPhoto)}
                      xPercent={currentPin!.xPercent}
                      yPercent={currentPin!.yPercent}
                      zoomLevel={pinZoom}
                      panX={pinPanX}
                      panY={pinPanY}
                      onPan={(px, py) => { setPinPanX(px); setPinPanY(py); }}
                      onReady={() => setPhotoReadyForKey(photoReadyKey)}
                      size={260}
                    />
                    {!photoReady && (
                      <div
                        className="absolute inset-0 rounded-md bg-muted animate-pulse"
                        style={{ width: 260, height: 260 }}
                        data-testid="photo-skeleton"
                      />
                    )}
                  </div>
                  {/* Zoom controls — mirrors AI Scanner */}
                  <div className="flex items-center gap-1.5 px-1">
                    <ZoomOut
                      className="h-5 w-5 text-muted-foreground flex-shrink-0 cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => setCardZoom(Math.min(ZOOM_MAX, pinZoom + ZOOM_CLICK_STEP))}
                      data-testid="btn-review-zoom-out"
                    />
                    <Slider
                      value={[ZOOM_MAX - pinZoom + ZOOM_MIN]}
                      min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP}
                      onValueChange={([v]) => setCardZoom(ZOOM_MAX - v + ZOOM_MIN)}
                      className="flex-1"
                      data-testid="slider-review-zoom"
                    />
                    <ZoomIn
                      className="h-5 w-5 text-muted-foreground flex-shrink-0 cursor-pointer hover:text-foreground transition-colors"
                      onClick={() => setCardZoom(Math.max(ZOOM_MIN, pinZoom - ZOOM_CLICK_STEP))}
                      data-testid="btn-review-zoom-in"
                    />
                  </div>
                </div>
              ) : currentPhoto ? (
                /* ── Reel IDs view ── */
                <div className="w-full relative">
                  <ZoomablePhoto
                    photoUrl={getPhotoUrl(currentPhoto)}
                    scale={photoScale}
                    panX={photoPanX}
                    panY={photoPanY}
                    rotation={photoRotation}
                    panMode={panMode}
                    onScale={setPhotoScale}
                    onPan={(x, y) => { setPhotoPanX(x); setPhotoPanY(y); }}
                    onRotate={setPhotoRotation}
                    onPanMode={setPanMode}
                    onReady={() => setPhotoReadyForKey(photoReadyKey)}
                  />
                  {!photoReady && (
                    <div
                      className="absolute inset-0 rounded-md bg-muted animate-pulse"
                      data-testid="photo-skeleton"
                    />
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <AlertTriangle className="h-8 w-8" />
                  <p className="text-sm">No photo available</p>
                </div>
              )}
            </div>

            {/* Verdict actions */}
            {isRevealed && (
              <div className="space-y-3">
                {existingResponse && (
                  <div className="text-center text-sm" data-testid="text-existing-verdict">
                    <Badge variant={existingResponse.verdict === "approved" ? "default" : "destructive"}>
                      {existingResponse.verdict === "approved" ? "Approved" : "Flagged"}
                    </Badge>
                    {existingResponse.verdict === "flagged" && existingResponse.flagReason && (
                      <p className="mt-1 text-muted-foreground text-xs">Reason: {existingResponse.flagReason}</p>
                    )}
                    <p className="mt-1 text-muted-foreground text-xs">You can change your verdict below.</p>
                  </div>
                )}

                {showFlagInput ? (
                  <div className="space-y-2" data-testid="flag-reason-container">
                    <Input
                      placeholder="Reason for flagging (optional)"
                      value={flagReason}
                      onChange={(e) => setFlagReason(e.target.value)}
                      data-testid="input-flag-reason"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="destructive" className="flex-1"
                        onClick={() => submitReview.mutate({ entryId: currentEntry.id, verdict: "flagged", reason: flagReason })}
                        disabled={submitReview.isPending}
                        data-testid="button-confirm-flag"
                      >
                        {submitReview.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Flag className="h-4 w-4 mr-1" />}
                        Confirm Flag
                      </Button>
                      <Button variant="outline" onClick={() => { setShowFlagInput(false); setFlagReason(""); }} data-testid="button-cancel-flag">
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2" data-testid="review-actions">
                    <Button
                      variant="default" className="flex-1"
                      onClick={() => submitReview.mutate({ entryId: currentEntry.id, verdict: "approved" })}
                      disabled={submitReview.isPending}
                      data-testid="button-approve"
                    >
                      {submitReview.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                      Approve
                    </Button>
                    <Button
                      variant="outline" className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                      onClick={() => setShowFlagInput(true)}
                      disabled={submitReview.isPending}
                      data-testid="button-flag"
                    >
                      <Flag className="h-4 w-4 mr-1" />
                      Flag
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <Button
          variant="outline" size="sm"
          onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
          data-testid="button-review-prev"
          className="border-primary text-primary"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={() => setCurrentIndex(i => Math.min(assignedEntries.length - 1, i + 1))}
          disabled={currentIndex >= assignedEntries.length - 1}
          data-testid="button-review-next"
          className="border-primary text-primary"
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
