import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { countingSessions, entries, photos, reviewResponses, sessionCollaborators } from "@shared/schema";

type RouteContext = {
  baseUrl: string;
  entryId: number;
  cleanup: () => Promise<void>;
};

// Registered by routes.test.ts to reuse its real production HTTP server,
// authenticated/approved account, and disposable database schema.
export function registerSessionAuthorizationTests(buildContext: () => Promise<RouteContext>) {
  describe("session authorization — production review routes and aggregate storage", () => {
    let context: RouteContext;
    let sessionId: number;
    let userId: string;
    let ownerId: string;
    let foreignEntryId: number;

    before(async () => {
      context = await buildContext();
      const entry = (await storage.getEntry(context.entryId))!;
      sessionId = entry.sessionId;
      userId = entry.userId;
      ownerId = (await storage.getSession(sessionId))!.userId;
      const [foreignSession] = await db.insert(countingSessions).values({
        userId: `foreign-${randomUUID()}`, name: "Foreign review session",
      }).returning();
      const [foreignEntry] = await db.insert(entries).values({
        sessionId: foreignSession.id, userId: foreignSession.userId, aisle: "F", section: "1",
      }).returning();
      foreignEntryId = foreignEntry.id;
    });
    after(async () => { await context?.cleanup(); });

    const post = (path: string, body: unknown = {}) => fetch(
      `${context.baseUrl}/api/sessions/${sessionId}/${path}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );

    async function resetActor(role: "owner" | "editor" | "viewer" | "nonmember") {
      await db.update(countingSessions).set({
        userId: role === "owner" ? userId : ownerId, reviewCohort: null, deletedAt: null,
      }).where(eq(countingSessions.id, sessionId));
      await db.delete(sessionCollaborators).where(eq(sessionCollaborators.sessionId, sessionId));
      if (role === "editor" || role === "viewer") {
        await db.insert(sessionCollaborators).values({ sessionId, userId, role });
      }
      await db.delete(reviewResponses).where(eq(reviewResponses.sessionId, sessionId));
    }

    test("viewers cannot create or overwrite verdicts or anchor a cohort", async () => {
      await resetActor("viewer");
      for (const verdict of ["approved", "flagged"]) {
        assert.equal((await post("review-responses", {
          entryId: context.entryId, verdict, flagReason: "unauthorized",
        })).status, 403);
        assert.deepEqual(await storage.getSessionReviewResponses(sessionId), []);
        assert.equal((await storage.getSession(sessionId))!.reviewCohort, null);
      }
      assert.equal((await post("review-cohort")).status, 403);
      assert.equal((await storage.getSession(sessionId))!.reviewCohort, null);

      const previous = await storage.upsertReviewResponse({
        sessionId, entryId: context.entryId, userId, username: userId, verdict: "approved", flagReason: null,
      });
      assert.equal((await post("review-responses", {
        entryId: context.entryId, verdict: "flagged", flagReason: "overwrite",
      })).status, 403);
      assert.deepEqual(await storage.getSessionReviewResponses(sessionId), [previous]);

      // A cohort already set by an authorized participant does not turn this
      // state-changing POST into a viewer-authorized endpoint.
      const cohort = [{ userId: ownerId, username: "Owner" }];
      await storage.setSessionReviewCohort(sessionId, cohort);
      assert.equal((await post("review-cohort")).status, 403);
      assert.deepEqual(JSON.parse((await storage.getSession(sessionId))!.reviewCohort!), cohort);
      const read = await fetch(`${context.baseUrl}/api/sessions/${sessionId}/review-responses`);
      assert.equal(read.status, 200, "review reads remain available to viewers");
      assert.equal((await read.json()).length, 1);
    });

    for (const role of ["editor", "owner"] as const) {
      test(`${role}s retain cohort anchoring and review create/update permissions`, async () => {
        await resetActor(role);
        const anchored = await post("review-cohort");
        assert.equal(anchored.status, 200);
        const { cohort } = await anchored.json();
        assert.ok(cohort.some((member: { userId: string }) => member.userId === userId));
        assert.deepEqual(JSON.parse((await storage.getSession(sessionId))!.reviewCohort!), cohort);

        assert.equal((await post("review-responses", {
          entryId: foreignEntryId, verdict: "approved",
        })).status, 400, "same-session entry validation is preserved");
        assert.equal((await post("review-responses", {
          entryId: context.entryId, verdict: "invalid",
        })).status, 400);
        assert.deepEqual(await storage.getSessionReviewResponses(sessionId), []);

        // Exercise automatic anchoring through a first response as well.
        await db.update(countingSessions).set({ reviewCohort: null }).where(eq(countingSessions.id, sessionId));
        for (const verdict of ["approved", "flagged"]) {
          const response = await post("review-responses", {
            entryId: context.entryId, verdict, flagReason: "Check label",
          });
          assert.equal(response.status, 200);
          const persisted = await storage.getSessionReviewResponses(sessionId);
          assert.equal(persisted.length, 1, "updates retain a single per-user decision");
          assert.equal(persisted[0].userId, userId);
          assert.equal(persisted[0].verdict, verdict);
          assert.equal(persisted[0].flagReason, verdict === "flagged" ? "Check label" : null);
          assert.ok((await storage.getSession(sessionId))!.reviewCohort);
        }
      });
    }

    test("nonmembers and members of trashed sessions cannot write review state", async () => {
      for (const role of ["nonmember", "viewer", "editor", "owner"] as const) {
        await resetActor(role);
        if (role !== "nonmember") await storage.softDeleteSession(sessionId);
        assert.equal((await post("review-cohort")).status, 404);
        assert.equal((await post("review-responses", {
          entryId: context.entryId, verdict: "approved",
        })).status, 404);
        assert.equal((await storage.getSession(sessionId))!.reviewCohort, null);
        assert.deepEqual(await storage.getSessionReviewResponses(sessionId), []);
      }
    });

    test("aggregates exclude trash and revoked memberships, preserve live totals, and restore visibility", async () => {
      const caller = `stats-viewer-${randomUUID()}`;
      const owner = `stats-owner-${randomUUID()}`;
      const editor = `stats-editor-${randomUUID()}`;
      async function addSession(sessionOwner: string, members: Array<{ userId: string; role: string }>) {
        const [session] = await db.insert(countingSessions).values({
          userId: sessionOwner, name: `Stats ${randomUUID()}`,
        }).returning();
        for (const member of members) {
          await db.insert(sessionCollaborators).values({ sessionId: session.id, ...member });
        }
        for (const [index, contributor] of [sessionOwner, ...members.map(m => m.userId)].entries()) {
          await db.insert(entries).values({
            sessionId: session.id, userId: contributor, aisle: "S", section: "1",
            footage: (index + 1) * 100, reelCount: index + 2,
          });
          await db.insert(photos).values({
            sessionId: session.id, userId: contributor, objectStorageKey: `/uploads/stats-${randomUUID()}.jpg`,
          });
        }
        return session;
      }
      const aggregates = async () => ({
        performance: await storage.getSharedSessionPerformance(caller),
        roles: await storage.getRoleComparisonStats(caller),
      });

      const active = await addSession(owner, [
        { userId: editor, role: "editor" }, { userId: caller, role: "viewer" },
      ]);
      const baseline = await aggregates();
      assert.equal(baseline.performance.length, 1);
      assert.equal(baseline.performance[0].sessionId, active.id);
      assert.equal(baseline.performance[0].sessionName, active.name);
      assert.deepEqual(
        baseline.performance[0].contributors.map(c => ({
          userId: c.userId, entries: c.entryCount, photos: c.photoCount, reels: c.reelCount, footage: c.footage,
        })).sort((a, b) => a.userId.localeCompare(b.userId)),
        [
          { userId: owner, entries: 1, photos: 1, reels: 2, footage: 100 },
          { userId: editor, entries: 1, photos: 1, reels: 3, footage: 200 },
          { userId: caller, entries: 1, photos: 1, reels: 4, footage: 300 },
        ].sort((a, b) => a.userId.localeCompare(b.userId)),
      );
      assert.deepEqual(baseline.roles, {
        Owner: { entries: 1, photos: 1, reels: 2, footage: 100 },
        Editor: { entries: 1, photos: 1, reels: 3, footage: 200 },
        Viewer: { entries: 1, photos: 1, reels: 4, footage: 300 },
        currentUserRoles: ["Viewer"],
      });

      const withdrawn = await addSession(`withdrawn-owner-${randomUUID()}`, [{ userId: caller, role: "editor" }]);
      const beforeTrash = await aggregates();
      assert.equal(beforeTrash.performance.length, 2);
      assert.ok(beforeTrash.roles.Editor.entries > baseline.roles.Editor.entries);
      await storage.softDeleteSession(withdrawn.id);
      assert.equal((await storage.getSessionCollaborators(withdrawn.id)).length, 1,
        "trash must not depend on removing collaborator rows");
      assert.deepEqual(await aggregates(), baseline, "no hidden session metadata, contributors, inventory, or roles");
      await storage.restoreSession(withdrawn.id);
      assert.deepEqual(await aggregates(), beforeTrash, "restoring the session restores legitimate aggregate access");
      await db.delete(sessionCollaborators).where(eq(sessionCollaborators.sessionId, withdrawn.id));
      assert.deepEqual(await aggregates(), baseline, "revocation excludes even restored sessions");

      const owned = await addSession(caller, [{ userId: editor, role: "editor" }]);
      assert.equal((await aggregates()).performance.length, 2);
      await storage.softDeleteSession(owned.id);
      assert.deepEqual(await aggregates(), baseline, "owned trash must not enter the aggregate session set either");

      await storage.softDeleteSession(active.id);
      assert.deepEqual(await aggregates(), {
        performance: [],
        roles: {
          Owner: { entries: 0, footage: 0, reels: 0, photos: 0 },
          Editor: { entries: 0, footage: 0, reels: 0, photos: 0 },
          Viewer: { entries: 0, footage: 0, reels: 0, photos: 0 },
          currentUserRoles: [],
        },
      }, "an empty accessible session set returns no aggregates");
    });
  });
}
