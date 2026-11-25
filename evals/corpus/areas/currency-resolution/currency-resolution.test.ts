import { resolveCurrency as resolveCurrencyImpl } from '@agentic-dasher/core';
import { expect, test } from 'vitest';
import { corpusTests } from '../../harness.ts';
import { area } from './area.ts';
import { asExpected, type CurrencyResolution, type ResolveCurrency } from './contract.ts';

const resolveCurrency: ResolveCurrency = resolveCurrencyImpl;

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

test('currency-resolution: no case holds a float', () => {
  expect(floats(area.cases, 'cases')).toEqual([]);
});
