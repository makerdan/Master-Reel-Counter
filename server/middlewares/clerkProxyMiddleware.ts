/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through this application's public host.
 * This is the canonical Replit Clerk proxy wiring and must precede body parsers.
 */
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from "http";
import type { Socket } from "net";
import type { RequestHandler } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import {
  CLERK_FRONTEND_API_ORIGIN,
  CLERK_PROXY_PATH,
  CLERK_PROXY_READINESS_PATH,
} from "@shared/clerk-config";

export const CLERK_PROXY_TARGET = CLERK_FRONTEND_API_ORIGIN;
export const CLERK_PROXY_HEALTH_PATH = "/api/admin/clerk-proxy/health";
export { CLERK_PROXY_PATH, CLERK_PROXY_READINESS_PATH };

export const CLERK_PROXY_CONNECT_TIMEOUT_MS = 3_000;
export function assertClerkProxyConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV === "production" && !environment.CLERK_SECRET_KEY) {
    throw new Error(
      "Production Clerk proxy configuration is incomplete: CLERK_SECRET_KEY is required",
    );
  }
}

export function getClerkProxyHost(req: { headers: IncomingHttpHeaders }): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = raw?.split(",")[0]?.trim();
  return firstHop || req.headers.host?.trim() || undefined;
}

export const CLERK_PROXY_RESPONSE_TIMEOUT_MS = 10_000;

export type ClerkProxyErrorClass =
  | "upstream-connect-timeout"
  | "upstream-response-timeout"
  | "upstream-error"
  | "downstream-aborted";

const CLERK_PROXY_ERROR_CLASSES = [
  "upstream-connect-timeout",
  "upstream-response-timeout",
  "upstream-error",
  "downstream-aborted",
] as const satisfies readonly ClerkProxyErrorClass[];

export const CLERK_PROXY_MAX_FAILURES_PER_CLASS = 1_000;

export type ClerkProxyHealthSnapshot = {
  counters: Record<ClerkProxyErrorClass, number>;
  total: number;
  capped: boolean;
};

/**
 * Process-local aggregate health for the proxy. It intentionally stores only
 * bounded failure-class counters; request and response data never enters this
 * object.
 */
export class ClerkProxyHealth {
  private readonly maxFailuresPerClass: number;
  private readonly counters: Record<ClerkProxyErrorClass, number> = {
    "upstream-connect-timeout": 0,
    "upstream-response-timeout": 0,
    "upstream-error": 0,
    "downstream-aborted": 0,
  };
  private capped = false;

  constructor(maxFailuresPerClass = CLERK_PROXY_MAX_FAILURES_PER_CLASS) {
    this.maxFailuresPerClass = Math.min(
      CLERK_PROXY_MAX_FAILURES_PER_CLASS,
      Number.isFinite(maxFailuresPerClass) ? Math.max(1, Math.floor(maxFailuresPerClass)) : CLERK_PROXY_MAX_FAILURES_PER_CLASS,
    );
  }

  record(errorClass: ClerkProxyErrorClass): void {
    if (this.counters[errorClass] >= this.maxFailuresPerClass) {
      this.capped = true;
      return;
    }
    this.counters[errorClass] += 1;
  }

  snapshot(): ClerkProxyHealthSnapshot {
    const counters = Object.fromEntries(
      CLERK_PROXY_ERROR_CLASSES.map((errorClass) => [errorClass, this.counters[errorClass]]),
    ) as Record<ClerkProxyErrorClass, number>;
    return {
      counters,
      total: Object.values(counters).reduce((sum, count) => sum + count, 0),
      capped: this.capped,
    };
  }

  reset(): void {
    for (const errorClass of CLERK_PROXY_ERROR_CLASSES) {
      this.counters[errorClass] = 0;
    }
    this.capped = false;
  }
}

export const clerkProxyHealth = new ClerkProxyHealth();

interface ClerkProxyState {
  req: IncomingMessage;
  res: ServerResponse;
  proxyReq?: ClientRequest;
  proxyRes?: IncomingMessage;
  connectTimer?: ReturnType<typeof setTimeout>;
  responseTimer?: ReturnType<typeof setTimeout>;
  finished: boolean;
}

export interface ClerkProxyMiddlewareOptions {
  /**
   * The target override is intentionally only exposed for deterministic tests.
   * Production callers use the fixed Clerk Frontend API target below.
   */
  target?: string;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  health?: ClerkProxyHealth;
}

