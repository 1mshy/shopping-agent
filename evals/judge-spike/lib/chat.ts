// The spike's model call: one minimal, non-streaming Chat Completions request over raw fetch, and
// the reading of its reply. A spike runner, not the Phase 2 client (S§5.7): kept small, in one
// module.
//
// Request and response fields are taken from the providers' current documentation (read
// 2026-11-18):
// - OpenAI, "Create chat completion":
//   https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
//   `model`, `messages`, `max_completion_tokens` (`max_tokens` is deprecated there but still what
//   many compatible servers read), `temperature` (0-2), `reasoning_effort`, `stream`,
//   `response_format` ({type: "text"} | {type: "json_object"} | {type: "json_schema",
//   json_schema: {name, schema, strict}}); reply `choices[].message.content` (string or null),
//   `choices[].message.refusal`, `choices[].finish_reason` ("stop", "length", ...), `usage`
//   (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`,
//   `completion_tokens_details.reasoning_tokens`).
// - OpenRouter, "API parameters": https://openrouter.ai/docs/api/reference/parameters
//   (`reasoning_effort`, `response_format`, `max_tokens`, `max_completion_tokens`, `temperature`).
// - OpenRouter, "Usage accounting": https://openrouter.ai/docs/guides/guides/usage-accounting
//   (`usage.cost`, "Cost in credits", and `prompt_tokens_details.cache_write_tokens`; usage is in
//   every non-streaming response).
// - LiteLLM's `x-litellm-response-cost` header, as S§5.7 names it.
import {
  JudgeBatch,
  type JudgeVerdict,
  MATCH_RELATIONS,
  type MinorUnitCurrency,
  type RunCost,
} from '@agentic-dasher/shared';
import { costFromPrices, type Prices } from './budget.ts';
import { estimateTokens } from './tokens.ts';

/** The structured-output ladder of S§5.7 as far as the spike goes (the forced-tool rung is not
 * built; see README). A flag picks the rung; there is no automatic fall-back. */
export const RUNGS = ['json_schema', 'json_object', 'text'] as const;
export type Rung = (typeof RUNGS)[number];

/** The JudgeBatch shape as a strict-mode JSON schema. Fixed, so the request prefix stays
 * byte-stable; ids and count are checked in code against each batch. */
export const JUDGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          relation: { type: 'string', enum: [...MATCH_RELATIONS] },
          differingAttrs: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['id', 'relation', 'differingAttrs', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
} as const;

