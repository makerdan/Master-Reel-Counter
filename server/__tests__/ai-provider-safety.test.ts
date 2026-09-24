import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import express, { type RequestHandler } from "express";
import { describe, test } from "node:test";
import { registerAudioRoutes } from "../replit_integrations/audio/routes.js";
import { openai, speechToText } from "../replit_integrations/audio/client.js";
import { registerImageRoutes } from "../replit_integrations/image/routes.js";
import type { IChatStorage } from "../replit_integrations/chat/storage.js";
import { REPLIT_AI_MODELS } from "../providers/approved-models.js";
import { createHelpChatHandler } from "../routes.js";
import type { PoeProvider } from "../providers/poe.js";

const authenticatedUser: RequestHandler = (req, _res, next) => {
  (req as typeof req & { user: { claims: { sub: string } } }).user = {
    claims: { sub: "ai-safety-test-user" },
  };
  next();
};

function createStorage(savedMessages: Array<{ role: string; content: string }> = []): IChatStorage {
  const conversation = { id: 1, userId: "ai-safety-test-user", title: "Audio test" } as any;
  return {
    getConversation: async (id, userId) =>
      id === 1 && userId === "ai-safety-test-user" ? conversation : undefined,
    getAllConversations: async () => [conversation],
    createConversation: async () => conversation,
    deleteConversation: async () => {},
    getMessagesByConversation: async () => savedMessages as any,
    createMessage: async (_id, role, content) => {
      const message = { role, content };
      savedMessages.push(message);
      return message as any;
    },
  };
}

