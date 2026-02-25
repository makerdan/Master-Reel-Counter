import { useEffect, useRef, useState } from "react";
import { Focus, X, ZoomIn, ZoomOut, RotateCw, RotateCcw } from "lucide-react";

interface ReelCropPreviewProps {
  photoUrl: string;
  pinX: number;
  pinY: number;
  label: string;
  zoomLevel: number;
  onZoomChange: (level: number) => void;
  onClose?: () => void;
}

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 0.50;
const ZOOM_STEP = 0.03;
const PRESET_CLOSEUP = 0.15;
const PRESET_WIDE = 0.40;

type Rotation = 0 | 90 | 180 | 270;

export default function ReelCropPreview({
  photoUrl,
  pinX,
  pinY,
  label,
  zoomLevel,
  onZoomChange,
  onClose,
}: ReelCropPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const DISPLAY_SIZE = 320;
  const [rotation, setRotation] = useState<Rotation>(0);

  const clamp = (v: number) => Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)) * 100) / 100;

  const rotateCw = () => setRotation(r => ((r + 90) % 360) as Rotation);
  const rotateCcw = () => setRotation(r => ((r + 270) % 360) as Rotation);

  useEffect(() => {
    setRotation(0);
  }, [photoUrl, pinX, pinY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const cropW = img.width * zoomLevel;
      const cropH = img.height * zoomLevel;
      const cx = (pinX / 100) * img.width;
      const cy = (pinY / 100) * img.height;
      let sx = cx - cropW / 2;
      let sy = cy - cropH / 2;
      sx = Math.max(0, Math.min(sx, img.width - cropW));
      sy = Math.max(0, Math.min(sy, img.height - cropH));

      const D = DISPLAY_SIZE * 2;
      canvas.width = D;
      canvas.height = D;
      ctx.clearRect(0, 0, D, D);

      ctx.save();
      ctx.translate(D / 2, D / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(img, sx, sy, cropW, cropH, -D / 2, -D / 2, D, D);
      ctx.restore();
    };
    img.src = photoUrl;
  }, [photoUrl, pinX, pinY, zoomLevel, rotation]);

  const isCloseup = Math.abs(zoomLevel - PRESET_CLOSEUP) < 0.01;
  const isWide = Math.abs(zoomLevel - PRESET_WIDE) < 0.01;

  return (
    <div className="space-y-1" data-testid="reel-crop-preview">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 flex-wrap">
        <Focus className="h-3 w-3" />
        Reel Preview — {label}
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors ${
              isCloseup
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover-elevate"
            }`}
            onClick={() => onZoomChange(PRESET_CLOSEUP)}
            data-testid="button-crop-closeup"
          >
            Close-up
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors ${
              isWide
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover-elevate"
            }`}
            onClick={() => onZoomChange(PRESET_WIDE)}
            data-testid="button-crop-wide"
          >
            Wide
          </button>
          <div className="w-px h-3.5 bg-border mx-0.5" />
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover-elevate disabled:opacity-30 disabled:pointer-events-none"
            onClick={() => onZoomChange(clamp(zoomLevel - ZOOM_STEP))}
            disabled={zoomLevel <= ZOOM_MIN + 0.005}
            data-testid="button-zoom-in"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover-elevate disabled:opacity-30 disabled:pointer-events-none"
            onClick={() => onZoomChange(clamp(zoomLevel + ZOOM_STEP))}
            disabled={zoomLevel >= ZOOM_MAX - 0.005}
            data-testid="button-zoom-out"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-3.5 bg-border mx-0.5" />
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover-elevate"
            onClick={rotateCcw}
            data-testid="button-rotate-ccw"
            title="Rotate counterclockwise"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover-elevate"
            onClick={rotateCw}
            data-testid="button-rotate-cw"
            title="Rotate clockwise"
          >
            <RotateCw className="h-3.5 w-3.5" />
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
