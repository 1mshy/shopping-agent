import type { MinorUnitCurrency, Money } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import { type CouponInput, priceAfterPercentOff, readCoupon } from '../src/index.ts';

const money = (amountMinor: number, currency: MinorUnitCurrency): Money => ({
  amountMinor,
  currency,
});

describe('readCoupon', () => {
  it('takes a percentage off zero- and three-decimal currencies, half up', () => {
    expect(readCoupon({ sticker: money(1000, 'JPY'), text: 'Save 15% with coupon' })).toEqual({
      kind: 'percent_off',
      basisPoints: 1500,
      amountOff: money(150, 'JPY'),
      afterCoupon: money(850, 'JPY'),
    });
    // 12.345 KWD × 0.9 = 11.1105, half up to 11.111.
    expect(readCoupon({ sticker: money(12345, 'KWD'), text: 'Coupon: 10 % off' })).toEqual({
      kind: 'percent_off',
      basisPoints: 1000,
      amountOff: money(1234, 'KWD'),
      afterCoupon: money(11111, 'KWD'),
    });
  });

  it('reads an amount in the sticker currency with the coupon text locale-free', () => {
    expect(readCoupon({ sticker: money(5000, 'EUR'), text: 'Gutschein: 5,00 € Coupon' })).toEqual({
      kind: 'amount_off',
      amountOff: money(500, 'EUR'),
      afterCoupon: money(4500, 'EUR'),
    });
    expect(readCoupon({ sticker: money(5000, 'JPY'), text: '¥500 coupon' })).toEqual({
      kind: 'amount_off',
      amountOff: money(500, 'JPY'),
      afterCoupon: money(4500, 'JPY'),
    });
  });

  it('gives none for a misread', () => {
    const sticker = money(16773, 'CAD');
    for (const text of [
      'Apply €5 coupon',
      'Apply US$5 coupon',
      'Apply 5 coupon',
      '5% coupon 6%',
      'Save 12.345% with coupon',
      'Save 0% with coupon',
      'Apply $0 coupon',
      'Apply $1.299 coupon',
      'Apply 99¢ coupon',
      `Apply $5 coupon ${'x'.repeat(3000)}`,
    ]) {
      expect(readCoupon({ sticker, text }), text).toEqual({ kind: 'none' });
    }
  });

  it('gives none for a sticker that is no price, and never throws', () => {
    const odd: unknown[] = [
      { sticker: money(0, 'CAD'), text: 'Save 10% with coupon' },
      { sticker: money(-100, 'CAD'), text: 'Save 10% with coupon' },
      { sticker: { amountMinor: 16.5, currency: 'CAD' }, text: 'Save 10% with coupon' },
      { sticker: { amountMinor: 100, currency: 'unknown' }, text: 'Save 10% with coupon' },
      { sticker: null, text: 'Save 10% with coupon' },
      { sticker: money(100, 'CAD'), text: null },
      null,
    ];
    for (const input of odd) {
      expect(readCoupon(input as CouponInput)).toEqual({ kind: 'none' });
    }
  });
});

describe('priceAfterPercentOff', () => {
  const after = (amountMinor: number, basisPoints: number) => {
    const result = priceAfterPercentOff(money(amountMinor, 'USD'), basisPoints);
    if (!result.ok) throw new Error(result.refusal.code);
    return result.value.amountMinor;
  };

  it('rounds half up to the minor unit with exact arithmetic', () => {
    expect(after(1005, 1000)).toBe(905);
    expect(after(16773, 2000)).toBe(13418);
    expect(after(1, 5000)).toBe(1);
    expect(after(3, 5000)).toBe(2);
    expect(after(0, 5000)).toBe(0);
    expect(after(Number.MAX_SAFE_INTEGER, 0)).toBe(Number.MAX_SAFE_INTEGER);
    expect(after(Number.MAX_SAFE_INTEGER, 10_000)).toBe(0);
    // 9007199254740991 × 0.9999 = 9006298534815516.9009, rounded up.
    expect(after(Number.MAX_SAFE_INTEGER, 1)).toBe(9006298534815517);
  });

  it('refuses basis points out of range, a negative price and a currency without a minor unit', () => {
    for (const bp of [-1, 10_001, 12.5, Number.NaN]) {
      const result = priceAfterPercentOff(money(100, 'USD'), bp);
      expect(result.ok ? 'ok' : result.refusal.code, String(bp)).toBe('invalid_percentage');
    }
    const negative = priceAfterPercentOff(money(-100, 'USD'), 1000);
    expect(negative.ok ? 'ok' : negative.refusal.code).toBe('negative_amount');
    const unknown = priceAfterPercentOff({ amountMinor: 100, currency: 'unknown' }, 1000);
    expect(unknown.ok ? 'ok' : unknown.refusal.code).toBe('unknown_currency');
  });
});