async function withServer<T>(app: express.Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

describe("AI provider API safety", () => {
  test("aborting during an audio provider retry wait prevents another attempt", async () => {
    const originalFetch = openai.fetch;
    const controller = new AbortController();
    let firstAttemptStarted!: () => void;
    const firstAttempt = new Promise<void>((resolve) => { firstAttemptStarted = resolve; });
    let errorBodyRead!: () => void;
    const providerErrorRead = new Promise<void>((resolve) => { errorBodyRead = resolve; });
    let providerAttempts = 0;

    openai.fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "data:,") return new Response("form-data probe");
      providerAttempts++;
      firstAttemptStarted();
      const response = new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "x-should-retry": "true",
          "retry-after-ms": "5000",
        },
      });
      const readResponseText = response.text.bind(response);
      response.text = async () => {
        const text = await readResponseText();
        errorBodyRead();
        return text;
      };
      return response;
    };

    try {
      const transcription = speechToText(Buffer.from("test audio"), "wav", controller.signal);
      await firstAttempt;
      let errorReadTimeout: NodeJS.Timeout | undefined;
      await Promise.race([
        providerErrorRead,
        new Promise((_, reject) => {
          errorReadTimeout = setTimeout(() => reject(new Error("provider error was not handled")), 1000);
        }),
      ]).finally(() => {
        if (errorReadTimeout) clearTimeout(errorReadTimeout);
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      controller.abort();
      await assert.rejects(transcription);
      assert.equal(providerAttempts, 1);
    } finally {
      controller.abort();
      openai.fetch = originalFetch;
    }
  });

  test("help chat rejects unapproved model IDs before forwarding customer messages", async () => {
    const app = express();
    app.use(express.json());
    const selectedModels: Array<string | undefined> = [];
    const provider: PoeProvider = {
      listModels: async () => [],
      streamText: async ({ modelId }) => {
        selectedModels.push(modelId);
        return {
          model: modelId ?? "default",
          retries: 0,
          usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
          stream: (async function* () { yield "safe response"; })(),
          abort: () => {},
        };
      },
      completeVision: async () => ({ model: "vision", retries: 0, labels: [] }),
    };
    app.post("/api/help-chat", authenticatedUser, createHelpChatHandler(provider, "test"));

    await withServer(app, async (baseUrl) => {
      const rejected = await fetch(`${baseUrl}/api/help-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "unapproved-model",
          messages: [{ role: "user", content: "private customer question" }],
        }),
      });
      assert.equal(rejected.status, 400);
      await rejected.arrayBuffer();
      assert.deepEqual(selectedModels, []);

      const accepted = await fetch(`${baseUrl}/api/help-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "Gemini-3.1-Pro",
          messages: [{ role: "user", content: "approved customer question" }],
        }),
      });
      assert.equal(accepted.status, 200);
      assert.match(await accepted.text(), /safe response/);
      assert.deepEqual(selectedModels, ["Gemini-3.1-Pro"]);
    });
  });

  test("rejects unapproved audio and image models before sending customer content", async () => {
    const app = express();
    app.use(express.json());
    let transcriptionCalls = 0;
    let audioGenerationCalls = 0;
    let imageGenerationCalls = 0;
    const imageModels: string[] = [];
    const savedMessages: Array<{ role: string; content: string }> = [];

    registerAudioRoutes(app, {
      authenticate: authenticatedUser,
      storage: createStorage(savedMessages),
      convertAudio: async (buffer) => ({ buffer, format: "wav" }),
      transcribe: async () => {
        transcriptionCalls++;
        return "private audio transcript";
      },
      createAudioStream: async () => {
        audioGenerationCalls++;
        return (async function* () {
          yield { choices: [{ delta: { audio: { transcript: "response", data: "pcm" } } }] };
        })();
      },
    });
    registerImageRoutes(app, {
      authenticate: authenticatedUser,
      generate: async ({ model }) => {
        imageGenerationCalls++;
        imageModels.push(model);
        return { data: [{ b64_json: "generated-image" }] };
      },
    });

    await withServer(app, async (baseUrl) => {
      const rejectedAudio = await fetch(`${baseUrl}/api/conversations/1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: "c2VjcmV0LWF1ZGlv", model: "unapproved-audio-model" }),
      });
      assert.equal(rejectedAudio.status, 400);
      await rejectedAudio.arrayBuffer();

      const rejectedImage = await fetch(`${baseUrl}/api/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "private image prompt", model: "unapproved-image-model" }),
      });
      assert.equal(rejectedImage.status, 400);
      await rejectedImage.arrayBuffer();

      assert.equal(transcriptionCalls, 0);
      assert.equal(audioGenerationCalls, 0);
      assert.equal(imageGenerationCalls, 0);
      assert.deepEqual(savedMessages, []);

      const acceptedImage = await fetch(`${baseUrl}/api/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "approved image prompt",
          model: REPLIT_AI_MODELS.imageGeneration,
        }),
      });
      assert.equal(acceptedImage.status, 200);
      assert.deepEqual(await acceptedImage.json(), { b64_json: "generated-image" });

      const acceptedAudio = await fetch(`${baseUrl}/api/conversations/1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: "c2FmZS1hdWRpbw==", model: REPLIT_AI_MODELS.audioResponse }),
      });
      assert.equal(acceptedAudio.status, 200);
      const body = await acceptedAudio.text();
      assert.match(body, /"type":"done"/);
      assert.equal(transcriptionCalls, 1);
      assert.equal(audioGenerationCalls, 1);
      assert.deepEqual(imageModels, [REPLIT_AI_MODELS.imageGeneration]);
      assert.deepEqual(savedMessages.map(({ role }) => role), ["user", "assistant"]);
    });
  });

  test("aborting during transcription prevents subsequent audio generation", async () => {
    const app = express();
    app.use(express.json());
    let transcriptionStarted!: () => void;
    const started = new Promise<void>((resolve) => { transcriptionStarted = resolve; });
    let transcriptionAborted = false;
    let generationCalls = 0;

    registerAudioRoutes(app, {
      authenticate: authenticatedUser,
      storage: createStorage(),
      convertAudio: async (buffer) => ({ buffer, format: "wav" }),
      transcribe: async (_buffer, _format, signal) => {
        transcriptionStarted();
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            transcriptionAborted = true;
            resolve();
          } else {
            signal?.addEventListener("abort", () => {
              transcriptionAborted = true;
              resolve();
            }, { once: true });
          }
        });
        throw new Error("transcription cancelled");
      },
      createAudioStream: async () => {
        generationCalls++;
        return (async function* () {})();
      },
    });

    await withServer(app, async (baseUrl) => {
      const controller = new AbortController();
      const responsePromise = fetch(`${baseUrl}/api/conversations/1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: "c2FmZS1hdWRpbw==" }),
        signal: controller.signal,
      });
      await started;
      controller.abort();
      await assert.rejects(responsePromise, (error: unknown) =>
        error instanceof Error && error.name === "AbortError",
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(transcriptionAborted, true);
      assert.equal(generationCalls, 0);
    });
  });

  test("aborting an audio stream cancels provider work and prevents assistant persistence", async () => {
    const app = express();
    app.use(express.json());
    const savedMessages: Array<{ role: string; content: string }> = [];
    let providerAborted!: () => void;
    const aborted = new Promise<void>((resolve) => { providerAborted = resolve; });
    let audioGenerationCalls = 0;
    let providerSignalAborted = false;

    registerAudioRoutes(app, {
      authenticate: authenticatedUser,
      storage: createStorage(savedMessages),
      convertAudio: async (buffer) => ({ buffer, format: "wav" }),
      transcribe: async () => "recognized user speech",
      createAudioStream: async ({ signal }) => {
        audioGenerationCalls++;
        signal.addEventListener("abort", () => {
          providerSignalAborted = true;
          providerAborted();
        }, { once: true });
        return (async function* () {
          yield { choices: [{ delta: { audio: { transcript: "partial reply", data: "pcm" } } }] };
          await aborted;
        })();
      },
    });

    await withServer(app, async (baseUrl) => {
      const controller = new AbortController();
      const response = await fetch(`${baseUrl}/api/conversations/1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: "c2FmZS1hdWRpbw==" }),
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      const reader = response.body?.getReader();
      assert.ok(reader);
      const decoder = new TextDecoder();
      let received = "";
      try {
        while (!received.includes('"type":"audio"')) {
          const { value, done } = await reader.read();
          if (done) break;
          received += decoder.decode(value, { stream: true });
        }
      } finally {
        controller.abort();
        await reader.cancel().catch(() => {});
      }
      let abortTimeout: NodeJS.Timeout | undefined;
      await Promise.race([
        aborted,
        new Promise((_, reject) => {
          abortTimeout = setTimeout(() => reject(new Error("provider did not abort")), 1000);
        }),
      ]).finally(() => {
        if (abortTimeout) clearTimeout(abortTimeout);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      assert.match(received, /"type":"audio"/);
      assert.doesNotMatch(received, /"type":"done"/);
      assert.equal(providerSignalAborted, true);
      assert.equal(audioGenerationCalls, 1);
      assert.deepEqual(savedMessages.map(({ role }) => role), ["user"]);
    });
  });
});