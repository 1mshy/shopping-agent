// The Messages scenario matrix: the native Anthropic Messages API (`POST /v1/messages` and its
// neighbours), for the `anthropic` family. It serves the same seven probe steps (S§5.7) and the
// same client behaviours as the Chat Completions matrix in scenarios.ts, as far as they exist on
// this API. Request shapes were taken from Anthropic's documentation, read 2026-11-24 (the pages
// in DOC). The recorder adds `x-api-key` and `anthropic-version: 2026-10-21` (format.ts).
//
// What has no Messages counterpart, and so no scenario here:
// - json_object mode (S§5.7 step 5, second half): the API has structured outputs only
//   (`output_config.format` with a JSON schema).
// - A max-tokens field choice (maxTokensField): `max_tokens` is the only cap field.
// - A developer role: the system prompt is the top-level `system`.
// - Native side doors: `GET /v1/models/{model_id}` is the model record (messages-model-get).
// Sampling parameters are not sent; messages-error-sampling records what one gets back.
import type { JsonValue } from './format.ts';
import {
  COUNT,
  LONG_PREFIX,
  PARALLEL_QUESTION,
  PRICE_QUESTION,
  PRIME_QUESTION,
  READY,
  RECORD_QUESTION,
  SYSTEM,
} from './prompts.ts';
import type { Scenario, ScenarioContext } from './scenarios.ts';

const DOC = {
  create: 'https://platform.claude.com/docs/en/api/messages/create',
  streaming: 'https://platform.claude.com/docs/en/build-with-claude/streaming',
  modelsList: 'https://platform.claude.com/docs/en/api/models/list',
  modelsGet: 'https://platform.claude.com/docs/en/api/models/retrieve',
  defineTools: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools',
  structured: 'https://platform.claude.com/docs/en/build-with-claude/structured-outputs',
  thinking: 'https://platform.claude.com/docs/en/build-with-claude/thinking',
  caching: 'https://platform.claude.com/docs/en/build-with-claude/prompt-caching',
  tokenCounting: 'https://platform.claude.com/docs/en/build-with-claude/token-counting',
  errors: 'https://platform.claude.com/docs/en/api/errors',
  versioning: 'https://platform.claude.com/docs/en/api/versioning',
  pricing: 'https://platform.claude.com/docs/en/about-claude/pricing',
} as const;

// `input_schema` with `additionalProperties: false`, as strict tool use and structured outputs
// require; `strict` itself is not set, so the request is the plain tool shape.
const PRICE_TOOL = {
  name: 'get_price',
  description: 'Look up the current listed price of a product at one store.',
  input_schema: {
    type: 'object',
    properties: { product: { type: 'string' }, store: { type: 'string' } },
    required: ['product', 'store'],
    additionalProperties: false,
  },
};

const user = (content: string): JsonValue => [{ role: 'user', content }];

/** A Messages body: model, cap, top-level system, one user turn, streamed unless told not to. */
const body = (
  c: ScenarioContext,
  content: string,
  extra: Record<string, JsonValue> = {},
  max = 512,
): JsonValue => ({
  model: c.model,
  max_tokens: max,
  system: SYSTEM,
  messages: user(content),
  stream: true,
  ...extra,
});

type MessagesSpec = Omit<Scenario, 'api' | 'method' | 'root' | 'path' | 'auth' | 'families'> &
  Partial<Pick<Scenario, 'auth' | 'path'>>;

/** A POST to {base}/messages with the session key, for the `anthropic` family. */
const messages = (spec: MessagesSpec): Scenario => ({
  api: 'messages',
  method: 'POST',
  root: 'base',
  path: () => '/messages',
  auth: 'session',
  families: ['anthropic'],
  ...spec,
});

/** The cache pair's body: the long prefix as a system block with an explicit breakpoint. The
 * documented automatic (top-level) breakpoint would land on the user turn, which differs between
 * the two calls, so it is not used. */
const cacheBody = (c: ScenarioContext, content: string): JsonValue => ({
  model: c.model,
  max_tokens: 256,
  system: [{ type: 'text', text: LONG_PREFIX, cache_control: { type: 'ephemeral' } }],
  messages: user(content),
  stream: true,
});

