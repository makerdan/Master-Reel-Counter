export const APPROVED_POE_MODELS = [
  { id: "Gemini-3.1-Pro", label: "Gemini 3.1 Pro" },
  { id: "Claude-Sonnet-4.5", label: "Claude Sonnet 4.5" },
] as const;

export const APPROVED_POE_MODEL_IDS = APPROVED_POE_MODELS.map(({ id }) => id);

export const REPLIT_AI_MODELS = {
  audioResponse: "gpt-audio",
  audioTranscription: "gpt-4o-mini-transcribe",
  imageGeneration: "gpt-image-1",
} as const;

export type ReplitAiUseCase = keyof typeof REPLIT_AI_MODELS;

export function isApprovedPoeModelId(modelId: string): boolean {
  return APPROVED_POE_MODEL_IDS.some((approvedId) => approvedId === modelId);
}

export function isApprovedReplitAiModel(
  useCase: ReplitAiUseCase,
  modelId: string,
): boolean {
  return REPLIT_AI_MODELS[useCase] === modelId;
}