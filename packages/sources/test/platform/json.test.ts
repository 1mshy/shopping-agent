// The bounded JSON reader the platform readers use: number tokens keep their source text, so a
// price is never taken from a float, and hostile input is refused, never thrown.
import { describe, expect, it } from 'vitest';
import {
  asArray,
  asObject,
  getField,
  JSON_MAX_DEPTH,
  JsonNumber,
  parseJson,
} from '../../src/platform/json.ts';

function value(text: string) {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error(`expected JSON, got ${parsed.error}`);
  return parsed.value;
}

describe('parseJson', () => {
  it('keeps the source text of every number token', () => {
    const root = asObject(value('{"a": 56.25, "b": 0.1, "c": 12345678901234567890, "d": -0}'));
    expect(root).not.toBeNull();
    const text = (key: string) => {
      const v = getField(root, key);
      return v instanceof JsonNumber ? v.text : null;
    };
    expect(text('a')).toBe('56.25');
    expect(text('b')).toBe('0.1');
    // Beyond the float range of exact integers: the text is untouched.
    expect(text('c')).toBe('12345678901234567890');
    expect(text('d')).toBe('-0');
  });

  it('reads strings with escapes, arrays, booleans and null', () => {
    const root = asObject(value('{"s":"a\\"b\\u00e9\\n","arr":[true,false,null,"x"]}'));
    expect(getField(root, 's')).toBe('a"bé\n');
    expect(asArray(getField(root, 'arr'))).toEqual([true, false, null, 'x']);
  });

  it('cannot be fooled into seeing a number: an object shaped like one stays an object', () => {
    const root = asObject(value('{"price":{"text":"999"}}'));
    expect(getField(root, 'price') instanceof JsonNumber).toBe(false);
  });

  it('keeps __proto__ as an ordinary own key', () => {
    const root = asObject(value('{"__proto__":{"polluted":1},"a":1}'));
    expect(getField(root, '__proto__')).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    ['an HTML challenge page', '<!DOCTYPE html><html><title>Just a moment...</title></html>'],
    ['truncated JSON', '{"variants":[{"id":1,"price":3699'],
    ['a trailing comma', '{"a":1,}'],
    ['a number with a leading zero', '{"a":0123}'],
    ['a bare word', '{"a":NaN}'],
    ['two documents', '{"a":1}{"b":2}'],
    ['a raw control character in a string', '{"a":"x\u0001y"}'],
    ['a bad escape', '{"a":"\\x41"}'],
    ['an empty body', ''],
  ])('refuses %s without throwing', (_name, text) => {
    const parsed = parseJson(text);
    expect(parsed.ok).toBe(false);
  });

  it('refuses nesting deeper than its limit', () => {
    const deep = `${'['.repeat(JSON_MAX_DEPTH + 1)}${']'.repeat(JSON_MAX_DEPTH + 1)}`;
    expect(parseJson(deep).ok).toBe(false);
    const fine = `${'['.repeat(JSON_MAX_DEPTH - 1)}${']'.repeat(JSON_MAX_DEPTH - 1)}`;
    expect(parseJson(fine).ok).toBe(true);
  });

  it('refuses text longer than its limit before reading it', () => {
    const parsed = parseJson('[1]', { maxLength: 2 });
    expect(parsed).toEqual({ ok: false, error: 'text of 3 characters is over the 2 limit' });
  });

  it('reads a payload of several MB', () => {
    const big = JSON.stringify({ description: 'x'.repeat(3_000_000), price: 1 });
    const root = asObject(value(big));
    expect(getField(root, 'price')).toBeInstanceOf(JsonNumber);
  });

  it('reads past a byte-order mark', () => {
    expect(parseJson('﻿{"a":1}').ok).toBe(true);
  });
});
