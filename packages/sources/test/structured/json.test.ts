import { describe, expect, it } from 'vitest';
import {
  JsonNumber,
  type JsonObject,
  type JsonValue,
  parseLenientJson,
} from '../../src/structured/json.ts';

function ok(text: string, limits?: { maxDepth?: number; maxNodes?: number }): JsonValue {
  const result = parseLenientJson(text, limits);
  if (!result.ok) throw new Error(`expected a value, got: ${result.error}`);
  return result.value;
}

function obj(value: JsonValue): JsonObject {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof JsonNumber
  ) {
    throw new Error('not an object');
  }
  return value;
}

describe('parseLenientJson', () => {
  it('keeps every number as its source text', () => {
    const o = obj(ok('{"a": 249, "b": 18.99, "c": -0.5, "d": 1e3, "e": 12345678901234567890}'));
    for (const [key, text] of [
      ['a', '249'],
      ['b', '18.99'],
      ['c', '-0.5'],
      ['d', '1e3'],
      ['e', '12345678901234567890'],
    ] as const) {
      const n = o[key];
      expect(n).toBeInstanceOf(JsonNumber);
      expect((n as JsonNumber).text).toBe(text);
    }
  });

  it('reads strings with escapes, escaped slashes and raw line breaks', () => {
    const o = obj(
      ok(
        '{"u": "https:\\/\\/x.ca\\/p?a=1\\u0026b=2", "t": "line one\nline\ttwo", "q": "say \\"hi\\""}',
      ),
    );
    expect(o.u).toBe('https://x.ca/p?a=1&b=2');
    expect(o.t).toBe('line one\nline\ttwo');
    expect(o.q).toBe('say "hi"');
  });

  it('tolerates trailing commas, comments, HTML comment and CDATA wrappers', () => {
    expect(obj(ok('{"a": [1, 2,], "b": {"c": 3,},}')).b).toBeTruthy();
    expect(obj(ok('/* x */ {"a": 1 // y\n}')).a).toBeInstanceOf(JsonNumber);
    expect(obj(ok('<!-- {"a": 1} -->')).a).toBeInstanceOf(JsonNumber);
    expect(obj(ok('//<![CDATA[\n{"a": 1}\n//]]>')).a).toBeInstanceOf(JsonNumber);
  });

  it('reads several top-level values as a list', () => {
    const v = ok('{"a": 1}\n{"b": 2}');
    expect(Array.isArray(v) && v.length).toBe(2);
  });

  it('builds objects with no prototype, so "__proto__" is an ordinary key', () => {
    const o = obj(ok('{"__proto__": {"polluted": true}, "constructor": 1}'));
    expect(Object.getPrototypeOf(o)).toBeNull();
    expect(Object.hasOwn(o, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses malformed text without throwing', () => {
    for (const text of [
      '',
      '{',
      '{"a": }',
      '{"a" 1}',
      '[1 2]',
      '{"a": tru}',
      '"open',
      'NaN',
      "{'a': 1}",
      '{"a": 1}}',
    ]) {
      const result = parseLenientJson(text);
      expect(result.ok).toBe(false);
    }
  });

  it('bounds the nesting depth and the number of values', () => {
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    const result = parseLenientJson(deep);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/deep/);
    expect(parseLenientJson('[[[1]]]', { maxDepth: 2 }).ok).toBe(false);
    expect(parseLenientJson('[[[1]]]', { maxDepth: 3 }).ok).toBe(true);
    const many = `[${'1,'.repeat(5000)}1]`;
    expect(parseLenientJson(many, { maxNodes: 1000 }).ok).toBe(false);
    expect(parseLenientJson(many, { maxNodes: 10_000 }).ok).toBe(true);
  });
});
