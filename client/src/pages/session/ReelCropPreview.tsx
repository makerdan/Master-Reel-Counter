import { useEffect, useRef } from "react";
import { Focus, X } from "lucide-react";

interface ReelCropPreviewProps {
  photoUrl: string;
  pinX: number;
  pinY: number;
  label: string;
  cropMode: "closeup" | "wide";
  onCropModeChange: (mode: "closeup" | "wide") => void;
  onClose?: () => void;
}

export default function ReelCropPreview({
  photoUrl,
  pinX,
  pinY,
  label,
  cropMode,
  onCropModeChange,
  onClose,
}: ReelCropPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const DISPLAY_SIZE = 320;
  const fraction = cropMode === "closeup" ? 0.15 : 0.07;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cropW = img.width * fraction;
      const cropH = img.height * fraction;
      const cx = (pinX / 100) * img.width;
      const cy = (pinY / 100) * img.height;
      let sx = cx - cropW / 2;
      let sy = cy - cropH / 2;
      sx = Math.max(0, Math.min(sx, img.width - cropW));
      sy = Math.max(0, Math.min(sy, img.height - cropH));
      canvas.width = DISPLAY_SIZE * 2;
      canvas.height = DISPLAY_SIZE * 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
    };
    img.src = photoUrl;
  }, [photoUrl, pinX, pinY, fraction]);

  return (
    <div className="space-y-1" data-testid="reel-crop-preview">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 flex-wrap">
        <Focus className="h-3 w-3" />
        Reel Preview — {label}
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors ${
              cropMode === "closeup"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover-elevate"
            }`}
            onClick={() => onCropModeChange("closeup")}
            data-testid="button-crop-closeup"
          >
            Close-up
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors ${
              cropMode === "wide"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover-elevate"
            }`}
            onClick={() => onCropModeChange("wide")}
            data-testid="button-crop-wide"
          >
            Wide Shot
          </button>
          {onClose && (
            <button
              type="button"
              className="ml-1 p-0.5 rounded text-muted-foreground hover-elevate"
              onClick={onClose}
              data-testid="button-close-preview"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="rounded-md border border-border/50 overflow-hidden bg-black inline-block">
        <canvas
          ref={canvasRef}
          className="block"
          style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE }}
          data-testid="reel-crop-canvas"
        />
      </div>
    </div>
  );
}
