import { expect, type APIRequestContext, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const endpoint = "/api/track/pageview";
const headerNames = [
  "content-type", "ratelimit-limit", "ratelimit-remaining",
  "ratelimit-reset", "ratelimit-policy", "retry-after",
] as const;

/** Opt-in investigation evidence only. Never copy cookies, identities or arbitrary bodies. */
export async function diagnosePageviewBurst(
  authenticated: APIRequestContext | null,
  anonymous: APIRequestContext,
  baseURL: string,
  info: TestInfo,
): Promise<void> {
  const url = new URL(baseURL);
  const candidate = process.env.RELEASE_CANDIDATE_ID;
  if (!candidate?.startsWith("pageview-investigation-") ||
      !["127.0.0.1", "localhost"].includes(url.hostname) || !url.port) {
    throw new Error("Pageview investigation requires an explicitly marked owned loopback target");
  }
  const listener = () => {
    const pids = [...new Set(execFileSync("lsof", [
      "-t", "-iTCP:" + url.port, "-sTCP:LISTEN",
    ], { encoding: "utf8" }).trim().split(/\s+/))];
    expect(pids).toHaveLength(1);
    const pid = Number(pids[0]);
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return { pid, startTicks: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] };
  };
  const health = async () => {
    const response = await anonymous.get("/api/healthz", { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect((await response.json()).candidateId).toBe(candidate);
    return { candidateMatched: true, listener: listener() };
  };
  const initial = await health();
  if (authenticated) {
    expect((await authenticated.get("/api/auth/user", { maxRedirects: 0 })).status()).toBe(200);
  }
  expect((await anonymous.get("/api/auth/user", { maxRedirects: 0 })).status()).toBe(401);

  const sourceHashes = Object.fromEntries([
    "server/index.ts", "server/routes.ts", "server/pageview-tracking.ts",
    "tests/pageview-rate-limit.spec.ts", "tests/support/pageview-diagnostic.ts",
    "tests/fixtures.ts", "tests/global-setup.ts", "playwright.config.ts",
    "scripts/run-browser-tests.mjs",
  ].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
  const bursts: unknown[] = [];
  const phases: Array<readonly [string, APIRequestContext]> = authenticated
    ? [["authenticated-existing-fixture", authenticated], ["anonymous-empty-storage", anonymous]]
    : [["anonymous-empty-storage", anonymous]];
  // Attach partial evidence even if a boundary assertion fails.
  try {
    // Global setup's browser navigation may track a pageview from the same IP.
    // A full quiet window isolates the anonymous allowance without resetting the store.
    if (!authenticated) await new Promise((resolve) => setTimeout(resolve, 61_000));
    for (const [label, request] of phases) {
      const before = await health();
      expect(before.listener).toEqual(initial.listener);
      const start = performance.now();
      const startedAt = new Date().toISOString();
      const requests = await Promise.all(Array.from({ length: 65 }, async (_, index) => {
        const sentMs = performance.now() - start;
        const response = await request.post(endpoint, {
          data: { path: "/test-rate-limit" },
          headers: { "Content-Type": "application/json" },
          failOnStatusCode: false,
          maxRedirects: 0,
          timeout: 15_000,
        });
        const receivedMs = performance.now() - start;
        const headers = response.headers();
        const body: unknown = await response.json().catch(() => null);
        const shape = body && typeof body === "object" && !Array.isArray(body)
          ? Object.fromEntries(Object.entries(body).map(([key, value]) => [
            // Public endpoint has only these documented fields.
            ["ok", "deduplicated", "message"].includes(key) ? key : "unexpected-field",
            typeof value === "boolean" ? value : typeof value,
          ]))
          : { responseKind: body === null ? "not-json-or-null" : typeof body };
        return {
          index, sentMs, receivedMs, status: response.status(),
          endpointMatched: response.url() === new URL(endpoint, baseURL).href,
          headers: Object.fromEntries(headerNames.map((name) => [name, headers[name] ?? null])),
          bodyShape: shape,
        };
      }));
      const durationMs = performance.now() - start;
      const after = await health();
      bursts.push({ label, startedAt, durationMs, before, after, requests });
      expect(after.listener).toEqual(initial.listener);
      expect(durationMs).toBeLessThan(60_000);
      expect(requests.every((r) => r.endpointMatched)).toBe(true);
      expect(requests.some((r) => r.status === 429)).toBe(true);
      expect(requests.every((r) => r.headers["ratelimit-limit"] === "60")).toBe(true);
      if (label === "authenticated-existing-fixture") {
        const resets = requests.map((r) => Number(r.headers["ratelimit-reset"]));
        expect(resets.every((n) => Number.isFinite(n) && n >= 0 && n <= 60)).toBe(true);
        // Same fixed client/IP: let the first window expire without altering its key/store.
        await new Promise((resolve) => setTimeout(resolve, (Math.max(...resets) + 1) * 1000));
      } else {
        expect(requests.filter((r) => r.status === 200)).toHaveLength(60);
        expect(requests.filter((r) => r.status === 429)).toHaveLength(5);
      }
    }
  } finally {
    const evidencePath = info.outputPath("pageview-throttle-diagnostic.json");
    writeFileSync(evidencePath, JSON.stringify({
      schemaVersion: 1, target: baseURL, candidate, initial, sourceHashes,
      redirects: "disabled", transport: "APIRequestContext HTTP; no page route interception",
      identityChecks: { authenticatedStatus: authenticated ? 200 : null, anonymousStatus: 401 },
      quietWindowBeforeBurstMs: authenticated ? 0 : 61_000,
      bursts,
    }, null, 2));
    await info.attach("pageview-throttle-diagnostic", {
      path: evidencePath,
      contentType: "application/json",
    });
  }
}
