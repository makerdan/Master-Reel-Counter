import sharp from "sharp";
import type { Readable } from "node:stream";
import { cropPhoto } from "./cropPhoto";

// Bound compressed input, native decode work and retained AI payload separately.
export const LABEL_SCAN_LIMITS = {
  inputBytes: 64 * 1024 * 1024,
  photoPixels: 20_000_000,
  totalPixels: 40_000_000,
  cropBytes: 16 * 1024 * 1024,
  readTimeoutMs: 15_000,
} as const;

export class LabelScanResourceError extends Error {
  constructor(
    message = "Label scan is too large. Scan fewer pins or use smaller photos.",
    public readonly statusCode = 413,
  ) {
    super(message);
  }
}

let scanActive = false;

// No waiting queue: waiting requests would themselves retain request state.
export function acquireLabelScanSlot(): () => void {
  if (scanActive) {
    throw new LabelScanResourceError("Another label scan is running. Please try again shortly.", 429);
  }
  scanActive = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scanActive = false;
  };
}

export async function readBoundedScanImage(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => stream.destroy(
    new LabelScanResourceError("Photo download timed out. Please try again.", 503),
  ), LABEL_SCAN_LIMITS.readTimeoutMs);
  timer.unref();
  try {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.length;
      if (size > maxBytes) throw new LabelScanResourceError();
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
}

interface ScanPin {
  photoId: number;
  pinId: number;
  pinLabel?: string;
  x: number;
  y: number;
  zoomLevel?: number;
}
interface ScanPhoto {
  sessionId: number;
  objectStorageKey: string;
  rotation?: number | null;
}

export async function prepareLabelScan(
  sessionId: number,
  pins: ScanPin[],
  getPhoto: (id: number) => Promise<ScanPhoto | undefined>,
  loadPhoto: (key: string, maxBytes: number) => Promise<Buffer>,
) {
  let inputBytes = 0;
  let pixels = 0;
  let cropBytes = 0;
  let truncated = false;
  let skippedCount = 0;
  const availablePhotos = new Set<number>();
  const crops: Array<{ pinId: number; base64: string }> = [];
  for (const photoId of new Set(pins.map((pin) => pin.photoId))) {
    const photo = await getPhoto(photoId);
    if (!photo || photo.sessionId !== sessionId) continue;
    const remaining = LABEL_SCAN_LIMITS.inputBytes - inputBytes;
    if (remaining <= 0) throw new LabelScanResourceError();
    // This helper's buffers go out of scope before the next photo is loaded.
    const prepared = await preparePhoto(photo, pins.filter((pin) => pin.photoId === photoId), remaining);
    availablePhotos.add(photoId);
    truncated ||= prepared.truncated;
    skippedCount += prepared.skippedCount;
    crops.push(...prepared.results);
  }
  return {
    requests: pins.filter((pin) => availablePhotos.has(pin.photoId)).map((pin) => ({
      ...pin,
      pinLabel: pin.pinLabel || `P${String(pin.pinId).padStart(3, "0")}`,
    })),
    crops,
    truncated,
    skippedCount,
  };

  async function preparePhoto(photo: ScanPhoto, photoPins: ScanPin[], remaining: number) {
    const raw = await loadPhoto(photo.objectStorageKey, remaining);
    inputBytes += raw.length;
    // Also enforce at this boundary if a different loader is supplied later.
    if (inputBytes > LABEL_SCAN_LIMITS.inputBytes) throw new LabelScanResourceError();
    // Metadata reads headers, not raster data. Check dimensions before native decode.
    const metadata = await sharp(raw, { limitInputPixels: false }).metadata();
    const photoPixels = (metadata.width ?? 0) * (metadata.height ?? 0);
    if (!photoPixels || photoPixels > LABEL_SCAN_LIMITS.photoPixels ||
        (metadata.pages ?? 1) > 1 || pixels + photoPixels > LABEL_SCAN_LIMITS.totalPixels) {
      throw new LabelScanResourceError();
    }
    pixels += photoPixels;
    const manualRotation = (photo.rotation ?? 0) % 360;
    let pipeline = sharp(raw, { limitInputPixels: LABEL_SCAN_LIMITS.photoPixels }).rotate();
    if (manualRotation !== 0) pipeline = pipeline.rotate(manualRotation);
    const oriented = await pipeline.timeout({ seconds: 10 }).toBuffer();
    const result = await cropPhoto(oriented, photoPins.map((pin) => ({
      ...pin, zoomLevel: pin.zoomLevel ?? 1,
    })));
    for (const crop of result.results) {
      cropBytes += Buffer.byteLength(crop.base64, "ascii");
      if (cropBytes > LABEL_SCAN_LIMITS.cropBytes) throw new LabelScanResourceError();
    }
    return result;
  }
}
