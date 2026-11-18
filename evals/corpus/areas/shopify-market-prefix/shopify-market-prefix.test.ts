import { expect, test } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import type { MarketPrefixResult, MarketResultUrl, PickMarketPrefix } from './contract.ts';

// Phase 1 replaces these stubs with the real functions and marks the area implemented.
const pickMarketPrefix: PickMarketPrefix = () => notImplemented('pickMarketPrefix');
const marketResultUrl: MarketResultUrl = () => notImplemented('marketResultUrl');

corpusTests(
  area,
  (c): MarketPrefixResult | string =>
    c.subject === 'pickMarketPrefix' ? pickMarketPrefix(c.input) : marketResultUrl(c.input),
  (c, actual) => {
    expect(actual).toEqual(c.expected);
  },
);

/** Every number anywhere in the case data is an integer: no float stands in for money. */
function floats(value: unknown, path: string): string[] {
  if (typeof value === 'number') return Number.isInteger(value) ? [] : [path];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => floats(v, `${path}.${k}`));
}

test('shopify-market-prefix: no case holds a float', () => {
  expect(floats(area.cases, 'cases')).toEqual([]);
});
