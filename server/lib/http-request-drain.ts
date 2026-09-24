import type { Request, RequestHandler, Response } from "express";

interface ActiveRequest {
  request: Request;
  response: Response;
  release(): void;
}

export class HttpRequestDrainTracker {
  private readonly active = new Map<Response, ActiveRequest>();

  readonly middleware: RequestHandler = (request, response, next) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.active.delete(response);
    };

    this.active.set(response, { request, response, release });
    response.once("finish", release);
    response.once("close", release);
    request.once("aborted", release);
    next();
  };

  get activeCount(): number {
    return this.active.size;
  }

  /**
   * At the shutdown deadline, return a retryable response where headers have
   * not started. Already-streaming responses are closed rather than left open.
   */
  failActiveRequests(): number {
    const pending = [...this.active.values()];
    for (const { request, response } of pending) {
      if (response.destroyed || response.writableEnded) continue;
      if (response.headersSent) {
        response.destroy();
        continue;
      }

      try {
        response.status(503).json({
          message: "The server could not finish this request before restarting. Please retry.",
        });
        response.once("finish", () => {
          if (!request.complete) request.destroy();
        });
      } catch {
        response.destroy();
      }
    }
    return pending.length;
  }
}