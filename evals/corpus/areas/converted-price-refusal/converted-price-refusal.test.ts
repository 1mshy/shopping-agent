import { expect, test } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import { asExpected, type CurrencyResolution, type ResolveCurrency } from './contract.ts';

// Phase 1 replaces this stub with the real function and marks the area implemented.
const resolveCurrency: ResolveCurrency = () => notImplemented('resolveCurrency');

corpusTests(
  area,
  (c): CurrencyResolution => resolveCurrency(c.input),
  (c, actual) => {
    expect(asExpected(actual)).toEqual(c.expected);
  },
);

/** Every number anywhere in the case data is an integer: no float stands in for money. */
function floats(value: unknown, path: string): string[] {
  if (typeof value === 'number') return Number.isInteger(value) ? [] : [path];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => floats(v, `${path}.${k}`));
}

test('converted-price-refusal: no case holds a float', () => {
  expect(floats(area.cases, 'cases')).toEqual([]);
});
