import type { MinorUnitCurrency } from '@agentic-dasher/shared';
import { describe, expect, it } from 'vitest';
import {
  PRICE_TEXT_REFUSAL_CODES,
  type PriceTextInput,
  type PriceTextRefusalCode,
  parsePriceText,
} from '../src/index.ts';

const NBSP = ' ';
const NNBSP = ' ';
const THIN = ' ';

function amount(text: string, currency: MinorUnitCurrency, locale?: string): number {
  const input: PriceTextInput =
    locale === undefined ? { text, currency } : { text, currency, locale };
  const result = parsePriceText(input);
  if (!result.ok) {
    throw new Error(
      `"${text}" ${currency}: refused ${result.refusal.code} (${result.refusal.detail})`,
    );
  }
  expect(result.money.currency).toBe(currency);
  return result.money.amountMinor;
}

function refusal(text: string, currency: MinorUnitCurrency, locale?: string): PriceTextRefusalCode {
  const input: PriceTextInput =
    locale === undefined ? { text, currency } : { text, currency, locale };
  const result = parsePriceText(input);
  if (result.ok) throw new Error(`"${text}" ${currency}: read ${result.money.amountMinor}`);
  expect(PRICE_TEXT_REFUSAL_CODES).toContain(result.refusal.code);
  expect(result.refusal.detail).not.toBe('');
  expect(result.refusal.detail.length).toBeLessThanOrEqual(160);
  return result.refusal.code;
}

/** Writes integer minor units as page text, with string and BigInt work only. */
function layout(minor: bigint, exponent: number, group: string | null, decimal: '.' | ','): string {
  const digits = minor.toString().padStart(exponent + 1, '0');
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const fraction = exponent === 0 ? '' : digits.slice(-exponent);
  let grouped = whole;
  if (group !== null) {
    const parts: string[] = [];
    for (let end = whole.length; end > 0; end -= 3)
      parts.unshift(whole.slice(Math.max(0, end - 3), end));
    grouped = parts.join(group);
  }
  return fraction === '' ? grouped : `${grouped}${decimal}${fraction}`;
}

describe('parsePriceText: every layout reads back the exact minor units', () => {
  const currencies: readonly [MinorUnitCurrency, number][] = [
    ['JPY', 0],
    ['KRW', 0],
    ['USD', 2],
    ['EUR', 2],
    ['CHF', 2],
    ['KWD', 3],
    ['BHD', 3],
    ['CLF', 4],
  ];
  const amounts = [
    1n,
    7n,
    99n,
    100n,
    101n,
    999n,
    1000n,
    1234n,
    99999n,
    100000n,
    1234567n,
    123456789n,
    2n ** 53n - 1n,
  ];
  const layouts: readonly {
    name: string;
    group: string | null;
    decimal: '.' | ',';
    locale?: string;
  }[] = [
    { name: 'US commas', group: ',', decimal: '.' },
    { name: 'German dots', group: '.', decimal: ',', locale: 'de-DE' },
    { name: 'French no-break spaces', group: NBSP, decimal: ',', locale: 'fr-FR' },
    { name: 'Canadian French narrow spaces', group: NNBSP, decimal: ',', locale: 'fr-CA' },
    { name: 'thin spaces', group: THIN, decimal: '.' },
    { name: 'Swiss apostrophes', group: "'", decimal: '.', locale: 'de-CH' },
    { name: 'machine decimal', group: null, decimal: '.' },
    { name: 'decimal comma, no grouping', group: null, decimal: ',', locale: 'de-DE' },
  ];
  for (const [currency, exponent] of currencies) {
    for (const { name, group, decimal, locale } of layouts) {
      it(`${currency} (${exponent} decimals), ${name}`, () => {
        for (const minor of amounts) {
          const figure = layout(minor, exponent, group, decimal);
          const expected = Number(minor);
          expect(amount(figure, currency, locale), figure).toBe(expected);
          expect(amount(`${currency} ${figure}`, currency, locale), figure).toBe(expected);
          expect(amount(`${figure}${NBSP}${currency}`, currency, locale), figure).toBe(expected);
          expect(amount(`${currency.toLowerCase()}${figure}`, currency, locale), figure).toBe(
            expected,
          );
        }
      });
    }
  }
});

