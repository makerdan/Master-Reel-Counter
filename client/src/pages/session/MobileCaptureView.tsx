import { useState, useRef, useCallback, useEffect } from "react";
import {
  Camera, Trash2, X, Loader2, AlertTriangle,
  ImagePlus, RotateCw, ChevronLeft, ChevronRight, ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { saveToQueue, removeFromQueue, getQueuedPhotos, type QueuedPhoto } from "@/lib/offlineQueue";
import type { Photo } from "@shared/schema";

type UploadQueueItem = {
  queueId: string;
  file: File;
  blobUrl: string;
  aisle: string;
  section: string;
  status: "pending" | "uploading" | "failed";
  retries: number;
};

function MobileCaptureView({ sessionId, photos, initialAisle, initialSection, detailParentPhotoId, onDetailCaptured, onBackToFlagged }: { sessionId: number; photos: Photo[]; initialAisle?: string; initialSection?: string; detailParentPhotoId?: number | null; onDetailCaptured?: () => void; onBackToFlagged?: () => void }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const aisleInputRef = useRef<HTMLInputElement>(null);
  const sectionInputRef = useRef<HTMLInputElement>(null);
  const [aisle, setAisle] = useState(initialAisle || "");
  const [section, setSection] = useState(initialSection || "");
  const [activeDetailParentId, setActiveDetailParentId] = useState<number | null>(detailParentPhotoId ?? null);
  const activeDetailRef = useRef(activeDetailParentId);
  activeDetailRef.current = activeDetailParentId;
  const [detailNotes, setDetailNotes] = useState("");
  const [recentPhotos, setRecentPhotos] = useState<Array<{ id: number; objectPath: string; notes: string; aisle: string; section: string; isDetailShot: boolean }>>([]);
  const [savingNotes, setSavingNotes] = useState<Record<number, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [photoSort, setPhotoSort] = useState<"latest" | "aisle">("aisle");
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const notesTimerRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);
  const blobUrlsRef = useRef<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const isReceiving = aisle.trim().toLowerCase() === "receiving";

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
        const formData = new FormData();
        formData.append("file", nextItem.file);
        const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: formData, credentials: "include" });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const uploadResult = await uploadRes.json();

        const photoPayload: Record<string, any> = {
          objectStorageKey: uploadResult.objectPath,
          originalFilename: nextItem.file.name,
          mimeType: nextItem.file.type,
          aisle: nextItem.aisle,
          section: nextItem.section,
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
          if (detailNotes.trim()) {
            try {
              await apiRequest("PATCH", `/api/photos/${savedPhoto.id}`, { notes: detailNotes.trim() });
            } catch {}
          }
          setDetailNotes("");
          setActiveDetailParentId(null);
          onDetailCaptured?.();
        }

        if (!mountedRef.current) return;
        setRecentPhotos(prev => [...prev, {
          id: savedPhoto.id,
          objectPath: uploadResult.objectPath,
          notes: isDetail ? detailNotes.trim() : "",
          aisle: nextItem.aisle,
          section: nextItem.section,
          isDetailShot: isDetail,
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
    return String(maxSection + 1).padStart(3, "0");
  }, [photos, recentPhotos, uploadQueue]);

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
        notes: "",
        isReceiving: item.aisle.toLowerCase() === "receiving",
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

  const toggleDetailShot = useCallback(async (photoId: number, isDetail: boolean) => {
    setRecentPhotos(prev => prev.map(p => p.id === photoId ? { ...p, isDetailShot: isDetail } : p));
    try {
      await apiRequest("PATCH", `/api/photos/${photoId}`, { isDetailShot: isDetail });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
    } catch {
      setRecentPhotos(prev => prev.map(p => p.id === photoId ? { ...p, isDetailShot: !isDetail } : p));
    }
  }, [sessionId]);

  const deletePhoto = useCallback(async (photoId: number) => {
    try {
      await apiRequest("DELETE", `/api/photos/${photoId}`);
      setRecentPhotos(prev => prev.filter(p => p.id !== photoId));
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
      toast({ title: "Photo deleted" });
    } catch {
      toast({ title: "Failed to delete photo", variant: "destructive" });
      setConfirmDeleteId(null);
    }
  }, [sessionId, toast]);

  const updatePhotoNotes = useCallback((photoId: number, notes: string) => {
    setRecentPhotos(prev => prev.map(p => p.id === photoId ? { ...p, notes } : p));
    if (notesTimerRef.current[photoId]) clearTimeout(notesTimerRef.current[photoId]);
    notesTimerRef.current[photoId] = setTimeout(async () => {
      setSavingNotes(prev => ({ ...prev, [photoId]: true }));
      try {
        await apiRequest("PATCH", `/api/photos/${photoId}`, { notes });
      } catch {}
      setSavingNotes(prev => ({ ...prev, [photoId]: false }));
    }, 800);
  }, []);

  return (
    <div className="space-y-4">
      {!isOnline && (
        <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm flex items-center gap-2" data-testid="text-offline-banner">
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
          <span>You're offline. Photos will be saved and uploaded when you reconnect.</span>
        </div>
      )}
      {activeDetailParentId != null && (
        <div className="rounded-md border border-[hsl(200_70%_50%/0.5)] bg-[hsl(200_70%_50%/0.1)] px-3 py-2 text-sm space-y-2" data-testid="text-detail-shot-banner">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[hsl(200_70%_50%)] shrink-0" />
            <span className="flex-1">Detail shot mode — this photo will be linked to the flagged reel's original image.</span>
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
      <Card>
        <CardContent className="p-4 space-y-3">
          {!aisle.trim() && (
            <div className="rounded-md border border-[hsl(18_85%_40%/0.5)] bg-[hsl(18_85%_40%/0.08)] px-3 py-2 text-sm text-muted-foreground" data-testid="text-aisle-required">
              Enter an aisle below to start capturing photos
            </div>
          )}
          <form onSubmit={(e) => e.preventDefault()} className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs underline">Aisle: <span className="text-destructive">*</span></Label>
              <Input
                ref={aisleInputRef}
                value={aisle}
                onChange={(e) => setAisle(e.target.value)}
                placeholder="Aisle"
                className={!aisle.trim() ? "border-[hsl(18_85%_40%/0.5)] ring-1 ring-[hsl(18_85%_40%/0.3)]" : ""}
                disabled={isReceiving}
                tabIndex={1}
                enterKeyHint="next"
                data-testid="input-mobile-aisle"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sectionInputRef.current?.focus(); } }}
              />
              <label className="flex items-center gap-2 cursor-pointer pt-1" data-testid="checkbox-receiving">
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
            </div>
            <div className="space-y-1">
              <Label className="text-xs underline">Section:{!isReceiving && <span className="text-destructive"> *</span>}</Label>
              <Input
                ref={sectionInputRef}
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder={isReceiving ? "Optional" : "Section"}
                tabIndex={2}
                enterKeyHint="done"
                data-testid="input-mobile-section"
                onKeyDown={(e) => { if (e.key === "Enter") { sectionInputRef.current?.blur(); } }}
              />
            </div>
          </form>

          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleCapture} data-testid="input-mobile-file" />
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleCapture} data-testid="input-mobile-camera" />

          <div className="flex gap-2">
            <Button
              className="flex-1"
              size="lg"
              onClick={() => cameraInputRef.current?.click()}
              disabled={!aisle.trim()}
              data-testid="button-mobile-camera"
            >
              <Camera className="h-5 w-5 mr-2" />
              Take Photo
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => fileInputRef.current?.click()}
              disabled={!aisle.trim()}
              data-testid="button-mobile-upload"
            >
              <ImagePlus className="h-5 w-5" />
            </Button>
          </div>
          {activeDetailParentId != null && (
            <div className="space-y-1">
              <Label className="text-xs">Notes:</Label>
              <Textarea
                value={detailNotes}
                onChange={(e) => setDetailNotes(e.target.value)}
                placeholder="Add notes about this detail shot..."
                rows={2}
                className="text-sm"
                data-testid="input-detail-notes"
              />
            </div>
          )}
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

      {activeDetailParentId == null && (recentPhotos.length > 0 || uploadQueue.length > 0) && (() => {
        type DisplayPhoto = { id: number; objectPath: string; notes: string; aisle: string; section: string; isDetailShot: boolean; queueId?: string; queueStatus?: "pending" | "uploading" | "failed"; blobUrl?: string };
        const sorted: DisplayPhoto[] = [...recentPhotos];
        if (photoSort === "latest") {
          sorted.sort((a, b) => b.id - a.id);
        } else {
          sorted.sort((a, b) => {
            const aIsRec = a.aisle.toLowerCase() === "receiving";
            const bIsRec = b.aisle.toLowerCase() === "receiving";
            if (aIsRec && !bIsRec) return 1;
            if (!aIsRec && bIsRec) return -1;
            if (aIsRec && bIsRec) return b.id - a.id;
            const aisleComp = a.aisle.localeCompare(b.aisle, undefined, { numeric: true });
            if (aisleComp !== 0) return aisleComp;
            return (a.section || "").localeCompare(b.section || "", undefined, { numeric: true });
          });
        }
        uploadQueue.forEach(q => {
          sorted.push({
            id: -1,
            objectPath: "",
            notes: "",
            aisle: q.aisle,
            section: q.section,
            isDetailShot: false,
            queueId: q.queueId,
            queueStatus: q.status,
            blobUrl: q.blobUrl,
          });
        });
        if (sorted.length === 0) return null;
        const safeIndex = Math.min(currentPhotoIndex, sorted.length - 1);
        const photo = sorted[safeIndex];
        if (!photo) return null;
        const imgSrc = photo.blobUrl ? photo.blobUrl : (photo.objectPath.startsWith("/uploads/") ? photo.objectPath : `/uploads/${photo.objectPath}`);
        return (
          <Card>
            <CardHeader className="p-3 flex flex-row items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPhotoIndex(i => i - 1)}
                disabled={safeIndex === 0}
                data-testid="button-photo-prev-top"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Prev
              </Button>
              <CardTitle className="text-sm" data-testid="text-mobile-photo-count">{safeIndex + 1} / {sorted.length}</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPhotoIndex(i => i + 1)}
                disabled={safeIndex >= sorted.length - 1}
                data-testid="button-photo-next-top"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-3">
              <div className="space-y-2" data-testid={`mobile-photo-${photo.queueId || photo.id}`}>
                <div className="relative">
                  <img
                    src={imgSrc}
                    alt={photo.queueId ? "Uploading..." : `Photo ${photo.id}`}
                    className={`w-full rounded-md object-cover max-h-64 ${photo.queueStatus ? "opacity-60" : ""}`}
                    data-testid={`img-mobile-photo-${photo.queueId || photo.id}`}
                  />
                  {photo.queueStatus && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center rounded-md bg-background/40">
                      {photo.queueStatus === "uploading" && (
                        <>
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <span className="text-sm font-medium mt-2">Uploading...</span>
                        </>
                      )}
                      {photo.queueStatus === "pending" && (
                        <>
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                          <span className="text-sm text-muted-foreground mt-2">Queued</span>
                        </>
                      )}
                      {photo.queueStatus === "failed" && (
                        <div className="flex flex-col items-center gap-2">
                          <AlertTriangle className="h-8 w-8 text-destructive" />
                          <span className="text-sm font-medium text-destructive">Upload failed</span>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => retryUpload(photo.queueId!)} data-testid={`button-retry-inline-${photo.queueId}`}>
                              <RotateCw className="h-3 w-3 mr-1" /> Retry
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => dismissFailedUpload(photo.queueId!)} data-testid={`button-dismiss-inline-${photo.queueId}`}>
                              <X className="h-3 w-3 mr-1" /> Dismiss
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {!photo.queueStatus && (
                <>
                <div className="flex items-center justify-between gap-2">
                  {(photo.aisle || (photo.section && photo.section !== "000")) ? (
                    <p className="text-xs text-muted-foreground">
                      {photo.aisle && <span>Aisle: {photo.aisle}</span>}
                      {photo.aisle && photo.section && photo.section !== "000" && <span>, </span>}
                      {photo.section && photo.section !== "000" && <span>Section: {photo.section}</span>}
                    </p>
                  ) : <div />}
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer" data-testid={`checkbox-detail-${photo.id}`}>
                      <Checkbox
                        checked={photo.isDetailShot}
                        onCheckedChange={(checked) => toggleDetailShot(photo.id, !!checked)}
                      />
                      <span className="text-xs text-muted-foreground">Detail shot</span>
                    </label>
                    {confirmDeleteId === photo.id ? (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="destructive" onClick={() => { deletePhoto(photo.id); setCurrentPhotoIndex(i => Math.max(0, Math.min(i, sorted.length - 2))); }} data-testid={`button-confirm-delete-${photo.id}`}>
                          Delete
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmDeleteId(null)} data-testid={`button-cancel-delete-${photo.id}`}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDeleteId(photo.id)} data-testid={`button-delete-photo-${photo.id}`}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs underline">Notes:</Label>
                  <Textarea
                    value={photo.notes}
                    onChange={(e) => updatePhotoNotes(photo.id, e.target.value)}
                    placeholder="Photo notes..."
                    rows={2}
                    data-testid={`input-mobile-notes-${photo.id}`}
                  />
                  {savingNotes[photo.id] && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> Saving...
                    </p>
                  )}
                </div>
                </>
                )}
                {photo.queueStatus && (photo.aisle || (photo.section && photo.section !== "000")) && (
                  <p className="text-xs text-muted-foreground">
                    {photo.aisle && <span>Aisle: {photo.aisle}</span>}
                    {photo.aisle && photo.section && photo.section !== "000" && <span>, </span>}
                    {photo.section && photo.section !== "000" && <span>Section: {photo.section}</span>}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-center gap-3 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPhotoIndex(i => i - 1)}
                  disabled={safeIndex === 0}
                  data-testid="button-photo-prev"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setPhotoSort(s => s === "latest" ? "aisle" : "latest"); setCurrentPhotoIndex(0); }}
                  data-testid="button-photo-sort"
                >
                  <ArrowUpDown className="h-3 w-3 mr-1" />
                  {photoSort === "latest" ? "By Aisle" : "Latest"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCurrentPhotoIndex(i => i + 1)}
                  disabled={safeIndex >= sorted.length - 1}
                  data-testid="button-photo-next"
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}

export default MobileCaptureView;
