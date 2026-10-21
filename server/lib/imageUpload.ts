import multer from "multer";

export const IMAGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_IMAGE_MIMETYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// The optional limit permits small, isolated boundary fixtures. Production uses
// the unchanged 50 MiB default, memory storage and route-owned MIME errors.
export function createImageUpload(maxBytes = IMAGE_UPLOAD_MAX_BYTES) {
  const imageFileFilter: multer.Options["fileFilter"] = (req: any, file, cb) => {
    if (ALLOWED_IMAGE_MIMETYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      req._rejectedMimetype = file.mimetype;
      cb(null, false);
    }
  };
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: imageFileFilter,
  });
}