describe('parsePriceText: separators', () => {
  it('reads both separators by which comes last, whatever the locale', () => {
    expect(amount('1.299,00 €', 'EUR')).toBe(129900);
    expect(amount('1,299.00', 'USD', 'de-DE')).toBe(129900);
    expect(amount('R$ 1.299,90', 'BRL')).toBe(129990);
  });

  it('reads a lone dot before three digits by the locale, and refuses it without one', () => {
    for (const locale of [
      'de-DE',
      'de',
      'de_DE',
      'DE-de',
      'es-ES',
      'it-IT',
      'nl-NL',
      'pt-BR',
      'da-DK',
    ]) {
      expect(amount('1.299 €', 'EUR', locale), locale).toBe(129900);
    }
    for (const locale of ['en-US', 'en-IE', 'es-MX', 'it-CH', 'de-CH', 'zh-Hant-TW', 'ja-JP']) {
      expect(refusal('1.299', 'EUR', locale), locale).toBe('excess_precision');
    }
    // French, Swedish and Polish group with spaces: the dot is neither of their separators.
    for (const locale of [
      undefined,
      '',
      'x-default',
      'fr-FR',
      'sv-SE',
      'pl-PL',
      'en-DE',
      'ar',
      'zz-ZZ',
    ]) {
      expect(refusal('1.299 €', 'EUR', locale), String(locale)).toBe('ambiguous_separator');
    }
  });

  it('reads a lone dot in a zero-decimal currency by the locale too', () => {
    expect(amount('¥1.299', 'JPY', 'de-DE')).toBe(1299);
    expect(refusal('¥1.299', 'JPY', 'ja-JP')).toBe('excess_precision');
    expect(refusal('¥1.299', 'JPY')).toBe('ambiguous_separator');
    expect(amount('¥1,299', 'JPY')).toBe(1299);
  });

  it('always reads a lone dot as the decimal point in a three-decimal currency', () => {
    expect(amount('KWD 1.234', 'KWD')).toBe(1234);
    expect(amount('KWD 1.234', 'KWD', 'de-DE')).toBe(1234);
    expect(amount('KWD 1,234.567', 'KWD')).toBe(1234567);
    expect(refusal('KWD 1.2345', 'KWD')).toBe('excess_precision');
    expect(amount('KWD 1.2340', 'KWD')).toBe(1234);
  });

  it('refuses a lone comma before three digits in a three-decimal currency unless the locale settles it', () => {
    expect(refusal('12,345 KWD', 'KWD')).toBe('ambiguous_separator');
    expect(amount('12,345 DT', 'TND', 'fr-TN')).toBe(12345);
    expect(amount('12,345 KWD', 'KWD', 'en-KW')).toBe(12345000);
  });

  it('reads a lone comma before three digits as thousands, unless the locale writes a decimal comma', () => {
    expect(amount('1,299', 'USD')).toBe(129900);
    expect(amount('1,299', 'USD', 'en-US')).toBe(129900);
    expect(refusal('1,299 €', 'EUR', 'de-DE')).toBe('excess_precision');
  });

  it('reads a decimal comma with one digit only where the locale writes one', () => {
    expect(amount('12,5 €', 'EUR', 'de-DE')).toBe(1250);
    expect(refusal('12,5 €', 'EUR')).toBe('ambiguous_separator');
    expect(refusal('12,5 €', 'EUR', 'en-IE')).toBe('ambiguous_separator');
  });

  it('accepts Indian grouping', () => {
    expect(amount('₹1,23,456.00', 'INR')).toBe(12345600);
    expect(amount('Rs. 12,34,567', 'INR')).toBe(123456700);
  });

  it('refuses separators that group nothing', () => {
    for (const text of [
      '1,2,3',
      '1.2.3',
      '12,34,5',
      '1.234,567.89',
      '1,234.567,89',
      "1'2.50",
      '01,299,000',
      '1.234 567',
    ]) {
      expect(refusal(text, 'USD'), text).toBe('ambiguous_separator');
    }
  });

  it('reads a lone separator as the decimal point when no thousands group stands before it', () => {
    expect(refusal('0,299', 'USD')).toBe('excess_precision');
    expect(refusal('0.299 €', 'EUR', 'de-DE')).toBe('excess_precision');
    expect(amount('1299,000', 'USD')).toBe(129900);
    expect(refusal('12345.678', 'EUR')).toBe('excess_precision');
  });

  it('refuses a figure that starts with a separator', () => {
    expect(refusal('$.99', 'USD')).toBe('ambiguous_separator');
    expect(refusal(',99 €', 'EUR')).toBe('ambiguous_separator');
  });

  it('reads every kind of space as a thousands separator, and a split buy-box price', () => {
    for (const space of [' ', NBSP, NNBSP, THIN, ' ', '　']) {
      expect(amount(`1${space}299,99${space}€`, 'EUR'), JSON.stringify(space)).toBe(129999);
    }
    expect(amount('$ 99 . 97', 'USD')).toBe(9997);
    expect(amount('1​299,99 €', 'EUR')).toBe(129999);
  });

  it('reads fullwidth digits and signs', () => {
    expect(amount('￥１，２９９', 'JPY')).toBe(1299);
    expect(amount('＄１２．５０', 'USD')).toBe(1250);
  });

  it('reads "49.-" and "1.299,-" as whole units', () => {
    expect(amount('CHF 49.–', 'CHF')).toBe(4900);
    expect(amount('49,- €', 'EUR')).toBe(4900);
    expect(amount('1.299,- €', 'EUR')).toBe(129900);
    expect(amount("CHF 1'299.–", 'CHF')).toBe(129900);
    expect(amount('Kr 1.299,-', 'DKK')).toBe(129900);
    expect(refusal('1,299,-', 'EUR')).toBe('ambiguous_separator');
  });

  it('reads currency names written beside the figure as marks', () => {
    expect(amount('12 dollars', 'CAD')).toBe(1200);
    expect(refusal('12 dollars', 'EUR')).toBe('mark_mismatch');
    expect(refusal('12 euros', 'USD')).toBe('mark_mismatch');
    expect(amount('1,299 yen', 'JPY')).toBe(1299);
  });

  it('reads the rand sign, glued or spaced', () => {
    expect(amount('R1 299,00', 'ZAR')).toBe(129900);
    expect(amount('R 1,299.00', 'ZAR')).toBe(129900);
    expect(refusal('R 1,299.00', 'USD')).toBe('mark_mismatch');
  });
});