export const MESSAGES_SCENARIOS: readonly Scenario[] = [
  {
    id: 'messages-models-list',
    api: 'messages',
    probeSteps: [1],
    serves: 'Model list: ids, max_input_tokens, max_tokens and capabilities per model (page 1)',
    families: ['anthropic'],
    method: 'GET',
    root: 'base',
    path: () => '/models',
    body: () => null,
    auth: 'session',
    sources: [DOC.modelsList],
  },
  {
    id: 'messages-model-get',
    api: 'messages',
    probeSteps: [1],
    serves: 'One model record: context window, output cap, thinking and effort capabilities',
    families: ['anthropic'],
    method: 'GET',
    root: 'base',
    path: (c) => `/models/${encodeURIComponent(c.model)}`,
    body: () => null,
    auth: 'session',
    sources: [DOC.modelsGet],
  },
  messages({
    id: 'messages-stream',
    probeSteps: [2],
    serves: 'Plain streamed reply, default thinking and effort: SSE events, usage, tok/s',
    body: (c) => body(c, READY),
    sources: [DOC.create, DOC.streaming],
  }),
  messages({
    id: 'messages-nonstream',
    probeSteps: [],
    serves: 'Client: the same request without streaming, for the non-streamed Message and usage',
    body: (c) => body(c, READY, { stream: false }),
    sources: [DOC.create],
  }),
  messages({
    id: 'messages-stream-max-tokens',
    probeSteps: [2],
    serves: 'A reply cut off by max_tokens 16: stop_reason max_tokens, and where the cut lands',
    body: (c) => body(c, COUNT, {}, 16),
    sources: [DOC.create, DOC.streaming],
  }),
  messages({
    id: 'messages-tool-auto',
    probeSteps: [3],
    serves: 'One tool, tool_choice auto: streamed tool_use block, input_json_delta, stop tool_use',
    body: (c) => body(c, PRICE_QUESTION, { tools: [PRICE_TOOL], tool_choice: { type: 'auto' } }),
    sources: [DOC.create, DOC.defineTools, DOC.streaming],
  }),
  messages({
    id: 'messages-tool-result-followup',
    probeSteps: [3],
    serves: 'A tool_result sent back for a tool_use id (no thinking block in the replayed turn)',
    body: (c) => ({
      ...(body(c, PRICE_QUESTION, { tools: [PRICE_TOOL] }) as Record<string, JsonValue>),
      messages: [
        { role: 'user', content: PRICE_QUESTION },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_wire_1',
              name: 'get_price',
              input: { product: 'Kindle Paperwhite', store: 'Amazon' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_wire_1', content: '{"status":"not_found"}' },
          ],
        },
      ],
    }),
    sources: [DOC.create, DOC.defineTools],
  }),
  messages({
    id: 'messages-tool-choice-any-parallel',
    probeSteps: [4],
    serves: 'Forced tool use (tool_choice any) with parallel calls allowed: two calls in one turn?',
    // Documented as accepted on Claude Haiku 5.5, skipping thinking (define-tools, pricing).
    body: (c) => body(c, PARALLEL_QUESTION, { tools: [PRICE_TOOL], tool_choice: { type: 'any' } }),
    sources: [DOC.create, DOC.defineTools, DOC.pricing],
  }),
  messages({
    id: 'messages-tool-choice-none',
    probeSteps: [],
    serves: 'Forced finish (S§5.7): tools supplied with tool_choice none; accepted or rejected?',
    body: (c) => body(c, PRICE_QUESTION, { tools: [PRICE_TOOL], tool_choice: { type: 'none' } }),
    sources: [DOC.create, DOC.defineTools],
  }),
  messages({
    id: 'messages-json-schema',
    probeSteps: [5],
    serves: 'Structured output: output_config.format json_schema; the JSON in a text block',
    body: (c) =>
      body(c, RECORD_QUESTION, {
        output_config: {
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { brand: { type: 'string' }, model: { type: 'string' } },
              required: ['brand', 'model'],
              additionalProperties: false,
            },
          },
        },
      }),
    sources: [DOC.create, DOC.structured],
  }),
  messages({
    id: 'messages-thinking-summarized',
    probeSteps: [2, 6],
    serves: 'Adaptive thinking shown (display summarized), effort low: thinking_delta, signature',
    body: (c) =>
      body(
        c,
        PRIME_QUESTION,
        {
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: 'low' },
        },
        2048,
      ),
    sources: [DOC.create, DOC.thinking, DOC.streaming],
  }),
  messages({
    id: 'messages-thinking-disabled',
    probeSteps: [6],
    serves: 'Reasoning-off switch: thinking disabled at effort low (documented for Haiku 5.5)',
    body: (c) =>
      body(c, PRIME_QUESTION, {
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
      }),
    sources: [DOC.create, DOC.thinking, DOC.errors],
  }),
  messages({
    id: 'messages-cache-first',
    probeSteps: [7],
    serves: 'Prompt cache, first of a pair: cache_creation_input_tokens on a ~2.5K-token system',
    body: (c) => cacheBody(c, READY),
    sources: [DOC.create, DOC.caching],
  }),
  messages({
    id: 'messages-cache-second',
    probeSteps: [7],
    serves: 'Prompt cache, second of the pair: cache_read_input_tokens for the same prefix',
    mustFollow: 'messages-cache-first',
    body: (c) => cacheBody(c, 'Reply with the single word: done.'),
    sources: [DOC.create, DOC.caching],
  }),
  messages({
    id: 'messages-count-tokens',
    probeSteps: [],
    serves: 'Token counting (free): input_tokens for a system, one tool and one user turn',
    path: () => '/messages/count_tokens',
    body: (c) => ({
      model: c.model,
      system: SYSTEM,
      tools: [PRICE_TOOL],
      messages: user(PRICE_QUESTION),
    }),
    sources: [DOC.tokenCounting],
  }),
  messages({
    id: 'messages-error-bad-credentials',
    probeSteps: [],
    serves: 'Client: the error for a wrong x-api-key',
    body: (c) => body(c, READY),
    auth: 'invalid',
    sources: [DOC.errors],
  }),
  messages({
    id: 'messages-error-unknown-model',
    probeSteps: [],
    serves: 'Client: the error for a model id the API does not serve',
    body: (c) => body({ ...c, model: 'agentic-dasher-no-such-model' }, READY),
    sources: [DOC.errors],
  }),
  messages({
    id: 'messages-error-rejected-request',
    probeSteps: [],
    serves: 'Client: the error for a malformed request (messages is not an array)',
    body: (c) => ({ model: c.model, max_tokens: 64, messages: 'not-an-array', stream: true }),
    sources: [DOC.errors],
  }),
  messages({
    id: 'messages-error-sampling',
    probeSteps: [],
    serves: 'Client: a sampling parameter (temperature) under API version 2026-10-21',
    body: (c) => body(c, READY, { temperature: 0 }),
    sources: [DOC.versioning, DOC.thinking],
  }),
];
