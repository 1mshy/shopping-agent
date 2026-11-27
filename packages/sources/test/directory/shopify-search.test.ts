import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { searchShopify } from '../../src/directory/search.ts';
import { fakeContext, MARKET_CA } from '../platform/fake.ts';

const input = {
  origin: 'https://shop.example',
  marketPrefix: '/en-ca',
  query: 'red & rain',
  market: MARKET_CA,
};
const endpoint =
  input.origin +
  '/en-ca/search/suggest.json?q=red+%26+rain&resources%5Btype%5D=product&resources%5Blimit%5D=10';
it('uses the market prefix and carries product identity through the public route', async () => {
  const body = readFileSync(
    new URL('../../../../lab/routes/fixtures/shopify-suggest.json', import.meta.url),
    'utf8',
  );
  const { context, sent } = fakeContext({ [endpoint]: { body } });
  expect(await searchShopify(input, context)).toEqual({
    kind: 'results',
    candidates: [
      {
        title: 'Red Rain Coat',
        url: 'https://shop.example/en-ca/products/red-rain-coat?_pos=1&_psq=a&_ss=e&_v=1.0',
        storeHost: 'shop.example',
        marketPrefix: '/en-ca',
        sku: null,
        gtin: null,
        mpn: null,
        brand: null,
        variant: {},
      },
    ],
  });
  expect(sent).toEqual([{ url: endpoint, rung: 'api' }]);
});
it('returns control to the next route for an unsupported buyer locale', async () => {
  expect(await searchShopify(input, fakeContext({ [endpoint]: { status: 417 } }).context)).toEqual({
    kind: 'unsupported',
  });
});
it('keeps rate limiting as a fetch outcome', async () => {
  expect(
    await searchShopify(input, fakeContext({ [endpoint]: { status: 429 } }).context),
  ).toMatchObject({ kind: 'fetch_failed', outcome: { kind: 'rate_limited' } });
});
