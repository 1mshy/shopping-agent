import { expect, test } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import type { ListingUrlResult } from '../regional-url/contract.ts';
import { area } from './area.ts';
import {
  asExpected,
  type CurrencyResolution,
  type RegionalListingUrl,
  type ResolveCurrency,
} from './contract.ts';

// The subjects are regionalListingUrl (area regional-url) and resolveCurrency (area
// currency-resolution). Phase 1 replaces these stubs.
const regionalListingUrl: RegionalListingUrl = () => notImplemented('regionalListingUrl');
const resolveCurrency: ResolveCurrency = () => notImplemented('resolveCurrency');

corpusTests(
  area,
  (c): ListingUrlResult | CurrencyResolution =>
    c.subject === 'regionalListingUrl' ? regionalListingUrl(c.input) : resolveCurrency(c.input),
  (c, actual) => {
    if (c.subject === 'regionalListingUrl') expect(actual).toEqual(c.expected);
    else expect(asExpected(actual as CurrencyResolution)).toEqual(c.expected);
  },
);

/** Every number anywhere in the case data is an integer: no float stands in for money. */
function floats(value: unknown, path: string): string[] {
  if (typeof value === 'number') return Number.isInteger(value) ? [] : [path];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => floats(v, `${path}.${k}`));
}

test('known-failure-converted-currency: no case holds a float', () => {
  expect(floats(area.cases, 'cases')).toEqual([]);
});
