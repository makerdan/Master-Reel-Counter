import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { isAuthenticated } from "../auth/replitAuth";

// Mirror the upload-rate limit applied to POST /api/uploads/direct so that
// the presigned-URL flow cannot be used to circumvent per-user quotas.
const presignedUrlRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB — matches POST /api/uploads/direct

/**
 * Register object storage routes for file uploads.
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. The client then uploads directly to the presigned URL
 *
 * IMPORTANT: These are example routes. Customize based on your use case:
 * - Add authentication middleware for protected uploads
 * - Add file metadata storage (save to database after upload)
 * - Add ACL policies for access control
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Request a presigned URL for file upload.
   *
   * Request body (JSON):
   * {
   *   "name": "filename.jpg",
   *   "size": 12345,
   *   "contentType": "image/jpeg"
   * }
   *
   * Response:
   * {
   *   "uploadURL": "https://storage.googleapis.com/...",
   *   "objectPath": "/objects/uploads/uuid"
   * }
   *
   * IMPORTANT: The client should NOT send the file to this endpoint.
   * Send JSON metadata only, then upload the file directly to uploadURL.
   */
  app.post("/api/uploads/request-url", isAuthenticated, presignedUrlRateLimiter, async (req, res) => {
    try {
      const { name, size, contentType } = req.body;

      if (!name) {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }

      // Reject declared content types that fall outside the application's
      // image allowlist (mirrors the MIME filter on POST /api/uploads/direct).
      if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
        return res.status(400).json({
          error: `Invalid content type: ${contentType}. Allowed: image/jpeg, image/png, image/webp.`,
        });
      }

      // Reject files that declare a size above the 50 MB cap enforced by the
      // direct upload route (multer limit).  Callers omitting size are still
      // admitted — GCS itself enforces the signed-URL TTL as the outer bound.
      if (size !== undefined && Number(size) > MAX_UPLOAD_BYTES) {
        return res.status(400).json({
          error: `File too large. Maximum allowed size is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
        });
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();

      // Extract object path from the presigned URL for later reference
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
        // Echo back the metadata for client convenience
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  /**
   * Serve uploaded objects.
   *
   * GET /objects/uploads/:filename
   *
   * Only the /objects/uploads/ namespace is supported. Requests are redirected
   * to /uploads/:filename, which enforces session-membership and ownership
   * checks before streaming the file.  All other /objects/ paths are blocked.
   */
  app.get("/objects/{*objectPath}", isAuthenticated, (req, res) => {
    const p = req.path; // e.g. "/objects/uploads/abc.jpg"

    // Only serve /objects/uploads/<filename> — every other sub-path has no
    // authorization model in this application and must be blocked.
    if (!p.startsWith("/objects/uploads/")) {
      return res.status(403).json({ error: "Access denied" });
    }

    const filename = p.slice("/objects/uploads/".length);

    // Validate filename to prevent path traversal before redirecting.
    if (
      !filename ||
      !/^[A-Za-z0-9._-]+$/.test(filename) ||
      filename.length > 255 ||
      filename === "." ||
      filename === ".."
    ) {
      return res.status(400).json({ error: "Invalid filename" });
    }

    // Redirect to the authorized /uploads/:filename route, which performs
    // session-membership and ownership verification before serving the file.
    return res.redirect(`/uploads/${filename}`);
  });
}

