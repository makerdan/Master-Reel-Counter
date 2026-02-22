import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Flag, ChevronLeft, Loader2, MapPin, Eye, X, Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
}

export default function FlaggedReels({ sessionId, onBack }: FlaggedReelsProps) {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          data-testid="button-back-from-flagged"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-flagged-heading">
          <Flag className="h-5 w-5 text-yellow-500" />
          Flagged Reels
          <Badge variant="secondary" data-testid="badge-flagged-count">{flaggedPins.length}</Badge>
        </h2>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            data-testid="button-share-flagged"
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
            {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Share2 className="h-3.5 w-3.5 mr-1" />}
            {copied ? "Copied" : "Share"}
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
              <div className="flex items-start gap-3">
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

                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => unflagMutation.mutate(pin.id)}
                  disabled={unflagMutation.isPending}
                  data-testid={`button-resolve-${pin.id}`}
                  title="Mark as resolved"
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Resolve
                </Button>
              </div>
            </div>
          ))}
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
