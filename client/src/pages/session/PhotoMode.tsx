import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Camera, Plus, Trash2, RotateCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  Loader2, RotateCcw, AlertTriangle, Move, StickyNote, Focus, Eye, EyeOff,
  AlertCircle, Flag, ImagePlus, Pencil, ListPlus, ChevronDown, ChevronUp,
  ScanLine, X as PanelCloseX, Pipette, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastAction } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent,
} from "@/components/ui/sheet";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { createEntryWithOfflineFallback } from "@/lib/offlineEntryCreate";
import { saveToQueue } from "@/lib/offlineQueue";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { lookupCatalog, userWireCatalogToParsedEntry, type ParsedCatalogEntry } from "@/lib/wireReference";
import { toDisplayUnit, toBaseFeet, unitLabel } from "@/lib/unit-conversion";
import type { UnitType } from "@/lib/unit-conversion";
import { useWireCatalogs } from "@/hooks/use-wire-catalogs";
import type { Photo, Pin, Entry } from "@shared/schema";
import ReelCropPreview from "./ReelCropPreview";
import type { LocalPin } from "./types";
import { deriveVendorCode, formatPinLabel, generateDetailPinLabel } from "./utils";
import { useVendorCodes } from "@/hooks/use-vendor-codes";
import { useTimezone } from "@/hooks/use-timezone";
import { formatFullTimestamp } from "@/lib/timezone";
import { createDirectPhotoRegistrationKey, directPhotoFileKey } from "@/lib/directPhotoRegistration";
import SingleEntryMode from "./SingleEntryMode";
import LabelScannerTab from "./LabelScannerTab";
import { scanPanelOpenKey, scannerBatchKey } from "@/lib/storageKeys";

const BLUE_SHADES_CSS = [
  "rgba(59,130,246,1)",
  "rgba(56,189,248,1)",
  "rgba(99,102,241,1)",
  "rgba(29,78,216,1)",
  "rgba(6,182,212,1)",
  "rgba(139,92,246,1)",
];


type OnlineUser = { userId: string; username: string };

