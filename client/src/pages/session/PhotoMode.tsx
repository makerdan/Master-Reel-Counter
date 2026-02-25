import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Camera, Plus, Trash2, RotateCw, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
  Loader2, RotateCcw, AlertTriangle, Move, StickyNote, Focus, Eye,
  AlertCircle, Flag, ImagePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { lookupCategory, type ParsedCatalogEntry } from "@/lib/wireReference";
import type { Photo, Pin } from "@shared/schema";
import ReelCropPreview from "./ReelCropPreview";
import type { LocalPin } from "./types";
import { deriveVendorCode } from "./utils";
import { useTimezone } from "@/hooks/use-timezone";
import { formatFullTimestamp } from "@/lib/timezone";

export default function PhotoMode({ sessionId, photos, navigateToPhotoId, navigateAisle, navigateSection, onNavigated, canEdit = true, initialPhotoIndex = 0 }: { sessionId: number; photos: Photo[]; navigateToPhotoId?: number | null; navigateAisle?: string; navigateSection?: string; onNavigated?: () => void; canEdit?: boolean; initialPhotoIndex?: number }) {
  const tz = useTimezone();
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [aisle, setAisle] = useState("");
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{ url: string; objectPath: string; section: string; aisle?: string; dbId?: number; filename?: string; timestamp?: string; notes?: string; isDetailShot?: boolean; parentPhotoId?: number; pinScale?: number }>>([]);
  const [currentPhotoIdx, setCurrentPhotoIdx] = useState(0);
  const initialRestoredRef = useRef(false);
  const saveEnabledRef = useRef(false);
  const [viewingNearbyIdx, setViewingNearbyIdx] = useState<number | null>(null);

  const { data: incompletePinsData } = useQuery<{ photoId: number; incompleteCount: number }[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"],
    enabled: sessionId > 0,
    refetchInterval: 10000,
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
          label: p.label || "01",
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
  const setLocalPins = useCallback((updater: LocalPin[] | ((prev: LocalPin[]) => LocalPin[])) => {
    _setLocalPins((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      localPinsRef.current = next;
      return next;
    });
  }, []);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [committedPins, setCommittedPins] = useState<Array<{ id: string; dbId?: number; x: number; y: number; label: string; reelCount: number }>>([]);
  const [nearbyCommittedPins, setNearbyCommittedPins] = useState<Array<{ id: string; x: number; y: number; label: string; reelCount: number }>>([]);
  const [pinsLoaded, setPinsLoaded] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutoSave = useRef(false);
  const [relabelPinId, setRelabelPinId] = useState<string | null>(null);
  const [relabelValue, setRelabelValue] = useState("");
  const dragRef = useRef<{
    isDragging: boolean;
    pinId: string | null;
    startX: number;
    startY: number;
    moved: boolean;
  }>({ isDragging: false, pinId: null, startX: 0, startY: 0, moved: false });
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; errors: string[] } | null>(null);
  const [activeSuggestionPin, setActiveSuggestionPin] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ParsedCatalogEntry[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);

  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [pinScale, setPinScale] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(0.15);
  const pinScaleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinTableRef = useRef<HTMLTableElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const photoImgRef = useRef<HTMLImageElement>(null);
  const [photoNotes, setPhotoNotes] = useState("");
  const [isDetailShot, setIsDetailShot] = useState(false);
  const [parentPhotoId, setParentPhotoId] = useState<number | undefined>(undefined);
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
  const displayedPhotoIdx = viewingNearbyIdx !== null ? viewingNearbyIdx : currentPhotoIdx;
  const displayedPhoto = uploadedPhotos[displayedPhotoIdx];

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
        pinScale: p.pinScale ?? 1,
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
    setUploadedPhotos(mapped);
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
      onNavigated?.();
    }
  }, [navigateToPhotoId, uploadedPhotos]);

  useEffect(() => {
    const photo = uploadedPhotos[currentPhotoIdx];
    if (photo) {
      setAisle(photo.aisle || "");
    }
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
        })),
      });
    } catch {
    }
  }, [uploadedPhotos, currentPhotoIdx]);

  useEffect(() => {
    if (!currentPhoto?.dbId) {
      setPinsLoaded(false);
      return;
    }
    setPinsLoaded(false);
    skipAutoSave.current = true;
    const loadPins = async () => {
      try {
        const res = await apiRequest("GET", `/api/photos/${currentPhoto.dbId}/pins`);
        const dbPins: Pin[] = await res.json();
        const draftPins = dbPins.filter(p => !p.entryId);
        const committed = dbPins.filter(p => !!p.entryId);
        setCommittedPins(committed.map(p => ({
          id: `committed-${p.id}`,
          dbId: p.id,
          x: p.xPercent,
          y: p.yPercent,
          label: p.label || "01",
          reelCount: p.reelCount || 1,
        })));
        if (draftPins.length > 0) {
          setLocalPins(draftPins.map(p => ({
            id: `pin-${p.id}`,
            x: p.xPercent,
            y: p.yPercent,
            label: p.label || "01",
            reelCount: p.reelCount || 1,
            wireDetails: p.wireDetails || undefined,
            vendorCode: p.vendorCode || undefined,
            footage: p.footage || undefined,
            flagged: p.flagged || false,
          })));
        } else {
          setLocalPins([]);
        }
      } catch {
        setLocalPins([]);
      }
      setPinsLoaded(true);
      setTimeout(() => { skipAutoSave.current = false; }, 500);
    };
    loadPins();
  }, [currentPhoto?.dbId]);

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
      } catch {}
    }, 500);
  }, [displayedPhoto?.dbId]);

  useEffect(() => {
    if (!currentPhoto?.dbId || !pinsLoaded || skipAutoSave.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
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
          })),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
      } catch {
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
      setIsDetailShot(currentPhoto.isDetailShot || false);
      setParentPhotoId(currentPhoto.parentPhotoId);
    }
  }, [currentPhotoIdx, currentPhoto?.dbId]);

  const savePhotoMeta = useCallback(async (notes: string, detail: boolean, parentId: number | undefined) => {
    if (!currentPhoto?.dbId) return;
    try {
      await apiRequest("PATCH", `/api/photos/${currentPhoto.dbId}`, {
        notes: notes || null,
        isDetailShot: detail,
        parentPhotoId: parentId || null,
      });
      setUploadedPhotos((prev) =>
        prev.map((p, i) =>
          i === currentPhotoIdx ? { ...p, notes, isDetailShot: detail, parentPhotoId: parentId } : p
        )
      );
    } catch {}
  }, [currentPhoto?.dbId, currentPhotoIdx]);

  const handleNotesChange = useCallback((val: string) => {
    setPhotoNotes(val);
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      savePhotoMeta(val, isDetailShot, parentPhotoId);
    }, 1200);
  }, [savePhotoMeta, isDetailShot, parentPhotoId]);

  const handleDetailShotToggle = useCallback((checked: boolean) => {
    setIsDetailShot(checked);
    if (!checked) {
      setParentPhotoId(undefined);
      savePhotoMeta(photoNotes, checked, undefined);
    } else {
      savePhotoMeta(photoNotes, checked, parentPhotoId);
    }
  }, [savePhotoMeta, photoNotes, parentPhotoId]);

  const handleParentPhotoChange = useCallback((val: string) => {
    const id = val ? parseInt(val) : undefined;
    setParentPhotoId(id);
    savePhotoMeta(photoNotes, isDetailShot, id);
  }, [savePhotoMeta, photoNotes, isDetailShot]);

  const parentPhotoOptions = uploadedPhotos.filter((p, i) => i !== currentPhotoIdx && p.dbId && !p.isDetailShot);

  const getNextReceivingSection = useCallback(() => {
    const isRec = aisle.trim().toLowerCase() === "receiving";
    if (!isRec) return "000";
    const allReceivingPhotos = [
      ...photos.filter(p => (p.aisle || "").toLowerCase() === "receiving"),
      ...uploadedPhotos.filter(p => (p.aisle || "").toLowerCase() === "receiving" && !photos.some(pp => pp.id === p.dbId)),
    ];
    const existingSections = allReceivingPhotos
      .map(p => parseInt(p.section || "0", 10))
      .filter(n => !isNaN(n));
    const maxSection = existingSections.length > 0 ? Math.max(...existingSections) : 0;
    return String(maxSection + 1).padStart(3, "0");
  }, [aisle, photos, uploadedPhotos]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const isRec = aisle.trim().toLowerCase() === "receiving";
    let nextRecNum = isRec ? parseInt(getNextReceivingSection(), 10) : 0;

    for (const file of files) {
      try {
        const result = await uploadFile(file);
        if (!result) {
          toast({ title: "Upload failed", description: `Could not upload ${file.name}. Please try again.`, variant: "destructive" });
          continue;
        }
        let sectionVal = "";
        if (isRec) {
          sectionVal = String(nextRecNum).padStart(3, "0");
          nextRecNum++;
        }
        const res = await apiRequest("POST", `/api/sessions/${sessionId}/photos`, {
          objectStorageKey: result.objectPath,
          originalFilename: file.name,
          mimeType: file.type,
          aisle,
          section: sectionVal,
        });
        const savedPhoto = await res.json();
        const photoUrl = result.objectPath;
        setUploadedPhotos((prev) => {
          const existingCount = prev.filter((p) => p.filename?.replace(/_\d+(?=\.\w+$)/, "") === file.name || p.filename === file.name).length;
          const dotIdx = file.name.lastIndexOf(".");
          const base = dotIdx > 0 ? file.name.substring(0, dotIdx) : file.name;
          const ext = dotIdx > 0 ? file.name.substring(dotIdx) : "";
          const numberedName = `${base}_${String(existingCount + prev.length + 1).padStart(4, "0")}${ext}`;
          return [...prev, {
            url: photoUrl,
            objectPath: result.objectPath,
            section: sectionVal,
            aisle: aisle || "",
            dbId: savedPhoto.id,
            filename: numberedName,
            timestamp: formatFullTimestamp(new Date(), tz),
          }];
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

  const handleContainerClick = (e: React.MouseEvent) => {
    if (isPanning || panMode) return;
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

    const existingNumbers = [
      ...localPins.map((p) => parseInt(p.label, 10)),
      ...committedPins.map((p) => parseInt(p.label, 10)),
    ].filter((n) => !isNaN(n));
    let nextNumber = 1;
    while (existingNumbers.includes(nextNumber)) {
      nextNumber++;
    }
    const newPin: LocalPin = {
      id: `pin-${Date.now()}`,
      x,
      y,
      label: String(nextNumber).padStart(2, "0"),
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
      const newScale = Math.min(5, Math.max(1, oldScale + delta));
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

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchRef.current = {
        dist: Math.hypot(dx, dy),
        midX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        midY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        scale: scaleRef.current,
      };
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchRef.current.dist;
      const newScale = Math.min(5, Math.max(1, pinchRef.current.scale * ratio));
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomAtPoint(midX, midY, newScale);
    }
  }, [zoomAtPoint]);

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

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
    const pin = localPins.find((p) => p.id === pinId);
    if (pin) {
      setRelabelPinId(pinId);
      setRelabelValue(pin.label);
    }
  }, [localPins]);

  const applyRelabel = useCallback(() => {
    if (!relabelPinId || !relabelValue.trim()) return;
    setLocalPins((prev) =>
      prev.map((p) => p.id === relabelPinId ? { ...p, label: relabelValue.trim() } : p)
    );
    setRelabelPinId(null);
    setRelabelValue("");
  }, [relabelPinId, relabelValue]);

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

  const copyRowDown = useCallback((index: number) => {
    setLocalPins((prev) => {
      if (index >= prev.length - 1) return prev;
      const src = prev[index];
      return prev.map((p, i) =>
        i === index + 1
          ? { ...p, wireDetails: src.wireDetails, vendorCode: src.vendorCode, footage: src.footage }
          : p
      );
    });
  }, []);

  const deleteCommittedPin = useCallback(async (pin: { id: string; dbId?: number }) => {
    if (pin.dbId) {
      try {
        await apiRequest("DELETE", `/api/pins/${pin.dbId}`);
      } catch {
        toast({ title: "Failed to delete pin", variant: "destructive" });
        return;
      }
    }
    setCommittedPins(prev => prev.filter(p => p.id !== pin.id));
    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
  }, [toast, sessionId]);

  const applyAutoFill = useCallback((pinId: string) => {
    const pin = localPinsRef.current.find(p => p.id === pinId);
    if (!pin?.wireDetails) return;
    const normalized = pin.wireDetails.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const matches = lookupCategory(pin.wireDetails);
    if (matches.length === 0) return;
    const exactMatch = matches.find(m => m.catalog === normalized);
    const match = exactMatch || (matches.length === 1 ? matches[0] : null);
    if (!match) return;
    updatePinField(pinId, "wireDetails", match.catalog);
    if (!pin.vendorCode && match.vendor) updatePinField(pinId, "vendorCode", match.vendor);
    if (!pin.footage && match.footage) updatePinField(pinId, "footage", match.footage);
  }, [updatePinField]);

  const clearRow = useCallback((pinId: string) => {
    setLocalPins((prev) =>
      prev.map((p) =>
        p.id === pinId
          ? { ...p, wireDetails: undefined, vendorCode: undefined, footage: undefined, reelCount: 1 }
          : p
      )
    );
  }, []);

  const createEntries = useMutation({
    mutationFn: async () => {
      const allPins = [...localPinsRef.current];
      const pinsToCommit = allPins.filter(p => p.wireDetails && p.wireDetails.trim().length > 0);
      if (pinsToCommit.length === 0) {
        return [];
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

      for (const pin of pinsToCommit) {
        try {
          const reelLabel = pin.wireDetails || `Pin ${pin.label}`;
          const totalFootage = pin.footage ? pin.footage * pin.reelCount : undefined;
          const noteParts: string[] = [];
          if (isDetail) noteParts.push(`From detail shot: ${currentPhoto?.filename || "detail"}`);
          const res = await apiRequest("POST", `/api/sessions/${sessionId}/entries`, {
            aisle: entryAisle,
            section: entrySection,
            position: "",
            reelTag: reelLabel,
            manufacturer: pin.vendorCode || undefined,
            footage: totalFootage,
            reelCount: pin.reelCount,
            photoId: entryPhotoId || undefined,
            notes: noteParts.length > 0 ? noteParts.join(" | ") : undefined,
          });
          const entry = await res.json();
          completed++;
          setBatchProgress({ current: completed, total: totalEntries, errors });
          if (pinPhotoId) {
            const pinRes = await apiRequest("POST", `/api/photos/${pinPhotoId}/pins`, {
              xPercent: pin.x,
              yPercent: pin.y,
              label: pin.label,
              reelCount: pin.reelCount,
              entryId: entry.id,
              flagged: pin.flagged || false,
            });
            const savedPin = await pinRes.json();
            (pin as any)._dbPinId = savedPin.id;
          }
        } catch {
          errors.push(`Pin ${pin.label}`);
          setBatchProgress({ current: completed, total: totalEntries, errors });
        }
      }
      if (errors.length > 0) {
        throw new Error(`Failed to create entries for: ${errors.join(", ")}`);
      }
      const remainingDraftPins = allPins.filter(p => !p.wireDetails || p.wireDetails.trim().length === 0);
      if (pinPhotoId) {
        try {
          await apiRequest("PUT", `/api/photos/${pinPhotoId}/draft-pins`, {
            pins: remainingDraftPins.map(p => ({
              xPercent: p.x,
              yPercent: p.y,
              label: p.label,
              reelCount: p.reelCount,
              wireDetails: null,
              vendorCode: null,
              footage: null,
            })),
          });
        } catch {}
      }
      return pinsToCommit;
    },
    onSuccess: (pinsToCommit) => {
      if (pinsToCommit.length === 0) {
        toast({ title: "No pins have category details entered yet" });
        return;
      }
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
      const totalCreated = pinsToCommit.reduce((sum, pin) => sum + pin.reelCount, 0);
      const committedIds = new Set(pinsToCommit.map(p => p.id));
      setCommittedPins(prev => [
        ...prev,
        ...pinsToCommit.map(p => ({
          id: `committed-${p.id}-${Date.now()}`,
          dbId: (p as any)._dbPinId as number | undefined,
          x: p.x,
          y: p.y,
          label: p.label,
          reelCount: p.reelCount,
        })),
      ]);
      setLocalPins(prev => prev.filter(p => !committedIds.has(p.id)));
      setSelectedPinId(prev => prev && committedIds.has(prev) ? null : prev);
      setBatchProgress(null);
      toast({ title: `Created ${totalCreated} entries from ${pinsToCommit.length} pins` });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
      toast({ title: error.message, variant: "destructive" });
      batchProgressTimer.current = setTimeout(() => setBatchProgress(null), 3000);
    },
  });


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
  };

  const currentPhotoIncompleteCount = currentPhoto?.dbId ? (incompletePinsMap.get(currentPhoto.dbId) || 0) : 0;

  return (
    <div className="space-y-4 rounded-md border-2 border-[hsl(18_60%_30%/0.35)] bg-[hsl(30_10%_96%)] dark:bg-[hsl(25_8%_13%)] p-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileUpload}
      />
      <h2 className="sm:hidden text-lg font-semibold underline text-center mb-2">Full Mode</h2>
      <div className="space-y-2 sm:space-y-0">
        <div className="flex items-end gap-2 flex-wrap justify-center sm:justify-start">
          <div>
            <label className="block text-xs font-bold text-[hsl(18_80%_40%)] dark:text-[hsl(18_80%_60%)] mb-1">Aisle:</label>
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
                    } catch {}
                  }, 800);
                }
              }}
              placeholder="Aisle..."
              className={`w-24 border-2 focus-visible:ring-[hsl(18_85%_48%)] bg-white dark:bg-[hsl(25_10%_10%)] placeholder:text-[hsl(18_85%_32%)] placeholder:font-semibold ${aisle.trim() ? "input-filled" : "input-pulse-empty"}`}
              enterKeyHint="next"
              data-testid="input-photo-aisle"
            />
          </div>
          <div className="sm:hidden">
            <label className="block text-xs font-bold text-[hsl(18_80%_40%)] dark:text-[hsl(18_80%_60%)] mb-1">Section:</label>
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
                    } catch {}
                  }, 800);
                }
              }}
              placeholder="Sec..."
              className={`w-14 border-2 focus-visible:ring-[hsl(18_85%_48%)] bg-white dark:bg-[hsl(25_10%_10%)] placeholder:text-[hsl(18_85%_32%)] placeholder:font-semibold ${(currentPhoto?.section || "").trim() ? "input-filled" : "input-pulse-empty"}`}
              enterKeyHint="done"
              data-testid="input-photo-section-top"
            />
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <Button
              className="bg-[hsl(18_85%_32%)] text-white border-[hsl(18_85%_26%)]"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !canEdit}
              data-testid="button-upload-photos"
              title="Upload Photos"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1" />}
              Upload Photos
            </Button>
            <Button
              className="bg-[hsl(18_85%_32%)] text-white border-[hsl(18_85%_26%)]"
              onClick={() => cameraInputRef.current?.click()}
              disabled={isUploading || !canEdit}
              data-testid="button-take-photo"
              title="Take Photo"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4 mr-1" />}
              Take Photo
            </Button>
          </div>
        </div>
        <div className="flex sm:hidden items-center justify-center gap-4">
          <Button
            className="bg-[hsl(18_85%_32%)] text-white border-[hsl(18_85%_26%)]"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || !canEdit}
            data-testid="button-upload-photos-mobile"
            title="Upload Photos"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </Button>
          <Button
            className="bg-[hsl(18_85%_32%)] text-white border-[hsl(18_85%_26%)]"
            onClick={() => cameraInputRef.current?.click()}
            disabled={isUploading || !canEdit}
            data-testid="button-take-photo-mobile"
            title="Take Photo"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {uploadedPhotos.length > 0 && (
        <>
          <div className="bg-[hsl(25_15%_14%)] dark:bg-[hsl(25_8%_10%)] rounded-md px-3 py-2 space-y-1">
            <div className="flex items-center w-full">
              <div className="flex-1" />
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                  disabled={uploadedPhotos.length <= 1}
                  onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i - 1 + uploadedPhotos.length) % uploadedPhotos.length); resetView(); }}
                  data-testid="button-prev-photo"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="flex items-center gap-1 text-sm mono text-[hsl(30_40%_85%)]" data-testid="text-photo-counter">
                  {currentPhotoIncompleteCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[hsl(30_90%_45%)] text-white text-[10px] font-bold px-1" data-testid="badge-current-incomplete-top">
                      {currentPhotoIncompleteCount}
                    </span>
                  )}
                  <input
                    type="text"
                    inputMode="numeric"
                    className="w-8 text-center bg-transparent border border-[hsl(18_60%_30%/0.4)] rounded px-1 py-0.5 text-sm mono text-[hsl(30_40%_85%)] focus:outline-none focus:border-[hsl(18_85%_40%)]"
                    value={String(currentPhotoIdx + 1).padStart(2, "0")}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
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
                    onFocus={(e) => e.target.select()}
                    data-testid="input-photo-number-top"
                  />
                  <span>/ {String(uploadedPhotos.length).padStart(2, "0")}</span>
                </div>
                <Button
                  size="icon"
                  className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                  disabled={uploadedPhotos.length <= 1}
                  onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i + 1) % uploadedPhotos.length); resetView(); }}
                  data-testid="button-next-photo"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
              <div className="flex-1 sm:hidden" />
              <div className="hidden sm:flex flex-1 justify-end gap-2">
                <div>
                  <label className="block text-xs font-bold text-white dark:text-white mb-1">Section:</label>
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
                          } catch {}
                        }, 800);
                      }
                    }}
                    placeholder="Section..."
                    className={`w-24 border-2 focus-visible:ring-[hsl(18_85%_48%)] bg-white dark:bg-[hsl(25_10%_10%)] placeholder:text-[hsl(18_85%_32%)] placeholder:font-semibold ${(currentPhoto?.section || "").trim() ? "input-filled" : "input-pulse-empty"}`}
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
                {currentPhoto.isDetailShot && (
                  <span className="inline-flex items-center gap-1 text-[hsl(200_70%_55%)]" title="Detail Shot">
                    <Focus className="h-3 w-3" />
                  </span>
                )}
                {currentPhoto.notes && (
                  <span className="inline-flex items-center gap-1 text-[hsl(18_70%_55%)]" title={currentPhoto.notes}>
                    <StickyNote className="h-3 w-3" />
                  </span>
                )}
              </div>
            )}
          </div>

          {viewingNearbyIdx !== null && viewingNearbyIdx !== currentPhotoIdx && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[hsl(18_85%_40%/0.15)] border border-[hsl(18_85%_40%/0.3)] rounded-md text-xs text-[hsl(30_40%_85%)]" data-testid="nearby-viewing-banner">
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
            <div
              ref={containerRef}
              className="photo-viewer-container w-full"
              style={{ cursor: panMode ? "grab" : "crosshair" }}
              onMouseDown={handleMouseDown}
              onClick={handleContainerClick}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              data-testid="photo-viewer"
            >
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
              <img
                ref={photoImgRef}
                src={displayedPhoto?.url || currentPhoto.url}
                alt="Section photo"
                draggable={false}
                className="w-full select-none"
                style={{ display: "block" }}
                onLoad={() => {}}
              />
              {viewingNearbyIdx === null || viewingNearbyIdx === currentPhotoIdx ? (
                <>
                  {localPins.map((pin) => (
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
                      onClick={(e) => { e.stopPropagation(); setSelectedPinId(pin.id); }}
                      data-testid={`pin-${pin.id}`}
                    >
                      <div className="pin-top-row">
                        <button
                          className="pin-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLocalPins((prev) => prev.filter((p) => p.id !== pin.id));
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
                          {pin.label}
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
                  {committedPins.map((pin) => (
                    <div
                      key={pin.id}
                      className="pin-marker committed"
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
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
                        <div className="pin-label">P{pin.label}</div>
                        {pin.reelCount >= 2 && (
                          <div className="pin-reel-badge" data-testid={`badge-reel-count-${pin.id}`}>
                            X{pin.reelCount}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {nearbyCommittedPins.map((pin) => (
                    <div
                      key={pin.id}
                      className="pin-marker committed"
                      style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                      data-testid={`pin-nearby-committed-${pin.id}`}
                    >
                      <div className="pin-committed-topbar">
                        <div className="pin-label">P{pin.label}</div>
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
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); setScale((s) => Math.min(5, s + 0.5)); }}
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
                  onClick={(e) => { e.stopPropagation(); setRotation((r) => (r + 90) % 360); }}
                  title="Rotate clockwise"
                  data-testid="button-rotate-cw"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); setRotation((r) => (r - 90 + 360) % 360); }}
                  title="Rotate counter-clockwise"
                  data-testid="button-rotate-ccw"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <div className="photo-overlay-divider" />
                <button
                  className="photo-overlay-btn"
                  onClick={(e) => { e.stopPropagation(); savePinScale(Math.min(5, +(pinScale + 0.25).toFixed(2))); }}
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
          )}

          {currentPhoto && (
            <div className="bg-[hsl(25_15%_14%)] dark:bg-[hsl(25_8%_10%)] rounded-md px-3 py-2 flex flex-col items-center gap-1" data-testid="bottom-photo-nav">
              {currentPhoto.filename && (
                <span className="hidden sm:inline text-xs mono text-[hsl(25_40%_60%)] truncate max-w-[260px]" title={currentPhoto.filename} data-testid="text-photo-name-bottom">
                  {currentPhoto.filename}
                </span>
              )}
              <div className="flex items-center w-full">
                <div className="flex-1" />
                <div className="flex items-center gap-3">
                  <Button
                    size="icon"
                    className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                    disabled={uploadedPhotos.length <= 1}
                    onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i - 1 + uploadedPhotos.length) % uploadedPhotos.length); resetView(); }}
                    data-testid="button-prev-photo-bottom"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <div className="flex items-center gap-1 text-sm mono text-[hsl(30_40%_85%)]" data-testid="text-photo-counter-bottom">
                    {currentPhotoIncompleteCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[hsl(30_90%_45%)] text-white text-[10px] font-bold px-1" data-testid="badge-current-incomplete-bottom">
                        {currentPhotoIncompleteCount}
                      </span>
                    )}
                    <input
                      type="text"
                      inputMode="numeric"
                      className="w-8 text-center bg-transparent border border-[hsl(18_60%_30%/0.4)] rounded px-1 py-0.5 text-sm mono text-[hsl(30_40%_85%)] focus:outline-none focus:border-[hsl(18_85%_40%)]"
                      value={String(currentPhotoIdx + 1).padStart(2, "0")}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
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
                      onFocus={(e) => e.target.select()}
                      data-testid="input-photo-number"
                    />
                    <span>/ {String(uploadedPhotos.length).padStart(2, "0")}</span>
                  </div>
                  <Button
                    size="icon"
                    className="bg-[hsl(18_85%_40%)] text-white border border-[hsl(18_85%_30%)] disabled:opacity-40"
                    disabled={uploadedPhotos.length <= 1}
                    onClick={async () => { if (uploadedPhotos.length <= 1) return; await flushSavePins(); skipAutoSave.current = true; setLocalPins([]); setViewingNearbyIdx(null); setCurrentPhotoIdx((i) => (i + 1) % uploadedPhotos.length); resetView(); }}
                    data-testid="button-next-photo-bottom"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </div>
                <div className="flex-1 flex justify-end">
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
                      <AlertDialogDescription>This photo and all its pins will be permanently removed.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          const photoDbId = currentPhoto?.dbId;
                          if (!photoDbId) return;
                          try {
                            await apiRequest("DELETE", `/api/photos/${photoDbId}`);
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
                            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
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
            <div className="space-y-3 bg-[hsl(25_12%_16%)] dark:bg-[hsl(25_8%_11%)] rounded-md p-3 border border-[hsl(18_60%_30%/0.2)]">
              <div className="flex items-center gap-2 flex-wrap">
                <StickyNote className="h-4 w-4 text-[hsl(18_70%_50%)]" />
                <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(25_60%_70%)]">Photo Notes:</span>
                {isDetailShot && (
                  <Badge className="bg-[hsl(200_70%_30%)] text-white text-[10px] px-1.5 py-0 no-default-hover-elevate no-default-active-elevate" data-testid="badge-detail-shot">
                    <Focus className="h-3 w-3 mr-1" />
                    Detail Shot
                  </Badge>
                )}
              </div>
              <Textarea
                value={photoNotes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder=""
                className="resize-none border-[hsl(18_40%_50%/0.4)] bg-white dark:bg-[hsl(25_10%_10%)] text-sm min-h-[60px]"
                rows={2}
                data-testid="textarea-photo-notes"
              />
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer" data-testid="toggle-detail-shot">
                  <Checkbox
                    checked={isDetailShot}
                    onCheckedChange={(checked) => handleDetailShotToggle(!!checked)}
                  />
                  <span className="text-xs text-[hsl(25_50%_65%)]">This is a detail/close-up shot</span>
                </label>
                {isDetailShot && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-[hsl(25_50%_65%)] whitespace-nowrap">Linked to:</label>
                    <select
                      value={parentPhotoId ?? ""}
                      onChange={(e) => handleParentPhotoChange(e.target.value)}
                      className="rounded-md border border-[hsl(18_40%_50%/0.4)] bg-white dark:bg-[hsl(25_10%_10%)] px-2 py-1 text-xs min-w-[120px] focus:outline-none focus:ring-2 focus:ring-[hsl(18_85%_48%)]"
                      data-testid="select-parent-photo"
                    >
                      <option value="">-- Select parent photo --</option>
                      {parentPhotoOptions.map((p) => (
                        <option key={p.dbId} value={p.dbId}>
                          {p.filename || `Photo ${uploadedPhotos.indexOf(p) + 1}`} {p.section ? `(${p.section})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {uploadedPhotos.length > 1 && (() => {
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
                <div className="flex gap-2 overflow-x-auto pb-1">
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

          {localPins.length > 0 && (
            <div className="space-y-3">
              {selectedPinId && currentPhoto && (() => {
                const selectedPin = localPins.find(p => p.id === selectedPinId);
                if (!selectedPin) return null;
                return (
                  <div className="sticky top-[53px] z-[999] bg-background py-1">
                    <ReelCropPreview
                      photoUrl={currentPhoto.url}
                      pinX={selectedPin.x}
                      pinY={selectedPin.y}
                      label={selectedPin.label}
                      zoomLevel={zoomLevel}
                      onZoomChange={setZoomLevel}
                      onClose={() => setSelectedPinId(null)}
                    />
                  </div>
                );
              })()}
              <div className="text-sm font-semibold uppercase tracking-wider text-[hsl(18_60%_40%)] dark:text-[hsl(25_70%_60%)]" data-testid="text-pin-table-title">Enter Details for Each Position</div>
              <div className="overflow-x-auto">
                <table className="pin-entry-table" ref={pinTableRef} data-testid="pin-entry-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Reel #:</th>
                      <th style={{ minWidth: 140 }}>Category:</th>
                      <th style={{ width: 80 }}>Vendor Code:</th>
                      <th style={{ width: 80 }}>Footage:</th>
                      <th style={{ width: 60 }}>Reels:</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {localPins.map((pin, index) => (
                      <tr
                        key={pin.id}
                        data-testid={`pin-entry-row-${index}`}
                        className={`${selectedPinId === pin.id ? "ring-1 ring-primary/40" : ""} ${pin.flagged ? "flagged-row" : ""}`}
                      >
                        <td>
                          <span className="pin-position-cell">{pin.label}</span>
                        </td>
                        <td className="relative">
                          <input
                            type="text"
                            className="input-caps"
                            value={pin.wireDetails || ""}
                            onChange={(e) => {
                              const val = e.target.value.toUpperCase();
                              updatePinField(pin.id, "wireDetails", val);
                              const matches = lookupCategory(val);
                              setSuggestions(matches);
                              setSuggestionIndex(-1);
                              setActiveSuggestionPin(matches.length > 0 ? pin.id : null);
                            }}
                            onFocus={() => {
                              setSelectedPinId(pin.id);
                              setSuggestionIndex(-1);
                              if (pin.wireDetails) {
                                const matches = lookupCategory(pin.wireDetails);
                                setSuggestions(matches);
                                setActiveSuggestionPin(matches.length > 0 ? pin.id : null);
                              }
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setActiveSuggestionPin(null);
                                setSuggestionIndex(-1);
                              }, 200);
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
                                } else if (e.key === "Enter" && suggestionIndex >= 0) {
                                  e.preventDefault();
                                  const s = suggestions[suggestionIndex];
                                  updatePinField(pin.id, "wireDetails", s.catalog);
                                  if (s.vendor) updatePinField(pin.id, "vendorCode", s.vendor);
                                  if (s.footage) updatePinField(pin.id, "footage", s.footage);
                                  setActiveSuggestionPin(null);
                                  setSuggestions([]);
                                  setSuggestionIndex(-1);
                                  const nextInput = document.querySelector(`[data-testid="input-wire-details-${index + 1}"]`) as HTMLInputElement | null;
                                  if (nextInput) setTimeout(() => nextInput.focus(), 0);
                                } else if (e.key === "Escape") {
                                  setActiveSuggestionPin(null);
                                  setSuggestions([]);
                                  setSuggestionIndex(-1);
                                }
                              }
                            }}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="characters"
                            placeholder="Type category..."
                            data-testid={`input-wire-details-${index}`}
                          />
                          {activeSuggestionPin === pin.id && suggestions.length > 0 && (
                            <div className={`absolute z-50 left-0 right-0 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-lg ${index === localPins.length - 1 ? "bottom-full mb-1" : "top-full mt-1"}`} data-testid={`suggestions-${index}`}>
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
                                    setActiveSuggestionPin(null);
                                    setSuggestions([]);
                                    setSuggestionIndex(-1);
                                    const nextInput = document.querySelector(`[data-testid="input-wire-details-${index + 1}"]`) as HTMLInputElement | null;
                                    if (nextInput) setTimeout(() => nextInput.focus(), 0);
                                  }}
                                  data-testid={`suggestion-${s.catalog}`}
                                >
                                  <span className="font-mono font-semibold">{s.catalog}</span>
                                  <span className="text-muted-foreground ml-2">{s.description}</span>
                                  {s.footage && <span className="text-muted-foreground ml-1">({s.footage}')</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <select
                            value={pin.vendorCode || ""}
                            onChange={(e) => updatePinField(pin.id, "vendorCode", e.target.value)}
                            onFocus={() => setSelectedPinId(null)}
                            data-testid={`select-vendor-code-${index}`}
                          >
                            <option value="">--</option>
                            <option value="COP">COP</option>
                            <option value="ALU">ALU</option>
                            <option value="COR">COR</option>
                            <option value="ALF">ALF</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            value={pin.footage ?? ""}
                            onChange={(e) => updatePinField(pin.id, "footage", e.target.value ? parseInt(e.target.value) : undefined)}
                            onFocus={() => setSelectedPinId(null)}
                            min={0}
                            inputMode="decimal"
                            autoComplete="off"
                            data-testid={`input-footage-${index}`}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={pin.reelCount}
                            onChange={(e) => updatePinField(pin.id, "reelCount", Math.max(1, parseInt(e.target.value) || 1))}
                            onFocus={() => setSelectedPinId(null)}
                            min={1}
                            inputMode="numeric"
                            autoComplete="off"
                            style={{ width: "100%" }}
                            data-testid={`input-reels-${index}`}
                          />
                        </td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "center" }}>
                          <button
                            type="button"
                            className="copy-down-btn"
                            onClick={() => copyRowDown(index)}
                            title="Copy to next row"
                            data-testid={`button-copy-down-${index}`}
                          >
                            &#8595;
                          </button>
                          <button
                            type="button"
                            className="clear-row-btn"
                            onClick={() => clearRow(pin.id)}
                            title="Clear row"
                            data-testid={`button-clear-row-${index}`}
                          >
                            &#10005;
                          </button>
                          <button
                            type="button"
                            className={`flag-btn ${pin.flagged ? "flagged" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              updatePinField(pin.id, "flagged", !pin.flagged);
                            }}
                            title={pin.flagged ? "Remove re-shoot flag" : "Flag for re-shoot"}
                            data-testid={`button-flag-${index}`}
                          >
                            <Flag className="h-3.5 w-3.5" />
                          </button>
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
                  onClick={() => createEntries.mutate()}
                  disabled={createEntries.isPending || !aisle}
                  data-testid="button-create-entries-from-pins"
                >
                  {createEntries.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Reel(s) from Image
                </Button>
                {totalIncompletePins > 0 && (
                  <Button
                    size="sm"
                    className="bg-[hsl(30_90%_45%)] text-white border border-[hsl(30_90%_35%)]"
                    onClick={navigateToNextIncomplete}
                    data-testid="button-next-incomplete"
                  >
                    <AlertCircle className="h-3.5 w-3.5 mr-1" />
                    <span className="text-xs font-semibold">Next Reel ({totalIncompletePins})</span>
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
                  className="border-[hsl(18_40%_50%/0.5)] text-[hsl(18_60%_40%)] dark:text-[hsl(25_60%_70%)] dark:border-[hsl(18_40%_50%/0.4)]"
                  onClick={() => {
                    setLocalPins((prev) => prev.map((p) => ({
                      ...p,
                      wireDetails: undefined,
                      vendorCode: undefined,
                      footage: undefined,
                      reelCount: 1,
                    })));
                  }}
                  disabled={createEntries.isPending}
                  data-testid="button-clear-pins"
                >
                  Clear All
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={!!relabelPinId} onOpenChange={(open) => { if (!open) { setRelabelPinId(null); setRelabelValue(""); } }}>
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
              if (e.key === "Escape") { setRelabelPinId(null); setRelabelValue(""); }
            }}
            data-testid="input-relabel-pin"
          />
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => { setRelabelPinId(null); setRelabelValue(""); }} data-testid="button-cancel-relabel">
              Cancel
            </Button>
            <Button className="flex-1" onClick={applyRelabel} disabled={!relabelValue.trim()} data-testid="button-save-relabel">
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
