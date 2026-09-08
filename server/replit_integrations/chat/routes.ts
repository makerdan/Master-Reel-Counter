import type { Express, Request, Response } from "express";
import { chatStorage } from "./storage";
import { isAuthenticated } from "../auth/replitAuth";
import { getPoeProvider, PoeProviderError, type PoeTextMessage } from "../../providers/poe";

export function registerChatRoutes(app: Express): void {
  // Get all conversations
  app.get("/api/conversations", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.claims.sub as string;
      const conversations = await chatStorage.getAllConversations(userId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get single conversation with messages
  app.get("/api/conversations/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const userId = (req as any).user.claims.sub as string;
      const conversation = await chatStorage.getConversation(id, userId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const messages = await chatStorage.getMessagesByConversation(id);
      res.json({ ...conversation, messages });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Create new conversation
  app.post("/api/conversations", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { title } = req.body;
      const userId = (req as any).user.claims.sub as string;
      const conversation = await chatStorage.createConversation(userId, title || "New Chat");
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // Delete conversation
  app.delete("/api/conversations/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      const userId = (req as any).user.claims.sub as string;
      await chatStorage.deleteConversation(id, userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Send message and get AI response (streaming)
  app.post("/api/conversations/:id/messages", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const conversationId = parseInt(String(req.params.id));
      const userId = (req as any).user.claims.sub as string;
      const { content } = req.body;
      if (typeof content !== "string" || content.trim().length === 0 || content.length > 1200) {
        return res.status(400).json({ error: "Message content is required and must be at most 1200 characters" });
      }
      if (!(await chatStorage.getConversation(conversationId, userId))) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Save user message
      await chatStorage.createMessage(conversationId, "user", content.trim());

      // Get conversation history for context
      const messages = await chatStorage.getMessagesByConversation(conversationId);
      const chatMessages: PoeTextMessage[] = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let aborted = false;
      const requestAbort = new AbortController();
      let providerStream: Awaited<ReturnType<ReturnType<typeof getPoeProvider>["streamText"]>> | undefined;
      req.on("close", () => {
        aborted = true;
        requestAbort.abort();
        providerStream?.abort();
      });

      providerStream = await getPoeProvider().streamText({
        messages: chatMessages,
        useCase: "help-chat",
        maxTokens: 2048,
        signal: requestAbort.signal,
        userId,
      });

      let fullResponse = "";

      for await (const content of providerStream.stream) {
        if (aborted) break;
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }

      // Save assistant message
      if (!aborted) await chatStorage.createMessage(conversationId, "assistant", fullResponse);

      if (!aborted) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    } catch (error) {
      console.error("Error sending message:", error instanceof PoeProviderError ? error.code : "unknown error");
      // Check if headers already sent (SSE streaming started)
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: "Failed to send message" })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    }
  });
}

