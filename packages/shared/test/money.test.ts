import { describe, expect, it } from 'vitest';
import { Money } from '../src/index.ts';

describe('Money schema', () => {
  it('is integer minor units plus an explicit currency', () => {
    expect(Money.parse({ amountMinor: 129900, currency: 'USD' })).toEqual({
      amountMinor: 129900,
      currency: 'USD',
    });
    expect(Money.parse({ amountMinor: 0, currency: 'JPY' })).toEqual({
      amountMinor: 0,
      currency: 'JPY',
    });
    expect(Money.parse({ amountMinor: -50, currency: 'EUR' }).amountMinor).toBe(-50);
  });

  it('has no default currency', () => {
    expect(Money.safeParse({ amountMinor: 100 }).success).toBe(false);
    expect(Money.safeParse({ amountMinor: 100, currency: undefined }).success).toBe(false);
    expect(Money.safeParse({ amountMinor: 100, currency: '' }).success).toBe(false);
  });

  it('refuses unknown currency and codes without a minor unit', () => {
    for (const currency of ['unknown', 'XAU', 'XDR', 'XXX', 'XTS', 'usd', 'ABC']) {
      expect(Money.safeParse({ amountMinor: 100, currency }).success).toBe(false);
    }
  });

  it('refuses anything but a safe integer amount', () => {
    for (const amountMinor of [
      12.99,
      0.1 + 0.2,
      2 ** 53,
      -(2 ** 53),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1299',
      1299n,
      null,
    ]) {
      expect(Money.safeParse({ amountMinor, currency: 'USD' }).success).toBe(false);
    }
    expect(Money.safeParse({ amountMinor: Number.MAX_SAFE_INTEGER, currency: 'USD' }).success).toBe(
      true,
    );
    expect(Money.safeParse({ amountMinor: Number.MIN_SAFE_INTEGER, currency: 'USD' }).success).toBe(
      true,
    );
  });
});
