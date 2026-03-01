import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Flag, Loader2, MapPin, Eye, X, Check, Share2, Camera, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Entry, Pin } from "@shared/schema";

interface FlaggedPin {
  id: number;
  photoId: number;
  entryId: number | null;
  xPercent: number;
  yPercent: number;
  label: string;
  reelCount: number;
  wireDetails: string | null;
  vendorCode: string | null;
  footage: number | null;
  flagged: boolean;
  photoUrl?: string;
  photoFilename?: string;
  photoAisle?: string | null;
  photoSection?: string | null;
}

interface FlaggedReelsProps {
  sessionId: number;
  onBack: () => void;
  onReshoot?: (aisle: string, section: string, parentPhotoId: number) => void;
}

export default function FlaggedReels({ sessionId, onBack, onReshoot }: FlaggedReelsProps) {
  const { toast } = useToast();
  const [previewPin, setPreviewPin] = useState<FlaggedPin | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: flaggedPins = [], isLoading } = useQuery<FlaggedPin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"],
    queryFn: async () => {
      const res = await fetch(`/api/sessions/${sessionId}/flagged-pins`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load flagged pins");
      return res.json();
    },
  });

  const unflagMutation = useMutation({
    mutationFn: async (pinId: number) => {
      await apiRequest("PATCH", `/api/pins/${pinId}/flag`, { flagged: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "flagged-pins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions", sessionId.toString(), "photos"] });
    },
  });

  const { data: sessionEntries = [] } = useQuery<Entry[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "entries"],
  });

  const { data: sessionPins = [] } = useQuery<Pin[]>({
    queryKey: ["/api/sessions", sessionId.toString(), "pins"],
  });

  const pinnedEntryIds = new Set(sessionPins.filter(p => p.entryId).map(p => p.entryId!));
  const unpinnedEntries = sessionEntries.filter(e => !pinnedEntryIds.has(e.id));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center sm:flex sm:justify-start sm:gap-2">
        <Flag className="sm:hidden h-5 w-5 text-yellow-500" />
        <h2 className="text-lg font-bold underline flex items-center gap-2" data-testid="text-flagged-heading">
          <Flag className="hidden sm:inline h-5 w-5 text-yellow-500" />
          <span className="sm:hidden">Flagged</span>
          <span className="hidden sm:inline">Flagged Reels</span>
          <Badge variant="secondary" className="hidden sm:inline-flex" data-testid="badge-flagged-count">{flaggedPins.length}</Badge>
        </h2>
        <div className="flex justify-end sm:contents">
          <Button
            variant="outline"
            size="sm"
            data-testid="button-share-flagged"
            title="Copy shareable link"
            aria-label="Share"
            onClick={() => {
              const url = `${window.location.origin}/session/${sessionId}?tab=flagged`;
              navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                toast({ title: "Link copied", description: "Share this link with your team member." });
                setTimeout(() => setCopied(false), 2000);
              }).catch(() => {
                toast({ title: "Copy failed", description: url, variant: "destructive" });
              });
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5 sm:mr-1" /> : <Share2 className="h-3.5 w-3.5 sm:mr-1" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Share"}</span>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : flaggedPins.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground" data-testid="text-no-flagged">
          <Flag className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No flagged reels in this session.</p>
          <p className="text-xs mt-1">Use the flag button on pins in Photo Mode to mark reels for re-shoot.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {flaggedPins.map((pin) => (
            <div
              key={pin.id}
              className="border border-border rounded-lg p-3 bg-card hover:bg-accent/5 transition-colors"
              data-testid={`flagged-pin-card-${pin.id}`}
            >
              {/* Desktop layout */}
              <div className="hidden sm:flex items-start gap-3">
                {pin.photoUrl ? (
                  <div
                    className="relative w-20 h-20 rounded overflow-hidden border border-border shrink-0 cursor-pointer"
                    onClick={() => setPreviewPin(pin)}
                  >
                    <img
                      src={pin.photoUrl}
                      alt={pin.photoFilename || "Photo"}
                      className="w-full h-full object-cover"
                    />
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${pin.xPercent}%`,
                        top: `${pin.yPercent}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <div className="w-8 h-8 rounded-full animate-pulse" style={{ border: "4px solid #f97316" }} />
                      <div className="absolute inset-0 w-8 h-8 rounded-full border border-white" />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/30 transition-opacity">
                      <Eye className="h-4 w-4 text-white" />
                    </div>
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded bg-muted flex items-center justify-center shrink-0">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-medium" data-testid={`text-pin-label-${pin.id}`}>
                      Pin {pin.label}
                    </span>
                    {pin.wireDetails && (
                      <Badge variant="outline" className="text-xs" data-testid={`badge-wire-${pin.id}`}>
                        {pin.wireDetails}
                      </Badge>
                    )}
                  </div>
                  {(pin.photoAisle || pin.photoSection) && (
                    <div className="flex gap-2 text-xs text-muted-foreground mb-0.5" data-testid={`text-location-${pin.id}`}>
                      {pin.photoAisle && <span>Aisle {pin.photoAisle}</span>}
                      {pin.photoAisle && pin.photoSection && <span>&middot;</span>}
                      {pin.photoSection && <span>Section {pin.photoSection}</span>}
                    </div>
                  )}
                  <div className="flex gap-3 text-xs text-muted-foreground font-mono">
                    {pin.reelCount > 0 && <span>{pin.reelCount} reel{pin.reelCount !== 1 ? "s" : ""}</span>}
                    {pin.vendorCode && <span>{pin.vendorCode}</span>}
                    {pin.footage && <span>{pin.footage.toLocaleString()} ft</span>}
                  </div>
                  {pin.photoFilename && (
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {pin.photoFilename}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  {onReshoot && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReshoot(pin.photoAisle || "", pin.photoSection || "", pin.photoId)}
                      data-testid={`button-reshoot-${pin.id}`}
                      title="Take a detail photo in Mobile Flow"
                    >
                      <Camera className="h-3.5 w-3.5 mr-1" />
                      Re-shoot
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => unflagMutation.mutate(pin.id)}
                    disabled={unflagMutation.isPending}
                    data-testid={`button-resolve-${pin.id}`}
                    title="Mark as resolved"
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Un-Flag
                  </Button>
                </div>
              </div>

              {/* Mobile layout */}
              <div className="sm:hidden flex flex-col items-center gap-2">
                <div className="flex items-center gap-2 w-full">
                  <span className="font-mono text-sm font-medium" data-testid={`text-pin-label-mobile-${pin.id}`}>
                    Pin {pin.label}
                  </span>
                  {pin.wireDetails && (
                    <Badge variant="outline" className="text-xs" data-testid={`badge-wire-mobile-${pin.id}`}>
                      {pin.wireDetails}
                    </Badge>
                  )}
                </div>
                {pin.photoUrl ? (
                  <div
                    className="relative w-full aspect-video rounded overflow-hidden border border-border cursor-pointer"
                    onClick={() => setPreviewPin(pin)}
                  >
                    <img
                      src={pin.photoUrl}
                      alt={pin.photoFilename || "Photo"}
                      className="w-full h-full object-cover"
                    />
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${pin.xPercent}%`,
                        top: `${pin.yPercent}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <div className="w-8 h-8 rounded-full animate-pulse" style={{ border: "4px solid #f97316" }} />
                      <div className="absolute inset-0 w-8 h-8 rounded-full border border-white" />
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-24 rounded bg-muted flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 w-full text-xs font-mono text-muted-foreground">
                  <span>Aisle {pin.photoAisle || "—"}</span>
                  <span>Sect. {pin.photoSection || "—"}</span>
                  <span>{pin.reelCount} Reel{pin.reelCount !== 1 ? "s" : ""}</span>
                  <span>{pin.vendorCode || "—"}, {pin.footage ? `${pin.footage.toLocaleString()} ft` : "— ft"}</span>
                </div>
                <div className="flex items-center justify-center gap-3 w-full">
                  {onReshoot && (
                    <Button
                      variant="outline"
                      size="icon"
                      className="border border-white"
                      onClick={() => onReshoot(pin.photoAisle || "", pin.photoSection || "", pin.photoId)}
                      data-testid={`button-reshoot-mobile-${pin.id}`}
                      title="Re-shoot"
                      aria-label="Re-shoot"
                    >
                      <Camera className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    className="border border-white"
                    onClick={() => unflagMutation.mutate(pin.id)}
                    disabled={unflagMutation.isPending}
                    data-testid={`button-resolve-mobile-${pin.id}`}
                    title="Un-Flag"
                    aria-label="Un-Flag"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {unpinnedEntries.length > 0 && (
        <div className="space-y-2" data-testid="section-issues">
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              Entries Without Photos ({unpinnedEntries.length})
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">These entries have no linked photo. They can be edited or deleted from Table View.</p>
          <div className="grid gap-2">
            {unpinnedEntries.map((e) => (
              <div
                key={e.id}
                className="border border-amber-200 dark:border-amber-900/50 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-950/20"
                data-testid={`issue-entry-card-${e.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium truncate" data-testid={`text-issue-label-${e.id}`}>
                      {e.reelTag || e.wireType || "Entry"}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-issue-location-${e.id}`}>
                      Aisle {e.aisle} / Section {e.section}
                    </p>
                  </div>
                  <div className="text-xs font-mono text-muted-foreground text-right shrink-0">
                    {e.reelCount && e.reelCount > 0 && <div>{e.reelCount} reel{e.reelCount !== 1 ? "s" : ""}</div>}
                    {e.footage && <div>{Number(e.footage).toLocaleString()} ft</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {previewPin && previewPin.photoUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewPin(null)}
          data-testid="modal-pin-preview"
        >
          <div className="relative max-w-2xl max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="absolute -top-10 right-0 text-white hover:text-white/80"
              onClick={() => setPreviewPin(null)}
              data-testid="button-close-preview"
            >
              <X className="h-5 w-5" />
            </Button>
            <div className="relative">
              <img
                src={previewPin.photoUrl}
                alt="Flagged pin location"
                className="max-w-full max-h-[75vh] rounded-lg"
              />
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${previewPin.xPercent}%`,
                  top: `${previewPin.yPercent}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="w-24 h-24 rounded-full animate-pulse opacity-100" style={{ border: "12px solid #f97316" }} />
                <div className="absolute inset-0 w-24 h-24 rounded-full border-2 border-white opacity-100" />
              </div>
            </div>
            <div className="mt-2 text-white text-sm text-center">
              <span className="font-mono">Pin {previewPin.label}</span>
              {previewPin.wireDetails && <span className="ml-2">&mdash; {previewPin.wireDetails}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
