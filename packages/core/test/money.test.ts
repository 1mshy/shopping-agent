import { type Currency, Money } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  MAX_DECIMAL_LENGTH,
  MONEY_REFUSAL_CODES,
  type MoneyResult,
  minorUnitExponent,
  moneyFromDecimal,
  moneyToDecimal,
  subtractMoney,
} from '../src/index.ts';

function value<T>(result: MoneyResult<T>): T {
  if (!result.ok) throw new Error(`refused: ${result.refusal.code} (${result.refusal.detail})`);
  return result.value;
}

function refusal<T>(result: MoneyResult<T>): string {
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.value)}`);
  expect(MONEY_REFUSAL_CODES).toContain(result.refusal.code);
  expect(result.refusal.detail).not.toBe('');
  // Details are bounded whatever the input, because page-derived text will reach these (S§2.7).
  expect(result.refusal.detail.length).toBeLessThanOrEqual(100);
  return result.refusal.code;
}

/** Bypasses the compiler, as data from a database row or a JSON body would. */
const raw = (amountMinor: unknown, currency: unknown) =>
  ({ amountMinor, currency }) as unknown as Money;

describe('minorUnitExponent', () => {
  it('reads the ISO 4217 table', () => {
    expect(value(minorUnitExponent('USD'))).toBe(2);
    expect(value(minorUnitExponent('JPY'))).toBe(0);
    expect(value(minorUnitExponent('BHD'))).toBe(3);
    expect(value(minorUnitExponent('CLF'))).toBe(4);
  });

  it('refuses unknown, codes without a minor unit, and non-codes', () => {
    expect(refusal(minorUnitExponent('unknown'))).toBe('unknown_currency');
    expect(refusal(minorUnitExponent('XAU'))).toBe('no_minor_unit');
    expect(refusal(minorUnitExponent('XXX'))).toBe('no_minor_unit');
    for (const bad of ['ABC', 'usd', '', 'toString', '__proto__', 'constructor']) {
      expect(refusal(minorUnitExponent(bad as Currency))).toBe('not_a_currency');
    }
  });
});

describe('moneyFromDecimal', () => {
  const ok = (decimal: string, currency: Currency) => value(moneyFromDecimal(decimal, currency));

  it('parses canonical machine decimals into minor units', () => {
    expect(ok('1299', 'USD')).toEqual({ amountMinor: 129900, currency: 'USD' });
    expect(ok('1299.00', 'USD')).toEqual({ amountMinor: 129900, currency: 'USD' });
    expect(ok('1299.5', 'USD')).toEqual({ amountMinor: 129950, currency: 'USD' });
    expect(ok('0.5', 'USD')).toEqual({ amountMinor: 50, currency: 'USD' });
    expect(ok('0', 'EUR')).toEqual({ amountMinor: 0, currency: 'EUR' });
    expect(ok('0.01', 'EUR')).toEqual({ amountMinor: 1, currency: 'EUR' });
  });

  it('is exact where binary floating point is not', () => {
    // Each pair shows the float computation (Number(x) * 10 ** e) going wrong, then the exact one.
    expect(1.15 * 100).not.toBe(115);
    expect(ok('1.15', 'USD').amountMinor).toBe(115);
    expect(4.35 * 100).not.toBe(435);
    expect(ok('4.35', 'USD').amountMinor).toBe(435);
    expect(1.005 * 1000).not.toBe(1005);
    expect(ok('1.005', 'BHD').amountMinor).toBe(1005);
    expect(4.015 * 1000).not.toBe(4015);
    expect(ok('4.015', 'KWD').amountMinor).toBe(4015);
    expect(1.0009 * 10000).not.toBe(10009);
    expect(ok('1.0009', 'CLF').amountMinor).toBe(10009);
    // Number('9007199254740993') is 9007199254740992: a float parse loses it (refused below).
    expect(Number('9007199254740993')).toBe(2 ** 53);
    expect(ok('0.3', 'USD').amountMinor).toBe(30);
    expect(ok('0.0001', 'CLF').amountMinor).toBe(1);
    expect(ok('9.9999', 'UYW').amountMinor).toBe(99999);
    expect(ok('1299', 'JPY').amountMinor).toBe(1299);
  });

  it('accepts zero padding beyond the exponent, which loses nothing', () => {
    expect(ok('1299.00', 'JPY').amountMinor).toBe(1299);
    expect(ok('12.990', 'USD').amountMinor).toBe(1299);
    expect(ok('1.00000', 'BHD').amountMinor).toBe(1000);
  });

  it('refuses excess fraction digits instead of rounding them', () => {
    expect(refusal(moneyFromDecimal('1.005', 'USD'))).toBe('excess_precision');
    expect(refusal(moneyFromDecimal('12.999', 'EUR'))).toBe('excess_precision');
    expect(refusal(moneyFromDecimal('12.9901', 'USD'))).toBe('excess_precision');
    expect(refusal(moneyFromDecimal('1299.5', 'JPY'))).toBe('excess_precision');
    expect(refusal(moneyFromDecimal('0.0005', 'BHD'))).toBe('excess_precision');
    expect(refusal(moneyFromDecimal('1.00001', 'CLF'))).toBe('excess_precision');
  });

  it('handles the safe-integer boundary and refuses past it', () => {
    expect(ok('9007199254740991', 'JPY').amountMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect(ok('90071992547409.91', 'USD').amountMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect(ok('9007199254740.991', 'BHD').amountMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect(ok('900719925474.0991', 'CLF').amountMinor).toBe(Number.MAX_SAFE_INTEGER);
    expect(ok('-90071992547409.91', 'USD').amountMinor).toBe(Number.MIN_SAFE_INTEGER);
    // 2 ** 53 + 1 rounds to 2 ** 53 as a float: refusing is the only way not to lose it.
    for (const [decimal, currency] of [
      ['9007199254740992', 'JPY'],
      ['9007199254740993', 'JPY'],
      ['90071992547409.92', 'USD'],
      ['-90071992547409.92', 'USD'],
      ['9007199254740.992', 'BHD'],
      ['900719925474.0992', 'CLF'],
      ['99999999999999999999999', 'USD'],
    ] as const) {
      expect(refusal(moneyFromDecimal(decimal, currency))).toBe('out_of_range');
    }
  });

  it('accepts a leading minus and never yields negative zero', () => {
    expect(ok('-12.34', 'USD').amountMinor).toBe(-1234);
    expect(Object.is(ok('-0', 'USD').amountMinor, 0)).toBe(true);
    expect(Object.is(ok('-0.00', 'USD').amountMinor, 0)).toBe(true);
  });

  it('refuses anything that is not a canonical machine decimal', () => {
    for (const bad of [
      '',
      ' 12',
      '12 ',
      '+12',
      '12.',
      '.5',
      '-.5',
      '--1',
      '01',
      '00.5',
      '1e3',
      '1E3',
      '0x10',
      '1_000',
      '1,299.00',
      '1.299,00',
      '1 299',
      '$12',
      '12 EUR',
      'NaN',
      'Infinity',
      '-',
      '١٢٣',
      '１２',
    ]) {
      expect(refusal(moneyFromDecimal(bad, 'USD'))).toBe('malformed_decimal');
    }
    for (const bad of [12.5, 1299, null, undefined]) {
      expect(refusal(moneyFromDecimal(bad as unknown as string, 'USD'))).toBe('malformed_decimal');
    }
  });

  it('refuses unknown currency and codes without an exponent', () => {
    expect(refusal(moneyFromDecimal('12.34', 'unknown'))).toBe('unknown_currency');
    expect(refusal(moneyFromDecimal('12', 'unknown'))).toBe('unknown_currency');
    expect(refusal(moneyFromDecimal('1', 'XAU'))).toBe('no_minor_unit');
    expect(refusal(moneyFromDecimal('1', 'XDR'))).toBe('no_minor_unit');
    expect(refusal(moneyFromDecimal('1', 'ABC' as Currency))).toBe('not_a_currency');
  });

  it('returns values the Money schema accepts', () => {
    expect(Money.parse(ok('19.99', 'GBP'))).toEqual({ amountMinor: 1999, currency: 'GBP' });
  });
});

describe('moneyToDecimal', () => {
  const ok = (amountMinor: number, currency: Currency) =>
    value(moneyToDecimal(raw(amountMinor, currency)));

  it('writes canonical decimals with exactly the currency exponent', () => {
    expect(ok(129900, 'USD')).toBe('1299.00');
    expect(ok(1, 'USD')).toBe('0.01');
    expect(ok(0, 'USD')).toBe('0.00');
    expect(ok(-5, 'USD')).toBe('-0.05');
    expect(ok(-1234, 'EUR')).toBe('-12.34');
    expect(ok(1299, 'JPY')).toBe('1299');
    expect(ok(1, 'BHD')).toBe('0.001');
    expect(ok(1, 'CLF')).toBe('0.0001');
    expect(ok(Number.MAX_SAFE_INTEGER, 'USD')).toBe('90071992547409.91');
    expect(ok(Number.MIN_SAFE_INTEGER, 'KWD')).toBe('-9007199254740.991');
  });

  it('round-trips with moneyFromDecimal', () => {
    const amounts = [0, 1, 9, 10, 99, 100, 101, 1999, 123456789, Number.MAX_SAFE_INTEGER];
    for (const currency of ['USD', 'JPY', 'BHD', 'CLF'] as const) {
      for (const amount of [...amounts, ...amounts.map((a) => -a)]) {
        const decimal = ok(amount, currency);
        expect(value(moneyFromDecimal(decimal, currency)).amountMinor).toBe(
          amount === 0 ? 0 : amount,
        );
      }
    }
  });

  it('refuses unknown currency, codes without an exponent and non-integer amounts', () => {
    expect(refusal(moneyToDecimal(raw(100, 'unknown')))).toBe('unknown_currency');
    expect(refusal(moneyToDecimal(raw(100, 'XAU')))).toBe('no_minor_unit');
    expect(refusal(moneyToDecimal(raw(100, 'ABC')))).toBe('not_a_currency');
    for (const bad of [1.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, '100', 100n]) {
      expect(refusal(moneyToDecimal(raw(bad, 'USD')))).toBe('not_safe_integer');
    }
  });
});

describe('same-currency comparison and arithmetic', () => {
  const usd = (amountMinor: number) => raw(amountMinor, 'USD');

  it('compares within one currency', () => {
    expect(value(compareMoney(usd(100), usd(200)))).toBe(-1);
    expect(value(compareMoney(usd(200), usd(200)))).toBe(0);
    expect(value(compareMoney(usd(300), usd(200)))).toBe(1);
    expect(value(compareMoney(usd(-1), usd(0)))).toBe(-1);
  });

  it('adds and subtracts within one currency', () => {
    expect(value(addMoney(usd(1999), usd(1)))).toEqual({ amountMinor: 2000, currency: 'USD' });
    expect(value(subtractMoney(usd(1999), usd(2000)))).toEqual({
      amountMinor: -1,
      currency: 'USD',
    });
    expect(value(addMoney(raw(1, 'JPY'), raw(2, 'JPY')))).toEqual({
      amountMinor: 3,
      currency: 'JPY',
    });
  });

  it('refuses to mix currencies instead of converting', () => {
    const eur = raw(100, 'EUR');
    expect(refusal(compareMoney(usd(100), eur))).toBe('currency_mismatch');
    expect(refusal(addMoney(usd(100), eur))).toBe('currency_mismatch');
    expect(refusal(subtractMoney(eur, usd(100)))).toBe('currency_mismatch');
  });

  it('refuses unknown currency even when both sides are unknown', () => {
    const unknown = raw(100, 'unknown');
    expect(refusal(compareMoney(unknown, unknown))).toBe('unknown_currency');
    expect(refusal(addMoney(unknown, unknown))).toBe('unknown_currency');
    expect(refusal(subtractMoney(usd(1), unknown))).toBe('unknown_currency');
    expect(refusal(compareMoney(raw(1, 'XAU'), raw(1, 'XAU')))).toBe('no_minor_unit');
  });

  it('refuses results outside the safe-integer range', () => {
    const max = usd(Number.MAX_SAFE_INTEGER);
    const min = usd(Number.MIN_SAFE_INTEGER);
    expect(refusal(addMoney(max, usd(1)))).toBe('out_of_range');
    expect(refusal(subtractMoney(min, usd(1)))).toBe('out_of_range');
    expect(refusal(subtractMoney(max, min))).toBe('out_of_range');
    expect(value(addMoney(max, usd(-1))).amountMinor).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(value(addMoney(max, min)).amountMinor).toBe(0);
  });

  it('refuses non-integer amounts', () => {
    expect(refusal(addMoney(usd(0.5), usd(1)))).toBe('not_safe_integer');
    expect(refusal(compareMoney(usd(1), usd(2 ** 53)))).toBe('not_safe_integer');
  });
});

describe('round trip from canonical strings', () => {
  // Seeded linear congruential generator: the same inputs on every run, no dependency.
  function generator(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
  }

  it('reads and writes back generated canonical decimals unchanged', () => {
    const next = generator(0x5eed);
    const digits = (n: number) => Array.from({ length: n }, () => String(next() % 10)).join('');
    let checked = 0;
    for (const [currency, e] of [
      ['JPY', 0],
      ['USD', 2],
      ['BHD', 3],
      ['CLF', 4],
    ] as const) {
      for (let i = 0; i < 500; i++) {
        const wholeLength = next() % (17 - e); // up to 16 digits in all
        const whole = wholeLength === 0 ? '0' : String(1 + (next() % 9)) + digits(wholeLength - 1);
        const fraction = digits(e);
        if (BigInt(whole + fraction) > BigInt(Number.MAX_SAFE_INTEGER)) continue;
        const negative = next() % 2 === 0 && /[1-9]/.test(whole + fraction);
        const decimal = `${negative ? '-' : ''}${whole}${e === 0 ? '' : `.${fraction}`}`;
        expect(value(moneyToDecimal(value(moneyFromDecimal(decimal, currency))))).toBe(decimal);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1900);
  });
});

describe('hostile run-time input', () => {
  const usd = (amountMinor: number) => raw(amountMinor, 'USD');

  /** An object whose getters return the next listed value on each read, and count the reads. */
  function unstable(amounts: unknown[], currencies: unknown[]) {
    const reads = { amountMinor: 0, currency: 0 };
    const at = (list: unknown[], n: number) => list[Math.min(n, list.length - 1)];
    const money = {
      get amountMinor() {
        return at(amounts, reads.amountMinor++);
      },
      get currency() {
        return at(currencies, reads.currency++);
      },
    };
    return { money: money as unknown as Money, reads };
  }

  it('reads each field once and uses only what it checked', () => {
    const a = unstable([150, 1.5], ['USD']);
    expect(value(moneyToDecimal(a.money))).toBe('1.50');
    expect(a.reads).toEqual({ amountMinor: 1, currency: 1 });

    expect(refusal(moneyToDecimal(unstable([1.5, 150], ['USD']).money))).toBe('not_safe_integer');
    expect(value(compareMoney(unstable([1, Number.NaN], ['USD']).money, usd(2)))).toBe(-1);
    expect(value(addMoney(unstable([1, 0.5], ['USD']).money, usd(1)))).toEqual({
      amountMinor: 2,
      currency: 'USD',
    });
    expect(value(subtractMoney(usd(5), unstable([1, 2 ** 60], ['USD']).money)).amountMinor).toBe(4);

    const c = unstable([100], ['USD', 'unknown']);
    expect(value(moneyToDecimal(c.money))).toBe('1.00');
    expect(c.reads).toEqual({ amountMinor: 1, currency: 1 });
    expect(refusal(moneyToDecimal(unstable([100], ['unknown', 'USD']).money))).toBe(
      'unknown_currency',
    );
    expect(value(addMoney(unstable([1], ['USD', 'EUR']).money, usd(1))).currency).toBe('USD');
  });

  it('refuses objects whose fields throw when read', () => {
    const throwing = {
      get amountMinor(): number {
        throw new Error('boom');
      },
      currency: 'USD',
    } as unknown as Money;
    const proxy = new Proxy({} as Money, {
      get() {
        throw new Error('boom');
      },
    });
    for (const bad of [throwing, proxy]) {
      expect(refusal(moneyToDecimal(bad))).toBe('not_money');
      expect(refusal(compareMoney(bad, usd(1)))).toBe('not_money');
      expect(refusal(addMoney(usd(1), bad))).toBe('not_money');
      expect(refusal(subtractMoney(bad, bad))).toBe('not_money');
    }
  });

  it('refuses non-objects in place of money instead of throwing', () => {
    for (const bad of [null, undefined, 0, 'USD', true, Symbol('x'), 10n]) {
      const money = bad as unknown as Money;
      expect(refusal(moneyToDecimal(money))).toBe('not_money');
      expect(refusal(compareMoney(money, usd(1)))).toBe('not_money');
      expect(refusal(addMoney(usd(1), money))).toBe('not_money');
      expect(refusal(subtractMoney(money, money))).toBe('not_money');
    }
  });

  it('refuses values that cannot be turned into strings, and boxed primitives', () => {
    const bare = Object.create(null) as unknown;
    const symbol = Symbol('USD') as unknown;
    for (const currency of [bare, symbol, new String('USD'), ['USD']]) {
      expect(refusal(minorUnitExponent(currency as Currency))).toBe('not_a_currency');
      expect(refusal(moneyFromDecimal('1.00', currency as Currency))).toBe('not_a_currency');
      expect(refusal(moneyToDecimal(raw(100, currency)))).toBe('not_a_currency');
    }
    for (const decimal of [bare, symbol, new String('1.00')]) {
      expect(refusal(moneyFromDecimal(decimal as string, 'USD'))).toBe('malformed_decimal');
    }
    for (const amount of [bare, symbol, new Number(100)]) {
      expect(refusal(moneyToDecimal(raw(amount, 'USD')))).toBe('not_safe_integer');
      expect(refusal(addMoney(raw(amount, 'USD'), usd(1)))).toBe('not_safe_integer');
    }
    expect(refusal(moneyToDecimal(bare as Money))).toBe('not_a_currency');
  });

  it(`refuses decimals longer than ${MAX_DECIMAL_LENGTH} characters before parsing them`, () => {
    expect(MAX_DECIMAL_LENGTH).toBe(64);
    const padded = `1.${'0'.repeat(MAX_DECIMAL_LENGTH - 2)}`;
    expect(value(moneyFromDecimal(padded, 'USD')).amountMinor).toBe(100);
    expect(refusal(moneyFromDecimal(`${padded}0`, 'USD'))).toBe('malformed_decimal');
    // Would be out_of_range if it reached BigInt; refused on length instead, with a short detail.
    const huge = '9'.repeat(4_000_000);
    expect(refusal(moneyFromDecimal(huge, 'USD'))).toBe('malformed_decimal');
  });

  it('keeps echoed input short', () => {
    const long = `x${'y'.repeat(10_000)}`;
    const results: MoneyResult<unknown>[] = [
      moneyFromDecimal(long, 'USD'),
      moneyFromDecimal('1.2.3', 'USD'),
      moneyFromDecimal('1', long as Currency),
      moneyFromDecimal(`1.${'1'.repeat(60)}`, 'USD'),
      moneyToDecimal(raw(1, long)),
    ];
    for (const result of results) refusal(result); // asserts detail length <= 100
  });
});
