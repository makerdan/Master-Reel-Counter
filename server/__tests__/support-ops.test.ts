import test from "node:test";
import assert from "node:assert/strict";
import { HELP_ARTICLES, HELP_CONTENT_VERSION, HELP_SOURCE_TEXT } from "@shared/help-content";
import { ownerOnly } from "../replit_integrations/auth/routes";
import { findHardcodedPortReferences } from "../../scripts/port-reference-scan.mjs";

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
  assert.equal(findHardcodedPortReferences("app.listen(5000)")[0], "listen(5000");
  assert.deepEqual(findHardcodedPortReferences("app.listen(Number(process.env.PORT || 5000)); app.listen(0)"), []);
});