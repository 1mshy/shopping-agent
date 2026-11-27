import { expect, it } from 'vitest';
import { searchAmazon } from '../../src/directory/amazon.ts';
import { fakeContext, MARKET_CA } from '../platform/fake.ts';

const input = {
  origin: 'https://www.amazon.ca',
  marketPrefix: '',
  market: MARKET_CA,
  query: 'MX 3S',
};
const endpoint = 'https://www.amazon.ca/s?k=MX+3S';
it('keeps same-region products and deduplicates tracked URLs by ASIN', async () => {
  const { sent, context } = fakeContext({
    [endpoint]: {
      contentType: 'text/html',
      body: '<a href="/Logitech-MX-3S/dp/B0FB21526X/ref=sr_1">Logitech MX 3S</a><a href="/gp/product/B0FB21526X">Repeated</a><a href="https://www.amazon.com/dp/B0FB215262">US product</a><a href="/s?k=other">Other results</a>',
    },
  });
  expect(await searchAmazon(input, context)).toEqual({
    kind: 'results',
    candidates: [
      {
        url: 'https://www.amazon.ca/dp/B0FB21526X',
        storeHost: 'www.amazon.ca',
        marketPrefix: '',
        title: 'Logitech MX 3S',
        sku: 'B0FB21526X',
        gtin: null,
        brand: null,
        mpn: null,
        variant: {},
      },
    ],
  });
  expect(sent).toHaveLength(1);
});
it('skips the wrong market and returns a store refusal after a single request', async () => {
  const { sent, context } = fakeContext({ [endpoint]: { status: 429 } });
  expect(
    await searchAmazon({ ...input, market: { ...MARKET_CA, country: 'US' } }, context),
  ).toEqual({ kind: 'unsupported' });
  expect(sent).toHaveLength(0);
  expect(await searchAmazon(input, context)).toMatchObject({
    kind: 'fetch_failed',
    outcome: { kind: 'rate_limited' },
  });
  expect(sent).toHaveLength(1);
});
