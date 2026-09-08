import OpenAI from "openai";
import { z } from "zod";
import { db } from "../db";
import { sql } from "drizzle-orm";

export const POE_ENDPOINT = "https://api.poe.com/v1";
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const MAX_IN_FLIGHT = 4;

export type PoeCapability = "text-chat-stream" | "vision-json";
export type PoeUseCase = "help-chat" | "label-scan" | "session-scan";

export interface PoeLiveModel {
  id: string;
  capabilities: PoeCapability[];
  contextLimit?: number;
  maxOutputTokens?: number;
  privacyClass: "approved";
}

export interface PoeTextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PoeImageMessage {
  role: "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } }
  >;
}

export type PoeMessage = PoeTextMessage | PoeImageMessage;

export interface PoeUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface PoeTelemetryEvent {
  provider: "poe";
  model: string | null;
  endpoint: string;
  useCase: PoeUseCase;
  latencyMs: number;
  status: "success" | "error" | "cancelled";
  retries: number;
  fallbackState: "none";
  cacheState: "hit" | "miss" | "not-applicable";
  usage: PoeUsage;
  userId: string | null;
}

export type PoeErrorCode =
  | "configuration"
  | "authentication"
  | "quota"
  | "rate_limit"
  | "model"
  | "capability"
  | "validation"
  | "timeout"
  | "upstream"
  | "backpressure"
  | "cancelled";

export class PoeProviderError extends Error {
  readonly code: PoeErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly retries: number;

  constructor(
    code: PoeErrorCode,
    message: string,
    statusCode: number,
    retryable = false,
    retries = 0,
  ) {
    super(message);
    this.name = "PoeProviderError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.retries = retries;
  }
}

const capabilitySchema = z.enum(["text-chat-stream", "vision-json"]);
const modelSchema = z.object({
  id: z.string().trim().min(1),
  capabilities: z.array(z.string()).optional(),
  input_modalities: z.array(z.string()).optional(),
  output_modalities: z.array(z.string()).optional(),
  context_length: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  metadata: z.object({ capabilities: z.array(z.string()).optional() }).optional(),
}).passthrough();

const modelsResponseSchema = z.object({
  data: z.array(z.unknown()),
}).passthrough();

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.union([z.string(), z.null()]).optional(),
    }).passthrough(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
}).passthrough();

