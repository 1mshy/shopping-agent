// The scenario matrix: the named requests a recording session sends. Each one serves a step of
// the seven-step capability probe (S§5.7) or a client behaviour, and cites the documentation
// its request shape was taken from (read 2026-11-17). Prompts are neutral and short; nothing
// here asserts what a server answers. That is what the recordings are for.
import type { JsonValue, ServerFamily } from './format.ts';

export type MaxTokensField = 'max_completion_tokens' | 'max_tokens';
export interface ScenarioContext {
  model: string;
  /** The field used to cap output in scenarios that are not about the field itself. */
  maxTokensField: MaxTokensField;
}

export interface Scenario {
  readonly id: string;
  /** Probe steps (S§5.7, 1-7) this exchange is evidence for; empty for client behaviour. */
  readonly probeSteps: readonly number[];
  readonly serves: string;
  /** 'all', or the only server families where the request makes sense. */
  readonly families: 'all' | readonly ServerFamily[];
  readonly method: 'GET' | 'POST';
  /** 'base': path is appended to the base URL (e.g. …/v1). 'origin': from the server root. */
  readonly root: 'base' | 'origin';
  readonly path: (c: ScenarioContext) => string;
  readonly body: (c: ScenarioContext) => JsonValue | null;
  /** 'invalid' sends a fixed wrong key instead of the session's key. */
  readonly auth: 'session' | 'invalid';
  readonly sources: readonly string[];
}

const DOC = {
  openaiChat:
    'https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create',
  openaiModels: 'https://developers.openai.com/api/reference/resources/models/methods/list',
  openaiCaching: 'https://developers.openai.com/api/docs/guides/prompt-caching',
  openrouterParams: 'https://openrouter.ai/docs/api/reference/parameters',
  openrouterReasoning: 'https://openrouter.ai/docs/guides/best-practices/reasoning-tokens',
  openrouterModels: 'https://openrouter.ai/docs/api-reference/list-available-models',
  llamacppServer: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md',
  ollamaApi: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
  ollamaOpenai: 'https://docs.ollama.com/api/openai-compatibility',
  vllmServing: 'https://docs.vllm.ai/en/latest/serving/online_serving/',
  vllmReasoning: 'https://docs.vllm.ai/en/latest/features/reasoning_outputs.html',
} as const;

const SYSTEM = 'You are a terse assistant used to test an API client. Follow instructions exactly.';
const STREAM = { stream: true, stream_options: { include_usage: true } };
const READY = 'Reply with the single word: ready.';

const messages = (user: string, system = SYSTEM): JsonValue => [
  { role: 'system', content: system },
  { role: 'user', content: user },
];
const chat = (c: ScenarioContext, user: string, extra: Record<string, JsonValue>, max = 64) => ({
  model: c.model,
  messages: messages(user),
  [c.maxTokensField]: max,
  ...STREAM,
  ...extra,
});

const PRICE_TOOL = {
  type: 'function',
  function: {
    name: 'get_price',
    description: 'Look up the current listed price of a product at one store.',
    parameters: {
      type: 'object',
      properties: { product: { type: 'string' }, store: { type: 'string' } },
      required: ['product', 'store'],
      additionalProperties: false,
    },
  },
};
const PRICE_QUESTION = 'What does the Kindle Paperwhite cost at Amazon? Use the tool.';

// About 2,500 tokens of byte-stable text, above the 1,024-token minimum cacheable prefix that
// OpenAI documents; other servers' thresholds are what the recordings will show.
const LONG_PREFIX = [
  SYSTEM,
  ...Array.from(
    { length: 100 },
    (_, i) =>
      `Reference note ${String(i + 1).padStart(3, '0')}: a product listing is identified by brand, model, variant, condition and seller; keep these separate.`,
  ),
].join('\n');

const COUNT = 'Count from 1 to 200, separated by spaces.';

type CompletionSpec = Omit<Scenario, 'method' | 'root' | 'path' | 'auth' | 'families'> &
  Partial<Pick<Scenario, 'auth' | 'families'>>;