export function createClerkProxyMiddleware(
  options: ClerkProxyMiddlewareOptions = {},
): RequestHandler {
  const target = options.target ?? CLERK_PROXY_TARGET;
  const connectTimeoutMs = options.connectTimeoutMs ?? CLERK_PROXY_CONNECT_TIMEOUT_MS;
  const responseTimeoutMs = options.responseTimeoutMs ?? CLERK_PROXY_RESPONSE_TIMEOUT_MS;
  const health = options.health ?? clerkProxyHealth;
  const secretKey = process.env.CLERK_SECRET_KEY ?? "";
  const states = new WeakMap<IncomingMessage, ClerkProxyState>();

  const clearTimers = (state: ClerkProxyState): void => {
    if (state.connectTimer) clearTimeout(state.connectTimer);
    if (state.responseTimer) clearTimeout(state.responseTimer);
    state.connectTimer = undefined;
    state.responseTimer = undefined;
  };

  const destroyUpstream = (state: ClerkProxyState): void => {
    state.proxyReq?.destroy();
    state.proxyRes?.destroy();
  };

  const complete = (state: ClerkProxyState): void => {
    if (state.finished) return;
    state.finished = true;
    clearTimers(state);
  };

  const fail = (
    state: ClerkProxyState,
    status: 502 | 504,
    errorClass: ClerkProxyErrorClass,
  ): void => {
    if (state.finished) return;
    state.finished = true;
    clearTimers(state);
    health.record(errorClass);
    // Keep diagnostics deliberately normalized: never log the request path,
    // target, headers, cookies, query values, or response body.
    console.warn(`[clerk-proxy] ${errorClass}`);
    destroyUpstream(state);

    if (state.res.destroyed || state.res.writableEnded) return;
    if (state.res.headersSent) {
      state.res.destroy();
      return;
    }

    state.res.writeHead(status, { "content-length": "0" });
    state.res.end();
  };

  const abortForDownstream = (state: ClerkProxyState): void => {
    if (state.finished) return;
    state.finished = true;
    clearTimers(state);
    health.record("downstream-aborted");
    console.warn("[clerk-proxy] downstream-aborted");
    destroyUpstream(state);
  };

  const armResponseTimer = (state: ClerkProxyState): void => {
    if (state.finished) return;
    if (state.responseTimer) clearTimeout(state.responseTimer);
    state.responseTimer = setTimeout(() => {
      fail(state, 504, "upstream-response-timeout");
    }, responseTimeoutMs);
  };

  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    selfHandleResponse: true,
    pathRewrite: (path: string) => path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req, _res) => {
        const state = states.get(req);
        if (!state) {
          proxyReq.destroy();
          return;
        }

        state.proxyReq = proxyReq;
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = getClerkProxyHost(req) || "";
        proxyReq.setHeader("Clerk-Proxy-Url", `${protocol}://${host}${CLERK_PROXY_PATH}`);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);

        const xff = req.headers["x-forwarded-for"];
        const clientIp =
          (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          "";
        if (clientIp) proxyReq.setHeader("X-Forwarded-For", clientIp);

        if (state.finished) {
          proxyReq.destroy();
          return;
        }

        const socket = proxyReq.socket as (Socket & {
          encrypted?: boolean;
          connecting?: boolean;
          readyState?: string;
        }) | null;
        if (!socket) return;

        let connected = false;
        const markConnected = (): void => {
          if (connected || state.finished) return;
          connected = true;
          if (state.connectTimer) clearTimeout(state.connectTimer);
          state.connectTimer = undefined;
          armResponseTimer(state);
        };

        const connectedEvent = socket.encrypted ? "secureConnect" : "connect";
        if (!socket.connecting || socket.readyState === "open") {
          markConnected();
        } else {
          socket.once(connectedEvent, markConnected);
        }
      },
      proxyRes: (proxyRes, req, res) => {
        const state = states.get(req);
        if (!state) {
          proxyRes.destroy();
          return;
        }
        if (state.finished) {
          proxyRes.destroy();
          return;
        }

        state.proxyRes = proxyRes;
        armResponseTimer(state);
        proxyRes.on("data", () => armResponseTimer(state));
        proxyRes.once("aborted", () => {
          fail(state, 502, "upstream-error");
        });
        proxyRes.once("error", () => {
          fail(state, 502, "upstream-error");
        });

        const headers = { ...proxyRes.headers };
        delete headers["transfer-encoding"];
        delete headers.connection;
        delete headers["keep-alive"];

        const status = proxyRes.statusCode ?? 502;
        if (status < 200 || status === 204) delete headers["content-length"];
        const bodyless = req.method === "HEAD" || status < 200 || status === 204 || status === 304;
        if (headers["content-length"] !== undefined || bodyless) {
          res.writeHead(status, headers);
          proxyRes.once("end", () => complete(state));
          proxyRes.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        proxyRes.once("end", () => {
          if (state.finished) return;
          const body = Buffer.concat(chunks);
          headers["content-length"] = String(body.length);
          res.writeHead(status, headers);
          res.end(body);
          complete(state);
        });
      },
      error: (_error, req) => {
        const state = states.get(req);
        if (state) fail(state, 502, "upstream-error");
      },
    },
  });

  return ((req, res, next) => {
    const state: ClerkProxyState = {
      req,
      res,
      finished: false,
    };
    states.set(req, state);

    req.once("aborted", () => abortForDownstream(state));
    res.once("close", () => {
      if (!res.writableEnded) abortForDownstream(state);
    });

    state.connectTimer = setTimeout(() => {
      fail(state, 504, "upstream-connect-timeout");
    }, connectTimeoutMs);

    return proxy(req, res, next);
  }) as RequestHandler;
}

export function clerkProxyMiddleware(): RequestHandler {
  if (process.env.NODE_ENV !== "production") {
    return (_req, _res, next) => next();
  }

  assertClerkProxyConfiguration();
  return createClerkProxyMiddleware();
}
