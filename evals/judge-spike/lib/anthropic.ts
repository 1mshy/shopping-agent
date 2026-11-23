// The spike's second call path: the native Anthropic Messages API through the official SDK
// (`@anthropic-ai/sdk`), for Claude Haiku 5.5 (owner's decision of 2026-11-23). Not Anthropic's
// OpenAI-compatibility endpoint. A spike runner, not the Phase 2 client: one module, one
// non-streaming request per call, and the same budgets, records and validation as lib/chat.ts.
//
// Request and reply, as the SDK 1.12.0 types (resources/messages/messages.d.ts) and the Claude API
// reference describe them:
// - `model`, `max_tokens`, `system` (the rules), `messages` (user, and on the repair retry the
//   reply as an assistant turn, then the repair as a user turn; never a trailing assistant turn,
//   since Haiku 5.5 has no prefill).
// - `thinking: {type: "adaptive"}`: Haiku 5.5 thinks adaptively by default; it is sent so the
//   record says so. `budget_tokens` is rejected by the model and never sent.
// - `output_config.effort` ("low" | "medium" | "high" | "xhigh" | "max"; Haiku 5.5's default is
//   "medium") when given, and `output_config.format: {type: "json_schema", schema}` on the
//   json_schema rung (structured outputs). No `json_object` mode exists on this API.
// - No `temperature`, `top_p` or `top_k`: Haiku 5.5 rejects non-default values, and API version
//   2026-10-21 (sent by SDK 1.x) rejects them on every model.
// - Reply: `stop_reason` is checked before any content is read (`refusal`, with `stop_details`;
//   `max_tokens` and `model_context_window_exceeded` are truncation); the text blocks hold the
//   JSON, thinking blocks are skipped. `usage`: `input_tokens` (uncached part only),
//   `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens` (thinking
//   included), `output_tokens_details.thinking_tokens`.
//
// The client is built with the key passed in code (so no ANTHROPIC_* credential variable is read),
// no retries (an HTTP error is not retried, as on the chat path), no logging (every printed line is
// leak-checked by the runner) and no telemetry.
import Anthropic from '@anthropic-ai/sdk';
import {
  type ChatMessage,
  type HttpExchange,
  JUDGE_JSON_SCHEMA,
  type ReplyParts,
  type Rung,
  type Usage,
} from './chat.ts';

/** Effort levels of the Messages API (`output_config.effort`). */
export const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number];

/** The rungs this API has: structured outputs, or plain text with extraction. */
export const ANTHROPIC_RUNGS: readonly Rung[] = ['json_schema', 'text'];

export interface AnthropicRequestOptions {
  readonly model: string;
  readonly rung: Rung;
  readonly maxOutputTokens: number;
  /** Sent as `output_config.effort` only when given. */
  readonly effort: AnthropicEffort | null;
}

/**
 * The Messages request body. The system message becomes the top-level `system`; the rest keep
 * their order and roles.
 */
export function buildMessagesParams(
  o: AnthropicRequestOptions,
  messages: readonly ChatMessage[],
): Anthropic.MessageCreateParamsNonStreaming {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const turns: Anthropic.MessageParam[] = messages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  const outputConfig: Anthropic.OutputConfig = {};
  if (o.effort !== null) outputConfig.effort = o.effort;
  if (o.rung === 'json_schema') {
    outputConfig.format = {
      type: 'json_schema',
      schema: JUDGE_JSON_SCHEMA as unknown as Record<string, unknown>,
    };
  }
  return {
    model: o.model,
    max_tokens: o.maxOutputTokens,
    ...(system === '' ? {} : { system }),
    messages: turns,
    thinking: { type: 'adaptive' },
    ...(Object.keys(outputConfig).length === 0 ? {} : { output_config: outputConfig }),
  };
}

/**
 * A Message's reply parts, reading `stop_reason` first: a refusal or a truncation is reported as
 * such and its content is not used. Only text blocks count; thinking blocks are skipped.
 */
export function messageReplyParts(message: Anthropic.Message): ReplyParts {
  const stop = message.stop_reason;
  if (stop === 'refusal') {
    const category = message.stop_details?.category ?? null;
    return { content: null, finishReason: 'refusal', refusal: `refusal:${category ?? 'none'}` };
  }
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const truncated = stop === 'max_tokens' || stop === 'model_context_window_exceeded';
  return { content: text, finishReason: truncated ? 'length' : (stop ?? null), refusal: null };
}

const count = (x: unknown): number | null =>
  typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null;

