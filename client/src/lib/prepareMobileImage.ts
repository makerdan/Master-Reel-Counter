export class MobileImageFormatError extends Error {
  constructor(message = "This photo format could not be read. Choose a JPEG, PNG, or WebP image.") {
    super(message);
    this.name = "MobileImageFormatError";
  }
}

export interface PreparedMobileImage {
  file: File;
  width: number;
  height: number;
  quality: number;
}

function jpegFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return `${base}.jpg`;
}

async function canvasToJpeg(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality: number,
): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) throw new MobileImageFormatError();
    return blob;
  }
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

export async function prepareMobileImage(
  source: File,
  photoQualityPercent: number,
): Promise<PreparedMobileImage> {
  const qualityPercent = Math.min(100, Math.max(30, photoQualityPercent));
  const quality = qualityPercent / 100;

  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
      try {
        if (bitmap.width < 1 || bitmap.height < 1) throw new MobileImageFormatError();
        const canvas = typeof OffscreenCanvas !== "undefined"
          ? new OffscreenCanvas(bitmap.width, bitmap.height)
          : Object.assign(document.createElement("canvas"), {
              width: bitmap.width,
              height: bitmap.height,
            });
        const context = canvas.getContext("2d");
        if (!context) throw new MobileImageFormatError();
        context.drawImage(bitmap, 0, 0);
        const jpeg = await canvasToJpeg(canvas, quality);
        return {
          file: new File([jpeg], jpegFilename(source.name), {
            type: "image/jpeg",
            lastModified: source.lastModified,
          }),
          width: bitmap.width,
          height: bitmap.height,
          quality: qualityPercent,
        };
      } finally {
        bitmap.close();
      }
    }

    const objectUrl = URL.createObjectURL(source);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new MobileImageFormatError());
        image.src = objectUrl;
      });
      if (image.naturalWidth < 1 || image.naturalHeight < 1) throw new MobileImageFormatError();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new MobileImageFormatError();
      context.drawImage(image, 0, 0);
      const jpeg = await canvasToJpeg(canvas, quality);
      return {
        file: new File([jpeg], jpegFilename(source.name), {
          type: "image/jpeg",
          lastModified: source.lastModified,
        }),
        width: image.naturalWidth,
        height: image.naturalHeight,
        quality: qualityPercent,
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    if (error instanceof MobileImageFormatError) throw error;
    throw new MobileImageFormatError();
  }
}