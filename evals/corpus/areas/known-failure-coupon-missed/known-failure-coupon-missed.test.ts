import { expect, test } from 'vitest';
import { corpusTests, notImplemented } from '../../harness.ts';
import { area } from './area.ts';
import type { CouponReading, ReadCoupon } from './contract.ts';

// Phase 1 replaces this stub with the real function and marks the area implemented.
const readCoupon: ReadCoupon = () => notImplemented('readCoupon');

corpusTests(
  area,
  (c): CouponReading => readCoupon(c.input),
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

test('known-failure-coupon-missed: no case holds a float', () => {
  expect(floats(area.cases, 'cases')).toEqual([]);
});

test('known-failure-coupon-missed: amount off and effective add up to the sticker', () => {
  for (const c of area.cases) {
    if (c.expected.kind === 'none') continue;
    const { amountOff, effective } = c.expected;
    expect([amountOff.currency, effective.currency]).toEqual([
      c.input.sticker.currency,
      c.input.sticker.currency,
    ]);
    expect(amountOff.amountMinor + effective.amountMinor).toBe(c.input.sticker.amountMinor);
  }
});
