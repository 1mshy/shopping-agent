import { describe, expect, it } from 'vitest';
import {
  CURRENCY_REFUSAL_CODES,
  type CurrencyEvidence,
  type CurrencyRefusalCode,
  type CurrencySource,
  currencyForCountry,
  localeSeparators,
  minorUnitExponent,
  parseLocaleTag,
  resolveCurrency,
} from '../src/index.ts';

type Read = { readonly [K in Exclude<keyof CurrencyEvidence, 'host'>]?: string };
const evidence = (host: string, read: Read = {}): CurrencyEvidence => ({
  host,
  platform: read.platform ?? null,
  priceCurrency: read.priceCurrency ?? null,
  locale: read.locale ?? null,
  storeCountry: read.storeCountry ?? null,
  priceText: read.priceText ?? null,
});

function resolved(host: string, read: Read = {}): [string, CurrencySource] {
  const result = resolveCurrency(evidence(host, read));
  if (!result.ok)
    throw new Error(`${host}: refused ${result.refusal.code} (${result.refusal.detail})`);
  return [result.currency, result.source];
}

function refused(host: string, read: Read = {}): CurrencyRefusalCode {
  const result = resolveCurrency(evidence(host, read));
  if (result.ok) throw new Error(`${host}: resolved ${result.currency} from ${result.source}`);
  expect(CURRENCY_REFUSAL_CODES).toContain(result.refusal.code);
  expect(result.refusal.detail).not.toBe('');
  expect(result.refusal.detail.length).toBeLessThanOrEqual(160);
  return result.refusal.code;
}

describe('resolveCurrency: no default currency, ever', () => {
  it('refuses when nothing places the read', () => {
    for (const host of [
      'shop.com',
      'shop.net',
      'shop.store',
      'shop.io',
      'shop.co',
      'shop.ai',
      'my.shop.com',
      'localhost',
      '192.168.1.10',
      '',
    ]) {
      expect(refused(host, { priceText: '$19.99' }), host).toBe('unknown_currency');
      expect(refused(host), host).toBe('unknown_currency');
    }
  });

  it('never takes a family mark ("$", "¥", "kr") as a currency on its own', () => {
    expect(refused('shop.com', { priceText: '¥1,299' })).toBe('unknown_currency');
    expect(refused('shop.com', { priceText: '1 299 kr' })).toBe('unknown_currency');
  });
});

describe('resolveCurrency: family marks take the store country, and must belong to it', () => {
  it('reads a yen sign by the store country', () => {
    expect(resolved('shop.jp', { priceText: '¥1,299' })).toEqual(['JPY', 'host_market']);
    expect(resolved('shop.cn', { priceText: '¥99' })).toEqual(['CNY', 'host_market']);
    expect(resolved('shop.com', { priceText: '¥99', storeCountry: 'jp' })).toEqual([
      'JPY',
      'store_country',
    ]);
  });

  it('reads "kr" by the store country', () => {
    expect(resolved('shop.se', { priceText: '1 299 kr' })).toEqual(['SEK', 'host_market']);
    expect(resolved('shop.no', { priceText: '1 299 kr' })).toEqual(['NOK', 'host_market']);
    expect(resolved('shop.dk', { priceText: '1.299 kr.' })).toEqual(['DKK', 'host_market']);
  });

  it('refuses a family mark the store country does not bill', () => {
    expect(refused('shop.de', { priceText: '$19.99' })).toBe('conflict');
    expect(refused('eu.store.example.com', { priceText: '$19.99' })).toBe('conflict');
    expect(refused('shop.de', { priceText: '99 kr' })).toBe('conflict');
    expect(refused('shop.com', { priceText: '¥99', locale: 'ko-KR' })).toBe('conflict');
  });

  it('refuses a family mark a declaration contradicts', () => {
    expect(refused('shop.com', { platform: 'EUR', priceText: '$5' })).toBe('converted');
    expect(refused('shop.com', { priceCurrency: 'KRW', priceText: '¥5' })).toBe('converted');
    expect(refused('shop.ca', { priceCurrency: 'AUD', priceText: '$5' })).toBe('conflict');
    expect(resolved('shop.com', { priceCurrency: 'MXN', priceText: '$5' })).toEqual([
      'MXN',
      'price_currency',
    ]);
  });
});

