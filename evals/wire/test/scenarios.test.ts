import { describe, expect, it } from 'vitest';
import { SERVER_FAMILIES } from '../format.ts';
import { appliesTo, SCENARIOS, scenarioById } from '../scenarios.ts';

const ctx = { model: 'author/some-model', maxTokensField: 'max_completion_tokens' } as const;

describe('scenario matrix', () => {
  it('has unique, well-formed ids and a documentation source for each request', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENARIOS) {
      expect(s.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.path(ctx)).toMatch(/^\//);
      expect(s.serves.length).toBeGreaterThan(10);
      expect(s.sources.length).toBeGreaterThan(0);
      for (const src of s.sources) expect(src).toMatch(/^https:\/\//);
      if (s.families !== 'all') for (const f of s.families) expect(SERVER_FAMILIES).toContain(f);
      const body = s.body(ctx);
      expect(body === null ? s.method : 'POST').toBe(s.method);
    }
  });

  it.each(['chat-completions', 'messages'] as const)(
    'covers all seven probe steps (S§5.7) on %s',
    (api) => {
      const steps = new Set(SCENARIOS.filter((s) => s.api === api).flatMap((s) => s.probeSteps));
      expect([...steps].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    },
  );

  it('names every mustFollow scenario, of the same wire shape', () => {
    for (const s of SCENARIOS.filter((x) => x.mustFollow !== undefined)) {
      expect(scenarioById(s.mustFollow as string).api).toBe(s.api);
    }
  });

  it('includes the requests the unit brief names', () => {
    for (const id of [
      'models-list',
      'side-door-props',
      'side-door-show',
      'side-door-model-endpoints',
      'stream-usage',
      'tool-auto',
      'tool-required-parallel',
      'json-schema-strict',
      'json-object',
      'reasoning-off',
      'reasoning-on',
      'cache-prefix-first',
      'cache-prefix-second',
      'stream-max-tokens',
      'stream-max-completion-tokens',
      'error-bad-credentials',
      'error-unknown-model',
      'error-rejected-request',
      'tool-choice-none',
    ]) {
      expect(scenarioById(id).id).toBe(id);
    }
    expect(() => scenarioById('nope')).toThrow();
  });

  it('records the forced-finish shape: tools supplied with tool_choice none (S§5.7)', () => {
    const body = scenarioById('tool-choice-none').body(ctx) as Record<string, unknown>;
    expect(body.tool_choice).toBe('none');
    expect(Array.isArray(body.tools) && body.tools.length > 0).toBe(true);
  });

  it('marks family-only side doors', () => {
    expect(appliesTo(scenarioById('side-door-props'), 'llamacpp')).toBe(true);
    expect(appliesTo(scenarioById('side-door-props'), 'ollama')).toBe(false);
    expect(appliesTo(scenarioById('side-door-show'), 'ollama')).toBe(true);
    expect(appliesTo(scenarioById('side-door-model-endpoints'), 'openrouter')).toBe(true);
    expect(appliesTo(scenarioById('models-list'), 'vllm')).toBe(true);
  });

  it('uses each max-tokens spelling where asked, and the session field elsewhere', () => {
    expect(scenarioById('stream-max-tokens').body(ctx)).toHaveProperty('max_tokens');
    expect(scenarioById('stream-max-tokens').body(ctx)).not.toHaveProperty('max_completion_tokens');
    expect(scenarioById('stream-max-completion-tokens').body(ctx)).toHaveProperty(
      'max_completion_tokens',
    );
    const legacy = { ...ctx, maxTokensField: 'max_tokens' } as const;
    expect(scenarioById('stream-usage').body(legacy)).toHaveProperty('max_tokens');
  });

  it.each([
    ['cache-prefix-first', 'cache-prefix-second'],
    ['messages-cache-first', 'messages-cache-second'],
  ])('sends a byte-identical long prefix in the cache pair %s', (a, b) => {
    const first = JSON.stringify(scenarioById(a).body(ctx));
    const second = JSON.stringify(scenarioById(b).body(ctx));
    const prefixEnd = first.indexOf('"role":"user"');
    expect(prefixEnd).toBeGreaterThan(6000);
    expect(second.slice(0, prefixEnd)).toBe(first.slice(0, prefixEnd));
    expect(second).not.toBe(first);
    expect(scenarioById(b).mustFollow).toBe(a);
  });
});

describe('Messages matrix', () => {
  const messages = SCENARIOS.filter((s) => s.api === 'messages');
  const body = (id: string) => scenarioById(id).body(ctx) as Record<string, unknown>;

  it('applies only to the anthropic family, and the Chat Completions matrix never does', () => {
    expect(messages.length).toBeGreaterThan(10);
    for (const s of messages) {
      expect(s.id).toMatch(/^messages-/);
      expect(appliesTo(s, 'anthropic')).toBe(true);
      for (const f of SERVER_FAMILIES.filter((x) => x !== 'anthropic')) {
        expect(appliesTo(s, f)).toBe(false);
      }
    }
    for (const s of SCENARIOS.filter((x) => x.api === 'chat-completions')) {
      expect(appliesTo(s, 'anthropic')).toBe(false);
    }
    // The compatibility endpoint takes the Chat Completions matrix, side doors excepted.
    expect(appliesTo(scenarioById('tool-choice-none'), 'anthropic-compat')).toBe(true);
    expect(appliesTo(scenarioById('side-door-props'), 'anthropic-compat')).toBe(false);
  });

  it('includes the requests the unit brief names', () => {
    for (const id of [
      'messages-models-list',
      'messages-stream',
      'messages-nonstream',
      'messages-tool-auto',
      'messages-tool-result-followup',
      'messages-tool-choice-none',
      'messages-json-schema',
      'messages-thinking-summarized',
      'messages-thinking-disabled',
      'messages-stream-max-tokens',
      'messages-cache-first',
      'messages-cache-second',
      'messages-count-tokens',
      'messages-error-bad-credentials',
      'messages-error-rejected-request',
      'messages-error-unknown-model',
    ]) {
      expect(scenarioById(id).api).toBe('messages');
    }
  });

  it('caps output with max_tokens, sends no sampling parameter and no prefill', () => {
    for (const s of messages.filter((x) => x.method === 'POST')) {
      const b = s.body(ctx) as Record<string, unknown>;
      expect(b).not.toHaveProperty('max_completion_tokens');
      if (s.id !== 'messages-error-sampling') {
        for (const p of ['temperature', 'top_p', 'top_k']) expect(b).not.toHaveProperty(p);
      }
      if (s.path(ctx) === '/messages' && Array.isArray(b.messages)) {
        expect(b.messages.at(-1)).toMatchObject({ role: 'user' });
        expect(typeof b.max_tokens).toBe('number');
      }
    }
    expect(body('messages-error-sampling')).toHaveProperty('temperature');
  });

  it('records the forced finish as tool_choice none with tools supplied', () => {
    expect(body('messages-tool-choice-none').tool_choice).toEqual({ type: 'none' });
    expect(Array.isArray(body('messages-tool-choice-none').tools)).toBe(true);
  });

  it('puts the cache breakpoint on the system block, and the token count on its own path', () => {
    expect(body('messages-cache-first').system).toEqual([
      expect.objectContaining({ cache_control: { type: 'ephemeral' } }),
    ]);
    expect(scenarioById('messages-count-tokens').path(ctx)).toBe('/messages/count_tokens');
    expect(body('messages-count-tokens')).not.toHaveProperty('max_tokens');
    expect(body('messages-nonstream').stream).toBe(false);
    expect(body('messages-stream').stream).toBe(true);
  });
});
