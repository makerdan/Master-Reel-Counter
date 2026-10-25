/**
 * @feature security
 * Guards the rate limit on POST /api/track/pageview.
 * This public, unauthenticated endpoint accepts analytics writes; without
 * a rate limit any external actor can flood it to bloat page_views and degrade
 * DB performance. Normal coverage proves the legitimate allowance as well as
 * rejection, against a test-owned process using the disposable browser database.
 */
import { test } from "./fixtures";
import { test as anonymousTest } from "@playwright/test";
import { diagnosePageviewBurst } from "./support/pageview-diagnostic";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertLegitimateAllowance, collectAllowanceBurst, throttleMessage,
  type AllowanceBurst,
} from "./support/pageview-allowance";
import { startOwnedPageviewServer } from "./support/pageview-owned-server";

test.describe("pageview rate limit @security", () => {
  test.skip(!process.env.RELEASE_CANDIDATE_ID?.startsWith("pageview-investigation-"),
    "Historical opt-in authenticated comparison; normal allowance has its own anonymous case");
  test("POST /api/track/pageview returns 429 after threshold", async ({
    request,
    playwright,
    baseURL,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error("Pageview investigation requires baseURL");
    const anonymous = await playwright.request.newContext({
      baseURL, storageState: { cookies: [], origins: [] },
    });
    try {
      await diagnosePageviewBurst(request, anonymous, baseURL, testInfo);
    } finally {
      await anonymous.dispose();
    }
  });
});

anonymousTest("fresh anonymous pageview allowance: 60 successes then 5 rejections @security", async ({
  playwright,
}, info) => {
  anonymousTest.setTimeout(180_000);
  const server = await startOwnedPageviewServer();
  const anonymous = await playwright.request.newContext({
    baseURL: server.baseURL, storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: {},
  });
  const evidence: Record<string, unknown> = {
    schemaVersion: 1, target: server.baseURL, candidate: server.candidate,
    database: "registered wrapper disposable database; distinct from publication",
    anonymousState: "empty cookies/origins and no authorization or forwarded identity headers",
    transport: "sequential fixed-client APIRequestContext HTTP; redirects disabled",
    quietWindowMs: 61_000,
    sourceHashes: Object.fromEntries([
      "server/index.ts", "server/routes.ts", "server/pageview-tracking.ts",
      "tests/pageview-rate-limit.spec.ts", "tests/support/pageview-allowance.ts",
      "tests/support/pageview-owned-server.ts", "scripts/run-browser-tests.mjs",
    ].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
  };
  try {
    const initial = await server.ready(anonymous);
    evidence.initial = initial;
    const auth = await anonymous.get("/api/auth/user", { maxRedirects: 0 });
    evidence.anonymousStatus = auth.status();
    assert.equal(auth.status(), 401);
    await auth.dispose();
    // No store reset, clock manipulation or identity rotation. This fresh
    // process receives no pageview traffic until after a complete quiet window.
    await delay(61_000);
    const before = await server.health(anonymous);
    const burst = await collectAllowanceBurst(anonymous, server.baseURL);
    const after = await server.health(anonymous);
    evidence.real = { before, after, ...burst };
    assert.deepEqual(before.listener, initial.listener);
    assert.deepEqual(after.listener, initial.listener);
    assertLegitimateAllowance(burst);

    const controls: Array<AllowanceBurst & {
      allowance: number; target: string; assertionRejected: boolean;
    }> = [];
    evidence.negativeControls = controls;
    for (const allowance of [59, 0]) {
      let count = 0;
      // Deliberately wrong local response fixture, NOT a changed app limiter.
      // Advertise the correct headers so the count assertion must detect it.
      const control = createServer((req, res) => {
        if (req.method !== "POST" || req.url !== "/api/track/pageview") {
          res.writeHead(404).end();
          return;
        }
        req.resume();
        const throttled = ++count > allowance;
        res.writeHead(throttled ? 429 : 200, {
          "Content-Type": "application/json",
          "RateLimit-Limit": "60", "RateLimit-Policy": "60;w=60",
          "RateLimit-Remaining": String(Math.max(60 - count, 0)),
          "RateLimit-Reset": "60", ...(throttled ? { "Retry-After": "60" } : {}),
        });
        res.end(JSON.stringify(throttled
          ? { ok: false, message: throttleMessage } : { ok: true }));
      });
      try {
        await new Promise<void>((resolve, reject) => {
          control.once("error", reject);
          control.listen(0, "127.0.0.1", resolve);
        });
        const address = control.address();
        assert.ok(address && typeof address !== "string");
        const target = `http://127.0.0.1:${address.port}`;
        const wrong = await collectAllowanceBurst(anonymous, target);
        const record = { allowance, target, ...wrong, assertionRejected: false };
        controls.push(record);
        assert.throws(() => assertLegitimateAllowance(wrong),
          /Expected exactly 60 JSON 200 responses/);
        record.assertionRejected = true;
      } finally {
        control.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          control.close((error) => error ? reject(error) : resolve()));
      }
    }
  } finally {
    try {
      try { await anonymous.dispose(); } finally { await server.stop(); }
      evidence.cleanup = "owned process group stopped";
    } finally {
      const path = info.outputPath("pageview-allowance.json");
      writeFileSync(path, JSON.stringify(evidence, null, 2));
      await info.attach("pageview-allowance", { path, contentType: "application/json" });
    }
  }
});

// Keep the public-route diagnosis observable when the owner sign-in fixture fails.
// This does not replace or bypass the existing authenticated-fixture comparison.
anonymousTest("isolated anonymous pageview diagnostic @security", async ({
  playwright, baseURL,
}, testInfo) => {
  anonymousTest.skip(
    !process.env.RELEASE_CANDIDATE_ID?.startsWith("pageview-investigation-"),
    "Opt-in owned-loopback investigation only",
  );
  anonymousTest.setTimeout(120_000);
  if (!baseURL) throw new Error("Pageview investigation requires baseURL");
  const anonymous = await playwright.request.newContext({
    baseURL, storageState: { cookies: [], origins: [] },
  });
  try {
    await diagnosePageviewBurst(null, anonymous, baseURL, testInfo);
  } finally {
    await anonymous.dispose();
  }
});
