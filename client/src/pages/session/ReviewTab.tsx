import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Check, Flag, Loader2, AlertTriangle, ChevronLeft, ChevronRight,
  ZoomIn, ZoomOut, RotateCw, RotateCcw, Move, CheckCircle2, Clock, X, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

type ZoomablePhotoHandle = { clamp: (px: number, py: number, s: number) => { x: number; y: number } };

const ZoomablePhoto = forwardRef<ZoomablePhotoHandle, {
  photoUrl: string; scale: number; panX: number; panY: number;
  rotation: number; panMode: boolean;
  onScale: (s: number) => void; onPan: (x: number, y: number) => void;
  onReady?: () => void;
}>(function ZoomablePhoto({
  photoUrl, scale, panX, panY, rotation, panMode,
  onScale, onPan, onReady,
}, ref) {
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

  useImperativeHandle(ref, () => ({ clamp }), [clamp]);

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
  );
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPhotoUrl(photo: Photo): string {
  const key = photo.objectStorageKey;
  if (key.startsWith("/uploads/") || key.startsWith("/objects/")) return key;
  return `/uploads/${key}`;
}

const lateJoinerQueueCache = new Map<string, number[]>();

// ─── ReviewTab ────────────────────────────────────────────────────────────────

export default function ReviewTab({
  sessionId, entries, photos, onlineUsers = [], serverReviewCohort = null,
}: {
  sessionId: number; entries: Entry[]; photos: Photo[]; onlineUsers?: OnlineUser[];
  serverReviewCohort?: string | null;
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

  const detailPhotoByPinLabel = useMemo(() => {
    const map = new Map<string, Photo>();
    for (const p of photos) {
      if (p.isDetailShot && p.linkedPinLabel) {
        map.set(p.linkedPinLabel, p);
      }
    }
    return map;
  }, [photos]);

  const flaggedEntryIds = useMemo(() => {
    const ids = new Set<number>();
    for (const p of sessionPins) {
      if (p.entryId && p.flagged) ids.add(p.entryId);
    }
    return ids;
  }, [sessionPins]);

  const sortedEntries = useMemo(() => {
    return [...entries]
      .filter(entry => {
        if (flaggedEntryIds.has(entry.id)) return false;
        if (entry.notes && entry.notes.includes("[Resolved from flag")) return false;
        return true;
      })
      .sort((a, b) => a.id - b.id);
  }, [entries, flaggedEntryIds]);

  const sortedUsers = useMemo(() => {
    if (onlineUsers.length === 0 && currentUserId) return [{ userId: currentUserId, username: user?.firstName || currentUserId }];
    return [...onlineUsers].sort((a, b) => a.userId.localeCompare(b.userId));
  }, [onlineUsers, currentUserId, user]);

  // ── Server-anchored cohort ─────────────────────────────────────────────────
  // The stable cohort is the authoritative source for entry→reviewer mapping.
  // Priority order:
  //   1. serverReviewCohort prop  — already-anchored value from the session DB row
  //      (available immediately when the session has been reviewed before).
  //   2. anchoredCohort state     — returned by POST /review-cohort called on mount;
  //      this is the first write for brand-new sessions.
  // While neither is available we show a brief loading gate so no assignments
  // are ever derived from the non-deterministic online-presence array.
  const [anchoredCohort, setAnchoredCohort] = useState<Array<{ userId: string; username: string }> | null>(null);
  const cohortAnchorRef = useRef<{ sid: number; called: boolean }>({ sid: -1, called: false });

  useEffect(() => {
    if (!sessionId || !currentUserId) return;
    // Skip if already anchored from the session prop (fast path for re-visits).
    if (serverReviewCohort) return;
    // Skip if we already successfully anchored for this session.
    if (cohortAnchorRef.current.sid === sessionId && cohortAnchorRef.current.called) return;
    cohortAnchorRef.current = { sid: sessionId, called: true };

    apiRequest("POST", `/api/sessions/${sessionId}/review-cohort`)
      .then(r => r.json())
      .then((data: { cohort: Array<{ userId: string; username: string }> }) => {
        if (Array.isArray(data.cohort) && data.cohort.length > 0) {
          setAnchoredCohort(data.cohort);
          // Refresh the session record so the parent's serverReviewCohort prop
          // is populated on subsequent renders (avoids redundant round-trips).
          queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
        }
      })
      .catch(() => {
        // Server call failed (transient network error). Provide a best-effort
        // local fallback so reviewers are never permanently stuck on the loading
        // screen. Once the session prop is eventually refreshed (e.g. on the
        // next query cycle), propCohort will take priority over this fallback.
        setAnchoredCohort(sortedUsers.length > 0 ? [...sortedUsers] : [{ userId: currentUserId, username: currentUserId }]);
      });
  // sortedUsers and currentUserId are intentionally excluded from deps so a
  // change in online presence does not re-fire the anchor call after success.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, currentUserId, serverReviewCohort]);

  // Reset anchored cohort state when the session changes.
  useEffect(() => {
    setAnchoredCohort(null);
  }, [sessionId]);

  // Parse the prop value (used for sessions that were already reviewed).
  const propCohort = useMemo<Array<{ userId: string; username: string }> | null>(() => {
    if (!serverReviewCohort) return null;
    try {
      const parsed = JSON.parse(serverReviewCohort);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
    return null;
  }, [serverReviewCohort]);

  // The single canonical cohort used everywhere.  Both propCohort and
  // anchoredCohort originate from the same server-side value (the
  // review_cohort DB column), so they will always agree once set.
  // stableCohort is null only while the server round-trip is in flight.
  const stableCohort = propCohort ?? anchoredCohort;
  // Flag: true while we're waiting for the server to return the anchored cohort.
  const cohortPending = stableCohort === null;
  // Null-safe alias used in all memos that run before the cohortPending gate.
  // An empty array causes those memos to short-circuit harmlessly (length === 0
  // guards are already present throughout).
  const effectiveCohort = stableCohort ?? [];

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
      if (effectiveCohort.length === 0) return [];
      const userIndex = effectiveCohort.findIndex(u => u.userId === currentUserId);
      if (userIndex === -1) return [];
      return sortedEntries.filter((_, i) => i % effectiveCohort.length === userIndex);
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

    if (effectiveCohort.length === 0) return [];
    const avgCount = Math.max(1, Math.floor(sortedEntries.length / effectiveCohort.length));

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
  }, [sortedEntries, effectiveCohort, currentUserId, isLateJoiner, reviewResponses, sessionId]);

  const myResponses = useMemo(() => {
    const map = new Map<number, ReviewResponse>();
    for (const r of reviewResponses) { if (r.userId === currentUserId) map.set(r.entryId, r); }
    return map;
  }, [reviewResponses, currentUserId]);

  // Stable ordering: reviewed entries first (preserving original order), then unreviewed.
  // Computed once when data is ready; does not reshuffle as the user reviews mid-session.
  const [orderedEntries, setOrderedEntries] = useState<Entry[]>([]);
  const hasComputedOrder = useRef(false);

  useEffect(() => {
    if (hasComputedOrder.current) return;
    if (assignedEntries.length === 0 || responsesLoading) return;
    const reviewed = assignedEntries.filter(e => myResponses.has(e.id));
    const unreviewed = assignedEntries.filter(e => !myResponses.has(e.id));
    hasComputedOrder.current = true;
    setOrderedEntries([...reviewed, ...unreviewed]);
  }, [assignedEntries, myResponses, responsesLoading]);

  // Prune entries removed from assignedEntries after the order was computed, clamp currentIndex,
  // and append any entries that arrived in assignedEntries after the initial snapshot was taken.
  useEffect(() => {
    if (!hasComputedOrder.current || orderedEntries.length === 0) return;
    const assignedIds = new Set(assignedEntries.map(e => e.id));
    const orderedIds = new Set(orderedEntries.map(e => e.id));
    const pruned = orderedEntries.filter(e => assignedIds.has(e.id));
    const incoming = assignedEntries.filter(e => !orderedIds.has(e.id));
    if (pruned.length !== orderedEntries.length || incoming.length > 0) {
      const updated = [...pruned, ...incoming];
      setOrderedEntries(updated);
      setCurrentIndex(prev => (updated.length === 0 ? 0 : Math.min(prev, updated.length - 1)));
    }
  }, [assignedEntries, orderedEntries]);

  // Use the stable ordered list for display; fall back to assignedEntries before it's ready.
  const displayEntries = orderedEntries.length > 0 ? orderedEntries : assignedEntries;

  const reviewedCount = useMemo(() => assignedEntries.filter(e => myResponses.has(e.id)).length, [assignedEntries, myResponses]);

  const allReviewerStatus = useMemo(() => {
    if (effectiveCohort.length === 0 || sortedEntries.length === 0) return [];
    const statuses = effectiveCohort.map((u, idx) => {
      const assigned = sortedEntries.filter((_, i) => i % effectiveCohort.length === idx);
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
  }, [effectiveCohort, sortedEntries, reviewResponses, isLateJoiner, currentUserId, assignedEntries, sortedUsers, user]);

  // ── Reveal timer state ─────────────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const hasAutoAdvanced = useRef(false);
  const scrubBarRef = useRef<HTMLDivElement>(null);
  const isScrubbing = useRef(false);

  // On first load, jump straight to the first unreviewed entry in the reordered list
  useEffect(() => {
    if (hasAutoAdvanced.current) return;
    if (orderedEntries.length === 0 || responsesLoading) return;
    const firstUnreviewed = orderedEntries.findIndex(e => !myResponses.has(e.id));
    if (firstUnreviewed > 0) setCurrentIndex(firstUnreviewed);
    hasAutoAdvanced.current = true;
  }, [orderedEntries, myResponses, responsesLoading]);

  // Wall-clock timestamps when each entry's reveal timer was started.
  // Stored in a ref so re-renders never reset the countdown — the remaining
  // time is always derived from (Date.now() - startTimestamp).
  const revealStartTimestamps = useRef<Map<number, number>>(new Map());
  // Ref-backed revealed set: source of truth, avoids stale-closure issues
  // when the interval fires between React renders.
  const revealedRef = useRef<Set<number>>(new Set());
  // State copy for rendering — updated whenever an entry transitions to revealed.
  const [revealedEntries, setRevealedEntries] = useState<Set<number>>(new Set());
  // Tick counter: forces a re-render every second so countdown labels stay current.
  const [, setTimerTick] = useState(0);
  const [flagReason, setFlagReason] = useState("");
  const [showFlagInput, setShowFlagInput] = useState(false);
  const [justActed, setJustActed] = useState(false);

  // Reset reveal state when the session changes so stale entry IDs from a
  // previous session never bleed into a newly-opened one.
  useEffect(() => {
    revealStartTimestamps.current.clear();
    revealedRef.current.clear();
    setRevealedEntries(new Set());
  }, [sessionId]);

  // Register each newly-assigned entry with the timer system.
  // Already-revealed or already-tracked entries are skipped so re-renders
  // caused by WebSocket updates or query refetches don't restart the clock.
  useEffect(() => {
    let anyImmediateReveal = false;
    for (const entry of assignedEntries) {
      const id = entry.id;
      if (revealedRef.current.has(id) || revealStartTimestamps.current.has(id)) continue;
      if (myResponses.has(id)) {
        revealedRef.current.add(id);
        anyImmediateReveal = true;
        continue;
      }
      const createdAt = entry.createdAt ? new Date(entry.createdAt).getTime() : Date.now();
      const elapsed = Date.now() - createdAt;
      if (elapsed >= REVEAL_DELAY_MS) {
        revealedRef.current.add(id);
        anyImmediateReveal = true;
      } else {
        // Record the entry's creation time as its timer origin. Using
        // createdAt (not Date.now()) means the clock survives remounts and
        // refetches — the server timestamp is the single source of truth.
        revealStartTimestamps.current.set(id, createdAt);
      }
    }
    if (anyImmediateReveal) {
      setRevealedEntries(new Set(revealedRef.current));
    }
  }, [assignedEntries, myResponses]);

  // Single 1-second interval shared across all pending entries.
  // Runs for the component lifetime; no per-entry intervals needed.
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      let anyNewlyRevealed = false;
      for (const [id, startTs] of revealStartTimestamps.current) {
        if (now - startTs >= REVEAL_DELAY_MS) {
          revealStartTimestamps.current.delete(id);
          revealedRef.current.add(id);
          anyNewlyRevealed = true;
        }
      }
      if (anyNewlyRevealed) setRevealedEntries(new Set(revealedRef.current));
      // Always tick so countdown labels re-compute from the latest Date.now().
      setTimerTick(t => t + 1);
    }, 1000);
    return () => clearInterval(iv);
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
  const zoomablePhotoRef = useRef<ZoomablePhotoHandle>(null);
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
    setJustActed(false);
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
      // Invalidate the session record so serverReviewCohort is refreshed the
      // first time a review response is submitted (server anchors the cohort then).
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      setShowFlagInput(false); setFlagReason("");
      setJustActed(true);
      if (variables.verdict === "flagged") {
        setShowFlagBanner(true);
        if (flagBannerTimerRef.current) clearTimeout(flagBannerTimerRef.current);
        flagBannerTimerRef.current = setTimeout(() => setShowFlagBanner(false), 5000);
      }
    },
    onError: () => { toast({ title: "Failed to save review", variant: "destructive" }); },
  });

  const removeApproval = useMutation({
    mutationFn: async (entryId: number) => {
      const res = await apiRequest("DELETE", `/api/sessions/${sessionId}/review-responses/${entryId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "review-responses"] });
    },
    onError: () => { toast({ title: "Failed to remove approval", variant: "destructive" }); },
  });

  // ── Derived values ─────────────────────────────────────────────────────────
  const currentEntry = displayEntries[currentIndex] ?? null;
  const currentPin = currentEntry ? pinByEntryId.get(currentEntry.id) : null;
  const currentPhoto = currentPin?.photoId
    ? photoMap.get(currentPin.photoId) ?? (currentEntry?.photoId ? photoMap.get(currentEntry.photoId) : null)
    : currentEntry?.photoId ? photoMap.get(currentEntry.photoId) : null;
  const detailPhoto = currentPin?.label ? detailPhotoByPinLabel.get(currentPin.label) : undefined;
  const isRevealed = currentEntry ? revealedEntries.has(currentEntry.id) : false;
  // Synchronous ready check — avoids the one-frame flash that a useEffect reset would cause
  const photoReadyKey = `${currentIndex}-${isRevealed}`;
  const photoReady = photoReadyForKey === photoReadyKey;
  // Derive remaining seconds from the wall-clock timestamp — never from state —
  // so the displayed count always reflects elapsed real time regardless of how
  // many re-renders have occurred since the timer was registered.
  const timerSeconds = (() => {
    if (!currentEntry) return null;
    const startTs = revealStartTimestamps.current.get(currentEntry.id);
    if (startTs === undefined) return null;
    return Math.max(0, Math.ceil((REVEAL_DELAY_MS - (Date.now() - startTs)) / 1000));
  })();
  const existingResponse = currentEntry ? myResponses.get(currentEntry.id) : undefined;
  const isPinEntry = !!(currentPin && currentPin.xPercent !== undefined && currentPin.yPercent !== undefined);

  // ── Loading gate: wait for server-anchored cohort ─────────────────────────
  // Block all assignment rendering until we have the stable cohort from the
  // server, so entry→reviewer mappings are never based on ephemeral WS presence.
  if (cohortPending) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm" data-testid="text-review-cohort-pending">Preparing review assignments…</p>
        </CardContent>
      </Card>
    );
  }

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

  const thumbPercent = displayEntries.length > 1 ? (currentIndex / (displayEntries.length - 1)) * 100 : 0;

  const scrubTo = useCallback((clientX: number) => {
    const bar = scrubBarRef.current;
    if (!bar || displayEntries.length === 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setCurrentIndex(Math.round(ratio * (displayEntries.length - 1)));
  }, [displayEntries.length]);

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
    <ErrorBoundary fallback={
      <div className="flex flex-col items-center justify-center p-8 gap-3 text-center text-sm">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="font-medium">The review tab encountered an unexpected error.</p>
        <button className="underline text-muted-foreground" onClick={() => window.location.reload()}>Reload page</button>
      </div>
    }>
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
          <Badge variant="outline" data-testid="badge-review-progress" className="flex items-center gap-1">
            {reviewedCount} of {displayEntries.length}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-full p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="Why this count may differ from other totals"
                    data-testid="icon-review-count-info"
                  >
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs" side="bottom">
                  Flagged and resolved entries are excluded from this count. If multiple reviewers are active, this total reflects only your assigned subset.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {" reviewed"}
          </Badge>
          {sortedUsers.length > 1 && (
            <Badge variant="secondary" data-testid="badge-review-users">{sortedUsers.length} reviewers</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground" data-testid="text-review-entry-counter">
          Entry {currentIndex + 1} of {displayEntries.length}
        </div>
      </div>

      {/* Scrub bar — click or drag to jump to any entry */}
      <div
        ref={scrubBarRef}
        role="slider"
        aria-label="Entry position"
        aria-valuemin={0}
        aria-valuemax={displayEntries.length - 1}
        aria-valuenow={currentIndex}
        className="relative h-5 flex items-center cursor-pointer select-none"
        data-testid="scrub-bar-review"
        onMouseDown={handleScrubMouseDown}
        onTouchStart={handleScrubTouchStart}
      >
        {/* Track — contiguous bands per entry */}
        <div className="absolute inset-x-0 h-3 rounded-full overflow-hidden top-1/2 -translate-y-1/2 flex">
          {displayEntries.map((entry, idx) => {
            const response = myResponses.get(entry.id);
            const bandColor = !response ? "bg-muted" : response.verdict === "flagged" ? "bg-yellow-600" : "bg-green-500";
            return (
              <div
                key={entry.id}
                className={`flex-1 ${bandColor} ${idx === 0 ? "rounded-l-full" : ""} ${idx === displayEntries.length - 1 ? "rounded-r-full" : ""}`}
                style={{ minWidth: 0 }}
              />
            );
          })}
        </div>
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
            {sortedUsers.length > 1 && allReviewerStatus.some(s => s.userId !== currentUserId && !s.complete) && (
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
        <div className="border border-blue-500 sm:!border-blue-600/50 rounded-lg p-4 space-y-4" data-testid={`card-review-entry-${currentEntry.id}`}>
            <div className="relative text-sm text-muted-foreground text-center">
              <span>
                {currentEntry.aisle && `Aisle ${currentEntry.aisle}`}
                {currentEntry.section && ` - Section ${currentEntry.section}`}
              </span>
              {currentEntry.reelCount && currentEntry.reelCount > 1 && (
                <span className="absolute right-0 top-0">{currentEntry.reelCount} reels</span>
              )}
            </div>

            {/* Final catalog — large, visibly colored */}
            {(() => {
              const catalogCode = (currentEntry.reelTag || currentPin?.wireDetails)?.trim().toUpperCase() || null;
              const vendorCode = (currentPin?.vendorCode || currentEntry.manufacturer)?.trim().toUpperCase() || null;
              if (!catalogCode && !vendorCode) {
                return (
                  <p className="text-muted-foreground text-base italic text-center" data-testid="text-review-catalog">
                    No catalog assigned
                  </p>
                );
              }
              return (
                <div className="flex items-baseline gap-3 flex-wrap justify-center" data-testid="text-review-catalog">
                  {catalogCode && (
                    <span className="text-[22px] font-bold text-black leading-tight font-mono">
                      {catalogCode}
                    </span>
                  )}
                  {vendorCode && (
                    <span className="text-[18px] font-bold text-black">
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
              ) : isPinEntry && detailPhoto ? (
                /* ── Detail photo cropped view (linked detail shot, centered) ── */
                <div className="w-full">
                  <div className="flex justify-center">
                    <div className="flex gap-2 items-center">
                      <div className="relative inline-block">
                        <CropCanvas
                          photoUrl={getPhotoUrl(detailPhoto)}
                          xPercent={50}
                          yPercent={50}
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
                      <div className="flex flex-col gap-1">
                        <button
                          className="photo-overlay-btn"
                          onClick={() => setCardZoom(Math.max(ZOOM_MIN, pinZoom - ZOOM_CLICK_STEP))}
                          title="Zoom in"
                          data-testid="btn-review-detail-zoom-in"
                        >
                          <ZoomIn className="h-4 w-4" />
                        </button>
                        <button
                          className="photo-overlay-btn"
                          onClick={() => setCardZoom(Math.min(ZOOM_MAX, pinZoom + ZOOM_CLICK_STEP))}
                          title="Zoom out"
                          data-testid="btn-review-detail-zoom-out"
                        >
                          <ZoomOut className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : isPinEntry && currentPhoto ? (
                /* ── Pin / AI Scanner view (cropped) ── */
                <div className="w-full">
                  <div className="flex justify-center">
                    <div className="flex gap-2 items-center">
                      <div className="relative inline-block">
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
                      <div className="flex flex-col gap-1">
                        <button
                          className="photo-overlay-btn"
                          onClick={() => setCardZoom(Math.max(ZOOM_MIN, pinZoom - ZOOM_CLICK_STEP))}
                          title="Zoom in"
                          data-testid="btn-review-zoom-in"
                        >
                          <ZoomIn className="h-4 w-4" />
                        </button>
                        <button
                          className="photo-overlay-btn"
                          onClick={() => setCardZoom(Math.min(ZOOM_MAX, pinZoom + ZOOM_CLICK_STEP))}
                          title="Zoom out"
                          data-testid="btn-review-zoom-out"
                        >
                          <ZoomOut className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : currentPhoto ? (
                /* ── Reel IDs view ── */
                <div className="w-full flex gap-2 items-center">
                  <div className="relative flex-1">
                    <ZoomablePhoto
                      ref={zoomablePhotoRef}
                      photoUrl={getPhotoUrl(currentPhoto)}
                      scale={photoScale}
                      panX={photoPanX}
                      panY={photoPanY}
                      rotation={photoRotation}
                      panMode={panMode}
                      onScale={setPhotoScale}
                      onPan={(x, y) => { setPhotoPanX(x); setPhotoPanY(y); }}
                      onReady={() => setPhotoReadyForKey(photoReadyKey)}
                    />
                    {!photoReady && (
                      <div
                        className="absolute inset-0 rounded-md bg-muted animate-pulse"
                        data-testid="photo-skeleton"
                      />
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      className="photo-overlay-btn"
                      onClick={() => { const s = Math.min(12, photoScale + 0.5); setPhotoScale(s); const c = zoomablePhotoRef.current?.clamp(photoPanX, photoPanY, s) ?? { x: 0, y: 0 }; setPhotoPanX(c.x); setPhotoPanY(c.y); }}
                      title="Zoom in"
                      data-testid="button-review-zoom-in"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <button
                      className="photo-overlay-btn"
                      onClick={() => { const s = Math.max(1, photoScale - 0.5); setPhotoScale(s); const c = zoomablePhotoRef.current?.clamp(photoPanX, photoPanY, s) ?? { x: 0, y: 0 }; setPhotoPanX(c.x); setPhotoPanY(c.y); }}
                      title="Zoom out"
                      data-testid="button-review-zoom-out"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                      className={`photo-overlay-btn ${panMode ? "photo-overlay-btn-active" : ""}`}
                      onClick={() => setPanMode(!panMode)}
                      title={panMode ? "Exit pan mode" : "Pan mode"}
                      data-testid="button-review-pan-mode"
                    >
                      <Move className="h-4 w-4" />
                    </button>
                    <button
                      className="photo-overlay-btn"
                      onClick={() => setPhotoRotation((photoRotation + 90) % 360)}
                      title="Rotate clockwise"
                      data-testid="button-review-rotate-cw"
                    >
                      <RotateCw className="h-4 w-4" />
                    </button>
                    <button
                      className="photo-overlay-btn"
                      onClick={() => setPhotoRotation((photoRotation - 90 + 360) % 360)}
                      title="Rotate counter-clockwise"
                      data-testid="button-review-rotate-ccw"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </div>
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
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitReview.mutate({ entryId: currentEntry.id, verdict: "flagged", reason: flagReason }); } }}
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
                    {existingResponse?.verdict === "approved" ? (
                      <Button
                        variant="outline" className="flex-1 border-muted-foreground/30 text-muted-foreground hover:bg-muted"
                        onClick={() => removeApproval.mutate(currentEntry.id)}
                        disabled={removeApproval.isPending}
                        data-testid="button-remove-approval"
                      >
                        {removeApproval.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <X className="h-4 w-4 mr-1" />}
                        Remove Approval
                      </Button>
                    ) : (
                      <Button
                        variant="default" className="flex-1"
                        onClick={() => submitReview.mutate({ entryId: currentEntry.id, verdict: "approved" })}
                        disabled={submitReview.isPending}
                        data-testid="button-approve"
                      >
                        {submitReview.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                        Approve
                      </Button>
                    )}
                    {existingResponse?.verdict === "flagged" ? (
                      <Button
                        variant="outline" className="flex-1 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                        onClick={() => removeApproval.mutate(currentEntry.id)}
                        disabled={removeApproval.isPending}
                        data-testid="button-unflag"
                      >
                        {removeApproval.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Flag className="h-4 w-4 mr-1" />}
                        Un-Flag
                      </Button>
                    ) : (
                      <Button
                        variant="outline" className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => setShowFlagInput(true)}
                        disabled={submitReview.isPending}
                        data-testid="button-flag"
                      >
                        <Flag className="h-4 w-4 mr-1" />
                        Flag
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>
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
          onClick={() => setCurrentIndex(i => Math.min(displayEntries.length - 1, i + 1))}
          disabled={currentIndex >= displayEntries.length - 1}
          data-testid="button-review-next"
          className={`border-primary text-primary transition-all${justActed ? " ring-2 ring-primary ring-offset-1 bg-primary/10 animate-pulse" : ""}`}
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  </ErrorBoundary>
  );
}
