import { useEffect, useRef, useState, useCallback } from "react";
import { Focus, X, ZoomIn, ZoomOut, RotateCw, RotateCcw, Crosshair } from "lucide-react";

interface ReelCropPreviewProps {
  photoUrl: string;
  pinX: number;
  pinY: number;
  label: string;
  zoomLevel: number;
  onZoomChange: (level: number) => void;
  onClose?: () => void;
}

const ZOOM_MIN = 0.01;
const ZOOM_MAX = 0.90;
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
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgUrlRef = useRef<string>("");

  const panRef = useRef({ x: 0, y: 0 });
  panRef.current = { x: panX, y: panY };

  const clamp = (v: number) => Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)) * 100) / 100;

  const rotateCw = () => setRotation(r => ((r + 90) % 360) as Rotation);
  const rotateCcw = () => setRotation(r => ((r + 270) % 360) as Rotation);

  const resetPan = useCallback(() => { setPanX(0); setPanY(0); }, []);

  useEffect(() => {
    setRotation(0);
    resetPan();
  }, [photoUrl, pinX, pinY]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete || !img.naturalWidth) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cropW = img.width * zoomLevel;
    const cropH = img.height * zoomLevel;
    const cx = (pinX / 100) * img.width + panRef.current.x;
    const cy = (pinY / 100) * img.height + panRef.current.y;
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
  }, [pinX, pinY, zoomLevel, rotation]);

  useEffect(() => {
    if (imgUrlRef.current === photoUrl && imgRef.current) {
      drawCanvas();
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      imgUrlRef.current = photoUrl;
      drawCanvas();
    };
    img.src = photoUrl;
  }, [photoUrl, pinX, pinY, zoomLevel, rotation, panX, panY, drawCanvas]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== null) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    activePointerRef.current = e.pointerId;
    draggingRef.current = true;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
  }, []);

  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !dragStartRef.current || e.pointerId !== activePointerRef.current) return;
      e.preventDefault();
      const img = imgRef.current;
      if (!img) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const scaleX = (img.width * zoomLevelRef.current) / DISPLAY_SIZE;
      const scaleY = (img.height * zoomLevelRef.current) / DISPLAY_SIZE;
      const rot = rotationRef.current;
      const cosR = Math.cos((-rot * Math.PI) / 180);
      const sinR = Math.sin((-rot * Math.PI) / 180);
      const rotDx = dx * cosR - dy * sinR;
      const rotDy = dx * sinR + dy * cosR;
      const maxPanX = img.width * 0.5;
      const maxPanY = img.height * 0.5;
      const newPanX = Math.max(-maxPanX, Math.min(maxPanX, dragStartRef.current.panX - rotDx * scaleX));
      const newPanY = Math.max(-maxPanY, Math.min(maxPanY, dragStartRef.current.panY - rotDy * scaleY));
      setPanX(newPanX);
      setPanY(newPanY);
    };
    canvas.addEventListener("pointermove", onMove, { passive: false });
    return () => canvas.removeEventListener("pointermove", onMove);
  }, []);

  const handlePointerMove = useCallback((_e: React.PointerEvent<HTMLCanvasElement>) => {
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== activePointerRef.current) return;
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);
    activePointerRef.current = null;
    draggingRef.current = false;
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  const isPanned = Math.abs(panX) > 1 || Math.abs(panY) > 1;
  const isCloseup = Math.abs(zoomLevel - PRESET_CLOSEUP) < 0.01;
  const isWide = Math.abs(zoomLevel - PRESET_WIDE) < 0.01;

  return (
    <div className="space-y-1" data-testid="reel-crop-preview">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 flex-wrap">
        <Focus className="h-3 w-3" />
        Reel Preview — {label}
        <div className="flex items-center gap-1 ml-auto">
          {isPanned && (
            <button
              type="button"
              className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors bg-amber-600/20 text-amber-400 hover:bg-amber-600/30"
              onClick={resetPan}
              data-testid="button-recenter"
              title="Re-center on pin"
            >
              <Crosshair className="h-3 w-3 inline mr-0.5" />
              Re-center
            </button>
          )}
          <button
            type="button"
            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase transition-colors ${
              isCloseup
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover-elevate"
            }`}
            onClick={() => { onZoomChange(PRESET_CLOSEUP); resetPan(); }}
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
            onClick={() => { onZoomChange(PRESET_WIDE); resetPan(); }}
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
          className="block touch-none select-none"
          style={{
            width: DISPLAY_SIZE,
            height: DISPLAY_SIZE,
            cursor: isDragging ? "grabbing" : "grab",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          data-testid="reel-crop-canvas"
        />
      </div>
    </div>
  );
}
