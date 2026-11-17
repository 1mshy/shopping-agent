import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  Currency,
  hasMinorUnits,
  ISO_CURRENCY_CODES,
  ISO_FUND_CODES,
  ISO_MINOR_UNITS,
  IsoCurrencyCode,
  LISTING_CURRENCIES,
  ListingCurrency,
  MINOR_UNIT_CURRENCIES,
  MinorUnitCurrency,
  UNKNOWN_CURRENCY,
} from '../src/index.ts';

// Codes whose ISO 4217 minor unit is "N.A." in List One (published 2026-09-17).
const NO_MINOR_UNIT = [
  'XAG',
  'XAU',
  'XBA',
  'XBB',
  'XBC',
  'XBD',
  'XDR',
  'XPD',
  'XPT',
  'XSU',
  'XTS',
  'XUA',
  'XXX',
];

describe('ISO 4217 table', () => {
  it('has one sorted, unique entry per active alphabetic code', () => {
    expect(ISO_CURRENCY_CODES).toHaveLength(178);
    expect(new Set(ISO_CURRENCY_CODES).size).toBe(ISO_CURRENCY_CODES.length);
    expect([...ISO_CURRENCY_CODES].sort()).toEqual([...ISO_CURRENCY_CODES]);
    expect(Object.keys(ISO_MINOR_UNITS).sort()).toEqual([...ISO_CURRENCY_CODES]);
    for (const code of ISO_CURRENCY_CODES) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  it('carries the published minor units', () => {
    expect(ISO_MINOR_UNITS.USD).toBe(2);
    expect(ISO_MINOR_UNITS.EUR).toBe(2);
    expect(ISO_MINOR_UNITS.JPY).toBe(0);
    expect(ISO_MINOR_UNITS.KRW).toBe(0);
    expect(ISO_MINOR_UNITS.BHD).toBe(3);
    expect(ISO_MINOR_UNITS.KWD).toBe(3);
    expect(ISO_MINOR_UNITS.CLF).toBe(4);
    expect(ISO_MINOR_UNITS.UYW).toBe(4);
    const counts: Record<string, number> = {};
    for (const code of ISO_CURRENCY_CODES) {
      const key = String(ISO_MINOR_UNITS[code]);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    expect(counts).toEqual({ '0': 17, '2': 139, '3': 7, '4': 2, null: 13 });
  });

  it('has no exponent for codes without a minor unit', () => {
    const none = ISO_CURRENCY_CODES.filter((code) => ISO_MINOR_UNITS[code] === null);
    expect(none).toEqual(NO_MINOR_UNIT);
  });

  it('lists the fund codes', () => {
    expect([...ISO_FUND_CODES]).toEqual([
      'BOV',
      'CHE',
      'CHW',
      'CLF',
      'COU',
      'MXV',
      'USN',
      'UYI',
      'UYW',
      'XAD',
    ]);
  });
});

describe('ISO 4217 table against Intl (Node 26, ICU 78.3, CLDR 48)', () => {
  // V8 takes currency digits from CLDR, not from ISO 4217. ISO is the authority for this table;
  // these are the codes where CLDR says 0 fraction digits and ISO says otherwise. Each one is a
  // known, reviewed disagreement, not a typo in the table. If Node's ICU changes, this list must be
  // re-reviewed: the test fails both on a new disagreement and on a stale exception.
  const INTL_DISAGREES: Record<string, { iso: number; intl: number }> = {
    AFN: { iso: 2, intl: 0 }, // Afghani
    ALL: { iso: 2, intl: 0 }, // Lek
    COP: { iso: 2, intl: 0 }, // Colombian Peso
    HUF: { iso: 2, intl: 0 }, // Forint
    IDR: { iso: 2, intl: 0 }, // Rupiah
    IQD: { iso: 3, intl: 0 }, // Iraqi Dinar
    IRR: { iso: 2, intl: 0 }, // Iranian Rial
    KPW: { iso: 2, intl: 0 }, // North Korean Won
    LAK: { iso: 2, intl: 0 }, // Lao Kip
    LBP: { iso: 2, intl: 0 }, // Lebanese Pound
    MGA: { iso: 2, intl: 0 }, // Malagasy Ariary
    MMK: { iso: 2, intl: 0 }, // Kyat
    PKR: { iso: 2, intl: 0 }, // Pakistan Rupee
    SOS: { iso: 2, intl: 0 }, // Somali Shilling
    SYP: { iso: 2, intl: 0 }, // Syrian Pound
    YER: { iso: 2, intl: 0 }, // Yemeni Rial
  };

  // Intl answers 2 for any code ICU does not know, so only codes in Intl.supportedValuesOf are
  // compared. These table codes are NOT covered by the cross-check; their exponents rest on the
  // ISO list alone. The test fails if the coverage changes in either direction.
  const NOT_IN_ICU = [
    'BOV', // fund
    'CHE', // fund
    'CHW', // fund
    'CLF', // fund
    'COU', // fund
    'MXV', // fund
    'USN', // fund
    'UYI', // fund
    'UYW', // fund
    'VED', // Bolívar Soberano (digital), ISO 2
    'XAD', // fund
    'XAG',
    'XAU',
    'XBA',
    'XBB',
    'XBC',
    'XBD',
    'XPD',
    'XPT',
    'XTS',
    'XUA',
    'XXX',
  ];
  // ICU knows these but ISO gives them no minor unit, so there is nothing to compare.
  const IN_ICU_WITHOUT_ISO_EXPONENT = ['XDR', 'XSU'];

  it('covers exactly the codes ICU knows and ISO gives an exponent', () => {
    const supported = new Set(Intl.supportedValuesOf('currency'));
    expect(ISO_CURRENCY_CODES.filter((code) => !supported.has(code))).toEqual(NOT_IN_ICU);
    expect(
      ISO_CURRENCY_CODES.filter((code) => supported.has(code) && ISO_MINOR_UNITS[code] === null),
    ).toEqual(IN_ICU_WITHOUT_ISO_EXPONENT);
  });

  it('agrees on every covered code, except the listed ones', () => {
    const supported = new Set(Intl.supportedValuesOf('currency'));
    const disagreements: Record<string, { iso: number; intl: number }> = {};
    let compared = 0;
    for (const code of ISO_CURRENCY_CODES) {
      const iso = ISO_MINOR_UNITS[code];
      if (iso === null || !supported.has(code)) continue;
      compared++;
      const intl = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: code,
      }).resolvedOptions().maximumFractionDigits;
      if (intl !== iso) disagreements[code] = { iso, intl: intl ?? -1 };
    }
    expect(disagreements).toEqual(INTL_DISAGREES);
    expect(compared).toBe(178 - NOT_IN_ICU.length - IN_ICU_WITHOUT_ISO_EXPONENT.length);
  });
});

describe('Currency', () => {
  it('is every ISO code plus the explicit value unknown', () => {
    expect(UNKNOWN_CURRENCY).toBe('unknown');
    expect(CURRENCIES).toEqual([...ISO_CURRENCY_CODES, 'unknown']);
    expect(Currency.parse('unknown')).toBe('unknown');
    expect(Currency.parse('XAU')).toBe('XAU');
    expect(IsoCurrencyCode.safeParse('unknown').success).toBe(false);
  });

  it('refuses anything that is not a code', () => {
    for (const bad of ['', 'usd', 'Usd', 'US', 'USDT', 'ABC', ' USD', '$', 'UNKNOWN', null, 840]) {
      expect(Currency.safeParse(bad).success).toBe(false);
    }
  });

  it('separates the codes that have a minor-unit exponent', () => {
    expect(MINOR_UNIT_CURRENCIES).toHaveLength(178 - NO_MINOR_UNIT.length);
    expect(MINOR_UNIT_CURRENCIES).toContain('USD');
    expect(MINOR_UNIT_CURRENCIES).toContain('CLF');
    for (const code of [...NO_MINOR_UNIT, 'unknown']) {
      expect(MINOR_UNIT_CURRENCIES).not.toContain(code);
      expect(MinorUnitCurrency.safeParse(code).success).toBe(false);
    }
    expect(ISO_CURRENCY_CODES.filter((code) => !hasMinorUnits(code))).toEqual(NO_MINOR_UNIT);
  });
});

describe('ListingCurrency', () => {
  it('is every code with a minor unit plus unknown', () => {
    expect(LISTING_CURRENCIES).toEqual([...MINOR_UNIT_CURRENCIES, 'unknown']);
    for (const code of ['USD', 'JPY', 'BHD', 'unknown']) {
      expect(ListingCurrency.parse(code)).toBe(code);
    }
  });

  it('refuses the codes without a minor unit, so none is a second "unknown"', () => {
    for (const code of NO_MINOR_UNIT) expect(ListingCurrency.safeParse(code).success).toBe(false);
    for (const bad of ['', 'usd', 'ABC', null]) {
      expect(ListingCurrency.safeParse(bad).success).toBe(false);
    }
  });

  it('still accepts fund codes (open point)', () => {
    for (const code of ISO_FUND_CODES) expect(ListingCurrency.safeParse(code).success).toBe(true);
  });
});
