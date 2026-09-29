import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

const rosterPath = "docs/validation/reviewers.json";
const referencePattern = /^docs\/validation\/reviews\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.json$/;
const blocked = (reason) => { throw new Error(`FAILURE-GATE BLOCKED: ${reason}`); };
const digest = (value) => createHash("sha256").update(
  typeof value === "string" ? value : JSON.stringify(value),
).digest("hex");

function trackedJson(root, reference, limit, sourceCommit) {
  const path = resolve(root, reference);
  const rel = relative(root, path);
  if (rel !== reference || rel.startsWith(`..${sep}`) || !existsSync(path) ||
      !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() ||
      realpathSync(path) !== path || lstatSync(path).size > limit) {
    blocked("review source is missing or unsafe");
  }
  let bytes;
  let data;
  try {
    const committed = execFileSync("git", ["-C", root, "show", `${sourceCommit}:${reference}`],
      { timeout: 5000, maxBuffer: limit + 1024 });
    const working = readFileSync(path);
    if (committed.length > limit || !working.equals(committed)) {
      blocked("review source differs from its committed Git content");
    }
    bytes = committed.toString("utf8");
    data = JSON.parse(bytes);
  } catch (error) {
    if (error.message?.includes("differs from its committed")) throw error;
    blocked("review source is not a readable committed Git record");
  }
  // A canonical representation rejects duplicate keys that could be displayed
  // differently by a reviewer and the JSON parser.
  if (!data || Array.isArray(data) || typeof data !== "object" ||
      bytes !== `${JSON.stringify(data, null, 2)}\n`) {
    blocked("review source must be canonical JSON without duplicate keys");
  }
  return { data, bytes };
}

export function createTrackedReviewControl({ root }) {
  root = realpathSync(root);
  return {
    review(request) {
      const { reference, action, subject, subjectDigest, scope, namespace } = request;
      if (typeof reference !== "string" || !referencePattern.test(reference)) {
        blocked("review reference must identify a tracked project review record");
      }
      let sourceCommit;
      try {
        sourceCommit = execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"],
          { timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (!/^[a-f0-9]{40,64}$/.test(sourceCommit)) blocked("review source commit invalid");
      } catch {
        blocked("review source has no committed project revision");
      }
      const roster = trackedJson(root, rosterPath, 32768, sourceCommit).data;
      if (roster.version !== 1 || !Array.isArray(roster.reviewers) ||
          roster.reviewers.length === 0 || !roster.reviewers.every((id) =>
            typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) ||
          new Set(roster.reviewers).size !== roster.reviewers.length) {
        blocked("designated human reviewer roster is unavailable");
      }
      const { data: record, bytes } = trackedJson(root, reference, 2 * 1024 * 1024, sourceCommit);
      if (record.version !== 1 || record.reference !== reference ||
          record.namespace !== namespace || record.action !== action ||
          record.decision !== "approved" || !roster.reviewers.includes(record.reviewer) ||
          typeof record.reviewedAt !== "string" ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.reviewedAt) ||
          Number.isNaN(Date.parse(record.reviewedAt)) ||
          new Date(record.reviewedAt).toISOString() !== record.reviewedAt ||
          !isDeepStrictEqual(record.subject, subject) ||
          record.subjectDigest !== subjectDigest ||
          digest(record.subject) !== subjectDigest ||
          !isDeepStrictEqual(record.scope, scope)) {
        blocked("review record does not bind the exact authorized decision");
      }
      return { reference, recordReference: reference, recordDigest: digest(bytes),
        sourceCommit, reviewer: record.reviewer, namespace, action, subjectDigest, scope };
    },
  };
}