export interface RequestOptions {
  readonly model: string;
  readonly rung: Rung;
  readonly maxTokensField: 'max_completion_tokens' | 'max_tokens';
  readonly maxOutputTokens: number;
  /** Sent only when given. */
  readonly temperature: number | null;
  /** Sent as `reasoning_effort` only when given. */
  readonly reasoningEffort: string | null;
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export function buildRequestBody(
  o: RequestOptions,
  messages: readonly ChatMessage[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: o.model,
    messages,
    [o.maxTokensField]: o.maxOutputTokens,
    stream: false,
  };
  if (o.temperature !== null) body.temperature = o.temperature;
  if (o.reasoningEffort !== null) body.reasoning_effort = o.reasoningEffort;
  if (o.rung === 'json_schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'judge_batch', strict: true, schema: JUDGE_JSON_SCHEMA },
    };
  } else if (o.rung === 'json_object') {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

/**
 * The input estimate the budget check uses before a call (lib/tokens.ts): every message's text,
 * four tokens of framing per message as chat templates add, and the schema on its rung.
 */
export function estimateInputTokens(messages: readonly ChatMessage[], rung: Rung): number {
  const schema = rung === 'json_schema' ? estimateTokens(JSON.stringify(JUDGE_JSON_SCHEMA)) : 0;
  return messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0) + schema;
}

/** Response headers kept in a record; every other header is dropped. */
const KEPT_HEADERS = ['content-type', 'x-litellm-response-cost'] as const;

export interface HttpExchange {
  readonly status: number;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type PostResult =
  | { readonly ok: true; readonly reply: HttpExchange }
  | { readonly ok: false; readonly error: 'timeout' | 'transport'; readonly errorName: string };

export const USER_AGENT = 'agentic-dasher-judge-spike/0.1';

/** Sends one request. Errors are reported by name only: a message may quote the URL. */
export async function postChat(
  fetchFn: typeof fetch,
  endpoint: string,
  key: string | null,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<PostResult> {
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        ...(key === null ? {} : { authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    const text = await res.text();
    const headers: Record<string, string> = {};
    for (const h of KEPT_HEADERS) {
      const v = res.headers.get(h);
      if (v !== null) headers[h] = v;
    }
    return { ok: true, reply: { status: res.status, text, headers } };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return { ok: false, error: timedOut ? 'timeout' : 'transport', errorName: name };
  }
}

const TOKENS = [
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_write.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.reasoning.output_tokens',
] as const;
/** Usage as packages/shared/src/run.ts normalises it; null is "not reported", never zero. */
export type Usage = { readonly [K in (typeof TOKENS)[number]]: number | null };

const count = (x: unknown): number | null =>
  typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null;
const obj = (x: unknown): Record<string, unknown> =>
  typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};

/**
 * Chat Completions usage to the S§4.4 normalisation: input includes cached tokens (OpenAI's
 * `prompt_tokens` does), cache reads and writes are parts of input, reasoning is part of output.
 */
export function normaliseUsage(usage: unknown): Usage {
  const u = obj(usage);
  const pd = obj(u.prompt_tokens_details);
  const cd = obj(u.completion_tokens_details);
  return {
    'gen_ai.usage.input_tokens': count(u.prompt_tokens),
    'gen_ai.usage.cache_read.input_tokens': count(pd.cached_tokens),
    'gen_ai.usage.cache_write.input_tokens': count(pd.cache_write_tokens),
    'gen_ai.usage.output_tokens': count(u.completion_tokens),
    'gen_ai.usage.reasoning.output_tokens': count(cd.reasoning_tokens),
  };
}

/** An exact decimal (as text) in nano-units, rounded up past the ninth decimal; null if not one. */
export function nanosFromDecimal(text: string): number | null {
  const m = /^([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const frac = m[2] ?? '';
  const digits = BigInt(`${m[1]}${frac}`);
  const shift = Number(m[3] ?? '0') - frac.length + 9;
  let nanos: bigint;
  if (shift >= 0) nanos = digits * 10n ** BigInt(shift);
  else {
    const d = 10n ** BigInt(-shift);
    nanos = digits / d + (digits % d > 0n ? 1n : 0n);
  }
  return nanos <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(nanos) : null;
}

/**
 * The provider's reported cost as its decimal text, never through a float: `usage.cost` in the
 * body (OpenRouter), else the `x-litellm-response-cost` header. Null when neither is there.
 */
export function providerCostText(
  body: string,
  headers: Readonly<Record<string, string>>,
): string | null {
  const sources = new WeakMap<object, string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body, function (this: object, key: string, value: unknown, ctx?: unknown) {
      const source = (ctx as { source?: unknown } | undefined)?.source;
      if (key === 'cost' && typeof source === 'string') sources.set(this, source);
      return value;
    });
  } catch {
    parsed = null;
  }
  const usage = obj(obj(parsed).usage);
  const fromBody = sources.get(usage) ?? (typeof usage.cost === 'string' ? usage.cost : undefined);
  if (fromBody !== undefined) return fromBody.replace(/^"|"$/g, '');
  return headers['x-litellm-response-cost'] ?? null;
}

/**
 * Cost and its source (S§5.7): the provider's figure when it is reported and the owner has said
 * which currency it is in (it must be the spend currency); else the settings prices applied to
 * the reported usage; else unknown, which has no amount and is never zero.
 */
export function costOf(a: {
  providerText: string | null;
  providerCurrency: string | null;
  currency: MinorUnitCurrency;
  usage: Usage;
  prices: Prices | null;
}): RunCost {
  if (a.providerText !== null && a.providerCurrency === a.currency) {
    const nanos = nanosFromDecimal(a.providerText);
    if (nanos !== null) return { source: 'provider', amountNanos: nanos, currency: a.currency };
  }
  const input = a.usage['gen_ai.usage.input_tokens'];
  const output = a.usage['gen_ai.usage.output_tokens'];
  if (a.prices !== null && input !== null && output !== null) {
    const amountNanos = costFromPrices(input, output, a.prices);
    return { source: 'settings', amountNanos, currency: a.currency };
  }
  return { source: 'none' };
}

/** Why an exchange gave no usable verdicts. Only the output reasons get the repair retry. */
export type InvalidReason =
  | 'http_status'
  | 'timeout'
  | 'transport'
  | 'bad_response'
  | 'no_content'
  | 'refusal'
  | 'truncated'
  | 'not_json'
  | 'schema'
  | 'count'
  | 'ids';

export const FAILURE_REASONS: readonly InvalidReason[] = [
  'http_status',
  'timeout',
  'transport',
  'bad_response',
];

export interface ReplyParts {
  readonly content: string | null;
  readonly finishReason: string | null;
  readonly refusal: string | null;
}

export type ParseResult =
  | { readonly ok: true; readonly verdicts: readonly JudgeVerdict[] }
  | {
      readonly ok: false;
      readonly reason: Exclude<
        InvalidReason,
        'http_status' | 'timeout' | 'transport' | 'bad_response'
      >;
      readonly detail: string | null;
    };

/** The message parts of a Chat Completions body, or null when the body is not one. */
export function replyParts(body: string): (ReplyParts & { usage: unknown }) | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const choices = obj(parsed).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = obj(choices[0]);
  const message = obj(choice.message);
  let content: string | null = null;
  if (typeof message.content === 'string') content = message.content;
  else if (Array.isArray(message.content)) {
    content = message.content
      .map((p) => obj(p))
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('');
  }
  return {
    content,
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    refusal: typeof message.refusal === 'string' && message.refusal !== '' ? message.refusal : null,
    usage: obj(parsed).usage,
  };
}

/** Removes `<think>…</think>` blocks (S§5.7). */
export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '');
}

