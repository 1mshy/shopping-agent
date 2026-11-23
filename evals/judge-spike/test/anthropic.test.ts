import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  buildMessagesParams,
  messageReplyParts,
  normaliseMessagesUsage,
  postMessages,
  sdkBaseUrl,
} from '../lib/anthropic.ts';
import { JUDGE_JSON_SCHEMA, parseVerdicts } from '../lib/chat.ts';
import { anthropicMessage, scriptedFetch, verdicts } from './scripted-judge.ts';

const messages = [
  { role: 'system' as const, content: 'S' },
  { role: 'user' as const, content: 'U' },
];
const base = { model: 'claude-haiku-5-5', rung: 'json_schema' as const, maxOutputTokens: 2048 };
const msg = (x: unknown) => x as Anthropic.Message;
// Made up.
const KEY = 'Hn5Kd9Wq3Zr7Xc2Vb8Tm';

describe('the Messages request', () => {
  it('puts the rules in system, asks for structured output and adaptive thinking, sends no sampling', () => {
    const p = buildMessagesParams({ ...base, effort: 'low' }, messages);
    expect(p).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 2048,
      system: 'S',
      messages: [{ role: 'user', content: 'U' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: JUDGE_JSON_SCHEMA } },
    });
    for (const k of ['temperature', 'top_p', 'top_k', 'budget_tokens', 'stream']) {
      expect(JSON.stringify(p)).not.toContain(k);
    }
  });

  it('sends no effort unless given and no format on the text rung', () => {
    expect(buildMessagesParams({ ...base, effort: null }, messages).output_config).toEqual({
      format: { type: 'json_schema', schema: JUDGE_JSON_SCHEMA },
    });
    expect(
      buildMessagesParams({ ...base, rung: 'text', effort: null }, messages).output_config,
    ).toBeUndefined();
  });

  it('keeps the repair conversation in order, ending on a user turn (no prefill)', () => {
    const p = buildMessagesParams({ ...base, effort: null }, [
      ...messages,
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'R' },
    ]);
    expect(p.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('gives the SDK the host without /v1, which it appends itself', () => {
    expect(sdkBaseUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com');
    expect(sdkBaseUrl('http://127.0.0.1:9/v1/')).toBe('http://127.0.0.1:9');
    expect(sdkBaseUrl('http://127.0.0.1:9')).toBe('http://127.0.0.1:9');
  });
});

describe('the SDK call', () => {
  const params = buildMessagesParams({ ...base, effort: 'low' }, messages);

  it('posts to /v1/messages once, and records the request without the key', async () => {
    const s = scriptedFetch(() => ({ body: anthropicMessage(verdicts(['L1'])) }));
    const r = await postMessages(s.fetch, 'http://127.0.0.1:9/v1', KEY, params, 5000);
    expect(r.ok).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(new URL(s.calls[0]?.url ?? '').pathname).toBe('/v1/messages');
    expect(s.calls[0]?.authorization).toBe(`Bearer ${KEY}`);
    expect(s.calls[0]?.body).toEqual(params);
    expect(r.sent?.path).toBe('/v1/messages');
    expect(JSON.stringify(r.sent)).not.toContain(KEY);
    expect(r.sent?.headers.authorization).toBe('[REDACTED]');
  });

  it('does not retry an HTTP error and keeps its body', async () => {
    const s = scriptedFetch(() => ({
      status: 529,
      body: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } },
    }));
    const r = await postMessages(s.fetch, 'http://127.0.0.1:9/v1', KEY, params, 5000);
    expect(s.calls).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, error: 'http_status', reply: { status: 529 } });
    expect(r.reply?.text).toContain('overloaded_error');
  });

  it('reports a transport failure by class name only', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed http://127.0.0.1:9');
    }) as unknown as typeof fetch;
    const r = await postMessages(failing, 'http://127.0.0.1:9/v1', KEY, params, 5000);
    expect(r).toMatchObject({ ok: false, error: 'transport', reply: null });
    expect(r.ok ? '' : r.errorName).not.toContain('127.0.0.1');
  });
});

describe('the Messages reply', () => {
  const ids = ['L1', 'L2'];

  it('reads the text blocks and skips thinking', () => {
    const parts = messageReplyParts(msg(anthropicMessage(verdicts(ids))));
    expect(parts).toEqual({ content: verdicts(ids), finishReason: 'end_turn', refusal: null });
    expect(parseVerdicts(parts, 'json_schema', ids).ok).toBe(true);
  });

  it('checks stop_reason first: a refusal is not read, whatever its content', () => {
    const parts = messageReplyParts(
      msg(
        anthropicMessage(verdicts(ids), {
          stopReason: 'refusal',
          stopDetails: { type: 'refusal', category: 'cyber', explanation: null },
        }),
      ),
    );
    expect(parts).toEqual({ content: null, finishReason: 'refusal', refusal: 'refusal:cyber' });
    expect(parseVerdicts(parts, 'json_schema', ids)).toMatchObject({
      ok: false,
      reason: 'refusal',
    });
  });

  it('reads max_tokens and a full context window as truncation', () => {
    for (const stopReason of ['max_tokens', 'model_context_window_exceeded']) {
      const parts = messageReplyParts(msg(anthropicMessage('{"verd', { stopReason })));
      expect(parseVerdicts(parts, 'json_schema', ids)).toMatchObject({
        ok: false,
        reason: 'truncated',
      });
    }
  });

  it('finds no content when only thinking came back', () => {
    const parts = messageReplyParts(msg(anthropicMessage(null)));
    expect(parseVerdicts(parts, 'json_schema', ids)).toMatchObject({
      ok: false,
      reason: 'no_content',
    });
  });
});

describe('Messages usage', () => {
  it('adds cache reads and writes to input, and keeps thinking as part of output', () => {
    expect(
      normaliseMessagesUsage({
        input_tokens: 700,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 5,
        output_tokens: 120,
        output_tokens_details: { thinking_tokens: 40 },
      }),
    ).toEqual({
      'gen_ai.usage.input_tokens': 805,
      'gen_ai.usage.cache_read.input_tokens': 100,
      'gen_ai.usage.cache_write.input_tokens': 5,
      'gen_ai.usage.output_tokens': 120,
      'gen_ai.usage.reasoning.output_tokens': 40,
    });
  });

  it('reports null, never zero, for what is missing', () => {
    expect(normaliseMessagesUsage({ input_tokens: 10, cache_read_input_tokens: null })).toEqual({
      'gen_ai.usage.input_tokens': 10,
      'gen_ai.usage.cache_read.input_tokens': null,
      'gen_ai.usage.cache_write.input_tokens': null,
      'gen_ai.usage.output_tokens': null,
      'gen_ai.usage.reasoning.output_tokens': null,
    });
    expect(normaliseMessagesUsage(undefined)['gen_ai.usage.input_tokens']).toBeNull();
  });
});
