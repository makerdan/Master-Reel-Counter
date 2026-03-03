import sharp from "sharp";

interface CropRequest {
  pinId: number;
  x: number;
  y: number;
  zoomLevel: number;
}

interface CropResult {
  pinId: number;
  base64: string;
}

const MIN_ZOOM = 0.03;
const MAX_ZOOM = 1.0;
const MAX_CROP_PX = 600;

export async function cropPhoto(
  photoBuffer: Buffer,
  pins: CropRequest[]
): Promise<CropResult[]> {
  const metadata = await sharp(photoBuffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;

  const results: CropResult[] = [];

  for (const pin of pins) {
    const fraction = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pin.zoomLevel));

    let cropW = Math.round(imgWidth * fraction);
    let cropH = Math.round(imgHeight * fraction);

    if (cropW > MAX_CROP_PX) cropW = MAX_CROP_PX;
    if (cropH > MAX_CROP_PX) cropH = MAX_CROP_PX;

    cropW = Math.min(cropW, imgWidth);
    cropH = Math.min(cropH, imgHeight);

    if (cropW < 1) cropW = 1;
    if (cropH < 1) cropH = 1;

    const centerX = Math.round((pin.x / 100) * imgWidth);
    const centerY = Math.round((pin.y / 100) * imgHeight);

    let left = centerX - Math.round(cropW / 2);
    let top = centerY - Math.round(cropH / 2);

    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left + cropW > imgWidth) left = imgWidth - cropW;
    if (top + cropH > imgHeight) top = imgHeight - cropH;

    const croppedBuffer = await sharp(photoBuffer)
      .extract({ left, top, width: cropW, height: cropH })
      .jpeg({ quality: 85 })
      .toBuffer();

    results.push({
      pinId: pin.pinId,
      base64: croppedBuffer.toString("base64"),
    });
  }

  return results;
}
