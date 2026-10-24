import test from "node:test";
import assert from "node:assert/strict";
import { HELP_ARTICLES, HELP_CONTENT_VERSION, HELP_SOURCE_TEXT } from "@shared/help-content";
import { ownerOnly } from "../replit_integrations/auth/routes";
import { findHardcodedPortReferences } from "../../scripts/port-reference-scan.mjs";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPageViewHandler, coarsePagePath, type PageViewRecord } from "../pageview-tracking";

function collector(options: Partial<Parameters<typeof createPageViewHandler>[0]> = {}) {
  const records: PageViewRecord[] = [];
  const handler = createPageViewHandler({
    secret: () => "fixture-only-server-key",
    now: () => Date.UTC(2026, 9, 24, 12),
    write: async (record) => { records.push(record); },
    ...options,
  });
  return {
    records,
    send(path: unknown, ip: string | undefined = "192.0.2.1") {
      let body: unknown;
      let status = 200;
      let replies = 0;
      handler({ body: { path }, ip, headers: { "x-forwarded-for": "attacker-controlled" } } as any, {
        status(code: number) { status = code; return this; },
        json(value: unknown) { body = value; replies++; return this; },
      } as any, () => { throw new Error("unexpected next"); });
      assert.equal(replies, 1, "telemetry must respond synchronously without awaiting its sink");
      return { status, body };
    },
  };
}

test("page-view persistence receives only coarse labels, not sensitive URL content", () => {
  for (const [input, expected] of [
    ["/?access_token=secret#private", "/"],
    ["/settings/?email=private@example.test", "/settings"],
    ["/session/private-session-id?token=secret", "/session/:id"],
    ["/join/private-invite#secret", "/join/:token"],
    ["/sign-in/factor-one?ticket=secret", "/sign-in"],
    ["/sign-up/verify-email-address", "/sign-up"],
    ["/search/private@example.test", "/other"],
    ["/%73ecret%3Ftoken=private", "/other"],
    ["/help", "/help"], ["/stats", "/stats"],
  ]) {
    const c = collector();
    assert.deepEqual(c.send(input), { status: 200, body: { ok: true } });
    assert.equal(c.records[0].path, expected);
    assert.deepEqual(Object.keys(c.records[0]).sort(), ["path", "visitorHash"]);
    assert.doesNotMatch(JSON.stringify(c.records), /secret|private|192\.0\.2\.1|fixture-only/);
  }
});

test("page-view malformed paths never reach the sink", () => {
  for (const input of [null, undefined, {}, 12, "", "https://example.test/help",
    "//example.test/help", "/bad\\path", "/help\n", "/" + "a".repeat(500)]) {
    assert.equal(coarsePagePath(input), null);
    const c = collector();
    assert.deepEqual(c.send(input), { status: 400, body: { ok: false } });
    assert.equal(c.records.length, 0);
  }
});

test("visitor IDs are domain-separated HMACs using the server key and daily scope", () => {
  const c = collector();
  c.send("/help");
  assert.equal(c.records[0].visitorHash, createHmac("sha256", "fixture-only-server-key")
    .update("master-reel-counter:pageview:v1\0" + "2026-10-24\0" + "192.0.2.1").digest("hex"));
  for (const options of [
    { secret: () => "different-fixture-key" },
    { now: () => Date.UTC(2026, 9, 25, 12) },
  ]) {
    const other = collector(options); other.send("/help");
    assert.notEqual(other.records[0].visitorHash, c.records[0].visitorHash);
  }
  c.send("/help", "192.0.2.2");
  assert.notEqual(c.records[1].visitorHash, c.records[0].visitorHash);
});

test("missing or unreadable secret and missing IP fail closed without persistence", () => {
  for (const secret of [() => undefined, () => "", () => "  ", () => { throw new Error("private config"); }]) {
    const c = collector({ secret });
    assert.deepEqual(c.send("/help"), { status: 200, body: { ok: false } });
    assert.equal(c.records.length, 0);
  }
  const c = collector();
  assert.deepEqual(c.send("/help", ""), { status: 200, body: { ok: false } });
  assert.equal(c.records.length, 0);
});

test("dedupe uses minimized routes and preserves the 30-second window", () => {
  let time = 0;
  const c = collector({ now: () => time });
  c.send("/session/a?secret=one");
  time = 29_999;
  assert.deepEqual(c.send("/session/b?secret=two").body, { ok: true, deduplicated: true });
  assert.equal(c.records.length, 1);
  time = 30_000;
  c.send("/session/b");
  assert.equal(c.records.length, 2);
  c.send("/help");
  assert.equal(c.records.length, 3);
});

test("stalled, rejecting and synchronously failing sinks cannot block the response", async () => {
  const hanging = collector({ write: () => new Promise(() => {}) });
  assert.deepEqual(hanging.send("/help").body, { ok: true });
  const rejected = collector({ write: () => Promise.reject(new Error("private storage error")) });
  assert.deepEqual(rejected.send("/help").body, { ok: true });
  const thrown = collector({ write: () => { throw new Error("private storage error"); } });
  assert.deepEqual(thrown.send("/help").body, { ok: false });
  await new Promise((resolve) => setImmediate(resolve));
});

test("installed public collector keeps the limiter and parameterized adapter around the tested handler", () => {
  const source = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");
  assert.match(source, /app\.post\("\/api\/track\/pageview", pageviewRateLimiter, createPageViewHandler\(\{/);
  assert.match(source, /secret: \(\) => process\.env\.SESSION_SECRET/);
  assert.match(source, /VALUES \(\$\{path\}, \$\{visitorHash\}, NOW\(\)\)/);
  assert.doesNotMatch(source, /pv-salt|update\(ip \+ salt\)/);
});

test("support help is versioned and app-only", () => {
  assert.ok(HELP_CONTENT_VERSION > 0);
  assert.ok(HELP_ARTICLES.length >= 3);
  assert.match(HELP_SOURCE_TEXT, /Dashboard/);
  assert.ok(HELP_ARTICLES.every((article) => article.id && article.body && article.keywords.length > 0));
});

test("owner boundary denies missing and non-owner identities without disclosure", () => {
  const responses: Array<{ statusCode: number; body: unknown }> = [];
  const response = () => {
    const result = {
      statusCode: 200,
      status(code: number) { result.statusCode = code; return result; },
      json(body: unknown) { responses.push({ statusCode: result.statusCode, body }); return result; },
    };
    return result;
  };
  const next = () => { throw new Error("unauthorized request reached handler"); };

  ownerOnly({ user: undefined } as any, response() as any, next);
  ownerOnly({ user: { claims: { sub: "member" }, isOwner: false } } as any, response() as any, next);
  assert.equal(responses.length, 2);
  assert.deepEqual(responses.map((entry) => entry.statusCode), [403, 403]);
  assert.deepEqual(responses[0].body, { message: "Forbidden" });
  assert.deepEqual(responses[1].body, { message: "Forbidden" });
});

test("port scanner rejects fixed service fixtures but allows canonical allocation", () => {
  assert.deepEqual(
    findHardcodedPortReferences(
      "app.listen(5000); app.listen('5001'); fetch('http://0.0.0.0:5002/api/healthz')",
    ),
    ["listen(5000", "listen('5001'", "0.0.0.0:5002"],
  );
  assert.deepEqual(
    findHardcodedPortReferences(
      "app.listen(Number(process.env.PORT)); app.listen(0); fetch(`http://localhost:${port}`)",
    ),
    [],
  );
});