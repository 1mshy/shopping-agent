import { parsePriceText as parsePriceTextImpl } from '@agentic-dasher/core';
import { expect, test } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { ParsePriceText, PriceTextResult } from './contract.ts';

const parsePriceText: ParsePriceText = parsePriceTextImpl;

corpusTests(
  area,
  (c): PriceTextResult => parsePriceText(c.input),
  (c, actual) => {
    if (c.expected.ok) {
      expect(actual).toEqual({ ok: true, money: c.expected.money });
    } else {
      expect(actual.ok).toBe(false);
      if (!actual.ok) expect(actual.refusal.code).toBe(c.expected.code);
    }
  },
);

/** Every number anywhere in the case data is an integer: no float stands in for money. */
function floats(value: unknown, path: string): string[] {
  if (typeof value === 'number') return Number.isInteger(value) ? [] : [path];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => floats(v, `${path}.${k}`));
}

test('price-text-parsing: no case holds a float', () => {
  expect(floats(area.cases, 'cases')).toEqual([]);
});