/**
 * Messages usage to the S§4.4 normalisation (packages/shared/src/run.ts): input is the uncached
 * input plus cache reads and cache writes (Anthropic's `input_tokens` excludes both); reasoning is
 * `output_tokens_details.thinking_tokens`, a part of `output_tokens`. Null is "not reported".
 */
export function normaliseMessagesUsage(usage: unknown): Usage {
  const u = (typeof usage === 'object' && usage !== null ? usage : {}) as Record<string, unknown>;
  const base = count(u.input_tokens);
  const read = count(u.cache_read_input_tokens);
  const write = count(u.cache_creation_input_tokens);
  const details = u.output_tokens_details;
  const thinking =
    typeof details === 'object' && details !== null
      ? count((details as Record<string, unknown>).thinking_tokens)
      : null;
  return {
    'gen_ai.usage.input_tokens': base === null ? null : base + (read ?? 0) + (write ?? 0),
    'gen_ai.usage.cache_read.input_tokens': read,
    'gen_ai.usage.cache_write.input_tokens': write,
    'gen_ai.usage.output_tokens': count(u.output_tokens),
    'gen_ai.usage.reasoning.output_tokens': thinking,
  };
}

/** Response headers kept in a record; every other header is dropped. */
const KEPT_HEADERS = ['content-type', 'request-id'] as const;
/** Request headers never written to a record as sent. */
const CREDENTIAL_HEADERS = new Set(['authorization', 'x-api-key']);

export interface SentRequest {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type MessagesResult =
  | {
      readonly ok: true;
      readonly reply: HttpExchange;
      readonly message: Anthropic.Message;
      readonly sent: SentRequest | null;
    }
  | {
      /** An HTTP error status: the error body is kept, as text. */
      readonly ok: false;
      readonly error: 'http_status';
      readonly reply: HttpExchange;
      readonly errorName: string;
      readonly sent: SentRequest | null;
    }
  | {
      readonly ok: false;
      readonly error: 'timeout' | 'transport' | 'bad_response';
      readonly reply: null;
      readonly errorName: string;
      readonly sent: SentRequest | null;
    };

function keptHeaders(headers: Headers | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of KEPT_HEADERS) {
    const v = headers?.get(h) ?? null;
    if (v !== null) out[h] = v;
  }
  return out;
}

/**
 * The SDK client's base URL for an endpoint given as the API base (`https://api.anthropic.com/v1`,
 * as the owner's CLAUDE_API_URL has it): the SDK appends `/v1/messages` itself.
 */
export function sdkBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * Sends one Messages request through the SDK. The given fetch is the SDK's transport (tests pass a
 * scripted one); the request's path and headers are captured from it, credentials replaced by
 * `[REDACTED]`. Errors are reported by class name only: a message may quote the URL.
 */
export async function postMessages(
  fetchFn: typeof fetch,
  baseUrl: string,
  key: string,
  params: Anthropic.MessageCreateParamsNonStreaming,
  timeoutMs: number,
): Promise<MessagesResult> {
  let sent: SentRequest | null = null;
  const capturing = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = CREDENTIAL_HEADERS.has(name) ? '[REDACTED]' : value;
    });
    sent = { path: url.pathname, headers };
    return fetchFn(input, init);
  }) as typeof fetch;
  const client = new Anthropic({
    apiKey: key,
    baseURL: sdkBaseUrl(baseUrl),
    fetch: capturing,
    maxRetries: 0,
    timeout: Math.max(1, timeoutMs),
    logLevel: 'off',
    openTelemetry: false,
  });
  try {
    const { data, response } = await client.messages
      .create(params, {
        timeout: Math.max(1, timeoutMs),
        signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
      })
      .withResponse();
    return {
      ok: true,
      reply: {
        status: response.status,
        text: JSON.stringify(data),
        headers: keptHeaders(response.headers),
      },
      message: data,
      sent,
    };
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : 'Error';
    if (
      err instanceof Anthropic.APIConnectionTimeoutError ||
      err instanceof Anthropic.APIUserAbortError
    ) {
      return { ok: false, error: 'timeout', reply: null, errorName: name, sent };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: 'transport', reply: null, errorName: name, sent };
    }
    if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
      return {
        ok: false,
        error: 'http_status',
        reply: {
          status: err.status,
          text: JSON.stringify(err.error ?? null),
          headers: keptHeaders(err.headers),
        },
        errorName: name,
        sent,
      };
    }
    return { ok: false, error: 'bad_response', reply: null, errorName: name, sent };
  }
}