describe('parsePriceText: precision and range', () => {
  it('reads up to 2^53 - 1 minor units and refuses one more, never rounding', () => {
    expect(amount('$90,071,992,547,409.91', 'USD')).toBe(Number.MAX_SAFE_INTEGER);
    expect(refusal('$90,071,992,547,409.92', 'USD')).toBe('excess_precision');
    expect(amount('¥9,007,199,254,740,991', 'JPY')).toBe(Number.MAX_SAFE_INTEGER);
    expect(refusal('¥9,007,199,254,740,992', 'JPY')).toBe('excess_precision');
    expect(refusal(`${'9'.repeat(80)}`, 'USD')).toBe('excess_precision');
  });

  it('accepts zero padding and refuses any other digit beyond the exponent', () => {
    expect(amount('1299.000', 'JPY')).toBe(1299);
    expect(amount('12.9900', 'USD')).toBe(1299);
    expect(refusal('12.9901', 'USD')).toBe('excess_precision');
    // A dot before exactly three digits may still group thousands: the locale decides.
    expect(refusal('12.990', 'USD')).toBe('ambiguous_separator');
    expect(amount('12.990', 'USD', 'en-US')).toBe(1299);
    expect(refusal('1299.5', 'JPY')).toBe('excess_precision');
    expect(refusal('0.0042', 'USD')).toBe('excess_precision');
  });

  it('refuses zero and negative figures', () => {
    for (const text of ['0', '$0.00', '0,00 €', '¥0', 'KWD 0.000', '000']) {
      expect(
        refusal(
          text,
          text.includes('¥')
            ? 'JPY'
            : text.includes('KWD')
              ? 'KWD'
              : text.includes('€')
                ? 'EUR'
                : 'USD',
        ),
        text,
      ).toBe('zero');
    }
    for (const text of ['-$5.00', '$-5.00', '- 5,00 €', '−5,00 €', 'Save -$5']) {
      expect(refusal(text, text.includes('€') ? 'EUR' : 'USD'), text).toBe('zero');
    }
  });

  it('reads a cent sign as minor units of a two-decimal dollar', () => {
    expect(amount('99¢', 'USD')).toBe(99);
    expect(amount('5 ¢', 'CAD')).toBe(5);
    expect(amount('150¢', 'USD')).toBe(150);
    expect(refusal('99¢', 'EUR')).toBe('mark_mismatch');
    expect(refusal('99.5¢', 'USD')).toBe('excess_precision');
    expect(refusal('$1 99¢', 'USD')).toBe('several_amounts');
  });
});

