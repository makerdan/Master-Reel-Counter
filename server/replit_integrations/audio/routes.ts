import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import { chatStorage, type IChatStorage } from "../chat/storage";
import {
  openai,
  speechToText,
  ensureCompatibleFormat,
  withAudioProviderRetry,
} from "./client";
import { isAuthenticated } from "../auth/replitAuth";
import { isApprovedReplitAiModel, REPLIT_AI_MODELS } from "../../providers/approved-models";

const audioBodyParser = express.json({ limit: "50mb" });

const AUDIO_VOICES = new Set(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]);
type AudioVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
type ConversationMessage = { role: "user" | "assistant"; content: string };
type AudioStreamChunk = {
  choices?: Array<{
    delta?: {
      audio?: { transcript?: string; data?: string };
    };
  }>;
};

type AudioRouteDependencies = {
  authenticate: RequestHandler;
  storage: IChatStorage;
  convertAudio: typeof ensureCompatibleFormat;
  transcribe: typeof speechToText;
  createAudioStream: (args: {
    messages: ConversationMessage[];
    voice: AudioVoice;
    signal: AbortSignal;
  }) => Promise<AsyncIterable<AudioStreamChunk>>;
};

function createAudioStream(args: {
  messages: ConversationMessage[];
  voice: AudioVoice;
  signal: AbortSignal;
}): Promise<AsyncIterable<AudioStreamChunk>> {
  return withAudioProviderRetry(args.signal, (signal) =>
    openai.chat.completions.create({
      model: REPLIT_AI_MODELS.audioResponse,
      modalities: ["text", "audio"],
      audio: { voice: args.voice, format: "pcm16" },
      messages: args.messages,
      stream: true,
    }, { signal, maxRetries: 0 })) as unknown as Promise<AsyncIterable<AudioStreamChunk>>;
}


export function registerAudioRoutes(
  app: Express,
  overrides: Partial<AudioRouteDependencies> = {},
): void {
  const dependencies: AudioRouteDependencies = {
    authenticate: isAuthenticated,
    storage: chatStorage,
    convertAudio: ensureCompatibleFormat,
    transcribe: speechToText,
    createAudioStream,
    ...overrides,
  };
  const { authenticate, storage } = dependencies;

  app.get("/api/conversations", authenticate, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.claims.sub as string;
      res.json(await storage.getAllConversations(userId));
    } catch {
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/conversations/:id", authenticate, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const userId = (req as any).user.claims.sub as string;
      const conversation = await storage.getConversation(id, userId);
      if (!conversation) return res.status(404).json({ error: "Conversation not found" });
      const messages = await storage.getMessagesByConversation(id);
      res.json({ ...conversation, messages });
    } catch {
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  app.post("/api/conversations", authenticate, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.claims.sub as string;
      const conversation = await storage.createConversation(userId, req.body?.title || "New Chat");
      res.status(201).json(conversation);
    } catch {
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  app.delete("/api/conversations/:id", authenticate, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.claims.sub as string;
      await storage.deleteConversation(Number(req.params.id), userId);
      res.status(204).send();
    } catch {
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  app.post(
    "/api/conversations/:id/messages",
    authenticate,
    audioBodyParser,
    async (req: Request, res: Response) => {
      const requestAbort = new AbortController();
      const abortForDisconnect = () => {
        if (res.writableEnded) return;
        requestAbort.abort();
      };
      req.once("aborted", abortForDisconnect);
      res.once("close", abortForDisconnect);

      try {
        const conversationId = Number(req.params.id);
        const userId = (req as any).user.claims.sub as string;
        const { audio, voice = "alloy", model } = req.body ?? {};

        if (model !== undefined &&
          (typeof model !== "string" || !isApprovedReplitAiModel("audioResponse", model))) {
          return res.status(400).json({ error: "Unsupported audio model" });
        }
        if (typeof audio !== "string" || audio.length === 0) {
          return res.status(400).json({ error: "Audio data (base64) is required" });
        }
        if (typeof voice !== "string" || !AUDIO_VOICES.has(voice)) {
          return res.status(400).json({ error: "Unsupported audio voice" });
        }

        if (!(await storage.getConversation(conversationId, userId))) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        if (requestAbort.signal.aborted) return;

        const rawBuffer = Buffer.from(audio, "base64");
        const { buffer: audioBuffer, format: inputFormat } =
          await dependencies.convertAudio(rawBuffer, requestAbort.signal);
        if (requestAbort.signal.aborted) return;

        const userTranscript = await dependencies.transcribe(
          audioBuffer,
          inputFormat,
          requestAbort.signal,
        );
        if (requestAbort.signal.aborted) return;

        await storage.createMessage(conversationId, "user", userTranscript);
        if (requestAbort.signal.aborted) return;
        const existingMessages = await storage.getMessagesByConversation(conversationId);
        if (requestAbort.signal.aborted) return;
        const chatHistory: ConversationMessage[] = existingMessages.map((message) => ({
          role: message.role as ConversationMessage["role"],
          content: message.content,
        }));

        if (requestAbort.signal.aborted) return;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.write(`data: ${JSON.stringify({ type: "user_transcript", data: userTranscript })}\n\n`);
        if (requestAbort.signal.aborted) return;

        const stream = await dependencies.createAudioStream({
          messages: chatHistory,
          voice: voice as AudioVoice,
          signal: requestAbort.signal,
        });
        if (requestAbort.signal.aborted) return;

        let assistantTranscript = "";
        for await (const chunk of stream) {
          if (requestAbort.signal.aborted) break;
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.audio?.transcript) {
            assistantTranscript += delta.audio.transcript;
            res.write(`data: ${JSON.stringify({ type: "transcript", data: delta.audio.transcript })}\n\n`);
          }
          if (delta?.audio?.data) {
            res.write(`data: ${JSON.stringify({ type: "audio", data: delta.audio.data })}\n\n`);
          }
        }

        if (requestAbort.signal.aborted) return;
        await storage.createMessage(conversationId, "assistant", assistantTranscript);
        res.write(`data: ${JSON.stringify({ type: "done", transcript: assistantTranscript })}\n\n`);
        res.end();
      } catch (error) {
        if (requestAbort.signal.aborted || res.destroyed || res.writableEnded) return;
        console.error("Error processing voice message:", error instanceof Error ? error.name : "unknown error");
        if (res.headersSent) {
          res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to process voice message" })}\n\n`);
          res.end();
        } else {
          res.status(500).json({ error: "Failed to process voice message" });
        }
      } finally {
        req.removeListener("aborted", abortForDisconnect);
        res.removeListener("close", abortForDisconnect);
        requestAbort.abort();
      }
    },
  );
}