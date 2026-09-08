# AI provider intake and Poe routing

## Approved use cases

| Use case | Input contract | Output contract | Required capabilities | Limits and parameters | Privacy class |
| --- | --- | --- | --- | --- | --- |
| `help-chat` | Authenticated, approved user; up to 12 user/assistant messages and 8,000 trimmed characters; app-approved help source is server-side context | Validated streamed text deltas, then a stable SSE `{done:true}` frame | `text-chat-stream` | 15 second deadline, 512 output tokens, at most two transient retries, four in-flight Poe requests | Approved app-help content only; no private warehouse images |
| `label-scan` | Authorized editor; server-cropped JPEG data URLs, at most 50 pins per request and 20 images per provider call | Strict JSON object with exactly one `labels` array entry per submitted crop | `vision-json` | 15 second deadline, 2,000 output tokens, at most two transient retries, 600px crops and 50MB crop budget | Approved warehouse label crops only; no full photos or unrelated user data |
| `session-scan` | Same label contract across a session; only photos belonging to the authorized session are loaded | Same strict label array, mapped back to the original pin order before persistence | `vision-json` | Same scanner limits and explicit unreadable results for failed batches | Approved warehouse label crops only |

The authorization boundary remains in the existing route middleware and session
access checks. The provider boundary is server-only and receives already
validated route inputs. It never exposes a key, prompt, image bytes, provider
payload, or provider error body to browser code or logs.

## Live registry and verification

The adapter calls `GET https://api.poe.com/v1/models` (or the server-only
`POE_API_BASE_URL` override) and caches the response for five minutes. A model
is eligible only when its exact ID is present in that live response, has the
required capability, and is classified `approved`. Capability declarations may
come from Poe catalogue metadata or the server-only
`POE_MODEL_CAPABILITIES_JSON` mapping, for example:

```json
{"<exact-live-model-id>":["text-chat-stream","vision-json"]}
```

The placeholder above is intentional: model IDs, prices, limits, and
availability must not be copied into source. Unknown capabilities fail closed,
and an empty or malformed catalogue is a provider configuration error. The
registry records the endpoint, input/output contract, limits, privacy class,
fallback policy, verification evidence, owner, and review trigger here rather
than relying on stale model examples.

**Verification evidence:** the live catalogue response is the availability
evidence; the endpoint and request/response contracts are verified against the
[Poe OpenAI-compatible API documentation](https://creator.poe.com/docs/external-applications/openai-compatible-api).
**Owner:** the Master Reel Counter server integration. **Review triggers:**
Poe API contract changes, model catalogue changes, capability changes, or a
provider incident.

Poe authentication comes only from the Replit Secret `POE_API_KEY`. The
existing OpenAI-compatible Replit integration remains the explicit fallback
classification for audio transcription, voice responses, image generation,
and image editing. Those routes are not silently switched to Poe; migration
requires a future live capability check and current endpoint documentation.

## Failure, retry, and telemetry contract

The adapter validates local requests and untrusted catalogue, stream, JSON, and
vision responses. It normalizes configuration, authentication, quota,
rate-limit, model, capability, validation, timeout, upstream, cancellation,
and backpressure failures to safe messages. Only bounded transient failures
retry. A disconnected SSE request aborts the provider stream and cannot emit
late output or completion telemetry.

AI usage telemetry is aggregate-oriented and owner-scoped. It stores provider,
exact model when selected, endpoint, route/use case, latency, status, retry
count, fallback/cache state, and prompt/completion token counts. It deliberately
does not store prompts, images, secrets, raw upstream responses, or request
identifiers. The owner report applies its existing 30-day reporting window;
telemetry write failures are suppressed and never change a user-visible AI
result.