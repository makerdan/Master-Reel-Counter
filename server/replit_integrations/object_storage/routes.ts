import type { Express } from "express";
import { ObjectStorageService } from "./objectStorage";
import { isAuthenticated } from "../auth";
import { isApproved } from "../auth/routes";

/**
 * Register object storage routes.
 *
 * NOTE: POST /api/uploads/request-url (presigned PUT URL flow) has been
 * retired because server-side upload controls (size cap, MIME allowlist,
 * rate limiting) cannot be enforced on direct-to-storage PUT requests.
 * All uploads must use the hardened POST /api/uploads/direct route instead.
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Retired presigned-URL upload endpoint.
   *
   * This endpoint has been disabled because the presigned-URL upload flow
   * bypasses server-side controls (50 MB cap, MIME allowlist, rate limiting)
   * that are enforced on POST /api/uploads/direct.  All file uploads must go
   * through POST /api/uploads/direct.
   */
  app.post("/api/uploads/request-url", isAuthenticated, (_req, res) => {
    return res.status(410).json({
      error: "This endpoint has been retired. Use POST /api/uploads/direct instead.",
    });
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
  app.get("/objects/{*objectPath}", isAuthenticated, isApproved, (req, res) => {
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

  // Suppress unused-variable warning — objectStorageService is retained in
  // case future authorized routes in this file need it.
  void objectStorageService;
}
