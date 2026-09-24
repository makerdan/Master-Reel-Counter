import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePoeError,
  parsePoeModelsResponse,
  getPoeHealthStatus,
  getPoeModelHealth,
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
  test("reports only the supported models from the live catalogue", () => {
    const models = parsePoeModelsResponse({
      data: [
        { id: "Gemini-3.1-Pro", capabilities: ["text-chat-stream"] },
        { id: "unrelated-provider-model", capabilities: ["text-chat-stream", "vision-json"] },
        { id: "Claude-Sonnet-4.5" },
      ],
    });

    assert.deepEqual(getPoeModelHealth(models), [
      { id: "Gemini-3.1-Pro", label: "Gemini 3.1 Pro", available: true },
      { id: "Claude-Sonnet-4.5", label: "Claude Sonnet 4.5", available: true },
    ]);
  });

  test("keeps each supported model status independent", () => {
    const models = parsePoeModelsResponse({
      data: [{ id: "Gemini-3.1-Pro" }, { id: "unrelated-provider-model" }],
    });

    assert.deepEqual(getPoeModelHealth(models).map((model) => model.available), [true, false]);
  });

  test("does not let catalogue or environment capability claims authorize unknown IDs", () => {
    process.env.POE_MODEL_CAPABILITIES_JSON = JSON.stringify({
      "live-vision-model": ["vision-json", "invented-capability"],
      "Gemini-3.1-Pro": ["vision-json", "invented-capability"],
    });
    const models = parsePoeModelsResponse({
      data: [
        { id: "Gemini-3.1-Pro", capabilities: ["text-chat-stream"] },
        { id: "live-vision-model" },
        { id: 42 },
        { capabilities: ["text-chat-stream"] },
      ],
    });

    assert.deepEqual(models.map((model) => ({ id: model.id, capabilities: model.capabilities })), [
      { id: "Gemini-3.1-Pro", capabilities: ["text-chat-stream", "vision-json"] },
    ]);
  });

  test("fails closed for unknown capability claims", () => {
    const models = parsePoeModelsResponse({ data: [{ id: "Gemini-3.1-Pro", capabilities: ["vision"] }] });
    assert.throws(
      () => selectPoeModel(models, "vision-json"),
      (error: unknown) => error instanceof PoeProviderError && error.code === "capability",
    );
    assert.throws(
      () => selectPoeModel([
        { id: "unapproved-model", capabilities: ["vision-json"], privacyClass: "approved" },
      ], "vision-json"),
      (error: unknown) => error instanceof PoeProviderError && error.code === "capability",
    );
  });

  test("selects an exact live model deterministically", () => {
    const models = parsePoeModelsResponse({
      data: [
        { id: "Gemini-3.1-Pro", capabilities: ["text-chat-stream"] },
        { id: "Claude-Sonnet-4.5", capabilities: ["text-chat-stream"] },
      ],
    });
    assert.equal(selectPoeModel(models, "text-chat-stream").id, "Claude-Sonnet-4.5");
    assert.equal(
      selectPoeModel(models, "text-chat-stream", "Gemini-3.1-Pro").id,
      "Gemini-3.1-Pro",
    );
    assert.throws(
      () => selectPoeModel(models, "text-chat-stream", "unapproved-model"),
      (error: unknown) => error instanceof PoeProviderError && error.code === "model",
    );
  });
});

describe("Poe response and error contracts", () => {
  test("keeps API health separate from model availability", async () => {
    const healthyApiWithMissingModels = await getPoeHealthStatus({
      listModels: async () => [{ id: "unrelated-provider-model", capabilities: [], privacyClass: "approved" }],
      streamText: async () => {
        throw new Error("not used");
      },
      completeVision: async () => {
        throw new Error("not used");
      },
    });
    assert.equal(healthyApiWithMissingModels.apiOnline, true);
    assert.deepEqual(healthyApiWithMissingModels.models.map((model) => model.available), [false, false]);

    const providerFailure = await getPoeHealthStatus({
      listModels: async () => {
        throw new PoeProviderError("upstream", "Poe is temporarily unavailable.", 502);
      },
      streamText: async () => {
        throw new Error("not used");
      },
      completeVision: async () => {
        throw new Error("not used");
      },
    });
    assert.equal(providerFailure.apiOnline, false);
    assert.deepEqual(providerFailure.models.map((model) => model.available), [false, false]);
  });

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