import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import http from "node:http";
import { limitHelpChatMessages } from "@shared/help-chat";
import { createHelpChatHandler } from "../routes.js";
import type { PoeProvider, PoeTextMessage } from "../providers/poe.js";

function stubProvider(
  onMessages: (messages: PoeTextMessage[]) => void,
): PoeProvider {
  return {
    listModels: async () => [],
    streamText: async ({ messages }) => {
      onMessages(messages);
      return {
        model: "stub-text",
        retries: 0,
        usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
        stream: (async function* () {
          yield "bounded response";
        })(),
        abort: () => {},
      };
    },
    completeVision: async () => ({
      model: "stub-vision",
      retries: 0,
      labels: ["stub"],
    }),
  };
}

async function withHelpRoute<T>(
  provider: PoeProvider,
  callback: (port: number) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.post(
    "/api/help-chat",
    (req, _res, next) => {
      (req as typeof req & { user: { claims: { sub: string } } }).user = {
        claims: { sub: "help-chat-test-user" },
      };
      next();
    },
    createHelpChatHandler(provider, "stub help prompt"),
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    return await callback(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function makeHistory(pairCount: number, currentQuestion: string) {
  const messageOfLength = (label: string, fill: string) =>
    `${label}${fill.repeat(1200 - label.length)}`;
  const messages = Array.from({ length: pairCount }, (_, index) => [
    { role: "user", content: messageOfLength(`question-${index}:`, "q") },
    { role: "assistant", content: messageOfLength(`answer-${index}:`, "a") },
  ]).flat();
  messages.push({ role: "user", content: currentQuestion });
  return messages;
}

async function submitMessages(port: number, messages: unknown[]) {
  const response = await fetch(`http://127.0.0.1:${port}/api/help-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  assert.equal(response.status, 200);
  await response.text();
}

test("bounds provider history while retaining a pasted current question", async () => {
  let providerMessages: PoeTextMessage[] = [];
  const provider = stubProvider((messages) => {
    providerMessages = messages;
  });

  await withHelpRoute(provider, async (port) => {
    await submitMessages(port, makeHistory(20, `current ${"q".repeat(3000)}`));
  });

  const history = providerMessages.slice(1);
  assert.ok(history.length > 0, "the provider receives the current question");
  assert.equal(history.at(-1)?.role, "user");
  assert.equal(history.at(-1)?.content.length, 1200);
  assert.ok(history.at(-1)?.content.startsWith("current "));
  assert.ok(
    history.reduce((total, message) => total + message.content.length, 0) <= 8_000,
    "the complete conversational history, including the current question, stays within the budget",
  );
  assert.ok(history.length <= 12);
});

test("trims history only at complete user/assistant exchange boundaries", async () => {
  let providerMessages: PoeTextMessage[] = [];
  const provider = stubProvider((messages) => {
    providerMessages = messages;
  });

  await withHelpRoute(provider, async (port) => {
    await submitMessages(port, makeHistory(20, "current question"));
  });

  const history = providerMessages.slice(1);
  assert.deepEqual(
    history.map(({ role }) => role),
    ["user", "assistant", "user", "assistant", "user", "assistant", "user"],
  );
  assert.ok(history[0].content.startsWith("question-17:"));
  assert.ok(history[1].content.startsWith("answer-17:"));
  assert.ok(history[2].content.startsWith("question-18:"));
  assert.ok(history[3].content.startsWith("answer-18:"));
  assert.ok(history[4].content.startsWith("question-19:"));
  assert.ok(history[5].content.startsWith("answer-19:"));
  assert.equal(history[6].content, "current question");
});

test("client transcript trimming removes whole exchanges and keeps the active question", () => {
  const transcript = Array.from({ length: 60 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `${index % 2 === 0 ? "question" : "answer"}-${index}`,
  }));

  const restored = limitHelpChatMessages(transcript, 50);
  assert.equal(restored.length, 50);
  assert.equal(restored[0].content, "question-10");
  assert.equal(restored.at(-1)?.content, "answer-59");

  const pending = limitHelpChatMessages(
    [...restored, { role: "user" as const, content: "current question" }],
    50,
  );
  assert.equal(pending.length, 49);
  assert.equal(pending[0].content, "question-12");
  assert.equal(pending.at(-1)?.content, "current question");
  assert.deepEqual(
    pending.map(({ role }) => role),
    Array.from({ length: 24 }, () => ["user", "assistant"]).flat().concat("user"),
  );
});