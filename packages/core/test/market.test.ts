import { describe, expect, it } from 'vitest';
import {
  type ListingUrlInput,
  marketLocaleCandidates,
  marketResultUrl,
  pickMarketPrefix,
  regionalListingUrl,
  type Storefronts,
  searchStorefront,
  type UserMarket,
} from '../src/index.ts';

const AMAZON: Storefronts = [
  { host: 'amazon.com', country: 'US', currency: 'USD' },
  { host: 'amazon.ca', country: 'CA', currency: 'CAD' },
  { host: 'amazon.co.uk', country: 'GB', currency: 'GBP' },
  { host: 'amazon.de', country: 'DE', currency: 'EUR' },
  { host: 'amazon.co.jp', country: 'JP', currency: 'JPY' },
];
const CANADA: UserMarket = { country: 'CA', currency: 'CAD' };
const JAPAN: UserMarket = { country: 'JP', currency: 'JPY' };

const link = (url: string, market: UserMarket = CANADA): ListingUrlInput => ({
  url,
  market,
  storefronts: AMAZON,
  listingId: 'amazon_asin',
});

describe('searchStorefront', () => {
  it('matches the country in any case, then the currency, then takes the primary', () => {
    expect(
      searchStorefront({ market: { country: 'ca', currency: 'CAD' }, storefronts: AMAZON }),
    ).toBe('amazon.ca');
    expect(
      searchStorefront({ market: { country: 'AT', currency: 'EUR' }, storefronts: AMAZON }),
    ).toBe('amazon.de');
    expect(
      searchStorefront({ market: { country: 'KW', currency: 'KWD' }, storefronts: AMAZON }),
    ).toBe('amazon.com');
  });
});

describe('regionalListingUrl', () => {
  it('maps every listing path form, after any slug, to a bare /dp/ link', () => {
    for (const url of [
      'https://www.amazon.com/dp/B0FQVHHBQV',
      'https://amazon.com/Some-Slug/dp/B0FQVHHBQV/ref=sr_1_1?keywords=x#top',
      'http://www.amazon.com/gp/product/B0FQVHHBQV',
      'https://www.amazon.com/gp/aw/d/B0FQVHHBQV?psc=1',
      'https://WWW.AMAZON.COM/dp/b0fqvhhbqv',
    ]) {
      expect(regionalListingUrl(link(url)), url).toEqual({
        kind: 'rewritten',
        url: 'https://www.amazon.ca/dp/B0FQVHHBQV',
      });
    }
    expect(regionalListingUrl(link('https://www.amazon.ca/dp/B0FQVHHBQV', JAPAN))).toEqual({
      kind: 'rewritten',
      url: 'https://www.amazon.co.jp/dp/B0FQVHHBQV',
    });
  });

  it('carries no listing id off another host, a non-web URL, a query or a malformed id', () => {
    for (const url of [
      'https://evil.example/dp/B0FQVHHBQV',
      'https://amazon.com.evil.example/dp/B0FQVHHBQV',
      'ftp://amazon.com/dp/B0FQVHHBQV',
      'https://www.amazon.com/s?k=x&next=/dp/B0FQVHHBQV',
      'https://www.amazon.com/dp/B0FQVHHBQ',
      'https://www.amazon.com/dp/B0FQVHHBQVX',
      'not a url',
      '',
    ]) {
      expect(regionalListingUrl(link(url)), url).toEqual({
        kind: 'unchanged',
        reason: 'no_listing_id',
      });
    }
  });

  it('says first that no storefront sells to the market', () => {
    expect(regionalListingUrl(link('not a url', { country: 'FR', currency: 'EUR' }))).toEqual({
      kind: 'unchanged',
      reason: 'no_storefront_for_market',
    });
  });
});

describe('pickMarketPrefix', () => {
  it('lists the candidates for a country', () => {
    expect(marketLocaleCandidates('be')).toEqual(['en-be', 'be', 'nl-be', 'fr-be']);
    expect(marketLocaleCandidates('JP')).toEqual(['en-jp', 'jp']);
    expect(marketLocaleCandidates('X1')).toEqual([]);
  });

  it('reads a cart answer in any case and ignores inherited keys', () => {
    expect(
      pickMarketPrefix({
        market: JAPAN,
        defaultMarketCurrency: 'USD',
        cartCurrencies: { jp: ' jpy ' },
      }),
    ).toEqual({ prefix: '/jp', probed: ['en-jp', 'jp'] });
    expect(
      pickMarketPrefix({
        market: { country: 'CA', currency: 'CAD' },
        defaultMarketCurrency: 'unknown',
        cartCurrencies: Object.create({ 'en-ca': 'CAD' }) as Record<string, string>,
      }),
    ).toEqual({ prefix: '', probed: ['en-ca', 'ca', 'fr-ca'] });
  });

  it('probes nothing for a country it cannot name', () => {
    expect(
      pickMarketPrefix({
        market: { country: '', currency: 'CAD' },
        defaultMarketCurrency: 'USD',
        cartCurrencies: {},
      }),
    ).toEqual({ prefix: '', probed: [] });
  });
});

describe('marketResultUrl', () => {
  const origin = 'https://shop.example.com';
  it('keeps the query and the fragment', () => {
    expect(
      marketResultUrl({ origin, pinnedPrefix: '/en-ca', path: '/products/x?_pos=1&_sid=a#r' }),
    ).toBe('https://shop.example.com/en-ca/products/x?_pos=1&_sid=a#r');
  });

  it('treats a pinned two-letter prefix as the country it was chosen for', () => {
    expect(marketResultUrl({ origin, pinnedPrefix: '/ca', path: '/fr-ca/products/x' })).toBe(
      'https://shop.example.com/fr-ca/products/x',
    );
    expect(marketResultUrl({ origin, pinnedPrefix: '/ca', path: '/fr/products/x' })).toBe(
      'https://shop.example.com/ca/products/x',
    );
    expect(marketResultUrl({ origin, pinnedPrefix: '/ca', path: '/ca/products/x' })).toBe(
      'https://shop.example.com/ca/products/x',
    );
  });

  it('compares locale segments in any case and tolerates a trailing slash on the origin', () => {
    expect(
      marketResultUrl({ origin: `${origin}/`, pinnedPrefix: '/en-ca', path: '/EN-CA/products/x' }),
    ).toBe('https://shop.example.com/EN-CA/products/x');
  });

  it('moves a same-origin absolute URL like a path and leaves another origin alone', () => {
    expect(
      marketResultUrl({
        origin,
        pinnedPrefix: '/en-ca',
        path: 'https://shop.example.com/products/x',
      }),
    ).toBe('https://shop.example.com/en-ca/products/x');
    expect(
      marketResultUrl({ origin, pinnedPrefix: '/en-ca', path: 'https://other.example/products/x' }),
    ).toBe('https://other.example/products/x');
    expect(
      marketResultUrl({ origin, pinnedPrefix: '/en-ca', path: '//other.example/products/x' }),
    ).toBe('//other.example/products/x');
  });

  it('does not take a lone segment for a locale', () => {
    expect(marketResultUrl({ origin, pinnedPrefix: '/en-ca', path: '/de' })).toBe(
      'https://shop.example.com/en-ca/de',
    );
  });
});
