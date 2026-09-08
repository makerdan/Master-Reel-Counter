import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePoeError,
  parsePoeModelsResponse,
  PoeProviderError,
  createPoeProvider,
  selectPoeModel,
  validateVisionLabels,
} from "../providers/poe.js";

const previousCapabilities = process.env.POE_MODEL_CAPABILITIES_JSON;

afterEach(() => {
  if (previousCapabilities === undefined) delete process.env.POE_MODEL_CAPABILITIES_JSON;
  else process.env.POE_MODEL_CAPABILITIES_JSON = previousCapabilities;
});

describe("Poe live model registry", () => {
  test("rejects malformed catalogue rows and preserves only known capabilities", () => {
    process.env.POE_MODEL_CAPABILITIES_JSON = JSON.stringify({
      "live-vision-model": ["vision-json", "invented-capability"],
    });
    const models = parsePoeModelsResponse({
      data: [
        { id: "live-text-model", capabilities: ["text-chat-stream"] },
        { id: "live-vision-model" },
        { id: 42 },
        { capabilities: ["text-chat-stream"] },
      ],
    });

    assert.deepEqual(models.map((model) => ({ id: model.id, capabilities: model.capabilities })), [
      { id: "live-text-model", capabilities: ["text-chat-stream"] },
      { id: "live-vision-model", capabilities: ["vision-json"] },
    ]);
  });

  test("fails closed for unknown capability claims", () => {
    const models = parsePoeModelsResponse({ data: [{ id: "live-unknown", capabilities: ["vision"] }] });
    assert.throws(
      () => selectPoeModel(models, "vision-json"),
      (error: unknown) => error instanceof PoeProviderError && error.code === "capability",
    );
  });

  test("selects an exact live model deterministically", () => {
    const models = parsePoeModelsResponse({
      data: [
        { id: "z-model", capabilities: ["text-chat-stream"] },
        { id: "a-model", capabilities: ["text-chat-stream"] },
      ],
    });
    assert.equal(selectPoeModel(models, "text-chat-stream").id, "a-model");
  });
});

describe("Poe response and error contracts", () => {
  test("fails clearly when the server-only key is missing", async () => {
    const previousKey = process.env.POE_API_KEY;
    delete process.env.POE_API_KEY;
    try {
      await assert.rejects(
        () => createPoeProvider().listModels(),
        (error: unknown) => error instanceof PoeProviderError && error.code === "configuration",
      );
    } finally {
      if (previousKey === undefined) delete process.env.POE_API_KEY;
      else process.env.POE_API_KEY = previousKey;
    }
  });

  test("requires exactly one structured label per crop", () => {
    assert.deepEqual(validateVisionLabels('{"labels":["A",""]}', 2), ["A", ""]);
    assert.throws(
      () => validateVisionLabels('{"labels":["A"]}', 2),
      (error: unknown) => error instanceof PoeProviderError && error.code === "validation",
    );
    assert.throws(
      () => validateVisionLabels('{"labels":[{"raw":"A"}]}', 1),
      (error: unknown) => error instanceof PoeProviderError && error.code === "validation",
    );
  });

  test("normalizes provider failures without retaining upstream details", () => {
    const error = normalizePoeError({ status: 429, message: "secret provider body" }, 1);
    assert.equal(error.code, "rate_limit");
    assert.equal(error.statusCode, 503);
    assert.equal(error.retries, 1);
    assert.equal(error.message.includes("secret provider body"), false);
    assert.equal(normalizePoeError({ status: 401 }).code, "authentication");
    assert.equal(normalizePoeError({ status: 402 }).code, "quota");
    assert.equal(normalizePoeError({ status: 404 }).code, "model");
  });
});