describe('resolveCurrency: explicit marks', () => {
  it('names the currency of every explicit mark', () => {
    const marks: readonly [string, string][] = [
      ['₹999', 'INR'],
      ['RMB 99', 'CNY'],
      ['₩12,000', 'KRW'],
      ['NZ$ 12', 'NZD'],
      ['HK$12', 'HKD'],
      ['US $12.34', 'USD'],
      ['R$ 99,90', 'BRL'],
      ['99,99 zł', 'PLN'],
      ['1 299 Kč', 'CZK'],
      ['KWD 1.234', 'KWD'],
      ['12 jpy', 'JPY'],
      ['ALL 1200', 'ALL'],
    ];
    for (const [priceText, currency] of marks) {
      expect(resolved('shop.ca', { priceText }), priceText).toEqual([currency, 'price_mark']);
    }
  });

  it('does not read English words or letters inside words as codes', () => {
    expect(resolved('shop.ca', { priceText: 'all $12' })).toEqual(['CAD', 'host_market']);
    expect(resolved('shop.ca', { priceText: 'Top pick $12' })).toEqual(['CAD', 'host_market']);
    expect(resolved('shop.ca', { priceText: 'Audio cable $12.99' })).toEqual([
      'CAD',
      'host_market',
    ]);
  });

  it('refuses marks naming two currencies, or a code with no minor unit', () => {
    expect(refused('shop.com', { priceText: 'US$ 10 / CA$ 13' })).toBe('conflict');
    expect(refused('shop.com', { priceCurrency: 'USD', priceText: 'US$ 10 / CA$ 13' })).toBe(
      'converted',
    );
    expect(refused('shop.com', { priceText: 'XAU 5' })).toBe('not_a_listing_currency');
    expect(refused('shop.com', { priceText: '€5 $5' })).toBe('conflict');
  });

  it('accepts a mark that agrees with the declaration, and refuses one that does not', () => {
    expect(resolved('shop.com', { platform: 'EUR', priceText: '12,99 €' })).toEqual([
      'EUR',
      'price_mark',
    ]);
    expect(refused('shop.com', { platform: 'EUR', priceText: '£12' })).toBe('converted');
    expect(refused('amazon.com', { platform: 'USD', priceText: 'CDN$ 138.83' })).toBe('converted');
  });
});

describe('resolveCurrency: a site’s own approximation is a conversion', () => {
  it('refuses approximate figures', () => {
    for (const priceText of [
      'approx. €23',
      'Approximately CA$25',
      '≈ 23,10 €',
      '~$25',
      'ca. 25 €',
      'env. 25 €',
      'about $25',
    ]) {
      expect(refused('shop.ca', { priceText }), priceText).toBe('converted');
    }
  });

  it('does not take a range for an approximation', () => {
    expect(resolved('shop.ca', { priceText: '$10 ~ $20' })).toEqual(['CAD', 'host_market']);
    expect(resolved('shop.ca', { priceText: 'CA$25' })).toEqual(['CAD', 'price_mark']);
  });
});

describe('resolveCurrency: declarations', () => {
  it('reads a declared code in any case, trimmed; an empty one is no declaration', () => {
    expect(resolved('shop.com', { platform: '  cad ' })).toEqual(['CAD', 'platform']);
    expect(resolved('shop.ca', { platform: '   ' })).toEqual(['CAD', 'host_market']);
    expect(resolved('shop.com', { platform: '', priceCurrency: 'gbp' })).toEqual([
      'GBP',
      'price_currency',
    ]);
  });

  it('refuses a declaration that is not a listing currency', () => {
    for (const code of [
      'XAU',
      'XXX',
      'XTS',
      'unknown',
      'ABC',
      'US',
      'usd$',
      'toString',
      '__proto__',
    ]) {
      expect(refused('shop.com', { priceCurrency: code }), code).toBe('not_a_listing_currency');
    }
  });

  it('reads zero- and three-decimal currencies like any other', () => {
    expect(resolved('shop.com', { priceCurrency: 'JPY' })).toEqual(['JPY', 'price_currency']);
    expect(resolved('shop.com', { platform: 'KWD' })).toEqual(['KWD', 'platform']);
  });
});

