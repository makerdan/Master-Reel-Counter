import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { taskTracker, type CrashRecord } from "./lib/taskTracker";
import { validateSessionSecret } from "./encryption";
import { db } from "./db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

// Fail fast if SESSION_SECRET is absent or too weak.
validateSessionSecret();

const CRASH_LOG_PATH = path.join(process.cwd(), ".crash_log.json");

// Seed crash history from the previous run's persisted file (survives restarts).
// Supports both the legacy single-record format and the current array format.
try {
  if (fs.existsSync(CRASH_LOG_PATH)) {
    const raw = JSON.parse(fs.readFileSync(CRASH_LOG_PATH, "utf8"));
    const records: CrashRecord[] = Array.isArray(raw) ? raw : [raw];
    taskTracker.seedCrashHistory(records);
  }
} catch {
  // Malformed or missing file — ignore and start clean.
}

const app = express();
const httpServer = createServer(app);

let shuttingDown = false;
let drainStarted = false;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:", "https:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "blob:"],
      frameSrc: ["'none'"],
    },
  },
}));

app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  const requestId = (req.headers["x-request-id"] as string | undefined) || randomUUID();
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      log(`${req.method} ${reqPath} ${res.statusCode} in ${duration}ms rid=${requestId}`);
    }
  });

  next();
});

app.use("/api", (req, res, next) => {
  // /api/health is intentionally exempt so liveness probes can observe drain progress.
  if (shuttingDown && req.path !== "/health" && req.path !== "/healthz") {
    return res.status(503).json({ message: "Server is shutting down, please retry shortly." });
  }
  next();
});

/** Minimal crash summary safe for public health probes (no stack/message). */
function crashSummary() {
  const c = taskTracker.lastCrash();
  if (!c) return null;
  return { timestamp: c.timestamp, type: c.type, fatal: c.fatal };
}

app.get("/api/healthz", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({
      status: "ok",
      db: "ok",
      activeTasks: taskTracker.count(),
      lastCrash: crashSummary(),
    });
  } catch {
    res.status(503).json({
      status: "degraded",
      db: "error",
      activeTasks: taskTracker.count(),
      lastCrash: crashSummary(),
    });
  }
});

/**
 * Shared graceful-shutdown path used by both SIGTERM and uncaught crash handlers.
 * Stops accepting new requests, waits up to 30 s for active tasks to finish, then exits.
 * Using a single path ensures crashes never skip the in-flight task drain.
 */
function beginShutdown(exitCode: number, reason: string) {
  if (drainStarted) return; // idempotent — only the first caller drives the drain
  drainStarted = true;
  shuttingDown = true;
  log(`${reason} — draining active tasks before exit`, "shutdown");
  httpServer.close();

  const hardTimeout = setTimeout(() => {
    log("Drain timeout reached (30 s) — forcing exit", "shutdown");
    process.exit(exitCode);
  }, 30_000);
  hardTimeout.unref();

  if (taskTracker.count() === 0) {
    clearTimeout(hardTimeout);
    log("No active tasks — exiting cleanly", "shutdown");
    process.exit(exitCode);
  }

  log(`Waiting for ${taskTracker.count()} active task(s)...`, "shutdown");
  const poll = setInterval(() => {
    const active = taskTracker.count();
    if (active === 0) {
      clearInterval(poll);
      clearTimeout(hardTimeout);
      log("All tasks drained — exiting", "shutdown");
      process.exit(exitCode);
    } else {
      log(`Waiting for ${active} active task(s)...`, "shutdown");
    }
  }, 500);
}

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  // Fatal errors: log, persist crash record to disk (survives restart), then drain.
  // Routing through beginShutdown() ensures in-flight tasks are not abandoned.
  process.on("uncaughtException", (err) => {
    taskTracker.recordCrash("uncaughtException", err, true);
    log(`Uncaught exception: ${err.message}\n${err.stack ?? ""}`, "crash");
    try {
      fs.writeFileSync(CRASH_LOG_PATH, JSON.stringify(taskTracker.crashHistory()), "utf8");
    } catch {
      // Best-effort — don't let a write failure prevent the shutdown.
    }
    beginShutdown(1, "Uncaught exception");
  });

  // Unhandled rejections: non-fatal — process continues running. Record and
  // persist so /api/health can surface them after a restart. Fatal cases
  // (--unhandled-rejections=throw) are promoted to uncaughtException by Node.js.
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    taskTracker.recordCrash("unhandledRejection", err, false);
    log(`Unhandled promise rejection: ${err.message}\n${err.stack ?? ""}`, "crash");
    try {
      fs.writeFileSync(CRASH_LOG_PATH, JSON.stringify(taskTracker.crashHistory()), "utf8");
    } catch {
      // Best-effort.
    }
  });

  // Graceful shutdown on SIGTERM (e.g. deployment rollover, container stop).
  // Production auto-restart is handled by the Replit autoscale deployment target;
  // development auto-restart is handled by the while-loop wrapper in the workflow.
  process.on("SIGTERM", () => {
    beginShutdown(0, "SIGTERM received");
  });
})();
