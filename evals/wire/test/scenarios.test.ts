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

  it('covers all seven probe steps (S§5.7)', () => {
    const steps = new Set(SCENARIOS.flatMap((s) => s.probeSteps));
    expect([...steps].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
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
    ]) {
      expect(scenarioById(id).id).toBe(id);
    }
    expect(() => scenarioById('nope')).toThrow();
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

  it('sends a byte-identical long prefix in the cache pair', () => {
    const first = JSON.stringify(scenarioById('cache-prefix-first').body(ctx));
    const second = JSON.stringify(scenarioById('cache-prefix-second').body(ctx));
    const prefixEnd = first.indexOf('"role":"user"');
    expect(prefixEnd).toBeGreaterThan(6000);
    expect(second.slice(0, prefixEnd)).toBe(first.slice(0, prefixEnd));
    expect(second).not.toBe(first);
  });
});
