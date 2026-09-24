import type { Express, Request, RequestHandler, Response } from "express";
import { openai } from "./client";
import { isAuthenticated } from "../auth/replitAuth";
import { isApprovedReplitAiModel, REPLIT_AI_MODELS } from "../../providers/approved-models";

const IMAGE_SIZES = new Set(["1024x1024", "512x512", "256x256"]);
type ImageSize = "1024x1024" | "512x512" | "256x256";
type ImageResult = { data?: Array<{ url?: string | null; b64_json?: string | null }> };
type ImageRouteDependencies = {
  authenticate: RequestHandler;
  generate: (args: {
    model: typeof REPLIT_AI_MODELS.imageGeneration;
    prompt: string;
    size: ImageSize;
  }) => Promise<ImageResult>;
};

export function registerImageRoutes(
  app: Express,
  overrides: Partial<ImageRouteDependencies> = {},
): void {
  const dependencies: ImageRouteDependencies = {
    authenticate: isAuthenticated,
    generate: ({ prompt, size }) => openai.images.generate({
      model: REPLIT_AI_MODELS.imageGeneration,
      prompt,
      n: 1,
      size,
    }),
    ...overrides,
  };

  app.post("/api/generate-image", dependencies.authenticate, async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024", model } = req.body ?? {};
      if (model !== undefined &&
        (typeof model !== "string" || !isApprovedReplitAiModel("imageGeneration", model))) {
        return res.status(400).json({ error: "Unsupported image model" });
      }
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        return res.status(400).json({ error: "Prompt is required" });
      }
      if (typeof size !== "string" || !IMAGE_SIZES.has(size)) {
        return res.status(400).json({ error: "Unsupported image size" });
      }

      const response = await dependencies.generate({
        model: REPLIT_AI_MODELS.imageGeneration,
        prompt: prompt.trim(),
        size: size as ImageSize,
      });
      const imageData = response.data?.[0];
      res.json({
        url: imageData?.url,
        b64_json: imageData?.b64_json,
      });
    } catch {
      res.status(500).json({ error: "Failed to generate image" });
    }
  });
}
