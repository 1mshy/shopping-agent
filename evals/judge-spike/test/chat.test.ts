import { describe, expect, it } from 'vitest';
import {
  buildRequestBody,
  costOf,
  extractJson,
  JUDGE_JSON_SCHEMA,
  nanosFromDecimal,
  normaliseUsage,
  parseVerdicts,
  providerCostText,
  type RequestOptions,
} from '../lib/chat.ts';

const base: RequestOptions = {
  model: 'some/model',
  rung: 'json_schema',
  maxTokensField: 'max_completion_tokens',
  maxOutputTokens: 1024,
  temperature: null,
  reasoningEffort: null,
};
const messages = [
  { role: 'system' as const, content: 'S' },
  { role: 'user' as const, content: 'U' },
];
const v = (id: string, relation = 'unknown', differingAttrs: string[] = []) => ({
  id,
  relation,
  differingAttrs,
  reason: 'r',
});
const reply = (verdicts: unknown[]) => JSON.stringify({ verdicts });
const ids3 = ['L1', 'L2', 'L3'];

describe('the request', () => {
  it('asks for strict json_schema output on the first rung', () => {
    const body = buildRequestBody(base, messages);
    expect(body).toEqual({
      model: 'some/model',
      messages,
      max_completion_tokens: 1024,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'judge_batch', strict: true, schema: JUDGE_JSON_SCHEMA },
      },
    });
  });

  it('asks for json_object on the second rung and for nothing on the text rung', () => {
    expect(buildRequestBody({ ...base, rung: 'json_object' }, messages).response_format).toEqual({
      type: 'json_object',
    });
    expect(buildRequestBody({ ...base, rung: 'text' }, messages)).not.toHaveProperty(
      'response_format',
    );
  });

  it('sends temperature, reasoning effort and the max-tokens field only as given', () => {
    const body = buildRequestBody(
      { ...base, temperature: 0, reasoningEffort: 'minimal', maxTokensField: 'max_tokens' },
      messages,
    );
    expect(body.temperature).toBe(0);
    expect(body.reasoning_effort).toBe('minimal');
    expect(body.max_tokens).toBe(1024);
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(buildRequestBody(base, messages)).not.toHaveProperty('temperature');
    expect(buildRequestBody(base, messages)).not.toHaveProperty('reasoning_effort');
  });
});

describe('reading the reply', () => {
  const ok = (content: string, rung: RequestOptions['rung'] = 'json_schema') =>
    parseVerdicts({ content, finishReason: 'stop', refusal: null }, rung, ids3);

  it('accepts one verdict per listing in any order', () => {
    const r = ok(reply([v('L2'), v('L1', 'exact'), v('L3', 'variant', ['capacity'])]));
    expect(r.ok).toBe(true);
  });

  it('refuses a reply whose count does not match the batch', () => {
    expect(ok(reply([v('L1'), v('L2')]))).toMatchObject({ ok: false, reason: 'count' });
  });

  it('refuses a reply whose ids do not match the batch', () => {
    expect(ok(reply([v('L1'), v('L2'), v('L4')]))).toMatchObject({ ok: false, reason: 'ids' });
  });

  it('refuses a repeated id, an extra key, exact with a difference and more than 15', () => {
    expect(ok(reply([v('L1'), v('L1'), v('L2')]))).toMatchObject({ ok: false, reason: 'schema' });
    expect(ok(reply([{ ...v('L1'), price: 3 }, v('L2'), v('L3')]))).toMatchObject({
      ok: false,
      reason: 'schema',
    });
    expect(ok(reply([v('L1', 'exact', ['colour']), v('L2'), v('L3')]))).toMatchObject({
      ok: false,
      reason: 'schema',
    });
    const sixteen = Array.from({ length: 16 }, (_, i) => `L${i + 1}`);
    const r = parseVerdicts(
      { content: reply(sixteen.map((id) => v(id))), finishReason: 'stop', refusal: null },
      'json_schema',
      sixteen,
    );
    expect(r).toMatchObject({ ok: false, reason: 'schema' });
  });

  it('refuses a truncated reply, an empty one and a refusal', () => {
    expect(
      parseVerdicts({ content: reply([]), finishReason: 'length', refusal: null }, 'text', ids3),
    ).toMatchObject({ ok: false, reason: 'truncated' });
    expect(
      parseVerdicts({ content: null, finishReason: 'stop', refusal: null }, 'text', ids3),
    ).toMatchObject({ ok: false, reason: 'no_content' });
    expect(
      parseVerdicts({ content: null, finishReason: 'stop', refusal: 'no' }, 'text', ids3),
    ).toMatchObject({ ok: false, reason: 'refusal' });
  });

  it('strips a think block on every rung', () => {
    const content = `<think>\nhmm {"verdicts":[]}\n</think>\n${reply([v('L1'), v('L2'), v('L3')])}`;
    expect(ok(content).ok).toBe(true);
    expect(ok(content, 'text').ok).toBe(true);
  });

  it('extracts the JSON object from prose only on the text rung', () => {
    const content = `Here you go:\n\`\`\`json\n${reply([v('L1'), v('L2'), v('L3')])}\n\`\`\`\nDone.`;
    expect(ok(content, 'text').ok).toBe(true);
    expect(ok(content, 'json_object')).toMatchObject({ ok: false, reason: 'not_json' });
    expect(ok(content, 'json_schema')).toMatchObject({ ok: false, reason: 'not_json' });
  });

  it('finds the first balanced object, braces inside strings included', () => {
    expect(extractJson('x {"a":"}{","b":{"c":1}} y {"d":2}')).toBe('{"a":"}{","b":{"c":1}}');
    expect(extractJson('no object')).toBeNull();
    expect(extractJson('{"open": ')).toBeNull();
  });
});