describe('parsePriceText: marks', () => {
  it('reads marks that agree with the currency', () => {
    expect(amount('US $12.34', 'USD')).toBe(1234);
    expect(amount('CA$12', 'CAD')).toBe(1200);
    expect(amount('NZ$12', 'NZD')).toBe(1200);
    expect(amount('HK$ 1,299', 'HKD')).toBe(129900);
    expect(amount('1 299 kr', 'SEK')).toBe(129900);
    expect(amount('1 299 kr', 'NOK')).toBe(129900);
    expect(amount('99,99 zł', 'PLN')).toBe(9999);
    expect(amount('1 299 Kč', 'CZK')).toBe(129900);
    expect(amount('£12', 'GIP')).toBe(1200);
    expect(amount('₩12,000', 'KRW')).toBe(12000);
    expect(amount('RMB 99', 'CNY')).toBe(9900);
    expect(amount('¥99', 'CNY')).toBe(9900);
    expect(amount('$12', 'MXN')).toBe(1200);
  });

  it('refuses a mark naming another currency', () => {
    const cases: readonly [string, MinorUnitCurrency][] = [
      ['US $12.34', 'CAD'],
      ['$12', 'EUR'],
      ['€12', 'USD'],
      ['£12', 'EUR'],
      ['¥99', 'KRW'],
      ['99 kr', 'EUR'],
      ['A$ 12', 'USD'],
      ['12 USD', 'CAD'],
      ['EUR 12', 'CHF'],
      ['XAU 12', 'USD'],
      ['R$ 12', 'USD'],
      ['₹999', 'PKR'],
    ];
    for (const [text, currency] of cases)
      expect(refusal(text, currency), text).toBe('mark_mismatch');
  });

  it('does not read letters inside words, or English words, as codes', () => {
    expect(amount('Audio cable $12.99', 'CAD')).toBe(1299);
    expect(amount('Decade edition $9', 'USD')).toBe(900);
    expect(amount('all $12', 'USD')).toBe(1200);
    expect(amount('Top pick $12', 'USD')).toBe(1200);
    expect(amount('MEGA$12', 'USD')).toBe(1200);
  });
});

