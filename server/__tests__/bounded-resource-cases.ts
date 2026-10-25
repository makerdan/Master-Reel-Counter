import assert from "node:assert/strict";
import { describe, test } from "node:test";
import express from "express";
import http from "node:http";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { entries, photos, countingSessions } from "@shared/schema";
import { backfillProgress } from "@shared/backfill-progress";
import { db } from "../db";
import { storage } from "../storage";
import { objectStorageClient } from "../replit_integrations/object_storage";
import {
  aggregateSections, sectionKey, loadBoundedExcelData, ExportWorkLimitError,
  RESOURCE_WORK_LIMITS as LIMITS, selectBackfillBatch, createResourceProtection,
} from "../lib/boundedResourceWork";

type Context = { baseUrl: string; photoId: number; entryId: number; cleanup(): Promise<void> };

export function registerBoundedResourceTests(buildContext: () => Promise<Context>) {
  describe("bounded export and backfill work", () => {
    test("distinct sections aggregate in one traversal with correct multi-reel totals", () => {
      let visits = 0;
      const input = {
        *[Symbol.iterator]() {
          for (let i = 0; i < LIMITS.excelEntries; i++) {
            visits++;
            yield { aisle: `A${i}`, section: "1", footage: 90, reelCount: 3 };
          }
        },
      };
      const totals = aggregateSections(input);
      assert.equal(visits, LIMITS.excelEntries);
      assert.equal(totals.size, LIMITS.excelEntries);
      assert.deepEqual(totals.get(sectionKey("A0", "1")), { entries: 1, reels: 3, footage: 90 });
      const repeated = aggregateSections([
        { aisle: null, section: "", footage: 20, reelCount: null },
        { aisle: "", section: null, footage: 90, reelCount: 3 },
        { aisle: "x|||y", section: "z", footage: 1, reelCount: 1 },
        { aisle: "x", section: "y|||z", footage: 2, reelCount: 1 },
      ]);
      assert.equal(repeated.size, 3, "delimiter-bearing locations must not collide");
      assert.deepEqual(repeated.get(sectionKey("", "")), { entries: 2, reels: 4, footage: 110 });
    });

    test("Excel data rejects each overflow at the SQL limit before downstream queries", async () => {
      const limits = [LIMITS.excelEntries, LIMITS.excelPhotos, LIMITS.excelPins];
      for (let overflow = 0; overflow < 3; overflow++) {
        const observed: number[] = [];
        let index = 0;
        const chain: any = {
          from: () => chain, where: () => chain, orderBy: () => chain, innerJoin: () => chain,
          limit: async (limit: number) => {
            const current = index++;
            observed.push(limit);
            return current === overflow ? Array(limits[current] + 1).fill({}) : [];
          },
        };
        const database = { select: () => chain } as unknown as typeof db;
        await assert.rejects(loadBoundedExcelData(database, 42), ExportWorkLimitError);
        assert.deepEqual(observed, limits.slice(0, overflow + 1).map(limit => limit + 1));
      }
      // SQL compilation proves that the real owner filter and SQL cap exist,
      // rather than checking a mock's post-query array slice.
      const query = selectBackfillBatch(db, "owner").toSQL();
      assert.match(query.sql, /inner join "counting_sessions"/);
      assert.match(query.sql, /"counting_sessions"\."user_id" =/);
      assert.match(query.sql, /"photos"\."file_size" is null/);
      assert.match(query.sql, /"counting_sessions"\."deleted_at" is null/);
      assert.match(query.sql, /limit \$\d+/);
      assert.deepEqual(query.params, ["owner", 0, LIMITS.backfillPhotos + 1]);
      const continued = selectBackfillBatch(db, "owner", 99).toSQL();
      assert.deepEqual(continued.params, ["owner", 99, LIMITS.backfillPhotos + 1]);
      assert.match(continued.sql, /"photos"\."id" > /);
    });

    test("backfill presentation retains continuation and never claims all photos are complete", () => {
      const partial = backfillProgress({ total: 100, updated: 0, failed: 100, hasMore: true, nextCursor: 100 });
      assert.equal(partial.nextCursor, 100);
      assert.equal(partial.title, "More photos remain");
      assert.match(partial.description, /Use Continue/);
      assert.match(partial.description, /100 unavailable; retry on a later pass/);
      const finished = backfillProgress({ total: 2, updated: 2, failed: 0, hasMore: false, nextCursor: null });
      assert.equal(finished.nextCursor, null, "ending a pass permits retry from zero");
      assert.equal(finished.title, "Backfill pass finished");
      assert.match(finished.description, /retry any photos still missing sizes/);
    });

    test("HTTP protection enforces per-user rate limits, single flight, global concurrency and failure cleanup", async () => {
      const app = express();
      const protection = createResourceProtection(req => String(req.headers["x-user"]), 5, 2);
      let calls = 0;
      let finish!: () => void;
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const pending = new Promise<void>(resolve => { finish = resolve; });
      app.get("/work", protection.limiter, protection.wrap(async (req, res) => {
        calls++;
        if (req.headers["x-user"] === "held") { entered(); await pending; }
        if (req.headers["x-user"] === "failure") throw new Error("expected test failure");
        res.json({ ok: true });
      }));
      app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ message: "expected test failure" });
      });
      const server = http.createServer(app);
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/work`;
      const request = (user: string) => fetch(url, { headers: { "x-user": user } });
      try {
        const first = request("held");
        await started;
        assert.equal((await request("held")).status, 429);
        assert.equal(calls, 1, "overlap cannot enter work");
        assert.equal((await request("other")).status, 200);
        for (let i = 0; i < 5; i++) assert.equal((await request("rate")).status, 200);
        const limited = await request("rate");
        assert.equal(limited.status, 429);
        assert.ok(limited.headers.get("retry-after"));
        assert.equal((await request("independent")).status, 200);
        assert.equal((await request("failure")).status, 500);
        assert.equal((await request("failure")).status, 500, "failed work releases its slot");
        finish();
        assert.equal((await first).status, 200);
        assert.equal((await request("held")).status, 200, "completed work releases its slot");
      } finally {
        finish();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
      // Deterministic saturation without racing an HTTP transport.
      let unblock!: () => void;
      const wait = new Promise<void>(resolve => { unblock = resolve; });
      const keyProtection = createResourceProtection(req => String(req.headers["x-user"]), 5, 1);
      const holdKey = keyProtection.wrap(async () => { await wait; });
      const mockRequest = (id: string) => ({ headers: { "x-user": id } }) as unknown as express.Request;
      let status = 0;
      const res = { setHeader() {}, status(code: number) { status = code; return this; }, json() {} } as unknown as express.Response;
      const running = holdKey(mockRequest("one"), res, () => {});
      await keyProtection.wrap(async () => { assert.fail("global capacity exceeded"); })(mockRequest("two"), res, () => {});
      assert.equal(status, 429);
      unblock();
      await running;
    });

    test("real Excel route preserves section totals and rejects overflow before workbook generation", { timeout: 30_000 }, async (t) => {
      const context = await buildContext();
      t.after(context.cleanup);
      const photo = (await storage.getPhoto(context.photoId))!;
      const original = (await storage.getEntry(context.entryId))!;
      await db.update(entries).set({ aisle: "A", section: "1", footage: 90, reelCount: 3 })
        .where(eq(entries.id, context.entryId));
      await db.insert(entries).values({
        sessionId: photo.sessionId, userId: original.userId,
        aisle: "A", section: "1", footage: 20, reelCount: 2,
      });
      const response = await fetch(`${context.baseUrl}/api/sessions/${photo.sessionId}/export/excel`);
      assert.equal(response.status, 200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as any);
      const values: unknown[] = [];
      workbook.worksheets[0].eachRow(row => values.push(row.getCell(1).value));
      assert.ok(values.some(value => typeof value === "string" && /2 entries, 5 reels, 110/.test(value)),
        "workbook section bands retain summed footage and reel counts");
      // A real DB fixture exercises the production route's bounded query,
      // before encryption/settings, related photos/pins or workbook work.
      await db.insert(entries).values(Array.from({ length: LIMITS.excelEntries - 1 }, (_, i) => ({
        sessionId: photo.sessionId, userId: original.userId, aisle: `A${i}`, section: `S${i}`,
      })));
      const oversized = await fetch(`${context.baseUrl}/api/sessions/${photo.sessionId}/export/excel`);
      assert.equal(oversized.status, 413);
      assert.match((await oversized.json()).message, /export limit/);
      for (let i = 0; i < 3; i++) {
        assert.equal((await fetch(`${context.baseUrl}/api/sessions/${photo.sessionId}/export/excel`)).status, 413);
      }
      assert.equal((await fetch(`${context.baseUrl}/api/sessions/${photo.sessionId}/export/excel`)).status, 429);
    });

    test("real backfill processes bounded owner batches and cannot retry failed objects without limits", { timeout: 30_000 }, async (t) => {
      const context = await buildContext();
      t.after(context.cleanup);
      const photo = (await storage.getPhoto(context.photoId))!;
      const session = (await storage.getSession(photo.sessionId))!;
      await db.insert(photos).values(Array.from({ length: LIMITS.backfillPhotos + 2 }, (_, i) => ({
        sessionId: session.id, userId: session.userId, objectStorageKey: `/uploads/bounded-${i}.jpg`,
      })));
      const [foreign] = await db.insert(countingSessions).values({ userId: "foreign", name: "foreign" }).returning();
      const [trashed] = await db.insert(countingSessions).values({
        userId: session.userId, name: "trashed", deletedAt: new Date(),
      }).returning();
      await db.insert(photos).values([
        { sessionId: foreign.id, userId: "foreign", objectStorageKey: "/uploads/foreign.jpg" },
        { sessionId: trashed.id, userId: session.userId, objectStorageKey: "/uploads/trashed.jpg" },
      ]);
      let metadataCalls = 0;
      const keys: string[] = [];
      t.mock.method(objectStorageClient, "bucket", () => ({
        file(key: string) {
          keys.push(key);
          const interceptors: Array<{ request(options: object): object }> = [];
          return {
            interceptors,
            async getMetadata() {
              metadataCalls++;
              assert.deepEqual(interceptors[0].request({ method: "GET", uri: "/metadata" }), {
                method: "GET", uri: "/metadata", timeout: LIMITS.metadataTimeoutMs, maxRetries: 0,
              });
              return [{ size: "42" }];
            },
          };
        },
      }) as any);
      const request = () => fetch(`${context.baseUrl}/api/storage/backfill-sizes`, { method: "POST" });
      const first = await request();
      assert.equal(first.status, 200);
      const firstBatch = await first.json();
      assert.deepEqual(firstBatch, { total: 100, updated: 100, failed: 0, hasMore: true, nextCursor: photo.id + 99 });
      const second = await request();
      assert.equal(second.status, 200);
      assert.deepEqual(await second.json(), { total: 3, updated: 3, failed: 0, hasMore: false, nextCursor: null });
      assert.equal(metadataCalls, 103);
      assert.ok(keys.every(key => !/foreign|trashed/.test(key)));
      assert.equal((await request()).status, 429);
      assert.equal(metadataCalls, 103, "rate-limited calls do not read storage");
    });

    test("real backfill blocks overlap and bounds repeated failures", { timeout: 30_000 }, async (t) => {
      const context = await buildContext();
      t.after(context.cleanup);
      let release!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      let calls = 0;
      t.mock.method(objectStorageClient, "bucket", () => ({
        file() {
          return {
            interceptors: [],
            async getMetadata() {
              calls++;
              entered();
              await pending;
              throw new Error("object unavailable");
            },
          };
        },
      }) as any);
      const request = () => fetch(`${context.baseUrl}/api/storage/backfill-sizes`, { method: "POST" });
      const first = request();
      try {
        await started;
        assert.equal((await request()).status, 429);
        assert.equal(calls, 1, "overlap does not repeat the failed metadata lookup");
      } finally {
        release();
      }
      const response = await first;
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { total: 1, updated: 0, failed: 1, hasMore: false, nextCursor: null });
      assert.equal((await request()).status, 429, "failed rows cannot bypass the per-user budget");
      assert.equal(calls, 1);
    });

    test("real continuation reaches valid photos after 100 persistently failed earlier objects", { timeout: 30_000 }, async (t) => {
      const context = await buildContext();
      t.after(context.cleanup);
      const photo = (await storage.getPhoto(context.photoId))!;
      const session = (await storage.getSession(photo.sessionId))!;
      await db.insert(photos).values(Array.from({ length: 99 }, (_, i) => ({
        sessionId: session.id, userId: session.userId, objectStorageKey: `/uploads/failing-${photo.id}-${i}.jpg`,
      })));
      const later = await db.insert(photos).values([1, 2].map(i => ({
        sessionId: session.id, userId: session.userId, objectStorageKey: `/uploads/later-valid-${photo.id}-${i}.jpg`,
      }))).returning();
      let calls = 0;
      t.mock.method(objectStorageClient, "bucket", () => ({
        file(key: string) {
          return { interceptors: [], async getMetadata() {
            calls++;
            if (!key.includes("later-valid")) throw new Error("persistent missing object");
            return [{ size: "42" }];
          } };
        },
      }) as any);
      const request = (afterPhotoId = 0) => fetch(`${context.baseUrl}/api/storage/backfill-sizes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ afterPhotoId }),
      });
      const first = await request();
      assert.equal(first.status, 200);
      const batch = await first.json();
      assert.equal(batch.total, 100);
      assert.equal(batch.failed, 100);
      assert.equal(batch.updated, 0);
      assert.equal(batch.hasMore, true);
      assert.ok(batch.nextCursor < later[0].id && batch.nextCursor >= photo.id);
      const second = await request(batch.nextCursor);
      assert.equal(second.status, 200);
      assert.deepEqual(await second.json(), { total: 2, updated: 2, failed: 0, hasMore: false, nextCursor: null });
      assert.equal(calls, 102, "each batch performs at most 100 cloud calls, without repeating failed rows");
      for (const item of later) assert.equal((await storage.getPhoto(item.id))!.fileSize, 42);
      const retryable = await selectBackfillBatch(db, session.userId);
      assert.equal(retryable.length, 100, "a new pass from zero still permits failed rows to be retried");
      assert.ok(retryable.every(row => row.id < later[0].id));
    });

    test("time-budget cutoff returns the last attempted photo cursor and preserves later work", { timeout: 30_000 }, async (t) => {
      const context = await buildContext();
      t.after(context.cleanup);
      const photo = (await storage.getPhoto(context.photoId))!;
      const session = (await storage.getSession(photo.sessionId))!;
      await db.insert(photos).values([1, 2].map(i => ({
        sessionId: session.id, userId: session.userId, objectStorageKey: `/uploads/budget-${photo.id}-${i}.jpg`,
      })));
      let now = Date.now();
      t.mock.method(Date, "now", () => now);
      let calls = 0;
      t.mock.method(objectStorageClient, "bucket", () => ({
        file() {
          return { interceptors: [], async getMetadata() {
            if (++calls === 1) now += LIMITS.backfillBudgetMs;
            return [{ size: "42" }];
          } };
        },
      }) as any);
      const request = (afterPhotoId = 0) => fetch(`${context.baseUrl}/api/storage/backfill-sizes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ afterPhotoId }),
      });
      const first = await request();
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), {
        total: 1, updated: 1, failed: 0, hasMore: true, nextCursor: photo.id,
      });
      const second = await request(photo.id);
      assert.equal(second.status, 200);
      assert.deepEqual(await second.json(), { total: 2, updated: 2, failed: 0, hasMore: false, nextCursor: null });
      assert.equal(calls, 3);
    });

    test("real backfill rejects malformed continuation before storage work", { timeout: 30_000 }, async (t) => {
      const context = await buildContext();
      t.after(context.cleanup);
      let calls = 0;
      t.mock.method(objectStorageClient, "bucket", () => {
        calls++;
        throw new Error("invalid cursor must not touch cloud storage");
      });
      for (const afterPhotoId of ["1", -1]) {
        const response = await fetch(`${context.baseUrl}/api/storage/backfill-sizes`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ afterPhotoId }),
        });
        assert.equal(response.status, 400);
        assert.match((await response.json()).message, /non-negative photo ID/);
      }
      assert.equal(calls, 0);
    });
  });
}
