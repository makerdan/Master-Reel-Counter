import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { pool } from "../db.js";
import {
  getCurrentPdfJobAccess,
  invalidatePdfJobsForUser,
  resolvePdfJobDownload,
  type PdfExportJob,
} from "../routes.js";

after(async () => {
  await pool.end().catch(() => {});
});

describe("PDF export authorization", () => {
  test("re-checks current session access for an existing job", async () => {
    const job = { userId: "revoked-collaborator", sessionId: 42 };
    const accessChecks: Array<[number, string]> = [];

    const accessBeforeRevocation = await getCurrentPdfJobAccess(
      job,
      42,
      "revoked-collaborator",
      async (sessionId, userId) => {
        accessChecks.push([sessionId, userId]);
        return { role: "viewer" };
      },
    );
    assert.deepEqual(accessBeforeRevocation, { role: "viewer" });

    const accessAfterRevocation = await getCurrentPdfJobAccess(
      job,
      42,
      "revoked-collaborator",
      async (sessionId, userId) => {
        accessChecks.push([sessionId, userId]);
        return null;
      },
    );
    assert.equal(accessAfterRevocation, null);
    assert.deepEqual(accessChecks, [
      [42, "revoked-collaborator"],
      [42, "revoked-collaborator"],
    ]);
  });

  test("does not authorize a job for another session or identity", async () => {
    let accessCheckerCalled = false;
    const accessChecker = async () => {
      accessCheckerCalled = true;
      return { role: "owner" };
    };

    assert.equal(
      await getCurrentPdfJobAccess(
        { userId: "user-1", sessionId: 42 },
        43,
        "user-1",
        accessChecker,
      ),
      null,
    );
    assert.equal(
      await getCurrentPdfJobAccess(
        { userId: "user-1", sessionId: 42 },
        42,
        "user-2",
        accessChecker,
      ),
      null,
    );
    assert.equal(accessCheckerCalled, false);
  });

  test("returns a completed PDF while the requester still has access", async () => {
    const pdf = Buffer.from("authorized export");
    const jobs = new Map<string, PdfExportJob>([
      ["authorized-job", {
        done: 1,
        total: 1,
        complete: true,
        buffer: pdf,
        filename: "session-export.pdf",
        createdAt: Date.now(),
        userId: "active-collaborator",
        sessionId: 42,
      }],
    ]);

    const result = await resolvePdfJobDownload(
      jobs,
      "authorized-job",
      42,
      "active-collaborator",
      async () => ({ role: "viewer" }),
    );

    assert.deepEqual(result, {
      kind: "ready",
      buffer: pdf,
      filename: "session-export.pdf",
    });
  });

  test("does not return a completed PDF after collaborator access is revoked", async () => {
    const collaboratorPdf = Buffer.from("completed collaborator export");
    const ownerPdf = Buffer.from("owner export");
    const jobs = new Map<string, PdfExportJob>([
      ["collaborator-job", {
        done: 1,
        total: 1,
        complete: true,
        buffer: collaboratorPdf,
        createdAt: Date.now(),
        userId: "revoked-collaborator",
        sessionId: 42,
      }],
      ["owner-job", {
        done: 1,
        total: 1,
        complete: true,
        buffer: ownerPdf,
        createdAt: Date.now(),
        userId: "session-owner",
        sessionId: 42,
      }],
    ]);

    const result = await resolvePdfJobDownload(
      jobs,
      "collaborator-job",
      42,
      "revoked-collaborator",
      async () => null,
    );

    assert.deepEqual(result, { kind: "not_found" });
    assert.equal(jobs.has("collaborator-job"), false);
    assert.equal(jobs.get("owner-job")?.buffer, ownerPdf);
  });

  test("account authorization cleanup removes only that user's PDF jobs across sessions", () => {
    const jobs = new Map<string, PdfExportJob>([
      ["revoked-completed", {
        done: 1,
        total: 1,
        complete: true,
        buffer: Buffer.from("revoked account export"),
        createdAt: Date.now(),
        userId: "revoked-account",
        sessionId: 42,
      }],
      ["revoked-in-progress", {
        done: 0,
        total: 1,
        complete: false,
        createdAt: Date.now(),
        userId: "revoked-account",
        sessionId: 84,
      }],
      ["another-user-same-session", {
        done: 1,
        total: 1,
        complete: true,
        buffer: Buffer.from("another user's export"),
        createdAt: Date.now(),
        userId: "another-user",
        sessionId: 42,
      }],
      ["another-user-other-session", {
        done: 0,
        total: 1,
        complete: false,
        createdAt: Date.now(),
        userId: "another-user",
        sessionId: 99,
      }],
    ]);

    assert.equal(invalidatePdfJobsForUser(jobs, "revoked-account"), 2);
    assert.deepEqual([...jobs.keys()], [
      "another-user-same-session",
      "another-user-other-session",
    ]);
  });
});