/** The first balanced JSON object in a text, braces inside strings included; null if none. */
export function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * The verdicts of a reply, validated with `JudgeBatch` and against the batch: exactly one verdict
 * per listing id, no other id. On the json rungs the content must be the JSON object itself (after
 * any think block); only the text rung extracts an object from prose.
 */
export function parseVerdicts(
  parts: ReplyParts,
  rung: Rung,
  batchIds: readonly string[],
): ParseResult {
  if (parts.refusal !== null) return { ok: false, reason: 'refusal', detail: null };
  if (parts.finishReason === 'length') return { ok: false, reason: 'truncated', detail: null };
  if (parts.content === null || parts.content.trim() === '') {
    return { ok: false, reason: 'no_content', detail: null };
  }
  const text = stripThink(parts.content).trim();
  const candidate = rung === 'text' ? extractJson(text) : text;
  if (candidate === null) return { ok: false, reason: 'not_json', detail: null };
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return { ok: false, reason: 'not_json', detail: null };
  }
  const batch = JudgeBatch.safeParse(value);
  if (!batch.success) {
    const detail = batch.error.issues.map((i) => `${i.path.join('.')}:${i.code}`).join(', ');
    return { ok: false, reason: 'schema', detail: detail.slice(0, 500) };
  }
  const verdicts = batch.data.verdicts;
  if (verdicts.length !== batchIds.length) {
    return {
      ok: false,
      reason: 'count',
      detail: `${verdicts.length} verdicts for ${batchIds.length} listings`,
    };
  }
  const wanted = new Set(batchIds);
  if (!verdicts.every((v) => wanted.has(v.id))) {
    return { ok: false, reason: 'ids', detail: 'a verdict id is not a listing id of the batch' };
  }
  return { ok: true, verdicts };
}
