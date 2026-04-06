import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Camera, X, Loader2, AlertTriangle, Check,
  ImagePlus, RotateCw, ChevronLeft, Smartphone, Plus, Minus,
  ListPlus, ChevronUp, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { saveToQueue, removeFromQueue, getQueuedPhotos, type QueuedPhoto } from "@/lib/offlineQueue";
import SingleEntryMode from "./SingleEntryMode";
import type { Photo } from "@shared/schema";

type UploadQueueItem = {
  queueId: string;
  file: File;
  blobUrl: string;
  aisle: string;
  section: string;
  notes: string;
  isOnFloor: boolean;
  status: "pending" | "uploading" | "failed";
  retries: number;
};

function MobileCaptureView({ sessionId, photos, initialAisle, initialSection, detailParentPhotoId, onDetailCaptured, onBackToFlagged, onClearUndoHistory }: { sessionId: number; photos: Photo[]; initialAisle?: string; initialSection?: string; detailParentPhotoId?: number | null; onDetailCaptured?: () => void; onBackToFlagged?: () => void; onClearUndoHistory?: () => void }) {
  const { toast } = useToast();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const { data: captureSettings } = useQuery<{
    defaultAislePrefix: string | null;
    sectionAdvanceStep: number;
    largerTouchTargets: boolean;
    photoQuality: number;
    useReceivingQuality: boolean;
    receivingPhotoQuality: number;
    useOnFloorQuality: boolean;
    onFloorPhotoQuality: number;
  }>({
    queryKey: ["/api/settings"],
    select: (data: any) => ({
      defaultAislePrefix: data?.defaultAislePrefix ?? null,
      sectionAdvanceStep: data?.sectionAdvanceStep ?? 1,
      largerTouchTargets: data?.largerTouchTargets ?? false,
      photoQuality: data?.photoQuality ?? 85,
      useReceivingQuality: data?.useReceivingQuality ?? true,
      receivingPhotoQuality: data?.receivingPhotoQuality ?? 40,
      useOnFloorQuality: data?.useOnFloorQuality ?? true,
      onFloorPhotoQuality: data?.onFloorPhotoQuality ?? 40,
    }),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const aisleInputRef = useRef<HTMLInputElement>(null);
  const sectionInputRef = useRef<HTMLInputElement>(null);
  const [aisle, setAisle] = useState(initialAisle || "");
  const [section, setSection] = useState(initialSection || "");
  const [prefixApplied, setPrefixApplied] = useState(false);
  const [activeDetailParentId, setActiveDetailParentId] = useState<number | null>(detailParentPhotoId ?? null);
  const activeDetailRef = useRef(activeDetailParentId);
  activeDetailRef.current = activeDetailParentId;
  const [detailNotes, setDetailNotes] = useState("");
  const [detailReviewPhoto, setDetailReviewPhoto] = useState<{ id: number; objectPath: string; blobUrl?: string } | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [recentPhotos, setRecentPhotos] = useState<Array<{ id: number; objectPath: string; notes: string; aisle: string; section: string; isDetailShot: boolean }>>([]);
  const [captureNotes, setCaptureNotes] = useState("");
  const [onFloorChecked, setOnFloorChecked] = useState(false);
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const blobUrlsRef = useRef<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const isReceiving = aisle.trim().toLowerCase() === "receiving";

  useEffect(() => {
    const savedSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "16px";
    return () => { document.documentElement.style.fontSize = savedSize; };
  }, []);

  useEffect(() => {
    if (!prefixApplied && captureSettings?.defaultAislePrefix && !initialAisle && !aisle) {
      setAisle(captureSettings.defaultAislePrefix);
      setPrefixApplied(true);
    }
  }, [captureSettings, prefixApplied, initialAisle, aisle]);

  const prevOnFloorTextRef = useRef("");
  useEffect(() => {
    if (!onFloorChecked || !prevOnFloorTextRef.current) return;
    const newText = aisle.trim() || section.trim()
      ? `This reel is on the floor in front of aisle ${aisle.trim() || "##"}, section ${section.trim() || "##"}.`
      : "This reel is on the floor in front of the recorded aisle and section.";
    if (newText === prevOnFloorTextRef.current) return;
    setCaptureNotes(prev => {
      const old = prevOnFloorTextRef.current;
      if (old && prev.includes(old)) {
        return prev.replace(old, newText);
      }
      return prev;
    });
    prevOnFloorTextRef.current = newText;
  }, [aisle, section, onFloorChecked]);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getQueuedPhotos(sessionId).then(items => {
      if (cancelled || items.length === 0) return;
      const restored: UploadQueueItem[] = items.map(item => ({
        queueId: item.id,
        file: new File([item.blob], `restored-${item.id}.jpg`, { type: "image/jpeg" }),
        blobUrl: URL.createObjectURL(item.blob),
        aisle: item.aisle,
        section: item.section,
        notes: (item as any).notes || "",
        isOnFloor: item.isOnFloor ?? false,
        status: "pending" as const,
        retries: 0,
      }));
      for (const r of restored) blobUrlsRef.current.add(r.blobUrl);
      setUploadQueue(prev => {
        const existingIds = new Set(prev.map(q => q.queueId));
        return [...prev, ...restored.filter(r => !existingIds.has(r.queueId))];
      });
    });
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (photos.length > 0) {
      const mapped = photos.map(p => ({
        id: p.id,
        objectPath: p.objectStorageKey,
        notes: p.notes || "",
        aisle: p.aisle || "",
        section: p.section || "",
        isDetailShot: p.isDetailShot || false,
      }));
      setRecentPhotos(mapped);
    }
  }, [photos]);

  useEffect(() => {
    if (processingRef.current || !isOnline) return;
    const nextItem = uploadQueue.find(q => q.status === "pending");
    if (!nextItem) return;
    processingRef.current = true;
    setUploadQueue(prev => prev.map(q => q.queueId === nextItem.queueId ? { ...q, status: "uploading" as const } : q));

    (async () => {
      try {
        const isReceiving = nextItem.aisle.toLowerCase() === "receiving";
        const isOnFloorItem = nextItem.isOnFloor;
        const baseQuality = isReceiving && captureSettings?.useReceivingQuality
          ? (captureSettings.receivingPhotoQuality ?? 40)
          : isOnFloorItem && captureSettings?.useOnFloorQuality
          ? (captureSettings.onFloorPhotoQuality ?? 40)
          : (captureSettings?.photoQuality ?? 85);
        const quality = baseQuality / 100;
        let fileToUpload: File | Blob = nextItem.file;
        if (quality < 1 && nextItem.file.type.startsWith("image/")) {
          try {
            if (typeof OffscreenCanvas !== "undefined") {
              const bmp = await createImageBitmap(nextItem.file);
              const canvas = new OffscreenCanvas(bmp.width, bmp.height);
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(bmp, 0, 0);
                const compressed = await canvas.convertToBlob({ type: "image/jpeg", quality });
                fileToUpload = new File([compressed], nextItem.file.name, { type: "image/jpeg" });
              }
              bmp.close();
            } else {
              const img = new Image();
              const loadedUrl = URL.createObjectURL(nextItem.file);
              await new Promise<void>((resolve) => { img.onload = () => resolve(); img.src = loadedUrl; });
              const canvas = document.createElement("canvas");
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
                if (compressed) fileToUpload = new File([compressed], nextItem.file.name, { type: "image/jpeg" });
              }
              URL.revokeObjectURL(loadedUrl);
            }
          } catch {
            fileToUpload = nextItem.file;
          }
        }
        const formData = new FormData();
        formData.append("file", fileToUpload);
        const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: formData, credentials: "include" });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const uploadResult = await uploadRes.json();

        const photoPayload: Record<string, any> = {
          objectStorageKey: uploadResult.objectPath,
          originalFilename: nextItem.file.name,
          mimeType: nextItem.file.type,
          fileSize: uploadResult.metadata?.size || nextItem.file.size,
          aisle: nextItem.aisle,
          section: nextItem.section,
          notes: nextItem.notes || undefined,
        };
        const detailParent = activeDetailRef.current;
        const isDetail = detailParent != null;
        if (isDetail) {
          photoPayload.isDetailShot = true;
          photoPayload.parentPhotoId = detailParent;
        }
        const res = await apiRequest("POST", `/api/sessions/${sessionId}/photos`, photoPayload);
        const savedPhoto = await res.json();

        if (isDetail) {
          if (!mountedRef.current) { processingRef.current = false; return; }
          try {
            setDetailReviewPhoto({ id: savedPhoto.id, objectPath: uploadResult.objectPath, blobUrl: nextItem.blobUrl });
            setUploadQueue(prev => prev.filter(q => q.queueId !== nextItem.queueId));
            removeFromQueue(nextItem.queueId).catch(() => {});
            queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
          } finally {
            processingRef.current = false;
          }
          return;
        }

        if (!mountedRef.current) return;
        setRecentPhotos(prev => [...prev, {
          id: savedPhoto.id,
          objectPath: uploadResult.objectPath,
          notes: nextItem.notes,
          aisle: nextItem.aisle,
          section: nextItem.section,
          isDetailShot: false,
        }]);
        URL.revokeObjectURL(nextItem.blobUrl);
        blobUrlsRef.current.delete(nextItem.blobUrl);
        setUploadQueue(prev => prev.filter(q => q.queueId !== nextItem.queueId));
        removeFromQueue(nextItem.queueId).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      } catch {
        if (!mountedRef.current) return;
        setUploadQueue(prev => prev.map(q => q.queueId === nextItem.queueId ? { ...q, status: "failed" as const, retries: q.retries + 1 } : q));
        toast({ title: "Photo upload failed — tap to retry", variant: "destructive" });
      } finally {
        processingRef.current = false;
      }
    })();
  }, [uploadQueue, sessionId, toast, isOnline]);

  const retryUpload = useCallback((queueId: string) => {
    setUploadQueue(prev => prev.map(q => q.queueId === queueId ? { ...q, status: "pending" as const } : q));
  }, []);

  const dismissFailedUpload = useCallback((queueId: string) => {
    setUploadQueue(prev => {
      const item = prev.find(q => q.queueId === queueId);
      if (item) {
        URL.revokeObjectURL(item.blobUrl);
        blobUrlsRef.current.delete(item.blobUrl);
      }
      return prev.filter(q => q.queueId !== queueId);
    });
    removeFromQueue(queueId).catch(() => {});
  }, []);

  const getNextReceivingSection = useCallback(() => {
    const allReceivingPhotos = [
      ...photos.filter(p => (p.aisle || "").toLowerCase() === "receiving"),
      ...recentPhotos.filter(p => p.aisle.toLowerCase() === "receiving" && !photos.some(pp => pp.id === p.id)),
    ];
    const pendingReceivingSections = uploadQueue
      .filter(q => q.aisle.toLowerCase() === "receiving" && q.status !== "failed")
      .map(q => parseInt(q.section, 10))
      .filter(n => !isNaN(n));
    const existingSections = allReceivingPhotos
      .map(p => parseInt(p.section || "0", 10))
      .filter(n => !isNaN(n));
    const allSections = [...existingSections, ...pendingReceivingSections];
    const maxSection = allSections.length > 0 ? Math.max(...allSections) : 0;
    const step = captureSettings?.sectionAdvanceStep ?? 1;
    return String(maxSection + step).padStart(3, "0");
  }, [photos, recentPhotos, uploadQueue, captureSettings?.sectionAdvanceStep]);

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newItems: UploadQueueItem[] = [];
    let nextReceivingNum = isReceiving ? parseInt(getNextReceivingSection(), 10) : 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const blobUrl = URL.createObjectURL(file);
      blobUrlsRef.current.add(blobUrl);
      let sectionValue = section;
      if (isReceiving && !section.trim()) {
        sectionValue = String(nextReceivingNum).padStart(3, "0");
        nextReceivingNum++;
      }
      newItems.push({
        queueId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        blobUrl,
        aisle,
        section: sectionValue,
        notes: captureNotes,
        isOnFloor: onFloorChecked,
        status: "pending",
        retries: 0,
      });
    }
    setUploadQueue(prev => [...prev, ...newItems]);
    for (const item of newItems) {
      saveToQueue({
        id: item.queueId,
        sessionId,
        blob: item.file,
        aisle: item.aisle,
        section: item.section,
        notes: item.notes,
        isReceiving: item.aisle.toLowerCase() === "receiving",
        isOnFloor: item.isOnFloor,
        createdAt: Date.now(),
      }).catch(() => {});
    }
    toast({ title: `${newItems.length} photo${newItems.length > 1 ? "s" : ""} queued` });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
    };
  }, []);

  const isUploading = uploadQueue.some(q => q.status === "uploading");
  const pendingCount = uploadQueue.filter(q => q.status === "pending" || q.status === "uploading").length;
  const failedCount = uploadQueue.filter(q => q.status === "failed").length;

  const handleOnFloorToggle = useCallback((checked: boolean) => {
    setOnFloorChecked(checked);
    if (checked) {
      const text = aisle.trim() || section.trim()
        ? `This reel is on the floor in front of aisle ${aisle.trim() || "##"}, section ${section.trim() || "##"}.`
        : "This reel is on the floor in front of the recorded aisle and section.";
      setCaptureNotes(prev => prev ? `${prev}\n${text}` : text);
      prevOnFloorTextRef.current = text;
    } else {
      const old = prevOnFloorTextRef.current;
      if (old) {
        setCaptureNotes(prev => prev.replace(`\n${old}`, "").replace(old, "").trim());
      }
      prevOnFloorTextRef.current = "";
    }
  }, [aisle, section]);

  return (
    <div className="space-y-4 bg-red-600/80 dark:bg-red-800/80 rounded-xl -mx-1 px-1 pt-2 pb-2">
      <div className="flex items-center justify-center gap-2 px-1" data-testid="header-mobile-flow">
        <Smartphone className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold underline">Mobile Flow</h2>
      </div>
      {!isOnline && (
        <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm flex items-center gap-2" data-testid="text-offline-banner">
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
          <span>You're offline. Photos will be saved and uploaded when you reconnect.</span>
        </div>
      )}
      {activeDetailParentId != null && detailReviewPhoto && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="rounded-md border border-green-500/50 bg-green-500/10 px-3 py-2 text-sm flex items-center gap-2" data-testid="text-detail-review-banner">
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              <span>Flagged shot captured — review your photo and add notes before saving.</span>
            </div>
            <div className="rounded-lg overflow-hidden border border-border">
              <img
                src={detailReviewPhoto.blobUrl || (detailReviewPhoto.objectPath.startsWith("/uploads/") ? detailReviewPhoto.objectPath : `/uploads/${detailReviewPhoto.objectPath}`)}
                alt="Detail shot preview"
                className="w-full max-h-64 object-contain bg-black/20"
                data-testid="img-detail-review"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes:</Label>
              <Textarea
                value={detailNotes}
                onChange={(e) => setDetailNotes(e.target.value)}

                rows={3}
                className="text-sm"
                data-testid="input-detail-review-notes"
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                size="lg"
                disabled={detailSaving}
                onClick={async () => {
                  setDetailSaving(true);
                  try {
                    if (detailNotes.trim()) {
                      await apiRequest("PATCH", `/api/photos/${detailReviewPhoto.id}`, { notes: detailNotes.trim() });
                    }
                    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
                    toast({ title: "Detail shot saved" });
                    if (detailReviewPhoto.blobUrl) {
                      URL.revokeObjectURL(detailReviewPhoto.blobUrl);
                      blobUrlsRef.current.delete(detailReviewPhoto.blobUrl);
                    }
                    setDetailReviewPhoto(null);
                    setDetailNotes("");
                    setActiveDetailParentId(null);
                    onDetailCaptured?.();
                    onBackToFlagged?.();
                  } catch {
                    toast({ title: "Failed to save notes", variant: "destructive" });
                  } finally {
                    setDetailSaving(false);
                  }
                }}
                data-testid="button-detail-save-done"
              >
                {detailSaving ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <Check className="h-5 w-5 mr-2" />}
                Save & Done
              </Button>
              <Button
                variant="outline"
                size="lg"
                disabled={detailSaving}
                onClick={async () => {
                  try {
                    await apiRequest("DELETE", `/api/photos/${detailReviewPhoto.id}`);
                    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "entries"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "pins"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "incomplete-pins"] });
                    onClearUndoHistory?.();
                  } catch {}
                  if (detailReviewPhoto.blobUrl) {
                    URL.revokeObjectURL(detailReviewPhoto.blobUrl);
                    blobUrlsRef.current.delete(detailReviewPhoto.blobUrl);
                  }
                  setDetailReviewPhoto(null);
                  setDetailNotes("");
                }}
                data-testid="button-detail-retake"
              >
                <RotateCw className="h-5 w-5 mr-2" />
                Retake
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {activeDetailParentId != null && !detailReviewPhoto && (
        <div className="rounded-md border border-[hsl(200_70%_50%/0.5)] bg-[hsl(200_70%_50%/0.1)] px-3 py-2 text-sm space-y-2" data-testid="text-detail-shot-banner">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[hsl(200_70%_50%)] shrink-0" />
            <span className="flex-1">Flagged shot mode — take a close-up photo of the flagged reel.</span>
          </div>
          {onBackToFlagged && (
            <Button
              size="sm"
              variant="outline"
              className="w-full border-[hsl(200_70%_50%/0.5)] text-[hsl(200_70%_50%)] hover:bg-[hsl(200_70%_50%/0.15)]"
              onClick={onBackToFlagged}
              data-testid="button-back-to-flagged"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to Flagged Reels
            </Button>
          )}
        </div>
      )}
      {!detailReviewPhoto && (
      <Card className="!border-[hsl(215_40%_35%)]">
        <CardContent className="p-4 space-y-3">
          {!aisle.trim() && (
            <div className="px-3 py-2 text-sm text-muted-foreground text-center" data-testid="text-aisle-required">
              <span className="text-red-500 font-bold">✱</span>{" "}<span className="underline text-red-500">Enter an aisle below to start capturing photos</span>{" "}<span className="text-red-500 font-bold">✱</span>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCapture} data-testid="input-mobile-file" />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapture} data-testid="input-mobile-camera" />

          <form onSubmit={(e) => e.preventDefault()} className={`grid grid-cols-3 gap-2 items-start justify-items-center transition-opacity${showQuickEntry ? " opacity-40 pointer-events-none select-none" : ""}`}>
            <div className="flex flex-col items-center gap-1">
              <Label className={`text-xs underline self-start${!aisle.trim() ? " !text-[hsl(18,85%,40%)]" : ""}`}>Aisle: <span className="text-destructive">*</span></Label>
              <Input
                ref={aisleInputRef}
                value={aisle}
                onChange={(e) => setAisle(e.target.value)}
                className="border-red-500 text-center text-lg w-[148px] h-[4.5rem] !py-0"
                disabled={isReceiving}
                tabIndex={1}
                enterKeyHint="next"
                data-testid="input-mobile-aisle"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sectionInputRef.current?.focus(); } }}
              />
              <div className="flex gap-1 w-[148px]">
                <Button
                  variant="outline"
                  className="rounded-lg !border-orange-500 dark:!border-orange-400 !p-0 !h-[1in] !w-[0.75in]"
                  data-testid="button-aisle-decrement"
                  disabled={isReceiving}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const cur = parseInt(aisle, 10);
                    const val = isNaN(cur) ? 0 : Math.max(0, cur - 1);
                    setAisle(String(val).padStart(Math.max(aisle.length, 1), "0"));
                  }}
                >
                  <Minus className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  className="rounded-lg !border-orange-500 dark:!border-orange-400 !p-0 !h-[1in] !w-[0.75in]"
                  data-testid="button-aisle-increment"
                  disabled={isReceiving}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const cur = parseInt(aisle, 10);
                    const val = isNaN(cur) ? 1 : cur + 1;
                    setAisle(String(val).padStart(Math.max(aisle.length, 1), "0"));
                  }}
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
              <div className="flex flex-col gap-1 pt-1 w-[148px]">
                <label className="flex items-center gap-2 cursor-pointer" data-testid="checkbox-receiving">
                  <Checkbox
                    checked={isReceiving}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setAisle("Receiving");
                        setSection("");
                      } else {
                        setAisle("");
                      }
                    }}
                    className="h-8 w-8 [&_svg]:h-5 [&_svg]:w-5"
                  />
                  <span className="text-sm text-muted-foreground">Receiving</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" data-testid="checkbox-on-floor">
                  <Checkbox
                    checked={onFloorChecked}
                    onCheckedChange={(checked) => handleOnFloorToggle(!!checked)}
                    className="h-8 w-8 [&_svg]:h-5 [&_svg]:w-5"
                  />
                  <span className="text-sm text-muted-foreground">On Floor, In Front Of</span>
                </label>
              </div>
            </div>

            <div className="flex flex-col items-center justify-center gap-2 pt-5">
              <Button
                variant="destructive"
                className={`flex flex-col gap-1.5 !h-[1.5in] !w-[1in] text-sm${captureSettings?.largerTouchTargets ? " text-base" : ""}`}
                onClick={() => cameraInputRef.current?.click()}
                disabled={!aisle.trim()}
                data-testid="button-mobile-camera"
              >
                <Camera className="h-7 w-7" />
                <span>Take<br/>Photo</span>
              </Button>
              <div className="flex gap-1">
                <Button
                  variant="destructive"
                  className="!h-[0.5in] !w-[0.5in] !p-0"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!aisle.trim()}
                  data-testid="button-mobile-upload"
                >
                  <ImagePlus className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  className="!border-[hsl(215_50%_45%/0.5)] text-[hsl(215_50%_45%)] dark:text-[hsl(215_60%_60%)] dark:!border-[hsl(215_50%_45%/0.4)] !h-[0.5in] !w-[0.5in] !p-0"
                  onClick={() => setShowQuickEntry(prev => !prev)}
                  data-testid="button-mobile-quick-entry-toggle"
                >
                  <ListPlus className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col items-center gap-1">
              <Label className={`text-xs underline self-start${!isReceiving && !section.trim() ? " !text-[hsl(18,85%,40%)]" : ""}`}>Section:</Label>
              <Input
                ref={sectionInputRef}
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className={`text-center text-lg w-[148px] h-[4.5rem] !py-0${isReceiving ? "" : " border-red-500"}`}
                tabIndex={2}
                enterKeyHint="done"
                data-testid="input-mobile-section"
                onKeyDown={(e) => { if (e.key === "Enter") { sectionInputRef.current?.blur(); } }}
              />
              <div className="flex gap-1 w-[148px]">
                <Button
                  variant="outline"
                  className="rounded-lg !border-orange-500 dark:!border-orange-400 !p-0 !h-[1in] !w-[0.75in]"
                  data-testid="button-section-decrement"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const cur = parseInt(section, 10);
                    const val = isNaN(cur) ? 0 : Math.max(0, cur - 1);
                    setSection(String(val).padStart(Math.max(section.length, 1), "0"));
                  }}
                >
                  <Minus className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  className="rounded-lg !border-orange-500 dark:!border-orange-400 !p-0 !h-[1in] !w-[0.75in]"
                  data-testid="button-section-increment"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const cur = parseInt(section, 10);
                    const val = isNaN(cur) ? 1 : cur + 1;
                    setSection(String(val).padStart(Math.max(section.length, 1), "0"));
                  }}
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </form>
          {showQuickEntry && (
            <div className="p-3 rounded-md border border-red-500 bg-[hsl(25_10%_95%)] dark:bg-[hsl(25_10%_12%)]" data-testid="mobile-quick-entry-panel">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-[hsl(200_60%_35%)] dark:text-[hsl(200_60%_70%)] flex items-center gap-1.5">
                  <ListPlus className="h-4 w-4" />
                  Quick Entry (1 Reel)
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground border border-black dark:border-white"
                  onClick={() => setShowQuickEntry(false)}
                  data-testid="button-mobile-quick-entry-close"
                >
                  ×
                </Button>
              </div>
              <SingleEntryMode
                sessionId={sessionId}
                editingEntry={null}
                onDoneEditing={() => {}}
                canEdit={true}
                defaultAisle={aisle || ""}
                defaultSection={section || ""}
                getNextReceivingSection={() => {
                  const allSections = photos
                    .filter(p => (p.aisle || "").toLowerCase() === "receiving")
                    .map(p => parseInt(p.section || "0", 10))
                    .filter(n => !isNaN(n));
                  const max = allSections.length > 0 ? Math.max(...allSections) : 0;
                  return String(max + 1);
                }}
              />
            </div>
          )}
          <div className={`space-y-1 transition-opacity${showQuickEntry ? " opacity-40 pointer-events-none select-none" : ""}`}>
            <Label className="text-xs underline">Notes:</Label>
            <Textarea
              value={captureNotes}
              onChange={(e) => setCaptureNotes(e.target.value)}
              rows={2}
              data-testid="input-mobile-capture-notes"
            />
          </div>
          {(pendingCount > 0 || failedCount > 0) && (
            <div className="space-y-2" data-testid="upload-queue-status">
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Uploading {pendingCount} photo{pendingCount > 1 ? "s" : ""} in background...</span>
                </div>
              )}
              {failedCount > 0 && (
                <div className="space-y-1">
                  {uploadQueue.filter(q => q.status === "failed").map(item => (
                    <div key={item.queueId} className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2" data-testid={`upload-failed-${item.queueId}`}>
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                      <span className="text-xs flex-1 truncate">{item.file.name} failed</span>
                      <Button size="sm" variant="outline" onClick={() => retryUpload(item.queueId)} data-testid={`button-retry-${item.queueId}`}>
                        <RotateCw className="h-3 w-3 mr-1" /> Retry
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => dismissFailedUpload(item.queueId)} data-testid={`button-dismiss-${item.queueId}`}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      )}

    </div>
  );
}

export default MobileCaptureView;
