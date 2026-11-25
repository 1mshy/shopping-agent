import {
  regionalListingUrl as regionalListingUrlImpl,
  searchStorefront as searchStorefrontImpl,
} from '@agentic-dasher/core';
import { expect, test } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import type { ListingUrlResult, RegionalListingUrl, SearchStorefront } from './contract.ts';

const searchStorefront: SearchStorefront = searchStorefrontImpl;
const regionalListingUrl: RegionalListingUrl = regionalListingUrlImpl;

corpusTests(
  area,
  (c): string | ListingUrlResult =>
    c.subject === 'searchStorefront' ? searchStorefront(c.input) : regionalListingUrl(c.input),
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

test('regional-url: no case holds a float', () => {
  expect(floats(area.cases, 'cases')).toEqual([]);
});