describe('usage', () => {
  it('normalises Chat Completions usage as run.ts does, with null for what is not reported', () => {
    expect(
      normaliseUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 5 },
      }),
    ).toEqual({
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.cache_read.input_tokens': 40,
      'gen_ai.usage.cache_write.input_tokens': 10,
      'gen_ai.usage.output_tokens': 20,
      'gen_ai.usage.reasoning.output_tokens': 5,
    });
    const none = normaliseUsage(undefined);
    expect(Object.values(none)).toEqual([null, null, null, null, null]);
    expect(normaliseUsage({ prompt_tokens: -1, completion_tokens: 1.5 })).toMatchObject({
      'gen_ai.usage.input_tokens': null,
      'gen_ai.usage.output_tokens': null,
    });
  });
});

describe('cost', () => {
  it('reads a provider cost from its decimal text exactly, rounding up past nine decimals', () => {
    expect(nanosFromDecimal('0')).toBe(0);
    expect(nanosFromDecimal('1')).toBe(1_000_000_000);
    expect(nanosFromDecimal('0.000123456')).toBe(123_456);
    expect(nanosFromDecimal('0.000123456789123')).toBe(123_457);
    expect(nanosFromDecimal('0.0000000001')).toBe(1);
    expect(nanosFromDecimal('1.5e-5')).toBe(15_000);
    expect(nanosFromDecimal('-0.1')).toBeNull();
    expect(nanosFromDecimal('abc')).toBeNull();
  });

  it('finds the provider cost as text in the body, or in the LiteLLM header', () => {
    expect(providerCostText('{"usage":{"cost":0.000123456789123}}', {})).toBe('0.000123456789123');
    expect(providerCostText('{"usage":{}}', { 'x-litellm-response-cost': '0.0002' })).toBe(
      '0.0002',
    );
    expect(providerCostText('{"usage":{}}', {})).toBeNull();
  });

  const usage = normaliseUsage({ prompt_tokens: 1000, completion_tokens: 100 });
  const prices = { inputNanosPerMTok: 150_000_000, outputNanosPerMTok: 600_000_000 };

  it('takes the provider’s cost when it is in the spend currency', () => {
    expect(
      costOf({ providerText: '0.0002', providerCurrency: 'USD', currency: 'USD', usage, prices }),
    ).toEqual({ source: 'provider', amountNanos: 200_000, currency: 'USD' });
  });

  it('else the settings prices, when usage was reported', () => {
    // 1,000 x 150,000,000 / 1e6 + 100 x 600,000,000 / 1e6 = 150,000 + 60,000.
    expect(
      costOf({ providerText: '0.0002', providerCurrency: null, currency: 'USD', usage, prices }),
    ).toEqual({ source: 'settings', amountNanos: 210_000, currency: 'USD' });
  });

  it('else unknown, with no amount: never zero', () => {
    const none = costOf({
      providerText: null,
      providerCurrency: null,
      currency: 'USD',
      usage: normaliseUsage(undefined),
      prices,
    });
    expect(none).toEqual({ source: 'none' });
    expect(none).not.toHaveProperty('amountNanos');
    expect(
      costOf({ providerText: null, providerCurrency: null, currency: 'USD', usage, prices: null }),
    ).toEqual({ source: 'none' });
  });
});