describe('resolveCurrency: the store’s own country', () => {
  it('reads the host market', () => {
    const hosts: readonly [string, string][] = [
      ['SHOP.EXAMPLE.CA', 'CAD'],
      ['shop.example.ca:8443', 'CAD'],
      ['shop.example.ca.', 'CAD'],
      ['www.amazon.co.jp', 'JPY'],
      ['shop.kw', 'KWD'],
      ['tienda.com.co', 'COP'],
      ['shop.com.mx', 'MXN'],
      ['fr.example.ca', 'CAD'],
      ['ca.example.io', 'CAD'],
      ['shop.bg', 'EUR'],
      ['shop.hr', 'EUR'],
      ['shop.eu', 'EUR'],
      ['shop.uk', 'GBP'],
    ];
    for (const [host, currency] of hosts) {
      expect(resolved(host, { priceText: '19.99' }), host).toEqual([currency, 'host_market']);
    }
  });

  it('reads the locale before the host, and its region only', () => {
    expect(resolved('shop.com', { locale: 'zh-Hant-TW' })).toEqual(['TWD', 'locale']);
    expect(resolved('shop.de', { locale: 'en-GB' })).toEqual(['GBP', 'locale']);
    expect(refused('shop.com', { locale: 'es-419' })).toBe('unknown_currency');
    expect(refused('shop.com', { locale: 'x-default' })).toBe('unknown_currency');
    expect(resolved('shop.ca', { locale: 'en-PA' })).toEqual(['CAD', 'host_market']);
  });

  it('reads the store directory country last', () => {
    expect(resolved('shop.com', { storeCountry: ' ca ' })).toEqual(['CAD', 'store_country']);
    expect(refused('shop.com', { storeCountry: 'ZZ' })).toBe('unknown_currency');
  });

  it('never throws on odd evidence', () => {
    const odd: unknown[] = [
      null,
      undefined,
      {},
      { host: 7 },
      { host: 'shop.ca', priceText: 12 },
      { host: 'shop.ca', priceText: 'x'.repeat(5000) },
    ];
    for (const input of odd) {
      expect(() => resolveCurrency(input as CurrencyEvidence)).not.toThrow();
    }
    expect(
      resolveCurrency({ host: 'shop.ca', priceText: 12 } as unknown as CurrencyEvidence),
    ).toEqual({
      ok: true,
      currency: 'CAD',
      source: 'host_market',
    });
  });
});

describe('currencyForCountry', () => {
  it('names only currencies with a minor unit', () => {
    const countries = [
      'US',
      'CA',
      'GB',
      'DE',
      'JP',
      'KW',
      'CL',
      'CW',
      'SL',
      'BG',
      'EU',
      'CH',
      'LI',
    ];
    for (const country of countries) {
      const currency = currencyForCountry(country);
      expect(currency, country).not.toBeNull();
      expect(minorUnitExponent(currency ?? 'unknown').ok, country).toBe(true);
    }
  });

  it('names nothing for codes it does not vouch for', () => {
    for (const code of ['PA', 'PS', 'ZW', 'AQ', 'ZZ', 'X', 'USA', '', 'constructor', '__proto__']) {
      expect(currencyForCountry(code), code).toBeNull();
    }
  });
});

describe('locales', () => {
  it('parses BCP 47 tags and og:locale', () => {
    expect(parseLocaleTag('en-CA')).toEqual({ language: 'en', region: 'CA' });
    expect(parseLocaleTag('fr_ca')).toEqual({ language: 'fr', region: 'CA' });
    expect(parseLocaleTag('zh-Hant-TW')).toEqual({ language: 'zh', region: 'TW' });
    expect(parseLocaleTag('es-419')).toEqual({ language: 'es', region: null });
    expect(parseLocaleTag('de')).toEqual({ language: 'de', region: null });
    expect(parseLocaleTag('x-default')).toBeNull();
    expect(parseLocaleTag('')).toBeNull();
    expect(parseLocaleTag(42)).toBeNull();
  });

  it('knows how a locale writes numbers, or says it does not', () => {
    expect(localeSeparators('de-DE')).toEqual({ decimal: ',', group: '.' });
    expect(localeSeparators('de-CH')).toEqual({ decimal: '.', group: "'" });
    expect(localeSeparators('fr-CA')).toEqual({ decimal: ',', group: ' ' });
    expect(localeSeparators('en-IE')).toEqual({ decimal: '.', group: ',' });
    expect(localeSeparators('es-MX')).toEqual({ decimal: '.', group: ',' });
    expect(localeSeparators('es-419')).toEqual({ decimal: '.', group: ',' });
    expect(localeSeparators('pt-PT')).toEqual({ decimal: ',', group: ' ' });
    expect(localeSeparators('en-DE')).toBeNull();
    expect(localeSeparators('de-AT')).toBeNull();
    expect(localeSeparators('ar-AE')).toBeNull();
    expect(localeSeparators(undefined)).toBeNull();
  });
});
