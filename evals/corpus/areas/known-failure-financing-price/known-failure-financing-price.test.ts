import { expect, test } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import type { ParsePriceText, PriceTextResult } from './contract.ts';

// The subject is the price text reader (area price-text-parsing). Phase 1 replaces this stub.
const parsePriceText: ParsePriceText = () => notImplemented('parsePriceText');

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

test('known-failure-financing-price: no case holds a float', () => {
  expect(floats(area.cases, 'cases')).toEqual([]);
});
