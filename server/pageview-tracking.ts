import { createHmac } from "node:crypto";
import type { RequestHandler } from "express";

export interface PageViewRecord {
  path: string;
  visitorHash: string;
}

const STATIC_PATHS = new Set(["/", "/settings", "/stats", "/help", "/sign-in", "/sign-up"]);
const DEDUPE_MS = 30_000;
const MAX_RECENT = 10_000;

/** Never persist caller-controlled route segments, query strings or fragments. */
export function coarsePagePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.length || value.length > 500 ||
      !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  const pathname = value.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (STATIC_PATHS.has(pathname)) return pathname;
  if (/^\/session\/[^/]+$/.test(pathname)) return "/session/:id";
  if (/^\/join\/[^/]+$/.test(pathname)) return "/join/:token";
  if (pathname.startsWith("/sign-in/")) return "/sign-in";
  if (pathname.startsWith("/sign-up/")) return "/sign-up";
  return "/other";
}

/** The same handler is used in production and in isolated persistence-boundary tests. */
export function createPageViewHandler({
  secret,
  write,
  now = Date.now,
}: {
  secret: () => string | undefined;
  write: (record: PageViewRecord) => Promise<unknown>;
  now?: () => number;
}): RequestHandler {
  // Store only keyed, short-lived identifiers and coarse labels.
  const recent = new Map<string, number>();
  return (req, res) => {
    try {
      const path = coarsePagePath(req.body?.path);
      if (path === null) {
        res.status(400).json({ ok: false });
        return;
      }
      const key = secret();
      // req.ip uses the app's existing proxy policy, not a second header parser.
      const ip = req.ip;
      if (!key?.trim() || !ip) {
        res.json({ ok: false });
        return;
      }
      const timestamp = now();
      const day = new Date(timestamp).toISOString().slice(0, 10);
      const visitorHash = createHmac("sha256", key)
        .update(`master-reel-counter:pageview:v1\0${day}\0${ip}`)
        .digest("hex");
      const dedupeKey = `${visitorHash}:${path}`;
      const previous = recent.get(dedupeKey);
      if (previous !== undefined && timestamp >= previous && timestamp - previous < DEDUPE_MS) {
        res.json({ ok: true, deduplicated: true });
        return;
      }
      if (recent.size >= MAX_RECENT) {
        for (const [entry, time] of recent) {
          if (timestamp - time >= DEDUPE_MS) recent.delete(entry);
        }
        if (recent.size >= MAX_RECENT) recent.delete(recent.keys().next().value!);
      }
      recent.set(dedupeKey, timestamp);
      // Never await analytics or expose its error/input in the public response.
      write({ path, visitorHash }).catch(() => {});
      res.json({ ok: true });
    } catch {
      res.json({ ok: false });
    }
  };
}