const streamChunkSchema = z.object({
  choices: z.array(z.object({
    delta: z.object({
      content: z.union([z.string(), z.null()]).optional(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
}).passthrough();

const visionLabelsSchema = z.object({
  labels: z.array(z.union([z.string(), z.null()])),
}).strict();

const inFlight = { count: 0 };
let cachedModels: { models: PoeLiveModel[]; expiresAt: number } | null = null;

function modelCacheState(): "hit" | "miss" {
  return cachedModels && cachedModels.expiresAt > Date.now() ? "hit" : "miss";
}

function configuredCapabilities(): Map<string, PoeCapability[]> {
  const raw = process.env.POE_MODEL_CAPABILITIES_JSON;
  if (!raw) return new Map();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const result = new Map<string, PoeCapability[]>();
    for (const [id, values] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(values)) continue;
      const capabilities = values.flatMap((value) => {
        const parsedCapability = capabilitySchema.safeParse(value);
        return parsedCapability.success ? [parsedCapability.data] : [];
      });
      if (capabilities.length > 0) result.set(id, capabilities);
    }
    return result;
  } catch {
    return new Map();
  }
}

export function parsePoeModelsResponse(payload: unknown): PoeLiveModel[] {
  const parsed = modelsResponseSchema.safeParse(payload);
  if (!parsed.success) return [];
  const configured = configuredCapabilities();
  const models: PoeLiveModel[] = [];
  for (const candidate of parsed.data.data) {
    const model = modelSchema.safeParse(candidate);
    if (!model.success) continue;
    const metadataCapabilities = model.data.metadata?.capabilities ?? [];
    const declaredCapabilities = [...(model.data.capabilities ?? []), ...metadataCapabilities];
    const capabilities = [...new Set(
      [...declaredCapabilities, ...(configured.get(model.data.id) ?? [])]
        .flatMap((value) => {
          const parsedCapability = capabilitySchema.safeParse(value);
          return parsedCapability.success ? [parsedCapability.data] : [];
        }),
    )];
    models.push({
      id: model.data.id,
      capabilities,
      contextLimit: model.data.context_length,
      maxOutputTokens: model.data.max_output_tokens,
      privacyClass: "approved",
    });
  }
  return models;
}

export function selectPoeModel(
  models: PoeLiveModel[],
  capability: PoeCapability,
): PoeLiveModel {
  const match = [...models]
    .filter((model) => model.privacyClass === "approved" && model.capabilities.includes(capability))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!match) {
    throw new PoeProviderError(
      "capability",
      "No live Poe model satisfies the requested capability.",
      503,
    );
  }
  return match;
}

export function validateVisionLabels(content: string, expectedCount: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new PoeProviderError("validation", "Poe returned invalid structured output.", 502);
  }
  const result = visionLabelsSchema.safeParse(parsed);
  if (!result.success || result.data.labels.length !== expectedCount) {
    throw new PoeProviderError("validation", "Poe returned invalid structured output.", 502);
  }
  return result.data.labels.map((label) => label ?? "");
}

export function normalizePoeError(error: unknown, retries = 0): PoeProviderError {
  if (error instanceof PoeProviderError) {
    return new PoeProviderError(error.code, error.message, error.statusCode, error.retryable, retries);
  }
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : 0;
  if (status === 401) return new PoeProviderError("authentication", "Poe authentication failed.", 503, false, retries);
  if (status === 402) return new PoeProviderError("quota", "Poe quota is unavailable.", 503, false, retries);
  if (status === 404) return new PoeProviderError("model", "The selected Poe model is unavailable.", 503, false, retries);
  if (status === 429) return new PoeProviderError("rate_limit", "Poe is rate limited.", 503, true, retries);
  if (status >= 500) return new PoeProviderError("upstream", "Poe is temporarily unavailable.", 502, true, retries);
  if ((error as { name?: string })?.name === "AbortError") {
    return new PoeProviderError("timeout", "Poe request timed out.", 504, true, retries);
  }
  return new PoeProviderError("upstream", "Poe request failed.", 502, false, retries);
}

function errorForConfiguration(): PoeProviderError {
  if (!process.env.POE_API_KEY) {
    return new PoeProviderError("configuration", "Poe is not configured.", 503);
  }
  return new PoeProviderError("configuration", "Poe configuration is invalid.", 503);
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
  controller: AbortController;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
    controller,
  };
}

async function recordUsage(event: PoeTelemetryEvent): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO ai_usage_logs
        (user_id, feature, model, prompt_tokens, completion_tokens, provider, endpoint,
         route, status, latency_ms, retry_count, fallback_state, cache_state, created_at)
      VALUES
        (${event.userId}, ${event.useCase}, ${event.model ?? "unselected"},
         ${event.usage.promptTokens}, ${event.usage.completionTokens}, ${event.provider},
         ${event.endpoint}, ${event.useCase}, ${event.status}, ${event.latencyMs},
         ${event.retries}, ${event.fallbackState}, ${event.cacheState}, NOW())
    `);
  } catch {
    // Telemetry is best effort and must never change the provider result.
  }
}

export interface PoeProvider {
  listModels(forceRefresh?: boolean): Promise<PoeLiveModel[]>;
  streamText(args: {
    messages: PoeTextMessage[];
    useCase: "help-chat";
    maxTokens: number;
    signal?: AbortSignal;
    userId: string | null;
  }): Promise<{
    model: string;
    retries: number;
    usage: Promise<PoeUsage>;
    stream: AsyncIterable<string>;
    abort: () => void;
  }>;
  completeVision(args: {
    messages: PoeImageMessage[];
    expectedLabels: number;
    useCase: "label-scan" | "session-scan";
    maxTokens: number;
    signal?: AbortSignal;
    userId: string | null;
  }): Promise<{ model: string; retries: number; labels: string[] }>;
}

class PoeProviderImpl implements PoeProvider {
  private readonly client: OpenAI | null;
  private readonly endpoint: string;

  constructor() {
    this.endpoint = process.env.POE_API_BASE_URL?.replace(/\/+$/, "") || POE_ENDPOINT;
    this.client = process.env.POE_API_KEY
      ? new OpenAI({ apiKey: process.env.POE_API_KEY, baseURL: this.endpoint, maxRetries: 0 })
      : null;
  }

  async listModels(forceRefresh = false): Promise<PoeLiveModel[]> {
    if (!this.client) throw errorForConfiguration();
    if (!forceRefresh && cachedModels && cachedModels.expiresAt > Date.now()) return cachedModels.models;
    const signal = combineSignals(undefined, REQUEST_TIMEOUT_MS);
    try {
      const response = await this.client.models.list({ signal: signal.signal });
      const models = parsePoeModelsResponse(response);
      if (models.length === 0) throw new PoeProviderError("validation", "Poe returned no usable models.", 503);
      cachedModels = { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS };
      return models;
    } catch (error) {
      throw normalizePoeError(error);
    } finally {
      signal.cleanup();
    }
  }

  private async acquire(): Promise<void> {
    if (inFlight.count >= MAX_IN_FLIGHT) {
      throw new PoeProviderError("backpressure", "Poe is busy; please retry shortly.", 503, true);
    }
    inFlight.count++;
  }

  private release(): void {
    inFlight.count = Math.max(0, inFlight.count - 1);
  }

  private async withRetry<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    callerSignal: AbortSignal | undefined,
  ): Promise<{ value: T; retries: number }> {
    await this.acquire();
    let retries = 0;
    try {
      while (true) {
        const combined = combineSignals(callerSignal, REQUEST_TIMEOUT_MS);
        try {
          const value = await operation(combined.signal);
          return { value, retries };
        } catch (error) {
          const normalized = normalizePoeError(error, retries);
          if (!normalized.retryable || retries >= MAX_RETRIES || callerSignal?.aborted) throw normalized;
          retries++;
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** retries));
        } finally {
          combined.cleanup();
        }
      }
    } finally {
      this.release();
    }
  }

  async streamText(args: {
    messages: PoeTextMessage[];
    useCase: "help-chat";
    maxTokens: number;
    signal?: AbortSignal;
    userId: string | null;
  }): Promise<{
    model: string;
    retries: number;
    usage: Promise<PoeUsage>;
    stream: AsyncIterable<string>;
    abort: () => void;
  }> {
    const startedAt = Date.now();
    const cacheState = modelCacheState();
    let model: PoeLiveModel;
    try {
      const models = await this.listModels();
      model = selectPoeModel(models, "text-chat-stream");
    } catch (error) {
      const normalized = normalizePoeError(error);
      await recordUsage({
        provider: "poe", model: null, endpoint: this.endpoint, useCase: args.useCase,
        latencyMs: Date.now() - startedAt, status: "error", retries: normalized.retries,
        fallbackState: "none", cacheState,
        usage: { promptTokens: 0, completionTokens: 0 }, userId: args.userId,
      });
      throw normalized;
    }

    const abortController = new AbortController();
    const abort = () => abortController.abort();
    const abortFromCaller = () => abortController.abort();
    args.signal?.addEventListener("abort", abortFromCaller, { once: true });
    let resolveUsage!: (usage: PoeUsage) => void;
    const usage = new Promise<PoeUsage>((resolve) => { resolveUsage = resolve; });
    let usageValue: PoeUsage = { promptTokens: 0, completionTokens: 0 };
    let settled = false;
    let retries = 0;

    const stream = (async function* (provider: PoeProviderImpl) {
      try {
        const result = await provider.withRetry(
          (signal) => provider.client!.chat.completions.create({
            model: model.id,
            messages: args.messages,
            stream: true,
            stream_options: { include_usage: true },
            max_completion_tokens: args.maxTokens,
          }, { signal: AbortSignal.any([signal, abortController.signal]) }),
          args.signal,
        );
        retries = result.retries;
        for await (const rawChunk of result.value) {
          const parsed = streamChunkSchema.safeParse(rawChunk);
          if (!parsed.success) throw new PoeProviderError("validation", "Poe returned invalid stream data.", 502);
          const chunkUsage = parsed.data.usage;
          if (chunkUsage) {
            usageValue = {
              promptTokens: chunkUsage.prompt_tokens ?? usageValue.promptTokens,
              completionTokens: chunkUsage.completion_tokens ?? usageValue.completionTokens,
            };
          }
          const content = parsed.data.choices?.[0]?.delta?.content;
          if (content) yield content;
        }
        if (!settled) {
          settled = true;
          resolveUsage(usageValue);
          await recordUsage({
            provider: "poe", model: model.id, endpoint: provider.endpoint, useCase: args.useCase,
            latencyMs: Date.now() - startedAt, status: "success", retries,
            fallbackState: "none", cacheState,
            usage: usageValue, userId: args.userId,
          });
        }
      } catch (error) {
        const normalized = normalizePoeError(error, retries);
        if (!settled) {
          settled = true;
          resolveUsage(usageValue);
          await recordUsage({
            provider: "poe", model: model.id, endpoint: provider.endpoint, useCase: args.useCase,
            latencyMs: Date.now() - startedAt, status: abortController.signal.aborted ? "cancelled" : "error",
            retries: normalized.retries, fallbackState: "none", cacheState: "hit",
            usage: usageValue, userId: args.userId,
          });
        }
        if (!abortController.signal.aborted) throw normalized;
      } finally {
        args.signal?.removeEventListener("abort", abortFromCaller);
      }
    })(this);

    return { model: model.id, retries, usage, stream, abort };
  }

  async completeVision(args: {
    messages: PoeImageMessage[];
    expectedLabels: number;
    useCase: "label-scan" | "session-scan";
    maxTokens: number;
    signal?: AbortSignal;
    userId: string | null;
  }): Promise<{ model: string; retries: number; labels: string[] }> {
    const startedAt = Date.now();
    const cacheState = modelCacheState();
    let model: PoeLiveModel | undefined;
    let retries = 0;
    try {
      model = selectPoeModel(await this.listModels(), "vision-json");
      const result = await this.withRetry(
        (signal) => this.client!.chat.completions.create({
          model: model!.id,
          messages: args.messages as never,
          response_format: { type: "json_object" },
          max_tokens: args.maxTokens,
        }, { signal }),
        args.signal,
      );
      retries = result.retries;
      const parsed = completionSchema.safeParse(result.value);
      if (!parsed.success) throw new PoeProviderError("validation", "Poe returned invalid response data.", 502);
      const content = parsed.data.choices[0]?.message.content;
      if (typeof content !== "string") throw new PoeProviderError("validation", "Poe returned invalid response data.", 502);
      const labels = validateVisionLabels(content, args.expectedLabels);
      await recordUsage({
        provider: "poe", model: model.id, endpoint: this.endpoint, useCase: args.useCase,
        latencyMs: Date.now() - startedAt, status: "success", retries,
        fallbackState: "none", cacheState,
        usage: {
          promptTokens: parsed.data.usage?.prompt_tokens ?? 0,
          completionTokens: parsed.data.usage?.completion_tokens ?? 0,
        },
        userId: args.userId,
      });
      return { model: model.id, retries, labels };
    } catch (error) {
      const normalized = normalizePoeError(error, retries);
      await recordUsage({
        provider: "poe", model: model?.id ?? null, endpoint: this.endpoint, useCase: args.useCase,
        latencyMs: Date.now() - startedAt, status: args.signal?.aborted ? "cancelled" : "error",
        retries: normalized.retries, fallbackState: "none", cacheState: cachedModels ? "hit" : "miss",
        usage: { promptTokens: 0, completionTokens: 0 }, userId: args.userId,
      });
      throw normalized;
    }
  }
}

let provider: PoeProvider = new PoeProviderImpl();

export function createPoeProvider(): PoeProvider {
  return new PoeProviderImpl();
}

export function getPoeProvider(): PoeProvider {
  return provider;
}

export function setPoeProviderForTests(next: PoeProvider): void {
  provider = next;
}