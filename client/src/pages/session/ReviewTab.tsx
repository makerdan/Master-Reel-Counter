import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, Flag, Loader2, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { Entry, Photo, Pin, ReviewResponse } from "@shared/schema";

const REVEAL_DELAY_MS = 60_000;

type OnlineUser = { userId: string; username: string };

function CropThumbnail({
  photoUrl,
  xPercent,
  yPercent,
  size = 180,
}: {
  photoUrl: string;
  xPercent: number;
  yPercent: number;
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
    const fraction = 0.12;
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
  }, [xPercent, yPercent, size]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    imgRef.current = img;
    img.onload = draw;
    img.src = photoUrl;
  }, [photoUrl, draw]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded border border-border bg-black mx-auto"
      style={{ width: size, height: size }}
      data-testid="canvas-review-thumbnail"
    />
  );
}

function getPhotoUrl(photo: Photo): string {
  const key = photo.objectStorageKey;
  if (key.startsWith("/uploads/") || key.startsWith("/objects/")) return key;
  return `/uploads/${key}`;
}

export default function ReviewTab({
  sessionId,
  entries,
  photos,
  onlineUsers = [],
}: {
  sessionId: number;
  entries: Entry[];
  photos: Photo[];
  onlineUsers?: OnlineUser[];
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
    for (const p of sessionPins) {
      if (p.entryId) map.set(p.entryId, p);
    }
    return map;
  }, [sessionPins]);

  const photoMap = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => a.id - b.id);
  }, [entries]);

  const sortedUsers = useMemo(() => {
    if (onlineUsers.length === 0 && currentUserId) {
      return [{ userId: currentUserId, username: user?.firstName || currentUserId }];
    }
    return [...onlineUsers].sort((a, b) => a.userId.localeCompare(b.userId));
  }, [onlineUsers, currentUserId, user]);

  const assignedEntries = useMemo(() => {
    if (sortedUsers.length === 0 || sortedEntries.length === 0) return [];
    const userIndex = sortedUsers.findIndex(u => u.userId === currentUserId);
    if (userIndex === -1) return [];
    return sortedEntries.filter((_, i) => i % sortedUsers.length === userIndex);
  }, [sortedEntries, sortedUsers, currentUserId]);

  const myResponses = useMemo(() => {
    const map = new Map<number, ReviewResponse>();
    for (const r of reviewResponses) {
      if (r.userId === currentUserId) {
        map.set(r.entryId, r);
      }
    }
    return map;
  }, [reviewResponses, currentUserId]);

  const reviewedCount = useMemo(() => {
    return assignedEntries.filter(e => myResponses.has(e.id)).length;
  }, [assignedEntries, myResponses]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealedEntries, setRevealedEntries] = useState<Set<number>>(new Set());
  const [timers, setTimers] = useState<Map<number, number>>(new Map());
  const timerRefs = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map());
  const [flagReason, setFlagReason] = useState("");
  const [showFlagInput, setShowFlagInput] = useState(false);

  // Start all timers concurrently when assigned entries load, based on entry.createdAt
  useEffect(() => {
    const immediateReveal = new Set<number>();
    const pending: { id: number; remainingMs: number }[] = [];

    for (const entry of assignedEntries) {
      // Already reviewed entries are always revealed
      if (myResponses.has(entry.id)) {
        immediateReveal.add(entry.id);
        continue;
      }
      // Already revealed or timer running
      if (revealedEntries.has(entry.id) || timerRefs.current.has(entry.id)) continue;

      const createdAt = entry.createdAt ? new Date(entry.createdAt).getTime() : Date.now();
      const elapsed = Date.now() - createdAt;
      const remaining = REVEAL_DELAY_MS - elapsed;

      if (remaining <= 0) {
        immediateReveal.add(entry.id);
      } else {
        pending.push({ id: entry.id, remainingMs: remaining });
      }
    }

    if (immediateReveal.size > 0) {
      setRevealedEntries(prev => {
        const next = new Set(prev);
        for (const id of immediateReveal) next.add(id);
        return next;
      });
    }

    for (const { id, remainingMs } of pending) {
      const initialSeconds = Math.ceil(remainingMs / 1000);
      setTimers(prev => new Map(prev).set(id, initialSeconds));

      const interval = setInterval(() => {
        setTimers(prev => {
          const next = new Map(prev);
          const current = (next.get(id) ?? 1) - 1;
          if (current <= 0) {
            next.delete(id);
            clearInterval(timerRefs.current.get(id));
            timerRefs.current.delete(id);
            setRevealedEntries(r => new Set(r).add(id));
            return next;
          }
          next.set(id, current);
          return next;
        });
      }, 1000);
      timerRefs.current.set(id, interval);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedEntries, myResponses]);

  useEffect(() => {
    return () => {
      for (const interval of timerRefs.current.values()) {
        clearInterval(interval);
      }
      timerRefs.current.clear();
    };
  }, []);

  const submitReview = useMutation({
    mutationFn: async ({ entryId, verdict, reason }: { entryId: number; verdict: string; reason?: string }) => {
      const res = await apiRequest("POST", `/api/sessions/${sessionId}/review-responses`, {
        entryId,
        verdict,
        flagReason: reason || null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "review-responses"] });
      setShowFlagInput(false);
      setFlagReason("");
    },
    onError: () => {
      toast({ title: "Failed to save review", variant: "destructive" });
    },
  });

  const currentEntry = assignedEntries[currentIndex] ?? null;
  const currentPin = currentEntry ? pinByEntryId.get(currentEntry.id) : null;
  const currentPhoto = currentEntry?.photoId ? photoMap.get(currentEntry.photoId) : null;
  const isRevealed = currentEntry ? revealedEntries.has(currentEntry.id) : false;
  const timerSeconds = currentEntry ? (timers.get(currentEntry.id) ?? null) : null;
  const existingResponse = currentEntry ? myResponses.get(currentEntry.id) : undefined;

  const isPinEntry = currentPin && currentPin.xPercent !== undefined && currentPin.yPercent !== undefined;

  useEffect(() => {
    setShowFlagInput(false);
    setFlagReason("");
  }, [currentIndex]);

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

  const progressPercent = assignedEntries.length > 0 ? (reviewedCount / assignedEntries.length) * 100 : 0;

  return (
    <div className="space-y-4" data-testid="review-tab-container">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge variant="outline" data-testid="badge-review-progress">
            {reviewedCount} of {assignedEntries.length} reviewed
          </Badge>
          {sortedUsers.length > 1 && (
            <Badge variant="secondary" data-testid="badge-review-users">
              {sortedUsers.length} reviewers
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground" data-testid="text-review-entry-counter">
          Entry {currentIndex + 1} of {assignedEntries.length}
        </div>
      </div>

      <Progress value={progressPercent} className="h-2" data-testid="progress-review" />

      {currentEntry && (
        <Card data-testid={`card-review-entry-${currentEntry.id}`}>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {currentEntry.aisle && `Aisle ${currentEntry.aisle}`}
                {currentEntry.section && ` - Section ${currentEntry.section}`}
              </span>
              <span>{currentEntry.reelTag || "Unknown"}</span>
            </div>

            <div className="flex justify-center min-h-[200px] items-center">
              {!isRevealed ? (
                <div className="flex flex-col items-center gap-3" data-testid="review-spinner">
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Syncing... {timerSeconds !== null ? `${timerSeconds}s` : ""}
                  </p>
                </div>
              ) : isPinEntry && currentPhoto ? (
                <CropThumbnail
                  photoUrl={getPhotoUrl(currentPhoto)}
                  xPercent={currentPin!.xPercent}
                  yPercent={currentPin!.yPercent}
                  size={220}
                />
              ) : currentPhoto ? (
                <img
                  src={getPhotoUrl(currentPhoto)}
                  alt="Section photo"
                  className="max-h-[300px] rounded border border-border object-contain"
                  data-testid="img-review-photo"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <AlertTriangle className="h-8 w-8" />
                  <p className="text-sm">No photo available</p>
                </div>
              )}
            </div>

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
                        variant="destructive"
                        className="flex-1"
                        onClick={() => submitReview.mutate({ entryId: currentEntry.id, verdict: "flagged", reason: flagReason })}
                        disabled={submitReview.isPending}
                        data-testid="button-confirm-flag"
                      >
                        {submitReview.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Flag className="h-4 w-4 mr-1" />}
                        Confirm Flag
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => { setShowFlagInput(false); setFlagReason(""); }}
                        data-testid="button-cancel-flag"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2" data-testid="review-actions">
                    <Button
                      variant="default"
                      className="flex-1"
                      onClick={() => submitReview.mutate({ entryId: currentEntry.id, verdict: "approved" })}
                      disabled={submitReview.isPending}
                      data-testid="button-approve"
                    >
                      {submitReview.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10"
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

      <div className="flex justify-between items-center">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
          disabled={currentIndex === 0}
          data-testid="button-review-prev"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentIndex(i => Math.min(assignedEntries.length - 1, i + 1))}
          disabled={currentIndex >= assignedEntries.length - 1}
          data-testid="button-review-next"
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