describe('parsePriceText: what a text says the money is', () => {
  it('refuses payments and recurring charges', () => {
    for (const text of [
      '$24/mo',
      '$24 / mo.',
      '$24/month',
      '$99/yr',
      '$5 per month',
      '$5 a month',
      '$9.99 monthly',
      'CA$12.50 bi-weekly',
      '49,99 €/Monat',
      '49,99 € pro Monat',
      '49,99 € par mois',
      '12x de R$ 29,90',
      '3x sans frais 33,33 €',
      'or 4 payments of $12.50',
      '$12.50 with Klarna',
      '0% APR $1,299',
    ]) {
      expect(
        refusal(
          text,
          text.includes('R$')
            ? 'BRL'
            : text.includes('€')
              ? 'EUR'
              : text.includes('CA$')
                ? 'CAD'
                : 'USD',
        ),
        text,
      ).toBe('instalment');
    }
  });

  it('refuses floors, unit prices and open ranges', () => {
    expect(refusal('Starting at $49', 'USD')).toBe('lower_bound');
    expect(refusal('ab 49,99 €', 'EUR')).toBe('lower_bound');
    expect(refusal('à partir de 49,99 €', 'EUR')).toBe('lower_bound');
    expect(refusal('$49.99+', 'USD')).toBe('lower_bound');
    expect(refusal('12,99 €/kg', 'EUR')).toBe('per_measure');
    expect(refusal('12,99 € / 1 kg', 'EUR')).toBe('per_measure');
    expect(refusal('$3.49/lb', 'USD')).toBe('per_measure');
    expect(refusal('1,25 $ le 100 g', 'CAD')).toBe('per_measure');
    expect(refusal('€12.99/m²', 'EUR')).toBe('per_measure');
    expect(refusal('Save up to $50', 'USD')).toBe('range');
  });

  it('reads a price with a tax label, which is not a floor', () => {
    expect(amount('$49.99 + tax', 'USD')).toBe(4999);
    expect(refusal('$5 + $2 shipping', 'USD')).toBe('several_amounts');
    expect(refusal('$49+ (10 colours)', 'USD')).toBe('lower_bound');
  });

  it('refuses ranges and several figures', () => {
    expect(refusal('$10 to $20', 'USD')).toBe('range');
    expect(refusal('10 € – 20 €', 'EUR')).toBe('range');
    expect(refusal('$10 $20', 'USD')).toBe('several_amounts');
    expect(refusal('2 19.99', 'USD')).toBe('several_amounts');
    expect(refusal('AMD Ryzen 7 $299', 'USD')).toBe('several_amounts');
    expect(refusal('12x $5', 'USD')).toBe('several_amounts');
    expect(refusal('49.99, 59.99', 'USD')).toBe('several_amounts');
  });

  it('refuses a percentage, a figure joined to letters, and digits it cannot read', () => {
    expect(refusal('20%', 'USD')).toBe('no_amount');
    expect(refusal('RTX4090', 'USD')).toBe('no_amount');
    expect(refusal('$1.2k', 'USD')).toBe('no_amount');
    expect(refusal('$99⁹⁹', 'USD')).toBe('no_amount');
    expect(refusal('٤٩٫٩٩', 'USD')).toBe('no_amount');
    expect(refusal('Free', 'USD')).toBe('no_amount');
    expect(refusal('   ', 'USD')).toBe('no_amount');
  });

  it('never throws, whatever it is given', () => {
    const odd: unknown[] = [
      null,
      undefined,
      42,
      {},
      { text: 49.99, currency: 'USD' },
      { text: '12', currency: 'unknown' },
      { text: '12', currency: 'XAU' },
      { text: '12', currency: 'usd' },
      { text: 'x'.repeat(5000), currency: 'USD' },
      { text: `${'1,'.repeat(3000)}1`, currency: 'USD' },
    ];
    for (const input of odd) {
      let result: ReturnType<typeof parsePriceText> | undefined;
      expect(() => {
        result = parsePriceText(input as PriceTextInput);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
    // A locale that is not a string is no locale.
    expect(
      parsePriceText({ text: '12', currency: 'USD', locale: 7 } as unknown as PriceTextInput),
    ).toEqual({
      ok: true,
      money: { amountMinor: 1200, currency: 'USD' },
    });
  });
});