/** A POST to {base}/chat/completions with the session key, for every family unless narrowed. */
const completion = (spec: CompletionSpec): Scenario => ({
  method: 'POST',
  root: 'base',
  path: () => '/chat/completions',
  auth: 'session',
  families: 'all',
  ...spec,
});

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'models-list',
    probeSteps: [1],
    serves: 'Model list: model ids, and context length where the server puts it in the list',
    families: 'all',
    method: 'GET',
    root: 'base',
    path: () => '/models',
    body: () => null,
    auth: 'session',
    sources: [DOC.openaiModels, DOC.vllmServing, DOC.ollamaOpenai],
  },
  {
    id: 'side-door-props',
    probeSteps: [1],
    serves: 'llama.cpp /props: n_ctx under default_generation_settings, build_info, template caps',
    families: ['llamacpp'],
    method: 'GET',
    root: 'origin',
    path: () => '/props',
    body: () => null,
    auth: 'session',
    sources: [DOC.llamacppServer],
  },
  {
    id: 'side-door-show',
    probeSteps: [1],
    serves: 'Ollama /api/show: model_info["<arch>.context_length"] and capabilities',
    families: ['ollama'],
    method: 'POST',
    root: 'origin',
    path: () => '/api/show',
    body: (c) => ({ model: c.model }),
    auth: 'session',
    sources: [DOC.ollamaApi],
  },
  {
    id: 'side-door-model-endpoints',
    probeSteps: [1],
    serves: 'OpenRouter per-provider endpoints for the model: context_length and parameters',
    families: ['openrouter'],
    method: 'GET',
    root: 'base',
    path: (c) => `/models/${c.model}/endpoints`,
    body: () => null,
    auth: 'session',
    sources: [DOC.openrouterModels],
  },
  completion({
    id: 'stream-usage',
    probeSteps: [2],
    serves: 'Plain streamed completion with include_usage: final usage chunk, tok/s, SSE framing',
    body: (c) => chat(c, READY, {}),
    sources: [DOC.openaiChat],
  }),
  completion({
    id: 'nonstream-usage',
    probeSteps: [],
    serves: 'Client: the same request without streaming, for the non-streamed usage shape',
    body: (c) => ({ model: c.model, messages: messages(READY), [c.maxTokensField]: 64 }),
    sources: [DOC.openaiChat],
  }),
  completion({
    id: 'stream-max-completion-tokens',
    probeSteps: [2],
    serves: 'maxTokensField: is max_completion_tokens honoured (finish_reason length at 16)?',
    body: (c) => ({
      model: c.model,
      messages: messages(COUNT),
      max_completion_tokens: 16,
      ...STREAM,
    }),
    sources: [DOC.openaiChat, DOC.openrouterParams],
  }),
  completion({
    id: 'stream-max-tokens',
    probeSteps: [2],
    serves: 'maxTokensField: is the deprecated max_tokens honoured, ignored or rejected?',
    body: (c) => ({ model: c.model, messages: messages(COUNT), max_tokens: 16, ...STREAM }),
    sources: [DOC.openaiChat, DOC.ollamaOpenai],
  }),
  completion({
    id: 'developer-role',
    probeSteps: [2],
    serves: 'supportsDeveloperRole: a developer message in place of the system message',
    body: (c) => ({
      ...chat(c, READY, {}),
      messages: [
        { role: 'developer', content: SYSTEM },
        { role: 'user', content: READY },
      ],
    }),
    sources: [DOC.openaiChat],
  }),
  completion({
    id: 'tool-auto',
    probeSteps: [3],
    serves: 'supportsTools: one tool, tool_choice auto, streamed tool-call deltas',
    body: (c) => chat(c, PRICE_QUESTION, { tools: [PRICE_TOOL], tool_choice: 'auto' }, 256),
    sources: [DOC.openaiChat, DOC.openrouterParams],
  }),
  completion({
    id: 'tool-result-followup',
    probeSteps: [3],
    serves: 'requiresToolResultName: a tool result sent back with tool_call_id and no name',
    body: (c) => ({
      ...chat(c, PRICE_QUESTION, { tools: [PRICE_TOOL] }, 128),
      messages: [
        ...(messages(PRICE_QUESTION) as JsonValue[]),
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_wire_1',
              type: 'function',
              function: {
                name: 'get_price',
                arguments: '{"product":"Kindle Paperwhite","store":"Amazon"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_wire_1', content: '{"status":"not_found"}' },
      ],
    }),
    sources: [DOC.openaiChat],
  }),
  completion({
    id: 'tool-required-parallel',
    probeSteps: [4],
    serves: 'tool_choice required plus parallel_tool_calls: two calls in one turn, or not',
    body: (c) =>
      chat(
        c,
        'Get the price of the Kindle Paperwhite at Amazon and at Best Buy, in parallel.',
        { tools: [PRICE_TOOL], tool_choice: 'required', parallel_tool_calls: true },
        256,
      ),
    // Ollama documents tool_choice as unsupported; recording it there shows what happens.
    sources: [DOC.openaiChat, DOC.openrouterParams, DOC.ollamaOpenai, DOC.vllmServing],
  }),
  completion({
    id: 'json-schema-strict',
    probeSteps: [5],
    serves: 'supportsJsonSchema / supportsStrictMode: response_format json_schema, strict true',
    body: (c) =>
      chat(
        c,
        'Describe the Kindle Paperwhite as a product record.',
        {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'product_record',
              strict: true,
              schema: {
                type: 'object',
                properties: { brand: { type: 'string' }, model: { type: 'string' } },
                required: ['brand', 'model'],
                additionalProperties: false,
              },
            },
          },
        },
        128,
      ),
    sources: [DOC.openaiChat],
  }),
  completion({
    id: 'json-object',
    probeSteps: [5],
    serves: 'JSON mode: response_format json_object, with the prompt asking for JSON',
    body: (c) =>
      chat(
        c,
        'Return a JSON object with keys "brand" and "model" for the Kindle Paperwhite.',
        { response_format: { type: 'json_object' } },
        128,
      ),
    sources: [DOC.openaiChat, DOC.openrouterParams],
  }),
  completion({
    id: 'reasoning-off',
    probeSteps: [6],
    serves: 'Reasoning-off switch: reasoning_effort "none", accepted, ignored or rejected',
    body: (c) => chat(c, READY, { reasoning_effort: 'none' }),
    sources: [DOC.openaiChat, DOC.openrouterParams, DOC.ollamaOpenai, DOC.vllmReasoning],
  }),
  completion({
    id: 'reasoning-off-openrouter',
    probeSteps: [6],
    serves: 'OpenRouter reasoning object: reasoning.effort "none" disables reasoning',
    families: ['openrouter'],
    body: (c) => chat(c, READY, { reasoning: { effort: 'none' } }),
    sources: [DOC.openrouterReasoning],
  }),
  completion({
    id: 'reasoning-off-template-kwargs',
    probeSteps: [6],
    serves: 'vLLM chat_template_kwargs.enable_thinking false (Qwen3-style templates)',
    families: ['vllm'],
    body: (c) => chat(c, READY, { chat_template_kwargs: { enable_thinking: false } }),
    sources: [DOC.vllmReasoning],
  }),
  completion({
    id: 'reasoning-on',
    probeSteps: [2, 6],
    serves: 'thinkingFormat: which reasoning field streams (reasoning, reasoning_content, <think>)',
    body: (c) =>
      chat(c, 'Is 391 a prime number? Answer yes or no.', { reasoning_effort: 'low' }, 1024),
    sources: [DOC.openaiChat, DOC.openrouterReasoning, DOC.vllmReasoning, DOC.llamacppServer],
  }),
  ...(['first', 'second'] as const).map(
    (which): Scenario =>
      completion({
        id: `cache-prefix-${which}`,
        probeSteps: [7],
        serves: `Prefix cache, ${which} of a pair with a byte-stable long prefix: usage.prompt_tokens_details.cached_tokens`,
        body: (c) => ({
          model: c.model,
          messages: messages(
            which === 'first' ? READY : 'Reply with the single word: done.',
            LONG_PREFIX,
          ),
          [c.maxTokensField]: 16,
          ...STREAM,
        }),
        sources: [DOC.openaiChat, DOC.openaiCaching],
      }),
  ),
  completion({
    id: 'error-bad-credentials',
    probeSteps: [],
    serves: 'Client: the error for a wrong key (only meaningful where the server checks keys)',
    body: (c) => chat(c, READY, {}),
    auth: 'invalid',
    sources: [DOC.openaiChat, DOC.llamacppServer],
  }),
  completion({
    id: 'error-unknown-model',
    probeSteps: [],
    serves: 'Client: the error for a model id the server does not serve',
    body: (c) => chat({ ...c, model: 'agentic-dasher-no-such-model' }, READY, {}),
    sources: [DOC.openaiChat],
  }),
  completion({
    id: 'error-rejected-request',
    probeSteps: [],
    serves: 'Client: the error for a malformed request (messages is not an array)',
    body: (c) => ({ model: c.model, messages: 'not-an-array', ...STREAM }),
    sources: [DOC.openaiChat],
  }),
];

export function scenarioById(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario "${id}"`);
  return s;
}

export function appliesTo(s: Scenario, family: ServerFamily): boolean {
  return s.families === 'all' || s.families.includes(family);
}