export default function PhotoMode({ sessionId, photos, navigateToPhotoId, navigateAisle, navigateSection, navigateToPinId, onNavigated, canEdit = true, initialPhotoIndex = 0, onPushUndo, onClearUndoHistory, undoRedoSignal, onDraftPinsHint, pinRefreshSignal, onCurrentPhotoChange, isAdmin = false, onPinDataChanged, onlineUsers = [], initialScanPanelOpen = false, onJumpToStripPhoto, flushRef, onScanApplied, onPanStateChange, onTriggerUndo }: { sessionId: number; photos: Photo[]; navigateToPhotoId?: number | null; navigateAisle?: string; navigateSection?: string; navigateToPinId?: number | null; onNavigated?: () => void; canEdit?: boolean; initialPhotoIndex?: number; onPushUndo?: (action: any) => void; onClearUndoHistory?: () => void; undoRedoSignal?: number; onDraftPinsHint?: (aisle: string, section: string) => void; pinRefreshSignal?: number; onCurrentPhotoChange?: (photoId: number | null) => void; isAdmin?: boolean; onPinDataChanged?: () => void; onlineUsers?: OnlineUser[]; initialScanPanelOpen?: boolean; onJumpToStripPhoto?: (photoId: number) => void; flushRef?: React.MutableRefObject<(() => Promise<void>) | null>; onScanApplied?: (sectionKey: string) => void; onPanStateChange?: (active: boolean) => void; onTriggerUndo?: () => void }) {
  const tz = useTimezone();
  const { identityId } = useAuth();
  const { toast } = useToast();
  const onTriggerUndoRef = useRef(onTriggerUndo);
  useEffect(() => { onTriggerUndoRef.current = onTriggerUndo; }, [onTriggerUndo]);
  const { uploadFile, isUploading } = useUpload();
  const { allCodes: vendorCodes, addCustomCode } = useVendorCodes();
  const { catalogs: userCatalogs } = useWireCatalogs();
  const userParsedCatalog = useMemo(
    () => userCatalogs.map(userWireCatalogToParsedEntry),
    [userCatalogs]
  );
  const { data: photoSettings } = useQuery<{ defaultUnit: string }>({
    queryKey: ["/api/settings"],
    select: (data: any) => ({ defaultUnit: data?.defaultUnit ?? "feet" }),
  });
  const currentUnit: UnitType = (photoSettings?.defaultUnit as UnitType) || "feet";
  const uLabel = unitLabel(currentUnit);
  const [customCodeInput, setCustomCodeInput] = useState("");
  const [customCodePinId, setCustomCodePinId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pendingRegistrationKeysRef = useRef(new Map<string, string>());
  const [aisle, setAisle] = useState("");
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{ url: string; objectPath: string; section: string; aisle?: string; dbId?: number; filename?: string; timestamp?: string; notes?: string; isDetailShot?: boolean; parentPhotoId?: number; linkedPinLabel?: string; pinScale?: number; rotation?: number }>>([]);
  const [currentPhotoIdx, setCurrentPhotoIdx] = useState(0);
  const initialRestoredRef = useRef(false);
  const saveEnabledRef = useRef(false);
  const [viewingNearbyIdx, setViewingNearbyIdx] = useState<number | null>(null);

  const { data: incompletePinsData } = useQuery<{ photoId: number; incompleteCount: number }[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"],
    enabled: sessionId > 0,
    refetchInterval: 10000,
  });

  const { data: sessionEntries } = useQuery<Entry[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "entries"],
    enabled: sessionId > 0,
  });

  const incompletePinsMap = new Map<number, number>();
  if (incompletePinsData) {
    for (const item of incompletePinsData) {
      incompletePinsMap.set(item.photoId, item.incompleteCount);
    }
  }

  const totalIncompletePins = incompletePinsData ? incompletePinsData.reduce((sum, item) => sum + item.incompleteCount, 0) : 0;

  useEffect(() => {
    if (viewingNearbyIdx !== null && viewingNearbyIdx >= uploadedPhotos.length) {
      setViewingNearbyIdx(null);
    }
  }, [uploadedPhotos.length, viewingNearbyIdx]);

  useEffect(() => {
    if (viewingNearbyIdx === null || viewingNearbyIdx === currentPhotoIdx) {
      setNearbyCommittedPins([]);
      return;
    }
    const nearbyPhoto = uploadedPhotos[viewingNearbyIdx];
    if (!nearbyPhoto?.dbId) {
      setNearbyCommittedPins([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/photos/${nearbyPhoto.dbId}/pins`);
        const dbPins: Pin[] = await res.json();
        if (cancelled) return;
        const committed = dbPins.filter(p => !!p.entryId);
        setNearbyCommittedPins(committed.map(p => ({
          id: `nearby-committed-${p.id}`,
          x: p.xPercent,
          y: p.yPercent,
          label: p.label || "001",
          reelCount: p.reelCount || 1,
        })));
      } catch {
        if (!cancelled) setNearbyCommittedPins([]);
      }
    })();
    return () => { cancelled = true; };
  }, [viewingNearbyIdx, currentPhotoIdx, uploadedPhotos]);
  const [localPins, _setLocalPins] = useState<LocalPin[]>([]);
  const localPinsRef = useRef<LocalPin[]>([]);
  // Tracks draftClientIds that the user has explicitly removed since the last
  // successful save. Sent as `deletedClientIds` in PUT draft-pins requests so the
  // server can delete those specific rows without touching any collaborator pins.
  const deletedDraftClientIdsRef = useRef<Set<string>>(new Set());
  const setLocalPins = useCallback((updater: LocalPin[] | ((prev: LocalPin[]) => LocalPin[])) => {
    _setLocalPins((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Track pins explicitly removed from the local list so we can send
      // deletedClientIds to the server on the next save.
      if (next.length < prev.length) {
        const nextIds = new Set(next.map(p => p.draftClientId || p.id));
        for (const removed of prev) {
          const clientId = removed.draftClientId || removed.id;
          if (!nextIds.has(clientId)) {
            deletedDraftClientIdsRef.current.add(clientId);
          }
        }
      }
      localPinsRef.current = next;
      return next;
    });
  }, []);
  /** Reset pins from a DB load — clears the pending-delete set so we don't
   *  accidentally delete pins that were just fetched from the server. */
  const resetLocalPins = useCallback((newPins: LocalPin[]) => {
    deletedDraftClientIdsRef.current.clear();
    _setLocalPins(newPins);
    localPinsRef.current = newPins;
  }, []);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [highlightedCommittedPinDbId, setHighlightedCommittedPinDbId] = useState<number | null>(null);
  const [pinsVisible, setPinsVisible] = useState(true);
  const [photoLoadedKey, setPhotoLoadedKey] = useState("");
  const [photoErrorKey, setPhotoErrorKey] = useState("");
  const [previewHeight, setPreviewHeight] = useState(0);
  const [focusedFootagePinId, setFocusedFootagePinId] = useState<string | null>(null);
  const [committedPins, setCommittedPins] = useState<Array<{ id: string; dbId?: number; x: number; y: number; label: string; reelCount: number; entryId?: number; flagged?: boolean; updatedAt?: string }>>([]);
  const [pinLoadKey, setPinLoadKey] = useState(0);
  const [nearbyCommittedPins, setNearbyCommittedPins] = useState<Array<{ id: string; x: number; y: number; label: string; reelCount: number }>>([]);
  const [pinsLoaded, setPinsLoaded] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutoSave = useRef(false);
  const globalMaxPinRef = useRef<number>(0);
  const pinFetchCache = useRef<Map<number, Pin[]>>(new Map());
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const prevPhotoDbIdRef = useRef<number | undefined>(undefined);
  const [relabelPinId, setRelabelPinId] = useState<string | null>(null);
  const [relabelValue, setRelabelValue] = useState("");
  const [relabelIsCommitted, setRelabelIsCommitted] = useState(false);
  const [editingCommittedPinId, setEditingCommittedPinId] = useState<string | null>(null);
  const [committedEditState, setCommittedEditState] = useState<{ label: string; wireDetails: string; vendorCode: string; footage: string; reelCount: string }>({ label: "", wireDetails: "", vendorCode: "", footage: "", reelCount: "1" });
  const [committedCatalogSuggestions, setCommittedCatalogSuggestions] = useState<ParsedCatalogEntry[]>([]);
  const [showCommittedCatalogSuggestions, setShowCommittedCatalogSuggestions] = useState(false);
  const dragRef = useRef<{
    isDragging: boolean;
    pinId: string | null;
    startX: number;
    startY: number;
    moved: boolean;
  }>({ isDragging: false, pinId: null, startX: 0, startY: 0, moved: false });
  const justDraggedRef = useRef(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; errors: string[] } | null>(null);
  const [conflictDialog, setConflictDialog] = useState<{ conflicts: Array<{ label: string; entryId?: number; dbPinId?: number }>; pinsToCommit: LocalPin[] } | null>(null);
  const [detailWarnLabels, setDetailWarnLabels] = useState<string[]>([]);
  const dismissedDetailWarn = useRef<Set<string>>(new Set());
  const detectedPinIdsRef = useRef<Set<string>>(new Set());
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [photoInputValue, setPhotoInputValue] = useState<string | null>(null);
  const [flagPopoverPinId, setFlagPopoverPinId] = useState<string | null>(null);
  const [flagReasonDraft, setFlagReasonDraft] = useState("");
  const [activeSuggestionPin, setActiveSuggestionPin] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ParsedCatalogEntry[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [suggestionPos, setSuggestionPos] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeSuggestionPin) return;
    const close = (e: Event) => {
      if (suggestionsRef.current?.contains(e.target as Node)) return;
      setActiveSuggestionPin(null);
      setSuggestions([]);
      setSuggestionIndex(-1);
      setSuggestionPos(null);
    };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [activeSuggestionPin]);

  useEffect(() => {
    if (!selectedPinId) return;
    rowRefs.current.get(selectedPinId)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedPinId]);

  useEffect(() => {
    apiRequest("GET", `/api/sessions/${sessionId}/pins`).then(async (res) => {
      const allPins: { label?: string | null }[] = await res.json();
      const max = allPins.reduce((m, p) => {
        const n = parseInt(p.label || "0", 10);
        return isNaN(n) ? m : Math.max(m, n);
      }, 0);
      globalMaxPinRef.current = Math.max(globalMaxPinRef.current, max);
    }).catch(() => {});
  }, [sessionId]);

  const [scanPanelOpen, setScanPanelOpen] = useState(() => {
    if (initialScanPanelOpen) return true;
    try {
      return localStorage.getItem(scanPanelOpenKey(sessionId)) === "true";
    } catch { return false; }
  });
  const [scanBatchMode, setScanBatchMode] = useState(() => {
    try { return sessionStorage.getItem(scannerBatchKey(sessionId)) === "true"; } catch { return false; }
  });
  const [scanPanelCurrentPhotoId, setScanPanelCurrentPhotoId] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleScanPanel = useCallback(() => {
    setScanPanelOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(scanPanelOpenKey(sessionId), String(next)); } catch {}
      return next;
    });
  }, [sessionId]);

  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [isDetectingReceived, setIsDetectingReceived] = useState(false);
  const [colorPickMode, setColorPickMode] = useState(false);
  const [, setDetectedBoxes] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const [pinScale, setPinScale] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(0.15);
  const pinScaleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotationSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinTableRef = useRef<HTMLTableElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const photoImgRef = useRef<HTMLImageElement>(null);
  const [photoNotes, setPhotoNotes] = useState("");
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aisleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const batchProgressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
      if (aisleSaveTimer.current) clearTimeout(aisleSaveTimer.current);
      if (sectionSaveTimer.current) clearTimeout(sectionSaveTimer.current);
      if (pinScaleSaveTimer.current) clearTimeout(pinScaleSaveTimer.current);
      if (batchProgressTimer.current) clearTimeout(batchProgressTimer.current);
    };
  }, []);

  const clampPan = useCallback((px: number, py: number, s: number) => {
    const el = containerRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const maxPanX = (rect.width * (s - 1)) / (2 * s);
    const maxPanY = (rect.height * (s - 1)) / (2 * s);
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, px)),
      y: Math.max(-maxPanY, Math.min(maxPanY, py)),
    };
  }, []);

  useEffect(() => {
    const clamped = clampPan(panX, panY, scale);
    if (clamped.x !== panX || clamped.y !== panY) {
      setPanX(clamped.x);
      setPanY(clamped.y);
    }
  }, [scale, panX, panY, clampPan]);

  const currentPhoto = uploadedPhotos[currentPhotoIdx];
  const effectiveCanEdit = canEdit;
  const otherPhotosIncompleteCount = totalIncompletePins - (currentPhoto?.dbId ? (incompletePinsMap.get(currentPhoto.dbId) || 0) : 0);
  const nextReelCount = localPins.length + otherPhotosIncompleteCount;
  const displayedPhotoIdx = viewingNearbyIdx !== null ? viewingNearbyIdx : currentPhotoIdx;
  const displayedPhoto = uploadedPhotos[displayedPhotoIdx];
  const photoSrc = displayedPhoto?.url || currentPhoto?.url || "";

  const linkedPinShadeMapForPhoto = useMemo(() => {
    const map = new Map<string, number>();
    const photoDbId = displayedPhoto?.dbId;
    if (!photoDbId || displayedPhoto?.isDetailShot) return map;
    const labels: string[] = [];
    for (const p of photos) {
      if (p.parentPhotoId === photoDbId && p.linkedPinLabel && !labels.includes(p.linkedPinLabel)) {
        labels.push(p.linkedPinLabel);
      }
    }
    labels.sort();
    labels.forEach((l, i) => map.set(l, i));
    return map;
  }, [photos, displayedPhoto?.dbId, displayedPhoto?.isDetailShot]);

  const detailShadeIndexForPhoto = useMemo(() => {
    if (!displayedPhoto?.isDetailShot || !displayedPhoto?.parentPhotoId) return 0;
    const currentLinkedPin = photos.find(p => p.id === displayedPhoto.dbId)?.linkedPinLabel;
    if (!currentLinkedPin) return 0;
    const sibs: string[] = [];
    for (const p of photos) {
      if (p.parentPhotoId === displayedPhoto.parentPhotoId && p.linkedPinLabel && !sibs.includes(p.linkedPinLabel)) {
        sibs.push(p.linkedPinLabel);
      }
    }
    sibs.sort();
    return Math.max(0, sibs.indexOf(currentLinkedPin));
  }, [photos, displayedPhoto?.isDetailShot, displayedPhoto?.parentPhotoId, displayedPhoto?.dbId]);

  const isDisplayedPhotoDetail = displayedPhoto?.isDetailShot || false;

  const [showLinkedBanner, setShowLinkedBanner] = useState(false);
  const linkedBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (linkedBannerTimerRef.current !== null) clearTimeout(linkedBannerTimerRef.current);
    if (isDisplayedPhotoDetail) {
      setShowLinkedBanner(true);
      linkedBannerTimerRef.current = setTimeout(() => {
        setShowLinkedBanner(false);
        linkedBannerTimerRef.current = null;
      }, 3000);
    } else {
      setShowLinkedBanner(false);
    }
    return () => {
      if (linkedBannerTimerRef.current !== null) clearTimeout(linkedBannerTimerRef.current);
    };
  }, [currentPhotoIdx, isDisplayedPhotoDetail]);

  const photoLoaded = photoLoadedKey === photoSrc;
  const imageError = photoErrorKey === photoSrc && !!photoSrc;

  useEffect(() => {
    if (photos.length === 0) return;
    const shouldFullSync = uploadedPhotos.length === 0;
    const needsNavTarget = navigateToPhotoId && !uploadedPhotos.some(p => p.dbId === navigateToPhotoId) && photos.some(p => p.id === navigateToPhotoId);
    if (!shouldFullSync && !needsNavTarget) return;
    const mapped = photos.map((p) => {
      const filename = p.originalFilename || `Photo_${p.id}`;
      return {
        url: p.objectStorageKey.startsWith("/uploads/") ? p.objectStorageKey : p.objectStorageKey.startsWith("/objects/") ? p.objectStorageKey : `/uploads/${p.objectStorageKey}`,
        objectPath: p.objectStorageKey,
        section: p.section || "",
        aisle: p.aisle || "",
        dbId: p.id,
        filename,
        timestamp: p.createdAt ? formatFullTimestamp(p.createdAt, tz) : undefined,
        notes: p.notes || "",
        isDetailShot: p.isDetailShot || false,
        parentPhotoId: p.parentPhotoId || undefined,
        linkedPinLabel: p.linkedPinLabel || undefined,
        pinScale: p.pinScale ?? 1,
        rotation: p.rotation ?? 0,
      };
    });
    mapped.sort((a, b) => {
      const aisleA = (a.aisle || "").toLowerCase();
      const aisleB = (b.aisle || "").toLowerCase();
      if (aisleA !== aisleB) return aisleA.localeCompare(aisleB);
      const secA = parseInt(a.section || "0", 10) || 0;
      const secB = parseInt(b.section || "0", 10) || 0;
      if (secA !== secB) return secA - secB;
      return (a.dbId || 0) - (b.dbId || 0);
    });
    const detailsByParent = new Map<number, typeof mapped>();
    const mainPhotos: typeof mapped = [];
    for (const photo of mapped) {
      if (photo.isDetailShot && photo.parentPhotoId != null) {
        if (!detailsByParent.has(photo.parentPhotoId)) detailsByParent.set(photo.parentPhotoId, []);
        detailsByParent.get(photo.parentPhotoId)!.push(photo);
      } else {
        mainPhotos.push(photo);
      }
    }
    const placedDetailIds = new Set<number>();
    const ordered: typeof mapped = [];
    for (const photo of mainPhotos) {
      ordered.push(photo);
      for (const detail of detailsByParent.get(photo.dbId!) || []) {
        ordered.push(detail);
        if (detail.dbId != null) placedDetailIds.add(detail.dbId);
      }
    }
    for (const details of detailsByParent.values()) {
      for (const d of details) {
        if (d.dbId == null || !placedDetailIds.has(d.dbId)) ordered.push(d);
      }
    }
    setUploadedPhotos(ordered);
    if (!navigateToPhotoId && !initialRestoredRef.current && initialPhotoIndex > 0 && initialPhotoIndex < mapped.length) {
      setCurrentPhotoIdx(initialPhotoIndex);
      const photo = mapped[initialPhotoIndex];
      if (photo?.aisle) setAisle(photo.aisle);
      initialRestoredRef.current = true;
      setTimeout(() => { saveEnabledRef.current = true; }, 3000);
    } else if (!navigateToPhotoId) {
      const firstAisle = mapped.find(p => p.aisle)?.aisle;
      if (firstAisle && !aisle) setAisle(firstAisle);
      if (!initialRestoredRef.current) {
        initialRestoredRef.current = true;
        setTimeout(() => { saveEnabledRef.current = true; }, 3000);
      }
    }
  }, [photos, navigateToPhotoId]);

  useEffect(() => {
    if (!navigateToPhotoId) return;
    const idx = uploadedPhotos.findIndex(p => p.dbId === navigateToPhotoId);
    if (idx >= 0) {
      setCurrentPhotoIdx(idx);
      setViewingNearbyIdx(null);
      setAisle(navigateAisle || "");
      if (navigateSection) {
        setUploadedPhotos(prev => prev.map((p, i) => i === idx ? { ...p, section: navigateSection } : p));
      }
      if (navigateToPinId) {
        setTimeout(() => {
          setHighlightedCommittedPinDbId(navigateToPinId);
          setTimeout(() => setHighlightedCommittedPinDbId(null), 9000);
        }, 200);
      }
      setTimeout(() => {
        const photoEl = document.querySelector('[data-testid="text-photo-info"], [data-testid="bottom-photo-nav"]');
        if (photoEl) photoEl.scrollIntoView({ behavior: "smooth", block: "center" });
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }, 100);
      onNavigated?.();
    }
  }, [navigateToPhotoId, uploadedPhotos]);

  useEffect(() => {
    const photo = uploadedPhotos[currentPhotoIdx];
    if (photo) {
      setAisle(photo.aisle || "");
    }
  }, [currentPhotoIdx, uploadedPhotos]);

  useEffect(() => {
    const photo = uploadedPhotos[currentPhotoIdx];
    const photoId = photo?.dbId ?? null;
    onCurrentPhotoChange?.(photoId);
    setScanPanelCurrentPhotoId(photoId);
  }, [currentPhotoIdx, uploadedPhotos]);

  const photoIdxSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!saveEnabledRef.current) return;
    if (uploadedPhotos.length === 0) return;
    const clampedIdx = Math.min(currentPhotoIdx, uploadedPhotos.length - 1);
    clearTimeout(photoIdxSaveTimer.current);
    photoIdxSaveTimer.current = setTimeout(() => {
      apiRequest("PATCH", `/api/sessions/${sessionId}`, { lastPhotoIndex: clampedIdx }).catch(() => {});
    }, 2000);
    return () => clearTimeout(photoIdxSaveTimer.current);
  }, [currentPhotoIdx, sessionId, uploadedPhotos.length]);

  const flushSavePins = useCallback(async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const photoDbId = uploadedPhotos[currentPhotoIdx]?.dbId;
    const pins = localPinsRef.current;
    if (!photoDbId) return;
    try {
      const deletedIds = [...deletedDraftClientIdsRef.current];
      deletedDraftClientIdsRef.current.clear();
      try {
        await apiRequest("PUT", `/api/photos/${photoDbId}/draft-pins`, {
          pins: pins.map(p => ({
            xPercent: p.x,
            yPercent: p.y,
            label: p.label,
            reelCount: p.reelCount,
            wireDetails: p.wireDetails || null,
            vendorCode: p.vendorCode || null,
            footage: p.footage || null,
            flagged: p.flagged || false,
            flagReason: p.flagReason || null,
            draftClientId: p.draftClientId || p.id,
          })),
          deletedClientIds: deletedIds,
        });
      } catch (err) {
        // Restore pending deletes so they're retried on the next save attempt.
        for (const id of deletedIds) deletedDraftClientIdsRef.current.add(id);
        throw err;
      }
    } catch {
    }
  }, [uploadedPhotos, currentPhotoIdx]);

  useEffect(() => {
    if (flushRef) flushRef.current = flushSavePins;
    return () => { if (flushRef) flushRef.current = null; };
  }, [flushRef, flushSavePins]);

  const detectReceivedLabels = useCallback(async () => {
    const photoId = currentPhoto?.dbId;
    if (!photoId || isDetectingReceived) return;
    setIsDetectingReceived(true);
    setDetectedBoxes([]);
    try {
      const res = await apiRequest("POST", `/api/photos/${photoId}/detect-received`, {});
      const data = await res.json();
      type Detection = { xPercent: number; yPercent: number; x1Percent: number; y1Percent: number; x2Percent: number; y2Percent: number };
      const { detections } = data as { detections: Detection[] };
      if (detections.length === 0) {
        toast({ title: "No RECEIVED labels found", description: "No bright green RECEIVED labels detected in this photo." });
        return;
      }
      const PROXIMITY_THRESHOLD = 3; // percent — detections within this distance of an existing pin are skipped
      const existingPins = localPinsRef.current;
      const uniqueDetections = detections.filter(d =>
        !existingPins.some(p =>
          Math.abs(p.x - d.xPercent) < PROXIMITY_THRESHOLD &&
          Math.abs(p.y - d.yPercent) < PROXIMITY_THRESHOLD
        )
      );
      const skipped = detections.length - uniqueDetections.length;
      if (uniqueDetections.length === 0) {
        toast({ title: "No new pins added", description: `All ${detections.length} detected label${detections.length !== 1 ? "s" : ""} already ${detections.length !== 1 ? "have" : "has"} a pin nearby.` });
        return;
      }
      const newPinIds: string[] = [];
      const newPins: LocalPin[] = uniqueDetections.map((d) => {
        const nextNumber = ++globalMaxPinRef.current;
        const id = `pin-detect-${Date.now()}-${nextNumber}`;
        newPinIds.push(id);
        return {
          id,
          x: d.xPercent,
          y: d.yPercent,
          label: String(nextNumber).padStart(3, "0"),
          reelCount: 1,
        };
      });
      detectedPinIdsRef.current = new Set(newPinIds);
      setDetectedBoxes(uniqueDetections.map(d => ({ x1: d.x1Percent, y1: d.y1Percent, x2: d.x2Percent, y2: d.y2Percent })));
      const merged = [...localPinsRef.current, ...newPins].sort(
        (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })
      );
      localPinsRef.current = merged;
      _setLocalPins(merged);
      // Snapshot and clear before the async call so new deletions that arrive
      // during the await are not incorrectly discarded on retry.
      const deletedIds = [...deletedDraftClientIdsRef.current];
      deletedDraftClientIdsRef.current.clear();
      try {
        await apiRequest("PUT", `/api/photos/${photoId}/draft-pins`, {
          pins: merged.map(p => ({
            xPercent: p.x,
            yPercent: p.y,
            label: p.label,
            reelCount: p.reelCount,
            wireDetails: p.wireDetails || null,
            vendorCode: p.vendorCode || null,
            footage: p.footage || null,
            flagged: p.flagged || false,
            flagReason: p.flagReason || null,
            draftClientId: p.draftClientId || p.id,
          })),
          deletedClientIds: deletedIds,
        });
      } catch (err) {
        for (const id of deletedIds) deletedDraftClientIdsRef.current.add(id);
        console.error("Failed to save auto-detected draft pins:", err);
      }
      toast({
        title: `Placed ${uniqueDetections.length} pin${uniqueDetections.length !== 1 ? "s" : ""} automatically`,
        description: skipped > 0
          ? `${skipped} detection${skipped !== 1 ? "s" : ""} skipped — pin already nearby`
          : `${uniqueDetections.length} RECEIVED label${uniqueDetections.length !== 1 ? "s" : ""} detected`,
      });
    } catch {
      toast({ title: "Detection failed", description: "Could not analyze the photo. Please try again.", variant: "destructive" });
    } finally {
      setIsDetectingReceived(false);
    }
  }, [currentPhoto?.dbId, isDetectingReceived, toast]);

  const applyPins = useCallback((dbPins: Pin[]) => {
    const draftPins = dbPins.filter(p => !p.entryId);
    const committed = dbPins.filter(p => !!p.entryId);
    const photoMax = dbPins.reduce((m, p) => {
      const n = parseInt(p.label || "0", 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    globalMaxPinRef.current = Math.max(globalMaxPinRef.current, photoMax);
    setCommittedPins(committed.map(p => ({
      id: `committed-${p.id}`,
      dbId: p.id,
      x: p.xPercent,
      y: p.yPercent,
      label: p.label || "001",
      reelCount: p.reelCount || 1,
      entryId: p.entryId ?? undefined,
      flagged: p.flagged || false,
      updatedAt: p.updatedAt ? (p.updatedAt instanceof Date ? p.updatedAt.toISOString() : new Date(p.updatedAt as unknown as string).toISOString()) : undefined,
    })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
    if (draftPins.length > 0) {
      resetLocalPins(draftPins.map(p => ({
        id: p.draftClientId || `pin-${p.id}`,
        draftClientId: p.draftClientId || undefined,
        x: p.xPercent,
        y: p.yPercent,
        label: p.label || "001",
        reelCount: p.reelCount || 1,
        wireDetails: p.wireDetails || undefined,
        vendorCode: p.vendorCode || undefined,
        footage: p.footage || undefined,
        flagged: p.flagged || false,
        flagReason: p.flagReason || undefined,
      })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })));
    } else {
      resetLocalPins([]);
    }
  }, []);

  useEffect(() => {
    if (!currentPhoto?.dbId) {
      setPinsLoaded(false);
      return;
    }
    dismissedDetailWarn.current.clear();
    setDetectedBoxes([]);
    detectedPinIdsRef.current = new Set();
    // Evict the cache for the photo we just left (its pins may have been modified)
    if (prevPhotoDbIdRef.current && prevPhotoDbIdRef.current !== currentPhoto.dbId) {
      pinFetchCache.current.delete(prevPhotoDbIdRef.current);
    }
    prevPhotoDbIdRef.current = currentPhoto.dbId;

    skipAutoSave.current = true;
    const cached = pinFetchCache.current.get(currentPhoto.dbId);
    if (cached) {
      applyPins(cached);
      setPinsLoaded(true);
      setTimeout(() => { skipAutoSave.current = false; }, 500);
      return;
    }
    setPinsLoaded(false);
    const loadPins = async () => {
      try {
        const res = await apiRequest("GET", `/api/photos/${currentPhoto.dbId}/pins`);
        const dbPins: Pin[] = await res.json();
        pinFetchCache.current.set(currentPhoto.dbId!, dbPins);
        applyPins(dbPins);
      } catch {
        setLocalPins([]);
      }
      setPinsLoaded(true);
      setTimeout(() => { skipAutoSave.current = false; }, 500);
    };
    loadPins();
  }, [currentPhoto?.dbId, applyPins, pinLoadKey]);

  useEffect(() => {
    setEditingCommittedPinId(null);
  }, [currentPhotoIdx]);

  useEffect(() => {
    if (!pinRefreshSignal) return;
    pinFetchCache.current.clear();
    setPinLoadKey(k => k + 1);
  }, [pinRefreshSignal]);

  useEffect(() => {
    if (!undoRedoSignal || !currentPhoto?.dbId) return;
    pinFetchCache.current.delete(currentPhoto.dbId);
    setPinLoadKey(k => k + 1);
  }, [undoRedoSignal, currentPhoto?.dbId]);

  useEffect(() => {
    if (currentPhoto && onDraftPinsHint) {
      onDraftPinsHint(currentPhoto.aisle || "—", currentPhoto.section || "—");
    }
  }, [currentPhoto?.aisle, currentPhoto?.section, onDraftPinsHint]);

  // Preload images and prefetch pins for adjacent photos to eliminate navigation lag
  useEffect(() => {
    if (uploadedPhotos.length <= 1) return;
    const offsets = [-1, 1, 2];
    for (const offset of offsets) {
      const idx = (currentPhotoIdx + offset + uploadedPhotos.length) % uploadedPhotos.length;
      const photo = uploadedPhotos[idx];
      if (!photo) continue;
      const img = new window.Image();
      img.src = photo.url;
      if (photo.dbId && !pinFetchCache.current.has(photo.dbId)) {
        const photoDbId = photo.dbId;
        apiRequest("GET", `/api/photos/${photoDbId}/pins`)
          .then(res => res.json())
          .then((dbPins: Pin[]) => { pinFetchCache.current.set(photoDbId, dbPins); })
          .catch(() => {});
      }
    }
  }, [currentPhotoIdx, uploadedPhotos]);

  useEffect(() => {
    if (pinScaleSaveTimer.current) {
      clearTimeout(pinScaleSaveTimer.current);
      pinScaleSaveTimer.current = null;
    }
    setPinScale(displayedPhoto?.pinScale ?? 1);
  }, [displayedPhoto?.dbId]);

  const savePinScale = useCallback((newScale: number) => {
    const clamped = Math.max(0.5, Math.min(5, newScale));
    setPinScale(clamped);
    const photoId = displayedPhoto?.dbId;
    if (!photoId) return;
    setUploadedPhotos(prev => prev.map(p => p.dbId === photoId ? { ...p, pinScale: clamped } : p));
    if (pinScaleSaveTimer.current) clearTimeout(pinScaleSaveTimer.current);
    pinScaleSaveTimer.current = setTimeout(async () => {
      try {
        await apiRequest("PATCH", `/api/photos/${photoId}`, { pinScale: clamped });
      } catch (err) {
        console.error("Failed to save pin scale:", err);
      }
    }, 500);
  }, [displayedPhoto?.dbId]);

  useEffect(() => {
    if (!currentPhoto?.dbId || !pinsLoaded || skipAutoSave.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      // Snapshot and clear before the async call so new deletions that happen
      // during the await are not incorrectly discarded.
      const deletedIds = [...deletedDraftClientIdsRef.current];
      deletedDraftClientIdsRef.current.clear();
      try {
        await apiRequest("PUT", `/api/photos/${currentPhoto.dbId}/draft-pins`, {
          pins: localPins.map(p => ({
            xPercent: p.x,
            yPercent: p.y,
            label: p.label,
            reelCount: p.reelCount,
            wireDetails: p.wireDetails || null,
            vendorCode: p.vendorCode || null,
            footage: p.footage || null,
            flagged: p.flagged || false,
            flagReason: p.flagReason || null,
            draftClientId: p.draftClientId || p.id,
          })),
          deletedClientIds: deletedIds,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
      } catch {
        // Restore pending deletes so they're retried on the next auto-save.
        for (const id of deletedIds) deletedDraftClientIdsRef.current.add(id);
      }
    }, 1000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [localPins, currentPhoto?.dbId, pinsLoaded]);

  useEffect(() => {
    if (noteSaveTimer.current) {
      clearTimeout(noteSaveTimer.current);
      noteSaveTimer.current = null;
    }
    if (sectionSaveTimer.current) {
      clearTimeout(sectionSaveTimer.current);
      sectionSaveTimer.current = null;
    }
    if (aisleSaveTimer.current) {
      clearTimeout(aisleSaveTimer.current);
      aisleSaveTimer.current = null;
    }
    if (currentPhoto) {
      setPhotoNotes(currentPhoto.notes || "");
      setRotation(currentPhoto.rotation ?? 0);
    }
  }, [currentPhotoIdx, currentPhoto?.dbId]);

  const savePhotoMeta = useCallback(async (notes: string) => {
    if (!currentPhoto?.dbId) return;
    try {
      await apiRequest("PATCH", `/api/photos/${currentPhoto.dbId}`, {
        notes: notes || null,
      });
      setUploadedPhotos((prev) =>
        prev.map((p, i) =>
          i === currentPhotoIdx ? { ...p, notes } : p
        )
      );
    } catch (err) {
      console.error("Failed to save photo notes:", err);
      toast({ title: "Could not save photo notes", variant: "destructive" });
    }
  }, [currentPhoto?.dbId, currentPhotoIdx, toast]);

  const handleNotesChange = useCallback((val: string) => {
    setPhotoNotes(val);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      savePhotoMeta(val);
    }, 1200);
  }, [savePhotoMeta]);

  const appendAliasToPhotoNotes = useCallback((aliasLabel: string, pinLabel: string) => {
    const tag = `Alias: ${aliasLabel} (pin ${pinLabel})`;
    setPhotoNotes(prev => {
      if (prev.includes(tag)) return prev;
      const updated = prev ? `${prev}\n${tag}` : tag;
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
      noteSaveTimer.current = setTimeout(() => savePhotoMeta(updated), 1200);
      return updated;
    });
  }, [savePhotoMeta]);

  const getNextReceivingSection = useCallback(() => {
    const allReceivingPhotos = [
      ...photos.filter(p => (p.aisle || "").toLowerCase() === "receiving"),
      ...uploadedPhotos.filter(p => (p.aisle || "").toLowerCase() === "receiving" && !photos.some(pp => pp.id === p.dbId)),
    ];
    const photoSections = allReceivingPhotos
      .map(p => parseInt(p.section || "0", 10))
      .filter(n => !isNaN(n));
    const entrySections = (sessionEntries || [])
      .filter(e => (e.aisle || "").toLowerCase() === "receiving")
      .map(e => parseInt(e.section || "0", 10))
      .filter(n => !isNaN(n));
    const allSections = [...photoSections, ...entrySections];
    const maxSection = allSections.length > 0 ? Math.max(...allSections) : 0;
    return String(maxSection + 1).padStart(3, "0");
  }, [photos, uploadedPhotos, sessionEntries]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const isRec = aisle.trim().toLowerCase() === "receiving";
    let nextRecNum = isRec ? parseInt(getNextReceivingSection(), 10) : 0;

    for (const file of files) {
      const fileKey = await directPhotoFileKey(file);
      const registrationKey = pendingRegistrationKeysRef.current.get(fileKey)
        ?? createDirectPhotoRegistrationKey();
      pendingRegistrationKeysRef.current.set(fileKey, registrationKey);
      try {
        const uploadResult = await uploadFile(file);
        if (!uploadResult.success) {
          if (uploadResult.networkError) {
            const blob = file.slice(0, file.size, file.type);
            const queueId = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            let sectionVal = "";
            if (isRec) { sectionVal = String(nextRecNum).padStart(3, "0"); nextRecNum++; }
            await saveToQueue({ id: queueId, registrationKey: queueId, sessionId, userId: identityId, blob, aisle, section: sectionVal, notes: "", isReceiving: isRec, isOnFloor: false, createdAt: Date.now() });
            toast({ title: "Photo queued", description: `${file.name} will upload when back online` });
          } else {
            toast({ title: "Upload failed", description: `Could not upload ${file.name}. Please try again.`, variant: "destructive" });
          }
          continue;
        }
        const result = uploadResult.data;
        let sectionVal = "";
        if (isRec) {
          sectionVal = String(nextRecNum).padStart(3, "0");
          nextRecNum++;
        }
        const res = await apiRequest("POST", `/api/sessions/${sessionId}/photos`, {
          registrationKey,
          objectStorageKey: result.objectPath,
          originalFilename: file.name,
          mimeType: file.type,
          fileSize: result.metadata?.size || file.size,
          aisle,
          section: sectionVal,
        });
        const savedPhoto = await res.json();
        pendingRegistrationKeysRef.current.delete(fileKey);
        const savedObjectPath = savedPhoto.objectStorageKey || result.objectPath;
        const savedPhotoView = {
          url: savedObjectPath.startsWith("/uploads/") || savedObjectPath.startsWith("/objects/")
            ? savedObjectPath
            : `/uploads/${savedObjectPath}`,
          objectPath: savedObjectPath,
          section: savedPhoto.section || "",
          aisle: savedPhoto.aisle || "",
          dbId: savedPhoto.id,
          filename: savedPhoto.originalFilename || `Photo_${savedPhoto.id}`,
          timestamp: savedPhoto.createdAt ? formatFullTimestamp(savedPhoto.createdAt, tz) : undefined,
          notes: savedPhoto.notes || "",
          isDetailShot: savedPhoto.isDetailShot || false,
          parentPhotoId: savedPhoto.parentPhotoId || undefined,
          linkedPinLabel: savedPhoto.linkedPinLabel || undefined,
          pinScale: savedPhoto.pinScale ?? 1,
          rotation: savedPhoto.rotation ?? 0,
        };
        setUploadedPhotos((prev) => {
          const existingIndex = prev.findIndex(photo => photo.dbId === savedPhoto.id);
          if (existingIndex === -1) return [...prev, savedPhotoView];
          return prev.map((photo, index) => index === existingIndex ? savedPhotoView : photo);
        });
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString()] });
      } catch (err) {
        console.error("Photo upload error:", err);
        toast({ title: "Upload failed", description: `Error uploading ${file.name}: ${err instanceof Error ? err.message : "Unknown error"}`, variant: "destructive" });
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const lastTouchPanRef = useRef(false);
  const handleContainerClick = (e: React.MouseEvent) => {
    if (isPanning || panMode) return;
    if (lastTouchPanRef.current) { lastTouchPanRef.current = false; return; }
    if (viewingNearbyIdx !== null && viewingNearbyIdx !== currentPhotoIdx) return;
    if (!effectiveCanEdit && !colorPickMode) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const rawX = (e.clientX - rect.left) / rect.width;
    const rawY = (e.clientY - rect.top) / rect.height;

    if (rawX < 0.048 || rawX > 0.952) return;

    const cx = 0.5, cy = 0.5;
    let relX = rawX - cx;
    let relY = rawY - cy;

    relX /= scale;
    relY /= scale;

    relX -= panX / rect.width;
    relY -= panY / rect.height;

    const rad = -(rotation * Math.PI) / 180;
    const rotatedX = relX * Math.cos(rad) - relY * Math.sin(rad);
    const rotatedY = relX * Math.sin(rad) + relY * Math.cos(rad);

    const x = (rotatedX + cx) * 100;
    const y = (rotatedY + cy) * 100;

    if (x < 0 || x > 100 || y < 0 || y > 100) return;

    if (colorPickMode) {
      const photoId = currentPhoto?.dbId;
      if (!photoId) return;
      apiRequest("POST", `/api/photos/${photoId}/sample-pixel`, { xPercent: x, yPercent: y })
        .then(r => r.json())
        .then((data: { exact: { r: number; g: number; b: number }; avg: { r: number; g: number; b: number } }) => {
          const { r, g, b } = data.exact;
          const a = data.avg;
          // RGB → HSV (same algorithm used by detect-received)
          const rn = r / 255, gn = g / 255, bn = b / 255;
          const cmax = Math.max(rn, gn, bn);
          const cmin = Math.min(rn, gn, bn);
          const delta = cmax - cmin;
          let hue = 0;
          if (delta > 0) {
            if (cmax === rn) hue = 60 * (((gn - bn) / delta) % 6);
            else if (cmax === gn) hue = 60 * ((bn - rn) / delta + 2);
            else hue = 60 * ((rn - gn) / delta + 4);
          }
          if (hue < 0) hue += 360;
          const sat = cmax === 0 ? 0 : delta / cmax;
          const val = cmax;
          const wouldDetect =
            hue >= 90 && hue <= 160 && sat > 0.40 && val > 0.25;
          toast({
            title: `Color at (${x.toFixed(1)}%, ${y.toFixed(1)}%) — ${wouldDetect ? "✓ Green label MATCH" : "✗ No green label match"}`,
            description: `RGB (${r}, ${g}, ${b}) · 5×5 avg (${a.r}, ${a.g}, ${a.b}) · HSV H:${hue.toFixed(0)}° S:${(sat * 100).toFixed(0)}% V:${(val * 100).toFixed(0)}%  [need H:90–160° S>40% V>25%]`,
          });
        })
        .catch(() => toast({ title: "Could not sample pixel", variant: "destructive" }));
      return;
    }

    if (!effectiveCanEdit) return;

    let label: string;
    const isDetailWithPin = currentPhoto?.isDetailShot && currentPhoto?.linkedPinLabel;
    if (isDetailWithPin) {
      const existingLabels = [
        ...localPins.map(p => p.label),
        ...committedPins.map(p => p.label),
      ];
      label = generateDetailPinLabel(currentPhoto.linkedPinLabel!, existingLabels);
    } else {
      const nextNumber = globalMaxPinRef.current + 1;
      globalMaxPinRef.current = nextNumber;
      label = String(nextNumber).padStart(3, "0");
    }
    const newPin: LocalPin = {
      id: `pin-${Date.now()}`,
      x,
      y,
      label,
      reelCount: 1,
    };
    setLocalPins((prev) => [...prev, newPin]);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".pin-marker")) return;
    if (!panMode && scale <= 1) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, panX, panY };
    containerRef.current?.classList.add("grabbing");
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    const rawX = panStart.current.panX + dx / scale;
    const rawY = panStart.current.panY + dy / scale;
    const clamped = clampPan(rawX, rawY, scale);
    setPanX(clamped.x);
    setPanY(clamped.y);
  }, [isPanning, scale, clampPan]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    containerRef.current?.classList.remove("grabbing");
  }, []);

  useEffect(() => {
    if (isPanning) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isPanning, handleMouseMove, handleMouseUp]);

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panXRef = useRef(panX);
  panXRef.current = panX;
  const panYRef = useRef(panY);
  panYRef.current = panY;

  const zoomAtPoint = useCallback((clientX: number, clientY: number, newScale: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const oldScale = scaleRef.current;
    if (newScale === oldScale) return;
    const cursorX = (clientX - rect.left) / rect.width - 0.5;
    const cursorY = (clientY - rect.top) / rect.height - 0.5;
    const adjX = panXRef.current + cursorX * (1 / newScale - 1 / oldScale) * rect.width;
    const adjY = panYRef.current + cursorY * (1 / newScale - 1 / oldScale) * rect.height;
    const clamped = clampPan(adjX, adjY, newScale);
    setScale(newScale);
    setPanX(clamped.x);
    setPanY(clamped.y);
  }, [clampPan]);

  const zoomAtPointRef = useRef(zoomAtPoint);
  zoomAtPointRef.current = zoomAtPoint;

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) return;
      const target = e.target as HTMLElement;
      if (target.closest(".photo-scroll-strip") || target.closest(".photo-overlay-controls")) return;
      e.preventDefault();
      e.stopPropagation();
      const oldScale = scaleRef.current;
      const delta = e.ctrlKey ? -e.deltaY * 0.01 : (e.deltaY < 0 ? 0.2 : -0.2);
      const newScale = Math.min(12, Math.max(1, oldScale + delta));
      zoomAtPointRef.current(e.clientX, e.clientY, newScale);
    };

    const onGestureStart = (e: Event) => {
      const el = containerRef.current;
      if (el && el.contains(e.target as Node)) e.preventDefault();
    };
    const onGestureChange = (e: Event) => {
      const el = containerRef.current;
      if (el && el.contains(e.target as Node)) e.preventDefault();
    };

    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("gesturestart", onGestureStart, { passive: false } as any);
    document.addEventListener("gesturechange", onGestureChange, { passive: false } as any);
    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("gesturestart", onGestureStart);
      document.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  const pinchRef = useRef<{ dist: number; midX: number; midY: number; scale: number } | null>(null);
  const touchPanRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const panModeRef = useRef(panMode);
  panModeRef.current = panMode;

  const onPanStateChangeRef = useRef(onPanStateChange);
  useEffect(() => { onPanStateChangeRef.current = onPanStateChange; }, [onPanStateChange]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        touchPanRef.current = null;
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        pinchRef.current = {
          dist: Math.hypot(dx, dy),
          midX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          midY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
          scale: scaleRef.current,
        };
        onPanStateChangeRef.current?.(true);
      } else if (e.touches.length === 1 && (panModeRef.current || scaleRef.current > 1)) {
        if ((e.target as HTMLElement).closest(".pin-marker")) return;
        e.preventDefault();
        touchPanRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          panX: panXRef.current,
          panY: panYRef.current,
          moved: false,
        };
        onPanStateChangeRef.current?.(true);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / pinchRef.current.dist;
        const newScale = Math.min(12, Math.max(1, pinchRef.current.scale * ratio));
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        zoomAtPoint(midX, midY, newScale);
      } else if (e.touches.length === 1 && touchPanRef.current) {
        e.preventDefault();
        const dx = e.touches[0].clientX - touchPanRef.current.x;
        const dy = e.touches[0].clientY - touchPanRef.current.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) touchPanRef.current.moved = true;
        const rawX = touchPanRef.current.panX + dx / scaleRef.current;
        const rawY = touchPanRef.current.panY + dy / scaleRef.current;
        const clamped = clampPan(rawX, rawY, scaleRef.current);
        setPanX(clamped.x);
        setPanY(clamped.y);
      }
    };

    const onTouchEnd = () => {
      if (touchPanRef.current?.moved) {
        lastTouchPanRef.current = true;
      }
      pinchRef.current = null;
      touchPanRef.current = null;
      onPanStateChangeRef.current?.(false);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      onPanStateChangeRef.current?.(false);
    };
  }, [zoomAtPoint, clampPan]);

  const screenToImagePercent = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const rawX = (clientX - rect.left) / rect.width;
    const rawY = (clientY - rect.top) / rect.height;
    const cx = 0.5, cy = 0.5;
    let relX = rawX - cx;
    let relY = rawY - cy;
    relX /= scale;
    relY /= scale;
    relX -= panX / rect.width;
    relY -= panY / rect.height;
    const rad = -(rotation * Math.PI) / 180;
    const rX = relX * Math.cos(rad) - relY * Math.sin(rad);
    const rY = relX * Math.sin(rad) + relY * Math.cos(rad);
    const x = Math.max(0, Math.min(100, (rX + cx) * 100));
    const y = Math.max(0, Math.min(100, (rY + cy) * 100));
    return { x, y };
  }, [scale, panX, panY, rotation]);

  const startPinDrag = useCallback((e: React.MouseEvent | React.TouchEvent, pinId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = { isDragging: true, pinId, startX: clientX, startY: clientY, moved: false };

    const moveHandler = (ev: MouseEvent | TouchEvent) => {
      if (!dragRef.current.isDragging) return;
      ev.preventDefault();
      const cx = "touches" in ev ? (ev as TouchEvent).touches[0].clientX : (ev as MouseEvent).clientX;
      const cy = "touches" in ev ? (ev as TouchEvent).touches[0].clientY : (ev as MouseEvent).clientY;
      if (Math.abs(cx - dragRef.current.startX) > 3 || Math.abs(cy - dragRef.current.startY) > 3) {
        dragRef.current.moved = true;
      }
      const pos = screenToImagePercent(cx, cy);
      if (!pos) return;
      const marker = document.querySelector(`[data-pin-id="${pinId}"]`) as HTMLElement;
      if (marker) {
        marker.classList.add("dragging");
        marker.style.left = `${pos.x}%`;
        marker.style.top = `${pos.y}%`;
      }
    };

    const endHandler = (ev: MouseEvent | TouchEvent) => {
      if (!dragRef.current.isDragging) return;
      const cx = "changedTouches" in ev ? (ev as TouchEvent).changedTouches[0].clientX : (ev as MouseEvent).clientX;
      const cy = "changedTouches" in ev ? (ev as TouchEvent).changedTouches[0].clientY : (ev as MouseEvent).clientY;
      const pos = screenToImagePercent(cx, cy);
      const marker = document.querySelector(`[data-pin-id="${pinId}"]`) as HTMLElement;
      if (marker) marker.classList.remove("dragging");

      if (pos && dragRef.current.moved) {
        justDraggedRef.current = true;
        setLocalPins((prev) =>
          prev.map((p) => p.id === pinId ? { ...p, x: pos.x, y: pos.y } : p)
        );
      }
      dragRef.current = { isDragging: false, pinId: null, startX: 0, startY: 0, moved: false };
      document.removeEventListener("mousemove", moveHandler);
      document.removeEventListener("mouseup", endHandler);
      document.removeEventListener("touchmove", moveHandler);
      document.removeEventListener("touchend", endHandler);
    };

    document.addEventListener("mousemove", moveHandler);
    document.addEventListener("mouseup", endHandler);
    document.addEventListener("touchmove", moveHandler, { passive: false });
    document.addEventListener("touchend", endHandler);
  }, [screenToImagePercent]);

  const openRelabel = useCallback((pinId: string) => {
    const localPin = localPins.find((p) => p.id === pinId);
    if (localPin) {
      setRelabelPinId(pinId);
      setRelabelValue(localPin.label);
      setRelabelIsCommitted(false);
      return;
    }
    const committed = committedPins.find((p) => p.id === pinId);
    if (committed) {
      const matchedEntry = committed.entryId && sessionEntries ? sessionEntries.find(e => e.id === committed.entryId) : null;
      const rc = matchedEntry?.reelCount && matchedEntry.reelCount > 0 ? matchedEntry.reelCount : (committed.reelCount || 1);
      const totalFt = matchedEntry?.footage ? Number(matchedEntry.footage) : null;
      const perReelFt = totalFt !== null ? totalFt / rc : null;
      setEditingCommittedPinId(pinId);
      setCommittedEditState({
        label: committed.label,
        wireDetails: matchedEntry?.reelTag || matchedEntry?.wireType || "",
        vendorCode: matchedEntry?.manufacturer || "",
        footage: perReelFt !== null ? String(toDisplayUnit(perReelFt, currentUnit)) : "",
        reelCount: String(rc),
      });
      setCommittedCatalogSuggestions([]);
      setShowCommittedCatalogSuggestions(false);
    }
  }, [localPins, committedPins, sessionEntries, currentUnit]);

  const applyRelabel = useCallback(async () => {
    if (!relabelPinId || !relabelValue.trim()) return;
    const newLabel = relabelValue.trim();
    if (relabelIsCommitted) {
      const pin = committedPins.find((p) => p.id === relabelPinId);
      if (pin?.dbId) {
        try {
          await apiRequest("PATCH", `/api/pins/${pin.dbId}`, { label: newLabel });
          setCommittedPins((prev) =>
            prev.map((p) => p.id === relabelPinId ? { ...p, label: newLabel } : p)
          );
          queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
        } catch {
        }
      }
    } else {
      setLocalPins((prev) =>
        prev.map((p) => p.id === relabelPinId ? { ...p, label: newLabel } : p)
      );
    }
    setRelabelPinId(null);
    setRelabelValue("");
    setRelabelIsCommitted(false);
  }, [relabelPinId, relabelValue, relabelIsCommitted, committedPins, sessionId]);

  const applyCommittedCatalogMatch = useCallback((match: ParsedCatalogEntry) => {
    setCommittedEditState(s => {
      const updates: Partial<typeof s> = { wireDetails: match.catalog };
      if (match.footage) {
        updates.footage = String(toDisplayUnit(match.footage, currentUnit));
      }
      return { ...s, ...updates };
    });
    setCommittedCatalogSuggestions([]);
    setShowCommittedCatalogSuggestions(false);
  }, [currentUnit]);

  const saveCommittedPinEdit = useCallback(async () => {
    if (!editingCommittedPinId) return;
    const pin = committedPins.find(p => p.id === editingCommittedPinId);
    if (!pin?.dbId) return;
    const newLabel = committedEditState.label.trim();
    const displayFootage = committedEditState.footage ? Number(committedEditState.footage) : null;
    const parsedFootage = displayFootage !== null && Number.isFinite(displayFootage) ? toBaseFeet(displayFootage, currentUnit) : null;
    const parsedReelCount = committedEditState.reelCount ? parseInt(committedEditState.reelCount) : 1;

    try {
      if (newLabel && newLabel !== pin.label) {
        await apiRequest("PATCH", `/api/pins/${pin.dbId}`, { label: newLabel });
        setCommittedPins(prev => prev.map(p => p.id === editingCommittedPinId ? { ...p, label: newLabel } : p));
      }
      if (pin.entryId) {
        const totalFootage = parsedFootage ? parsedFootage * (parsedReelCount > 0 ? parsedReelCount : 1) : undefined;
        await apiRequest("PATCH", `/api/entries/${pin.entryId}`, {
          reelTag: committedEditState.wireDetails || undefined,
          manufacturer: committedEditState.vendorCode || undefined,
          footage: totalFootage,
          reelCount: parsedReelCount > 0 ? parsedReelCount : 1,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      setEditingCommittedPinId(null);
      toast({ title: "Saved", description: "Pin details updated." });
      onPinDataChanged?.();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  }, [editingCommittedPinId, committedPins, committedEditState, currentUnit, sessionId, toast, onPinDataChanged]);

  const updatePinField = useCallback((pinId: string, field: keyof LocalPin, value: any) => {
    setLocalPins((prev) =>
      prev.map((p) => {
        if (p.id !== pinId) return p;
        const updates: Partial<LocalPin> = { [field]: value };
        if (field === "wireDetails") {
          const derived = deriveVendorCode(String(value || ""));
          if (derived) updates.vendorCode = derived;
        }
        return { ...p, ...updates };
      })
    );
  }, []);

  const doFlagPin = useCallback((pinId: string, flagged: boolean, flagReason?: string) => {
    const beforePins = localPinsRef.current;
    const afterPins = beforePins.map(p =>
      p.id === pinId
        ? { ...p, flagged, flagReason: flagged ? (flagReason ?? p.flagReason) : undefined }
        : p
    );
    if (onPushUndo && currentPhoto?.dbId) {
      const toWire = (arr: typeof beforePins) => arr.map(p => ({
        xPercent: p.x, yPercent: p.y, label: p.label,
        reelCount: p.reelCount, wireDetails: p.wireDetails || null,
        vendorCode: p.vendorCode || null, footage: p.footage || null,
        flagged: p.flagged || false, flagReason: p.flagReason || null,
        draftClientId: p.draftClientId || p.id,
      }));
      onPushUndo({
        type: "restore-draft-pins",
        sessionId,
        entityId: currentPhoto.dbId,
        data: { photoId: currentPhoto.dbId, pins: toWire(afterPins) },
        previousData: { photoId: currentPhoto.dbId, pins: toWire(beforePins) },
      });
    }
    updatePinField(pinId, "flagged", flagged);
    if (flagged && flagReason) updatePinField(pinId, "flagReason", flagReason);
    if (!flagged) updatePinField(pinId, "flagReason", undefined);
    let consumed = false;
    toast({
      title: flagged ? "Pin flagged" : "Flag removed",
      action: onTriggerUndoRef.current
        ? <ToastAction altText="Undo" onClick={(e) => { if (consumed) return; consumed = true; (e.currentTarget as HTMLButtonElement).disabled = true; onTriggerUndoRef.current?.(); }}>Undo</ToastAction>
        : undefined,
    });
  }, [onPushUndo, currentPhoto?.dbId, sessionId, updatePinField, toast]);


  const deleteCommittedPin = useCallback(async (pin: { id: string; dbId?: number; x?: number; y?: number; label?: string; reelCount?: number; entryId?: number; flagged?: boolean; updatedAt?: string | Date }) => {
    if (pin.dbId) {
      try {
        await apiRequest("DELETE", `/api/pins/${pin.dbId}`);
        if (onPushUndo && currentPhoto?.dbId) {
          const pinToken: string | undefined = pin.updatedAt
            ? (pin.updatedAt instanceof Date ? pin.updatedAt.toISOString() : new Date(pin.updatedAt as unknown as string).toISOString())
            : undefined;
          onPushUndo({
            type: "delete-pin",
            sessionId,
            entityId: pin.dbId,
            data: { photoId: currentPhoto.dbId },
            previousData: {
              xPercent: pin.x,
              yPercent: pin.y,
              label: pin.label,
              reelCount: pin.reelCount,
              entryId: pin.entryId,
              flagged: pin.flagged || false,
            },
            serverUpdatedAt: pinToken,
          });
        }
      } catch {
        toast({ title: "Failed to delete pin", variant: "destructive" });
        return;
      }
      let consumed = false;
      toast({
        title: "Pin deleted",
        action: onTriggerUndoRef.current
          ? <ToastAction altText="Undo" onClick={(e) => { if (consumed) return; consumed = true; (e.currentTarget as HTMLButtonElement).disabled = true; onTriggerUndoRef.current?.(); }}>Undo</ToastAction>
          : undefined,
      });
    }
    setCommittedPins(prev => prev.filter(p => p.id !== pin.id));
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
  }, [toast, sessionId, onPushUndo, currentPhoto?.dbId]);

  const applyAutoFill = useCallback((pinId: string) => {
    const pin = localPinsRef.current.find(p => p.id === pinId);
    if (!pin?.wireDetails) return;
    const normalized = pin.wireDetails.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const matches = lookupCatalog(pin.wireDetails, userParsedCatalog);
    if (matches.length === 0) return;
    const exactMatch = matches.find(m => m.catalog === normalized || m.aliasLabel === normalized);
    const match = exactMatch || (matches.length === 1 ? matches[0] : null);
    if (!match) {
      toast({ title: "Ambiguous catalog entry", description: "Multiple matches found — select one from the dropdown.", variant: "destructive" });
      return;
    }
    updatePinField(pinId, "wireDetails", match.catalog);
    if (!pin.vendorCode && match.vendor) updatePinField(pinId, "vendorCode", match.vendor);
    if (match.footage) updatePinField(pinId, "footage", match.footage);
    if (match.aliasLabel) {
      updatePinField(pinId, "aliasUsed", match.aliasLabel);
      appendAliasToPhotoNotes(match.aliasLabel, pin.label);
    }
  }, [updatePinField, appendAliasToPhotoNotes, userParsedCatalog]);

  const clearRow = useCallback((pinId: string) => {
    setLocalPins((prev) =>
      prev.map((p) =>
        p.id === pinId
          ? { ...p, wireDetails: undefined, vendorCode: undefined, footage: undefined, reelCount: 1, aliasUsed: undefined }
          : p
      )
    );
  }, []);

  const createEntries = useMutation({
    mutationFn: async ({ overwrite = false }: { overwrite?: boolean } = {}) => {
      const allPins = [...localPinsRef.current];
      const pinsToCommit = allPins.filter(p => p.wireDetails && p.wireDetails.trim().length > 0 && p.footage && p.footage > 0 && !p.flagged);
      if (pinsToCommit.length === 0) {
        const withDetails = allPins.filter(p => p.wireDetails && p.wireDetails.trim().length > 0 && !p.flagged);
        if (withDetails.length > 0 && withDetails.some(p => !p.footage || p.footage <= 0)) {
          throw new Error("All pins with catalog entries are missing footage. Fill in footage before committing.");
        }
        const flaggedWithDetails = allPins.filter(p => p.wireDetails && p.wireDetails.trim().length > 0 && p.flagged);
        if (flaggedWithDetails.length > 0) {
          throw new Error(`${flaggedWithDetails.length} pin(s) with catalog entries are flagged for re-shoot. Unflag them first to commit.`);
        }
        return { successful: [], errors: [] };
      }
      if (overwrite) {
        const conflicting = committedPins.filter(cp => pinsToCommit.some(p => p.label === cp.label));
        for (const cp of conflicting) {
          if (cp.entryId) {
            try { await apiRequest("DELETE", `/api/entries/${cp.entryId}`); } catch (err) {
              console.error(`Failed to delete conflicting entry ${cp.entryId}:`, err);
            }
          }
        }
      }
      const isDetail = currentPhoto?.isDetailShot || false;
      const parentPhoto = isDetail && currentPhoto?.parentPhotoId
        ? uploadedPhotos.find(p => p.dbId === currentPhoto.parentPhotoId)
        : undefined;
      const entryAisle = isDetail && parentPhoto?.aisle ? parentPhoto.aisle : (currentPhoto?.aisle || aisle || "");
      const entrySection = currentPhoto?.section || parentPhoto?.section || "";
      const entryPhotoId = isDetail && parentPhoto?.dbId ? parentPhoto.dbId : currentPhoto?.dbId;
      const pinPhotoId = currentPhoto?.dbId;
      const errors: string[] = [];
      const totalEntries = pinsToCommit.length;
      let completed = 0;
      setBatchProgress({ current: 0, total: totalEntries, errors: [] });

      const withRetry = async <T,>(fn: () => Promise<T>, retries = 2, delay = 500): Promise<T> => {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try { return await fn(); }
          catch (e) { if (attempt === retries) throw e; await new Promise(r => setTimeout(r, delay)); }
        }
        throw new Error("unreachable");
      };

      for (const pin of pinsToCommit) {
        try {
          const reelLabel = pin.wireDetails || `Pin ${pin.label}`;
          const totalFootage = pin.footage ? pin.footage * pin.reelCount : undefined;
          const noteParts: string[] = [];
          if (isDetail) noteParts.push(`From detail shot: ${currentPhoto?.filename || "detail"}`);
          if (pin.aliasUsed) noteParts.push(`Alias: ${pin.aliasUsed}`);
          const { entry, queued: entryQueued } = await withRetry(async () => {
            return await createEntryWithOfflineFallback(sessionId, {
              aisle: entryAisle,
              section: entrySection,
              position: pin.label != null ? String(pin.label) : "",
              reelTag: reelLabel,
              manufacturer: pin.vendorCode || undefined,
              footage: totalFootage,
              reelCount: pin.reelCount,
              photoId: entryPhotoId || undefined,
              notes: noteParts.length > 0 ? noteParts.join(" | ") : undefined,
            }, identityId);
          });
          if (pinPhotoId && !entryQueued) {
            try {
              const savedPin = await withRetry(async () => {
                const pinRes = await apiRequest("POST", `/api/photos/${pinPhotoId}/pins`, {
                  xPercent: pin.x,
                  yPercent: pin.y,
                  label: pin.label,
                  reelCount: pin.reelCount,
                  entryId: entry.id,
                  wireDetails: pin.wireDetails || null,
                  vendorCode: pin.vendorCode || null,
                  footage: pin.footage || null,
                  flagged: false,
                });
                return await pinRes.json();
              });
              (pin as any)._dbPinId = savedPin.id;
            } catch (pinErr: any) {
              const pinErrMsg: string = pinErr?.message || "";
              console.error(`Failed to create pin for entry ${entry.id}, rolling back entry:`, pinErr);
              try { await apiRequest("DELETE", `/api/entries/${entry.id}`); } catch (deleteErr) {
                console.error(`Failed to roll back entry ${entry.id} after pin creation failure:`, deleteErr);
              }
              if (/already exists/i.test(pinErrMsg)) {
                throw new Error("pin-label-taken");
              }
              throw new Error("pin-creation-failed");
            }
          }
          (pin as any)._entryId = entry.id;
          completed++;
          setBatchProgress({ current: completed, total: totalEntries, errors });
        } catch (commitErr: any) {
          const commitErrMsg: string = commitErr?.message || "";
          if (commitErrMsg === "pin-label-taken") {
            errors.push(`${pin.label} (label already taken)`);
          } else {
            errors.push(`Pin ${pin.label}`);
          }
          setBatchProgress({ current: completed, total: totalEntries, errors });
        }
      }
      const successfulPins = pinsToCommit.filter(p => (p as any)._entryId);
      const committedSet = new Set(successfulPins.map(p => p.id));
      const remainingDraftPins = allPins.filter(p => !committedSet.has(p.id));
      if (pinPhotoId) {
        try {
          await apiRequest("PUT", `/api/photos/${pinPhotoId}/draft-pins`, {
            pins: remainingDraftPins.map(p => ({
              xPercent: p.x,
              yPercent: p.y,
              label: p.label,
              reelCount: p.reelCount,
              wireDetails: p.wireDetails || null,
              vendorCode: p.vendorCode || null,
              footage: p.footage || null,
              flagged: p.flagged || false,
              flagReason: p.flagReason || null,
              draftClientId: p.draftClientId || p.id,
            })),
            deletedClientIds: [...deletedDraftClientIdsRef.current],
          });
          deletedDraftClientIdsRef.current.clear();
        } catch (err) {
          console.error("Failed to save remaining draft pins after commit:", err);
        }
      }
      return { successful: successfulPins, errors };
    },
    onSuccess: ({ successful, errors: commitErrors }, variables) => {
      if (successful.length === 0 && commitErrors.length === 0) {
        toast({ title: "No pins have catalog details entered yet" });
        return;
      }
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
      if (successful.length > 0) {
        const totalCreated = successful.reduce((sum, pin) => sum + pin.reelCount, 0);
        const committedIds = new Set(successful.map(p => p.id));
        const skippedNoFootage = localPinsRef.current.filter(p => p.wireDetails && p.wireDetails.trim().length > 0 && (!p.footage || p.footage <= 0) && !p.flagged && !committedIds.has(p.id)).length;
        const overwrittenLabels = variables?.overwrite ? new Set(successful.map(p => p.label)) : new Set<string>();
        setCommittedPins(prev => [
          ...prev.filter(cp => !overwrittenLabels.has(cp.label)),
          ...successful.map(p => ({
            id: `committed-${p.id}-${Date.now()}`,
            dbId: (p as any)._dbPinId as number | undefined,
            x: p.x,
            y: p.y,
            label: p.label,
            reelCount: p.reelCount,
            entryId: (p as any)._entryId as number | undefined,
            flagged: p.flagged || false,
          })),
        ]);
        setLocalPins(prev => prev.filter(p => !committedIds.has(p.id)));
        setSelectedPinId(prev => prev && committedIds.has(prev) ? null : prev);
        const parts: string[] = [`Created ${totalCreated} entries from ${successful.length} pins`];
        if (commitErrors.length > 0) parts.push(`${commitErrors.length} failed: ${commitErrors.join(", ")}`);
        if (skippedNoFootage > 0) parts.push(`${skippedNoFootage} skipped (missing footage)`);
        toast({ title: parts.join(". ") + ".", variant: commitErrors.length > 0 || skippedNoFootage > 0 ? "destructive" : "default" });
      } else if (commitErrors.length > 0) {
        toast({ title: `All ${commitErrors.length} pins failed to commit: ${commitErrors.join(", ")}`, variant: "destructive" });
      }
      setBatchProgress(null);
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      toast({ title: error.message, variant: "destructive" });
      batchProgressTimer.current = setTimeout(() => setBatchProgress(null), 3000);
    },
  });

  const handleCommitClick = useCallback(() => {
    const allPins = [...localPinsRef.current];
    const pinsToCommit = allPins.filter(p => p.wireDetails && p.wireDetails.trim().length > 0 && p.footage && p.footage > 0 && !p.flagged);
    if (!currentPhoto?.isDetailShot) {
      const warnedLabels = pinsToCommit
        .map(p => p.label)
        .filter(label => linkedPinShadeMapForPhoto.has(label) && !dismissedDetailWarn.current.has(label));
      if (warnedLabels.length > 0) {
        setDetailWarnLabels(warnedLabels);
        return;
      }
    }
    const conflicts = committedPins
      .filter(cp => pinsToCommit.some(p => p.label === cp.label))
      .map(cp => ({ label: cp.label, entryId: cp.entryId, dbPinId: cp.dbId }));
    if (conflicts.length > 0) {
      setConflictDialog({ conflicts, pinsToCommit });
    } else {
      createEntries.mutate({});
    }
  }, [committedPins, createEntries, currentPhoto?.isDetailShot, linkedPinShadeMapForPhoto]);

  const resetView = () => {
    setScale(1);
    setPanX(0);
    setPanY(0);
  };

  const navigateToNextIncomplete = async () => {
    if (!incompletePinsData || incompletePinsData.length === 0) return;
    const incompletePhotoIds = new Set(incompletePinsData.map(d => d.photoId));
    for (let offset = 1; offset <= uploadedPhotos.length; offset++) {
      const idx = (currentPhotoIdx + offset) % uploadedPhotos.length;
      if (idx === currentPhotoIdx) continue;
      const photo = uploadedPhotos[idx];
      if (photo?.dbId && incompletePhotoIds.has(photo.dbId)) {
        await flushSavePins();
        skipAutoSave.current = true;
        setLocalPins([]);
        setViewingNearbyIdx(null);
        setCurrentPhotoIdx(idx);
        resetView();
        setTimeout(() => {
          pinTableRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 400);
        return;
      }
    }
    toast({ title: "Last remaining entry", description: "This is the only uncommitted reel — use Add Reel(s) from Image to commit it." });
  };

  const scrollInputIntoView = useCallback((el: HTMLElement) => {
    const fixedOffset = 53 + previewHeight + 8;
    const rect = el.getBoundingClientRect();
    if (rect.top < fixedOffset) {
      const scrollTop = window.scrollY + rect.top - fixedOffset;
      window.scrollTo({ top: scrollTop, behavior: "smooth" });
    }
  }, [previewHeight]);

  return (
    <div className="rounded-lg border border-blue-500 sm:!border-blue-600/50 bg-[hsl(210_10%_96%)] dark:bg-[hsl(215_10%_13%)] p-4 overflow-hidden">
      <div className="space-y-4 min-w-0">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
        data-testid="input-photo-file"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileUpload}
        data-testid="input-photo-camera"
      />
      <h2 className="sm:hidden text-lg font-semibold underline text-center mb-2">Reel IDs</h2>
      <div className="space-y-2 sm:space-y-0">
        <div className="flex items-end gap-2 flex-wrap justify-center sm:justify-start">
          <div>
            <label className="block text-sm font-bold text-[hsl(18_80%_40%)] dark:text-[hsl(18_80%_60%)] mb-1">Aisle:</label>
            <Input
              value={aisle}
              onChange={(e) => {
                let val = e.target.value;
                if (val.toLowerCase() === "rec") val = "Receiving";
                setAisle(val);
                setUploadedPhotos(prev => prev.map((p, i) => i === currentPhotoIdx ? { ...p, aisle: val } : p));
                const photoDbId = currentPhoto?.dbId;
                if (aisleSaveTimer.current) clearTimeout(aisleSaveTimer.current);
                if (photoDbId) {
                  aisleSaveTimer.current = setTimeout(async () => {
                    try {
                      await apiRequest("PATCH", `/api/photos/${photoDbId}`, { aisle: val });
                    } catch (err) {
                      console.error("Failed to save photo aisle:", err);
                      toast({ title: "Could not save aisle", variant: "destructive" });
                    }
                  }, 800);
                }
              }}
              placeholder="Aisle..."
              className={`w-24 border-2 !border-blue-600 dark:!border-blue-400 focus-visible:ring-blue-500 bg-white dark:bg-[hsl(215_10%_10%)] placeholder:text-blue-700 placeholder:font-semibold ${aisle.trim() ? "input-filled" : "input-pulse-empty"}`}
              enterKeyHint="next"
              onFocus={(e) => scrollInputIntoView(e.currentTarget)}
              data-testid="input-photo-aisle"
            />
          </div>
          <div className="sm:hidden">
            <label className="block text-sm font-bold text-[hsl(18_80%_40%)] dark:text-[hsl(18_80%_60%)] mb-1">Section:</label>
            <Input
              value={currentPhoto?.section || ""}
              onChange={(e) => {
                const val = e.target.value;
                const photoDbId = currentPhoto?.dbId;
                setUploadedPhotos((prev) =>
                  prev.map((p, i) => i === currentPhotoIdx ? { ...p, section: val } : p)
                );
                if (sectionSaveTimer.current) clearTimeout(sectionSaveTimer.current);
                if (photoDbId) {
                  sectionSaveTimer.current = setTimeout(async () => {
                    try {
                      await apiRequest("PATCH", `/api/photos/${photoDbId}`, { section: val });
                    } catch (err) {
                      console.error("Failed to save photo section:", err);
                      toast({ title: "Could not save section", variant: "destructive" });
                    }
                  }, 800);
                }
              }}
              placeholder="Sec..."
              className={`w-14 border-2 !border-blue-600 dark:!border-blue-400 focus-visible:ring-blue-500 bg-white dark:bg-[hsl(215_10%_10%)] placeholder:text-blue-700 placeholder:font-semibold ${(currentPhoto?.section || "").trim() ? "input-filled" : "input-pulse-empty"}`}
              enterKeyHint="done"
              onFocus={(e) => scrollInputIntoView(e.currentTarget)}
              data-testid="input-photo-section-top"
            />
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <Button
              className={`bg-blue-700 text-white border-blue-800 transition-opacity ${showQuickEntry ? "opacity-30 pointer-events-none" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !canEdit || showQuickEntry}
              data-testid="button-upload-photos"
              title="Upload Photos"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1" />}
              Upload Photos
            </Button>
            <Button
              className={`bg-blue-700 text-white border-blue-800 transition-opacity ${showQuickEntry ? "opacity-30 pointer-events-none" : ""}`}
              onClick={() => cameraInputRef.current?.click()}
              disabled={isUploading || !canEdit || showQuickEntry}
              data-testid="button-take-photo"
              title="Take Photo"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4 mr-1" />}
              Take Photo
            </Button>
            <Button
              variant="outline"
              className="border-[hsl(200_50%_40%/0.5)] text-[hsl(200_60%_50%)] dark:text-[hsl(200_60%_70%)] dark:border-[hsl(200_50%_40%/0.4)]"
              onClick={() => setShowQuickEntry(prev => !prev)}
              data-testid="button-quick-entry-toggle"
            >
              <ListPlus className="h-4 w-4 mr-1" />
              <span className="font-bold">Quick Entry</span>
              {showQuickEntry ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
            </Button>
            <Button
              variant={scanPanelOpen ? "default" : "outline"}
              className={scanPanelOpen ? "bg-[hsl(280_60%_35%)] text-white border-[hsl(280_60%_25%)]" : "border-[hsl(280_50%_40%/0.5)] text-[hsl(280_60%_50%)] dark:text-[hsl(280_60%_70%)] dark:border-[hsl(280_50%_40%/0.4)]"}
              onClick={toggleScanPanel}
              data-testid="button-scan-panel-toggle"
              title={scanPanelOpen ? "Close Scan Panel" : "Open Scan Panel"}
            >
              <ScanLine className="h-4 w-4 mr-1" />
              <span className="font-bold">Scan</span>
              {scanPanelOpen ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
            </Button>
          </div>
        </div>
        <div className="flex sm:hidden items-center justify-center gap-4">
          <Button
            className={`bg-blue-700 text-white border-blue-800 transition-opacity ${showQuickEntry ? "opacity-30 pointer-events-none" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || !canEdit || showQuickEntry}
            data-testid="button-upload-photos-mobile"
            title="Upload Photos"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </Button>
          <Button
            className={`bg-blue-700 text-white border-blue-800 transition-opacity ${showQuickEntry ? "opacity-30 pointer-events-none" : ""}`}
            onClick={() => cameraInputRef.current?.click()}
            disabled={isUploading || !canEdit || showQuickEntry}
            data-testid="button-take-photo-mobile"
            title="Take Photo"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            className="border-[hsl(200_50%_40%/0.5)] text-[hsl(200_60%_50%)] dark:text-[hsl(200_60%_70%)] dark:border-[hsl(200_50%_40%/0.4)]"
            onClick={() => setShowQuickEntry(prev => !prev)}
            data-testid="button-quick-entry-toggle-mobile"
            title="Quick Entry"
          >
            <ListPlus className="h-4 w-4" />
          </Button>
          <Button
            variant={scanPanelOpen ? "default" : "outline"}
            className={scanPanelOpen ? "bg-[hsl(280_60%_35%)] text-white border-[hsl(280_60%_25%)]" : "border-[hsl(280_50%_40%/0.5)] text-[hsl(280_60%_50%)] dark:text-[hsl(280_60%_70%)] dark:border-[hsl(280_50%_40%/0.4)]"}
            onClick={toggleScanPanel}
            data-testid="button-scan-panel-toggle-mobile"
            title="Scan"
          >
            <ScanLine className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {showQuickEntry && (
        <div className="mt-2 p-3 rounded-md border border-[hsl(200_50%_40%/0.3)] bg-[hsl(25_10%_95%)] dark:bg-[hsl(25_10%_12%)]" data-testid="quick-entry-panel">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-[hsl(200_60%_35%)] dark:text-[hsl(200_60%_70%)] flex items-center gap-1.5">
              <ListPlus className="h-4 w-4" />
              Quick Entry (no pin)
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setShowQuickEntry(false)}
              data-testid="button-quick-entry-close"
            >
              ×
            </Button>
          </div>
          <SingleEntryMode
            sessionId={sessionId}
            editingEntry={null}
            onDoneEditing={() => {}}
            onUndoableSave={onPushUndo}
            canEdit={effectiveCanEdit}
            defaultAisle={currentPhoto?.aisle || aisle || ""}
            defaultSection={currentPhoto?.section || ""}
            getNextReceivingSection={getNextReceivingSection}
          />
        </div>
      )}

      {uploadedPhotos.length > 0 && (
        <>
          <div className="hidden sm:block bg-[hsl(25_15%_14%)] dark:bg-[hsl(25_8%_10%)] rounded-md px-3 py-2 space-y-1">
            <div className="flex items-center w-full">
              <div className="flex-1 flex items-center">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-[hsl(30_40%_85%)] hover:bg-[hsl(18_60%_30%/0.4)]"
                  onClick={() => setPinsVisible(v => !v)}
                  title={pinsVisible ? "Hide pins" : "Show pins"}
                  data-testid="button-toggle-pins-visible"
                >
                  {pinsVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  className="bg-blue-600 text-white border border-blue-700 disabled:opacity-40"
                  disabled={uploadedPhotos.length <= 1}
                  onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i - 1 + uploadedPhotos.length) % uploadedPhotos.length); resetView(); }}
                  data-testid="button-prev-photo"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-1 text-sm mono text-[hsl(30_40%_85%)]" data-testid="text-photo-counter">
                  <input
                    type="text"
                    inputMode="numeric"
                    className="w-10 text-center bg-transparent border border-[hsl(215_30%_50%/0.4)] rounded px-1 py-0.5 text-sm mono text-[hsl(30_40%_85%)] focus:outline-none focus:border-blue-500"
                    value={photoInputValue ?? String(currentPhotoIdx + 1).padStart(2, "0")}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
                      setPhotoInputValue(raw);
                      const val = parseInt(raw, 10);
                      if (!isNaN(val) && val >= 1 && val <= uploadedPhotos.length) {
                        flushSavePins().then(() => {
                          skipAutoSave.current = true;
                          setLocalPins([]);
                          setViewingNearbyIdx(null);
                          setCurrentPhotoIdx(val - 1);
                          resetView();
                        });
                      }
                    }}
                    onFocus={(e) => { setPhotoInputValue(String(currentPhotoIdx + 1)); e.target.select(); }}
                    onBlur={() => setPhotoInputValue(null)}
                    data-testid="input-photo-number-top"
                  />
                  <span>/ {String(uploadedPhotos.length).padStart(2, "0")}</span>
                </div>
                <Button
                  size="icon"
                  className="bg-blue-600 text-white border border-blue-700 disabled:opacity-40"
                  disabled={uploadedPhotos.length <= 1}
                  onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i + 1) % uploadedPhotos.length); resetView(); }}
                  data-testid="button-next-photo"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
              <div className="flex-1 justify-end gap-2 flex">
                <div>
                  <label className="block text-sm font-bold text-[hsl(18_80%_40%)] dark:text-[hsl(18_80%_60%)] mb-1">Section:</label>
                  <Input
                    value={currentPhoto?.section || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      const photoDbId = currentPhoto?.dbId;
                      setUploadedPhotos((prev) =>
                        prev.map((p, i) => i === currentPhotoIdx ? { ...p, section: val } : p)
                      );
                      if (sectionSaveTimer.current) clearTimeout(sectionSaveTimer.current);
                      if (photoDbId) {
                        sectionSaveTimer.current = setTimeout(async () => {
                          try {
                            await apiRequest("PATCH", `/api/photos/${photoDbId}`, { section: val });
                          } catch (err) {
                            console.error("Failed to save photo section:", err);
                            toast({ title: "Could not save section", variant: "destructive" });
                          }
                        }, 800);
                      }
                    }}
                    placeholder="Section..."
                    className={`w-24 border-2 !border-blue-600 dark:!border-blue-400 focus-visible:ring-blue-500 bg-white dark:bg-[hsl(215_10%_10%)] placeholder:text-blue-700 placeholder:font-semibold ${(currentPhoto?.section || "").trim() ? "input-filled" : "input-pulse-empty"}`}
                    enterKeyHint="done"
                    data-testid="input-photo-section"
                  />
                </div>
              </div>
            </div>
            {currentPhoto && (
              <div className="hidden sm:flex items-center justify-center gap-3 text-xs mono text-[hsl(25_40%_60%)]" data-testid="text-photo-info">
                {currentPhoto.filename && <span className="truncate max-w-[200px]" title={currentPhoto.filename}>{currentPhoto.filename}</span>}
                {currentPhoto.timestamp && <span className="whitespace-nowrap">{currentPhoto.timestamp}</span>}
                {currentPhoto.isDetailShot && (() => {
                  const parentPhoto = currentPhoto.parentPhotoId
                    ? uploadedPhotos.find(p => p.dbId === currentPhoto.parentPhotoId)
                    : undefined;
                  const parentFilename = parentPhoto?.filename || (parentPhoto?.dbId ? `S${sessionId}_P${String(parentPhoto.dbId).padStart(4, "0")}.jpg` : null);
                  return (
                    <span className="inline-flex items-center gap-1 text-[hsl(200_70%_55%)]">
                      <Focus className="h-3 w-3" aria-label="Detail Shot" />
                      {parentFilename && onJumpToStripPhoto && parentPhoto?.dbId ? (
                        <button
                          className="text-[hsl(200_70%_55%)] hover:text-[hsl(200_70%_65%)] underline transition-colors cursor-pointer"
                          onClick={() => onJumpToStripPhoto(parentPhoto.dbId!)}
                          data-testid="link-detail-shot-parent"
                        >
                          Detail shot of photo {parentFilename}
                        </button>
                      ) : (
                        <span title="Detail Shot">Detail shot</span>
                      )}
                    </span>
                  );
                })()}
                {currentPhoto.notes && (
                  <span className="inline-flex items-center gap-1 text-[hsl(18_70%_55%)]" title={currentPhoto.notes}>
                    <StickyNote className="h-3 w-3" />
                  </span>
                )}
              </div>
            )}
          </div>


          {viewingNearbyIdx !== null && viewingNearbyIdx !== currentPhotoIdx && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-600/15 border border-blue-600/30 rounded-md text-xs text-[hsl(30_40%_85%)]" data-testid="nearby-viewing-banner">
              <Eye className="h-3 w-3 flex-shrink-0" />
              <span>Viewing nearby photo {viewingNearbyIdx + 1} — pin table still shows photo {currentPhotoIdx + 1}</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-xs"
                onClick={() => setViewingNearbyIdx(null)}
                data-testid="button-return-to-current"
              >
                Return
              </Button>
            </div>
          )}

          {currentPhoto && (
            <div className="relative flex items-stretch">
              {uploadedPhotos.length > 1 && (
                <button
                  className="hidden sm:flex w-7 min-w-[28px] items-center justify-center bg-transparent hover:bg-[hsl(18_85%_40%)] text-white/0 hover:text-white rounded-l-md transition-all shrink-0"
                  onClick={async (e) => { e.stopPropagation(); await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i - 1 + uploadedPhotos.length) % uploadedPhotos.length); resetView(); }}
                  data-testid="btn-photo-prev-edge"
                  title="Previous photo"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
            <div
              ref={containerRef}
              className="photo-viewer-container w-full min-w-0"
              style={{ cursor: panMode ? "grab" : (viewingNearbyIdx !== null && viewingNearbyIdx !== currentPhotoIdx) ? "default" : colorPickMode ? "cell" : effectiveCanEdit ? "crosshair" : "not-allowed" }}
              onMouseDown={handleMouseDown}
              onClick={handleContainerClick}
              data-testid="photo-viewer"
            >
              {showLinkedBanner && (
                <div
                  className="fixed top-[53px] left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-blue-600/90 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg pointer-events-none animate-in fade-in slide-in-from-top-3 duration-300"
                  data-testid="banner-linked-photo"
                  role="status"
                  aria-live="polite"
                >
                  <Link2 className="h-4 w-4 flex-shrink-0" />
                  <span>This is a linked photo</span>
                </div>
              )}
              <div className="photo-scroll-strip left" onWheel={(e) => e.stopPropagation()} />
              <div className="photo-scroll-strip right" onWheel={(e) => e.stopPropagation()} />
              <div
                className="relative w-full"
                style={{
                  transform: `scale(${scale}) translate(${panX}px, ${panY}px) rotate(${rotation}deg)`,
                  transformOrigin: "center center",
                  ["--pin-scale" as string]: pinScale,
                }}
              >
              {!photoLoaded && !imageError && (
                <Skeleton className="w-full aspect-[4/3]" />
              )}
              {imageError && (
                <div className="w-full aspect-[4/3] flex items-center justify-center bg-muted/20">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="h-8 w-8 text-muted-foreground/60" />
                    <span className="text-sm">Photo unavailable</span>
                  </div>
                </div>
              )}
              <img
                ref={photoImgRef}
                src={displayedPhoto?.url || currentPhoto.url}
                alt="Section photo"
                draggable={false}
                className={`w-full select-none transition-opacity duration-300 ${photoLoaded ? "opacity-100" : "absolute inset-0 w-full h-full opacity-0"}`}
                style={{ display: imageError ? "none" : "block" }}
                onLoad={() => { setPhotoLoadedKey(displayedPhoto?.url || currentPhoto?.url || ""); setPhotoErrorKey(""); }}
                onError={() => setPhotoErrorKey(displayedPhoto?.url || currentPhoto?.url || "")}
              />
              {viewingNearbyIdx === null || viewingNearbyIdx === currentPhotoIdx ? (
                <>
                  {photoLoaded && pinsVisible && localPins.map((pin) => (
                    <div
                      key={pin.id}
                      className={`pin-marker ${selectedPinId === pin.id ? "selected" : ""} ${pin.flagged ? "flagged" : ""}`}
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                      data-pin-id={pin.id}
                      onMouseDown={(e) => {
                        if ((e.target as HTMLElement).closest(".pin-label, .pin-delete-btn, .pin-count-btn")) return;
                        startPinDrag(e, pin.id);
                      }}
                      onTouchStart={(e) => {
                        if ((e.target as HTMLElement).closest(".pin-label, .pin-delete-btn, .pin-count-btn")) return;
                        startPinDrag(e, pin.id);
                      }}
                      onClick={(e) => { e.stopPropagation(); if (justDraggedRef.current) { justDraggedRef.current = false; } }}
                      data-testid={`pin-${pin.id}`}
                    >
                      <div className="pin-top-row">
                        <button
                          className="pin-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            const beforePins = localPinsRef.current;
                            const afterPins = beforePins.filter(p => p.id !== pin.id);
                            if (onPushUndo && currentPhoto?.dbId) {
                              const toWire = (arr: typeof beforePins) => arr.map(p => ({
                                xPercent: p.x, yPercent: p.y, label: p.label,
                                reelCount: p.reelCount, wireDetails: p.wireDetails || null,
                                vendorCode: p.vendorCode || null, footage: p.footage || null,
                                flagged: p.flagged || false, flagReason: p.flagReason || null,
                                draftClientId: p.draftClientId || p.id,
                              }));
                              onPushUndo({
                                type: "restore-draft-pins",
                                sessionId,
                                entityId: currentPhoto.dbId,
                                data: { photoId: currentPhoto.dbId, pins: toWire(afterPins) },
                                previousData: { photoId: currentPhoto.dbId, pins: toWire(beforePins) },
                              });
                            }
                            setLocalPins(afterPins);
                            if (detectedPinIdsRef.current.size > 0) {
                              const remaining = afterPins.filter(p => detectedPinIdsRef.current.has(p.id));
                              if (remaining.length === 0) {
                                detectedPinIdsRef.current = new Set();
                                setDetectedBoxes([]);
                              }
                            }
                          }}
                          title="Delete pin"
                          data-testid={`button-delete-pin-${pin.id}`}
                        >
                          &times;
                        </button>
                        <div
                          className="pin-label"
                          onClick={(e) => { e.stopPropagation(); openRelabel(pin.id); }}
                          title="Click to rename"
                          data-testid={`label-pin-${pin.id}`}
                        >
                          {formatPinLabel(pin.label)}
                        </div>
                      </div>
                      <div className="pin-bottom-row">
                        <button
                          className="pin-count-btn minus"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocalPins((prev) =>
                              prev.map((p) => p.id === pin.id ? { ...p, reelCount: Math.max(1, p.reelCount - 1) } : p)
                            );
                          }}
                          title="Decrease count"
                          data-testid={`button-minus-pin-${pin.id}`}
                        >
                          &minus;
                        </button>
                        <span className="pin-reel-count" data-testid={`count-pin-${pin.id}`}>{pin.reelCount}</span>
                        <button
                          className="pin-count-btn plus"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocalPins((prev) =>
                              prev.map((p) => p.id === pin.id ? { ...p, reelCount: Math.min(99, p.reelCount + 1) } : p)
                            );
                          }}
                          title="Increase count"
                          data-testid={`button-plus-pin-${pin.id}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                  {photoLoaded && pinsVisible && committedPins.map((pin) => {
                    const shadeIdx = isDisplayedPhotoDetail ? detailShadeIndexForPhoto : linkedPinShadeMapForPhoto.get(pin.label);
                    const hasShade = shadeIdx !== undefined && shadeIdx >= 0;
                    return (
                    <div
                      key={pin.id}
                      className={`pin-marker committed${pin.y < 15 ? " topbar-below" : ""}${highlightedCommittedPinDbId && pin.dbId === highlightedCommittedPinDbId ? " pin-highlight-pulse" : ""}${hasShade ? " pin-linked" : ""}`}
                      style={{ left: `${pin.x}%`, top: `${pin.y}%`, ...(hasShade ? { "--pin-linked-color": BLUE_SHADES_CSS[shadeIdx! % BLUE_SHADES_CSS.length] } as React.CSSProperties : {}) }}
                      data-testid={`pin-committed-${pin.id}`}
                    >
                      <div className="pin-committed-topbar">
                        <button
                          className="pin-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteCommittedPin(pin);
                          }}
                          title="Delete committed pin"
                          data-testid={`button-delete-committed-${pin.id}`}
                        >
                          &times;
                        </button>
                        <button
                          className="pin-delete-btn hidden sm:inline-flex"
                          onClick={(e) => {
                            e.stopPropagation();
                            openRelabel(pin.id);
                          }}
                          title="Relabel pin"
                          data-testid={`button-relabel-committed-${pin.id}`}
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                        <div className="pin-label">{formatPinLabel(pin.label)}</div>
                        {pin.reelCount >= 2 && (
                          <div className="pin-reel-badge" data-testid={`badge-reel-count-${pin.id}`}>
                            X{pin.reelCount}
                          </div>
                        )}
                      </div>
                    </div>
                  );})}
                </>
              ) : (
                <>
                  {photoLoaded && pinsVisible && nearbyCommittedPins.map((pin) => (
                    <div
                      key={pin.id}
                      className={`pin-marker committed${pin.y < 15 ? " topbar-below" : ""}`}
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                      data-testid={`pin-nearby-committed-${pin.id}`}
                    >
                      <div className="pin-committed-topbar">
                        <div className="pin-label">{formatPinLabel(pin.label)}</div>
                        {pin.reelCount >= 2 && (
                          <div className="pin-reel-badge">
                            X{pin.reelCount}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
              </div>
              <div className="photo-overlay-controls right-strip">
                <button
                  className={`photo-overlay-btn ${!pinsVisible ? "photo-overlay-btn-active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setPinsVisible((v) => !v); }}
                  title={pinsVisible ? "Hide pins" : "Show pins"}
                  data-testid="button-overlay-hide-pins"
                >
                  {pinsVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <div className="photo-overlay-divider" />
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); setScale((s) => Math.min(12, s + 0.5)); }}
                  title="Zoom in"
                  data-testid="button-zoom-in"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); setScale((s) => Math.max(1, s - 0.5)); }}
                  title="Zoom out"
                  data-testid="button-zoom-out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  className={`photo-overlay-btn ${panMode ? "photo-overlay-btn-active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setPanMode((m) => !m); }}
                  title={panMode ? "Exit pan mode (tap to place pins)" : "Enter pan mode (drag to move)"}
                  data-testid="button-pan-mode"
                >
                  <Move className="h-4 w-4" />
                </button>
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newRot = (rotation + 90) % 360;
                    setRotation(newRot);
                    const photoId = currentPhoto?.dbId;
                    if (!photoId) return;
                    setUploadedPhotos(prev => prev.map(p => p.dbId === photoId ? { ...p, rotation: newRot } : p));
                    if (rotationSaveTimer.current) clearTimeout(rotationSaveTimer.current);
                    rotationSaveTimer.current = setTimeout(async () => {
                      try { await apiRequest("PATCH", `/api/photos/${photoId}`, { rotation: newRot }); } catch (err) {
                        console.error("Failed to save photo rotation:", err);
                      }
                    }, 80);
                  }}
                  title="Rotate clockwise"
                  data-testid="button-rotate-cw"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newRot = (rotation - 90 + 360) % 360;
                    setRotation(newRot);
                    const photoId = currentPhoto?.dbId;
                    if (!photoId) return;
                    setUploadedPhotos(prev => prev.map(p => p.dbId === photoId ? { ...p, rotation: newRot } : p));
                    if (rotationSaveTimer.current) clearTimeout(rotationSaveTimer.current);
                    rotationSaveTimer.current = setTimeout(async () => {
                      try { await apiRequest("PATCH", `/api/photos/${photoId}`, { rotation: newRot }); } catch (err) {
                        console.error("Failed to save photo rotation:", err);
                      }
                    }, 80);
                  }}
                  title="Rotate counter-clockwise"
                  data-testid="button-rotate-ccw"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <div className="photo-overlay-divider" />
                {effectiveCanEdit && (
                  <button
                    className="photo-overlay-btn"
                    onClick={(e) => { e.stopPropagation(); detectReceivedLabels(); }}
                    disabled={isDetectingReceived}
                    title="Auto-detect green RECEIVED labels"
                    data-testid="button-detect-received"
                  >
                    {isDetectingReceived
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "#46D700" }} />}
                  </button>
                )}
                <button
                  className={`photo-overlay-btn ${colorPickMode ? "photo-overlay-btn-active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setColorPickMode(m => !m); }}
                  title={colorPickMode ? "Exit color picker (click to exit)" : "Color picker: click any spot to read its RGB"}
                  data-testid="button-color-pick-mode"
                >
                  <Pipette className="h-4 w-4" />
                </button>
                <div className="photo-overlay-divider" />
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); savePinScale(Math.min(7, +(pinScale + 0.25).toFixed(2))); }}
                  title="Increase pin size"
                  data-testid="button-pin-size-up"
                >
                  <span className="inline-block w-4 h-4 border-2 border-current rounded-sm" />
                </button>
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); savePinScale(Math.max(0.5, +(pinScale - 0.25).toFixed(2))); }}
                  title="Decrease pin size"
                  data-testid="button-pin-size-down"
                >
                  <span className="inline-block w-2.5 h-2.5 border-2 border-current rounded-sm" />
                </button>
              </div>
            </div>
              {uploadedPhotos.length > 1 && (
                <button
                  className="hidden sm:flex w-7 min-w-[28px] items-center justify-center bg-transparent hover:bg-[hsl(18_85%_40%)] text-white/0 hover:text-white rounded-r-md transition-all shrink-0"
                  onClick={async (e) => { e.stopPropagation(); await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i + 1) % uploadedPhotos.length); resetView(); }}
                  data-testid="btn-photo-next-edge"
                  title="Next photo"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
              {scanPanelOpen && (
                <div className={`hidden sm:flex flex-col gap-0 absolute top-0 right-0 ${scanBatchMode ? "w-full" : "w-1/2"} h-full z-[25] overflow-y-auto bg-[hsl(25_8%_13%)] border-l border-[hsl(280_50%_30%/0.4)] p-4`} data-testid="scan-panel-desktop">
                  {!scanBatchMode && (
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <ScanLine className="h-4 w-4 text-[hsl(280_60%_55%)]" />
                        <span className="text-sm font-semibold text-[hsl(280_60%_70%)]">Scan Panel</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={toggleScanPanel}
                        data-testid="button-scan-panel-close-desktop"
                      >
                        <PanelCloseX className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  <LabelScannerTab
                    sessionId={sessionId}
                    photos={photos}
                    currentPhotoId={scanPanelCurrentPhotoId}
                    canEdit={canEdit}
                    isAdmin={isAdmin}
                    onPinDataChanged={onPinDataChanged}
                    onlineUsers={onlineUsers}
                    pushUndo={onPushUndo}
                    onApplied={onScanApplied}
                    onBatchModeChange={setScanBatchMode}
                    onClose={toggleScanPanel}
                  />
                </div>
              )}
            </div>
          )}

          {currentPhoto && (
            <div className="bg-[hsl(25_15%_14%)] dark:bg-[hsl(25_8%_10%)] rounded-md px-3 py-2 flex flex-col items-center gap-1" data-testid="bottom-photo-nav">
              {currentPhoto.filename && (
                <span className="hidden sm:inline text-xs mono text-[hsl(25_40%_60%)] truncate max-w-[260px]" title={currentPhoto.filename} data-testid="text-photo-name-bottom">
                  {currentPhoto.filename}
                </span>
              )}
              <div className="flex items-center gap-3 text-xs w-full" data-testid="bottom-nav-aisle-section">
                <span>
                  <span className="text-[hsl(18_80%_60%)] font-semibold mr-1">Aisle:</span>
                  <span className="font-mono text-[hsl(30_40%_85%)]">{aisle.trim() || "—"}</span>
                </span>
                <span className="text-[hsl(25_20%_40%)]">·</span>
                <span>
                  <span className="text-[hsl(18_80%_60%)] font-semibold mr-1">Section:</span>
                  <span className="font-mono text-[hsl(30_40%_85%)]">{(currentPhoto?.section || "").trim() || "—"}</span>
                </span>
              </div>
              <div className="flex items-center w-full">
                <div className="flex-1 flex items-center">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="hidden sm:inline-flex h-8 w-8 text-[hsl(30_40%_85%)] hover:bg-[hsl(18_60%_30%/0.4)]"
                    onClick={() => setPinsVisible(v => !v)}
                    title={pinsVisible ? "Hide pins" : "Show pins"}
                    data-testid="button-toggle-pins-visible-bottom"
                  >
                    {pinsVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-3">
                  <Button
                    size="icon"
                    className="h-7 w-7 sm:h-9 sm:w-9 bg-blue-600 text-white border border-blue-700 disabled:opacity-40"
                    disabled={uploadedPhotos.length <= 1}
                    onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i - 1 + uploadedPhotos.length) % uploadedPhotos.length); resetView(); }}
                    data-testid="button-prev-photo-bottom"
                  >
                    <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                  <div className="flex items-center gap-0.5 sm:gap-1 text-xs sm:text-sm mono text-[hsl(30_40%_85%)]" data-testid="text-photo-counter-bottom">
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-8 sm:w-10 text-center bg-transparent border border-[hsl(215_30%_50%/0.4)] rounded px-0.5 py-0.5 text-xs sm:text-sm mono text-[hsl(30_40%_85%)] focus:outline-none focus:border-blue-500"
                      value={photoInputValue ?? String(currentPhotoIdx + 1).padStart(2, "0")}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
                        setPhotoInputValue(raw);
                        const val = parseInt(raw, 10);
                        if (!isNaN(val) && val >= 1 && val <= uploadedPhotos.length) {
                          flushSavePins().then(() => {
                            skipAutoSave.current = true;
                            setLocalPins([]);
                            setViewingNearbyIdx(null);
                            setCurrentPhotoIdx(val - 1);
                            resetView();
                          });
                        }
                      }}
                      onFocus={(e) => { setPhotoInputValue(String(currentPhotoIdx + 1)); e.target.select(); }}
                      onBlur={() => setPhotoInputValue(null)}
                      data-testid="input-photo-number"
                    />
                    <span>/ {String(uploadedPhotos.length).padStart(2, "0")}</span>
                  </div>
                  <Button
                    size="icon"
                    className="h-7 w-7 sm:h-9 sm:w-9 bg-blue-600 text-white border border-blue-700 disabled:opacity-40"
                    disabled={uploadedPhotos.length <= 1}
                    onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i + 1) % uploadedPhotos.length); resetView(); }}
                    data-testid="button-next-photo-bottom"
                  >
                    <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </div>
                <div className="flex-1 flex justify-end ml-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="lg"
                      variant="ghost"
                      className="text-red-400 px-2"
                      data-testid="button-delete-photo"
                    >
                      <Trash2 className="h-8 w-8" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Photo?</AlertDialogTitle>
                      <AlertDialogDescription>This photo and all its pins will be removed. You can undo this action afterward.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          const photoDbId = currentPhoto?.dbId;
                          if (!photoDbId) return;
                          try {
                            await flushSavePins();
                            const photoRecord = photos.find(p => p.id === photoDbId);
                            const capturedPins = [...localPins];
                            const pinnedEntryIds = capturedPins.filter((p: any) => p.entryId).map((p: any) => p.entryId!);
                            const cachedEntries: any[] = queryClient.getQueryData<any[]>(["/api/sessions", sessionId.toString(), "entries"]) ?? [];
                            const capturedEntries = cachedEntries.filter(
                              (e: any) => pinnedEntryIds.includes(e.id) || e.photoId === photoDbId
                            );
                            await apiRequest("DELETE", `/api/photos/${photoDbId}?keepFile=1`);
                            setUploadedPhotos(prev => {
                              const filtered = prev.filter((_, i) => i !== currentPhotoIdx);
                              const newIdx = Math.min(currentPhotoIdx, Math.max(0, filtered.length - 1));
                              setCurrentPhotoIdx(newIdx);
                              return filtered;
                            });
                            setLocalPins([]);
                            localPinsRef.current = [];
                            setViewingNearbyIdx(null);
                            resetView();
                            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
                            if (onPushUndo && photoRecord) {
                              const { id, createdAt, ...photoData } = photoRecord as any;
                              onPushUndo({
                                type: "delete-photo",
                                sessionId,
                                entityId: photoDbId,
                                data: photoData,
                                previousData: { ...photoData, pins: capturedPins, entries: capturedEntries },
                              });
                            } else {
                              onClearUndoHistory?.();
                            }
                            toast({ title: "Photo deleted" });
                          } catch {
                            toast({ title: "Failed to delete photo", variant: "destructive" });
                          }
                        }}
                        data-testid="button-confirm-delete-photo"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                </div>
              </div>
            </div>
          )}

          {currentPhoto && (
            <div className="space-y-3 bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_11%)] rounded-md p-3 border border-[hsl(215_30%_50%/0.25)]">
              <div className="flex items-center gap-2 flex-wrap">
                <StickyNote className="h-4 w-4 text-[hsl(18_70%_50%)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(25_60%_70%)]">Photo Notes:</span>
              </div>
              <Textarea
                value={photoNotes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder=""
                className="resize-none border-[hsl(215_30%_50%/0.4)] bg-white dark:bg-[hsl(25_10%_10%)] text-sm min-h-[60px]"
                rows={2}
                data-testid="textarea-photo-notes"
              />
            </div>
          )}

          {uploadedPhotos.length > 1 && (() => {
            const isMobileView = window.innerWidth < 640;
            if (isMobileView) return null;
            const sortedByLocation = uploadedPhotos
              .map((photo, origIdx) => ({ photo, origIdx }))
              .sort((a, b) => {
                const aisleA = (a.photo.aisle || "").toLowerCase();
                const aisleB = (b.photo.aisle || "").toLowerCase();
                if (aisleA !== aisleB) return aisleA.localeCompare(aisleB);
                const secA = parseInt(a.photo.section || "0", 10) || 0;
                const secB = parseInt(b.photo.section || "0", 10) || 0;
                return secA - secB;
              });
            const currentSortedIdx = sortedByLocation.findIndex(s => s.origIdx === currentPhotoIdx);
            const windowSize = 7;
            const halfWindow = Math.floor(windowSize / 2);
            let startIdx = Math.max(0, currentSortedIdx - halfWindow);
            let endIdx = startIdx + windowSize;
            if (endIdx > sortedByLocation.length) {
              endIdx = sortedByLocation.length;
              startIdx = Math.max(0, endIdx - windowSize);
            }
            const nearbyPhotos = sortedByLocation.slice(startIdx, endIdx);
            return (
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Nearby Photos ({startIdx + 1}-{endIdx} of {uploadedPhotos.length})
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 pt-3">
                  {nearbyPhotos.map(({ photo, origIdx }) => {
                    const isCurrent = origIdx === currentPhotoIdx;
                    const isViewing = origIdx === viewingNearbyIdx;
                    return (
                      <button
                        key={origIdx}
                        type="button"
                        className={`flex-shrink-0 rounded-md border-2 p-0.5 transition-colors relative ${
                          isCurrent
                            ? "border-primary"
                            : isViewing
                            ? "border-[hsl(200_70%_50%)]"
                            : "border-transparent hover-elevate"
                        }`}
                        onClick={async () => {
                          if (isCurrent || isViewing) {
                            setViewingNearbyIdx(null);
                          } else {
                            setViewingNearbyIdx(origIdx);
                          }
                        }}
                        title={`${photo.aisle ? `Aisle ${photo.aisle} - ` : ""}${photo.section ? `Section ${photo.section}` : photo.filename || `Photo ${origIdx + 1}`}${photo.dbId && incompletePinsMap.has(photo.dbId) ? ` (${incompletePinsMap.get(photo.dbId)} incomplete)` : ""}`}
                        data-testid={`nearby-photo-${origIdx}`}
                      >
                        {photo.dbId && incompletePinsMap.has(photo.dbId) && (
                          <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-[hsl(30_90%_45%)] text-white text-[9px] font-bold px-0.5 z-10" data-testid={`badge-nearby-incomplete-${origIdx}`}>
                            {incompletePinsMap.get(photo.dbId)}
                          </span>
                        )}
                        <img
                          src={photo.url}
                          alt={photo.filename || `Photo ${origIdx + 1}`}
                          className="w-16 h-12 object-cover rounded-[4px]"
                        />
                        <div className="text-[10px] text-center truncate max-w-[64px] text-muted-foreground mt-0.5">
                          {photo.aisle && photo.section ? `${photo.aisle}-${photo.section}` : photo.section || `#${origIdx + 1}`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div className="space-y-3">
              {selectedPinId && localPins.length > 0 && currentPhoto && (() => {
                const selectedPin = localPins.find(p => p.id === selectedPinId);
                if (!selectedPin) return null;
                return (
                  <>
                    <div
                      ref={(el) => {
                        if (el) {
                          const h = el.offsetHeight;
                          if (h !== previewHeight) setPreviewHeight(h);
                        }
                      }}
                      className="fixed top-[53px] left-4 z-30 w-fit bg-background/95 backdrop-blur-sm rounded-md pb-1"
                    >
                      <ReelCropPreview
                        photoUrl={currentPhoto.url}
                        pinX={selectedPin.x}
                        pinY={selectedPin.y}
                        label={formatPinLabel(selectedPin.label)}
                        zoomLevel={zoomLevel}
                        onZoomChange={setZoomLevel}
                        onClose={() => setSelectedPinId(null)}
                      />
                    </div>
                    <div style={{ height: previewHeight }} />
                  </>
                );
              })()}
              <div className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-[hsl(18_60%_40%)] dark:text-[hsl(25_70%_60%)]" data-testid="text-pin-table-title">Enter Details for Each Pin #</div>
              <div className="overflow-x-auto">
                <table className="pin-entry-table" ref={pinTableRef} data-testid="pin-entry-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70, textAlign: "center" }}>PIN #:</th>
                      <th style={{ minWidth: 140 }}>Catalog:</th>
                      <th style={{ width: 80, textAlign: "center" }}><span className="hidden sm:inline">Vendor Code:</span><span className="sm:hidden">VEN:</span></th>
                      <th style={{ width: 80 }}><span className="hidden sm:inline">Reel Footage:</span><span className="sm:hidden">LENGTH:</span></th>
                      <th style={{ width: 60, textAlign: "center" }}># of Reels:</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {localPins.map((pin, index) => (
                      <tr
                        key={pin.id}
                        ref={(el) => { if (el) rowRefs.current.set(pin.id, el); else rowRefs.current.delete(pin.id); }}
                        data-testid={`pin-entry-row-${index}`}
                        className={`${selectedPinId === pin.id ? "ring-1 ring-primary/40" : ""} ${pin.flagged ? "flagged-row" : ""}`}
                      >
                        <td style={{ textAlign: "center" }}>
                          <span
                            className="pin-position-cell cursor-pointer"
                            onClick={() => {
                              setSelectedPinId(pin.id);
                              const pinEl = containerRef.current?.querySelector(`[data-pin-id="${pin.id}"]`);
                              if (pinEl) pinEl.scrollIntoView({ behavior: "smooth", block: "center" });
                            }}
                            data-testid={`pin-label-link-${pin.id}`}
                          >{formatPinLabel(pin.label)}</span>
                        </td>
                        <td className="relative">
                          <input
                            type="text"
                            className="input-caps"
                            value={pin.wireDetails || ""}
                            onChange={(e) => {
                              const val = e.target.value.toUpperCase();
                              updatePinField(pin.id, "wireDetails", val);
                              const matches = lookupCatalog(val, userParsedCatalog);
                              setSuggestions(matches);
                              setSuggestionIndex(-1);
                              if (matches.length > 0) {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setSuggestionPos({ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
                                setActiveSuggestionPin(pin.id);
                              } else {
                                setActiveSuggestionPin(null);
                                setSuggestionPos(null);
                              }
                            }}
                            onFocus={(e) => {
                              setSelectedPinId(pin.id);
                              setSuggestionIndex(-1);
                              scrollInputIntoView(e.currentTarget);
                              if (pin.wireDetails) {
                                const matches = lookupCatalog(pin.wireDetails, userParsedCatalog);
                                setSuggestions(matches);
                                if (matches.length > 0) {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setSuggestionPos({ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
                                  setActiveSuggestionPin(pin.id);
                                }
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setActiveSuggestionPin(null);
                                setSuggestionIndex(-1);
                                setSuggestionPos(null);
                              }, 200);
                              // Always attempt auto-fill on blur/tab so ambiguous-match
                              // toast fires even when the dropdown was open but nothing
                              // was highlighted. Suggestion-click race is safe: onMouseDown
                              // on suggestion items fires before onBlur, so the match is
                              // already applied and applyAutoFill will find an exact hit.
                              applyAutoFill(pin.id);
                            }}
                            onKeyDown={(e) => {
                              if (activeSuggestionPin === pin.id && suggestions.length > 0) {
                                if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  setSuggestionIndex(prev => Math.min(prev + 1, suggestions.length - 1));
                                } else if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  setSuggestionIndex(prev => Math.max(prev - 1, -1));
                                } else if (e.key === "Enter") {
                                  e.preventDefault();
                                  let s = suggestionIndex >= 0 ? suggestions[suggestionIndex] : null;
                                  if (!s) {
                                    // No arrow-key selection — resolve using same logic as applyAutoFill:
                                    // exact normalized match first, then sole candidate, else ambiguous.
                                    const typed = (e.currentTarget as HTMLInputElement).value;
                                    const normalized = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
                                    const exact = suggestions.find(m => m.catalog === normalized || m.aliasLabel === normalized);
                                    if (exact) {
                                      s = exact;
                                    } else if (suggestions.length === 1) {
                                      s = suggestions[0];
                                    } else {
                                      toast({ title: "Ambiguous catalog entry", description: "Multiple matches found — select one from the dropdown.", variant: "destructive" });
                                    }
                                  }
                                  if (s) {
                                    updatePinField(pin.id, "wireDetails", s.catalog);
                                    if (s.vendor) updatePinField(pin.id, "vendorCode", s.vendor);
                                    if (s.footage) updatePinField(pin.id, "footage", s.footage);
                                    if (s.aliasLabel) {
                                      updatePinField(pin.id, "aliasUsed", s.aliasLabel);
                                      appendAliasToPhotoNotes(s.aliasLabel, pin.label);
                                    }
                                    setActiveSuggestionPin(null);
                                    setSuggestions([]);
                                    setSuggestionIndex(-1);
                                    setSuggestionPos(null);
                                    const nextInput = document.querySelector(`[data-testid="input-wire-details-${index + 1}"]`) as HTMLInputElement | null;
                                    if (nextInput) setTimeout(() => nextInput.focus(), 0);
                                  }
                                } else if (e.key === "Escape") {
                                  setActiveSuggestionPin(null);
                                  setSuggestions([]);
                                  setSuggestionIndex(-1);
                                  setSuggestionPos(null);
                                }
                              }
                            }}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="characters"
                            placeholder="Type catalog..."
                            data-testid={`input-wire-details-${index}`}
                          />
                          {activeSuggestionPin === pin.id && suggestions.length > 0 && suggestionPos && (() => {
                            const dropDown = window.innerHeight - suggestionPos.bottom >= 180;
                            return (
                              <div
                                ref={suggestionsRef}
                                style={{
                                  position: "fixed",
                                  left: suggestionPos.left,
                                  width: Math.max(suggestionPos.width, 220),
                                  zIndex: 9999,
                                  ...(dropDown
                                    ? { top: suggestionPos.bottom + 2 }
                                    : { bottom: window.innerHeight - suggestionPos.top + 2 }),
                                }}
                                className="max-h-48 overflow-y-auto rounded-md border bg-popover shadow-lg"
                                data-testid={`suggestions-${index}`}
                              >
                                {suggestions.map((s, si) => (
                                  <button
                                    key={`${s.vendor}-${s.catalog}`}
                                    type="button"
                                    className={`w-full text-left px-2 py-1.5 text-xs cursor-pointer border-b last:border-b-0 border-border/50 ${si === suggestionIndex ? "bg-primary text-primary-foreground font-medium" : ""}`}
                                    onMouseEnter={() => setSuggestionIndex(si)}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      updatePinField(pin.id, "wireDetails", s.catalog);
                                      if (s.vendor) updatePinField(pin.id, "vendorCode", s.vendor);
                                      if (s.footage) updatePinField(pin.id, "footage", s.footage);
                                      if (s.aliasLabel) {
                                        updatePinField(pin.id, "aliasUsed", s.aliasLabel);
                                        appendAliasToPhotoNotes(s.aliasLabel, pin.label);
                                      }
                                      setActiveSuggestionPin(null);
                                      setSuggestions([]);
                                      setSuggestionIndex(-1);
                                      setSuggestionPos(null);
                                      const nextInput = document.querySelector(`[data-testid="input-wire-details-${index + 1}"]`) as HTMLInputElement | null;
                                      if (nextInput) setTimeout(() => nextInput.focus(), 0);
                                    }}
                                    data-testid={`suggestion-${s.catalog}`}
                                  >
                                    {s.aliasLabel ? (
                                      <>
                                        <span className="font-mono font-semibold">{s.aliasLabel}</span>
                                        <span className="text-muted-foreground mx-1">→</span>
                                        <span className="font-mono">{s.catalog}</span>
                                        <span className="text-muted-foreground ml-1">({s.vendor})</span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="font-mono font-semibold">{s.catalog}</span>
                                        <span className="text-muted-foreground ml-2">{s.description}</span>
                                        {s.footage && <span className="text-muted-foreground ml-1">({toDisplayUnit(s.footage, currentUnit)}{uLabel})</span>}
                                      </>
                                    )}
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <select
                            value={customCodePinId === pin.id ? "__custom__" : (pin.vendorCode || "")}
                            onChange={(e) => {
                              if (e.target.value === "__custom__") {
                                setCustomCodeInput("");
                                setCustomCodePinId(pin.id);
                              } else {
                                updatePinField(pin.id, "vendorCode", e.target.value);
                              }
                            }}
                            onFocus={(e) => { setSelectedPinId(pin.id); scrollInputIntoView(e.currentTarget); }}
                            data-testid={`select-vendor-code-${index}`}
                          >
                            <option value="">--</option>
                            {vendorCodes.map(code => (
                              <option key={code} value={code}>{code}</option>
                            ))}
                            <option value="__custom__">Custom...</option>
                          </select>
                          {customCodePinId === pin.id && (
                            <div className="flex items-center gap-1 mt-1">
                              <input
                                type="text"
                                value={customCodeInput}
                                onChange={(e) => setCustomCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3))}
                                maxLength={3}
                                placeholder="ABC"
                                className="w-14 text-center uppercase border rounded px-1"
                                autoFocus
                                data-testid={`input-custom-vendor-${index}`}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && customCodeInput.length === 3) {
                                    addCustomCode(customCodeInput);
                                    updatePinField(pin.id, "vendorCode", customCodeInput);
                                    setCustomCodePinId(null);
                                    setCustomCodeInput("");
                                  } else if (e.key === "Escape") {
                                    setCustomCodePinId(null);
                                    setCustomCodeInput("");
                                  }
                                }}
                              />
                              <button
                                onClick={() => {
                                  if (customCodeInput.length === 3) {
                                    addCustomCode(customCodeInput);
                                    updatePinField(pin.id, "vendorCode", customCodeInput);
                                    setCustomCodePinId(null);
                                    setCustomCodeInput("");
                                  }
                                }}
                                className="text-xs px-1 border rounded"
                                data-testid={`button-save-custom-vendor-${index}`}
                              >OK</button>
                            </div>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={
                              focusedFootagePinId === pin.id || pin.footage == null
                                ? (pin.footage != null ? toDisplayUnit(pin.footage, currentUnit) : "")
                                : toDisplayUnit(pin.footage, currentUnit).toLocaleString()
                            }
                            onChange={(e) => {
                              const raw = e.target.value.replace(/,/g, "");
                              updatePinField(pin.id, "footage", raw ? toBaseFeet(parseInt(raw), currentUnit) : undefined);
                            }}
                            onFocus={(e) => { setSelectedPinId(pin.id); setFocusedFootagePinId(pin.id); scrollInputIntoView(e.currentTarget); }}
                            onBlur={() => setFocusedFootagePinId(null)}
                            autoComplete="off"
                            data-testid={`input-footage-${index}`}
                          />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <input
                            type="number"
                            value={pin.reelCount}
                            onChange={(e) => updatePinField(pin.id, "reelCount", Math.max(1, parseInt(e.target.value) || 1))}
                            onFocus={(e) => { setSelectedPinId(pin.id); scrollInputIntoView(e.currentTarget); }}
                            min={1}
                            inputMode="numeric"
                            autoComplete="off"
                            style={{ width: "100%", textAlign: "center" }}
                            data-testid={`input-reels-${index}`}
                          />
                        </td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                          <button
                            type="button"
                            className="clear-row-btn"
                            onClick={() => clearRow(pin.id)}
                            title="Clear row"
                            data-testid={`button-clear-row-${index}`}
                          >
                            &#10005;
                          </button>
                          {pin.flagged ? (
                            <button
                              type="button"
                              className="flag-btn flagged"
                              onClick={(e) => {
                                e.stopPropagation();
                                doFlagPin(pin.id, false);
                              }}
                              title="Remove re-shoot flag"
                              data-testid={`button-flag-${index}`}
                            >
                              <Flag className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <Popover
                              open={flagPopoverPinId === pin.id}
                              onOpenChange={(open) => {
                                if (open) {
                                  setFlagPopoverPinId(pin.id);
                                  setFlagReasonDraft("");
                                } else {
                                  setFlagPopoverPinId(null);
                                }
                              }}
                            >
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  className="flag-btn"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Flag for re-shoot"
                                  data-testid={`button-flag-${index}`}
                                >
                                  <Flag className="h-3.5 w-3.5" />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-64 p-3 space-y-2"
                                onClick={(e) => e.stopPropagation()}
                                data-testid={`popover-flag-reason-${index}`}
                              >
                                <p className="text-xs font-medium">Flag for re-shoot</p>
                                <Input
                                  placeholder="Reason (optional)"
                                  value={flagReasonDraft}
                                  onChange={(e) => setFlagReasonDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      doFlagPin(pin.id, true, flagReasonDraft.trim() || undefined);
                                      setFlagPopoverPinId(null);
                                    }
                                  }}
                                  data-testid={`input-flag-reason-${index}`}
                                  autoFocus
                                />
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setFlagPopoverPinId(null)}
                                    data-testid={`button-flag-cancel-${index}`}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      doFlagPin(pin.id, true, flagReasonDraft.trim() || undefined);
                                      setFlagPopoverPinId(null);
                                    }}
                                    data-testid={`button-flag-confirm-${index}`}
                                  >
                                    <Flag className="h-3.5 w-3.5 mr-1" />
                                    Flag
                                  </Button>
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {batchProgress && (
                <div className="space-y-2" data-testid="batch-progress">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Creating entries...</span>
                    <span>{batchProgress.current} / {batchProgress.total}</span>
                  </div>
                  <Progress value={(batchProgress.current / batchProgress.total) * 100} />
                  {batchProgress.errors.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      Failed: {batchProgress.errors.join(", ")}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  className="bg-[hsl(145_60%_28%)] text-white border-[hsl(145_60%_22%)]"
                  onClick={handleCommitClick}
                  disabled={createEntries.isPending || !aisle || !effectiveCanEdit || localPins.length === 0}
                  data-testid="button-create-entries-from-pins"
                >
                  {createEntries.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Reel(s) from Image
                </Button>
                {nextReelCount > 0 && (
                  <Button
                    size="sm"
                    className="bg-[hsl(30_90%_45%)] text-white border border-[hsl(30_90%_35%)]"
                    onClick={navigateToNextIncomplete}
                    data-testid="button-next-incomplete"
                  >
                    <AlertCircle className="h-3.5 w-3.5 mr-1" />
                    <span className="text-xs font-semibold">Go To Next Reel ({nextReelCount})</span>
                  </Button>
                )}
              </div>
              {!aisle && (
                <p className="text-xs text-center text-muted-foreground" data-testid="text-create-entries-hint">
                  Fill in Aisle above to enable this button
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  className="border-[hsl(18_40%_50%/0.5)] text-[hsl(18_60%_40%)] dark:text-[hsl(25_60%_70%)] dark:border-[hsl(215_30%_50%/0.4)]"
                  onClick={() => {
                    setLocalPins((prev) => prev.map((p) => ({
                      ...p,
                      wireDetails: undefined,
                      vendorCode: undefined,
                      footage: undefined,
                      reelCount: 1,
                    })));
                  }}
                  disabled={createEntries.isPending || !localPins.some(p => p.wireDetails || p.vendorCode || p.footage != null || (p.reelCount ?? 1) !== 1)}
                  data-testid="button-clear-pins"
                >
                  Clear All Details
                </Button>
              </div>

          </div>
        </>
      )}

      <Dialog open={!!relabelPinId} onOpenChange={(open) => { if (!open) { setRelabelPinId(null); setRelabelValue(""); setRelabelIsCommitted(false); } }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Rename Pin</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Enter new shelf/spot code:</p>
          <Input
            value={relabelValue}
            onChange={(e) => setRelabelValue(e.target.value)}
            placeholder="e.g., 9001"
            className="text-center font-mono text-lg"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applyRelabel(); }
              if (e.key === "Escape") { setRelabelPinId(null); setRelabelValue(""); setRelabelIsCommitted(false); }
            }}
            data-testid="input-relabel-pin"
          />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => { setRelabelPinId(null); setRelabelValue(""); setRelabelIsCommitted(false); }} data-testid="button-cancel-relabel">
              Cancel
            </Button>
            <Button className="flex-1" onClick={applyRelabel} disabled={!relabelValue.trim()} data-testid="button-save-relabel">
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={detailWarnLabels.length > 0} onOpenChange={(open) => { if (!open) setDetailWarnLabels([]); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detail photo available</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2">
                  {detailWarnLabels.length === 1
                    ? <>Pin <span className="font-mono font-semibold text-foreground">{detailWarnLabels[0]}</span> has a detail photo.</>
                    : <>Pins <span className="font-mono font-semibold text-foreground">{detailWarnLabels.join(", ")}</span> each have a detail photo.</>
                  }
                </p>
                <p>For the most accurate data, fill in and commit from the detail shot instead of the overview photo.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogAction
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
              onClick={() => {
                detailWarnLabels.forEach(l => dismissedDetailWarn.current.add(l));
                setDetailWarnLabels([]);
                handleCommitClick();
              }}
              data-testid="button-detail-warn-commit-anyway"
            >
              Commit anyway
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                const targetLabel = detailWarnLabels[0];
                const targetDbId = photos.find(
                  ph => ph.parentPhotoId === currentPhoto?.dbId && ph.linkedPinLabel === targetLabel
                )?.id;
                if (targetDbId != null) {
                  const idx = uploadedPhotos.findIndex(p => p.dbId === targetDbId);
                  if (idx !== -1) setCurrentPhotoIdx(idx);
                }
                setDetailWarnLabels([]);
              }}
              data-testid="button-detail-warn-go-to-detail"
            >
              Go to detail shot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!conflictDialog} onOpenChange={(open) => { if (!open) setConflictDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pin label conflict detected</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p className="mb-2">The following pin labels already have committed entries for this photo:</p>
                <p className="font-mono font-semibold text-foreground mb-3">
                  {conflictDialog?.conflicts.map(c => c.label).join(", ")}
                </p>
                <p>How would you like to proceed?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={() => setConflictDialog(null)} data-testid="button-conflict-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => { setConflictDialog(null); createEntries.mutate({ overwrite: false }); }}
              data-testid="button-conflict-duplicates"
            >
              Create duplicates
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => { setConflictDialog(null); createEntries.mutate({ overwrite: true }); }}
              data-testid="button-conflict-overwrite"
            >
              Overwrite existing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      </div>

      {isMobile && (
        <Sheet open={scanPanelOpen} onOpenChange={(open) => {
          if (!open) {
            setScanPanelOpen(false);
            try { localStorage.setItem(scanPanelOpenKey(sessionId), "false"); } catch {}
          }
        }}>
          <SheetContent
            side="bottom"
            className="h-[65vh] bg-[hsl(25_12%_12%)] border-t border-[hsl(280_50%_30%/0.4)] p-4 overflow-y-auto"
            data-testid="scan-panel-mobile-sheet"
          >
            <div className="flex items-center gap-2 mb-3">
              <ScanLine className="h-4 w-4 text-[hsl(280_60%_55%)]" />
              <span className="text-sm font-semibold text-[hsl(280_60%_70%)]">Scan Panel</span>
            </div>
            <LabelScannerTab
              sessionId={sessionId}
              photos={photos}
              currentPhotoId={scanPanelCurrentPhotoId}
              canEdit={canEdit}
              isAdmin={isAdmin}
              onPinDataChanged={onPinDataChanged}
              onlineUsers={onlineUsers}
              pushUndo={onPushUndo}
              onApplied={onScanApplied}
              onBatchModeChange={setScanBatchMode}
              onClose={toggleScanPanel}
            />
          </SheetContent>
        </Sheet>
      )}
      <Sheet open={!!editingCommittedPinId} onOpenChange={(open) => {
        if (!open) setEditingCommittedPinId(null);
      }}>
        <SheetContent
          side="bottom"
          className="bg-card border-t border-border p-4 overflow-y-auto"
          style={{ maxHeight: "60vh" }}
          data-testid="committed-pin-edit-sheet"
        >
          <div className="space-y-3 max-w-md mx-auto">
            <div className="flex items-center gap-2 mb-1">
              <Pencil className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Edit Pin P{committedEditState.label}</span>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Relabel Pin:</label>
              <Input
                value={committedEditState.label}
                onChange={(e) => setCommittedEditState(s => ({ ...s, label: e.target.value }))}
                className="h-8 text-sm font-mono"
                data-testid="input-committed-relabel"
              />
            </div>
            <div className="relative">
              <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Catalog:</label>
              <Input
                value={committedEditState.wireDetails}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setCommittedEditState(s => ({ ...s, wireDetails: val }));
                  if (val.length >= 2) {
                    const matches = lookupCatalog(val, userParsedCatalog);
                    setCommittedCatalogSuggestions(matches);
                    setShowCommittedCatalogSuggestions(matches.length > 0);
                  } else {
                    setCommittedCatalogSuggestions([]);
                    setShowCommittedCatalogSuggestions(false);
                  }
                }}
                onFocus={() => {
                  if (committedEditState.wireDetails.length >= 2) {
                    const matches = lookupCatalog(committedEditState.wireDetails, userParsedCatalog);
                    setCommittedCatalogSuggestions(matches);
                    setShowCommittedCatalogSuggestions(matches.length > 0);
                  }
                }}
                onBlur={() => setTimeout(() => setShowCommittedCatalogSuggestions(false), 200)}
                className="h-8 text-sm uppercase"
                autoComplete="off"
                data-testid="input-committed-catalog"
              />
              {showCommittedCatalogSuggestions && committedCatalogSuggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-36 overflow-y-auto" data-testid="committed-catalog-suggestions">
                  {committedCatalogSuggestions.map((s) => (
                    <button
                      key={s.catalog}
                      type="button"
                      className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground border-b border-border/30 last:border-0"
                      onMouseDown={(e) => { e.preventDefault(); applyCommittedCatalogMatch(s); }}
                      data-testid={`committed-suggestion-${s.catalog}`}
                    >
                      <span className="font-mono font-semibold">{s.catalog}</span>
                      {s.footage && <span className="text-orange-500 ml-1">({toDisplayUnit(s.footage, currentUnit)}{uLabel})</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Vendor Code:</label>
              <Input
                value={committedEditState.vendorCode}
                onChange={(e) => setCommittedEditState(s => ({ ...s, vendorCode: e.target.value.toUpperCase().slice(0, 3) }))}
                className="h-8 text-sm uppercase"
                maxLength={3}
                list="vendor-code-suggestions-committed"
                data-testid="input-committed-vendor"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block">Footage ({uLabel}):</label>
                <Input
                  type="number"
                  value={committedEditState.footage}
                  onChange={(e) => setCommittedEditState(s => ({ ...s, footage: e.target.value }))}
                  className="h-8 text-sm"
                  data-testid="input-committed-footage"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-0.5 block"># Reels:</label>
                <Input
                  type="number"
                  value={committedEditState.reelCount}
                  onChange={(e) => setCommittedEditState(s => ({ ...s, reelCount: e.target.value }))}
                  min={1}
                  className="h-8 text-sm"
                  data-testid="input-committed-reel-count"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8"
                onClick={() => setEditingCommittedPinId(null)}
                data-testid="button-cancel-committed-edit"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="flex-1 h-8"
                onClick={saveCommittedPinEdit}
                data-testid="button-save-committed-edit"
              >
                Save
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <datalist id="vendor-code-suggestions-committed">
        {vendorCodes.map(code => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </div>
  );
}
