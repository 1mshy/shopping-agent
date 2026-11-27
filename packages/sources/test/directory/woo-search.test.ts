import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { searchWoo } from '../../src/directory/search.ts';
import { fakeContext, MARKET_CA } from '../platform/fake.ts';

const input = {
  origin: 'https://shop.example',
  marketPrefix: '',
  query: 'test pennant',
  market: MARKET_CA,
};
const endpoint = `${input.origin}/wp-json/wc/store/v1/products?search=test+pennant&per_page=10`;
it('reads a product permalink and title without adopting an unverified search price', async () => {
  const body = readFileSync(
    new URL('../../../../lab/routes/fixtures/woo-products.json', import.meta.url),
    'utf8',
  );
  const { sent, context } = fakeContext({ [endpoint]: { body } });
  expect(await searchWoo(input, context)).toEqual({
    kind: 'results',
    candidates: [
      {
        url: 'https://shop.example/product/test-pennant/',
        title: 'Test Pennant',
        storeHost: 'shop.example',
        marketPrefix: '',
        gtin: null,
        sku: null,
        mpn: null,
        variant: {},
        brand: null,
      },
    ],
  });
  expect(sent).toEqual([{ url: endpoint, rung: 'api' }]);
});
it('ignores another store’s permalink and rejects a malformed payload', async () => {
  const rows = [{ name: 'Test Pennant', permalink: 'https://other.example/product/test-pennant/' }];
  expect(
    await searchWoo(input, fakeContext({ [endpoint]: { body: JSON.stringify(rows) } }).context),
  ).toEqual({ kind: 'results', candidates: [] });
  expect(
    await searchWoo(
      input,
      fakeContext({ [endpoint]: { body: '{"message":"missing route"}' } }).context,
    ),
  ).toEqual({ kind: 'invalid_response' });
});
