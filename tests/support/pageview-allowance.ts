import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { APIRequestContext } from "@playwright/test";

export const pageviewEndpoint = "/api/track/pageview";
export const throttleMessage = "Too many pageview requests, please try again later.";
const headerNames = [
  "content-type", "ratelimit-limit", "ratelimit-remaining",
  "ratelimit-reset", "ratelimit-policy", "retry-after",
] as const;

/** Keep only public contract shapes, never arbitrary bodies or client identity. */
export async function collectAllowanceBurst(request: APIRequestContext, baseURL: string) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const requests = [];
  for (let index = 0; index < 65; index++) {
    const sentMs = performance.now() - start;
    assert.ok(sentMs < 59_000, "Refusing to send beyond this single limiter window");
    const response = await request.post(new URL(pageviewEndpoint, baseURL).href, {
      data: { path: "/test-rate-limit" },
      failOnStatusCode: false, maxRedirects: 0,
      timeout: Math.min(10_000, 59_000 - sentMs),
    });
    const receivedMs = performance.now() - start;
    const headers = response.headers();
    const body: unknown = await response.json().catch(() => null);
    const object = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown> : null;
    requests.push({
      index, sentMs, receivedMs, status: response.status(),
      endpointMatched: response.url() === new URL(pageviewEndpoint, baseURL).href,
      headers: Object.fromEntries(headerNames.map((name) => [name, headers[name] ?? null])),
      bodyShape: {
        jsonObject: object !== null,
        ok: typeof object?.ok === "boolean" ? object.ok : null,
        deduplicated: object && "deduplicated" in object
          ? typeof object.deduplicated : "absent",
        message: object && "message" in object ? typeof object.message : "absent",
        documentedMessageMatched: object?.message === throttleMessage,
        unexpectedFieldCount: object
          ? Object.keys(object).filter((key) => !["ok", "deduplicated", "message"].includes(key)).length
          : null,
      },
    });
    await response.dispose();
  }
  return { startedAt, durationMs: performance.now() - start, requests };
}

export type AllowanceBurst = Awaited<ReturnType<typeof collectAllowanceBurst>>;

/** The exact same oracle is used for the real endpoint and local negative controls. */
export function assertLegitimateAllowance(burst: AllowanceBurst): void {
  assert.equal(burst.requests.length, 65);
  assert.ok(burst.durationMs < 60_000, "All requests must complete within one minute");
  assert.equal(burst.requests.filter((r) => r.status === 200).length, 60,
    "Expected exactly 60 JSON 200 responses");
  assert.equal(burst.requests.filter((r) => r.status === 429).length, 5,
    "Expected exactly five documented 429 responses");
  for (const [index, row] of burst.requests.entries()) {
    assert.equal(row.status, index < 60 ? 200 : 429, "Allowance must precede throttling");
    assert.equal(row.endpointMatched, true);
    assert.match(row.headers["content-type"] ?? "", /^application\/json\b/);
    assert.equal(row.bodyShape.jsonObject, true);
    assert.equal(row.bodyShape.unexpectedFieldCount, 0);
    assert.equal(row.headers["ratelimit-limit"], "60");
    assert.equal(row.headers["ratelimit-policy"], "60;w=60");
    assert.equal(row.headers["ratelimit-remaining"], String(Math.max(59 - index, 0)));
    assert.match(row.headers["ratelimit-reset"] ?? "", /^(?:[1-9]|[1-5]\d|60)$/);
    if (row.status === 200) {
      assert.equal(row.bodyShape.ok, true);
      assert.ok(["absent", "boolean"].includes(row.bodyShape.deduplicated));
      assert.equal(row.bodyShape.message, "absent");
      assert.equal(row.headers["retry-after"], null);
    } else {
      assert.equal(row.bodyShape.ok, false);
      assert.equal(row.bodyShape.message, "string");
      assert.equal(row.bodyShape.documentedMessageMatched, true);
      assert.equal(row.bodyShape.deduplicated, "absent");
      assert.equal(row.headers["retry-after"], row.headers["ratelimit-reset"]);
    }
  }
}
